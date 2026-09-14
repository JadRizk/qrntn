import { describe, expect, it } from 'vitest'

import { HIGHLIGHT_LIMIT, highlight, languageOf, type ScopeRange } from './highlight.ts'
import { tokenise } from './tokenise.ts'

const cp = (...codes: number[]) => String.fromCodePoint(...codes)

// The ranges, read back as text: what each scope covers, in order.
const cover = (src: string, r: ScopeRange[]) => r.map((x) => `${x.scope}:${src.slice(x.from, x.to)}`)

// Sorted, non-overlapping, inside the string: the contract tokenise.ts walks by.
const wellFormed = (src: string, r: ScopeRange[]) => {
  let at = 0
  for (const x of r) {
    if (x.from < at || x.to <= x.from || x.to > src.length) return false
    at = x.to
  }
  return true
}

describe('highlight — colour over the source', () => {
  it('a language is chosen by extension and nothing else', () => {
    expect(languageOf('SKILL.md')).toBe('markdown')
    expect(languageOf('scripts/run.mjs')).toBe('javascript')
    expect(languageOf('scripts/run.ts')).toBe('typescript')
    expect(languageOf('App.tsx')).toBe('tsx')
    expect(languageOf('App.jsx')).toBe('jsx')
    expect(languageOf('catalog.yaml')).toBe('yaml')
    expect(languageOf('x.YML')).toBe('yaml')
    expect(languageOf('run.sh')).toBeNull()
    expect(languageOf('Makefile')).toBeNull()
  })

  it('no language is no colour', () => {
    expect(highlight('const x = 1', null)).toEqual([])
  })

  it('markdown: marks are marks, emphasis and code are themselves, prose is untouched', () => {
    const src = '# Title\n\nSome *em* and **st** and `c`.\n\n- item\n> quote\n'
    const r = highlight(src, 'markdown')
    expect(wellFormed(src, r)).toBe(true)
    expect(cover(src, r)).toEqual([
      'mark:#', 'mark:*', 'emphasis:em', 'mark:*', 'mark:**', 'strong:st', 'mark:**', 'mark:`', 'code:c', 'mark:`', 'mark:-', 'mark:>',
    ])
  })

  it('markdown: front matter is YAML, its fences are marks, and the body is markdown from the line after', () => {
    const src = '---\nname: x\ndesc: "q"\n---\n# T\n'
    const r = highlight(src, 'markdown')
    expect(wellFormed(src, r)).toBe(true)
    expect(cover(src, r)).toEqual(['mark:---', 'name:name', 'mark::', 'name:desc', 'mark::', 'string:"q"', 'mark:---', 'mark:#'])
  })

  it('markdown: front matter agrees with tokenise.ts — exactly `---`, unclosed runs to the end', () => {
    const src = '---\nname: x\n# not a heading\n'
    const r = highlight(src, 'markdown')
    expect(cover(src, r)).toEqual(['mark:---', 'name:name', 'mark::', 'comment:# not a heading'])
    expect(tokenise(src, []).lines.map((l) => l.cls)).toEqual(['frontmatter', 'frontmatter', 'frontmatter'])
    // A CRLF opening line is not front matter to either.
    const crlf = '---\r\nname: x\r\n---\r\n'
    expect(tokenise(crlf, []).lines[0]!.cls).toBe('plain')
    expect(highlight(crlf, 'markdown').some((x) => x.scope === 'name')).toBe(false)
  })

  it('markdown: a fence with a known info string is parsed as that language; an unknown one is text', () => {
    const src = '```js\nconst a = "s"\n```\n\n```sh\nconst a = "s"\n```\n'
    const r = highlight(src, 'markdown')
    expect(cover(src, r)).toEqual(['mark:```', 'name:js', 'keyword:const', 'name:a', 'string:"s"', 'mark:```', 'mark:```', 'name:sh', 'mark:```'])
  })

  it('javascript: keywords, strings, comments, literals; a plain identifier use stays uncoloured', () => {
    const src = 'import { x } from "y"\n// note\nlet n = 1 + x\n'
    const r = highlight(src, 'javascript')
    expect(wellFormed(src, r)).toBe(true)
    expect(cover(src, r)).toEqual(['keyword:import', 'name:x', 'keyword:from', 'string:"y"', 'comment:// note', 'keyword:let', 'name:n', 'literal:1'])
  })

  it('typescript: a type annotation parses instead of breaking the file', () => {
    const src = 'const f = (a: number): string => `${a}`\n'
    const r = highlight(src, 'typescript')
    expect(cover(src, r)).toContain('keyword:const')
    expect(cover(src, r)).toContain('name:number')
  })

  it('a dialect is the extension\'s: JSX parses as a tag in .jsx and .tsx, a cast parses in .ts', () => {
    const jsx = 'const el = <div className="a">x</div>\n'
    expect(cover(jsx, highlight(jsx, 'jsx'))).toContain('string:"a"')
    expect(cover(jsx, highlight(jsx, 'tsx'))).toContain('string:"a"')
    const cast = 'const n = <number>x\n'
    expect(cover(cast, highlight(cast, 'typescript'))).toContain('name:number')
  })

  it('yaml: keys are names, quoted values strings, comments comments, plain scalars untouched', () => {
    const src = 'name: demo\nlist:\n  - 1\n# c\nk: "q"\n'
    const r = highlight(src, 'yaml')
    expect(wellFormed(src, r)).toBe(true)
    expect(cover(src, r)).toEqual(['name:name', 'mark::', 'name:list', 'mark::', 'mark:-', 'comment:# c', 'name:k', 'mark::', 'string:"q"'])
  })

  it('colour never changes what is on screen: every byte of the file is in the tokens, in order', () => {
    const src = `---\nname: s${cp(0x202e)}ediug\n---\n# T\n\n\`\`\`js\nconst a = "x${cp(0x200b)}y" // ${cp(0x0430)}\n\`\`\`\n`
    const r = highlight(src, 'markdown')
    const { lines } = tokenise(src, [], { scopes: r })
    const show = (ts: typeof lines[number]['tokens']): string => ts.map((t) => {
      switch (t.kind) {
        case 'text': case 'confusable': return t.text
        case 'escape': return t.label
        case 'ws': return t.mark
        case 'link': case 'comment': return show(t.tokens)
      }
    }).join('')
    const shown = lines.map((l) => show(l.tokens)).join('\n')
    // Text the same, escapes replaced by their labels — nothing dropped.
    expect(shown).toBe(src.replace(/\n$/, '').replace(cp(0x202e), 'U+202E').replace(cp(0x200b), 'U+200B'))
    // And the string is still a string on either side of its chip.
    const fenceLine = lines[6]!.tokens
    expect(fenceLine.filter((t) => t.kind === 'text' && t.scope === 'string').map((t) => (t.kind === 'text' ? t.text : ''))).toEqual(['"x', 'y"'])
  })

  it('a file over the limit is shown uncoloured, not stalled on', () => {
    expect(highlight('#'.repeat(HIGHLIGHT_LIMIT + 1), 'markdown')).toEqual([])
  })

  it('an empty file is no ranges for any language', () => {
    for (const lang of ['markdown', 'javascript', 'jsx', 'typescript', 'tsx', 'yaml'] as const) expect(highlight('', lang)).toEqual([])
  })
})

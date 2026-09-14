// reading/highlight.ts — colour over the source, never structure. docs/READING.md.
//
// The reader renders the source (READING.md, "source, not markdown"), and
// this pass changes nothing about that: it reads the file once through a
// Lezer parser and hands back RANGES — from, to, scope — that tokenise.ts
// lays over its text tokens as colour. Every byte is still on screen, every
// escape is still a chip, every link is still the exporter's offset. A
// parser's opinion can only tint a run; it cannot hide one, and it never
// produces markup: the tree is walked with highlightTree, whose callback is
// three numbers and a name, and nothing here touches the DOM.
//
// Lezer (@lezer/markdown, @lezer/javascript, @lezer/yaml) because it is the
// one highlighter that emits a tree rather than an HTML string, which is
// what "nothing here is ever set as HTML" (ui/ReadingPane.tsx) requires;
// its dependency closure is @lezer/common, @lezer/lr and @lezer/highlight,
// one maintainer, and nothing else.
//
// Pure: a string and a language in, sorted non-overlapping ranges out.

import type { Tree } from '@lezer/common'
import { highlightTree, styleTags, tagHighlighter, tags as t } from '@lezer/highlight'
import { parser as javascriptParser } from '@lezer/javascript'
import { GFM, parseCode, parser as markdownParser } from '@lezer/markdown'
import { parser as yamlParser } from '@lezer/yaml'

/**
 * What a run of text is, as far as colour goes. Deliberately few: the reader
 * has a colour budget (accent for links and the verdict, critical for
 * escapes, warning for findings and strings) and a scope is a claim on it.
 *
 *   keyword   the language's own words          (js: const, import, return)
 *   string    a quoted run — where an injected instruction lives in a script
 *   comment   a code comment; muted, never fainter than the code beside it
 *   literal   a number, boolean or null
 *   name      a property key, type or label      (yaml keys, js properties)
 *   mark      syntax that is not content: #, *, `, ```, ---, list markers
 *   emphasis  markdown *emphasis*
 *   strong    markdown **strong**
 *   code      markdown `inline code`
 */
export type Scope = 'keyword' | 'string' | 'comment' | 'literal' | 'name' | 'mark' | 'emphasis' | 'strong' | 'code'

export interface ScopeRange {
  from: number
  to: number
  scope: Scope
}

export type Language = 'markdown' | 'javascript' | 'jsx' | 'typescript' | 'tsx' | 'yaml'

/** The language a path is read as, by extension; null is "no colour". */
export function languageOf(path: string): Language | null {
  const ext = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase()
  switch (ext) {
    case 'md': case 'markdown': return 'markdown'
    case 'js': case 'mjs': case 'cjs': return 'javascript'
    case 'jsx': return 'jsx'
    case 'ts': case 'mts': case 'cts': return 'typescript'
    case 'tsx': return 'tsx'
    case 'yaml': case 'yml': return 'yaml'
    default: return null
  }
}

/**
 * Above this many characters the file is shown uncoloured. A full parse of
 * a multi-megabyte file on the main thread is a stall the reader would
 * rather name in the header than inflict.
 */
export const HIGHLIGHT_LIMIT = 1_000_000

// Tag → scope. A rule on a tag matches its sub-tags (controlKeyword is a
// keyword) and its modified forms match only when named (definition(
// variableName) is listed; a bare variableName is not, so an ordinary
// identifier stays the line's colour).
const SCOPES = tagHighlighter([
  { tag: t.keyword, class: 'keyword' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character, t.attributeValue], class: 'string' },
  { tag: t.comment, class: 'comment' },
  { tag: [t.number, t.bool, t.null, t.atom], class: 'literal' },
  { tag: [t.propertyName, t.typeName, t.className, t.labelName, t.definition(t.variableName)], class: 'name' },
  { tag: [t.processingInstruction, t.escape, t.contentSeparator, t.separator, t.meta], class: 'mark' },
  { tag: t.emphasis, class: 'emphasis' },
  { tag: t.strong, class: 'strong' },
  { tag: t.monospace, class: 'code' },
])

// Dialects are opt-in because each one changes what `<` means: JSX makes it
// a tag, TypeScript a type argument or cast. A file gets the dialect its
// extension promises and no other.
const jsxParser = javascriptParser.configure({ dialect: 'jsx' })
const typescriptParser = javascriptParser.configure({ dialect: 'ts' })
const tsxParser = javascriptParser.configure({ dialect: 'ts jsx' })

/** The language a fence's info string names, or null — a fence the reader shows as text. */
export function languageOfInfo(info: string): Language | null {
  switch (info.trim().split(/\s+/)[0]?.toLowerCase()) {
    case 'js': case 'javascript': case 'mjs': case 'cjs': return 'javascript'
    case 'jsx': return 'jsx'
    case 'ts': case 'typescript': return 'typescript'
    case 'tsx': return 'tsx'
    case 'yaml': case 'yml': return 'yaml'
    case 'md': case 'markdown': return 'markdown'
    default: return null
  }
}

// A fence's body is parsed as the language its info string names — never
// as markdown, which would nest without end.
function fenceParser(info: string) {
  const lang = languageOfInfo(info)
  return lang === null || lang === 'markdown' ? null : CODE_PARSER[lang]
}

const CODE_PARSER = {
  javascript: javascriptParser,
  jsx: jsxParser,
  typescript: typescriptParser,
  tsx: tsxParser,
  yaml: yamlParser,
} as const

// A fence's body is content, not inline code: the row already bands it
// (ui/ReadingPane.tsx), and a nested parser colours what it can. The
// upstream table styles CodeText as monospace alongside InlineCode; this
// re-props CodeText alone.
const markdownBody = markdownParser.configure([
  GFM,
  parseCode({ codeParser: fenceParser }),
  { props: [styleTags({ CodeText: t.content })] },
])

const PARSER = { ...CODE_PARSER, markdown: markdownBody } as const

/** The markdown body (after any front matter) as a tree — reading/render.ts walks it. */
export function parseMarkdown(body: string): Tree {
  return markdownBody.parse(body)
}

// One parse, offsets shifted by `base` so a part of a file lands where it
// sits in the whole. The last class on a range is the innermost node's —
// an EmphasisMark inside Emphasis is "emphasis mark" — and that is the one
// that colours.
function ranges(source: string, lang: Language, base: number, out: ScopeRange[]): void {
  if (source.length === 0) return
  const tree = PARSER[lang].parse(source)
  highlightTree(tree, SCOPES, (from, to, classes) => {
    const scope = classes.slice(classes.lastIndexOf(' ') + 1) as Scope
    out.push({ from: base + from, to: base + to, scope })
  })
}

/**
 * Where a markdown file's front matter is, by the rule tokenise.ts classes
 * lines by: it opens if line 1 is `---` and closes at the next `---` line,
 * or runs to the end of the file if none. The markdown parser does not know
 * front matter — it would read `name: x` over `---` as a setext heading —
 * so the block is parsed as YAML and the body as markdown, separately.
 * Null when there is none.
 */
export interface FrontMatter {
  /** The YAML between the fences, as offsets into the file. */
  yamlFrom: number
  yamlTo: number
  /** Offset of the closing `---`, or null when it never closes. */
  close: number | null
  /** Where the markdown body starts; the file's length when there is none. */
  bodyStart: number
}

export function frontMatter(content: string): FrontMatter | null {
  // Exactly `---`, as tokenise.ts asks: a `---\r` line in a CRLF file is
  // not front matter there, so it is not front matter here.
  if (!(content === '---' || content.startsWith('---\n'))) return null
  const firstEnd = content.indexOf('\n')
  if (firstEnd === -1) return { yamlFrom: content.length, yamlTo: content.length, close: null, bodyStart: content.length }
  const yamlFrom = firstEnd + 1
  const m = /^---$/m.exec(content.slice(yamlFrom))
  if (!m) return { yamlFrom, yamlTo: content.length, close: null, bodyStart: content.length }
  const close = yamlFrom + m.index
  const closeEnd = close + m[0].length
  const bodyStart = closeEnd < content.length ? closeEnd + 1 : content.length
  return { yamlFrom, yamlTo: close, close, bodyStart }
}

/** Colour for a file: sorted, non-overlapping ranges over `content`, or none. */
export function highlight(content: string, lang: Language | null): ScopeRange[] {
  if (lang === null || content.length > HIGHLIGHT_LIMIT) return []
  const out: ScopeRange[] = []
  const fm = lang === 'markdown' ? frontMatter(content) : null
  if (fm) {
    out.push({ from: 0, to: 3, scope: 'mark' })
    ranges(content.slice(fm.yamlFrom, fm.yamlTo), 'yaml', fm.yamlFrom, out)
    if (fm.close !== null) out.push({ from: fm.close, to: fm.close + 3, scope: 'mark' })
    ranges(content.slice(fm.bodyStart), 'markdown', fm.bodyStart, out)
  } else {
    ranges(content, lang, 0, out)
  }
  // highlightTree emits in order within one parse; two parses are appended
  // in order too, but the contract is sorted and the sort is cheap.
  out.sort((a, b) => a.from - b.from)
  return out
}

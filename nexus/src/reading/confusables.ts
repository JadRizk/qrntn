// The scanner's confusables table, restated for the reader.
//
// commands/audit-skill.mjs owns this list and is a script, not a module — it
// runs on import — so the reader cannot import it. Restating a table is the
// drift SHIPPING.md §8 warns about, so confusables.agreement.test.ts rebuilds
// the scanner's map from the scanner's own source text and asserts the two
// are equal: a code point added there and not here fails the build.
//
// Built from code points rather than written as literals, for the scanner's
// own reason: this file must contain no homoglyphs of its own, and a reviewer
// can check each entry by number. Explicit and finite: a character outside
// this table is rendered as it is and counted as non-ASCII, not flagged.

export const CONFUSABLES: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>()
  const confusable = (ascii: string, ...codePoints: number[]) => {
    for (const cp of codePoints) map.set(String.fromCodePoint(cp), ascii)
  }
  // Cyrillic, Greek and a few Latin/Armenian lookalikes (UTR #39 subset).
  confusable('a', 0x0430, 0x03b1, 0x0251)
  confusable('c', 0x0441, 0x03f2)
  confusable('d', 0x0501)
  confusable('e', 0x0435, 0x04bd, 0x212e)
  confusable('g', 0x0261)
  confusable('h', 0x04bb)
  confusable('i', 0x0456, 0x0131, 0x03b9)
  confusable('j', 0x0458)
  confusable('l', 0x04cf)
  confusable('o', 0x043e, 0x03bf, 0x0585)
  confusable('p', 0x0440, 0x03c1)
  confusable('q', 0x051b)
  confusable('s', 0x0455)
  confusable('v', 0x03bd, 0x0475)
  confusable('w', 0x051d)
  confusable('x', 0x0445, 0x03c7)
  confusable('y', 0x0443)
  confusable('A', 0x0410, 0x0391)
  confusable('B', 0x0412, 0x0392)
  confusable('C', 0x0421, 0x03f9)
  confusable('E', 0x0415, 0x0395)
  confusable('H', 0x041d, 0x0397)
  confusable('I', 0x0406, 0x0399)
  confusable('J', 0x0408)
  confusable('K', 0x041a, 0x039a)
  confusable('M', 0x041c, 0x039c)
  confusable('N', 0x039d)
  confusable('O', 0x041e, 0x039f)
  confusable('P', 0x0420, 0x03a1)
  confusable('S', 0x0405)
  confusable('T', 0x0422, 0x03a4)
  confusable('X', 0x0425, 0x03a7)
  confusable('Y', 0x04ae, 0x03a5)
  confusable('Z', 0x0396)
  // Fullwidth forms map one-to-one onto ASCII.
  for (let i = 0; i < 26; i++) {
    confusable(String.fromCharCode(65 + i), 0xff21 + i)
    confusable(String.fromCharCode(97 + i), 0xff41 + i)
  }
  for (let i = 0; i < 10; i++) confusable(String(i), 0xff10 + i)
  return map
})()

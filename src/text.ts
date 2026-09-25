// Text as names, titles and messages are stored and shown: Unicode
// normalisation, spaces, and cutting between characters.

/** The form names and titles are stored in; use it for lookups too. */
export function normalizeName(s: string): string {
  return s.trim().normalize("NFC");
}

/**
 * Runs of spaces, including no-break and other typographic spaces, as one
 * plain space: "a b", "a\u00A0b" and "a  b" look the same in every table.
 */
export function collapseSpaces(s: string): string {
  return s.replace(/[ \u00A0\u2000-\u200A\u202F\u205F]+/g, " ");
}

/** Whitespace alone (as JavaScript's trim() sees it) is no description */
export const isBlank = (s: string): boolean => s.trim() === "";

const graphemes = new Intl.Segmenter();

/**
 * At most `max` UTF-16 units of s (the unit lengths are counted in), cut
 * between user-perceived characters: a plain slice can cut an emoji in half,
 * a flag into one regional indicator, or a family 👨‍👩‍👧 after a joiner.
 */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  let end = 0;
  for (const { index, segment } of graphemes.segment(s)) {
    if (index + segment.length > max) break;
    end = index + segment.length;
  }
  return s.slice(0, end);
}

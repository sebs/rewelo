// Terminal columns a string occupies: wide East Asian characters and emoji
// take two, combining marks none. padEnd counts UTF-16 units instead, which
// misaligned tables containing e.g. Japanese titles.
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{20000}-\u{3FFFD}]/u;
const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}]+$/u;
// Emoji shown as pictures: those presented as emoji by default (🚀), text
// symbols turned into emoji by U+FE0F (❤️), and flags (pairs of regional
// indicators).
const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️|\p{Regional_Indicator}/u;

const graphemes = new Intl.Segmenter();

// Measured per grapheme cluster, so a ZWJ sequence such as 👨‍👩‍👧 counts
// as the one two-column picture it is rendered as.
export function displayWidth(s: string): number {
  // Printable ASCII, most table cells, is one column per character: skip the
  // segmenter (it made a 30,000-ticket table take 1.3 s and ~900 MB)
  if (/^[\x20-\x7e]*$/.test(s)) return s.length;
  let width = 0;
  for (const { segment } of graphemes.segment(s)) {
    if (ZERO_WIDTH.test(segment)) continue;
    width += EMOJI.test(segment) || WIDE.test(segment) ? 2 : 1;
  }
  return width;
}

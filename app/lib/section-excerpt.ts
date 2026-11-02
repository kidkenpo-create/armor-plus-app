/**
 * Section-targeted extraction for retrieved regulatory text.
 *
 * acquisition.gov RFO FAR part pages open with a table of contents that
 * lists every section number before the body text begins. Taking the
 * first occurrence of a section number (the old approach) therefore
 * returns TOC lines instead of the operative paragraphs. These helpers
 * locate the BODY occurrence of a cited section and window around it.
 *
 * Pure functions only — no imports — so unit tests can transpile and
 * exercise this module standalone.
 */

export interface SectionCitation {
  /** FAR/DFARS part the citation belongs to, e.g. "17" or "217". */
  part: string;
  /** Full section citation, e.g. "17.104-3" or "237.873-3". */
  section: string;
}

export interface SectionWindow {
  /** Character offset of the body heading in the source text. */
  start: number;
  /** Excerpt beginning at the body heading, including its paragraphs. */
  excerpt: string;
}

const SECTION_CITATION_RE = /\b(\d{1,3})\.(\d{1,3}(?:-\d+)?)\b/g;

/**
 * Extract full section citations (part.section[-subsection]) from a
 * question, e.g. "under FAR 17.104-3" -> [{ part: "17", section: "17.104-3" }].
 * A bare "17.104" yields section "17.104". Word-like decimals are not
 * expected in acquisition questions; matches are deduped by section.
 */
export function extractSectionCitations(question: string): SectionCitation[] {
  const citations: SectionCitation[] = [];
  const seen = new Set<string>();
  for (const match of question.matchAll(SECTION_CITATION_RE)) {
    const section = `${match[1]}.${match[2]}`;
    if (seen.has(section)) continue;
    seen.add(section);
    citations.push({ part: match[1], section });
  }
  return citations;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find the operative body window for a section inside normalized
 * (single-spaced) retrieved text.
 *
 * A candidate occurrence counts as the body heading when a paragraph
 * marker "(a)" appears shortly after it AND no other section number
 * intervenes first — TOC entries are always followed immediately by the
 * next section number, body headings by their paragraph text. If no
 * candidate qualifies (e.g. a section with no lettered paragraphs),
 * the last occurrence is used, since the body follows the TOC.
 *
 * The excerpt runs from the body heading until the next section heading
 * or `maxChars`, whichever comes first.
 */
export function findSectionWindow(text: string, section: string, maxChars = 3600): SectionWindow | null {
  const sectionRe = new RegExp(`\\b${escapeRegExp(section)}(?!\\d|-\\d)`, 'g');
  const starts: number[] = [];
  for (const match of text.matchAll(sectionRe)) {
    if (typeof match.index === 'number') starts.push(match.index);
  }
  if (!starts.length) return null;

  const otherSectionRe = /\b\d{1,3}\.\d{1,3}(?:-\d+)?\b/;

  let bodyStart: number | null = null;
  for (const start of starts) {
    const after = text.slice(start + section.length, start + section.length + 600);
    const paragraphIdx = after.search(/\(a\)/);
    if (paragraphIdx === -1) continue;
    const intervening = after.slice(0, paragraphIdx).match(otherSectionRe);
    if (!intervening) {
      bodyStart = start;
      break;
    }
  }
  if (bodyStart === null) bodyStart = starts[starts.length - 1];

  const rest = text.slice(bodyStart);
  const headingRe = new RegExp(`\\.\\s\\d{1,3}\\.\\d{1,3}(?:-\\d+)?\\s+[A-Z]`, 'g');
  headingRe.lastIndex = Math.min(section.length + 40, rest.length);
  const next = headingRe.exec(rest);
  const end = next ? Math.min(next.index + 1, maxChars) : Math.min(rest.length, maxChars);
  return { start: bodyStart, excerpt: rest.slice(0, end).trim() };
}

/**
 * Remove C0 control characters (except tab/newline/carriage return,
 * which the normalizer collapses as whitespace). Text extracted from
 * PDFs with broken font encodings can carry raw control bytes that
 * render as garbage in evidence excerpts and model context; they are
 * never meaningful regulatory text.
 */
export function stripControlCharacters(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ');
}

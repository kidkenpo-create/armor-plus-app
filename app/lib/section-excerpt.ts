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

export interface ParsedCitation {
  kind: 'rfo_far' | 'dfars_rfo' | 'dfars_pgi';
  /** FAR/DFARS part the citation belongs to, e.g. "17" or "217". */
  part: string;
  /** Section token only (paragraph suffix dropped), e.g. "217.104-370". */
  section: string;
}

const PREFIXED_CITATION_RE = /(DFARS\s+RFO\s+PGI|DFARS\s+RFO|DFARS|RFO\s+FAR|FAR)\s+(\d{1,3})\.(\d{1,3}(?:-\d+)?)\b/gi;

/**
 * Parse authority-prefixed citation strings — the form used by the
 * rule tables' expectedCitations / targetCitation fields, e.g.
 * "DFARS RFO 217.104-370(b)(1)(iv)", "DFARS RFO PGI 207.104-70(b)",
 * "RFO FAR 17.104-3(a)", "DFARS 252.225-7976", or a combined
 * "RFO FAR 27.400 / DFARS RFO 227.400". Only the section token is
 * kept; paragraph suffixes are dropped. Strings that name no
 * FAR/DFARS section (e.g. "DoD Instruction 1100.22", "CD 2021-O0008")
 * return an empty array.
 */
export function parsePrefixedCitations(citation: string): ParsedCitation[] {
  const results: ParsedCitation[] = [];
  for (const match of citation.matchAll(PREFIXED_CITATION_RE)) {
    const prefix = match[1].toUpperCase().replace(/\s+/g, ' ');
    const kind: ParsedCitation['kind'] = prefix.includes('PGI')
      ? 'dfars_pgi'
      : prefix.startsWith('DFARS')
        ? 'dfars_rfo'
        : 'rfo_far';
    results.push({ kind, part: match[2], section: `${match[2]}.${match[3]}` });
  }
  return results;
}

const DFARS_ADDED_SUFFIXES = ['370', '70', '170', '270'];

/**
 * Candidate DFARS sections corresponding to a FAR section citation.
 *
 * DFARS implements a FAR section either under the same section number
 * in the 2xx part (FAR 12.102 -> DFARS 212.102) or under a DFARS-added
 * section whose trailing number is replaced by the -70 family
 * (FAR 17.104-3 -> DFARS 217.104-370). Which form a given part uses is
 * only knowable from the DFARS text itself, so callers attach these as
 * candidates and extraction uses the first candidate that actually
 * exists in the fetched text. Returns [] for a citation that is
 * already a DFARS (2xx) part.
 */
export function dfarsSectionCandidates(citation: SectionCitation): string[] {
  const { part, section } = citation;
  if (part.length === 3 && part.startsWith('2')) return [];
  const dfarsPart = `2${part.padStart(2, '0')}`;
  const rest = section.slice(part.length + 1);
  const candidates = [`${dfarsPart}.${rest}`];
  const dash = rest.lastIndexOf('-');
  if (dash > 0) {
    const stem = rest.slice(0, dash);
    for (const suffix of DFARS_ADDED_SUFFIXES) candidates.push(`${dfarsPart}.${stem}-${suffix}`);
  } else {
    for (const suffix of DFARS_ADDED_SUFFIXES) candidates.push(`${dfarsPart}.${rest}-${suffix}`);
  }
  return [...new Set(candidates)];
}

/**
 * Find the operative body window for a section inside normalized
 * (single-spaced) retrieved text.
 *
 * Occurrences immediately followed by "(" are pinpoint paragraph
 * references inside running text, never headings, and are excluded
 * outright. A remaining candidate counts as the body heading when a
 * first-paragraph marker — "(a)" or "(1)", since DFARS sections often
 * use numbered paragraphs — appears shortly after it AND no other
 * section number intervenes first: TOC entries are always followed
 * immediately by the next section number, body headings by their
 * paragraph text. If no candidate qualifies, the last remaining
 * occurrence is used, since the body follows the TOC.
 *
 * The excerpt runs from the body heading until the next section heading
 * or `maxChars`, whichever comes first.
 */
export function findSectionWindow(text: string, section: string, maxChars = 3600): SectionWindow | null {
  const sectionRe = new RegExp(`\\b${escapeRegExp(section)}(?!\\d|-\\d)`, 'g');
  const starts: number[] = [];
  for (const match of text.matchAll(sectionRe)) {
    if (typeof match.index !== 'number') continue;
    // A token immediately followed by "(" is a pinpoint paragraph
    // reference inside running text ("As prescribed in 246.710(2)..."),
    // never a heading.
    if (text[match.index + section.length] === '(') continue;
    starts.push(match.index);
  }
  if (!starts.length) return null;

  const otherSectionRe = /\b\d{1,3}\.\d{1,3}(?:-\d+)?\b/;

  let bodyStart: number | null = null;
  for (const start of starts) {
    const after = text.slice(start + section.length, start + section.length + 600);
    const paragraphIdx = after.search(/\((?:a|1)\)/);
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

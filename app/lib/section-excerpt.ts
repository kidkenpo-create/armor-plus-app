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
  /** Pinpoint paragraph chain when the citation carries one,
   * e.g. "(b)" or "(b)(1)(iv)". Absent when the citation names only
   * the section. */
  paragraph?: string;
}

export interface SectionWindow {
  /** Character offset of the body heading in the source text. */
  start: number;
  /** Excerpt beginning at the body heading, including its paragraphs. */
  excerpt: string;
}

const SECTION_CITATION_RE = /\b(\d{1,3})\.(\d{1,3}(?:-\d+)?)((?:\([a-z0-9]+\))*)/g;

/**
 * Extract full section citations (part.section[-subsection]) from a
 * question, e.g. "under FAR 17.104-3" -> [{ part: "17", section: "17.104-3" }].
 * A bare "17.104" yields section "17.104". A trailing pinpoint
 * paragraph chain is captured when present ("1.107(b)" ->
 * paragraph "(b)"). Word-like decimals are not expected in
 * acquisition questions; matches are deduped by section.
 */
export function extractSectionCitations(question: string): SectionCitation[] {
  const citations: SectionCitation[] = [];
  const seen = new Set<string>();
  for (const match of question.matchAll(SECTION_CITATION_RE)) {
    const section = `${match[1]}.${match[2]}`;
    if (seen.has(section)) continue;
    seen.add(section);
    const citation: SectionCitation = { part: match[1], section };
    if (match[3]) citation.paragraph = match[3];
    citations.push(citation);
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

export interface ParsedCitationTarget extends ParsedCitation {
  /** Pinpoint paragraph chain when the citation carries one,
   * e.g. "(b)" or "(b)(1)(iv)". Absent when none is present. */
  paragraph?: string;
}

const PREFIXED_CITATION_RE = /(DFARS\s+RFO\s+PGI|DFARS\s+RFO|DFARS|RFO\s+FAR|FAR)\s+(\d{1,3})\.(\d{1,3}(?:-\d+)?)((?:\([a-z0-9]+\))*)/gi;

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
  return parsePrefixedCitationTargets(citation).map(({ kind, part, section }) => ({ kind, part, section }));
}

/**
 * Like parsePrefixedCitations, but each result also carries the
 * pinpoint paragraph chain when the citation names one, so routing
 * can target the exact paragraph (e.g. RFO FAR 1.107(b) delegation)
 * instead of the whole section.
 */
export function parsePrefixedCitationTargets(citation: string): ParsedCitationTarget[] {
  const results: ParsedCitationTarget[] = [];
  for (const match of citation.matchAll(PREFIXED_CITATION_RE)) {
    const prefix = match[1].toUpperCase().replace(/\s+/g, ' ');
    const kind: ParsedCitationTarget['kind'] = prefix.includes('PGI')
      ? 'dfars_pgi'
      : prefix.startsWith('DFARS')
        ? 'dfars_rfo'
        : 'rfo_far';
    const target: ParsedCitationTarget = { kind, part: match[2], section: `${match[2]}.${match[3]}` };
    if (match[4]) target.paragraph = match[4];
    results.push(target);
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

export interface ParagraphWindow {
  /** Character offset of the paragraph marker inside the excerpt. */
  start: number;
  /** Section heading followed by the targeted paragraph text. */
  excerpt: string;
}

/**
 * Pinpoint one paragraph inside a section window.
 *
 * Section targeting (round 2) lands the model in the right section,
 * but a pinpoint citation like RFO FAR 1.107(b) is about ONE
 * paragraph: the old whole-section excerpt could lead with paragraph
 * (a) and crowd the cited paragraph out of the trim budget. Given a
 * section window excerpt and a paragraph chain ("(b)", "(a)(1)",
 * "(b)(1)(iv)"), locate the first-level paragraph marker at a
 * paragraph boundary inside the window, then walk any deeper groups
 * in the chain. The returned excerpt keeps the section heading for
 * context, marks the elision, and continues from the paragraph.
 * Returns null when the paragraph does not appear as a paragraph
 * start in the window (an in-text reference like "paragraph (b) of
 * this section" does not count — the marker must begin a paragraph,
 * i.e. follow the heading or a sentence end), so callers fall back
 * to the whole-section window instead of a wrong pinpoint.
 */
export function findParagraphWindow(windowExcerpt: string, paragraph: string, maxChars = 1800): ParagraphWindow | null {
  const groups = paragraph.match(/\(([a-z0-9]+)\)/g);
  if (!groups?.length) return null;

  // The heading prefix: everything before the first paragraph marker
  // in the window (e.g. "1.107 FAR conventions.").
  const firstMarker = windowExcerpt.search(/\([a-z0-9]\)\s/);
  const heading = firstMarker > 0 ? windowExcerpt.slice(0, firstMarker).trim() : '';

  let searchFrom = Math.max(0, firstMarker);
  let start = -1;
  for (let depth = 0; depth < groups.length; depth += 1) {
    const marker = groups[depth];
    const markerRe = new RegExp(`(^|[.!?]\\s)${escapeRegExp(marker)}(?=[\\s.])`, 'g');
    markerRe.lastIndex = searchFrom;
    const match = markerRe.exec(windowExcerpt);
    if (!match) {
      // A deeper group that never appears as a paragraph start does
      // not invalidate the levels already located.
      if (depth === 0) return null;
      break;
    }
    start = match.index + match[1].length;
    searchFrom = start + marker.length;
  }
  if (start === -1) return null;

  const body = windowExcerpt.slice(start, start + maxChars).trim();
  const excerpt = heading ? `${heading} ... ${body}` : body;
  return { start, excerpt };
}

const DEVIATION_ID_RE = /\b(\d{4}-O\d{4})\b/g;

/**
 * Extract DoD class-deviation numbers ("2021-O0008") from a question
 * or a rule-table string (e.g. "CD 2021-O0008 Revision 1"). Deduped,
 * in order of appearance.
 */
export function extractDeviationIds(text: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(DEVIATION_ID_RE)) {
    if (seen.has(match[1])) continue;
    seen.add(match[1]);
    ids.push(match[1]);
  }
  return ids;
}

export interface DeviationWindow {
  /** Character offset of the deviation's memo block in the mirror. */
  start: number;
  /** Window from the memo block through the deviation attachment. */
  excerpt: string;
}

/**
 * Find one class deviation's operative text inside the approved
 * FY26 deviations mirror.
 *
 * The mirror concatenates every current deviation: an up-front
 * enumeration list (which mentions each deviation number) followed
 * by each deviation's memo and attachment, newest first. A specific
 * deviation's text can sit hundreds of thousands of characters in,
 * far past any head-based trim — the enumeration hit must therefore
 * never win. The body anchor is the deviation's own "DARS Tracking
 * Number: <id>" memo line; failing that, its "Attachment ... Class
 * Deviation <id>" heading; failing that, the last occurrence of the
 * number. The window runs until the next deviation's tracking-number
 * line or `maxChars`, whichever comes first.
 */
export function findDeviationWindow(text: string, deviationId: string, maxChars = 24000): DeviationWindow | null {
  const trackingNeedle = `DARS Tracking Number: ${deviationId}`;
  let start = text.indexOf(trackingNeedle);
  if (start === -1) {
    const attachmentRe = new RegExp(`Attachment[^.]{0,120}Class Deviation ${escapeRegExp(deviationId)}`, 'i');
    const attachment = attachmentRe.exec(text);
    if (attachment) start = attachment.index;
  }
  if (start === -1) {
    const last = text.lastIndexOf(deviationId);
    if (last === -1) return null;
    start = last;
  }

  const rest = text.slice(start);
  const next = rest.indexOf('DARS Tracking Number:', Math.max(trackingNeedle.length, 1));
  const end = next > 0 ? Math.min(next, maxChars) : Math.min(rest.length, maxChars);
  return { start, excerpt: rest.slice(0, end).trim() };
}

export interface ClausePrescription {
  /** DFARS section that prescribes the clause, e.g. "205.701". */
  section: string;
  /** Window of the prescription section inside the DFARS part text. */
  window: SectionWindow;
}

/**
 * Resolve the DFARS prescription for a cited clause (252.x).
 *
 * A question that cites a DFARS clause ("is 252.205-7000 required?")
 * is answered by the clause's PRESCRIPTION paragraph in the DFARS
 * part text, not by the clause text itself. The clause block names
 * its own prescription ("As prescribed in 205.701, insert the
 * following clause:"), so: locate the clause block, read the
 * prescription section out of it, and window that section. Falls
 * back to a prescription-sentence occurrence ("Insert the clause at
 * 252.205-7000...") when the clause block carries no "As prescribed
 * in" line. Returns null when neither resolves.
 */
export function findClausePrescription(text: string, clause: string): ClausePrescription | null {
  const clauseRe = new RegExp(`\\b${escapeRegExp(clause)}\\b`, 'g');
  for (const match of text.matchAll(clauseRe)) {
    if (typeof match.index !== 'number') continue;
    const after = text.slice(match.index, match.index + 400);
    const prescribed = after.match(/\bAs prescribed in (\d{1,3}\.\d{1,3}(?:-\d+)?)/);
    if (prescribed) {
      const section = prescribed[1];
      // Prefer the prescription section's own heading occurrence —
      // the one whose text actually prescribes this clause.
      // Prescription paragraphs often have no lettered subparagraphs
      // for findSectionWindow's body test to lock onto, and the
      // section number also recurs inside the clause block itself
      // ("As prescribed in 205.701, insert the following clause:"),
      // which is a reference, not the prescription.
      const headingRe = new RegExp(`\\b${escapeRegExp(section)}\\b`, 'g');
      for (const occurrence of text.matchAll(headingRe)) {
        if (typeof occurrence.index !== 'number') continue;
        const following = text.slice(occurrence.index, occurrence.index + 500);
        if (
          following.includes(`Insert the clause at ${clause}`)
          || following.includes(`Insert a clause substantially the same as the clause at ${clause}`)
          || following.includes(`Use the clause at ${clause}`)
        ) {
          return {
            section,
            window: { start: occurrence.index, excerpt: text.slice(occurrence.index, occurrence.index + 1600).trim() },
          };
        }
      }
      const window = findSectionWindow(text, section);
      if (window) return { section, window };
    }
  }

  const insertRe = new RegExp(`(Insert|Use) (the|a) clause( substantially the same as the clause)? at ${escapeRegExp(clause)}\\b`, 'i');
  const insert = insertRe.exec(text);
  if (insert && typeof insert.index === 'number') {
    // Back up to the start of the prescription sentence's section
    // heading: the last "NNN.NNN" heading before the match.
    const head = text.slice(Math.max(0, insert.index - 300), insert.index);
    const headingMatch = [...head.matchAll(/\b(\d{1,3}\.\d{1,3}(?:-\d+)?)\s+[A-Z]/g)].pop();
    if (headingMatch) {
      const window = findSectionWindow(text, headingMatch[1]);
      if (window) return { section: headingMatch[1], window };
    }
    return {
      section: '',
      window: { start: insert.index, excerpt: text.slice(insert.index, insert.index + 1600).trim() },
    };
  }

  return null;
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

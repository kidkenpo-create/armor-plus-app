export interface ParsedOutput {
  bluf: string | null;
  steps: Array<{ num: string; title: string; content: string }>;
}

export type BlufTone = 'def' | 'cond' | 'nd' | 'unknown';

/**
 * Classify the determination label in a BLUF string.
 * Order matters: "Non-Definitive" contains "Definitive", so it is
 * checked first. An unlabeled BLUF is 'unknown' — never Definitive.
 */
export function blufTone(content: string): BlufTone {
  const lower = content.toLowerCase();
  if (lower.includes('non-definitive') || lower.includes('non definitive')) return 'nd';
  if (lower.includes('conditional')) return 'cond';
  if (lower.includes('definitive')) return 'def';
  return 'unknown';
}

export const DEFINITIVE_GUARD_NOTE =
  '[ARMOR guard: downgraded from Definitive — no approved controlling source text was retrieved for this answer, and a Definitive BLUF requires retrieved controlling approved text.]';

/**
 * Deterministic BLUF integrity guard.
 * When no approved controlling source was retrieved, a BLUF that claims
 * "Definitive" (standalone, not "Non-Definitive") is rewritten to
 * "Non-Definitive" and annotated. All other outputs pass through
 * unchanged, as does any output when approved text was retrieved.
 */
export function enforceDefinitiveGuard(rawOutput: string, hasApprovedControllingSource: boolean): string {
  if (hasApprovedControllingSource) return rawOutput;

  // Only consider the BLUF segment (up to STEP 1 or end of text).
  const blufEnd = rawOutput.search(/\n\s*STEP\s+1\s*[-:]/i);
  const head = blufEnd === -1 ? rawOutput : rawOutput.slice(0, blufEnd);
  const tail = blufEnd === -1 ? '' : rawOutput.slice(blufEnd);
  if (!/bluf/i.test(head)) return rawOutput;
  if (blufTone(head) !== 'def') return rawOutput;

  const rewrittenHead = head.replace(/(non[-\s])?definitive/i, match =>
    /^non/i.test(match) ? match : 'Non-Definitive',
  );
  if (rewrittenHead === head) return rawOutput;
  return `${rewrittenHead}\n${DEFINITIVE_GUARD_NOTE}${tail}`;
}

export function parseArmorOutput(raw: string): ParsedOutput {
  return parseArmorInternal(raw, false);
}

/**
 * Markup-preserving variant of parseArmorOutput. Identical structure, but
 * `**bold**` spans in BLUF / STEP content are kept as \u0001/\u0002 sentinel
 * pairs so the rich renderer (parseRichContent) can render real bold
 * instead of the markers being stripped. Structural parsing (BLUF tone,
 * the integrity guard, storage) keeps using parseArmorOutput.
 */
export function parseArmorOutputRich(raw: string): ParsedOutput {
  return parseArmorInternal(raw, true);
}

const BOLD_OPEN = '\u0001';
const BOLD_CLOSE = '\u0002';

function parseArmorInternal(raw: string, preserveMarkup: boolean): ParsedOutput {
  const text = preserveMarkup
    ? raw.replace(/\*\*([^*]+)\*\*/g, `${BOLD_OPEN}$1${BOLD_CLOSE}`)
    : raw.replace(/\*\*/g, '');
  const result: ParsedOutput = { bluf: null, steps: [] };
  const bluf = text.match(new RegExp(`(?:^|\\n)${BOLD_OPEN}?0\\)\\s*BLUF\\s*[-:]\\s*([\\s\\S]*?)(?=\\nSTEP\\s+1\\s*[-:]|\\n\\nSTEP\\s+1\\s*[-:]|$)`,'i'));
  if (bluf) result.bluf = bluf[1].trim();

  const stepHeader = new RegExp(`^[ \\t${BOLD_OPEN}]*STEP[ \\t]+(\\d+[AB]?)(?:[ \\t]*--[ \\t]*|[ \\t]*[-:][ \\t]*)(.*)$`, 'gim');
  const matches = [...text.matchAll(stepHeader)];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const next = matches[index + 1];
    const num = match[1];
    const headerText = match[2].trim();
    const lineEnd = text.indexOf('\n', match.index || 0);
    const bodyStart = lineEnd === -1 ? text.length : lineEnd + 1;
    const bodyEnd = next?.index ?? text.length;
    const body = text.slice(bodyStart, bodyEnd).trim();
    const { title, inlineContent } = splitStepHeader(headerText);
    const content = [inlineContent, body].filter(Boolean).join(body ? '\n\n' : '').trim();

    if (content) result.steps.push({ num, title, content });
  }

  return result;
}

function splitStepHeader(headerText: string) {
  const colon = headerText.indexOf(':');
  if (colon === -1) return { title: stripBoldSentinels(headerText), inlineContent: '' };

  return {
    title: stripBoldSentinels(headerText.slice(0, colon).trim()),
    inlineContent: headerText.slice(colon + 1).trim(),
  };
}

function stripBoldSentinels(value: string) {
  return value.replace(/[\u0001\u0002]/g, '');
}

/* ------------------------------------------------------------------ */
/* Rich content parsing (Modern Refresh, Tier 2 #1)                    */
/*                                                                     */
/* Converts BLUF / STEP / follow-up plain text into renderable blocks: */
/* paragraphs and lists of inline segments, where a segment is plain   */
/* text, or a citation that the UI renders as a numbered chip carrying */
/* its authority class. Bold comes from `**...**` markers in raw text  */
/* or the \u0001/\u0002 sentinels produced by parseArmorOutputRich.    */
/* ------------------------------------------------------------------ */

export type CitationClass = 'controlling' | 'dfars-overlay' | 'pgi' | 'deviation' | 'clause';

export interface CitationRef {
  /** The citation exactly as written in the answer text. */
  raw: string;
  /** Normalized dedupe key: section digits + paragraphs, or deviation id. */
  key: string;
  /** FAR/DFARS part number ('17', '217', '52'), or null for deviations. */
  part: string | null;
  citeClass: CitationClass;
}

export interface InlineSegment {
  kind: 'text' | 'citation';
  text: string;
  bold: boolean;
  citation?: CitationRef;
}

export interface RichBlock {
  type: 'paragraph' | 'list';
  ordered: boolean;
  /** Paragraph: one entry per source line. List: one entry per item. */
  items: InlineSegment[][];
}

const CITATION_PATTERN =
  '(?:\\b(DFARS\\s+RFO\\s+PGI|DFARS\\s+PGI|PGI|DFARS\\s+RFO|RFO\\s+FAR|DFARS|FAR)\\s+)?(\\d{1,3})\\.(\\d{3})(-\\d+)?(?![0-9])((?:\\s*\\([a-zA-Z0-9]+\\))*)'
  + '|\\b(?:class\\s+deviation|deviation|cd)\\s+(\\d{4}-O\\d{4})\\b'
  + '|\\b(\\d{4}-O\\d{4})\\b';

function citationClassFor(prefix: string | undefined, part: string): CitationClass {
  // FAR Part 52 / DFARS Part 252 citations are clause citations, whatever
  // prefix the sentence used.
  if (part === '52' || part === '252') return 'clause';
  const normalized = (prefix || '').toUpperCase().replace(/\s+/g, ' ');
  if (normalized.includes('PGI')) return 'pgi';
  if (normalized.includes('DFARS')) return 'dfars-overlay';
  if (normalized.includes('FAR')) return 'controlling';
  // Bare section: a three-digit part in the 2xx range is a DFARS part.
  if (part.length === 3 && part.startsWith('2')) return 'dfars-overlay';
  return 'controlling';
}

export function extractCitations(text: string): CitationRef[] {
  const regex = new RegExp(CITATION_PATTERN, 'gi');
  const refs: CitationRef[] = [];
  for (const match of text.matchAll(regex)) {
    const deviationId = match[6] || match[7];
    if (deviationId) {
      refs.push({ raw: match[0], key: deviationId.toLowerCase(), part: null, citeClass: 'deviation' });
      continue;
    }
    const part = match[2];
    const section = `${part}.${match[3]}${match[4] || ''}`;
    const parens = (match[5] || '').replace(/\s+/g, '');
    refs.push({
      raw: match[0],
      key: `${section}${parens}`.toLowerCase(),
      part,
      citeClass: citationClassFor(match[1], part),
    });
  }
  return refs;
}

function pushInlineSegments(out: InlineSegment[], text: string, bold: boolean) {
  const regex = new RegExp(CITATION_PATTERN, 'gi');
  let lastIndex = 0;
  for (const match of text.matchAll(regex)) {
    const start = match.index || 0;
    if (start > lastIndex) out.push({ kind: 'text', text: text.slice(lastIndex, start), bold });
    const deviationId = match[6] || match[7];
    const part = deviationId ? null : match[2];
    out.push({
      kind: 'citation',
      text: match[0],
      bold,
      citation: deviationId
        ? { raw: match[0], key: deviationId.toLowerCase(), part: null, citeClass: 'deviation' }
        : {
            raw: match[0],
            key: `${part}.${match[3]}${match[4] || ''}${(match[5] || '').replace(/\s+/g, '')}`.toLowerCase(),
            part,
            citeClass: citationClassFor(match[1], part as string),
          },
    });
    lastIndex = start + match[0].length;
  }
  if (lastIndex < text.length) out.push({ kind: 'text', text: text.slice(lastIndex), bold });
}

/** Parse one line of answer text into inline segments (bold + citations). */
export function parseInline(text: string): InlineSegment[] {
  const normalized = text.replace(/\*\*([^*]+)\*\*/g, `${BOLD_OPEN}$1${BOLD_CLOSE}`);
  const segments: InlineSegment[] = [];
  let bold = false;
  let buffer = '';
  const flush = () => {
    if (buffer) pushInlineSegments(segments, buffer, bold);
    buffer = '';
  };
  for (const ch of normalized) {
    if (ch === BOLD_OPEN) {
      flush();
      bold = true;
    } else if (ch === BOLD_CLOSE) {
      flush();
      bold = false;
    } else {
      buffer += ch;
    }
  }
  flush();
  return segments;
}

const LIST_ITEM_PATTERN = /^\s*(?:[-*•]|\d+[.)])\s+/;

/** Parse BLUF / STEP / follow-up content into paragraph and list blocks. */
export function parseRichContent(content: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  for (const rawBlock of content.split(/\n\s*\n/)) {
    const lines = rawBlock
      .split('\n')
      .map(line => line.replace(/^#{1,6}\s+/, '').trim())
      .filter(Boolean);
    if (!lines.length) continue;

    const itemFlags = lines.map(line => LIST_ITEM_PATTERN.test(line));
    const itemCount = itemFlags.filter(Boolean).length;
    if (itemCount > 0 && itemCount >= Math.ceil(lines.length / 2)) {
      const ordered = lines.some(line => /^\s*\d+[.)]\s/.test(line));
      const items: InlineSegment[][] = [];
      lines.forEach((line, index) => {
        if (itemFlags[index]) {
          items.push(parseInline(line.replace(LIST_ITEM_PATTERN, '')));
        } else if (items.length) {
          items[items.length - 1].push({ kind: 'text', text: ' ', bold: false }, ...parseInline(line));
        } else {
          items.push(parseInline(line));
        }
      });
      blocks.push({ type: 'list', ordered, items });
    } else {
      blocks.push({ type: 'paragraph', ordered: false, items: lines.map(line => parseInline(line)) });
    }
  }
  return blocks;
}

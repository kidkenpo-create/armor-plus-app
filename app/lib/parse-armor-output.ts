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
  const text = raw.replace(/\*\*/g, '');
  const result: ParsedOutput = { bluf: null, steps: [] };
  const bluf = text.match(/(?:^|\n)0\)\s*BLUF\s*[-:]\s*([\s\S]*?)(?=\nSTEP\s+1\s*[-:]|\n\nSTEP\s+1\s*[-:]|$)/i);
  if (bluf) result.bluf = bluf[1].trim();

  const stepHeader = /^[ \t]*STEP[ \t]+(\d+[AB]?)(?:[ \t]*--[ \t]*|[ \t]*[-:][ \t]*)(.*)$/gim;
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
  if (colon === -1) return { title: headerText, inlineContent: '' };

  return {
    title: headerText.slice(0, colon).trim(),
    inlineContent: headerText.slice(colon + 1).trim(),
  };
}

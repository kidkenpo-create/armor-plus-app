export interface ParsedOutput {
  bluf: string | null;
  steps: Array<{ num: string; title: string; content: string }>;
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

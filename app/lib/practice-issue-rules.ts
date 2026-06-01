import practiceRules from './practice-issue-rules.json';

export type SourceKind = 'rfo_far' | 'dfars_rfo' | 'dfars_pgi' | 'rfo_conventions' | 'class_deviation';

export interface SourceRequest {
  kind: SourceKind;
  part: string;
  reason: string;
  title?: string;
  url?: string;
  sourceType?: string;
}

export interface PracticeIssueRule {
  id: string;
  match: string[];
  expectedCitations: string[];
  requests: SourceRequest[];
  guidance: string;
}

const RULES = practiceRules as PracticeIssueRule[];

export function findPracticeIssueRules(question: string): PracticeIssueRule[] {
  const normalized = normalize(question);
  return RULES.filter(rule => rule.match.some(term => normalized.includes(normalize(term))));
}

export function getPracticeSourceRequests(question: string): SourceRequest[] {
  return findPracticeIssueRules(question).flatMap(rule => rule.requests);
}

export function getPracticeIssueInstruction(question: string): string {
  const matches = findPracticeIssueRules(question).slice(0, 5);
  if (!matches.length) return 'PRACTICE-SET ISSUE ROUTE: No practice-question issue family matched.';

  const blocks = matches.map(rule => {
    const citations = rule.expectedCitations.join(' | ');
    const routes = rule.requests.map(request => `${labelFor(request)} (${request.reason})`).join('; ');
    return [
      `Issue family: ${rule.id}`,
      `Expected controlling citation(s): ${citations}`,
      `Required route: ${routes}`,
      `Guardrail: ${rule.guidance}`,
    ].join('\n');
  });

  return [
    'PRACTICE-SET ISSUE ROUTE -- apply before final answer:',
    ...blocks,
    'If retrieved text conflicts with the expected citation, explain the conflict and downgrade to Conditional/UTR rather than guessing.',
  ].join('\n\n');
}

function labelFor(request: SourceRequest): string {
  if (request.kind === 'rfo_far') return `RFO FAR Part ${request.part}`;
  if (request.kind === 'dfars_rfo') return `DFARS RFO Part ${request.part}`;
  if (request.kind === 'dfars_pgi') return `DFARS RFO PGI Part ${request.part}`;
  if (request.kind === 'class_deviation') return `Approved Class Deviation Part ${request.part}`;
  return 'RFO FAR Conventions';
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

import practiceRules from './practice-issue-rules.json';
import { parsePrefixedCitations } from './section-excerpt';

export type SourceKind = 'rfo_far' | 'dfars_rfo' | 'dfars_pgi' | 'rfo_conventions' | 'class_deviation';

export interface SourceRequest {
  kind: SourceKind;
  part: string;
  /** Specific section cited for this part, e.g. "17.104-3", when the
   * question names one. Enables section-targeted excerpt extraction. */
  section?: string;
  /** Candidate sections for this part, tried in order during
   * extraction; the first candidate that actually exists in the
   * fetched text wins. Used for the DFARS counterpart of a FAR
   * citation, whose exact section number is text-dependent. */
  sectionCandidates?: string[];
  reason: string;
  title?: string;
  url?: string;
  sourceType?: string;
  textPath?: string;
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

/**
 * Map of `${kind}:${part}` -> section, built from the expectedCitations
 * of every practice rule the question matches. These citations are the
 * curated controlling authorities for the issue family and carry the
 * FAR -> DFARS correspondence (e.g. RFO FAR 17.104-3(a) paired with
 * DFARS RFO 217.104-370(b)(1)(iv)) that the question text itself may
 * never state. The fetcher uses this to section-target DFARS routes.
 */
export function getPracticeCitationSectionMap(question: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const rule of findPracticeIssueRules(question)) {
    for (const citation of rule.expectedCitations) {
      for (const parsed of parsePrefixedCitations(citation)) {
        const key = `${parsed.kind}:${parsed.part}`;
        if (!map.has(key)) map.set(key, parsed.section);
      }
    }
  }
  return map;
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

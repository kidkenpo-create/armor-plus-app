import practiceRules from './practice-issue-rules.json';
import { extractDeviationIds, parsePrefixedCitationTargets } from './section-excerpt';

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
  /** Pinpoint paragraph chain for the targeted section, e.g. "(b)"
   * or "(b)(1)(iv)", when a rule table or the question names one.
   * Extraction highlights that paragraph inside the section window. */
  paragraph?: string;
  /** DoD class-deviation number for a class_deviation request, e.g.
   * "2021-O0008". Extraction windows the deviation mirror at that
   * deviation's own memo/attachment instead of the mirror's head. */
  deviationId?: string;
  /** DFARS clause cited for this part, e.g. "252.205-7000".
   * Extraction targets the clause's prescription paragraph in the
   * DFARS part text, which is where clause applicability is decided. */
  clause?: string;
  reason: string;
  title?: string;
  url?: string;
  sourceType?: string;
  textPath?: string;
}

/** A section target for one `${kind}:${part}` route: the section to
 * window, plus its pinpoint paragraph when the citation names one. */
export interface CitationTarget {
  section: string;
  paragraph?: string;
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
  for (const [key, target] of getPracticeCitationTargetMap(question)) {
    map.set(key, target.section);
  }
  return map;
}

/**
 * Map of `${kind}:${part}` -> { section, paragraph? }, built from
 * the expectedCitations of every practice rule the question matches,
 * keeping the pinpoint paragraph chain (e.g. "RFO FAR 1.107(b)" ->
 * rfo_far:1 -> { section: "1.107", paragraph: "(b)" }).
 */
export function getPracticeCitationTargetMap(question: string): Map<string, CitationTarget> {
  const map = new Map<string, CitationTarget>();
  for (const rule of findPracticeIssueRules(question)) {
    for (const citation of rule.expectedCitations) {
      for (const parsed of parsePrefixedCitationTargets(citation)) {
        const key = `${parsed.kind}:${parsed.part}`;
        if (!map.has(key)) {
          const target: CitationTarget = { section: parsed.section };
          if (parsed.paragraph) target.paragraph = parsed.paragraph;
          map.set(key, target);
        }
      }
    }
  }
  return map;
}

/** Raw expectedCitations strings of every matched practice rule. */
export function getPracticeExpectedCitations(question: string): string[] {
  return findPracticeIssueRules(question).flatMap(rule => rule.expectedCitations);
}

/**
 * The class-deviation number a matched practice rule names in its
 * expectedCitations (e.g. "CD 2021-O0008 Revision 1" -> "2021-O0008"),
 * or undefined when no matched rule names one.
 */
export function getPracticeDeviationId(question: string): string | undefined {
  for (const citation of getPracticeExpectedCitations(question)) {
    const ids = extractDeviationIds(citation);
    if (ids.length) return ids[0];
  }
  return undefined;
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

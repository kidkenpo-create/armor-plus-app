import routingRules from './armor-routing-rules.json';
import type { CitationTarget, SourceRequest } from './practice-issue-rules';
import { parsePrefixedCitationTargets } from './section-excerpt';

export interface ArmorRoutingRule {
  id: string;
  issueFamily: string;
  triggerTerms: string[];
  requiredSources: SourceRequest[];
  requiredSourceOrder: string[];
  knownLegacyTrap: string;
  targetCitation: string;
  classDeviationTrigger?: string;
  verificationFocus: string;
  humanVerificationRole: string;
  instruction: string;
}

const RULES = routingRules as ArmorRoutingRule[];

export function findArmorRoutingRules(question: string): ArmorRoutingRule[] {
  const normalized = normalize(question);
  return RULES.filter(rule => rule.triggerTerms.some(term => normalized.includes(normalize(term))));
}

export function getArmorRoutingSourceRequests(question: string): SourceRequest[] {
  return findArmorRoutingRules(question).flatMap(rule => rule.requiredSources);
}

/**
 * Map of `${kind}:${part}` -> section, built from the targetCitation of
 * every structured routing rule the question matches (e.g.
 * "DFARS RFO 237.873-3(a)" -> dfars_rfo:237 -> "237.873-3"). Lets the
 * fetcher section-target the routes these rules require.
 */
export function getArmorCitationSectionMap(question: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, target] of getArmorCitationTargetMap(question)) {
    map.set(key, target.section);
  }
  return map;
}

/**
 * Map of `${kind}:${part}` -> { section, paragraph? }, built from
 * the targetCitation of every structured routing rule the question
 * matches, keeping the pinpoint paragraph chain (e.g.
 * "DFARS RFO 246.710(2)" -> dfars_rfo:246 -> { section: "246.710",
 * paragraph: "(2)" }).
 */
export function getArmorCitationTargetMap(question: string): Map<string, CitationTarget> {
  const map = new Map<string, CitationTarget>();
  for (const rule of findArmorRoutingRules(question)) {
    for (const parsed of parsePrefixedCitationTargets(rule.targetCitation)) {
      const key = `${parsed.kind}:${parsed.part}`;
      if (!map.has(key)) {
        const target: CitationTarget = { section: parsed.section };
        if (parsed.paragraph) target.paragraph = parsed.paragraph;
        map.set(key, target);
      }
    }
  }
  return map;
}

/** Raw targetCitation strings of every matched routing rule. */
export function getArmorTargetCitations(question: string): string[] {
  return findArmorRoutingRules(question).map(rule => rule.targetCitation);
}

export function getArmorRoutingInstruction(question: string): string {
  const matches = findArmorRoutingRules(question).slice(0, 5);
  if (!matches.length) return 'STRUCTURED ARMOR ROUTING RULES: No known issue-family routing rule matched.';

  const blocks = matches.map(rule => [
    `Issue family: ${rule.issueFamily} (${rule.id})`,
    `Required source order: ${rule.requiredSourceOrder.join(' -> ')}`,
    `Legacy trap to avoid: ${rule.knownLegacyTrap}`,
    `Target citation to verify against retrieved text: ${rule.targetCitation}`,
    rule.classDeviationTrigger ? `Class-deviation trigger: ${rule.classDeviationTrigger}` : '',
    `Verification focus: ${rule.verificationFocus}`,
    `Human verification role: ${rule.humanVerificationRole}`,
    `Routing instruction: ${rule.instruction}`,
  ].filter(Boolean).join('\n'));

  return [
    'STRUCTURED ARMOR ROUTING RULES -- route sources and avoid known legacy traps; do not answer from this rule alone:',
    ...blocks,
    'Use these rules to choose sources and checks. The final determination must still come from retrieved approved source text or be marked UTR/Conditional as applicable.',
  ].join('\n\n');
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

import routingRules from './armor-routing-rules.json';
import type { SourceRequest } from './practice-issue-rules';

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

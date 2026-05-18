const RFO_FAR_BASE = 'https://www.acquisition.gov/far-overhaul/far-part-deviation-guide/far-overhaul-part-';
const RFO_CONVENTIONS_URL = 'https://www.acquisition.gov/far-overhaul/far-part-deviation-guide/far-overhaul-part-1#FAR_1_107';
const DFARS_RFO_BASE = 'https://raw.githubusercontent.com/kidkenpo-create/ARMOR-plus/main/DFARS-RFO-PART-';
const DFARS_PGI_BASE = 'https://raw.githubusercontent.com/kidkenpo-create/ARMOR-plus/main/DFARS-RFO-PGI-PART-';

export interface FetchResult {
  label: string;
  url: string;
  content: string;
  status: 'R' | 'UTR';
  reason: string;
  error?: string;
}

export interface SourcePlanItem {
  label: string;
  url: string;
  status: 'R' | 'UTR' | 'planned';
  reason: string;
  excerpt?: string;
}

interface SourceRequest {
  kind: 'rfo_far' | 'dfars_rfo' | 'dfars_pgi' | 'rfo_conventions';
  part: string;
  reason: string;
}

interface IssueRule {
  terms: string[];
  requests: SourceRequest[];
}

const ISSUE_RULES: IssueRule[] = [
  issue(['debrief', 'preaward', 'pre-award', 'exclusion', '15.206', '15.505'], [
    req('rfo_far', '15', 'Debriefing and source-selection procedure'),
    req('dfars_rfo', '215', 'DoD overlay for Part 15'),
    req('dfars_pgi', '215', 'Procedural PGI check'),
  ]),
  issue(['detainee', 'enemy prisoner', 'epw', 'interrogat', 'contractor personnel'], [
    req('dfars_rfo', '237', 'Detainee interrogation and contractor personnel rule'),
    req('dfars_pgi', '237', 'Procedural PGI check'),
  ]),
  issue(['52.246-21', 'warranty', 'construction', 'germany'], [
    req('rfo_far', '46', 'Base FAR quality assurance rule'),
    req('dfars_rfo', '246', 'DoD construction warranty overlay'),
  ]),
  issue(['commercial product', 'commercial service', 'part 12', '212.102'], [
    req('rfo_far', '12', 'Commercial products and services'),
    req('dfars_rfo', '212', 'DoD commercial item overlay'),
  ]),
  issue(['technical data', '52.227-14', 'data rights', 'patent', 'copyright'], [
    req('rfo_far', '27', 'Patents, data, and copyrights'),
    req('dfars_rfo', '227', 'DoD technical data overlay'),
  ]),
  issue(['acquisition plan', 'acquisition planning', 'responsible for the acquisition plan', 'responsibility for acquisition plan'], [
    req('rfo_far', '7', 'Base acquisition planning rule'),
    req('dfars_rfo', '207', 'DoD acquisition planning overlay'),
    req('dfars_pgi', '207', 'DoD acquisition plan coordination responsibility'),
  ]),
  issue(['buy american', 'domestic end product', 'domestic end products'], [
    req('rfo_far', '25', 'Buy American applicability and exceptions'),
    req('dfars_rfo', '225', 'DoD domestic preference overlay'),
  ]),
  issue(['multiyear', 'multi-year', 'cancellation ceiling'], [
    req('rfo_far', '17', 'Multiyear contracting rules'),
    req('dfars_rfo', '217', 'DoD multiyear overlay'),
    req('dfars_pgi', '217', 'Procedural PGI check'),
  ]),
  issue(['micro-purchase', 'micro purchase', 'threshold'], [
    req('rfo_far', '2', 'Definition and threshold rule'),
    req('rfo_conventions', '1', 'Threshold convention check'),
  ]),
  issue(['assignment of claims'], [
    req('rfo_far', '32', 'Assignment of claims base rule'),
    req('dfars_rfo', '232', 'DoD assignment of claims overlay'),
  ]),
  issue(['two-step sealed', 'two step sealed', 'first step', 'technical proposals', 'sealed bidding'], [
    req('rfo_far', '14', 'Current RFO FAR two-step sealed bidding procedures'),
    req('dfars_rfo', '214', 'DoD sealed bidding overlay check'),
  ]),
  issue(['abilityone', 'nonprofit agency', 'participating nonprofit'], [
    req('rfo_far', '9', 'Responsibility determinations'),
  ]),
  issue(['small disadvantaged business', 'subcontractor', 'subcontracting plan'], [
    req('rfo_far', '19', 'Small business subcontracting rules'),
    req('dfars_rfo', '219', 'DoD small business overlay'),
  ]),
  issue(['contract type', 'fixed-price', 'cost-reimbursement', 'cost reimb'], [
    req('rfo_far', '16', 'Contract type rules'),
    req('dfars_rfo', '216', 'DoD contract type overlay'),
  ]),
];

function issue(terms: string[], requests: SourceRequest[]): IssueRule {
  return { terms, requests };
}

function req(kind: SourceRequest['kind'], part: string, reason: string): SourceRequest {
  return { kind, part, reason };
}

export async function prefetchRelevantParts(question: string): Promise<{ context: string; routePlan: SourcePlanItem[] }> {
  const requests = routeQuestion(question);
  const results = await Promise.all(requests.map(fetchSource));
  const routePlan = results.map(result => ({
    label: result.label,
    url: result.url,
    status: result.status,
    reason: result.reason,
    excerpt: result.status === 'R' ? pickEvidenceSnippet(result.content, question, result.label) : undefined,
  }));

  const context = results
    .map(result => {
      if (result.status !== 'R') {
        return `\n--- ${result.label} (${result.status}: ${result.error || 'unable to retrieve'}) ---\nSource: ${result.url}\nReason: ${result.reason}\n---`;
      }
      return `\n--- ${result.label} (retrieved from ${result.url}) ---\n${result.content}\n---`;
    })
    .join('\n');

  return { context, routePlan };
}

function routeQuestion(question: string): SourceRequest[] {
  const lower = question.toLowerCase();
  const requests: SourceRequest[] = [];

  for (const rule of ISSUE_RULES) {
    if (rule.terms.some(term => lower.includes(term))) requests.push(...rule.requests);
  }

  for (const part of extractParts(question)) {
    const farPart = part.startsWith('2') && part.length === 3 ? String(Number(part.slice(1))) : String(Number(part));
    const dfarsPart = part.startsWith('2') && part.length === 3 ? part : `2${farPart.padStart(2, '0')}`;
    requests.push(req('rfo_far', farPart, 'Named citation detected in user question'));
    requests.push(req('dfars_rfo', dfarsPart, 'DoD overlay check for named citation'));
  }

  if (/(deadline|days?|threshold|delegate|delegation|responsib|contracting officer|hca|head of the contracting activity)/i.test(question)) {
    requests.push(req('rfo_conventions', '1', 'Conventions may control timing, threshold, actor, or delegation'));
  }

  if (!requests.length) {
    requests.push(req('rfo_conventions', '1', 'Fallback conventions source for general ARMOR routing'));
  }

  return dedupe(requests).slice(0, 8);
}

function extractParts(question: string): string[] {
  const parts = new Set<string>();
  const re = /\b(?:dfars\s+rfo|dfars|rfo\s+far|far)?\s*(2?\d{1,2})\.\d+/gi;
  let match;
  while ((match = re.exec(question)) !== null) {
    const part = match[1];
    if (Number(part) > 0 && Number(part) < 253) parts.add(part);
  }
  return [...parts];
}

function dedupe(requests: SourceRequest[]): SourceRequest[] {
  const seen = new Set<string>();
  return requests.filter(request => {
    const key = `${request.kind}:${request.part}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchSource(request: SourceRequest): Promise<FetchResult> {
  const label = labelFor(request);
  const url = urlFor(request);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'ARMOR-Plus/1.0 DoD-Acquisition-Tool' },
      next: { revalidate: 3600 },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const prepared = prepareSourceContent(text, request);
    return {
      label,
      url,
      content: trimSource(prepared, request.kind),
      status: 'R',
      reason: request.reason,
    };
  } catch (error) {
    return {
      label,
      url,
      content: '',
      status: 'UTR',
      reason: request.reason,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function labelFor(request: SourceRequest): string {
  if (request.kind === 'rfo_far') return `RFO FAR Part ${request.part}`;
  if (request.kind === 'dfars_rfo') return `DFARS RFO Part ${request.part}`;
  if (request.kind === 'dfars_pgi') return `DFARS RFO PGI Part ${request.part}`;
  return 'RFO FAR Conventions';
}

function urlFor(request: SourceRequest): string {
  if (request.kind === 'rfo_far') return `${RFO_FAR_BASE}${String(Number(request.part))}`;
  if (request.kind === 'dfars_rfo') return `${DFARS_RFO_BASE}${request.part.padStart(3, '0')}-Attachment-1.txt`;
  if (request.kind === 'dfars_pgi') return `${DFARS_PGI_BASE}${request.part.padStart(3, '0')}-Attachment-2.txt`;
  return RFO_CONVENTIONS_URL;
}

function prepareSourceContent(content: string, request: SourceRequest): string {
  const text = normalizeEvidenceText(content);
  const targeted = targetedExcerpt(text, request);
  if (!targeted) return content;
  return `TARGETED REGULATORY EXCERPT:\n${targeted}\n\nFULL RETRIEVED SOURCE TEXT:\n${text}`;
}

function targetedExcerpt(text: string, request: SourceRequest): string {
  const targets: RegExp[] = [];

  if (request.kind === 'rfo_far' && request.part === '14') {
    targets.push(/14\.211-3\s+Procedures\.\s+\(a\)\s+Step one[\s\S]{0,2200}/i);
  }

  if (request.kind === 'rfo_far' && request.part === '15') {
    targets.push(/15\.206-2[\s\S]{0,1800}/i, /within 3 days after receipt[\s\S]{0,900}/i);
  }

  if (request.kind === 'rfo_far' && request.part === '27') {
    targets.push(/27\.400[\s\S]{0,1500}/i);
  }

  if (request.kind === 'rfo_far' && request.part === '46') {
    targets.push(/46\.710[\s\S]{0,1800}/i);
  }

  if (request.kind === 'rfo_far' && request.part === '7') {
    targets.push(/7\.101\s+Definitions[\s\S]{0,1600}/i, /7\.102\s+Requirements[\s\S]{0,1800}/i);
  }

  if (request.kind === 'dfars_rfo' && request.part === '207') {
    targets.push(/207\.103-70\s+Agency-head responsibilities[\s\S]{0,2200}/i, /207\.104-70\s+General procedures[\s\S]{0,1300}/i);
  }

  if (request.kind === 'dfars_pgi' && request.part === '207') {
    targets.push(/PGI 207\.104-70\s+General procedures\.\s+\(b\)[\s\S]{0,1600}/i, /It is incumbent upon the program manager[\s\S]{0,1000}/i);
  }

  if (request.kind === 'dfars_rfo' && request.part === '237') {
    targets.push(/"Detainee" means[\s\S]{0,2600}/i, /237\.873-3\s+Policy[\s\S]{0,1700}/i);
  }

  if (request.kind === 'dfars_rfo' && request.part === '246') {
    targets.push(/246\.710[\s\S]{0,2200}/i, /252\.246-7002[\s\S]{0,2200}/i);
  }

  if (request.kind === 'dfars_rfo' && request.part === '227') {
    targets.push(/227\.400\s+Scope of subpart[\s\S]{0,1400}/i);
  }

  for (const target of targets) {
    const match = text.match(target);
    if (match?.[0]) return trimEvidence(match[0]);
  }

  return '';
}

function trimSource(content: string, kind: SourceRequest['kind']): string {
  const cleaned = content.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const max = kind === 'dfars_pgi' ? 6000 : 10000;
  return cleaned.length > max ? `${cleaned.slice(0, max)}\n[Source truncated for context budget]` : cleaned;
}

function pickEvidenceSnippet(content: string, question: string, label: string): string {
  const text = normalizeEvidenceText(content);
  const q = question.toLowerCase();
  const patterns: RegExp[] = [];

  if (/two[- ]step sealed|sealed bidding|first step|technical proposals?/.test(q)) {
    patterns.push(
      /TARGETED REGULATORY EXCERPT:\s*14\.211-3[\s\S]{0,700}/i,
      /14\.211-3\s+Procedures\.\s+\(a\)\s+Step one[\s\S]{0,900}/i,
      /Synopsize requests for technical proposals in accordance with Part 5[\s\S]{0,500}/i,
    );
  }

  if (/enemy prisoner|detainee|epw|interrogat|contractor personnel/.test(q)) {
    patterns.push(
      /TARGETED REGULATORY EXCERPT:\s*"Detainee" means[\s\S]{0,700}/i,
      /"Detainee" means[\s\S]{0,500}/i,
      /No detainee may be interrogated by contractor personnel[\s\S]{0,250}/i,
      /The Secretary of Defense may waive the prohibition[\s\S]{0,650}/i,
    );
  }

  if (/52\.246-21|warranty|construction|germany/.test(q)) {
    patterns.push(
      /TARGETED REGULATORY EXCERPT:\s*246\.710[\s\S]{0,700}/i,
      /252\.246-7002[\s\S]{0,650}/i,
      /Warranty of Construction \(Germany\)[\s\S]{0,650}/i,
      /instead of the clause at FAR 52\.246-21[\s\S]{0,350}/i,
    );
  }

  if (/debrief|preaward|pre-award|exclusion|15\.206|15\.505/.test(q)) {
    patterns.push(
      /TARGETED REGULATORY EXCERPT:\s*15\.206-2[\s\S]{0,700}/i,
      /15\.206-2[\s\S]{0,850}/i,
      /within 3 days after receipt[\s\S]{0,450}/i,
      /notice of exclusion[\s\S]{0,500}/i,
    );
  }

  if (/52\.227-14|technical data|27\.409|rights in data/.test(q)) {
    patterns.push(
      /TARGETED REGULATORY EXCERPT:\s*227\.400[\s\S]{0,700}/i,
      /Use the procedures in subparts 227\.71 and 227\.72[\s\S]{0,550}/i,
      /27\.400[\s\S]{0,650}/i,
      /52\.227-14[\s\S]{0,650}/i,
    );
  }

  if (/acquisition plan|acquisition planning|responsible|program manager/.test(q)) {
    patterns.push(
      /TARGETED REGULATORY EXCERPT:\s*PGI 207\.104-70[\s\S]{0,700}/i,
      /It is incumbent upon the program manager[\s\S]{0,650}/i,
      /Planner means the person or office responsible for developing and maintaining a plan[\s\S]{0,500}/i,
      /207\.104-70\s+General procedures[\s\S]{0,650}/i,
    );
  }

  if (/conventions/i.test(label)) {
    patterns.push(/1\.107[\s\S]{0,600}/i);
  }

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) return trimEvidence(match[0]);
  }

  return trimEvidence(bestKeywordWindow(text, question));
}

function normalizeEvidenceText(content: string): string {
  return content
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function bestKeywordWindow(text: string, question: string): string {
  const keywords = question
    .toLowerCase()
    .replace(/[^a-z0-9.\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 4)
    .slice(0, 12);

  if (!keywords.length) return text.slice(0, 650);

  let bestIndex = 0;
  let bestScore = -1;
  const lower = text.toLowerCase();
  for (let index = 0; index < lower.length; index += 500) {
    const window = lower.slice(index, index + 900);
    const score = keywords.reduce((sum, keyword) => sum + (window.includes(keyword) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return text.slice(bestIndex, bestIndex + 900);
}

function trimEvidence(value: string): string {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned.length > 720 ? `${cleaned.slice(0, 720).trim()}...` : cleaned;
}

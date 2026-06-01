import { getPracticeSourceRequests, type SourceRequest } from './practice-issue-rules';
import { registryRequestsForParts } from './source-registry';

const RFO_FAR_BASE = 'https://www.acquisition.gov/far-overhaul/far-part-deviation-guide/far-overhaul-part-';
const RFO_CONVENTIONS_URL = 'https://www.acquisition.gov/far-overhaul/far-part-deviation-guide/far-overhaul-part-1#FAR_1_107';
const DFARS_RFO_BASE = 'https://raw.githubusercontent.com/kidkenpo-create/ARMOR-plus/main/DFARS-RFO-PART-';
const DFARS_PGI_BASE = 'https://raw.githubusercontent.com/kidkenpo-create/ARMOR-plus/main/DFARS-RFO-PGI-PART-';
const GITHUB_USER_AGENT = 'ARMOR-Plus/1.0 DoD-Acquisition-Tool';
const SOURCE_FETCH_TIMEOUT_MS = 5000;
export const DATA_FALLBACK_DISABLED_REASON = 'Baseline FAR/DFARS data fallback is disabled for controlling authority; use RFO FAR, DFARS RFO, DFARS RFO PGI, or approved class-deviation text only.';

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

interface IssueRule {
  terms: string[];
  requests: SourceRequest[];
}

type ArmorFetchInit = RequestInit & {
  next?: {
    revalidate?: number;
  };
};

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
  const results = await Promise.all(requests.map(request => fetchSource(request)));
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
  const requests: SourceRequest[] = [...getPracticeSourceRequests(question)];
  const citedParts = extractParts(question);

  for (const rule of ISSUE_RULES) {
    if (rule.terms.some(term => lower.includes(term))) requests.push(...rule.requests);
  }

  for (const part of citedParts) {
    const farPart = part.startsWith('2') && part.length === 3 ? String(Number(part.slice(1))) : String(Number(part));
    const dfarsPart = part.startsWith('2') && part.length === 3 ? part : `2${farPart.padStart(2, '0')}`;
    requests.push(req('rfo_far', farPart, 'Named citation detected in user question'));
    if (dfarsPart !== '252') {
      requests.push(req('dfars_rfo', dfarsPart, 'DoD overlay check for named citation'));
    }
  }

  if (/(deadline|days?|threshold|delegate|delegation|responsib|contracting officer|hca|head of the contracting activity)/i.test(question)) {
    requests.push(req('rfo_conventions', '1', 'Conventions may control timing, threshold, actor, or delegation'));
  }

  if (/(class deviation|deviation|in lieu of|use attached|replace|cd \d{4}-o\d{4}|2017-o0004|2018-o0019|2021-o0008|2011-o0006|2012-o0010)/i.test(question)) {
    const part = citedParts[0] || '1';
    const farPart = part.startsWith('2') && part.length === 3 ? String(Number(part.slice(1))) : String(Number(part));
    requests.push(req('class_deviation', farPart, 'Approved active class-deviation text required before deviation-negative certification'));
  }

  requests.push(...registryRequestsForParts(citedParts));

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
  const primaryResult = await fetchPrimarySource(request);
  if (primaryResult.status === 'R') return primaryResult;

  return {
    ...primaryResult,
    error: [primaryResult.error, DATA_FALLBACK_DISABLED_REASON].filter(Boolean).join(' | '),
  };
}

async function fetchPrimarySource(request: SourceRequest): Promise<FetchResult> {
  const label = labelFor(request);
  const url = urlFor(request);
  if (request.kind === 'class_deviation') {
    return {
      label,
      url,
      content: '',
      status: 'UTR',
      reason: request.reason,
      error: 'Approved class-deviation PDF/text retrieval is not implemented yet; do not certify no deviation found.',
    };
  }

  if (isPdfSource(request, url)) {
    return fetchApprovedPdfSource(request, label, url);
  }

  try {
    const response = await fetchWithTimeout(url, {
      headers: { 'User-Agent': GITHUB_USER_AGENT },
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
  if (request.title) return request.title;
  if (request.kind === 'rfo_far') return `RFO FAR Part ${request.part}`;
  if (request.kind === 'dfars_rfo') return `DFARS RFO Part ${request.part}`;
  if (request.kind === 'dfars_pgi') return `DFARS RFO PGI Part ${request.part}`;
  if (request.kind === 'class_deviation') return `Approved Class Deviation Part ${request.part}`;
  return 'RFO FAR Conventions';
}

function urlFor(request: SourceRequest): string {
  if (request.url) return request.url;
  if (request.kind === 'rfo_far') return `${RFO_FAR_BASE}${String(Number(request.part))}`;
  if (request.kind === 'dfars_rfo') return `${DFARS_RFO_BASE}${request.part.padStart(3, '0')}-Attachment-1.txt`;
  if (request.kind === 'dfars_pgi' && request.part === '212') {
    return 'https://raw.githubusercontent.com/kidkenpo-create/ARMOR-plus/main/DFARS-PGI-RFO-PART-212-Attachment-2.txt';
  }
  if (request.kind === 'dfars_pgi') return `${DFARS_PGI_BASE}${request.part.padStart(3, '0')}-Attachment-2.txt`;
  if (request.kind === 'class_deviation') return `knowledge/armor-gpt/DoD_Class_Deviations_FY26v04_dated_2Feb2026.pdf#part-${request.part}`;
  return RFO_CONVENTIONS_URL;
}

async function fetchApprovedPdfSource(request: SourceRequest, label: string, url: string): Promise<FetchResult> {
  try {
    const response = await fetchWithTimeout(url, {
      method: 'HEAD',
      headers: { 'User-Agent': GITHUB_USER_AGENT },
      next: { revalidate: 3600 },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return {
      label,
      url,
      content: '',
      status: 'UTR',
      reason: request.reason,
      error: `Approved ${request.sourceType || 'PDF'} source is reachable, but runtime text extraction is not implemented yet; do not treat the missing text attachment as a 404 or deviation-negative finding.`,
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

function isPdfSource(request: SourceRequest, url: string) {
  return request.sourceType?.toLowerCase() === 'pdf' || url.toLowerCase().endsWith('.pdf');
}

async function fetchWithTimeout(url: string, init: ArmorFetchInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Timed out after ${SOURCE_FETCH_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function prepareSourceContent(content: string, request: SourceRequest): string {
  const text = normalizeEvidenceText(content);
  const targeted = targetedExcerpt(text, request);
  if (!targeted) return content;
  return `TARGETED REGULATORY EXCERPT:\n${targeted}\n\nFULL RETRIEVED SOURCE TEXT:\n${text}`;
}

function targetedExcerpt(text: string, request: SourceRequest): string {
  const targets: RegExp[] = [...commonTargets(request)];

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

function commonTargets(request: SourceRequest): RegExp[] {
  const key = `${request.kind}:${request.part}`;
  const targets: Record<string, RegExp[]> = {
    'rfo_far:1': [/1\.108[\s\S]{0,2400}/i, /1\.107[\s\S]{0,1800}/i],
    'rfo_far:2': [/Simplified acquisition threshold[\s\S]{0,1800}/i, /Micro-purchase threshold[\s\S]{0,1200}/i],
    'rfo_far:5': [/5\.202[\s\S]{0,1600}/i],
    'rfo_far:6': [/6\.001[\s\S]{0,1400}/i, /6\.302-7[\s\S]{0,1800}/i],
    'rfo_far:8': [/8\.1100[\s\S]{0,1800}/i, /8\.1102[\s\S]{0,1600}/i],
    'rfo_far:9': [/9\.102[\s\S]{0,1800}/i, /9\.106[\s\S]{0,1200}/i],
    'rfo_far:14': [/14\.211-3[\s\S]{0,2200}/i, /14\.308[\s\S]{0,1600}/i],
    'rfo_far:15': [/15\.206-2[\s\S]{0,1800}/i, /15\.405[\s\S]{0,1800}/i],
    'rfo_far:17': [/17\.108[\s\S]{0,1800}/i, /17\.106-3[\s\S]{0,1800}/i],
    'rfo_far:19': [/19\.109[\s\S]{0,2000}/i, /19\.203[\s\S]{0,1600}/i, /19\.703[\s\S]{0,1800}/i],
    'rfo_far:23': [/23\.106[\s\S]{0,1600}/i],
    'rfo_far:25': [/25\.100[\s\S]{0,1800}/i, /25\.301-3[\s\S]{0,2000}/i],
    'rfo_far:28': [/28\.307-2[\s\S]{0,1600}/i, /28\.102[\s\S]{0,1600}/i],
    'rfo_far:31': [/31\.\d+[\s\S]{0,1600}/i],
    'rfo_far:32': [/32\.803[\s\S]{0,1600}/i],
    'rfo_far:33': [/33\.205-1[\s\S]{0,1600}/i, /33\.206[\s\S]{0,1200}/i],
    'rfo_far:36': [/36\.102[\s\S]{0,2200}/i, /36\.203[\s\S]{0,1600}/i],
    'rfo_far:37': [/37\.301-1[\s\S]{0,1800}/i],
    'rfo_far:41': [/41\.102[\s\S]{0,1800}/i],
    'rfo_far:42': [/42\.505[\s\S]{0,2200}/i],
    'rfo_far:45': [/45\.000[\s\S]{0,1800}/i],
    'rfo_far:48': [/48\.\d+[\s\S]{0,2200}/i],
    'rfo_far:50': [/50\.\d+[\s\S]{0,2200}/i],
    'rfo_far:52': [/52\.248-1[\s\S]{0,2600}/i, /52\.248-3[\s\S]{0,2600}/i],
    'dfars_rfo:201': [/201\.170[\s\S]{0,1800}/i, /201\.108[\s\S]{0,1800}/i],
    'dfars_pgi:201': [/PGI 201\.170-2[\s\S]{0,2000}/i, /PGI 201\.108[\s\S]{0,2000}/i],
    'dfars_pgi:204': [/PGI 204\.101[\s\S]{0,1300}/i, /Include the contracting officer's telephone number[\s\S]{0,800}/i],
    'dfars_rfo:205': [/205\.470[\s\S]{0,1800}/i],
    'dfars_rfo:208': [/208\.7302[\s\S]{0,1600}/i, /SUBPART 208\.73[\s\S]{0,2000}/i],
    'dfars_pgi:208': [/PGI 208\.73[\s\S]{0,2200}/i, /DoD policy is for maximum participation[\s\S]{0,1000}/i],
    'dfars_rfo:209': [/209\.171[\s\S]{0,1400}/i],
    'dfars_pgi:209': [/PGI 209\.171[\s\S]{0,2200}/i],
    'dfars_rfo:212': [/212\.102[\s\S]{0,2600}/i],
    'dfars_pgi:212': [/PGI 212\.102[\s\S]{0,2000}/i],
    'dfars_rfo:216': [/216\.401[\s\S]{0,1800}/i],
    'dfars_pgi:216': [/PGI 216\.401[\s\S]{0,2200}/i],
    'dfars_rfo:217': [/217\.7302[\s\S]{0,2200}/i, /217\.7404-5[\s\S]{0,2200}/i, /217\.170[\s\S]{0,2200}/i],
    'dfars_rfo:225': [/252\.225-7976[\s\S]{0,2200}/i, /2017-O0004[\s\S]{0,1800}/i, /25\.301-3[\s\S]{0,1600}/i],
    'dfars_pgi:225': [/For work performed in Japan[\s\S]{0,1800}/i, /Class Deviation 2017-O0004[\s\S]{0,1600}/i],
    'dfars_rfo:228': [/228\.102-1[\s\S]{0,2200}/i, /228\.307[\s\S]{0,1600}/i],
    'dfars_rfo:232': [/232\.7002[\s\S]{0,1800}/i, /232\.803[\s\S]{0,2000}/i],
    'dfars_pgi:232': [/PGI 232\.7002[\s\S]{0,1800}/i, /PGI 232\.7004[\s\S]{0,1800}/i],
    'dfars_rfo:233': [/233\.205[\s\S]{0,1600}/i],
    'dfars_rfo:236': [/236\.203[\s\S]{0,1600}/i, /236\.602[\s\S]{0,1600}/i],
    'dfars_pgi:236': [/PGI 236\.203[\s\S]{0,2200}/i, /For Official Use Only[\s\S]{0,800}/i],
    'dfars_rfo:237': [/237\.102-71[\s\S]{0,1800}/i, /237\.106[\s\S]{0,1400}/i, /237\.301-1[\s\S]{0,1400}/i, /237\.873-4[\s\S]{0,1400}/i],
    'dfars_pgi:237': [/DoD Instruction 1100\.22[\s\S]{0,1200}/i, /PGI 237\.102-71[\s\S]{0,1800}/i],
    'dfars_pgi:242': [/PGI 242\.505-1[\s\S]{0,2200}/i],
    'dfars_rfo:245': [/245\.103-70[\s\S]{0,1600}/i, /245\.103-71[\s\S]{0,1600}/i],
    'dfars_pgi:245': [/PGI 245\.103-70[\s\S]{0,2000}/i, /PGI 245\.103-71[\s\S]{0,2200}/i],
  };

  return targets[key] || [];
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

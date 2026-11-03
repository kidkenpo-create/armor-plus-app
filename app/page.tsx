'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DEMO_QUESTIONS } from '@/app/lib/armor-prompt';
import {
  blufTone,
  enforceDefinitiveGuard,
  extractCitations,
  parseArmorOutput,
  parseArmorOutputRich,
  parseRichContent,
  type CitationRef,
  type ParsedOutput,
} from '@/app/lib/parse-armor-output';
import { findPracticeIssueRules, type SourceRequest } from '@/app/lib/practice-issue-rules';
import styles from './page.module.css';

interface AnalyzeResponseMeta {
  routePlan?: SourcePlanItem[];
  model?: string;
  responseMode?: ResponseMode;
}

type ResponseMode = 'first_turn_full_analysis' | 'follow_up_concise_continuation' | 'force_full_analysis';

interface SourcePlanItem {
  label: string;
  url: string;
  displayUrl?: string;
  status: 'R' | 'UTR' | 'planned';
  reason: string;
  excerpt?: string;
}

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  parsed?: ParsedOutput | null;
  routePlan?: SourcePlanItem[];
  timestamp?: string;
  model?: string;
  responseMode?: ResponseMode;
}

interface ApiConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: ChatTurn[];
  model?: string;
}

const MAX_CLIENT_HISTORY_MESSAGES = 8;
const CHAT_HISTORY_KEY = 'armor-plus-chat-history-v1';
const MAX_SAVED_CHATS = 30;

const DEMO_LABELS = [
  'Preaward debrief deadline',
  'EPW waiver rule',
  'Germany warranty clause',
  'Two-step sealed bidding',
];

function routePreview(question: string): SourcePlanItem[] {
  const q = question.toLowerCase();
  const practiceItems = practiceRoutePreview(question);
  if (practiceItems.length) return practiceItems;

  const plans: Array<{ terms: string[]; items: SourcePlanItem[] }> = [
    {
      terms: ['debrief', 'preaward', 'pre-award', 'exclusion', '15.206', '15.505'],
      items: [
        plan('RFO FAR Part 15', 'https://www.acquisition.gov/far-overhaul/far-part-deviation-guide/far-overhaul-part-15', 'Acquisition procedures and debriefing rules'),
        plan('DFARS RFO Part 215', 'https://raw.githubusercontent.com/kidkenpo-create/ARMOR-plus/main/DFARS-RFO-PART-215-Attachment-1.txt', 'DoD overlay for Part 15'),
        plan('DFARS RFO PGI Part 215', 'https://raw.githubusercontent.com/kidkenpo-create/ARMOR-plus/main/DFARS-RFO-PGI-PART-215-Attachment-2.txt', 'Procedural PGI check'),
      ],
    },
    {
      terms: ['detainee', 'enemy prisoner', 'epw', 'interrogat', 'contractor personnel'],
      items: [
        plan('DFARS RFO Part 237', 'https://raw.githubusercontent.com/kidkenpo-create/ARMOR-plus/main/DFARS-RFO-PART-237-Attachment-1.txt', 'Service contracting and detainee interrogation rule'),
        plan('DFARS RFO PGI Part 237', 'https://raw.githubusercontent.com/kidkenpo-create/ARMOR-plus/main/DFARS-RFO-PGI-PART-237-Attachment-2.txt', 'Procedural PGI check'),
      ],
    },
    {
      terms: ['52.246-21', 'warranty', 'construction', 'germany'],
      items: [
        plan('RFO FAR Part 46', 'https://www.acquisition.gov/far-overhaul/far-part-deviation-guide/far-overhaul-part-46', 'Base quality assurance warranty rule'),
        plan('DFARS RFO Part 246', 'https://raw.githubusercontent.com/kidkenpo-create/ARMOR-plus/main/DFARS-RFO-PART-246-Attachment-1.txt', 'DoD warranty prescription overlay'),
      ],
    },
    {
      terms: ['two-step sealed', 'two step sealed', 'first step', 'technical proposals', 'sealed bidding'],
      items: [
        plan('RFO FAR Part 14', 'https://www.acquisition.gov/far-overhaul/far-part-deviation-guide/far-overhaul-part-14', 'Current two-step sealed bidding procedures'),
        plan('DFARS RFO Part 214', 'https://raw.githubusercontent.com/kidkenpo-create/ARMOR-plus/main/DFARS-RFO-PART-214-Attachment-1.txt', 'DoD sealed bidding overlay check'),
      ],
    },
    {
      terms: ['commercial product', 'commercial service', 'part 12', '212.102'],
      items: [
        plan('RFO FAR Part 12', 'https://www.acquisition.gov/far-overhaul/far-part-deviation-guide/far-overhaul-part-12', 'Commercial products and services'),
        plan('DFARS RFO Part 212', 'https://raw.githubusercontent.com/kidkenpo-create/ARMOR-plus/main/DFARS-RFO-PART-212-Attachment-1.txt', 'DoD commercial item overlay'),
      ],
    },
    {
      terms: ['technical data', '52.227-14', 'data rights', 'patent', 'copyright'],
      items: [
        plan('RFO FAR Part 27', 'https://www.acquisition.gov/far-overhaul/far-part-deviation-guide/far-overhaul-part-27', 'Patents, data, and copyrights'),
        plan('DFARS RFO Part 227', 'https://raw.githubusercontent.com/kidkenpo-create/ARMOR-plus/main/DFARS-RFO-PART-227-Attachment-1.txt', 'DoD technical data overlay'),
      ],
    },
    {
      terms: ['acquisition plan', 'acquisition planning', 'responsible for the acquisition plan', 'responsibility for acquisition plan'],
      items: [
        plan('RFO FAR Part 7', 'https://www.acquisition.gov/far-overhaul/far-part-deviation-guide/far-overhaul-part-7', 'Base acquisition planning rule'),
        plan('DFARS RFO Part 207', 'https://raw.githubusercontent.com/kidkenpo-create/ARMOR-plus/main/DFARS-RFO-PART-207-Attachment-1.txt', 'DoD acquisition planning overlay'),
        plan('DFARS RFO PGI Part 207', 'https://raw.githubusercontent.com/kidkenpo-create/ARMOR-plus/main/DFARS-RFO-PGI-PART-207-Attachment-2.txt', 'DoD acquisition plan coordination responsibility'),
      ],
    },
  ];

  const matched = plans.find(group => group.terms.some(term => q.includes(term)));
  if (matched) return matched.items;

  const citation = q.match(/\b(?:dfars\s+rfo|dfars|far|rfo\s+far)?\s*(2?\d{1,2})\.\d+/i);
  if (citation) {
    const rawPart = citation[1];
    const farPart = rawPart.startsWith('2') && rawPart.length === 3 ? String(Number(rawPart.slice(1))) : String(Number(rawPart));
    const dfarsPart = rawPart.startsWith('2') && rawPart.length === 3 ? rawPart : `2${farPart.padStart(2, '0')}`;
    return [
      plan(`RFO FAR Part ${farPart}`, `https://www.acquisition.gov/far-overhaul/far-part-deviation-guide/far-overhaul-part-${farPart}`, 'Named citation detected'),
      plan(`DFARS RFO Part ${dfarsPart}`, `https://raw.githubusercontent.com/kidkenpo-create/ARMOR-plus/main/DFARS-RFO-PART-${dfarsPart}-Attachment-1.txt`, 'DoD overlay check'),
    ];
  }

  return [
    plan('ARMOR classifier', 'https://www.acquisition.gov/far-overhaul', 'Question will be routed server-side'),
    plan('RFO FAR Conventions', 'https://www.acquisition.gov/far-overhaul/far-part-deviation-guide/far-overhaul-part-1#FAR_1_107', 'Fallback conventions check when actor, threshold, or delegation matters'),
  ];
}

function practiceRoutePreview(question: string): SourcePlanItem[] {
  const seen = new Set<string>();
  return findPracticeIssueRules(question)
    .flatMap(rule => rule.requests)
    .filter(request => {
      const key = `${request.kind}:${request.part}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8)
    .map(request => plan(labelForRequest(request), urlForRequest(request), request.reason));
}

function labelForRequest(request: SourceRequest): string {
  if (request.kind === 'rfo_far') return `RFO FAR Part ${request.part}`;
  if (request.kind === 'dfars_rfo') return `DFARS RFO Part ${request.part}`;
  if (request.kind === 'dfars_pgi') return `DFARS RFO PGI Part ${request.part}`;
  if (request.kind === 'class_deviation') return `Approved Class Deviation Part ${request.part}`;
  return 'RFO FAR Conventions';
}

function urlForRequest(request: SourceRequest): string {
  if (request.kind === 'rfo_far') {
    return `https://www.acquisition.gov/far-overhaul/far-part-deviation-guide/far-overhaul-part-${Number(request.part)}`;
  }
  if (request.kind === 'dfars_rfo') {
    return `https://raw.githubusercontent.com/kidkenpo-create/ARMOR-plus/main/DFARS-RFO-PART-${request.part.padStart(3, '0')}-Attachment-1.txt`;
  }
  if (request.kind === 'dfars_pgi' && request.part === '212') {
    return 'https://raw.githubusercontent.com/kidkenpo-create/ARMOR-plus/main/DFARS-PGI-RFO-PART-212-Attachment-2.txt';
  }
  if (request.kind === 'dfars_pgi') {
    return `https://raw.githubusercontent.com/kidkenpo-create/ARMOR-plus/main/DFARS-RFO-PGI-PART-${request.part.padStart(3, '0')}-Attachment-2.txt`;
  }
  if (request.kind === 'class_deviation') {
    return `/knowledge/armor-gpt/DoD_Class_Deviations_FY26v04_dated_2Feb2026.pdf#part-${request.part}`;
  }
  return 'https://www.acquisition.gov/far-overhaul/far-part-deviation-guide/far-overhaul-part-1#FAR_1_107';
}

function plan(label: string, url: string, reason: string): SourcePlanItem {
  return { label, url, displayUrl: officialDisplayUrl(url), reason, status: 'planned' };
}

function officialDisplayUrl(url: string) {
  const memoPdf = url.match(/\/(DFARS-RFO-PART-(?:248|252)-Deviation-Memo\.pdf)$/i);
  if (memoPdf?.[1]) return `/knowledge/armor-gpt/${memoPdf[1]}`;

  const dfarsMatch = url.match(/DFARS-(?:PGI-)?RFO-PART-(\d{3})-|DFARS-RFO(?:-PGI)?-PART-(\d{3})-/i);
  const part = dfarsMatch?.[1] || dfarsMatch?.[2];
  if (!part) return undefined;

  return `https://www.acquisition.gov/sites/default/files/page_file_uploads/DoD_RFO_Deviation_Part-${Number(part.slice(1))}.pdf`;
}

function sourceHref(item: SourcePlanItem) {
  return item.displayUrl || item.url;
}

function newTurnId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function compactChatHistory(turns: ChatTurn[]): ApiConversationMessage[] {
  return turns
    .filter(turn => turn.content.trim().length > 0)
    .slice(-MAX_CLIENT_HISTORY_MESSAGES)
    .map(turn => ({
      role: turn.role,
      content: turn.content.slice(0, 6000),
    }));
}

function routingContext(turns: ChatTurn[], question: string) {
  return [...turns.slice(-4).map(turn => turn.content), question].join('\n\n');
}

function explicitFullRequest(value: string) {
  return /(show full|full analysis|full armor|complete step|complete armor|rungs? 1-8|step\s*[1-7]|final receipt|full reasoning|run the full|research more|deeper research|wrong|incorrect|correct the answer|new controlling|controlling citation|class deviation|deviation)/i.test(value);
}

function issueFamilyForText(value: string) {
  const families: Array<[string, RegExp]> = [
    ['debriefing', /(debrief|preaward|pre-award|exclusion|15\.206|15\.505)/i],
    ['detainee', /(detainee|enemy prisoner|epw|interrogat|contractor personnel|237\.873)/i],
    ['warranty-germany', /(52\.246-21|warranty|construction.*germany|germany.*construction|246\.710)/i],
    ['sealed-bidding', /(two[- ]step sealed|sealed bidding|first step|technical proposals?|equal low bids?|14\.211|14\.308)/i],
    ['technical-data', /(52\.227-14|technical data|27\.409|rights in data)/i],
    ['acquisition-plan', /(acquisition plan|acquisition planning|responsible for.*plan|207\.104-70)/i],
    ['thresholds', /(section 807|threshold|inflation|201\.108|1\.108)/i],
    ['subcontracting', /(limitations on subcontracting|subcontracting|small business|2021-o0008|19\.505|19\.507|219\.)/i],
  ];
  return families.find(([, pattern]) => pattern.test(value))?.[0] || '';
}

function citationKeys(value: string) {
  return [...value.matchAll(/\b(?:rfo\s+far|far|dfars\s+rfo|dfars|pgi)?\s*(2?\d{1,2}\.\d+(?:-\d+)?(?:\([a-z0-9]+\))*)/gi)]
    .map(match => match[1].toLowerCase());
}

function responseModeForClient(prompt: string, turns: ChatTurn[]): ResponseMode {
  const historyText = turns.map(turn => turn.content).join('\n').toLowerCase();
  if (!turns.some(turn => turn.role === 'assistant' && turn.content.trim())) return 'first_turn_full_analysis';
  if (explicitFullRequest(prompt)) return 'force_full_analysis';
  if (citationKeys(prompt).some(citation => !historyText.includes(citation))) return 'first_turn_full_analysis';

  const promptFamily = issueFamilyForText(prompt);
  const historyFamily = issueFamilyForText(historyText);
  if (promptFamily && historyFamily && promptFamily !== historyFamily) return 'first_turn_full_analysis';

  return 'follow_up_concise_continuation';
}

function chatTitleFromTurns(turns: ChatTurn[]) {
  const firstQuestion = turns.find(turn => turn.role === 'user')?.content.trim() || 'Untitled ARMOR chat';
  const compact = firstQuestion.replace(/\s+/g, ' ');
  return compact.length > 58 ? `${compact.slice(0, 58)}...` : compact;
}

function normalizeStoredTurn(turn: ChatTurn): ChatTurn {
  const parsed = turn.role === 'assistant' && turn.content && !turn.parsed ? parseArmorOutput(turn.content) : turn.parsed;
  return {
    id: typeof turn.id === 'string' ? turn.id : newTurnId(),
    role: turn.role === 'assistant' ? 'assistant' : 'user',
    content: typeof turn.content === 'string' ? turn.content : '',
    parsed: parsed || null,
    routePlan: Array.isArray(turn.routePlan) ? turn.routePlan : undefined,
    timestamp: typeof turn.timestamp === 'string' ? turn.timestamp : undefined,
    model: typeof turn.model === 'string' ? turn.model : undefined,
    responseMode: turn.responseMode === 'follow_up_concise_continuation'
      ? 'follow_up_concise_continuation'
      : turn.responseMode === 'force_full_analysis'
        ? 'force_full_analysis'
        : 'first_turn_full_analysis',
  };
}

function readChatSessions(): ChatSession[] {
  try {
    const raw = window.localStorage.getItem(CHAT_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatSession[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(session => session && typeof session.id === 'string' && Array.isArray(session.turns))
      .map(session => ({
        id: session.id,
        title: typeof session.title === 'string' ? session.title : chatTitleFromTurns(session.turns),
        createdAt: typeof session.createdAt === 'string' ? session.createdAt : new Date().toISOString(),
        updatedAt: typeof session.updatedAt === 'string' ? session.updatedAt : new Date().toISOString(),
        turns: session.turns.map(normalizeStoredTurn).filter(turn => turn.content.trim().length > 0),
        model: typeof session.model === 'string' ? session.model : undefined,
      }))
      .filter(session => session.turns.length > 0)
      .slice(0, MAX_SAVED_CHATS);
  } catch {
    return [];
  }
}

function writeChatSessions(sessions: ChatSession[]) {
  try {
    window.localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(sessions.slice(0, MAX_SAVED_CHATS)));
  } catch {
    // Local browser storage can be disabled or full; chat still works without saved history.
  }
}

function formatSessionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function statusLabel(status: SourcePlanItem['status']) {
  if (status === 'R') return 'Retrieved';
  if (status === 'UTR') return 'UTR';
  return 'Planned';
}

function isApprovedSource(label: string, url: string) {
  const lowerLabel = label.toLowerCase();
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('acquisition.gov/far-overhaul/far-part-deviation-guide/far-overhaul-part-')) return true;
  if (
    lowerUrl.includes('raw.githubusercontent.com/kidkenpo-create/armor-plus/main/dfars-rfo-part-')
    || lowerUrl.includes('raw.githubusercontent.com/kidkenpo-create/armor-plus/main/dfars-rfo-pgi-part-')
    || lowerUrl.includes('raw.githubusercontent.com/kidkenpo-create/armor-plus/main/dfars-pgi-rfo-part-')
  ) return true;
  if (lowerLabel.includes('class deviation') && lowerUrl.includes('acquisition.gov/sites/default/files/page_file_uploads/')) return true;
  if (lowerLabel.includes('class deviation') && lowerUrl.includes('dod_class_deviations_fy26')) return true;
  return false;
}

function hasApprovedControlling(items?: SourcePlanItem[]) {
  if (!items) return false;
  return items.some(item => item.status === 'R' && isApprovedSource(item.label, item.url));
}

/* ------------------------------------------------------------------ */
/* Research Trace stage model — shared by the side-panel trace and     */
/* the in-chat staged progress card so both always agree.              */
/* ------------------------------------------------------------------ */

interface TraceRow {
  label: string;
  detail: string;
  state: 'done' | 'active' | 'idle';
}

function buildTraceRows(items: SourcePlanItem[], streaming: boolean, done: boolean, model: string): TraceRow[] {
  const fetched = items.filter(item => item.status === 'R').length;
  const total = items.length;
  return [
    {
      label: 'Classify issue family',
      detail: 'Question type, named citations, DoD/default assumptions',
      state: streaming || done ? 'done' : 'idle',
    },
    {
      label: 'Route approved sources',
      detail: total ? `${total} source route${total === 1 ? '' : 's'} selected` : 'Waiting for question',
      state: total ? 'done' : 'idle',
    },
    {
      label: 'Fetch live authority',
      detail: done || fetched ? `${fetched}/${total} retrieved; UTR where unavailable` : 'Server-side direct retrieval',
      state: done ? 'done' : streaming ? 'active' : 'idle',
    },
    {
      label: 'Apply ARMOR gates',
      detail: 'Two-pass gate, rungs, verification loop, final receipt',
      state: streaming ? 'active' : done ? 'done' : 'idle',
    },
    {
      label: `Draft final with ${model || 'the selected model'}`,
      detail: 'BLUF, STEP 1-7, citations, validation notes',
      state: streaming ? 'active' : done ? 'done' : 'idle',
    },
  ];
}

function PendingProgress({ items, model }: { items: SourcePlanItem[]; model: string }) {
  const rows = buildTraceRows(items, true, false, model);
  const active = rows.find(row => row.state === 'active');
  return (
    <div className={styles.pendingAnswer} role="status" aria-live="polite">
      <strong>{active ? `${active.label}...` : 'Researching...'}</strong>
      <div className={styles.pendingStages}>
        {rows.map(row => (
          <div key={row.label} className={styles.pendingStage}>
            <span className={`${styles.traceDot} ${styles[`trace-${row.state}`]} ${row.state === 'active' ? styles.tracePulse : ''}`} />
            <span>{row.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Citation chips + rich answer rendering (Tier 2 #1)                  */
/* ------------------------------------------------------------------ */

const CITATION_CLASS_LABELS: Record<CitationRef['citeClass'], string> = {
  controlling: 'Controlling',
  'dfars-overlay': 'DFARS overlay',
  pgi: 'PGI',
  deviation: 'Deviation',
  clause: 'Clause',
};

interface CitationContextValue {
  numbers: Map<string, number>;
  items: SourcePlanItem[];
}

const CitationContext = createContext<CitationContextValue>({ numbers: new Map(), items: [] });

/** Assign Perplexity-style numbers to an answer's unique citations, in order of first use. */
function buildCitationNumbers(parsed: ParsedOutput): Map<string, number> {
  const numbers = new Map<string, number>();
  const texts = [parsed.bluf || '', ...parsed.steps.map(step => step.content)];
  for (const text of texts) {
    for (const ref of extractCitations(text)) {
      if (!numbers.has(ref.key)) numbers.set(ref.key, numbers.size + 1);
    }
  }
  return numbers;
}

function routeKindOf(item: SourcePlanItem): CitationRef['citeClass'] | null {
  const label = item.label;
  if (/deviation/i.test(label)) return 'deviation';
  if (/pgi/i.test(label)) return 'pgi';
  if (/^DFARS RFO/i.test(label)) return 'dfars-overlay';
  if (/^RFO FAR/i.test(label)) return 'controlling';
  return null;
}

/**
 * Resolve a citation in the answer text to the route-plan item behind it,
 * and to that item's index in the Evidence Snapshot list (status R +
 * excerpt — the same filter EvidenceSnapshot renders).
 */
function resolveCitationEvidence(
  citation: CitationRef,
  items: SourcePlanItem[],
): { item: SourcePlanItem; evidenceIndex: number } | null {
  const evidenceItems = items.filter(item => item.status === 'R' && item.excerpt);
  const evidenceIndexOf = (item: SourcePlanItem) => evidenceItems.indexOf(item);

  let candidates = items.filter(item => {
    if (citation.citeClass === 'deviation') return routeKindOf(item) === 'deviation';
    if (!citation.part) return false;
    return new RegExp(`Part ${citation.part}\\b`).test(item.label);
  });
  if (!candidates.length && citation.citeClass === 'deviation') {
    candidates = items.filter(item => routeKindOf(item) === 'deviation');
  }
  const sameKind = candidates.filter(item => routeKindOf(item) === citation.citeClass);
  const pool = sameKind.length ? sameKind : candidates;
  const pick =
    pool.find(item => evidenceIndexOf(item) >= 0)
    || pool.find(item => item.status === 'R')
    || pool[0];
  if (!pick) return null;
  return { item: pick, evidenceIndex: evidenceIndexOf(pick) };
}

/** Index of the first retrieved approved controlling evidence item, for the BLUF "verified" link. */
function controllingEvidenceIndex(items?: SourcePlanItem[]): number {
  if (!items) return -1;
  const evidenceItems = items.filter(item => item.status === 'R' && item.excerpt);
  const controlling = items.find(item =>
    item.status === 'R' && item.excerpt && isApprovedSource(item.label, item.url) && routeKindOf(item) === 'controlling');
  return controlling ? evidenceItems.indexOf(controlling) : -1;
}

const EVIDENCE_HIGHLIGHT_EVENT = 'armor:highlight-evidence';

function highlightEvidence(evidenceIndex: number) {
  window.dispatchEvent(new CustomEvent(EVIDENCE_HIGHLIGHT_EVENT, { detail: { evidenceIndex } }));
}

function CitationChip({ citation }: { citation: CitationRef }) {
  const { numbers, items } = useContext(CitationContext);
  const number = numbers.get(citation.key);
  const resolved = resolveCitationEvidence(citation, items);
  const classLabel = CITATION_CLASS_LABELS[citation.citeClass];
  const title = resolved
    ? `${citation.raw} — ${classLabel}. Source: ${resolved.item.label}.`
    : `${citation.raw} — ${classLabel}.`;

  const chip = (
    <>
      {number ? <span className={styles.citeNum}>{number}</span> : null}
      <span className={styles.citeClass}>{classLabel}</span>
    </>
  );

  if (resolved && resolved.evidenceIndex >= 0) {
    return (
      <button
        type="button"
        className={`${styles.citeChip} ${styles[`cite-${citation.citeClass}`]}`}
        title={`${title} Show the retrieved passage.`}
        onClick={() => highlightEvidence(resolved.evidenceIndex)}
      >
        {chip}
      </button>
    );
  }
  if (resolved) {
    return (
      <a
        className={`${styles.citeChip} ${styles[`cite-${citation.citeClass}`]}`}
        href={sourceHref(resolved.item)}
        target="_blank"
        rel="noreferrer"
        title={`${title} Open the official source.`}
      >
        {chip}
      </a>
    );
  }
  return (
    <span className={`${styles.citeChip} ${styles[`cite-${citation.citeClass}`]}`} title={title}>
      {chip}
    </span>
  );
}

function RichContent({ content }: { content: string }) {
  const blocks = useMemo(() => parseRichContent(content), [content]);
  return (
    <div className={styles.richBody}>
      {blocks.map((block, blockIndex) => {
        if (block.type === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul';
          return (
            <ListTag key={blockIndex} className={styles.richList}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item)}</li>
              ))}
            </ListTag>
          );
        }
        return (
          <div key={blockIndex} className={styles.richPara}>
            {block.items.map((line, lineIndex) => (
              <span key={lineIndex} className={styles.richLine}>
                {renderInline(line)}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function renderInline(segments: ReturnType<typeof parseRichContent>[number]['items'][number]) {
  return segments.map((segment, index) => {
    if (segment.kind === 'citation' && segment.citation) {
      const chip = <CitationChip key={index} citation={segment.citation} />;
      return segment.bold ? <strong key={index}>{chip}</strong> : chip;
    }
    return segment.bold
      ? <strong key={index}>{segment.text}</strong>
      : <span key={index}>{segment.text}</span>;
  });
}

/* ------------------------------------------------------------------ */
/* Per-answer trust badge strip (Tier 2 #4) — every badge is computed  */
/* from this answer's actual route plan statuses, never hard-coded.   */
/* ------------------------------------------------------------------ */

function isLegacySource(item: SourcePlanItem) {
  const label = item.label.toLowerCase();
  const url = item.url.toLowerCase();
  if (label.includes('rfo') || label.includes('deviation')) return false;
  if (/^far part/.test(label)) return true;
  // A current-FAR path segment that is not part of the far-overhaul tree.
  if (url.includes('/far/') && !url.includes('far-overhaul')) return true;
  return false;
}

function badgeState(items: SourcePlanItem[], match: (item: SourcePlanItem) => boolean): 'ok' | 'utr' | null {
  const matched = items.filter(match);
  if (!matched.length) return null;
  return matched.some(item => item.status === 'R') ? 'ok' : 'utr';
}

function TrustBadges({ items }: { items?: SourcePlanItem[] }) {
  if (!items || !items.length) return null;
  // Badges describe what actually happened; while everything is still
  // 'planned' there is nothing earned to show yet.
  if (!items.some(item => item.status !== 'planned')) return null;

  const badges: Array<{ label: string; state: 'ok' | 'utr' | 'neutral' }> = [];
  const far = badgeState(items, item => routeKindOf(item) === 'controlling');
  if (far) badges.push({ label: far === 'ok' ? 'RFO FAR — live-fetched' : 'RFO FAR — unavailable', state: far });
  const dfars = badgeState(items, item => routeKindOf(item) === 'dfars-overlay');
  if (dfars) badges.push({ label: dfars === 'ok' ? 'DFARS RFO — checked' : 'DFARS RFO — unavailable', state: dfars });
  const pgi = badgeState(items, item => routeKindOf(item) === 'pgi');
  if (pgi) badges.push({ label: pgi === 'ok' ? 'DFARS PGI — checked' : 'DFARS PGI — unavailable', state: pgi });
  const deviations = badgeState(items, item => routeKindOf(item) === 'deviation');
  if (deviations) badges.push({ label: deviations === 'ok' ? 'Class deviations — checked' : 'Class deviations — unavailable', state: deviations });
  if (!items.some(isLegacySource)) badges.push({ label: 'Legacy FAR — not used', state: 'neutral' });

  if (!badges.length) return null;
  return (
    <div className={styles.trustStrip} aria-label="How this answer was sourced">
      {badges.map(badge => (
        <span key={badge.label} className={`${styles.trustBadge} ${styles[`trust-${badge.state}`]}`}>
          {badge.state === 'ok' ? '✓ ' : badge.state === 'utr' ? '✗ ' : ''}{badge.label}
        </span>
      ))}
    </div>
  );
}

function BlufCard({
  content,
  hasApproved = true,
  verifiedEvidenceIndex = -1,
}: {
  content: string;
  hasApproved?: boolean;
  verifiedEvidenceIndex?: number;
}) {
  const parsedTone = blufTone(content);
  // BLUF integrity guard (UI): a Definitive label cannot stand when no
  // approved controlling source was retrieved, and an unlabeled BLUF is
  // never assumed Definitive — it renders as Non-Definitive (unverified).
  const downgraded = parsedTone === 'def' && !hasApproved;
  const tone = downgraded || parsedTone === 'unknown' ? 'nd' : parsedTone;
  const label = tone === 'nd'
    ? (parsedTone === 'unknown' ? 'Non-Definitive (unverified)' : 'Non-Definitive')
    : tone === 'cond' ? 'Conditional' : 'Definitive';
  const earnedDefinitive = tone === 'def' && !downgraded;

  return (
    <section className={`${styles.blufCard} ${styles[`bluf-${tone}`]}`}>
      <div className={styles.cardKicker}>0) BLUF</div>
      <div className={styles.blufTop}>
        <span className={`${styles.determination} ${styles[`det-${tone}`]}`}>{label}</span>
        {earnedDefinitive ? (
          verifiedEvidenceIndex >= 0 ? (
            <button
              type="button"
              className={`${styles.sourceChip} ${styles.sourceChipVerified}`}
              onClick={() => highlightEvidence(verifiedEvidenceIndex)}
              title="Show the retrieved controlling passage in the Evidence Snapshot"
            >
              Controlling cite verified
            </button>
          ) : (
            <span className={`${styles.sourceChip} ${styles.sourceChipVerified}`}>Controlling cite verified</span>
          )
        ) : (
          <span className={styles.sourceChip}>Control cite required</span>
        )}
      </div>
      <RichContent content={content} />
      {downgraded && (
        <p className={styles.guardNote}>Downgraded by the ARMOR guard: no approved controlling source text was retrieved for this answer, so it cannot be presented as Definitive.</p>
      )}
    </section>
  );
}

function StepBlock({ num, title, content }: { num: string; title: string; content: string }) {
  const [open, setOpen] = useState(['3A', '3B', '5', '6', '7'].includes(num));
  return (
    <section className={styles.stepItem} data-open={open ? 'true' : 'false'}>
      <button className={styles.stepToggle} onClick={() => setOpen(value => !value)} aria-expanded={open}>
        <span className={styles.stepNum}>STEP {num}</span>
        <span className={styles.stepTitle}>{title}</span>
        <span className={styles.chevron}>{open ? '−' : '+'}</span>
      </button>
      {/* Body stays mounted (CSS-collapsed) so the print stylesheet can file the full answer. */}
      <div className={styles.stepBody}>
        <RichContent content={content} />
      </div>
    </section>
  );
}

function AssistantAnswer({
  content,
  parsed,
  responseMode = 'first_turn_full_analysis',
  hasApproved = true,
  routePlan,
}: {
  content: string;
  parsed?: ParsedOutput | null;
  responseMode?: ResponseMode;
  hasApproved?: boolean;
  routePlan?: SourcePlanItem[];
}) {
  // Render from a markup-preserving parse of the raw answer so **bold**
  // survives into the rich renderer; structure is identical to `parsed`.
  const richParsed = useMemo(() => parseArmorOutputRich(content), [content]);
  const effective = richParsed.bluf || richParsed.steps.length > 0 ? richParsed : parsed;
  const hasStructured = Boolean(effective && (effective.bluf || effective.steps.length > 0));
  const citationContext = useMemo<CitationContextValue>(
    () => ({
      numbers: effective ? buildCitationNumbers(effective) : new Map<string, number>(),
      items: routePlan || [],
    }),
    [effective, routePlan],
  );

  if (!hasStructured || !effective) {
    // Follow-up / plain rendering: the rich renderer turns **bold** into
    // real bold and strips heading hashes, so no literal markup shows.
    return (
      <div className={`${styles.rawCard} ${responseMode === 'follow_up_concise_continuation' ? styles.conciseCard : ''}`}>
        <CitationContext.Provider value={citationContext}>
          <RichContent content={content} />
        </CitationContext.Provider>
      </div>
    );
  }

  return (
    <CitationContext.Provider value={citationContext}>
      <TrustBadges items={routePlan} />
      {effective.bluf && (
        <BlufCard
          content={effective.bluf}
          hasApproved={hasApproved}
          verifiedEvidenceIndex={controllingEvidenceIndex(routePlan)}
        />
      )}
      <div className={styles.stepsWrap}>
        {effective.steps.map(step => <StepBlock key={`${step.num}-${step.title}`} {...step} />)}
      </div>
    </CitationContext.Provider>
  );
}

function ConversationMessage({
  turn,
  onShowFullAnalysis,
  pending = false,
}: {
  turn: ChatTurn;
  onShowFullAnalysis: () => void;
  pending?: boolean;
}) {
  if (turn.role === 'user') {
    return (
      <article className={`${styles.chatMessage} ${styles.userMessage}`}>
        <div className={styles.messageRole}>You</div>
        <p>{turn.content}</p>
      </article>
    );
  }

  return (
    <article className={`${styles.chatMessage} ${styles.assistantMessage}`}>
      <div className={styles.messageRole}>
        <span>ARMOR</span>
        {turn.timestamp && <small>{turn.timestamp}</small>}
      </div>
      {pending ? (
        <PendingProgress items={turn.routePlan || []} model={turn.model || 'the selected model'} />
      ) : turn.content ? (
        <>
          <AssistantAnswer
            content={turn.content}
            parsed={turn.parsed}
            responseMode={turn.responseMode}
            hasApproved={turn.routePlan ? hasApprovedControlling(turn.routePlan) : true}
            routePlan={turn.routePlan}
          />
          {turn.responseMode === 'follow_up_concise_continuation' && (
            <button className={styles.showFullBtn} type="button" onClick={onShowFullAnalysis}>
              Show full analysis
            </button>
          )}
        </>
      ) : (
        <PendingProgress items={turn.routePlan || []} model={turn.model || 'the selected model'} />
      )}
    </article>
  );
}

function ChatHistory({
  sessions,
  activeSessionId,
  onOpen,
}: {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onOpen: (session: ChatSession) => void;
}) {
  return (
    <div className={styles.historyBlock}>
      <div className={styles.historyHeader}>
        <span>Recent chats</span>
        <small>Saved on this browser</small>
      </div>
      {sessions.length ? (
        <div className={styles.historyList}>
          {sessions.slice(0, 8).map(session => (
            <button
              key={session.id}
              className={`${styles.historyItem} ${session.id === activeSessionId ? styles.historyItemActive : ''}`}
              onClick={() => onOpen(session)}
            >
              <span>{session.title}</span>
              <small>{formatSessionTime(session.updatedAt)}</small>
            </button>
          ))}
        </div>
      ) : (
        <p className={styles.historyEmpty}>Your saved chats will appear here.</p>
      )}
    </div>
  );
}

function SourcesEvidencePanel({
  items,
  streaming,
  done,
  model,
}: {
  items: SourcePlanItem[];
  streaming: boolean;
  done: boolean;
  model: string;
}) {
  return (
    <aside className={styles.proofPanel}>
      <div className={styles.panelHeader}>
        <span>Sources / Evidence</span>
      </div>
      <div className={styles.sourceList}>
        {items.map((item, index) => (
          <a key={`${item.label}-${index}`} href={sourceHref(item)} target="_blank" rel="noreferrer" className={styles.sourceItem}>
            <span className={`${styles.sourceStatus} ${styles[`status-${item.status}`]}`}>{statusLabel(item.status)}</span>
            <strong>{item.label}</strong>
            <small>{item.reason}</small>
            {item.excerpt && <em>{item.excerpt}</em>}
          </a>
        ))}
      </div>

      {(streaming || done) && (
        <>
          <div className={styles.desktopTrace}>
            <ResearchTrace items={items} streaming={streaming} done={done} model={model} defaultOpen />
          </div>
          <EvidenceSnapshot items={items} />
        </>
      )}
    </aside>
  );
}

function EvidenceSnapshot({ items }: { items: SourcePlanItem[] }) {
  const evidenceItems = items.filter(item => item.status === 'R' && item.excerpt);
  const [highlighted, setHighlighted] = useState(-1);

  // Citation chips and the BLUF "verified" link ask us to spotlight the
  // passage behind a claim; scroll it into view and mark it briefly.
  useEffect(() => {
    let timer = 0;
    const onHighlight = (event: Event) => {
      const evidenceIndex = (event as CustomEvent<{ evidenceIndex: number }>).detail?.evidenceIndex;
      if (typeof evidenceIndex !== 'number' || evidenceIndex < 0) return;
      setHighlighted(evidenceIndex);
      window.setTimeout(() => {
        document.getElementById(`evidence-${evidenceIndex}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 0);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setHighlighted(-1), 2600);
    };
    window.addEventListener(EVIDENCE_HIGHLIGHT_EVENT, onHighlight);
    return () => {
      window.removeEventListener(EVIDENCE_HIGHLIGHT_EVENT, onHighlight);
      window.clearTimeout(timer);
    };
  }, []);

  if (!evidenceItems.length) return null;

  return (
    <section className={styles.evidencePanel}>
      <div className={styles.evidenceHeader}>
        <span>Evidence Snapshot</span>
        <small>Exact retrieved text used as proof</small>
      </div>
      <div className={styles.evidenceList}>
        {evidenceItems.map((item, index) => (
          <article
            key={`${item.label}-${index}`}
            id={`evidence-${index}`}
            className={`${styles.evidenceItem} ${highlighted === index ? styles.evidenceHighlight : ''}`}
          >
            <div className={styles.evidenceMeta}>
              <strong>{item.label}</strong>
              <a href={sourceHref(item)} target="_blank" rel="noreferrer">Open source</a>
            </div>
            <blockquote>{item.excerpt}</blockquote>
          </article>
        ))}
      </div>
    </section>
  );
}

function ResearchTrace({
  items,
  streaming,
  done,
  model,
  defaultOpen = false,
}: {
  items: SourcePlanItem[];
  streaming: boolean;
  done: boolean;
  model: string;
  defaultOpen?: boolean;
}) {
  const rows = buildTraceRows(items, streaming, done, model);
  const [open, setOpen] = useState(defaultOpen);

  return (
    <details
      className={styles.tracePanel}
      open={open}
      onToggle={event => setOpen(event.currentTarget.open)}
    >
      <summary className={styles.traceHeader}>
        <span>Research Trace</span>
        <small>Visible audit path</small>
      </summary>
      <div className={styles.traceRows}>
        {rows.map(row => (
          <div key={row.label} className={styles.traceRow}>
            <span className={`${styles.traceDot} ${styles[`trace-${row.state}`]}`} />
            <div>
              <strong>{row.label}</strong>
              <small>{row.detail}</small>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

export default function Home() {
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [rawOutput, setRawOutput] = useState('');
  const [parsed, setParsed] = useState<ParsedOutput | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [timestamp, setTimestamp] = useState('');
  const [routePlan, setRoutePlan] = useState<SourcePlanItem[]>(routePreview(''));
  const [model, setModel] = useState('');
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const rawRef = useRef('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const conversationEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setChatSessions(readChatSessions());
    setHistoryLoaded(true);
  }, []);

  useEffect(() => {
    if (!taRef.current) return;
    taRef.current.style.height = 'auto';
    taRef.current.style.height = `${Math.min(taRef.current.scrollHeight, 190)}px`;
  }, [question]);

  const preview = useMemo(() => routePreview(routingContext(turns, question)), [turns, question]);
  const visibleRoute = routePlan.some(item => item.status !== 'planned') ? routePlan : preview;
  const hasConversation = turns.length > 0 || streaming || done;

  useEffect(() => {
    if (!streamRef.current || !hasConversation) return;
    conversationEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [turns, rawOutput, streaming, hasConversation]);

  useEffect(() => {
    if (!historyLoaded || !activeSessionId || !turns.some(turn => turn.content.trim())) return;
    const now = new Date().toISOString();

    setChatSessions(previous => {
      const existing = previous.find(session => session.id === activeSessionId);
      const savedTurns = turns
        .filter(turn => turn.content.trim().length > 0)
        .map(turn => ({
          ...turn,
          parsed: turn.role === 'assistant' && turn.content ? turn.parsed || parseArmorOutput(turn.content) : turn.parsed,
        }));

      const nextSession: ChatSession = {
        id: activeSessionId,
        title: chatTitleFromTurns(savedTurns),
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        turns: savedTurns,
        model,
      };
      const next = [nextSession, ...previous.filter(session => session.id !== activeSessionId)].slice(0, MAX_SAVED_CHATS);
      writeChatSessions(next);
      return next;
    });
  }, [activeSessionId, historyLoaded, model, turns]);

  const setDemo = useCallback((index: number) => {
    setQuestion(DEMO_QUESTIONS[index]);
    setError('');
    setRoutePlan(routePreview(DEMO_QUESTIONS[index]));
  }, []);

  const startNewChat = useCallback(() => {
    setQuestion('');
    setTurns([]);
    setActiveSessionId(null);
    setActiveTurnId(null);
    setStreaming(false);
    setRawOutput('');
    setParsed(null);
    setError('');
    setDone(false);
    setCopied(false);
    setTimestamp('');
    rawRef.current = '';
    setRoutePlan(routePreview(''));
    taRef.current?.focus();
  }, []);

  const openChatSession = useCallback((session: ChatSession) => {
    const restoredTurns = session.turns.map(normalizeStoredTurn);
    const lastAssistant = [...restoredTurns].reverse().find(turn => turn.role === 'assistant' && turn.content);
    const restoredRoute = lastAssistant?.routePlan || routePreview(routingContext(restoredTurns, ''));
    const restoredParsed = lastAssistant?.parsed || (lastAssistant?.content ? parseArmorOutput(lastAssistant.content) : null);

    setActiveSessionId(session.id);
    setTurns(restoredTurns);
    setQuestion('');
    setActiveTurnId(null);
    setStreaming(false);
    setError('');
    setDone(Boolean(lastAssistant));
    setCopied(false);
    setRawOutput(lastAssistant?.content || '');
    rawRef.current = lastAssistant?.content || '';
    setParsed(restoredParsed);
    setTimestamp(lastAssistant?.timestamp || '');
    setRoutePlan(restoredRoute);
    if (session.model || lastAssistant?.model) setModel(session.model || lastAssistant?.model || model);
  }, [model]);

  const requestFullAnalysis = useCallback(() => {
    setQuestion('Show full analysis for the prior answer, including the complete ARMOR STEP structure and final receipt.');
    window.setTimeout(() => taRef.current?.focus(), 0);
  }, []);

  const runAnalysis = useCallback(async () => {
    const prompt = question.trim();
    if (!prompt) {
      setError('Enter a contracting or acquisition regulation question first.');
      return;
    }

    setError('');
    setStreaming(true);
    setRawOutput('');
    setParsed(null);
    setDone(false);
    setCopied(false);
    const sessionId = activeSessionId || newTurnId();
    if (!activeSessionId) setActiveSessionId(sessionId);
    const history = compactChatHistory(turns);
    const userTurn: ChatTurn = { id: newTurnId(), role: 'user', content: prompt };
    const assistantTurnId = newTurnId();
    setActiveTurnId(assistantTurnId);
    const routeQuestion = routingContext(turns, prompt);
    let responseMode = responseModeForClient(prompt, turns);
    console.info('[ARMOR responseMode request]', responseMode);
    setTurns(current => [
      ...current,
      userTurn,
      { id: assistantTurnId, role: 'assistant', content: '', parsed: null, routePlan: routePreview(routeQuestion), model, responseMode },
    ]);
    setQuestion('');
    setRoutePlan(routePreview(routeQuestion));
    rawRef.current = '';
    const started = Date.now();
    let responseModel = model;
    let latestRoutePlan: SourcePlanItem[] | undefined;

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: prompt, messages: history, responseMode }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Server returned ${response.status}`);
      }

      const metaHeader = response.headers.get('x-armor-meta');
      if (metaHeader) {
        const meta = JSON.parse(decodeURIComponent(metaHeader)) as AnalyzeResponseMeta;
        if (meta.responseMode) responseMode = meta.responseMode;
        console.info('[ARMOR responseMode server]', responseMode);
        if (meta.routePlan?.length) {
          latestRoutePlan = meta.routePlan;
          setRoutePlan(meta.routePlan);
          setTurns(current => current.map(turn => (
            turn.id === assistantTurnId ? { ...turn, routePlan: meta.routePlan, model: meta.model || turn.model, responseMode } : turn
          )));
        }
        if (meta.model) {
          responseModel = meta.model;
          setModel(meta.model);
        }
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream was returned.');

      const decoder = new TextDecoder();
      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        for (const line of decoder.decode(value).split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;
          const json = JSON.parse(data) as { text?: string; meta?: AnalyzeResponseMeta; error?: string };
          if (json.error) throw new Error(json.error);
          if (json.meta) {
            if (json.meta.responseMode) responseMode = json.meta.responseMode;
            console.info('[ARMOR responseMode stream]', responseMode);
            if (json.meta.routePlan?.length) {
              latestRoutePlan = json.meta.routePlan;
              setRoutePlan(json.meta.routePlan);
              setTurns(current => current.map(turn => (
                turn.id === assistantTurnId ? { ...turn, routePlan: json.meta?.routePlan, model: json.meta?.model || turn.model, responseMode } : turn
              )));
            }
            if (json.meta.model) {
              responseModel = json.meta.model;
              setModel(json.meta.model);
            }
            continue;
          }
          if (!json.text) continue;
          rawRef.current += json.text;
          setRawOutput(rawRef.current);
          setTurns(current => current.map(turn => (
            turn.id === assistantTurnId ? { ...turn, content: rawRef.current, responseMode } : turn
          )));
          conversationEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
        }
      }

      // BLUF integrity guard: never store or copy out a Definitive BLUF
      // when no approved controlling source was retrieved for this answer.
      const guardedOutput = enforceDefinitiveGuard(rawRef.current, hasApprovedControlling(latestRoutePlan));
      if (guardedOutput !== rawRef.current) {
        rawRef.current = guardedOutput;
        setRawOutput(guardedOutput);
      }

      const finalParsed = parseArmorOutput(rawRef.current);
      const completed = `Completed in ${((Date.now() - started) / 1000).toFixed(1)}s`;
      setParsed(finalParsed);
      setTimestamp(completed);
      setTurns(current => current.map(turn => (
        turn.id === assistantTurnId
          ? { ...turn, content: rawRef.current, parsed: finalParsed, timestamp: completed, model: responseModel, responseMode }
          : turn
      )));
      setDone(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown analysis error.';
      setError(message);
      setTurns(current => current.filter(turn => turn.id !== assistantTurnId && turn.id !== userTurn.id));
      setQuestion(prompt);
    } finally {
      setStreaming(false);
      setActiveTurnId(null);
    }
  }, [activeSessionId, model, question, turns]);

  const copyOutput = useCallback(async () => {
    await navigator.clipboard.writeText(rawRef.current || rawOutput);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }, [rawOutput]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) runAnalysis();
  }, [runAnalysis]);

  const chatComposer = (
    <div className={styles.chatComposer}>
      <div className={styles.composerTitle}>
        <span>{hasConversation ? 'Continue this chat' : 'Ask ARMOR'}</span>
        <small>Ctrl/⌘ + Enter</small>
      </div>
      <textarea
        ref={taRef}
        className={styles.queryTextarea}
        placeholder={hasConversation ? 'Ask a follow-up, request more research, or tell ARMOR what to correct.' : 'Ask a DoD acquisition question.'}
        value={question}
        onChange={event => {
          setQuestion(event.target.value);
          setRoutePlan(routePreview(routingContext(turns, event.target.value)));
        }}
        onKeyDown={handleKeyDown}
        rows={5}
      />
      {!hasConversation && (
        <p className={styles.composerGuidance}>
          Include the facts, dates, dollar values, place of performance, contract type, and any named citation — ARMOR grounds its answer in the live regulation text.
        </p>
      )}
      <div className={styles.composerFooter}>
        <button className={styles.primaryBtn} onClick={runAnalysis} disabled={streaming}>
          {streaming ? 'Analyzing...' : hasConversation ? 'Send follow-up' : 'Run ARMOR analysis'}
        </button>
        <span>{hasConversation ? 'Follow-ups stay in this thread and build on the answers above.' : 'Answers are grounded in live RFO FAR / DFARS RFO text — never model memory.'}</span>
      </div>
    </div>
  );

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <div className={styles.logoMark}>
            <img src="/robot-fars.jpg" alt="ARMOR Plus robot research assistant" />
          </div>
          <div>
            <strong>ARMOR Plus</strong>
            <span>Acquisition Regulation Mission Operations Resource</span>
          </div>
          <svg className={styles.versionBadge} viewBox="0 0 40 40" role="img" aria-label="Version 2">
            <title>Version 2</title>
            <circle cx="20" cy="20" r="18" fill="#08245f" stroke="#b08d2e" strokeWidth="2.5" />
            <circle cx="20" cy="20" r="14.25" fill="none" stroke="#b08d2e" strokeWidth="0.75" opacity="0.55" />
            <text x="20" y="20" textAnchor="middle" dominantBaseline="central" fill="#b08d2e" fontSize="13.5" fontWeight="800" letterSpacing="0.5">V2</text>
          </svg>
        </div>
        <div className={styles.headerCredit}>
          Built by John Wahl and Heath Gross - A WarU Collaborative, supporting the acquisition workforce
        </div>
        <nav className={styles.topActions}>
          <span className={styles.livePill}>Live · RFO sources</span>
        </nav>
      </header>

      <main className={styles.workspace}>
        <section className={styles.composerPanel}>
          <div className={styles.panelHeader}>
            <span>Ask ARMOR</span>
            <button className={styles.textBtn} onClick={startNewChat} disabled={streaming || !hasConversation}>New chat</button>
            <small>Ctrl/⌘ + Enter</small>
          </div>
          <textarea
            aria-hidden="true"
            className={styles.queryTextarea}
            placeholder={hasConversation ? 'Ask a follow-up, request more research, or tell ARMOR what to correct.' : 'Ask a DoD acquisition question.'}
            value={question}
            onChange={event => {
              setQuestion(event.target.value);
              setRoutePlan(routePreview(routingContext(turns, event.target.value)));
            }}
            onKeyDown={handleKeyDown}
            rows={5}
          />
          <div className={styles.composerFooter}>
            <button className={styles.primaryBtn} onClick={runAnalysis} disabled={streaming}>
              {streaming ? 'Analyzing...' : hasConversation ? 'Send follow-up' : 'Run ARMOR analysis'}
            </button>
            <span>{hasConversation ? 'Follow-ups stay in this thread and build on the answers above.' : 'Answers are grounded in live RFO FAR / DFARS RFO text — never model memory.'}</span>
          </div>

          <div className={styles.capabilityStrip} aria-label="ARMOR capabilities">
            <span><i>1</i> Find controlling regulation</span>
            <span><i>2</i> Compare RFO FAR / DFARS</span>
            <span><i>3</i> Draft follow-on work</span>
          </div>

          <div className={styles.demoBlock}>
            <span>Regulatory research examples</span>
            {DEMO_LABELS.map((label, index) => (
              <button key={label} onClick={() => setDemo(index)}>{label}</button>
            ))}
          </div>

          <ChatHistory
            sessions={chatSessions}
            activeSessionId={activeSessionId}
            onOpen={openChatSession}
          />
        </section>

        <section className={styles.outputPanel}>
          <div className={styles.panelHeader}>
            <span>ARMOR Chat</span>
            {done && <button className={styles.secondaryBtn} onClick={copyOutput}>{copied ? 'Copied' : 'Copy output'}</button>}
          </div>

          {error && <div className={styles.errorCard}>{error}</div>}

          {!hasConversation && !error && (
            <div className={styles.emptyState}>
              <strong>Ready for a CAC-defensible answer.</strong>
              <span>ARMOR will classify the issue, fetch approved sources, run the two-pass gate, then return BLUF plus STEP validation.</span>
              <div className={styles.exampleCards}>
                {DEMO_LABELS.map((label, index) => (
                  <button key={label} type="button" className={styles.exampleCard} onClick={() => setDemo(index)}>
                    <span className={styles.exampleCardLabel}>{label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasConversation && (
            <div className={styles.conversationList} ref={streamRef}>
              {turns.map(turn => (
                <ConversationMessage
                  key={turn.id}
                  turn={turn}
                  onShowFullAnalysis={requestFullAnalysis}
                  pending={streaming && turn.id === activeTurnId}
                />
              ))}
              <div ref={conversationEndRef} />
            </div>
          )}

          {chatComposer}

          {(streaming || done) && (
            <div className={styles.mobileTrace}>
              <ResearchTrace items={visibleRoute} streaming={streaming} done={done} model={model} />
            </div>
          )}
        </section>

        <SourcesEvidencePanel items={visibleRoute} streaming={streaming} done={done} model={model} />
      </main>

      <div className={styles.poweredBadge} aria-label="Powered by AI by Heath">
        <img src="/heath-robot-badge.png" alt="" aria-hidden="true" />
        <span>powered by AI by Heath</span>
      </div>
    </div>
  );
}

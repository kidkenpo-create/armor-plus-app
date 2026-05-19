'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEMO_QUESTIONS } from '@/app/lib/armor-prompt';
import { findPracticeIssueRules, type SourceRequest } from '@/app/lib/practice-issue-rules';
import styles from './page.module.css';

interface ParsedOutput {
  bluf: string | null;
  steps: Array<{ num: string; title: string; content: string }>;
}

interface AnalyzeResponseMeta {
  routePlan?: SourcePlanItem[];
  model?: string;
}

interface SourcePlanItem {
  label: string;
  url: string;
  status: 'R' | 'UTR' | 'planned';
  reason: string;
  excerpt?: string;
}

const GITHUB_REPO = 'https://github.com/kidkenpo-create/ARMOR-plus';

function parseOutput(raw: string): ParsedOutput {
  const text = raw.replace(/\*\*/g, '');
  const result: ParsedOutput = { bluf: null, steps: [] };
  const bluf = text.match(/(?:^|\n)0\)\s*BLUF\s*[-:]\s*([\s\S]*?)(?=\nSTEP\s+1\s*[-:]|\n\nSTEP\s+1\s*[-:]|$)/i);
  if (bluf) result.bluf = bluf[1].trim();

  const re = /\nSTEP\s+(\d+[AB]?)\s*[-:]\s*([^\n]+)\n([\s\S]*?)(?=\nSTEP\s+\d+[AB]?\s*[-:]|$)/gi;
  let match;
  while ((match = re.exec(`\n${text}`)) !== null) {
    const content = match[3].trim();
    if (content) result.steps.push({ num: match[1], title: match[2].trim(), content });
  }
  return result;
}

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
    plan('ARMOR classifier', GITHUB_REPO, 'Question will be routed server-side'),
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
  return 'https://www.acquisition.gov/far-overhaul/far-part-deviation-guide/far-overhaul-part-1#FAR_1_107';
}

function plan(label: string, url: string, reason: string): SourcePlanItem {
  return { label, url, reason, status: 'planned' };
}

function statusLabel(status: SourcePlanItem['status']) {
  if (status === 'R') return 'Retrieved';
  if (status === 'UTR') return 'UTR';
  return 'Planned';
}

function BlufCard({ content }: { content: string }) {
  const lower = content.toLowerCase();
  const tone = lower.includes('non-definitive') ? 'nd' : lower.includes('conditional') ? 'cond' : 'def';
  const label = tone === 'nd' ? 'Non-Definitive' : tone === 'cond' ? 'Conditional' : 'Definitive';

  return (
    <section className={`${styles.blufCard} ${styles[`bluf-${tone}`]}`}>
      <div className={styles.cardKicker}>0) BLUF</div>
      <div className={styles.blufTop}>
        <span className={`${styles.determination} ${styles[`det-${tone}`]}`}>{label}</span>
        <span className={styles.sourceChip}>Control cite required</span>
      </div>
      <p>{content}</p>
    </section>
  );
}

function StepBlock({ num, title, content }: { num: string; title: string; content: string }) {
  const [open, setOpen] = useState(['3A', '3B', '5', '6', '7'].includes(num));
  return (
    <section className={styles.stepItem}>
      <button className={styles.stepToggle} onClick={() => setOpen(value => !value)}>
        <span className={styles.stepNum}>STEP {num}</span>
        <span className={styles.stepTitle}>{title}</span>
        <span className={styles.chevron}>{open ? '−' : '+'}</span>
      </button>
      {open && <pre className={styles.stepBody}>{content}</pre>}
    </section>
  );
}

function SourceRail({ items }: { items: SourcePlanItem[] }) {
  return (
    <aside className={styles.sourceRail}>
      <div className={styles.panelHeader}>
        <span>Source Route</span>
        <a href={GITHUB_REPO} target="_blank" rel="noreferrer">GitHub</a>
      </div>
      <div className={styles.sourceList}>
        {items.map((item, index) => (
          <a key={`${item.label}-${index}`} href={item.url} target="_blank" rel="noreferrer" className={styles.sourceItem}>
            <span className={`${styles.sourceStatus} ${styles[`status-${item.status}`]}`}>{statusLabel(item.status)}</span>
            <strong>{item.label}</strong>
            <small>{item.reason}</small>
            {item.excerpt && <em>{item.excerpt}</em>}
          </a>
        ))}
      </div>
    </aside>
  );
}

function EvidenceSnapshot({ items }: { items: SourcePlanItem[] }) {
  const evidenceItems = items.filter(item => item.status === 'R' && item.excerpt);

  if (!evidenceItems.length) return null;

  return (
    <section className={styles.evidencePanel}>
      <div className={styles.evidenceHeader}>
        <span>Evidence Snapshot</span>
        <small>Exact retrieved text used as proof</small>
      </div>
      <div className={styles.evidenceList}>
        {evidenceItems.map((item, index) => (
          <article key={`${item.label}-${index}`} className={styles.evidenceItem}>
            <div className={styles.evidenceMeta}>
              <strong>{item.label}</strong>
              <a href={item.url} target="_blank" rel="noreferrer">Open source</a>
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
}: {
  items: SourcePlanItem[];
  streaming: boolean;
  done: boolean;
  model: string;
}) {
  const fetched = items.filter(item => item.status === 'R').length;
  const total = items.length;
  const rows = [
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
      label: `Draft final with ${model}`,
      detail: 'BLUF, STEP 1-7, citations, validation notes',
      state: streaming ? 'active' : done ? 'done' : 'idle',
    },
  ];

  return (
    <section className={styles.tracePanel}>
      <div className={styles.traceHeader}>
        <span>Research Trace</span>
        <small>Visible audit path, not hidden model reasoning</small>
      </div>
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
    </section>
  );
}

export default function Home() {
  const [question, setQuestion] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [rawOutput, setRawOutput] = useState('');
  const [parsed, setParsed] = useState<ParsedOutput | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [timestamp, setTimestamp] = useState('');
  const [routePlan, setRoutePlan] = useState<SourcePlanItem[]>(routePreview(''));
  const [model, setModel] = useState('server configured');
  const rawRef = useRef('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!taRef.current) return;
    taRef.current.style.height = 'auto';
    taRef.current.style.height = `${Math.min(taRef.current.scrollHeight, 190)}px`;
  }, [question]);

  const preview = useMemo(() => routePreview(question), [question]);
  const visibleRoute = routePlan.some(item => item.status !== 'planned') ? routePlan : preview;

  const setDemo = useCallback((index: number) => {
    setQuestion(DEMO_QUESTIONS[index]);
    setError('');
    setDone(false);
    setParsed(null);
    setRawOutput('');
    setRoutePlan(routePreview(DEMO_QUESTIONS[index]));
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
    setRoutePlan(routePreview(prompt));
    rawRef.current = '';
    const started = Date.now();

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: prompt }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Server returned ${response.status}`);
      }

      const metaHeader = response.headers.get('x-armor-meta');
      if (metaHeader) {
        const meta = JSON.parse(decodeURIComponent(metaHeader)) as AnalyzeResponseMeta;
        if (meta.routePlan?.length) setRoutePlan(meta.routePlan);
        if (meta.model) setModel(meta.model);
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
          const json = JSON.parse(data) as { text?: string };
          if (!json.text) continue;
          rawRef.current += json.text;
          setRawOutput(rawRef.current);
          if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
        }
      }

      setParsed(parseOutput(rawRef.current));
      setTimestamp(`Completed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown analysis error.');
    } finally {
      setStreaming(false);
    }
  }, [question]);

  const copyOutput = useCallback(async () => {
    await navigator.clipboard.writeText(rawRef.current || rawOutput);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }, [rawOutput]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) runAnalysis();
  }, [runAnalysis]);

  const hasStructured = parsed && (parsed.bluf || parsed.steps.length > 0);

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
        </div>
        <nav className={styles.topActions}>
          <span className={styles.livePill}>{model}</span>
        </nav>
      </header>

      <main className={styles.workspace}>
        <section className={styles.composerPanel}>
          <div className={styles.panelHeader}>
            <span>Ask ARMOR</span>
            <small>Ctrl/⌘ + Enter</small>
          </div>
          <textarea
            ref={taRef}
            className={styles.queryTextarea}
            placeholder="Ask a DoD acquisition question. Include facts, dates, dollar values, place of performance, contract type, and any named citation."
            value={question}
            onChange={event => {
              setQuestion(event.target.value);
              setRoutePlan(routePreview(event.target.value));
            }}
            onKeyDown={handleKeyDown}
            rows={5}
          />
          <div className={styles.composerFooter}>
            <button className={styles.primaryBtn} onClick={runAnalysis} disabled={streaming}>
              {streaming ? 'Analyzing...' : 'Run ARMOR analysis'}
            </button>
            <span>Server-side key. Browser never sees `OPENAI_API_KEY`.</span>
          </div>

          <div className={styles.capabilityStrip} aria-label="ARMOR capabilities">
            <span><i>1</i> Find controlling regulation</span>
            <span><i>2</i> Compare RFO FAR / DFARS</span>
            <span><i>3</i> Draft follow-on work</span>
          </div>

          <div className={styles.demoBlock}>
            <span>Regulatory research examples</span>
            <button onClick={() => setDemo(0)}>Preaward debrief deadline</button>
            <button onClick={() => setDemo(1)}>EPW waiver rule</button>
            <button onClick={() => setDemo(2)}>Germany warranty clause</button>
            <button onClick={() => setDemo(3)}>Two-step sealed bidding</button>
          </div>
        </section>

        <SourceRail items={visibleRoute} />

        <section className={styles.outputPanel}>
          <div className={styles.panelHeader}>
            <span>Structured Determination</span>
            {done && <button className={styles.secondaryBtn} onClick={copyOutput}>{copied ? 'Copied' : 'Copy output'}</button>}
          </div>

          {error && <div className={styles.errorCard}>{error}</div>}

          {!streaming && !done && !error && (
            <div className={styles.emptyState}>
              <strong>Ready for a CAC-defensible answer.</strong>
              <span>ARMOR will classify the issue, fetch approved sources, run the two-pass gate, then return BLUF plus STEP validation.</span>
            </div>
          )}

          {(streaming || done) && (
            <>
              <ResearchTrace items={visibleRoute} streaming={streaming} done={done} model={model} />
              <EvidenceSnapshot items={visibleRoute} />
            </>
          )}

          {streaming && (
            <div className={styles.streamCard}>
              <div className={styles.streamHeader}>
                <span>Streaming ARMOR methodology</span>
                <i />
              </div>
              <div className={styles.streamBody} ref={streamRef}>
                {rawOutput}
                <span className={styles.cursor} />
              </div>
            </div>
          )}

          {done && (
            <div className={styles.results}>
              {hasStructured ? (
                <>
                  {parsed?.bluf && <BlufCard content={parsed.bluf} />}
                  <div className={styles.stepsWrap}>
                    {parsed?.steps.map(step => <StepBlock key={`${step.num}-${step.title}`} {...step} />)}
                  </div>
                </>
              ) : (
                <pre className={styles.rawCard}>{rawOutput}</pre>
              )}
              <div className={styles.timestamp}>{timestamp}</div>
            </div>
          )}
        </section>
      </main>

      <div className={styles.poweredBadge} aria-label="Powered by AI by Heath">
        <img src="/robot-fars.jpg" alt="" aria-hidden="true" />
        <span>powered by AI by Heath</span>
      </div>
    </div>
  );
}

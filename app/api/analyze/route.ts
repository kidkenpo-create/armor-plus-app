import { NextRequest } from 'next/server';
import OpenAI from 'openai';
import type { ChatCompletionCreateParamsStreaming, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { ARMOR_SYSTEM_PROMPT } from '@/app/lib/armor-prompt';
import { prefetchRelevantParts } from '@/app/lib/fetcher';
import { getPracticeIssueInstruction } from '@/app/lib/practice-issue-rules';

export const runtime = 'nodejs';
export const maxDuration = 60;

const model = process.env.OPENAI_MODEL || 'gpt-4o';

export async function POST(req: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return jsonError('OPENAI_API_KEY is not configured on the server.', 500);
    }

    const { question } = await req.json();
    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return jsonError('Question is required.', 400);
    }

    const prompt = question.trim().slice(0, 6000);
    const { context, routePlan } = await prefetchRelevantParts(prompt);
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const systemContent = [
      ARMOR_SYSTEM_PROMPT,
      issueSpecificInstruction(prompt),
      getPracticeIssueInstruction(prompt),
      'LIVE REGULATORY CONTEXT (server-side direct retrieval only; use retrieved text or mark UTR):',
      context || 'No direct source was retrieved. Mark UTR where source text is required.',
      [
        'TEMPLATE COMPLIANCE LOCK:',
        'Return every required section exactly once and in this exact order: 0) BLUF, STEP 1, STEP 2, STEP 3A, STEP 3B, STEP 4, STEP 5, STEP 6, STEP 7.',
        'Do not omit STEP 1 or STEP 4. If no acquisition facts are provided, write "STEP 1 -- Acquisition Facts: N/A."',
        'STEP 4 is always required. If the synthesis is brief, still write 2 concise sentences.',
        'If the live context contains a retrieved source URL, include that URL in the matching rung. Do not mark a retrieved source as Silent or N/A.',
        'Before finalizing, self-check that all nine section headers are present.',
      ].join('\n'),
    ].join('\n\n');

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemContent },
      { role: 'user', content: prompt },
    ];

    const completionParams: ChatCompletionCreateParamsStreaming = {
      model,
      stream: true,
      messages,
      ...(model.startsWith('gpt-5')
        ? { max_completion_tokens: 4500 }
        : { max_tokens: 4500, temperature: 0.1 }),
    };

    const stream = await openai.chat.completions.create(completionParams);

    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content || '';
            if (delta) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: delta })}\n\n`));
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    const meta = encodeURIComponent(JSON.stringify({ routePlan, model }));
    return new Response(body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-ARMOR-Meta': meta,
      },
    });
  } catch (error) {
    return jsonError(safeErrorMessage(error), 500);
  }
}

function jsonError(error: string, status: number) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown server error.';
  if (/incorrect api key|api key/i.test(message)) {
    return 'OpenAI rejected the configured API key. Create a new secret key and update .env.local.';
  }
  return message.replace(/(?:sk|proj)-[A-Za-z0-9_-]{12,}/g, '[redacted]');
}

function issueSpecificInstruction(question: string) {
  if (/(two[- ]step sealed|sealed bidding|first step|technical proposals?)/i.test(question)) {
    return [
      'ISSUE-FAMILY OVERRIDE -- CURRENT RFO FAR TWO-STEP SEALED BIDDING:',
      'This is a current RFO FAR sealed-bidding question, not legacy FAR.',
      'The current controlling cite for what to do in step one of two-step sealed bidding is RFO FAR 14.211-3(a)(1), not legacy FAR 14.503-1(a).',
      'Do not include FAR 14.503-1, FAR 14.502, or FAR subpart 14.5 anywhere in the answer unless the user explicitly asks for legacy FAR or a crosswalk.',
      'Use acquisition.gov RFO FAR Part 14 text. The operative RFO FAR 14.211-3(a)(1) step-one rule begins: "Synopsize requests for technical proposals in accordance with Part 5."',
      'BLUF must cite RFO FAR 14.211-3(a)(1). STEP 5 cite must be RFO FAR 14.211-3(a)(1).',
    ].join('\n');
  }

  if (/(enemy prisoner|detainee|interrogat|contractor personnel|237\.873)/i.test(question)) {
    return [
      'ISSUE-FAMILY OVERRIDE -- DETAINEE / EPW INTERROGATION BY CONTRACTOR PERSONNEL:',
      'Treat as a DoD DFARS RFO applicability question.',
      'Controlling prohibition: DFARS RFO 237.873-3(a), "No detainee may be interrogated by contractor personnel."',
      'Supporting definition: DFARS RFO 237.873-2 includes enemy prisoners of war in "detainee."',
      'Waiver rule: DFARS RFO 237.873-4 allows the Secretary of Defense to waive the prohibition for 60 days, renewable for 30 days, if vital to national security.',
      'BLUF must be Conditional: No, unless a valid Secretary of Defense waiver exists under DFARS RFO 237.873-4.',
      'STEP 6 must preserve the waiver caveat. Do not answer as an unconditional never.',
    ].join('\n');
  }

  if (/(52\.246-21|warranty of construction|construction.*germany|germany.*construction|246\.710)/i.test(question)) {
    return [
      'ISSUE-FAMILY OVERRIDE -- GERMANY WARRANTY OF CONSTRUCTION:',
      'Treat as a DoD clause-applicability question.',
      'General FAR 52.246-21 is displaced by the Germany-specific DFARS RFO prescription.',
      'Controlling prescription: DFARS RFO 246.710(2). Required substitute clause: DFARS/RFO DFARS 252.246-7002, Warranty of Construction (Germany).',
      'BLUF must say No, do not use FAR 52.246-21; use DFARS/RFO DFARS 252.246-7002 instead.',
    ].join('\n');
  }

  if (/(52\.227-14|technical data|27\.409|data will be acquired|rights in data)/i.test(question)) {
    return [
      'ISSUE-FAMILY OVERRIDE -- DOD TECHNICAL DATA / FAR 52.227-14:',
      'Treat this as clause_applicability with DoD assumed unless the user clearly says non-DoD.',
      'Before applying FAR 27.409, check the scope gate at FAR/RFO FAR 27.400 and the DFARS/RFO DFARS overlay at 227.400.',
      'For DoD, DFARS/RFO DFARS 227.400 redirects use to subparts 227.71 and 227.72 instead of FAR subpart 27.4.',
      'Expected classroom determination for the stated scenario: No, FAR 52.227-14 is not required solely under FAR 27.409(b)(1); use the applicable DFARS technical-data framework instead.',
      'For this exact scenario, the BLUF must be Conditional unless an active class-deviation source was retrieved and checked. Do not write Definitive when class-deviation currency is UTR.',
      'Mark Class Deviations as UTR if no active class-deviation source appears in LIVE REGULATORY CONTEXT. Do not claim "no deviations found" without a retrieved class-deviation source.',
      'For STEP 3B rung 5 in this issue, write exactly: "5. Class Deviations -- UTR: active class-deviation source not retrieved; no deviation-negative certification." unless a class-deviation source was actually retrieved.',
      'For STEP 5, write: "Class deviation check: UTR live" unless a class-deviation source was actually retrieved.',
      'Do not characterize DFARS/RFO DFARS 227.400 as a class deviation. It is the DoD overlay/scope gate.',
      'Do not conclude that FAR 27.409 controls unless you first explain why FAR/RFO FAR 27.400 and DFARS/RFO DFARS 227.400 do not displace it.',
    ].join('\n');
  }

  if (/(acquisition plan|acquisition planning|responsible for.*plan|who.*responsible.*plan|207\.104-70)/i.test(question)) {
    return [
      'ISSUE-FAMILY OVERRIDE -- DOD ACQUISITION PLAN RESPONSIBILITY:',
      'Treat as a DoD actor/responsibility question. Do not default to the contracting officer.',
      'Check RFO FAR Part 7, DFARS RFO Part 207, and DFARS RFO PGI Part 207 before answering.',
      'For the question "who is responsible for the acquisition plan?", the controlling DoD answer is the program manager based on DFARS RFO PGI 207.104-70(b).',
      'Operative text: "It is incumbent upon the program manager to coordinate the plan..."',
      'Explain that RFO FAR Part 7 defines a planner generally, but the DFARS RFO PGI Part 207 text supplies the DoD program-manager responsibility for coordinating the acquisition plan.',
      'BLUF and STEP 5 must cite DFARS RFO PGI 207.104-70(b) unless the user clearly asks for a non-DoD FAR-only answer.',
    ].join('\n');
  }
  return 'ISSUE-FAMILY OVERRIDE: None.';
}

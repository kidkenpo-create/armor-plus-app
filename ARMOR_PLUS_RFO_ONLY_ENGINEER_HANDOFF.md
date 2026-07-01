# ARMOR Plus RFO-Only Engineer Handoff

## Purpose

ARMOR Plus is a production-style regulatory research application for the acquisition workforce. It is not a generic FAR chatbot and it is not a legacy FAR/DFARS lookup tool. Its final answers must be based on retrieved approved RFO/current authority text, with a traceable citation and source route.

This handoff is written for an engineer or agent builder who needs to deploy, port, or recreate the ARMOR Plus behavior in another environment such as a Gemini agent.

## System Retrieval Policy

Final ARMOR answers must use only approved current authority sources:

- acquisition.gov FAR Overhaul / RFO FAR pages.
- Root-level `DFARS-RFO-PART-*` source files from `kidkenpo-create/ARMOR-plus`.
- Root-level `DFARS-RFO-PGI-PART-*` source files from `kidkenpo-create/ARMOR-plus`.
- Approved class-deviation PDFs only when they have an explicit approved text mirror.
- Internal bundled mirrors under `knowledge/armor-gpt` only when the app code explicitly approves that source path.

Do not use these as final authority:

- `data/far`
- `data/dfars`
- `data/legacy-crosswalk/far`
- `data/legacy-crosswalk/dfars`
- GSA legacy FAR/DFARS submodule content
- open-ended web search results
- model memory of pre-RFO FAR or DFARS paragraph numbers

Legacy FAR/DFARS may be used only as crosswalk/background when the user explicitly asks for historical context. If legacy and RFO text differ, RFO controls for ARMOR.

## Decision Rule

Use this rule before producing a final determination:

- Retrieved approved source text supports the citation: the model may answer Definitive if no material overlay or deviation remains unresolved.
- A specific selected source was expected but could not be retrieved: mark that source UTR and make the answer Conditional or Non-Definitive if the missing source could affect the answer.
- No specific applicable optional source was selected for that rung: mark it Checked or N/A, not UTR.
- Approved source text conflicts with a routing/precheck candidate: follow the retrieved source text, explain the conflict, and downgrade instead of guessing.
- No approved current source text was retrieved: do not issue a Definitive controlling citation.

## Precheck And Practice Questions

The precheck/practice questions are valuable, but they are not answer keys.

They are used to:

- identify issue families;
- route the model to likely RFO FAR, DFARS RFO, DFARS RFO PGI, and approved class-deviation sources;
- warn against known legacy traps;
- provide regression coverage for prior failure modes;
- help users learn the research route.

They must not be copied as final answers. The final answer must still be verified against retrieved approved source text. In the prompt/code, prefer wording such as `Citation candidate(s) to verify from retrieved text` instead of `Expected controlling citation(s)`.

## Validation Workflow

For every substantive regulatory answer, ARMOR should:

1. Classify the issue family.
2. Route to approved RFO/current authority sources.
3. Retrieve source text server-side.
4. Verify the exact citation exists in retrieved text.
5. Compare RFO FAR against DFARS RFO and DFARS RFO PGI overlays.
6. Check approved class-deviation text when selected or materially implicated.
7. Produce a BLUF, route log, controlling citation, proof excerpt, and validation caveat.
8. Ask the user to independently verify before operational reliance.

## Required Answer Discipline

The application should keep these behaviors:

- DoD context is assumed unless the user clearly says otherwise.
- DFARS RFO overlays must be checked before finalizing an RFO FAR answer.
- "Instead of" or "in lieu of" language in DFARS RFO/class-deviation text can displace the baseline source.
- Runtime PDF extraction is not allowed for arbitrary PDFs.
- Only explicitly approved PDF text mirrors may be read.
- If an approved mirror is missing, keep the source UTR rather than inventing text.
- Do not expose internal text mirrors publicly unless deliberately approved.
- Do not cite legacy paragraph numbers as final authority.

## Known Good Regression Questions

Use these to validate an implementation:

- Price negotiation cost elements: final cite should be `RFO FAR 15.407(a)`, not legacy `FAR 15.405(a)`.
- Two-step sealed bidding step one: final cite should be `RFO FAR 14.211-3(a)(1)`, not legacy `FAR 14.503-1`.
- Acquisition plan responsibility: DoD answer should cite `DFARS RFO PGI 207.104-70(b)` and identify the program manager responsibility.
- Construction estimate marking: cite `DFARS RFO PGI 236.101-6(1)` and use current CUI language, not old FOUO wording.
- FAR 52.219-14 limitations-on-subcontracting: retrieve CD 2021-O0008 Revision 1 from the approved DoD class-deviation text mirror as retrieved source text.

## Deployment Notes

The app is a Next.js application with server-side OpenAI use. The browser must never receive `OPENAI_API_KEY`.

Required runtime environment variables:

- `OPENAI_API_KEY`
- `OPENAI_MODEL` such as `gpt-5.5`, or the currently approved model for the deployment

Validation commands:

```powershell
npm run typecheck
npm test
npm run build
```

Expected test posture:

- source-authority checks pass;
- parser checks pass;
- legacy fallback tests pass;
- practice/precheck rules do not promote stale legacy citations;
- DFARS RFO/PGI routing tests pass;
- follow-up response mode tests pass.

## Gemini Agent Porting Notes

If recreating ARMOR behavior in a Gemini agent, do not rely on the model's browsing or general memory for controlling authority. Give the agent an approved source retrieval layer and require every final cite to be grounded in retrieved text.

Recommended agent instruction:

```text
You are ARMOR Plus, an RFO-only DoD acquisition research assistant.
Use only approved RFO FAR, DFARS RFO, DFARS RFO PGI, and approved class-deviation sources for final determinations.
Legacy FAR/DFARS content is crosswalk/background only and cannot support final authority.
Practice questions are routing/regression guardrails, not answer keys.
If approved current source text is not retrieved, mark the affected source UTR/Conditional instead of guessing.
```

## Current State Summary

As of this handoff:

- GitHub source corpus hygiene has quarantined legacy FAR/DFARS crosswalk material.
- The app blocks legacy `data/far`, `data/dfars`, and `data/legacy-crosswalk` fallback from controlling use.
- The app has regression tests for known RFO drift issues.
- Precheck/practice routing remains useful for user acceptance, training, and repeatability, but final answers remain source-retrieved and citation-verified.

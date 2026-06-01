# Follow-Up Mode Validation

Branch: `codex/follow-up-ux`

Purpose: confirm continued-chat response mode behavior without changing source retrieval authority.

Diagnosis:

- `app/page.tsx` previously sent chat history but did not send an explicit response mode to `/api/analyze`.
- `app/api/analyze/route.ts` inferred follow-up mode server-side, then combined the concise instruction with `ARMOR_SYSTEM_PROMPT`.
- `app/lib/armor-prompt.ts` contains hard full-output language: `NO STEP SKIPPING`, `Full STEP template always required`, and `OUTPUT (exact template -- never deviate)`.
- Because the full ARMOR prompt was still present in concise mode, the model could follow the stronger full-template instruction even when the inferred mode was concise.

Fix:

- The client now sends one explicit `responseMode` with each request:
  - `first_turn_full_analysis`
  - `follow_up_concise_continuation`
  - `force_full_analysis`
- The server still validates/overrides the requested mode when source confidence, citation change, issue-family change, or class-deviation materiality requires full analysis.
- Concise continuation mode now uses a mode-specific system prompt that preserves source authority internally without including the global full STEP output mandate.
- Development diagnostics log response mode in the browser console as `[ARMOR responseMode request]`, `[ARMOR responseMode server]`, and `[ARMOR responseMode stream]`.

Manual validation checklist:

- First question in a new chat returns `first_turn_full_analysis` and displays the full ARMOR structure: BLUF, STEP 1-7, rungs, verification, and user validation.
- Routine same-topic follow-up returns `follow_up_concise_continuation` and displays only: BLUF, What changed, Updated determination, Key citation(s), Validation question if needed.
- Routine same-topic follow-up does not display full Rungs 1-8, STEP 1-7, Final Receipt, or Self-Verification unless the model identifies a full-analysis trigger.
- `Run the full ARMOR analysis again` returns `force_full_analysis` and displays the full ARMOR structure.
- `New chat` resets the thread, so the next submitted question returns `first_turn_full_analysis`.
- `Show full analysis` inserts an explicit full-analysis request for the prior answer.

Latest local validation:

- Production-mode mocked UI check passed.
- Request body modes observed in order: `first_turn_full_analysis`, `follow_up_concise_continuation`, `force_full_analysis`.
- Observed sequence: `user > assistant > user > assistant > composer`.
- First assistant response included full STEP output through STEP 7.
- Same-topic follow-up included concise headings and did not include full rungs, Final Receipt, or Self-Verification.
- `Run the full ARMOR analysis again` produced full STEP output through STEP 7.
- `Show full analysis` was visible on the concise follow-up response.

Implementation note:

- The server still performs the same source routing and source-authority checks before selecting the visible response mode.
- Retrieval/source-authority logic in `app/lib/fetcher.ts` and `app/lib/source-registry.ts` is unchanged.

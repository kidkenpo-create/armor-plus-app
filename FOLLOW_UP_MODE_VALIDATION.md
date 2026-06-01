# Follow-Up Mode Validation

Branch: `codex/follow-up-ux`

Purpose: confirm continued-chat response mode behavior without changing source retrieval authority.

Manual validation checklist:

- First question in a new chat returns `first_turn_full_analysis` and displays the full ARMOR structure: BLUF, STEP 1-7, rungs, verification, and user validation.
- Routine same-topic follow-up returns `follow_up_concise_continuation` and displays only: BLUF, What changed, Updated determination, Key citation(s), Validation question if needed.
- Routine same-topic follow-up does not display full Rungs 1-8, STEP 1-7, Final Receipt, or Self-Verification unless the model identifies a full-analysis trigger.
- `New chat` resets the thread, so the next submitted question returns `first_turn_full_analysis`.
- `Show full analysis` inserts an explicit full-analysis request for the prior answer.

Latest local validation:

- Production-mode mocked UI check passed.
- Observed sequence: `user > assistant > user > assistant > composer`.
- First assistant response included full STEP output through STEP 7.
- Same-topic follow-up included concise headings and did not include full rungs, Final Receipt, or Self-Verification.
- `Show full analysis` was visible on the concise follow-up response.

Implementation note:

- The server still performs the same source routing and source-authority checks before selecting the visible response mode.
- Retrieval/source-authority logic in `app/lib/fetcher.ts` and `app/lib/source-registry.ts` is unchanged.

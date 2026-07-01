import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('ARMOR GPT knowledge files are normalized under knowledge/armor-gpt', () => {
  const files = [
    'knowledge/armor-gpt/02_FAR_Competition_and_Sealed_Bidding.txt',
    'knowledge/armor-gpt/master_index.json',
    'knowledge/armor-gpt/part_lookup.json',
    'knowledge/armor-gpt/REF_1_Citation_Decision_Tree.txt',
    'knowledge/armor-gpt/REF_3_RFO_Conventions.txt',
  ];

  for (const file of files) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} should exist`);
  }
});

test('DoD class deviations use one public PDF and one internal text mirror', () => {
  const publicPdfPath = 'public/knowledge/armor-gpt/DoD_Class_Deviations_FY26v04_dated_2Feb2026.pdf';
  const privatePdfPath = 'knowledge/armor-gpt/DoD_Class_Deviations_FY26v04_dated_2Feb2026.pdf';
  const mirrorPath = 'knowledge/armor-gpt/pdf-text/DoD_Class_Deviations_FY26v04_dated_2Feb2026.txt';
  const oneOffMirrorPath = 'knowledge/armor-gpt/pdf-text/CD-2021-O0008-Revision-1-Limitations-on-Subcontracting.txt';
  const publicPdf = path.join(root, publicPdfPath);
  const mirror = read(mirrorPath);

  assert.ok(fs.existsSync(publicPdf), 'official DoD FY26v04 citation PDF should be served from public/');
  assert.ok(fs.statSync(publicPdf).size > 1_000_000, 'official public PDF should be the full source artifact');
  assert.ok(fs.existsSync(path.join(root, mirrorPath)), 'approved internal text mirror should exist');
  assert.ok(!fs.existsSync(path.join(root, privatePdfPath)), 'private duplicate PDF should not exist when the public PDF is the official citation target');
  assert.ok(!fs.existsSync(path.join(root, oneOffMirrorPath)), 'one-off CD 2021-O0008 mirror should not be retained when the full FY26v04 mirror contains the text');
  assert.ok(!fs.existsSync(path.join(root, 'public/knowledge/armor-gpt/pdf-text')), 'internal text mirrors should not be exposed from public/');
  assert.match(mirror, /Source: \/knowledge\/armor-gpt\/DoD_Class_Deviations_FY26v04_dated_2Feb2026\.pdf \| Page 1/, 'mirror page headers should point to the public official PDF path');
  assert.doesNotMatch(mirror, /Source: knowledge\/armor-gpt\/DoD_Class_Deviations_FY26v04_dated_2Feb2026\.pdf/, 'mirror should not point back to the removed private duplicate PDF');

  for (const pattern of [
    /Class Deviation 2026-O0044/i,
    /Class Deviation 2026-O0033/i,
    /Class Deviation 2025-O0007/i,
    /Class Deviation 2024-O0014/i,
    /Class Deviation 2021-O0008,\s*Revision 1/i,
    /52\.219-14\s+Limitations on Subcontracting \(DEVIATION 2021-O0008\)/i,
    /252\.\s*232-7998[\s,]+Obligations in Advance of\s+Fiscal Year 2026 Funding/i,
    /252\.225-7965\s+Acquisition of Dinnerware and Stainless-Steel Flatware/i,
  ]) {
    assert.match(mirror, pattern, `full FY26v04 text mirror should contain ${pattern}`);
  }
});

test('master_index and part_lookup are valid approved registry inputs', () => {
  const masterIndex = JSON.parse(read('knowledge/armor-gpt/master_index.json'));
  const partLookup = JSON.parse(read('knowledge/armor-gpt/part_lookup.json'));

  assert.ok(Array.isArray(masterIndex), 'master_index should be an array');
  assert.ok(masterIndex.length > 1000, 'master_index should contain the uploaded source registry');
  assert.ok(Object.keys(partLookup).length >= 50, 'part_lookup should contain part routing keys');
  assert.ok(partLookup['14'].some(record => `${record.title} ${record.url}`.includes('RFO FAR Part 14')), 'part_lookup should route RFO FAR Part 14');
});

test('baseline FAR/DFARS data fallback cannot be returned as controlling context', () => {
  const fetcher = read('app/lib/fetcher.ts');
  const registry = read('app/lib/source-registry.ts');

  assert.match(fetcher, /DATA_FALLBACK_DISABLED_REASON/, 'fetcher should define the fallback block reason');
  assert.doesNotMatch(fetcher, /const\s+dataResult\s*=\s*await\s+fetchGitHubDataSource/, 'fetchSource should not fetch data/far or data/dfars fallback');
  assert.doesNotMatch(fetcher, /return\s+dataResult\s*\|\|\s*(?:legacyResult|primaryResult)/, 'fetchSource should not return data fallback as authority');
  assert.match(registry, /\/data\/legacy-crosswalk\/far/, 'source registry should mark quarantined FAR crosswalk paths as background-only');
  assert.match(registry, /\/data\/legacy-crosswalk\/dfars/, 'source registry should mark quarantined DFARS crosswalk paths as background-only');
});

test('prompt and analyze route enforce source authority lock', () => {
  const prompt = read('app/lib/armor-prompt.ts');
  const analyze = read('app/api/analyze/route.ts');
  const registry = read('app/lib/source-registry.ts');

  assert.match(prompt, /BASELINE FAR\/DFARS FALLBACK BAR/, 'prompt must bar baseline fallback as controlling authority');
  assert.match(prompt, /DEFINITIVE ANSWER LOCK/, 'prompt must require retrieved approved source text before a Definitive answer');
  assert.match(analyze, /sourceAuthorityInstruction\(routePlan\)/, 'analyze route must inject runtime source authority status');
  assert.match(registry, /No specific active class-deviation source was selected by the route/, 'source authority should distinguish no selected class-deviation source from failed retrieval');
  assert.match(registry, /Mark class-deviation rungs Checked or N\/A, not UTR/, 'source authority should not force UTR when no class-deviation source was selected');
  assert.match(registry, /A specific class-deviation source was selected but approved source text was not retrieved/, 'source authority should preserve true UTR for selected class-deviation sources that fail retrieval');
  assert.match(registry, /isClassDeviationRouteItem/, 'source authority should classify selected class-deviation route items explicitly');
});

test('two-step sealed bidding does not become Conditional solely from non-selected class-deviation rungs', () => {
  const prompt = read('app/lib/armor-prompt.ts');
  const analyze = read('app/api/analyze/route.ts');

  assert.match(analyze, /RFO FAR 14\.211-3\(a\)\(1\)/, 'two-step override should preserve the current RFO FAR controlling citation');
  assert.match(analyze, /mark class-deviation rungs Checked or N\/A instead of UTR/, 'two-step override should prevent misleading UTR when no class-deviation source is selected');
  assert.match(analyze, /do not make the answer Conditional solely for class-deviation status/, 'two-step override should prevent Conditional solely from optional deviation status');
  assert.match(prompt, /UTR only when a specific selected source failed retrieval/, 'full prompt should define UTR narrowly');
  assert.match(prompt, /Optional or non-selected rungs should be Checked\/N\/A, not UTR/, 'full prompt should direct non-selected rungs away from UTR');
  assert.doesNotMatch(prompt, /UTR any rung -> STEP 7 genuine unknown/, 'full prompt should not downgrade for every optional UTR-style rung');
});

test('production prompts do not imply classroom-key answers', () => {
  const productionPromptInputs = [
    'app/lib/armor-prompt.ts',
    'app/api/analyze/route.ts',
    'app/lib/practice-issue-rules.json',
  ];
  const spacedForbiddenPatterns = [
    ['expected', 'classroom', 'result'],
    ['expected', 'classroom', 'answer'],
    ['expected', 'classroom', 'determination'],
    ['classroom', 'result'],
    ['classroom', 'answer'],
    ['classroom', 'determination'],
    ['legacy', 'classroom'],
    ['classroom', 'key'],
  ].map(parts => new RegExp(parts.join('\\s+'), 'i'));
  const forbiddenPatterns = [
    ...spacedForbiddenPatterns,
    new RegExp(['classroom', 'default'].join('\\s*\\/\\s*'), 'i'),
  ];

  for (const file of productionPromptInputs) {
    const text = read(file);
    for (const pattern of forbiddenPatterns) {
      assert.doesNotMatch(text, pattern, `${file} should not use banned classroom-style phrasing`);
    }
  }
});

test('practice rules do not promote known legacy FAR locations as current RFO answers', () => {
  const rules = JSON.parse(read('app/lib/practice-issue-rules.json'));
  const fetcher = read('app/lib/fetcher.ts');
  const byId = Object.fromEntries(rules.map(rule => [rule.id, rule]));

  const expected = {
    price_negotiation_cost_elements: ['RFO FAR 15.407(a)'],
    contractor_weapons_policy_peacekeeping: ['RFO FAR 25.701-3'],
    multiyear_cancellation_ceiling_20m: ['RFO FAR 17.104-3(a)', 'DFARS RFO 217.104-370(b)(1)(iv)'],
    motor_vehicle_lease_certification: ['RFO FAR 8.101'],
    sdb_subcontractor_representation: ['RFO FAR 19.302-2(a)(1)(ii)(A)'],
  };

  for (const [id, citations] of Object.entries(expected)) {
    assert.deepEqual(byId[id]?.expectedCitations, citations, `${id} should use current RFO citation targets`);
  }

  assert.doesNotMatch(byId.price_negotiation_cost_elements.guidance, /Use RFO FAR 15\.405\(a\)/, 'price negotiation rule must not promote the legacy FAR 15.405(a) location');
  assert.match(byId.price_negotiation_cost_elements.guidance, /not legacy FAR 15\.405\(a\)/, 'price negotiation rule should keep the old cite only as a trap warning');
  assert.doesNotMatch(byId.motor_vehicle_lease_certification.guidance, /cite RFO FAR 8\.1100/, 'motor-vehicle rule must not promote removed FAR subpart 8.11 as current RFO');
  assert.doesNotMatch(byId.sdb_subcontractor_representation.guidance, /cite RFO FAR 19\.703/, 'subcontractor representation rule must not promote legacy FAR 19.703 as current RFO');
  assert.match(fetcher, /15\\\.407\\s\+Price negotiation/, 'targeted RFO FAR Part 15 excerpt should prioritize the current price negotiation paragraph');
  assert.match(fetcher, /25\\\.701-3/, 'targeted RFO FAR Part 25 excerpt should include the current weapons paragraph');
  assert.match(fetcher, /19\\\.302-2/, 'targeted RFO FAR Part 19 excerpt should include the current subcontractor-representation paragraph');
  assert.doesNotMatch(fetcher, /'rfo_far:15': \[\/15\\\.206-2[\s\S]{0,80}\/15\\\.405/, 'RFO FAR Part 15 targeting should not steer pricing questions to 15.405');
  assert.doesNotMatch(fetcher, /'rfo_far:25': \[[^\n]*25\\\.301-3/, 'RFO FAR Part 25 targeting should not use the removed 25.301-3 location');
  assert.doesNotMatch(fetcher, /'rfo_far:19': \[[^\n]*19\\\.703/, 'RFO FAR Part 19 targeting should not use the removed 19.703 location');
  assert.doesNotMatch(fetcher, /'rfo_far:8': \[[^\n]*8\\\.1100/, 'RFO FAR Part 8 targeting should not use the removed 8.1100 location');
}
);

test('structured ARMOR routing rules cover Step One pre-check issue families without becoming a Q&A key', () => {
  const rules = JSON.parse(read('app/lib/armor-routing-rules.json'));
  const fetcher = read('app/lib/fetcher.ts');
  const analyze = read('app/api/analyze/route.ts');
  const routing = read('app/lib/armor-routing-rules.ts');

  assert.ok(Array.isArray(rules), 'structured routing rules should be an array');

  const byId = Object.fromEntries(rules.map(rule => [rule.id, rule]));
  const requiredIds = [
    'germany_fixed_price_construction_warranty',
    'detainee_epw_contractor_interrogation',
    'preaward_debriefing_deadline',
    'two_step_sealed_bidding_step_one',
    'dod_technical_data_far_52_227_14',
    'acquisition_plan_responsibility',
    'legacy_citation_trap_guardrail',
    'dfars_rfo_instead_of_in_lieu_priority',
  ];

  for (const id of requiredIds) {
    assert.ok(byId[id], `${id} should be represented as a structured routing rule`);
    assert.ok(Array.isArray(byId[id].triggerTerms) && byId[id].triggerTerms.length > 0, `${id} should define trigger terms`);
    assert.ok(Array.isArray(byId[id].requiredSources), `${id} should define required source requests`);
    assert.match(byId[id].instruction, /route|check|verify|determine/i, `${id} should instruct routing or verification, not just state an answer`);
    assert.doesNotMatch(byId[id].instruction, /^answer\s*=/i, `${id} should not be a question-answer key`);
  }

  assert.deepEqual(
    byId.two_step_sealed_bidding_step_one.requiredSources.map(source => `${source.kind}:${source.part}`),
    ['rfo_far:14', 'dfars_rfo:214'],
    'two-step sealed bidding should route to RFO FAR 14 and DFARS RFO 214',
  );
  assert.deepEqual(
    byId.germany_fixed_price_construction_warranty.requiredSources.map(source => `${source.kind}:${source.part}`),
    ['rfo_far:46', 'dfars_rfo:246'],
    'Germany warranty should route to RFO FAR 46 and DFARS RFO 246',
  );
  assert.deepEqual(
    byId.acquisition_plan_responsibility.requiredSources.map(source => `${source.kind}:${source.part}`),
    ['rfo_far:7', 'dfars_rfo:207', 'dfars_pgi:207', 'rfo_conventions:1'],
    'acquisition plan responsibility should route to RFO FAR 7, DFARS RFO 207, and PGI 207',
  );
  assert.deepEqual(
    byId.dod_technical_data_far_52_227_14.requiredSources.map(source => `${source.kind}:${source.part}`),
    ['rfo_far:27', 'dfars_rfo:227'],
    'technical data should route to RFO FAR 27 and DFARS RFO 227',
  );

  assert.match(fetcher, /getArmorRoutingSourceRequests\(question\)/, 'fetcher should use structured routing rules for source requests');
  assert.match(analyze, /getArmorRoutingInstruction\(retrievalPrompt\)/, 'analyze route should inject structured routing guidance server-side');
  assert.match(read('app/lib/armor-prompt.ts'), /PRE-CHECK \(HARD/, 'first migration pass should supplement rather than remove PRE-CHECK');
  assert.match(routing, /do not answer from this rule alone/i, 'routing instruction should preserve source-based answer discipline');
  assert.match(routing, /retrieved approved source text/i, 'routing instruction should require retrieved source text for final determination');
});

test('Part 252 approved PDF has an explicit local text mirror', () => {
  const partLookup = JSON.parse(read('knowledge/armor-gpt/part_lookup.json'));
  const fetcher = read('app/lib/fetcher.ts');
  const registry = read('app/lib/source-registry.ts');
  const mirrorPath = 'knowledge/armor-gpt/pdf-text/DFARS-RFO-PART-252-Deviation-Memo.txt';
  const records = partLookup['252'].filter(record => record.url === 'https://raw.githubusercontent.com/kidkenpo-create/ARMOR-plus/main/DFARS-RFO-PART-252-Deviation-Memo.pdf');

  assert.equal(records.length, 1, 'Part 252 should have exactly one approved deviation memo PDF record');
  assert.equal(records[0].type, 'pdf', 'Part 252 deviation memo should remain the approved PDF artifact');
  assert.equal(records[0].text_path, mirrorPath, 'Part 252 deviation memo should map to its explicit text mirror');
  assert.ok(fs.existsSync(path.join(root, mirrorPath)), 'Part 252 text mirror should exist');
  assert.match(read(mirrorPath), /Class Deviation—Revolutionary F\s*ederal Acquisition Regulation \(FAR\) Overhaul\s+Part 52/i, 'Part 252 text mirror should contain extracted deviation memo text');
  assert.match(registry, /textPath: record\.text_path/, 'registry should carry only explicit text_path mappings into source requests');
  assert.match(fetcher, /fetchApprovedTextMirror/, 'fetcher should read approved PDF text mirrors');
  assert.match(fetcher, /knowledge\/armor-gpt\/pdf-text\//, 'fetcher should restrict PDF mirrors to the approved mirror root');
  assert.doesNotMatch(fetcher, /replace\([^)]*\.pdf[^)]*\.txt/i, 'fetcher should not infer arbitrary .txt mirrors from PDF URLs');
});

test('FAR 52.219-14 route retrieves CD 2021-O0008 approved text mirror', () => {
  const practiceRules = JSON.parse(read('app/lib/practice-issue-rules.json'));
  const fetcher = read('app/lib/fetcher.ts');
  const registry = read('app/lib/source-registry.ts');
  const mirrorPath = 'knowledge/armor-gpt/pdf-text/DoD_Class_Deviations_FY26v04_dated_2Feb2026.txt';
  const rule = practiceRules.find(item => item.id === 'limitations_on_subcontracting_class_deviation');
  const request = rule?.requests?.find(item => item.kind === 'class_deviation' && item.textPath === mirrorPath);

  assert.ok(request, 'FAR 52.219-14 limitations-on-subcontracting route should request the approved DoD class-deviation text mirror');
  assert.equal(request.url, '/knowledge/armor-gpt/DoD_Class_Deviations_FY26v04_dated_2Feb2026.pdf#CD-2021-O0008-Revision-1', 'CD 2021-O0008 mirror should preserve the public approved PDF artifact URL');
  assert.ok(fs.existsSync(path.join(root, mirrorPath)), 'full DoD class-deviation text mirror should exist');
  const mirror = read(mirrorPath);
  assert.match(mirror, /DARS Tracking Number:\s*2021-O0008,\s*Revision 1/i, 'mirror should contain the CD 2021-O0008 Revision 1 memo');
  assert.match(mirror, /52\.219-14\s+Limitations on Subcontracting \(DEVIATION 2021-O0008\)/i, 'mirror should contain the deviation clause heading');
  assert.match(mirror, /in lieu of the\s+clause at Federal Acquisition Regulation \(FAR\) 52\.219-14/i, 'mirror should contain the operative in-lieu-of text');
  assert.match(fetcher, /if \(request\.kind === 'class_deviation'\)[\s\S]{0,180}request\.textPath/, 'class-deviation fetch should read an explicit text mirror before returning UTR');
  assert.match(fetcher, /DOD_CLASS_DEVIATIONS_FY26_TEXT_PATH/, 'fetcher should approve the full DoD class-deviation mirror explicitly');
  assert.match(fetcher, /DARS Tracking Number:\\s\*2021-O0008/, 'fetcher should target the CD 2021-O0008 section inside the full mirror');
  assert.match(registry, /class deviation 2021-o0008/, 'source authority should recognize only the approved CD 2021-O0008 class-deviation mirror');
  assert.doesNotMatch(fetcher, /replace\([^)]*\.pdf[^)]*\.txt/i, 'fetcher should not infer arbitrary class-deviation mirrors from PDF URLs');
  assert.doesNotMatch(fetcher, /CD_2021_O0008_TEXT_PATH/, 'fetcher should not use the removed one-off CD 2021-O0008 mirror');
  assert.doesNotMatch(mirror, /Quality Assurance|Part 46|52\.246-21|246\.710/i, 'the approved FY26 class-deviation mirror does not contain the observed Part 46 quality-assurance issue');
  assert.match(fetcher, /Approved class-deviation PDF\/text retrieval is not implemented yet/, 'unmapped class-deviation PDFs should still return UTR');
});

test('source registry marks GSA submodules as background only, not approved controlling sources', () => {
  const registry = read('app/lib/source-registry.ts');

  assert.match(registry, /gsa\/gsa-acquisition-far/, 'GSA FAR fallback should be explicitly recognized');
  assert.match(registry, /gsa\/gsa-acquisition-dfars/, 'GSA DFARS fallback should be explicitly recognized');
  assert.match(registry, /data\/legacy-crosswalk\/\*/, 'quarantined legacy-crosswalk paths should be explicitly described as fallback/background');
  assert.match(registry, /crosswalk\/background only/, 'runtime instruction should label baseline fallback as background only');
  assert.doesNotMatch(registry, /raw\.githubusercontent\.com\/gsa\/gsa-acquisition-far[\s\S]{0,200}return true/, 'GSA FAR must not be approved as controlling');
});

test('app code does not use legacy acquisition.gov FAR/DFARS URLs', () => {
  const appFiles = [
    'app/api/analyze/route.ts',
    'app/api/health/sources/route.ts',
    'app/lib/armor-prompt.ts',
    'app/lib/fetcher.ts',
    'app/lib/source-registry.ts',
    'app/page.tsx',
  ];

  for (const file of appFiles) {
    const text = read(file);
    assert.doesNotMatch(text, /acquisition\.gov\/far(?!-overhaul)/i, `${file} should not use old acquisition.gov FAR URLs`);
    assert.doesNotMatch(text, /acquisition\.gov\/dfars/i, `${file} should not use legacy acquisition.gov DFARS URLs`);
  }
});

test('DFARS RFO registry supports approved nonstandard PDF sources', () => {
  const partLookup = JSON.parse(read('knowledge/armor-gpt/part_lookup.json'));
  const fetcher = read('app/lib/fetcher.ts');
  const registry = read('app/lib/source-registry.ts');

  assert.ok(partLookup['219'].some(record => record.url === 'https://raw.githubusercontent.com/kidkenpo-create/ARMOR-plus/main/DFARS-RFO-PART-219-Attachment-1.txt'), 'Part 219 DFARS RFO text source should be listed');
  assert.ok(partLookup['219'].some(record => record.url === 'https://raw.githubusercontent.com/kidkenpo-create/ARMOR-plus/main/DFARS-RFO-PGI-PART-219-Attachment-2.txt'), 'Part 219 DFARS RFO PGI text source should be listed');
  assert.ok(partLookup['252'].some(record => record.type === 'pdf' && record.url === 'https://raw.githubusercontent.com/kidkenpo-create/ARMOR-plus/main/DFARS-RFO-PART-252-Deviation-Memo.pdf'), 'Part 252 approved PDF source should be listed');

  assert.match(registry, /sourceRequestFromRecord/, 'registry should carry approved record URL into source requests');
  assert.match(fetcher, /if \(request\.url\) return request\.url/, 'fetcher should prefer approved registry URLs over generated names');
  assert.match(fetcher, /fetchApprovedPdfSource/, 'fetcher should handle approved PDF sources without using missing text attachment URLs');
  assert.match(fetcher, /runtime text extraction is not implemented yet/, 'PDF sources should produce clear UTR text-extraction status');
});

test('user-facing DFARS RFO source links prefer official or public PDFs over GitHub mirrors', () => {
  const fetcher = read('app/lib/fetcher.ts');
  const page = read('app/page.tsx');

  assert.match(fetcher, /displayUrl\?: string/, 'fetcher route-plan items should support separate user-facing display URLs');
  assert.match(fetcher, /displaySourceUrl\(result\)/, 'model-facing source context should use the display source URL');
  assert.match(fetcher, /DoD_RFO_Deviation_Part-\$\{part\}\.pdf/, 'DFARS RFO display URLs should point to Acquisition.gov DoD RFO PDFs');
  assert.match(fetcher, /DFARS-RFO-PART-\(\?:248\|252\)-Deviation-Memo/, 'approved memo exceptions should use public app PDFs instead of raw GitHub links');
  assert.ok(fs.existsSync(path.join(root, 'public/knowledge/armor-gpt/DFARS-RFO-PART-248-Deviation-Memo.pdf')), 'Part 248 approved memo PDF should be available through public/');
  assert.ok(fs.existsSync(path.join(root, 'public/knowledge/armor-gpt/DFARS-RFO-PART-252-Deviation-Memo.pdf')), 'Part 252 approved memo PDF should be available through public/');

  assert.match(page, /sourceHref\(item\)/, 'source cards should open displayUrl when available');
  assert.match(page, /officialDisplayUrl\(url\)/, 'client-side previews should map raw mirror URLs to official display URLs');
  assert.doesNotMatch(page, />GitHub<\/a>/, 'Sources / Evidence header should not expose a GitHub shortcut');
  assert.doesNotMatch(page, /href=\{item\.url\}/, 'source/evidence cards should not link directly to internal retrieval URLs');
});

test('DFARS RFO sample raw GitHub sources are reachable or correctly absent', async () => {
  const samples = [
    ['DFARS RFO Part 219', 'https://raw.githubusercontent.com/kidkenpo-create/ARMOR-plus/main/DFARS-RFO-PART-219-Attachment-1.txt', 200],
    ['DFARS RFO PGI Part 219', 'https://raw.githubusercontent.com/kidkenpo-create/ARMOR-plus/main/DFARS-RFO-PGI-PART-219-Attachment-2.txt', 200],
    ['DFARS RFO Part 252 approved PDF', 'https://raw.githubusercontent.com/kidkenpo-create/ARMOR-plus/main/DFARS-RFO-PART-252-Deviation-Memo.pdf', 200],
    ['DFARS RFO Part 252 missing generated text attachment', 'https://raw.githubusercontent.com/kidkenpo-create/ARMOR-plus/main/DFARS-RFO-PART-252-Attachment-1.txt', 404],
  ];

  for (const [label, url, expectedStatus] of samples) {
    const response = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'ARMOR-Plus/1.0 Source-Test' } });
    assert.equal(response.status, expectedStatus, `${label} should return HTTP ${expectedStatus}: ${url}`);
  }
});

test('follow-up response mode contract preserves concise continuation behavior', () => {
  const analyze = read('app/api/analyze/route.ts');
  const page = read('app/page.tsx');

  assert.match(analyze, /first_turn_full_analysis/, 'server should name the full first-turn response mode');
  assert.match(analyze, /follow_up_concise_continuation/, 'server should name the concise follow-up response mode');
  assert.match(analyze, /force_full_analysis/, 'server should support explicit full-analysis follow-up requests');
  assert.match(analyze, /promptForResponseMode\(responseMode\)/, 'server should select a mode-specific system prompt');
  assert.match(analyze, /supersedes the full STEP output template/, 'concise mode must override visible full STEP output');
  assert.match(analyze, /Do not include "0\) BLUF", STEP 1-7, STEP 3B, Rungs 1-8/, 'concise mode must bar visible rungs and full steps');
  assert.match(page, /body: JSON\.stringify\(\{ question: prompt, messages: history, responseMode \}\)/, 'client should send explicit responseMode to the server');
  assert.match(page, /responseModeForClient\(prompt, turns\)/, 'client should compute responseMode before submitting');
  assert.match(page, /\[ARMOR responseMode request\]/, 'client should log responseMode for development diagnostics');
  assert.match(page, /Show full analysis/, 'UI should preserve a way to request full analysis from concise follow-ups');
  assert.match(page, /responseMode === 'follow_up_concise_continuation'/, 'UI should recognize concise follow-up metadata');
});

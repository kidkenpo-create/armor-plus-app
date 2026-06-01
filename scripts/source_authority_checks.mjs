import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('ARMOR GPT knowledge files are normalized under knowledge/armor-gpt', () => {
  const files = [
    'knowledge/armor-gpt/02_FAR_Competition_and_Sealed_Bidding.txt',
    'knowledge/armor-gpt/DoD_Class_Deviations_FY26v04_dated_2Feb2026.pdf',
    'knowledge/armor-gpt/master_index.json',
    'knowledge/armor-gpt/part_lookup.json',
    'knowledge/armor-gpt/REF_1_Citation_Decision_Tree.txt',
    'knowledge/armor-gpt/REF_3_RFO_Conventions.txt',
  ];

  for (const file of files) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} should exist`);
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

  assert.match(fetcher, /DATA_FALLBACK_DISABLED_REASON/, 'fetcher should define the fallback block reason');
  assert.doesNotMatch(fetcher, /const\s+dataResult\s*=\s*await\s+fetchGitHubDataSource/, 'fetchSource should not fetch data/far or data/dfars fallback');
  assert.doesNotMatch(fetcher, /return\s+dataResult\s*\|\|\s*(?:legacyResult|primaryResult)/, 'fetchSource should not return data fallback as authority');
});

test('prompt and analyze route enforce source authority lock', () => {
  const prompt = read('app/lib/armor-prompt.ts');
  const analyze = read('app/api/analyze/route.ts');

  assert.match(prompt, /BASELINE FAR\/DFARS FALLBACK BAR/, 'prompt must bar baseline fallback as controlling authority');
  assert.match(prompt, /DEFINITIVE ANSWER LOCK/, 'prompt must require retrieved approved source text before a Definitive answer');
  assert.match(analyze, /sourceAuthorityInstruction\(routePlan\)/, 'analyze route must inject runtime source authority status');
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
  const mirrorPath = 'knowledge/armor-gpt/pdf-text/CD-2021-O0008-Revision-1-Limitations-on-Subcontracting.txt';
  const rule = practiceRules.find(item => item.id === 'limitations_on_subcontracting_class_deviation');
  const request = rule?.requests?.find(item => item.kind === 'class_deviation' && item.textPath === mirrorPath);

  assert.ok(request, 'FAR 52.219-14 limitations-on-subcontracting route should request the CD 2021-O0008 mirror');
  assert.equal(request.url, 'knowledge/armor-gpt/DoD_Class_Deviations_FY26v04_dated_2Feb2026.pdf#CD-2021-O0008-Revision-1', 'CD 2021-O0008 mirror should preserve the approved PDF artifact URL');
  assert.ok(fs.existsSync(path.join(root, mirrorPath)), 'CD 2021-O0008 text mirror should exist');
  const mirror = read(mirrorPath);
  assert.match(mirror, /DARS Tracking Number:\s*2021-O0008,\s*Revision 1/i, 'mirror should contain the CD 2021-O0008 Revision 1 memo');
  assert.match(mirror, /52\.219-14\s+Limitations on Subcontracting \(DEVIATION 2021-O0008\)/i, 'mirror should contain the deviation clause heading');
  assert.match(mirror, /in lieu of the\s+clause at Federal Acquisition Regulation \(FAR\) 52\.219-14/i, 'mirror should contain the operative in-lieu-of text');
  assert.match(fetcher, /if \(request\.kind === 'class_deviation'\)[\s\S]{0,180}request\.textPath/, 'class-deviation fetch should read an explicit text mirror before returning UTR');
  assert.match(fetcher, /CD_2021_O0008_TEXT_PATH/, 'fetcher should approve the CD 2021-O0008 mirror explicitly');
  assert.match(registry, /class deviation 2021-o0008/, 'source authority should recognize only the approved CD 2021-O0008 class-deviation mirror');
  assert.doesNotMatch(fetcher, /replace\([^)]*\.pdf[^)]*\.txt/i, 'fetcher should not infer arbitrary class-deviation mirrors from PDF URLs');
});

test('source registry marks GSA submodules as background only, not approved controlling sources', () => {
  const registry = read('app/lib/source-registry.ts');

  assert.match(registry, /gsa\/gsa-acquisition-far/, 'GSA FAR fallback should be explicitly recognized');
  assert.match(registry, /gsa\/gsa-acquisition-dfars/, 'GSA DFARS fallback should be explicitly recognized');
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

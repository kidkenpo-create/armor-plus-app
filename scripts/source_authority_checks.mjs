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

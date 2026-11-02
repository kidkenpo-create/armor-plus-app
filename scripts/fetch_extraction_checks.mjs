import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';

const root = process.cwd();
const sourcePath = path.join(root, 'app', 'lib', 'section-excerpt.ts');
const tempPath = path.join(os.tmpdir(), `section-excerpt-${process.pid}.mjs`);
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

fs.writeFileSync(tempPath, compiled);
const {
  extractSectionCitations,
  findSectionWindow,
  stripControlCharacters,
  parsePrefixedCitations,
  dfarsSectionCandidates,
} = await import(pathToFileURL(tempPath).href);

test.after(() => {
  fs.rmSync(tempPath, { force: true });
});

// Fixture modeled on the real acquisition.gov RFO FAR Part 17 page
// (normalized to single spaces the way the fetcher normalizes it):
// a table of contents listing every section comes FIRST, then the body.
const PART_17_PAGE = [
  'Part 17 - Special Contracting Methods',
  '17.000 Scope of part.',
  'Subpart 17.1 - Multiyear Contracting',
  '17.101 Authority., 17.102 Definitions., 17.103 Presolicitation., 17.103-1 Policy., 17.103-2 Procedures., 17.103-3 Solicitations.',
  '17.104 Evaluation and Award.',
  '17.104-1 General.',
  '17.104-2 Cancellation provisions.',
  '17.104-3 Congressional notification.',
  '17.104-4 Funding at award.',
  '17.104-5 Special procedures for DoD, NASA, and the Coast Guard.',
  '17.105 Postaward.',
  '17.106 Contract clauses.',
  'Subpart 17.2 - Options',
  '17.200 Scope of subpart.',
  '17.201 Presolicitation.',
  '17.201-1 Use of options.',
  '17.202 Evaluation and award.',
  '17.000 Scope of part. This part prescribes policies and procedures for the acquisition of supplies and services through special contracting methods, including- (a) Multiyear contracting; (b) Options; and (c) Leader company contracting.',
  'Subpart 17.1 - Multiyear Contracting',
  '17.101 Authority. This subpart prescribes policies and procedures for acquiring supplies or services through multiyear contracting, as authorized by 10 U.S.C. 3501 and 41 U.S.C. 3903.',
  '17.104 Evaluation and Award.',
  '17.104-1 General. Contracting officers must follow the appropriate acquisition policies and procedures.',
  '17.104-2 Cancellation provisions. (a) Cancellation procedures. (1) All program years except the first are subject to cancellation.',
  '17.104-3 Congressional notification. (a) Except for DoD, NASA, and the Coast Guard, a multiyear contract with a cancellation ceiling over $20 million may not be awarded until the agency head notifies Congress in writing. (b) For DoD, NASA, and the Coast Guard, when the ceiling is over $200 million, the agency head must notify the House and Senate armed services and appropriations committees in writing. (c) The contract may not be awarded until 31 days after notification.',
  '17.104-4 Funding at award. (a) At award, obligated funds must cover either- (1) The full contract period; or (2) The first fiscal year plus any potential cancellation and termination costs.',
  '17.105 Postaward. (a) Termination vs. cancellation. The termination for convenience procedure applies to any Government contract.',
  'Subpart 17.2 - Options',
  '17.201-1 Use of options. (a) In contracting by sealed bidding or negotiation, the contracting officer may add options to contracts when beneficial to the Government. (b) Inclusion of an option is normally not beneficial to the Government when minimum economic quantities are involved. (c) The contracting officer shall document the determination in the contract file.',
  '17.202 Evaluation and award. Options shall be evaluated as part of the initial competition.',
].join(' ');

test('extractSectionCitations reads the cited section and its part', () => {
  assert.deepEqual(
    extractSectionCitations('What are the rules for multiyear contracting under FAR 17.104-3?'),
    [{ part: '17', section: '17.104-3' }],
  );
  assert.deepEqual(
    extractSectionCitations('What does DFARS RFO 237.873-3(a) say about detainees?'),
    [{ part: '237', section: '237.873-3' }],
  );
  assert.deepEqual(
    extractSectionCitations('Compare 17.104-3 with 17.104-3 and part 12 policy'),
    [{ part: '17', section: '17.104-3' }],
  );
});

test('findSectionWindow returns the 17.104-3 BODY, not the table of contents', () => {
  const window = findSectionWindow(PART_17_PAGE, '17.104-3');
  assert.ok(window, 'window should be found');
  // Operative paragraphs are present.
  assert.match(window.excerpt, /cancellation ceiling over \$20 million/);
  assert.match(window.excerpt, /over \$200 million/);
  assert.match(window.excerpt, /31 days after notification/);
  assert.match(window.excerpt, /\(a\)/);
  assert.match(window.excerpt, /\(b\)/);
  assert.match(window.excerpt, /\(c\)/);
  // It is the body occurrence: the excerpt starts at the body heading,
  // which sits after the TOC block in the page.
  assert.ok(window.start > PART_17_PAGE.indexOf('17.101 Authority. This subpart'));
  // The window stops before the next section body.
  assert.doesNotMatch(window.excerpt, /17\.104-4/);
  assert.doesNotMatch(window.excerpt, /obligated funds must cover/);
});

test('findSectionWindow generalizes to another part/section (17.201-1)', () => {
  const window = findSectionWindow(PART_17_PAGE, '17.201-1');
  assert.ok(window, 'window should be found');
  assert.match(window.excerpt, /may add options to contracts when beneficial to the Government/);
  assert.match(window.excerpt, /\(c\) The contracting officer shall document/);
  assert.doesNotMatch(window.excerpt, /17\.202 Evaluation/);
});

test('findSectionWindow handles a section with no lettered paragraphs via last occurrence', () => {
  const window = findSectionWindow(PART_17_PAGE, '17.101');
  assert.ok(window, 'window should be found');
  assert.match(window.excerpt, /10 U\.S\.C\. 3501/);
});

test('findSectionWindow returns null when the section is absent', () => {
  assert.equal(findSectionWindow(PART_17_PAGE, '17.999-9'), null);
  assert.equal(findSectionWindow(PART_17_PAGE, '52.246-21'), null);
});

test('findSectionWindow does not confuse 17.104 with 17.104-3', () => {
  const window = findSectionWindow(PART_17_PAGE, '17.104');
  assert.ok(window, 'window should be found');
  assert.match(window.excerpt, /^17\.104 Evaluation and Award\./);
});

test('stripControlCharacters removes PDF font-encoding control bytes', () => {
  const garbled = 'Class Deviations\u0003\u0010\u0003\u0015\u0003)HEUXDU\\\u0003XSGDWH\u0011';
  const cleaned = stripControlCharacters(garbled);
  assert.doesNotMatch(cleaned, /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/);
  assert.match(cleaned, /Class Deviations/);
  // Tabs/newlines survive for the whitespace collapse step.
  assert.equal(stripControlCharacters('a\tb\nc'), 'a\tb\nc');
});

test('fetcher wires section targeting, citation attach, and the 15s timeout', () => {
  const fetcher = fs.readFileSync(path.join(root, 'app', 'lib', 'fetcher.ts'), 'utf8');
  assert.match(fetcher, /SOURCE_FETCH_TIMEOUT_MS = 15000/);
  assert.match(fetcher, /findSectionWindow\(text, request\.section\)/);
  assert.match(fetcher, /extractSectionCitations\(question\)/);
  assert.match(fetcher, /stripControlCharacters\(content\)/);
  assert.match(fetcher, /FULL RETRIEVED SOURCE TEXT \(from section/);
});

test('parsePrefixedCitations reads rule-table citation strings', () => {
  assert.deepEqual(parsePrefixedCitations('DFARS RFO 217.104-370(b)(1)(iv)'), [
    { kind: 'dfars_rfo', part: '217', section: '217.104-370' },
  ]);
  assert.deepEqual(parsePrefixedCitations('RFO FAR 17.104-3(a)'), [
    { kind: 'rfo_far', part: '17', section: '17.104-3' },
  ]);
  assert.deepEqual(parsePrefixedCitations('DFARS RFO PGI 207.104-70(b)'), [
    { kind: 'dfars_pgi', part: '207', section: '207.104-70' },
  ]);
  assert.deepEqual(parsePrefixedCitations('DFARS 252.225-7976'), [
    { kind: 'dfars_rfo', part: '252', section: '252.225-7976' },
  ]);
  assert.deepEqual(parsePrefixedCitations('RFO FAR 27.400 / DFARS RFO 227.400'), [
    { kind: 'rfo_far', part: '27', section: '27.400' },
    { kind: 'dfars_rfo', part: '227', section: '227.400' },
  ]);
  // Strings that name no FAR/DFARS section parse to nothing.
  assert.deepEqual(parsePrefixedCitations('DoD Instruction 1100.22'), []);
  assert.deepEqual(parsePrefixedCitations('Current retrieved RFO FAR / DFARS RFO pinpoint citation'), []);
  assert.deepEqual(parsePrefixedCitations('CD 2021-O0008 Revision 1'), []);
});

test('dfarsSectionCandidates covers the same-number and DFARS-added forms', () => {
  const candidates = dfarsSectionCandidates({ part: '17', section: '17.104-3' });
  assert.equal(candidates[0], '217.104-3');
  assert.ok(candidates.includes('217.104-370'), 'the -370 DFARS-added form must be a candidate');
  assert.deepEqual(dfarsSectionCandidates({ part: '12', section: '12.102' })[0], '212.102');
  // A citation that is already DFARS yields no candidates.
  assert.deepEqual(dfarsSectionCandidates({ part: '237', section: '237.873-3' }), []);
});

// Replica of the fetcher's normalization (strip control bytes, then
// collapse whitespace) for offline pipeline checks.
function normalizeLikeFetcher(raw) {
  return stripControlCharacters(raw).replace(/\s+/g, ' ').trim();
}

test('the real DFARS Part 217 file defeats the old head-cut pipeline', () => {
  const raw = fs.readFileSync(
    path.join(root, 'knowledge', 'armor-gpt', 'dfars-rfo', 'DFARS-RFO-PART-217-Attachment-1.txt'),
    'utf8',
  );
  const text = normalizeLikeFetcher(raw);
  // The section body sits past the fetcher's 10,000-char source trim,
  // so a part-only route (the pre-2b behavior: legacy targets for
  // 217.7302/217.7404-5 plus full text from the head) never showed the
  // model 217.104-370 at all.
  assert.ok(text.indexOf('217.104-370') > 10000, 'fixture assumption: section body is past the old trim');
  assert.ok(!text.slice(0, 10000).includes('217.104-370'));
});

test('217.104-370 (b)(1)(iv) lands in the excerpt via verified DFARS candidates', () => {
  const raw = fs.readFileSync(
    path.join(root, 'knowledge', 'armor-gpt', 'dfars-rfo', 'DFARS-RFO-PART-217-Attachment-1.txt'),
    'utf8',
  );
  const text = normalizeLikeFetcher(raw);

  // Resolve exactly the way the fetcher does: candidates in order,
  // first one findSectionWindow actually locates wins. The practice
  // rule also names 217.104-370 directly; both paths must converge.
  const candidates = dfarsSectionCandidates({ part: '17', section: '17.104-3' });
  let resolved = null;
  for (const candidate of candidates) {
    const window = findSectionWindow(text, candidate);
    if (window) {
      resolved = { section: candidate, window };
      break;
    }
  }
  assert.ok(resolved, 'a DFARS candidate should resolve in the real Part 217 text');
  assert.equal(resolved.section, '217.104-370');
  assert.match(resolved.window.excerpt, /217\.104-370\s+Congressional notification\./);
  assert.match(resolved.window.excerpt, /\(a\) The head of the agency must provide written notice/);
  assert.match(resolved.window.excerpt, /\(b\)\(1\) DoD must provide notification/);
  assert.match(resolved.window.excerpt, /\(iv\) Include a cancellation ceiling in excess of \$200 million/);

  // The direct section (rule-table path) resolves to the same window.
  const direct = findSectionWindow(text, '217.104-370');
  assert.ok(direct);
  assert.equal(direct.start, resolved.window.start);

  // Simulate prepareSourceContent + trimSource(10000): the targeted
  // excerpt block and the section-rebased full text keep the operative
  // (b)(1)(iv) paragraph inside the model context budget.
  const prepared = [
    'TARGETED REGULATORY EXCERPT:',
    resolved.window.excerpt.slice(0, 1600),
    '',
    `FULL RETRIEVED SOURCE TEXT (from section ${resolved.section}):`,
    text.slice(resolved.window.start),
  ].join('\n');
  const context = prepared.slice(0, 10000);
  assert.match(context, /cancellation ceiling in excess of \$200 million/);
  assert.match(context, /30 days before awarding a multiyear contract/);
});

test('findSectionWindow picks the 217.104-370 body in a Part 217-shaped fixture', () => {
  // Modeled on the real file's structure: subpart header, definitions
  // and earlier sections first, the target section deep in the text,
  // and a later in-text cross-reference to the same section number.
  const fixture = [
    'PART 217-SPECIAL CONTRACTING METHODS',
    'SUBPART 217.1-MULTIYEAR CONTRACTING',
    '217.102 Definitions. As used in this subpart- "Advance procurement" means an exception to the full funding policy. "Congressional defense committees" means the defense committees of the Senate and the House of Representatives.',
    '217.103 Presolicitation.',
    '217.103-170 Multiyear contract cost analysis. Before awarding a multiyear contract, the head of the agency must compare costs using a present value analysis.',
    '217.104 Evaluation and award.',
    '217.104-370 Congressional notification. (a) The head of the agency must provide written notice to the congressional defense committees at least 30 days before termination of any multiyear contract. (b)(1) DoD must provide notification at least 30 days before awarding a multiyear contract for certain procurements, including those expected to (iv) Include a cancellation ceiling in excess of $200 million. (2) A DoD component must request authority when submitting its budget. (3) See PGI 217.104-370(b) for procedures.',
    'SUBPART 217.2-OPTIONS',
    '217.201 Presolicitation.',
  ].join(' ');
  const window = findSectionWindow(fixture, '217.104-370');
  assert.ok(window, 'window should be found');
  assert.match(window.excerpt, /^217\.104-370 Congressional notification\./);
  assert.match(window.excerpt, /\(iv\) Include a cancellation ceiling in excess of \$200 million/);
});

test('findSectionWindow handles numbered paragraphs and pinpoint references (246.710 shape)', () => {
  // Modeled on the real DFARS Part 246 structure: the section body uses
  // NUMBERED paragraphs and is dense with cross-references, while the
  // clause text later refers back as "As prescribed in 246.710(1)...".
  // Neither the cross-references inside the body nor the pinpoint
  // references after it may steer the window away from the body.
  const fixture = [
    'SUBPART 246.7-WARRANTIES',
    '246.710 Contract clauses. (1) Insert a clause substantially the same as the clause at 252.246-7998, Warranty of Data, in solicitations and contracts. (2) Insert the clause at 252.246-7002, Warranty of Construction (Germany), instead of the clause at FAR 52.246-21, in solicitations and contracts for construction when performance will be in Germany. (3) When the solicitation includes the clause at 252.211-7003, follow paragraph (2).',
    '246.710-70 Warranty attachments. Follow the procedures at PGI 246.710-70 regarding warranty attachments.',
    '252.246-7002 Warranty of construction (Germany). As prescribed in 246.710(2), use the following clause: (a) Definition. As used in this clause-',
    '252.246-7998 Warranty of data. Basic. As prescribed in 246.710(1) and (1)(i), use the following clause: (a) Definition-Technical data has the meaning given in the clause at 252.227-7013.',
  ].join(' ');
  const window = findSectionWindow(fixture, '246.710');
  assert.ok(window, 'window should be found');
  assert.match(window.excerpt, /^246\.710 Contract clauses\./);
  assert.match(window.excerpt, /Warranty of Construction \(Germany\)/);
  assert.match(window.excerpt, /instead of the clause at FAR 52\.246-21/);
});

test('real DFARS Part 246 window for 246.710 contains the Germany prescription', () => {
  const raw = fs.readFileSync(
    path.join(root, 'knowledge', 'armor-gpt', 'dfars-rfo', 'DFARS-RFO-PART-246-Attachment-1.txt'),
    'utf8',
  );
  const text = normalizeLikeFetcher(raw);
  const window = findSectionWindow(text, '246.710');
  assert.ok(window, 'window should be found in the real Part 246 text');
  assert.match(window.excerpt, /246\.710\s+Contract clauses\./);
  assert.match(window.excerpt, /Insert the clause at 252\.246-7002/);
  assert.match(window.excerpt, /performance will be in Germany/);
});

test('fetcher wires rule-table citation sections and DFARS candidates', () => {
  const fetcher = fs.readFileSync(path.join(root, 'app', 'lib', 'fetcher.ts'), 'utf8');
  assert.match(fetcher, /getPracticeCitationSectionMap\(question\)/);
  assert.match(fetcher, /getArmorCitationSectionMap\(question\)/);
  assert.match(fetcher, /dfarsSectionCandidates\(farCitation\)/);
  assert.match(fetcher, /sectionCandidates: candidates/);
  assert.match(fetcher, /function resolveSectionWindow/);
  assert.match(fetcher, /FULL RETRIEVED SOURCE TEXT \(from section \$\{resolved\.section\}\)/);

  const practice = fs.readFileSync(path.join(root, 'app', 'lib', 'practice-issue-rules.ts'), 'utf8');
  assert.match(practice, /export function getPracticeCitationSectionMap/);
  assert.match(practice, /sectionCandidates\?: string\[\]/);

  const armor = fs.readFileSync(path.join(root, 'app', 'lib', 'armor-routing-rules.ts'), 'utf8');
  assert.match(armor, /export function getArmorCitationSectionMap/);
  assert.match(armor, /parsePrefixedCitations\(rule\.targetCitation\)/);
});

test('FY26 class-deviation mirror contains no font-encoding garble', () => {
  const mirror = fs.readFileSync(
    path.join(root, 'knowledge', 'armor-gpt', 'pdf-text', 'DoD_Class_Deviations_FY26v04_dated_2Feb2026.txt'),
    'utf8',
  );
  assert.doesNotMatch(mirror, /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/, 'mirror should carry no C0 control bytes');
  assert.doesNotMatch(mirror, /SGDWH|XSGDWH|HEUXDU/);
  assert.match(mirror, /Class Deviations - 2 February 2026/);
  assert.match(mirror, /Highlights indicate DPCAP/);
  assert.match(mirror, /website changes since 9/);
  assert.match(mirror.replace(/\s+/g, ' '), /Below are all the current DoD class deviations in effect/);
});

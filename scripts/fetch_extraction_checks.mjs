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
  parsePrefixedCitationTargets,
  dfarsSectionCandidates,
  findParagraphWindow,
  findDeviationWindow,
  findClausePrescription,
  extractDeviationIds,
  decodeHtmlEntities,
  sentenceCutIndex,
  snapExcerptStart,
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
    [{ part: '237', section: '237.873-3', paragraph: '(a)' }],
  );
  assert.deepEqual(
    extractSectionCitations('Can the HCA delegate under 1.107(b)?'),
    [{ part: '1', section: '1.107', paragraph: '(b)' }],
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
  assert.match(fetcher, /getPracticeCitationTargetMap\(question\)/);
  assert.match(fetcher, /getArmorCitationTargetMap\(question\)/);
  assert.match(fetcher, /dfarsSectionCandidates\(farCitation\)/);
  assert.match(fetcher, /sectionCandidates: candidates/);
  assert.match(fetcher, /function resolveSectionWindow/);
  assert.match(fetcher, /FULL RETRIEVED SOURCE TEXT \(from section \$\{resolved\.section\}\)/);

  const practice = fs.readFileSync(path.join(root, 'app', 'lib', 'practice-issue-rules.ts'), 'utf8');
  assert.match(practice, /export function getPracticeCitationSectionMap/);
  assert.match(practice, /export function getPracticeCitationTargetMap/);
  assert.match(practice, /sectionCandidates\?: string\[\]/);

  const armor = fs.readFileSync(path.join(root, 'app', 'lib', 'armor-routing-rules.ts'), 'utf8');
  assert.match(armor, /export function getArmorCitationSectionMap/);
  assert.match(armor, /export function getArmorCitationTargetMap/);
  assert.match(armor, /parsePrefixedCitationTargets\(rule\.targetCitation\)/);
});

// ------------------------------------------------------------------
// Round 3: pinpoint paragraph verification + Part 33 routing.
// Fixtures below are modeled on the LIVE acquisition.gov RFO pages
// and mirror files as fetched 2026-11-02 (normalized the way the
// fetcher normalizes them). Federal regulatory text is public domain.
// ------------------------------------------------------------------

// The RFO FAR Part 1 conventions section. NOTE the RFO renumbering:
// legacy FAR 1.108's conventions now live at RFO FAR 1.107, with the
// same paragraph letters; RFO FAR 1.108 is the inflation section.
const RFO_1_107_BODY = [
  '1.107 FAR conventions.',
  '(a) Words and terms . (1) Definitions in part 2 apply to the entire regulation unless specifically defined in another part, subpart, section, provision, or clause. (2) Undefined words retain their common dictionary meaning.',
  '(b) Delegation of authority. Each authority is delegable unless specifically stated otherwise.',
  '(c) Dollar thresholds . (1) Unless otherwise specified, a specific dollar threshold is the final anticipated dollar value of the action, including the dollar value of all options.',
  '(d) Applying FAR changes to solicitations and contracts . Unless otherwise specified- (1) FAR changes apply to solicitations issued on or after the effective date of the change; (2) Contracting officers may, at their discretion, include the FAR changes in solicitations issued before the effective date.',
  '(e) Citations . When the FAR cites a statute, the citation includes all applicable amendments, unless otherwise stated.',
  '(f) Required action . When a sentence directs action, the contracting officer is responsible for the action, unless another party is expressly cited.',
].join(' ');

test('parsePrefixedCitationTargets keeps the pinpoint paragraph chain', () => {
  assert.deepEqual(parsePrefixedCitationTargets('RFO FAR 1.107(b)'), [
    { kind: 'rfo_far', part: '1', section: '1.107', paragraph: '(b)' },
  ]);
  assert.deepEqual(parsePrefixedCitationTargets('DFARS RFO 217.104-370(b)(1)(iv)'), [
    { kind: 'dfars_rfo', part: '217', section: '217.104-370', paragraph: '(b)(1)(iv)' },
  ]);
  assert.deepEqual(parsePrefixedCitationTargets('RFO FAR 50.103-5'), [
    { kind: 'rfo_far', part: '50', section: '50.103-5' },
  ]);
  // The paragraph-free export stays paragraph-free for its callers.
  assert.deepEqual(parsePrefixedCitations('RFO FAR 1.107(b)'), [
    { kind: 'rfo_far', part: '1', section: '1.107' },
  ]);
});

test('findParagraphWindow pins the delegation paragraph (b) inside RFO 1.107', () => {
  const sectionWindow = findSectionWindow(`Subpart 1.1 - Framework ${RFO_1_107_BODY} 1.108 Statutory thresholds.`, '1.107');
  assert.ok(sectionWindow);
  const pinned = findParagraphWindow(sectionWindow.excerpt, '(b)');
  assert.ok(pinned, 'paragraph (b) should be located');
  assert.match(pinned.excerpt, /^1\.107 FAR conventions\./);
  assert.match(pinned.excerpt, /\(b\) Delegation of authority\. Each authority is delegable unless specifically stated otherwise\./);
  // The (a) lead-in is elided, not carried into the pinpoint excerpt.
  assert.doesNotMatch(pinned.excerpt, /Undefined words retain their common dictionary meaning/);
});

test('findParagraphWindow pins (d) and (f) of RFO 1.107 and rejects absent paragraphs', () => {
  const d = findParagraphWindow(RFO_1_107_BODY, '(d)');
  assert.ok(d);
  assert.match(d.excerpt, /\(d\) Applying FAR changes to solicitations and contracts/);
  const f = findParagraphWindow(RFO_1_107_BODY, '(f)');
  assert.ok(f);
  assert.match(f.excerpt, /\(f\) Required action/);
  assert.match(f.excerpt, /the contracting officer is responsible for the action/);
  assert.equal(findParagraphWindow(RFO_1_107_BODY, '(z)'), null);
  assert.equal(findParagraphWindow(RFO_1_107_BODY, ''), null);
});

test('findParagraphWindow does not mistake an in-text paragraph reference for the paragraph', () => {
  // Modeled on the real RFO FAR 41.102 body: paragraph (a) REFERS to
  // "paragraph (b) of this section" before the actual (b) begins.
  const excerpt = '41.102 Applicability. (a) Except as provided in paragraph (b) of this section, this part applies to the acquisition of utility services for the Government, including connection charges and termination liabilities. (b) This part does not apply to- (1) Utility services produced, distributed, or sold by another Federal agency. In those cases, agencies must use interagency agreements; (2) Utility services obtained by purchase, exchange, or otherwise by a Federal power or water marketing agency incident to that agency\'s marketing or distribution program; or (3) Third party financed shared-savings projects authorized by 42 U.S.C. 8287.';
  const pinned = findParagraphWindow(excerpt, '(b)(3)');
  assert.ok(pinned, 'the real (b) paragraph should be located');
  assert.match(pinned.excerpt, /\(b\) This part does not apply to/);
  assert.match(pinned.excerpt, /\(3\) Third party financed shared-savings projects/);
  assert.doesNotMatch(pinned.excerpt, /Except as provided in paragraph/);
});

// Modeled on the real RFO FAR Part 33 page: TOC first, then the body.
// RFO FAR 33.205-1(a)(1) routes contractor claim-submission
// requirements to the Disputes clause at 52.233-1(d); the legacy
// section 33.206 does not exist anywhere in the RFO text.
const PART_33_PAGE = [
  'Part 33 - Protests, Disputes, and Appeals',
  '33.205 Postaward. 33.205-1 Contractor claim. 33.205-2 Contractor certification. 33.205-4 Suspected fraudulent claims.',
  '33.205 Postaward.',
  '33.205-1 Contractor claim. (a) Contractor claims against the Government. (1) Contractor requirements for submission of claims are located at 52.233-1(d). (2) The contracting officer must document in the contract file the date of receipt of a claim submitted by a contractor. (b) Government claims against a contractor. The contracting officer must issue a written decision on any Government claim against a contractor within 6 years after accrual of the claim.',
  '33.205-2 Contractor certification. (a) Contractor requirements for certification of claims exceeding $100,000 are located at 52.233-1(d).',
].join(' ');

test('Part 33: the RFO claim section resolves and the legacy section is absent', () => {
  const window = findSectionWindow(PART_33_PAGE, '33.205-1');
  assert.ok(window, 'window should be found');
  assert.match(window.excerpt, /Contractor requirements for submission of claims are located at 52\.233-1\(d\)/);
  // Legacy FAR 33.206 has no body in RFO text — this is why the
  // router keeps the rule table's RFO section as a verified fallback
  // candidate when a question cites the legacy number.
  assert.equal(findSectionWindow(PART_33_PAGE, '33.206'), null);
});

// Modeled on the real RFO FAR Part 50 page structure.
const PART_50_PAGE = [
  'Part 50 - Extraordinary Contractual Actions',
  '50.102-3 Limitations on exercise of authority. 50.103-3 Contractor requests. 50.103-5 Processing cases. 50.103-6 Disposition.',
  '50.102-3 Limitations on exercise of authority. (a) Pub. L. 85-804 is not authority for- (1) Using a cost-plus-a-percentage-of-cost system of contracting; (2) Making any contract that violates existing law limiting profit or fees.',
  '50.103-5 Processing cases. In response to a contractor request made in accordance with 50.103-3, the contracting officer or an authorized representative shall make a thorough investigation to establish the facts necessary to decide a given case.',
  '50.103-6 Disposition. Each case shall be documented.',
].join(' ');

test('Part 50: 50.103-5 body resolves instead of the old wildcard landing (50.102-3)', () => {
  const window = findSectionWindow(PART_50_PAGE, '50.103-5');
  assert.ok(window, 'window should be found');
  assert.match(window.excerpt, /50\.103-5 Processing cases\./);
  assert.match(window.excerpt, /shall make a thorough investigation/);
  assert.doesNotMatch(window.excerpt, /cost-plus-a-percentage-of-cost/);
});

test('findClausePrescription resolves 252.205-7000 to its prescription in the real Part 205 text', () => {
  const raw = fs.readFileSync(
    path.join(root, 'knowledge', 'armor-gpt', 'dfars-rfo', 'DFARS-RFO-PART-205-Attachment-1.txt'),
    'utf8',
  );
  const text = normalizeLikeFetcher(raw);
  // Documented key-vs-text finding: the April answer key names
  // 205.470, but that section does not exist in the controlling
  // DFARS RFO text (nor in the PGI 205 file); the clause itself
  // states "As prescribed in 205.701". Extraction follows the text.
  assert.ok(!/\b205\.470\b/.test(text), '205.470 must stay absent from the RFO Part 205 text');
  const prescription = findClausePrescription(text, '252.205-7000');
  assert.ok(prescription, 'prescription should resolve');
  assert.equal(prescription.section, '205.701');
  assert.match(prescription.window.excerpt, /Insert the clause at 252\.205-7000/);
  assert.match(prescription.window.excerpt, /Provision of Information to Cooperative Agreement Holders/);
});

test('findClausePrescription generalizes to the Germany warranty clause (252.246-7002)', () => {
  const raw = fs.readFileSync(
    path.join(root, 'knowledge', 'armor-gpt', 'dfars-rfo', 'DFARS-RFO-PART-246-Attachment-1.txt'),
    'utf8',
  );
  const text = normalizeLikeFetcher(raw);
  const prescription = findClausePrescription(text, '252.246-7002');
  assert.ok(prescription, 'prescription should resolve');
  assert.equal(prescription.section, '246.710');
  assert.match(prescription.window.excerpt, /Warranty of Construction \(Germany\)/);
});

test('extractDeviationIds reads deviation numbers from questions and rule strings', () => {
  assert.deepEqual(extractDeviationIds('Does CD 2021-O0008 change the clause?'), ['2021-O0008']);
  assert.deepEqual(extractDeviationIds('CD 2021-O0008 Revision 1'), ['2021-O0008']);
  assert.deepEqual(extractDeviationIds('compare 2018-O0019 with 2017-O0004 and 2018-O0019'), ['2018-O0019', '2017-O0004']);
  assert.deepEqual(extractDeviationIds('no deviation here'), []);
});

test('findDeviationWindow lands on the 2021-O0008 memo/attachment in the real FY26 mirror', () => {
  const raw = fs.readFileSync(
    path.join(root, 'knowledge', 'armor-gpt', 'pdf-text', 'DoD_Class_Deviations_FY26v04_dated_2Feb2026.txt'),
    'utf8',
  );
  const text = normalizeLikeFetcher(raw);
  const firstMention = text.indexOf('2021-O0008');
  const window = findDeviationWindow(text, '2021-O0008');
  assert.ok(window, 'window should be found');
  // The body anchor is the deviation's own memo block, deep in the
  // mirror — never the up-front enumeration list mention.
  assert.ok(window.start > firstMention, 'window must not start at the enumeration list');
  assert.ok(window.start > 100000, 'fixture assumption: the memo block sits past 100k characters');
  assert.match(window.excerpt, /DARS Tracking Number: 2021-O0008, Revision 1/);
  assert.match(window.excerpt, /Class Deviation—Limitations on Subcontracting for Small Business/);
  // Simulate prepareSourceContent + trimSource(10000): rebasing the
  // full text at the window start puts the operative deviation
  // language (use the attachment clause in lieu of FAR 52.219-14)
  // inside the model context budget for the first time.
  const context = text.slice(window.start, window.start + 10000);
  assert.match(context, /in lieu of the clause at Federal Acquisition Regulation \(FAR\) 52\.219-14/);
  // An unknown deviation number resolves to nothing, honestly.
  assert.equal(findDeviationWindow(text, '2099-O9999'), null);
});

test('round 3 wiring: claims routing, paragraph pinning, deviation and clause targeting', () => {
  const fetcher = fs.readFileSync(path.join(root, 'app', 'lib', 'fetcher.ts'), 'utf8');
  // Item 1: the generic router now covers the claims/disputes family.
  assert.match(fetcher, /'contract disputes'/);
  assert.match(fetcher, /Contract Disputes Act claim submission and decision rules/);
  // Paragraph pinning, deviation windows, and clause prescriptions
  // are all wired into routing and extraction.
  assert.match(fetcher, /getPracticeCitationTargetMap\(question\)/);
  assert.match(fetcher, /getPracticeDeviationId\(question\)/);
  assert.match(fetcher, /extractDeviationIds\(question\)/);
  assert.match(fetcher, /findParagraphWindow\(resolved\.window\.excerpt, request\.paragraph\)/);
  assert.match(fetcher, /findDeviationWindow\(text, request\.deviationId\)/);
  assert.match(fetcher, /findClausePrescription\(text, request\.clause\)/);
  assert.match(fetcher, /prescription\.section === request\.section/);
  assert.match(fetcher, /SECTION_LEAD_IN_CHARS = 1500/);
  assert.match(fetcher, /FULL RETRIEVED SOURCE TEXT \(from class deviation \$\{request\.deviationId\}\)/);
  // The conventions kind has its own targeted patterns, keyed to the
  // RFO conventions section (1.107), and Part 50 no longer wildcards.
  assert.match(fetcher, /'rfo_conventions:1': \[\/1\\\.107/);
  assert.ok(!fetcher.includes('50\\.\\d+'), 'the Part 50 first-section wildcard target must be gone');
  assert.match(fetcher, /'rfo_far:50': \[\/50\\\.103-5/);

  const rules = JSON.parse(fs.readFileSync(path.join(root, 'app', 'lib', 'practice-issue-rules.json'), 'utf8'));
  const byId = Object.fromEntries(rules.map(rule => [rule.id, rule]));
  // Item 1: the practice rule catches scenario phrasings, not only
  // the exact "submit a claim by email" string.
  assert.ok(byId.contractor_claim_email.match.includes('contract disputes act'));
  assert.ok(byId.contractor_claim_email.match.includes('claim by e-mail'));
  // Item 2b: RFO renumbered the conventions section 1.108 -> 1.107
  // with the same paragraph letters; the tables now target 1.107.
  assert.deepEqual(byId.delegation_national_security_exemption.expectedCitations, ['RFO FAR 1.107(b)']);
  assert.deepEqual(byId.hca_variable_unit_price_delegation.expectedCitations, ['RFO FAR 1.107(b)']);
  assert.deepEqual(byId.far_change_current_solicitation.expectedCitations, ['RFO FAR 1.107(d)']);
  assert.deepEqual(byId.far_63027_congress_notice_actor.expectedCitations, ['RFO FAR 1.107(f)']);
  // Item 2c: the relief rule targets the pinpoint section, not the
  // whole part.
  assert.deepEqual(byId.extraordinary_contractual_relief_funds.expectedCitations, ['RFO FAR 50.103-5']);
  // Item 2d: the deviation rule still names CD 2021-O0008, which the
  // router now turns into a deviation-window target.
  assert.deepEqual(byId.limitations_on_subcontracting_class_deviation.expectedCitations, ['CD 2021-O0008 Revision 1']);
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

test('decodeHtmlEntities resolves the entities acquisition.gov actually emits', () => {
  assert.equal(decodeHtmlEntities('acquisition&ndash;related thresholds'), 'acquisition\u2013related thresholds');
  assert.equal(decodeHtmlEntities('the contracting officer&rsquo;s decision'), 'the contracting officer\u2019s decision');
  assert.equal(decodeHtmlEntities('&ldquo;Stop work&rdquo; under &sect; 15.206&hellip;'), '\u201CStop work\u201D under \u00A7 15.206\u2026');
  // amp/lt/gt belong to the fetcher's own pass and must pass through here.
  assert.equal(decodeHtmlEntities('fish &amp; chips &lt;tag&gt;'), 'fish &amp; chips &lt;tag&gt;');
  // Unknown entities are evidence too; leave them exactly as found.
  assert.equal(decodeHtmlEntities('a &bogus; b'), 'a &bogus; b');
});

test('sentenceCutIndex ends on a complete sentence, not mid-thought', () => {
  const text =
    'Offerors excluded from the competitive range may submit a written request. ' +
    'The request must be submitted no later than 3 days after receipt of the notice of exclusion from the competition. ' +
    'If the debriefing is held in person, it must include the source selection authority and a very long tail of additional procedural detail.';
  const cut = sentenceCutIndex(text, 200);
  assert.ok(cut > 0, 'a sentence boundary inside the budget should be found');
  assert.equal(text.slice(0, cut).endsWith('competition.'), true);
  // Abbreviations are not sentence ends: Pub. L. must not be the cut.
  const law =
    'Section 813 of the NDAA for FY 2017 (Pub. L. 114-328) limits use of the approach. ' +
    'The proposed technical approaches will require no subjective judgment.';
  const lawCut = sentenceCutIndex(law, 95);
  assert.equal(law.slice(0, lawCut).endsWith('approach.'), true);
});

test('snapExcerptStart repairs a mid-sentence window start', () => {
  const window =
    'on 813 of the NDAA for FY 2017 (Pub. L. 114-328) limits use of the lowest price technically acceptable source selection approach. ' +
    '(iii) The proposed technical approaches will require no, or minimal, subjective judgment.';
  const snapped = snapExcerptStart(window);
  assert.ok(snapped.startsWith('... (iii) The proposed technical approaches'), snapped);
  // Anchored starts (headings, section numbers) are never snapped.
  const heading = '15.206-2 Preaward debriefing. Offerors excluded from the competitive range may ask.';
  assert.equal(snapExcerptStart(heading), heading);
  // A lowercase start with no reachable boundary is left as found.
  const fragment = 'within 3 days after receipt of the notice and then a long unbroken continuation without any sentence stop at all in this span';
  assert.equal(snapExcerptStart(fragment), fragment);
});

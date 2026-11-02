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
const { extractSectionCitations, findSectionWindow, stripControlCharacters } = await import(pathToFileURL(tempPath).href);

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

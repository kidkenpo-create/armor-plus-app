import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';

const root = process.cwd();
const sourcePath = path.join(root, 'app', 'lib', 'parse-armor-output.ts');
const tempPath = path.join(os.tmpdir(), `parse-armor-output-${process.pid}.mjs`);
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

fs.writeFileSync(tempPath, compiled);
const { parseArmorOutput } = await import(pathToFileURL(tempPath).href);

test.after(() => {
  fs.rmSync(tempPath, { force: true });
});

test('parseArmorOutput keeps STEP 4 when synthesis content is on the header line', () => {
  const parsed = parseArmorOutput(`
0) BLUF -- Definitive RFO FAR 14.211-3(a)(1)

STEP 1 -- Acquisition Facts: N/A

STEP 2 -- Regulatory Framework:
RFO FAR->DFARS RFO

STEP 3A -- Zoom-Out
Part boundary confirmed.

STEP 3B -- Rungs
1. RFO FAR -- R.

STEP 4 -- Synthesis: The current RFO FAR location is 14.211-3(a)(1). This explains step one.

STEP 5 -- Final Receipt
- Cite: RFO FAR 14.211-3(a)(1)

STEP 6 -- Final Determination
Use RFO FAR 14.211-3(a)(1).

STEP 7 -- User Validation Required
1. N/A
`);

  const step4 = parsed.steps.find(step => step.num === '4');
  const step5 = parsed.steps.find(step => step.num === '5');

  assert.ok(step4, 'STEP 4 should be retained in structured output');
  assert.equal(step4.title, 'Synthesis');
  assert.match(step4.content, /current RFO FAR location is 14\.211-3\(a\)\(1\)/);
  assert.ok(step5, 'STEP 5 should still parse after same-line STEP 4');
});

test('parseArmorOutput preserves multiline step bodies', () => {
  const parsed = parseArmorOutput(`
STEP 4 -- Synthesis
Line one.
Line two.

STEP 5 -- Final Receipt
Receipt text.
`);

  assert.deepEqual(parsed.steps.map(step => step.num), ['4', '5']);
  assert.equal(parsed.steps[0].title, 'Synthesis');
  assert.equal(parsed.steps[0].content, 'Line one.\nLine two.');
});


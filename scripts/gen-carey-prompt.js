// Generates src/config/careySystemPrompt.ts from SYS_PROMPT.md (the human-
// editable source of truth) plus a [CRISIS] tag appendix that the AIBots path
// gets from its server-seeded prompt but the direct-LLM path needs explicitly
// (src/lib/crisisDetection.ts depends on the model prefixing crisis replies
// with [CRISIS]).
//
// Run after editing SYS_PROMPT.md:  npm run gen:prompt
//
// Content is embedded via JSON.stringify so all quoting/Unicode is escaped
// safely, and bundled as a constant (runtime file reads are unreliable on
// Vercel serverless).

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcPath = path.join(root, 'SYS_PROMPT.md');
const outPath = path.join(root, 'src', 'config', 'careySystemPrompt.ts');

const base = fs.readFileSync(srcPath, 'utf8');

const appendix = [
  '',
  '',
  '==================================================',
  'CRISIS TAG (system integration - required)',
  '==================================================',
  '',
  'When you determine the user is in crisis or high risk (State 8, Crisis Routing),',
  'you MUST begin that reply with the exact literal tag [CRISIS] followed by your message.',
  'Emit [CRISIS] ONLY for genuine crisis routing, never otherwise.',
  'Never mention or explain the tag to the user.',
].join('\n');

const full = base + appendix;

const output = [
  '// AUTO-GENERATED — do not edit by hand.',
  '// Source: SYS_PROMPT.md (+ a [CRISIS] tag appendix required by',
  '// src/lib/crisisDetection.ts). Regenerate with:  npm run gen:prompt',
  '// Only DirectLLMClient uses this; the AIBots path uses the server-seeded prompt.',
  '',
  'export const CAREY_SYSTEM_PROMPT = ' + JSON.stringify(full) + ';',
  '',
].join('\n');

fs.writeFileSync(outPath, output, 'utf8');
console.log(`Wrote ${path.relative(root, outPath)} (${output.length} bytes) from SYS_PROMPT.md`);

'use strict';
/**
 * Diversity test for the `daily_surprise` preset AFTER the randomness rework.
 *
 * The app now injects fresh per-run entropy into the prompt: the {{RANDOM4}}
 * placeholder is replaced by an integer 0–3 (see IslamicAssistantCard._injectRandom),
 * and the prompt tells Claude to execute ONLY the option matching that number.
 * This script mirrors that injection: it rolls 0–3 per run, substitutes it, and
 * checks (a) the option distribution across runs and (b) whether Claude actually
 * obeyed the injected roll (adherence).
 *
 * Within-tool content randomness (get_quran / get_dua open random, etc.) is pure
 * Node Math.random and is verified separately with stubbed rng — not exercised
 * here because this script stubs the tools to observe only the SELECTION.
 *
 * Usage:   node scripts/test-surprise-diversity.js
 * Needs:   ANTHROPIC_API_KEY in env or a .env file at the project root.
 */

const fs   = require('fs');
const path = require('path');

// ── API key: env > project root .env > sibling TelegramNewsReader .env ────────
function loadDotEnv(dir) {
  const f = path.join(dir, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)\s*$/);
    if (m && !process.env[m[1]])
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
  }
}
const ROOT = path.join(__dirname, '..');
loadDotEnv(ROOT);
loadDotEnv(path.join(ROOT, '..', 'TelegramNewsReader'));

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error('ANTHROPIC_API_KEY not set. Add it to .env or export it before running.');
  process.exit(1);
}

// ── Pull the REAL preset prompt from the library so the test never drifts ─────
const PromptLibrary = require('../lib/PromptLibrary');
const presets = PromptLibrary.list ? PromptLibrary.list() : (PromptLibrary.DEFAULT_PRESETS || []);
const SURPRISE = (presets || []).find(p => p.id === 'daily_surprise');
if (!SURPRISE) { console.error('daily_surprise preset not found in PromptLibrary'); process.exit(1); }
const PROMPT_TEMPLATE = SURPRISE.prompt;
if (PROMPT_TEMPLATE.indexOf('{{RANDOM4}}') === -1) {
  console.error('Preset has no {{RANDOM4}} placeholder — randomness rework not applied?');
  process.exit(1);
}

// Mirror IslamicAssistantCard._injectRandom (single value reused per run).
function injectRandom(prompt, roll) {
  return prompt.replace(/\{\{RANDOM4\}\}/g, String(roll)).replace(/\{\{RANDOM\}\}/g, String(roll));
}

// ── Config ────────────────────────────────────────────────────────────────────
const API_URL    = 'https://api.anthropic.com/v1/messages';
const MODEL      = 'claude-sonnet-4-6';
const RUNS       = 20;       // 5 per option in expectation
const MAX_TOKENS = 800;

const SYSTEM = [
  'You are an Islamic assistant for a Muslim household, reached over Telegram.',
  'Tone: warm, conversational, family-friendly. Language: respond in English only.',
  '',
  'CONTENT TOOLS return only a PLACEHOLDER token (e.g. {{BLOCK1}}) — never the text itself.',
  'Write your own words and place each placeholder exactly where its content belongs.',
  'Do NOT write, quote, translate, or summarise any verse/hadith/dua/ruling yourself.',
].join('\n');

const TOOLS = [
  { name: 'get_hadith_explained',
    description: 'Authenticated hadith from HadeethEnc with grade + scholarly explanation. No input = random.',
    input_schema: { type: 'object', properties: { id: { type: 'number' } }, required: [] } },
  { name: 'get_quran',
    description: 'One Quran verse from quran.com. No input = open random verse with tafsir bundled.',
    input_schema: { type: 'object', properties: {
      surah: { type: 'number' }, ayah: { type: 'number' }, query: { type: 'string' }, tafsir: { type: 'boolean' } },
      required: [] } },
  { name: 'get_tafsir',
    description: 'Tafsir for a single ayah. Use only when you already have a surah/ayah reference.',
    input_schema: { type: 'object', properties: { surah: { type: 'number' }, ayah: { type: 'number' } },
      required: ['surah', 'ayah'] } },
  { name: 'get_dua',
    description: 'One dua/adhkar chapter from Hisn al-Muslim. No input = open random adhkar.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: [] } },
  { name: 'get_fatwa',
    description: 'One published fatwa from IslamQA.info. No input = random fatwa.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, id: { type: 'number' } },
      required: [] } },
];

// option number → the tool that signals it
const OPTION_FOR_TOOL = {
  get_hadith_explained: 0, get_quran: 1, get_tafsir: 1, get_dua: 2, get_fatwa: 3,
};
const OPTION_LABEL = {
  0: '0  Explained hadith   [get_hadith_explained]',
  1: '1  Quran + tafsir     [get_quran]',
  2: '2  Adhkar / dua       [get_dua]',
  3: '3  Fatwa              [get_fatwa]',
};

async function callAPI(body) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  return res.json();
}

async function runOnce(runIndex, roll) {
  const toolsCalled = [];
  const stub = (name, input) => {
    toolsCalled.push({ name, input: input || {} });
    return { placeholder: `{{BLOCK${toolsCalled.length}}}`, ref: `stub-${name}` };
  };
  const base = {
    model: MODEL, max_tokens: MAX_TOKENS,
    system: [{ type: 'text', text: SYSTEM }], tools: TOOLS,
    messages: [{ role: 'user', content: injectRandom(PROMPT_TEMPLATE, roll) }],
  };
  let convo = base.messages.slice();
  let data = await callAPI({ ...base, messages: convo });
  let rounds = 0;
  while (data.stop_reason === 'tool_use' && rounds < 5) {
    const blocks = (data.content || []).filter(b => b.type === 'tool_use');
    if (!blocks.length) break;
    const results = blocks.map(tb => ({
      type: 'tool_result', tool_use_id: tb.id, content: JSON.stringify(stub(tb.name, tb.input)),
    }));
    convo = [...convo, { role: 'assistant', content: data.content }, { role: 'user', content: results }];
    rounds++;
    data = await callAPI({ ...base, messages: convo });
  }
  return { run: runIndex, roll, toolsCalled };
}

(async () => {
  console.log(`\n▶  daily_surprise ×${RUNS} — fresh {{RANDOM4}} roll injected per run (model: ${MODEL})\n`);
  const rolls = Array.from({ length: RUNS }, () => Math.floor(Math.random() * 4));

  const start = Date.now();
  const settled = await Promise.allSettled(rolls.map((roll, i) => runOnce(i + 1, roll)));
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  const executedCounts = {};   // option actually executed
  const rolledCounts   = {};   // option requested by the injected roll
  let adhered = 0, scored = 0, multiTool = 0;
  const lines = [];

  for (const res of settled) {
    if (res.status === 'rejected') { lines.push(`  ✗ ERROR: ${res.reason?.message || res.reason}`); continue; }
    const { run, roll, toolsCalled } = res.value;
    rolledCounts[roll] = (rolledCounts[roll] || 0) + 1;
    if (!toolsCalled.length) { lines.push(`  Run ${String(run).padStart(2)}: roll ${roll} → (no tool called)`); continue; }

    const exec = OPTION_FOR_TOOL[toolsCalled[0].name];
    executedCounts[exec] = (executedCounts[exec] || 0) + 1;
    const ok = exec === roll;
    scored++; if (ok) adhered++;
    if (toolsCalled.length > 1) multiTool++;

    const chain = toolsCalled.map(t => {
      const args = Object.entries(t.input).filter(([, v]) => v !== undefined && v !== '');
      return args.length ? `${t.name}(${args.map(([k, v]) => `${k}=${v}`).join(',')})` : `${t.name}()`;
    }).join(' → ');
    lines.push(`  Run ${String(run).padStart(2)}: roll ${roll} → executed ${exec} ${ok ? '✅' : '❌ MISMATCH'}  ${chain}`);
  }

  console.log('━━━  Per-run  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.forEach(l => console.log(l));

  console.log('\n━━━  Executed-option distribution  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const total = Object.values(executedCounts).reduce((a, b) => a + b, 0);
  for (let o = 0; o <= 3; o++) {
    const c = executedCounts[o] || 0;
    const bar = '█'.repeat(c) + '░'.repeat(Math.max(0, RUNS - c));
    console.log(`  ${OPTION_LABEL[o].padEnd(40)} ${bar}  ${c}/${total}`);
  }

  const probs = Object.values(executedCounts).map(c => c / total);
  const entropy = probs.reduce((h, p) => (p > 0 ? h - p * Math.log2(p) : h), 0);
  const uniformity = (entropy / Math.log2(4)) * 100;

  console.log('\n━━━  Scores  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Injected-roll spread    : ${[0,1,2,3].map(o => `${o}:${rolledCounts[o]||0}`).join('  ')}`);
  console.log(`  Unique options executed : ${Object.keys(executedCounts).length}/4`);
  console.log(`  Shannon entropy         : ${entropy.toFixed(3)} / 2.000 bits`);
  console.log(`  Uniformity score        : ${uniformity.toFixed(1)}%`);
  console.log(`  Roll adherence          : ${adhered}/${scored} (${scored ? Math.round(adhered/scored*100) : 0}%)  ← Claude obeyed the injected number`);
  console.log(`  Multi-tool runs         : ${multiTool} (should be 0 — one tool per option)`);
  console.log(`  Elapsed                 : ${elapsed}s`);

  console.log('\n━━━  Interpretation  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (adhered === scored && uniformity >= 85)
    console.log('  ✅  Excellent — Claude follows the injected roll and all four options appear.');
  else if (adhered / scored >= 0.8)
    console.log('  ⚠️   Mostly good — a few mismatches; consider tightening the mapping wording.');
  else
    console.log('  ❌  Poor adherence — Claude is not reliably mapping the roll to the option.');
  console.log('');
})();

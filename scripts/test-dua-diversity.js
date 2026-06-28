'use strict';
/**
 * Diversity harness for getDua random path.
 * Runs N calls (empty input + sentinel "random") and scores distribution.
 * Not part of the test suite — run on demand: node scripts/test-dua-diversity.js
 */
const { createRequire } = require('module');
const req = createRequire(__filename);

const { getDua, DUA_CATEGORIES } = req('../lib/ContentTools.js');

const RUNS = 20;

async function run() {
  const counts = {};
  const results = [];

  // Interleave: half with no input, half with sentinel "random"
  for (let i = 0; i < RUNS; i++) {
    const useRandom = i % 2 === 0;
    const res = useRandom
      ? await getDua({})
      : await getDua({ query: 'random' });

    const slug = res.meta?.category || res.meta?.error || 'ERROR';
    counts[slug] = (counts[slug] || 0) + 1;
    results.push({ run: i + 1, via: useRandom ? 'no-input' : '"random"', slug });
  }

  console.log('\n=== DUA DIVERSITY TEST — ' + RUNS + ' runs ===\n');
  results.forEach(r => console.log(`  #${String(r.run).padStart(2)} [${r.via.padEnd(10)}] → ${r.slug}`));

  const unique = Object.keys(counts).length;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const topSlug = sorted[0][0];
  const topCount = sorted[0][1];

  // Shannon entropy
  let entropy = 0;
  for (const [, n] of sorted) {
    const p = n / RUNS;
    entropy -= p * Math.log2(p);
  }
  const maxEntropy = Math.log2(DUA_CATEGORIES.length);

  console.log('\n=== RESULTS ===');
  console.log(`  Total runs:       ${RUNS}`);
  console.log(`  Unique chapters:  ${unique} / ${DUA_CATEGORIES.length} possible`);
  console.log(`  Most-frequent:    "${topSlug}" × ${topCount} (${Math.round(topCount / RUNS * 100)}%)`);
  console.log(`  Shannon entropy:  ${entropy.toFixed(3)} bits (max ${maxEntropy.toFixed(3)} = perfect uniform)`);
  console.log(`  Uniformity score: ${Math.round(entropy / maxEntropy * 100)}%\n`);

  if (unique === 1 && topSlug === 'morning-evening') {
    console.log('  ❌ FAIL — still pinned to morning-evening (bug not fixed)');
  } else if (unique < 5) {
    console.log('  ⚠️  WARN — low diversity, fewer than 5 unique chapters');
  } else {
    console.log('  ✅ PASS — healthy diversity across chapters');
  }
}

run().catch(err => { console.error(err); process.exit(1); });

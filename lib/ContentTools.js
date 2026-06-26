'use strict';

/**
 * ContentTools — fetches hadith and Quran verses and returns ready-to-send,
 * VERBATIM-formatted WhatsApp blocks.
 *
 * Design principle: the tool formats the scripture; Claude never rewrites it.
 * The card hands Claude the finished block and instructs it to relay verbatim,
 * which removes the hallucination risk at the source.
 *
 * Both functions take an injectable `fetchImpl` (defaults to global fetch) so
 * the test suite can drive them with canned responses and never hit the network.
 *
 * Sources (no API key required):
 *   - Hadith:  hadith-mcp.org (Sunnah.com) — search + canonical Arabic/English text
 *   - Hadith+: hadeethenc.com — graded hadith with sharh + benefit points
 *   - Quran:   mcp.quran.ai (quran.com) — verse, translation, and tafsir
 *   - Fatwa:   islamqa-mcp.org (IslamQA.info) — searchable published rulings
 *   - Duas:    Hisn al-Muslim — bundled locally (lib/data/hisn.json), no network call
 * The MCP sources speak JSON-RPC over Streamable HTTP via the shared mcp* helpers.
 */

const HISN = require('./data/hisn.json');

const HADITH_MCP   = 'https://hadith-mcp.org/';
const HADITH_ID_MAX = 40000; // dense global id space across the Sunnah.com collections
const QURAN_MCP   = 'https://mcp.quran.ai/';
const ISLAMQA_MCP = 'https://islamqa-mcp.org/';
const HADEETHENC_BASE = 'https://hadeethenc.com/api/v1';

// quran.ai editions (quran.com data). Concise picks that fit a Telegram message.
const QURAN_AR_EDITION          = 'ar-simple-clean';        // Arabic mushaf text
const QURAN_TRANSLATION_EDITION = 'en-sahih-international';  // English translation
const TAFSIR_EN      = 'en-tazkirul-quran'; // concise English tafsir (selective — has gaps)
const TAFSIR_EN_FULL = 'en-ibn-kathir';     // complete English tafsir (fallback for gaps)
const TAFSIR_AR      = 'ar-jalalayn';       // concise + complete Arabic tafsir (al-Jalalayn)
const TAFSIR_CAP     = 1200;                // cap only the long Ibn Kathir fallback for Telegram

// Surah names for citation (quran.ai's verse fetch returns text only, no name).
const SURAH_NAMES = [
  'Al-Fatihah', 'Al-Baqarah', 'Aal-E-Imran', 'An-Nisa', "Al-Ma'idah", "Al-An'am",
  "Al-A'raf", 'Al-Anfal', 'At-Tawbah', 'Yunus', 'Hud', 'Yusuf', "Ar-Ra'd", 'Ibrahim',
  'Al-Hijr', 'An-Nahl', 'Al-Isra', 'Al-Kahf', 'Maryam', 'Taha', 'Al-Anbiya', 'Al-Hajj',
  "Al-Mu'minun", 'An-Nur', 'Al-Furqan', "Ash-Shu'ara", 'An-Naml', 'Al-Qasas', 'Al-Ankabut',
  'Ar-Rum', 'Luqman', 'As-Sajdah', 'Al-Ahzab', 'Saba', 'Fatir', 'Ya-Sin', 'As-Saffat',
  'Sad', 'Az-Zumar', 'Ghafir', 'Fussilat', 'Ash-Shura', 'Az-Zukhruf', 'Ad-Dukhan',
  'Al-Jathiyah', 'Al-Ahqaf', 'Muhammad', 'Al-Fath', 'Al-Hujurat', 'Qaf', 'Adh-Dhariyat',
  'At-Tur', 'An-Najm', 'Al-Qamar', 'Ar-Rahman', "Al-Waqi'ah", 'Al-Hadid', 'Al-Mujadila',
  'Al-Hashr', 'Al-Mumtahanah', 'As-Saff', "Al-Jumu'ah", 'Al-Munafiqun', 'At-Taghabun',
  'At-Talaq', 'At-Tahrim', 'Al-Mulk', 'Al-Qalam', 'Al-Haqqah', "Al-Ma'arij", 'Nuh',
  'Al-Jinn', 'Al-Muzzammil', 'Al-Muddaththir', 'Al-Qiyamah', 'Al-Insan', 'Al-Mursalat',
  'An-Naba', "An-Nazi'at", 'Abasa', 'At-Takwir', 'Al-Infitar', 'Al-Mutaffifin',
  'Al-Inshiqaq', 'Al-Buruj', 'At-Tariq', "Al-A'la", 'Al-Ghashiyah', 'Al-Fajr', 'Al-Balad',
  'Ash-Shams', 'Al-Layl', 'Ad-Duha', 'Ash-Sharh', 'At-Tin', 'Al-Alaq', 'Al-Qadr',
  'Al-Bayyinah', 'Az-Zalzalah', 'Al-Adiyat', "Al-Qari'ah", 'At-Takathur', 'Al-Asr',
  'Al-Humazah', 'Al-Fil', 'Quraysh', "Al-Ma'un", 'Al-Kawthar', 'Al-Kafirun', 'An-Nasr',
  'Al-Masad', 'Al-Ikhlas', 'Al-Falaq', 'An-Nas',
];

// Everyday themes used to pull a *random* hadith via semantic search if a direct
// random id lookup keeps missing (a safety net — the id space is normally dense).
const HADITH_TOPICS = [
  'patience', 'gratitude', 'prayer', 'charity', 'kindness to parents', 'honesty',
  'mercy', 'forgiveness', 'good character', 'seeking knowledge', 'remembrance of Allah',
  'good neighbours', 'sincerity of intention', 'trust in Allah', 'modesty', 'truthfulness',
];

function defaultFetch() {
  if (typeof fetch === 'function') return fetch;
  throw new Error('No fetch implementation available');
}

async function fetchJson(fetchImpl, url) {
  const res = await fetchImpl(url);
  if (!res || !res.ok) throw new Error('HTTP ' + (res ? res.status : 'no-response'));
  return res.json();
}

function cleanWs(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

// Remove Telegram-Markdown control characters from EXTERNAL (source) text so that
// only our own balanced *bold* / _italic_ wrappers remain. A stray backtick or
// bracket in scripture/translation text unbalances Telegram's parser, which then
// rejects the message and falls back to literal-asterisk plain text. Applied to
// every external field that gets embedded in a relayed block.
function sanitizeMd(s) {
  return String(s == null ? '' : s).replace(/[*_`[\]]/g, '');
}

// Convert source HTML (some tafsir editions ship `<h2>`/`<p>` markup) into
// Telegram-friendly text that PRESERVES structure: headings become bold lines,
// paragraphs/blocks become blank-line-separated, list items get bullets. Stray
// Markdown control chars in the prose are stripped (via sanitizeMd) while our own
// heading bold is protected through sentinels so it survives that strip.
function htmlToTelegram(s) {
  let t = String(s == null ? '' : s);
  t = t.replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, '');                    // drop footnote markers
  t = t.replace(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi, '\n\x00$1\x01\n'); // heading → sentinel
  t = t.replace(/<li\b[^>]*>/gi, '\n• ');                                // list bullets
  t = t.replace(/<\/(p|div|li|tr|h[1-6]|ul|ol|blockquote)>/gi, '\n\n');  // block ends → break
  t = t.replace(/<br\s*\/?>/gi, '\n');                                   // line breaks
  t = t.replace(/<[^>]+>/g, '');                                         // strip remaining tags
  t = t.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
       .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'");
  t = sanitizeMd(t);                                                     // strip stray *_`[] from prose
  t = t.replace(/\x00([\s\S]*?)\x01/g, (_m, h) => '*' + h.trim() + '*'); // bold the headings
  t = t.replace(/[ \t]{2,}/g, ' ')                                       // tidy whitespace,
       .replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n')           // keeping newlines
       .replace(/\n{3,}/g, '\n\n').trim();
  return t;
}

// ── Minimal MCP client (JSON-RPC over Streamable HTTP + SSE) ───────────────────
// Shared by the IslamQA (fatwa) and Sunnah.com (hadith) MCP servers.
// Sessions are cached per-URL for MCP_SESSION_TTL ms so that multiple tool calls
// within one Claude turn (e.g. get_quran + get_tafsir) share one handshake.
const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
  'MCP-Protocol-Version': '2025-06-18',
};
const _mcpSessions = new Map(); // url → { sid, expiresAt }
const _mcpGrounded = new Set(); // sids that already had fetch_grounding_rules called
const MCP_SESSION_TTL = 30_000; // ms — safely within any server session lifetime
const MCP_TIMEOUT     = 15_000; // ms per individual fetch call

// Parse an MCP SSE response body → the JSON-RPC envelope.
function parseSSE(text) {
  const data = String(text || '')
    .split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
  if (!data) throw new Error('Empty MCP response');
  return JSON.parse(data);
}

// Wrap each MCP fetch with a per-call timeout so a slow server fails fast rather
// than hanging the whole Claude turn until the outer AbortController fires.
function mcpFetch(f, url, opts) {
  return f(url, { ...opts, signal: AbortSignal.timeout(MCP_TIMEOUT) });
}

// Handshake: initialize → capture session id → send initialized notification.
// Returns a cached session id if one is still live for this URL.
async function mcpInit(f, url) {
  const now = Date.now();
  const cached = _mcpSessions.get(url);
  if (cached && cached.expiresAt > now) return cached.sid;
  if (cached) _mcpGrounded.delete(cached.sid); // evict stale grounding record

  const res = await mcpFetch(f, url, {
    method: 'POST', headers: MCP_HEADERS,
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prayers-alert', version: '3' } },
    }),
  });
  if (!res || !res.ok) throw new Error('MCP init HTTP ' + (res ? res.status : 'no-response'));
  const sid = res.headers.get('mcp-session-id');
  await res.text(); // drain
  if (!sid) throw new Error('MCP init returned no session id');
  await mcpFetch(f, url, {
    method: 'POST', headers: { ...MCP_HEADERS, 'Mcp-Session-Id': sid },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  _mcpSessions.set(url, { sid, expiresAt: now + MCP_SESSION_TTL });
  return sid;
}

// Call one MCP tool and return its parsed text-block JSON.
async function mcpCall(f, url, sid, name, args, id = 2) {
  const res = await mcpFetch(f, url, {
    method: 'POST', headers: { ...MCP_HEADERS, 'Mcp-Session-Id': sid },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
  });
  if (!res || !res.ok) throw new Error('MCP ' + name + ' HTTP ' + (res ? res.status : 'no-response'));
  const env = parseSSE(await res.text());
  if (env.error) throw new Error(env.error.message || ('MCP ' + name + ' error'));
  const block = ((env.result && env.result.content) || []).find(b => b.type === 'text');
  return block ? JSON.parse(block.text) : null;
}

/**
 * Fetch a hadith from Sunnah.com via hadith-mcp.org, formatted for messaging.
 *   - `query` set → semantic search; relay the best match (topical / Q&A).
 *   - `id` set    → fetch that specific global hadith id.
 *   - neither     → a random hadith (random global id, retried on a miss).
 * Every record carries full Arabic + English + collection/chapter, so the block
 * honours the language setting with no missing-Arabic gaps.
 * @param {object} opts
 * @param {string} [opts.query]
 * @param {number} [opts.id]
 * @param {'arabic'|'english'|'both'} [opts.language='both']
 * @param {Function} [opts.fetchImpl]
 * @param {Function} [opts.rng]
 * @returns {Promise<{ block:string, meta:object }>}
 */
async function getHadith({ query, id, language = 'both', fetchImpl, rng } = {}) {
  const f = fetchImpl || defaultFetch();
  const r = rng || Math.random;
  const q = (query == null ? '' : String(query)).trim();
  const fetchOne = async (sid, hid) => {
    const fr = await mcpCall(f, HADITH_MCP, sid, 'fetch_hadith', { hadith_id: hid }, 3);
    return (fr && (fr.hadith || (fr.hadiths && fr.hadiths[0]))) || fr;
  };
  const hasText = (rec) => !!(rec && (rec.english || rec.arabic));
  try {
    const sid = await mcpInit(f, HADITH_MCP);
    let rec = null;

    if (parseInt(id, 10) > 0) {
      rec = await fetchOne(sid, parseInt(id, 10));
    } else if (q) {
      const sr = await mcpCall(f, HADITH_MCP, sid, 'search_hadith', { query: q, mode: 'semantic', limit: 5 });
      const rows = (sr && sr.results) || [];
      if (!rows.length) return { block: '', meta: { error: 'No hadith found for: ' + q } };
      rec = await fetchOne(sid, parseInt(rows[0].hadith_id, 10));
    } else {
      // Random: dense global id space; retry the rare miss, then fall back to a
      // random everyday topic search so a Flow never sends an empty message.
      for (let attempt = 0; attempt < 4 && !hasText(rec); attempt++) {
        rec = await fetchOne(sid, Math.floor(r() * HADITH_ID_MAX) + 1);
      }
      if (!hasText(rec)) {
        const term = HADITH_TOPICS[Math.floor(r() * HADITH_TOPICS.length)];
        const sr = await mcpCall(f, HADITH_MCP, sid, 'search_hadith', { query: term, mode: 'semantic', limit: 5 });
        const rows = (sr && sr.results) || [];
        if (rows.length) rec = await fetchOne(sid, parseInt(rows[Math.floor(r() * rows.length)].hadith_id, 10));
      }
    }

    if (!hasText(rec)) return { block: '', meta: { error: 'Hadith not found' } };
    return {
      block: formatHadith({
        arabic:       cleanWs(rec.arabic),
        narrator:     cleanWs(rec.narrator),
        english:      cleanWs(rec.english),
        collectionEn: rec.collection_name_english,
        collectionAr: rec.collection_name_arabic,
        chapterEn:    rec.chapter_name_english,
        chapterAr:    rec.chapter_name_arabic,
        language,
      }),
      meta: {
        id: rec.id, collection: rec.collection_name_english, number: rec.id_in_book,
        language, source: 'hadith-mcp.org', url: rec.url || null,
      },
    };
  } catch (e) {
    return { block: '', meta: { error: 'Could not fetch hadith: ' + e.message } };
  }
}

function formatHadith({ arabic, narrator, english, collectionEn, collectionAr, chapterEn, chapterAr, language }) {
  arabic = sanitizeMd(arabic); narrator = sanitizeMd(narrator); english = sanitizeMd(english);
  collectionEn = sanitizeMd(collectionEn); collectionAr = sanitizeMd(collectionAr);
  chapterEn = sanitizeMd(chapterEn); chapterAr = sanitizeMd(chapterAr);
  const ar = language === 'arabic';
  const out = [ar ? '📿 *حديث*' : '📿 *Hadith*', ''];
  if (language !== 'english' && arabic) out.push(arabic, '');
  if (language !== 'arabic') {
    if (narrator) out.push('_' + narrator + '_');
    if (english)  out.push(english, '');
  }
  const coll = ar ? (collectionAr || collectionEn) : (collectionEn || collectionAr);
  const chap = ar ? (chapterAr || chapterEn) : (chapterEn || chapterAr);
  const cite = [coll, chap].filter(Boolean).join(' · ');
  if (cite) out.push('*' + cite + '*');
  out.push('_hadith-mcp.org · sunnah.com_');
  return out.join('\n');
}

// Fire fetch_grounding_rules once per session so subsequent quran.ai responses
// omit the grounding_rules payload (lighter responses). Skipped if already called
// for this session (e.g. when get_quran and get_tafsir share a session in one turn).
async function mcpGround(f, url, sid) {
  if (_mcpGrounded.has(sid)) return;
  _mcpGrounded.add(sid);
  try {
    const res = await mcpFetch(f, url, {
      method: 'POST', headers: { ...MCP_HEADERS, 'Mcp-Session-Id': sid },
      body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'fetch_grounding_rules', arguments: {} } }),
    });
    if (res) await res.text(); // drain; the markdown body is not needed
  } catch (_) { /* non-fatal */ }
}

// Strip Sahih International footnote markup and any stray HTML, collapse spaces.
function stripMarkup(s) {
  return String(s || '')
    .replace(/<sup[^>]*>.*?<\/sup>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch a Quran ayah from quran.com via mcp.quran.ai, formatted for messaging.
 *   - `surah` + `ayah` → that verse.
 *   - `query`          → semantic search; uses the top matching ayah.
 * Arabic text (fetch_quran) and the Sahih International translation
 * (fetch_translation) are pulled per the language setting.
 * @param {object} opts
 * @param {number} [opts.surah] 1–114
 * @param {number} [opts.ayah]
 * @param {string} [opts.query] topic to search for instead of a fixed reference
 * @param {'arabic'|'english'|'both'} [opts.language='both']
 * @param {Function} [opts.fetchImpl]
 * @returns {Promise<{ block:string, meta:object }>}
 */
async function getQuran({ surah, ayah, query, language = 'both', fetchImpl } = {}) {
  const f = fetchImpl || defaultFetch();
  const q = (query == null ? '' : String(query)).trim();
  let s = parseInt(surah, 10);
  let a = parseInt(ayah, 10);
  try {
    const sid = await mcpInit(f, QURAN_MCP);
    await mcpGround(f, QURAN_MCP, sid);

    let key = (s >= 1 && s <= 114 && a >= 1) ? `${s}:${a}` : null;
    if (!key && q) {
      const sr = await mcpCall(f, QURAN_MCP, sid, 'search_quran', { query: q, translations: [QURAN_TRANSLATION_EDITION] });
      const top = ((sr && sr.results) || [])[0];
      if (top && top.ayah_key) { key = top.ayah_key; s = top.surah; a = top.ayah; }
    }
    if (!key) return { block: '', meta: { error: 'Invalid surah/ayah reference' } };
    if (!(s >= 1)) { [s, a] = key.split(':').map(Number); }

    const firstText = (resp, ed) => ((((resp && resp.results) || {})[ed] || [])[0] || {}).text;
    // Arabic and English are independent fetches — run in parallel (id 3 and 4 are
    // distinct JSON-RPC ids within the same session).
    const [qr, tr] = await Promise.all([
      language !== 'english'
        ? mcpCall(f, QURAN_MCP, sid, 'fetch_quran', { ayahs: [key], editions: [QURAN_AR_EDITION] }, 3)
        : null,
      language !== 'arabic'
        ? mcpCall(f, QURAN_MCP, sid, 'fetch_translation', { ayahs: [key], editions: [QURAN_TRANSLATION_EDITION] }, 4)
        : null,
    ]);
    const arabic  = qr ? stripMarkup(firstText(qr, QURAN_AR_EDITION)) : null;
    const english = tr ? stripMarkup(firstText(tr, QURAN_TRANSLATION_EDITION)) : null;
    if (!arabic && !english) return { block: '', meta: { error: 'Verse not found', ref: key } };

    const surahName = SURAH_NAMES[s - 1] || `Surah ${s}`;
    return {
      block: formatQuran({ arabic, english, surahName, surahNum: s, ayahNum: a, language }),
      meta:  { surahName, surahNum: s, ayahNum: a, language, source: 'quran.com' },
    };
  } catch (e) {
    return { block: '', meta: { error: 'Could not fetch ayah: ' + e.message } };
  }
}

function formatQuran({ arabic, english, surahName, surahNum, ayahNum, language }) {
  arabic = sanitizeMd(arabic); english = sanitizeMd(english); surahName = sanitizeMd(surahName);
  const out = [language === 'arabic' ? '☪️ *القرآن*' : '☪️ *Quran*', ''];
  if (language !== 'english' && arabic) out.push(arabic, '');
  if (language !== 'arabic' && english) out.push('"' + english + '"', '');
  out.push(`*${surahName} ${surahNum}:${ayahNum}*`);
  out.push('_quran.com_');
  return out.join('\n');
}

// ── Duas / adhkar (Hisn al-Muslim, bundled) ───────────────────────────────────

const DUA_CATEGORIES = Object.keys(HISN.categories);
const DUA_MAX_CHARS  = 3500;
const DUA_SEP_LEN    = '\n\n— — —\n\n'.length;

// Aliases pin common shorthands straight onto a slug (fast path + disambiguation
// for the canonical sets). Everything else is resolved by keyword search below,
// so the full ~132-chapter book is reachable without enumerating every slug.
const DUA_ALIASES = {
  morning: 'morning-evening', evening: 'morning-evening', adhkar: 'morning-evening',
  azkar: 'morning-evening', 'morning-and-evening': 'morning-evening', general: 'morning-evening',
  sleep: 'before-sleep', night: 'before-sleep', bedtime: 'before-sleep',
  'post-prayer': 'after-prayer', salah: 'after-prayer', salat: 'after-prayer',
  prayer: 'after-prayer', namaz: 'after-prayer',
  wake: 'waking', 'wake-up': 'waking',
  anxiety: 'distress', worry: 'distress', grief: 'distress', anguish: 'distress',
  sadness: 'distress', stress: 'distress', hardship: 'distress', difficulty: 'distress',
  journey: 'travel', traveling: 'travel', travelling: 'travel', trip: 'travel',
  angry: 'anger', forgiveness: 'repentance-seeking-forgiveness', istikhara: 'istikharah-seeking-allah',
};

// Lightweight in-memory search index: each chapter's slug + title tokenized once
// at load. Lets Claude pass a free-text topic ("anger", "rain", "entering home")
// and get the right chapter without knowing slugs.
const DUA_STOP = new Set(['the', 'a', 'an', 'of', 'for', 'to', 'in', 'on', 'and', 'or', 'if',
  'you', 'your', 'what', 'say', 'do', 'how', 'when', 'upon', 'invocation', 'invocations',
  'supplication', 'supplications', 'dua', 'duas', 'recited', 'recite', 'be', 'some', 'who', 'his']);

function duaTokens(s) {
  return (s || '').toString().toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(t => t && !DUA_STOP.has(t));
}

const DUA_INDEX = Object.entries(HISN.categories).map(([slug, cat]) => ({
  slug,
  tokens: new Set([...duaTokens(slug.replace(/-/g, ' ')), ...duaTokens(cat.title)]),
}));

// Resolve a slug, alias, or free-text topic to a chapter slug (or null).
function resolveCategory(input) {
  const raw = (input || '').toString().trim().toLowerCase();
  if (!raw) return null;
  const slug = raw.replace(/\s+/g, '-');
  if (HISN.categories[slug]) return slug;          // exact slug
  if (DUA_ALIASES[slug]) return DUA_ALIASES[slug];  // pinned alias
  if (DUA_ALIASES[raw]) return DUA_ALIASES[raw];

  const q = duaTokens(raw);
  if (!q.length) return null;
  let best = null, bestScore = 0;
  for (const e of DUA_INDEX) {
    let score = 0;
    for (const t of q) {
      if (e.tokens.has(t)) { score += 2; continue; }       // exact token
      for (const et of e.tokens) {                           // partial (stem) match
        if (et.length > 2 && (et.includes(t) || t.includes(et))) { score += 1; break; }
      }
    }
    if (score > bestScore) { bestScore = score; best = e.slug; }
  }
  return bestScore >= 2 ? best : null;   // require at least one solid match
}

// Back-compat name.
const normalizeCategory = resolveCategory;

/**
 * Return adhkar for a topic, formatted verbatim for messaging. The block is
 * built from the bundled Hisn al-Muslim file within a character budget — no
 * network. Accepts either a free-text `query` ("anger", "rain", "entering the
 * home") or an explicit slug/alias via `category`; `query` wins when both given.
 * @param {object} opts
 * @param {string} [opts.query]    free-text topic/situation
 * @param {string} [opts.category] slug or natural alias (back-compat)
 * @param {'arabic'|'english'|'both'} [opts.language='both']
 * @returns {Promise<{ block:string, meta:object }>}
 */
async function getDua({ query, category, language = 'both' } = {}) {
  const input = query || category;
  const slug = resolveCategory(input);
  const cat  = slug ? HISN.categories[slug] : null;
  if (!cat) {
    return { block: '', meta: { error: 'Unknown dua category', query: input, available: DUA_CATEGORIES.slice(0, 40) } };
  }

  const entries = Array.isArray(cat.entries) ? cat.entries : [];
  const blocks = [];
  let used = 0;
  let shown = 0;

  for (const e of entries) {
    const piece = formatDuaEntry(e, language);
    if (!piece) continue;
    const cost = piece.length + (shown > 0 ? DUA_SEP_LEN : 0);
    if (shown > 0 && used + cost > DUA_MAX_CHARS) break;
    blocks.push(piece);
    used += cost;
    shown += 1;
  }

  const remaining = entries.length - shown;
  return {
    block: formatDua({ title: cat.title, blocks, remaining, language }),
    meta:  { category: slug, title: cat.title, count: shown, total: entries.length, language },
  };
}

function formatDuaEntry(entry, language) {
  const lines = [];
  if (language !== 'english' && entry.arabic)  lines.push(sanitizeMd(entry.arabic));
  if (language !== 'arabic'  && entry.english) lines.push('_' + sanitizeMd(entry.english) + '_');
  if (!lines.length) return '';
  if (entry.repeat && entry.repeat > 1) lines.push('🔁 ×' + entry.repeat);
  return lines.join('\n');
}

function formatDua({ title, blocks, remaining }) {
  const header = '*' + sanitizeMd(title) + '*';
  const out = ['🤲 ' + header, ''];
  out.push(blocks.join('\n\n— — —\n\n'));
  if (remaining > 0) {
    out.push('', `_(+${remaining} more in this set)_`);
  }
  out.push('', '_Hisn al-Muslim_');
  return out.join('\n');
}

// ── Tafsir (Quran commentary, quran.com via mcp.quran.ai) ─────────────────────

/**
 * Fetch the tafsir (commentary) for a single ayah, formatted for messaging.
 * Concise editions by language: Tazkirul Quran (English) / al-Jalalayn (Arabic).
 * The block is the scholarly text — Claude relays it verbatim.
 * @param {object} opts
 * @param {number} opts.surah  1–114
 * @param {number} opts.ayah   ayah number within the surah
 * @param {'arabic'|'english'|'both'} [opts.language='both']
 * @param {Function} [opts.fetchImpl]
 * @returns {Promise<{ block:string, meta:object }>}
 */
async function getTafsir({ surah, ayah, language = 'both', fetchImpl } = {}) {
  const f = fetchImpl || defaultFetch();
  const s = parseInt(surah, 10);
  const a = parseInt(ayah, 10);
  if (!(s >= 1 && s <= 114) || !(a >= 1)) {
    return { block: '', meta: { error: 'Invalid surah/ayah reference' } };
  }
  const key = `${s}:${a}`;
  // Tazkirul (concise English) is selective and skips many ayahs, so fall back to
  // the complete Ibn Kathir (capped) when it has no entry. Arabic uses al-Jalalayn,
  // which is complete on its own.
  const chain = language === 'arabic' ? [TAFSIR_AR] : [TAFSIR_EN, TAFSIR_EN_FULL];
  try {
    const sid = await mcpInit(f, QURAN_MCP);
    await mcpGround(f, QURAN_MCP, sid);
    for (const edition of chain) {
      let text = '';
      try {
        const tr = await mcpCall(f, QURAN_MCP, sid, 'fetch_tafsir', { ayahs: [key], editions: [edition] });
        // Preserve the source's heading/paragraph structure instead of flattening it.
        text = htmlToTelegram(((((tr && tr.results) || {})[edition] || [])[0] || {}).text);
      } catch (_) { /* not_found for this edition → try the next */ }
      if (text) {
        if (edition === TAFSIR_EN_FULL && text.length > TAFSIR_CAP) {
          text = text.slice(0, TAFSIR_CAP - 1).trimEnd();
          // A cap can land inside a *bold heading* — drop the dangling opener so
          // the asterisks stay balanced, then mark the truncation.
          if ((text.match(/\*/g) || []).length % 2) text = text.replace(/\*[^*]*$/, '').trimEnd();
          text += '…';
        }
        return {
          block: formatTafsir({ text, surahNum: s, ayahNum: a, edition }),
          meta:  { surahNum: s, ayahNum: a, edition, source: 'quran.com' },
        };
      }
    }
    return { block: '', meta: { error: 'No tafsir for this ayah', ref: key } };
  } catch (e) {
    return { block: '', meta: { error: 'Could not fetch tafsir: ' + e.message } };
  }
}

function formatTafsir({ text, surahNum, ayahNum, edition }) {
  const name = edition === TAFSIR_AR ? 'تفسير الجلالين'
    : edition === TAFSIR_EN_FULL ? 'Tafsir Ibn Kathir'
    : 'Tazkirul Quran';
  // `text` is already cleaned + structured by htmlToTelegram (and carries our own
  // *bold headings*), so it must NOT be re-sanitized here.
  return ['📖 *' + name + ` — ${surahNum}:${ayahNum}*`, '', text, '', '_quran.com_'].join('\n');
}

// ── Fatwa (IslamQA.info via islamqa-mcp.org, no key) ──────────────────────────
// This source is an MCP server (JSON-RPC over Streamable HTTP + SSE), not REST.
// We speak the protocol directly so it drops into the same tool pattern: one
// handshake per call, then search_answers / fetch_answer. ~32k answers, English-
// primary (Arabic often absent). Content is relayed verbatim with its proof URL.

// Everyday fiqh topics used to pull a *random* fatwa (the corpus has no random
// endpoint — we search a random topic and pick from the results).
const ISLAMQA_TOPICS = [
  'prayer', 'fasting', 'zakat', 'wudu', 'purification', 'hajj', 'umrah',
  'marriage', 'charity', 'repentance', 'ramadan', 'janabah', 'salah',
  'supplication', 'fasting voluntary', 'sadaqah', 'tahajjud', 'modesty',
];
/**
 * Fetch a fatwa from IslamQA, formatted for messaging.
 *   - `query` set → search and relay the best-matching answer (interactive Q&A).
 *   - `id` set    → fetch that specific answer.
 *   - neither     → a random fatwa via a random everyday topic ("fatwa of the day").
 * The block is the stored answer relayed verbatim with its islamqa.info proof URL.
 * IslamQA stores most answers in BOTH Arabic and English; we pick the side that
 * matches the language setting (Arabic preferred for 'both', since duplicating a
 * multi-thousand-char ruling in two languages is impractical), falling back to
 * whichever exists.
 * @param {object} opts
 * @param {number} [opts.id]      specific IslamQA answer id
 * @param {string} [opts.query]   a fiqh question to search for
 * @param {'arabic'|'english'|'both'} [opts.language='both']
 * @param {Function} [opts.fetchImpl]
 * @param {Function} [opts.rng]
 * @returns {Promise<{ block:string, meta:object }>}
 */
async function getFatwa({ id, query, language = 'both', fetchImpl, rng } = {}) {
  const f = fetchImpl || defaultFetch();
  const r = rng || Math.random;
  const q = (query == null ? '' : String(query)).trim();
  try {
    const sid = await mcpInit(f, ISLAMQA_MCP);

    let answerId = parseInt(id, 10);
    if (!(answerId > 0)) {
      // Explicit question → best match; otherwise a random topic → a random hit.
      const term = q || ISLAMQA_TOPICS[Math.floor(r() * ISLAMQA_TOPICS.length)];
      const sr = await mcpCall(f, ISLAMQA_MCP, sid, 'search_answers', { query: term, mode: 'semantic' });
      const rows = (sr && sr.results) || [];
      if (!rows.length) return { block: '', meta: { error: 'No fatwa found for: ' + term } };
      const row = q ? rows[0] : rows[Math.floor(r() * Math.min(rows.length, 10))];
      answerId = parseInt(row.answer_id, 10);
    }
    if (!(answerId > 0)) return { block: '', meta: { error: 'Could not find a fatwa' } };

    const fr = await mcpCall(f, ISLAMQA_MCP, sid, 'fetch_answer', { answer_id: answerId }, 3);
    const a = fr && fr.answer;
    if (!a || (!a.answer_en && !a.answer_ar)) {
      return { block: '', meta: { error: 'Fatwa has no answer', id: answerId } };
    }
    // Pick the language side: Arabic for arabic/both (when present), else English.
    const ar = (language !== 'english') ? !!a.answer_ar : !a.answer_en;
    const pick = (arV, enV) => ((ar ? (arV || enV) : (enV || arV)) || '').trim();
    return {
      block: formatFatwa({
        title:    pick(a.title_ar, a.title_en),
        question: pick(a.question_ar, a.question_en),
        answer:   pick(a.answer_ar, a.answer_en),
        source:   (ar ? (a.source_url_ar || a.url_ar) : (a.source_url_en || a.url_en))
                  || a.source_url_en || a.url_en || a.url || '',
        arabic:   ar,
      }),
      meta: {
        id: a.id, source: 'IslamQA.info', language: ar ? 'arabic' : 'english',
        url: (ar ? (a.source_url_ar || a.url_ar) : (a.source_url_en || a.url_en)) || a.url || null,
        categories: (a.categories || []).map(c => (ar ? c.name_ar : c.name_en) || c.name_en).filter(Boolean),
      },
    };
  } catch (e) {
    return { block: '', meta: { error: 'Could not fetch fatwa: ' + e.message } };
  }
}

function formatFatwa({ title, question, answer, source, arabic }) {
  // External IslamQA text can carry stray Markdown control chars that unbalance
  // Telegram's parser; strip them so only our own balanced labels remain.
  title = sanitizeMd(title).trim(); question = sanitizeMd(question).trim(); answer = sanitizeMd(answer).trim();
  const L = arabic
    ? { head: '⚖️ *فتوى*', q: '*السؤال:*', a: '*الجواب:*' }
    : { head: '⚖️ *Fatwa*', q: '*Question:*', a: '*Answer:*' };
  const out = [L.head];
  if (title)    out.push('', '*' + title + '*');
  if (question) out.push('', L.q + ' ' + question);
  out.push('', L.a + ' ' + answer);
  const cite = ['IslamQA.info', source].filter(Boolean).join(' · ');
  out.push('', '_' + cite + '_');
  return out.join('\n');
}

// ── Hadith with explanation (HadeethEnc / IslamHouse, no key) ─────────────────

// HadeethEnc serves per-language data; map the app's setting to an ISO code.
// 'both' uses English — its explanation + benefit points are most useful to a
// mixed household, consistent with the English tafsir edition.
function hadeethEncLang(language) {
  return language === 'arabic' ? 'ar' : 'en';
}

/**
 * Fetch an authenticated hadith WITH its grade, scholarly explanation (sharh),
 * and benefit points (fawaed) from HadeethEnc.com. With no `id`, picks a random
 * one via a random category's paged list (no random endpoint exists upstream).
 *
 * Terms (HadeethEnc): content must be relayed unmodified and credited to the
 * source — the block carries the grade, explanation, and "HadeethEnc.com".
 * @param {object} opts
 * @param {number} [opts.id]        specific hadith id; omit for random
 * @param {'arabic'|'english'|'both'} [opts.language='both']
 * @param {Function} [opts.fetchImpl]
 * @param {Function} [opts.rng]
 * @returns {Promise<{ block:string, meta:object }>}
 */
async function getHadithExplained({ id, language = 'both', fetchImpl, rng } = {}) {
  const f = fetchImpl || defaultFetch();
  const r = rng || Math.random;
  const lang = hadeethEncLang(language);
  try {
    let hid = parseInt(id, 10);
    if (!(hid > 0)) {
      // Discover a random hadith: pick a category weighted by its size, then a
      // random page within it, then a random item. 3 attempts for resilience.
      const cats = await fetchJson(f, `${HADEETHENC_BASE}/categories/list/?language=${lang}`);
      const list = (Array.isArray(cats) ? cats : []).filter(c => parseInt(c.hadeeths_count, 10) > 0);
      const total = list.reduce((s, c) => s + parseInt(c.hadeeths_count, 10), 0);
      for (let attempt = 0; attempt < 3 && !(hid > 0) && total > 0; attempt++) {
        let pick = Math.floor(r() * total);
        const cat = list.find(c => (pick -= parseInt(c.hadeeths_count, 10)) < 0) || list[0];
        const count = parseInt(cat.hadeeths_count, 10);
        const perPage = 20;
        const page = Math.floor(r() * Math.ceil(count / perPage)) + 1;
        const res = await fetchJson(f,
          `${HADEETHENC_BASE}/hadeeths/list/?language=${lang}&category_id=${cat.id}&page=${page}&per_page=${perPage}`);
        const items = (res && res.data) || [];
        if (items.length) {
          const item = items[Math.floor(r() * items.length)];
          if (item && item.id) hid = parseInt(item.id, 10);
        }
      }
    }
    if (!(hid > 0)) return { block: '', meta: { error: 'Could not find a hadith' } };

    const d = await fetchJson(f, `${HADEETHENC_BASE}/hadeeths/one/?language=${lang}&id=${hid}`);
    const text = (d.hadeeth || d.hadith_text || '').trim();
    if (!text) return { block: '', meta: { error: 'Hadith has no text', id: hid } };
    const hints = Array.isArray(d.hints) ? d.hints.map(h => String(h).trim()).filter(Boolean) : [];

    return {
      block: formatHadithExplained({
        title:       (d.title || '').trim(),
        text,
        attribution: (d.attribution || '').trim(),
        grade:       (d.grade || '').trim(),
        explanation: (d.explanation || '').trim(),
        hints,
        lang,
      }),
      meta: { id: hid, grade: (d.grade || '').trim(), language, source: 'HadeethEnc.com' },
    };
  } catch (e) {
    return { block: '', meta: { error: 'Could not fetch hadith: ' + e.message } };
  }
}

function formatHadithExplained({ title, text, attribution, grade, explanation, hints, lang }) {
  title = sanitizeMd(title); text = sanitizeMd(text); attribution = sanitizeMd(attribution);
  grade = sanitizeMd(grade); explanation = sanitizeMd(explanation);
  hints = (hints || []).map(sanitizeMd);
  const ar = lang === 'ar';
  const L = ar
    ? { hadith: '*حديث*', grade: '*الدرجة:*', sharh: '*الشرح:*', hints: '*الفوائد:*' }
    : { hadith: '*Hadith*', grade: '*Grade:*', sharh: '*Explanation:*', hints: '*Benefits:*' };
  const out = ['📖 ' + L.hadith];
  if (title)       out.push('', '*' + title + '*');
  out.push('', text);
  if (attribution) out.push('', '_' + attribution + '_');
  if (grade)       out.push('', L.grade + ' ' + grade);
  if (explanation) out.push('', L.sharh, explanation);
  if (hints.length) out.push('', L.hints, ...hints.map(h => '• ' + h));
  out.push('', '_HadeethEnc.com_');
  return out.join('\n');
}

module.exports = {
  getHadith, getQuran, getDua, getTafsir, getFatwa, getHadithExplained,
  DUA_CATEGORIES,
  formatHadith, formatQuran, formatDua, formatTafsir, formatFatwa, formatHadithExplained,
  normalizeCategory, resolveCategory, sanitizeMd, htmlToTelegram,
};

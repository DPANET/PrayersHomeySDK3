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

// Known, authoritative hadith books. A topical search returns matches from ~17
// collections including minor compilations (e.g. shahwaliullah40) whose terse
// paraphrases out-score the canonical narrations on short queries. We keep only
// these books and pick the highest-similarity match among them, so a query like
// "إنما الأعمال بالنيات" relays an authenticated narration (Bukhari/Muslim/the
// Sunan) instead of a stub. Order is documentary only — selection is by score.
const HADITH_ALLOWED_COLLECTIONS = new Set([
  'bukhari', 'muslim',                          // Sahihayn
  'abudawud', 'tirmidhi', 'nasai', 'ibnmajah',  // rest of the Six Books
  'malik', 'ahmed', 'darimi',                   // classical primary collections
]);
const QURAN_MCP   = 'https://mcp.quran.ai/';
const ISLAMQA_MCP = 'https://islamqa-mcp.org/';
const HADEETHENC_BASE = 'https://hadeethenc.com/api/v1';

// quran.ai editions (quran.com data). Concise picks that fit a Telegram message.
const QURAN_AR_EDITION          = 'ar-simple-clean';        // Arabic mushaf text
const QURAN_TRANSLATION_EDITION = 'en-sahih-international';  // English translation
// Tafsir editions (quran.com data via mcp.quran.ai). Each language fetches down a
// chain: a concise primary, then fuller editions only when the primary has no
// entry for that ayah (Tazkirul and, to a lesser extent, al-Saadi are selective).
//   English: Tazkirul (concise, reflective) → Ma'arif al-Qur'an (comprehensive,
//            practical) → Ibn Kathir (complete, hadith-based).
//   Arabic:  al-Saadi (practical fawa'id, accessible) → al-Jalalayn (ultra-concise,
//            complete — the gap-filler).
const TAFSIR_EN_CHAIN = ['en-tazkirul-quran', 'en-maarif-ul-quran', 'en-ibn-kathir'];
const TAFSIR_AR_CHAIN = ['ar-saadi', 'ar-jalalayn'];
// Human-readable names for the citation line, keyed by edition id.
const TAFSIR_NAMES = {
  'en-tazkirul-quran': 'Tazkirul Quran',
  'en-maarif-ul-quran': "Ma'arif al-Qur'an",
  'en-ibn-kathir': 'Tafsir Ibn Kathir',
  'ar-saadi': 'تفسير السعدي',
  'ar-jalalayn': 'تفسير الجلالين',
};
const TAFSIR_CAP = 1800; // char cap so a long edition (Ma'arif/Ibn Kathir) stays Telegram-friendly

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

// Arabic surah names, index 0 = Al-Fatihah. Used to (a) resolve an Arabic-typed
// surah name and (b) render the bilingual header in the surah-link block.
const SURAH_AR_NAMES = [
  'الفاتحة', 'البقرة', 'آل عمران', 'النساء', 'المائدة', 'الأنعام', 'الأعراف', 'الأنفال',
  'التوبة', 'يونس', 'هود', 'يوسف', 'الرعد', 'إبراهيم', 'الحجر', 'النحل', 'الإسراء', 'الكهف',
  'مريم', 'طه', 'الأنبياء', 'الحج', 'المؤمنون', 'النور', 'الفرقان', 'الشعراء', 'النمل',
  'القصص', 'العنكبوت', 'الروم', 'لقمان', 'السجدة', 'الأحزاب', 'سبأ', 'فاطر', 'يس', 'الصافات',
  'ص', 'الزمر', 'غافر', 'فصلت', 'الشورى', 'الزخرف', 'الدخان', 'الجاثية', 'الأحقاف', 'محمد',
  'الفتح', 'الحجرات', 'ق', 'الذاريات', 'الطور', 'النجم', 'القمر', 'الرحمن', 'الواقعة',
  'الحديد', 'المجادلة', 'الحشر', 'الممتحنة', 'الصف', 'الجمعة', 'المنافقون', 'التغابن',
  'الطلاق', 'التحريم', 'الملك', 'القلم', 'الحاقة', 'المعارج', 'نوح', 'الجن', 'المزمل',
  'المدثر', 'القيامة', 'الإنسان', 'المرسلات', 'النبأ', 'النازعات', 'عبس', 'التكوير',
  'الانفطار', 'المطففين', 'الانشقاق', 'البروج', 'الطارق', 'الأعلى', 'الغاشية', 'الفجر',
  'البلد', 'الشمس', 'الليل', 'الضحى', 'الشرح', 'التين', 'العلق', 'القدر', 'البينة', 'الزلزلة',
  'العاديات', 'القارعة', 'التكاثر', 'العصر', 'الهمزة', 'الفيل', 'قريش', 'الماعون', 'الكوثر',
  'الكافرون', 'النصر', 'المسد', 'الإخلاص', 'الفلق', 'الناس',
];

// Ayah count per surah (Hafs/standard mushaf), index 0 = Al-Fatihah.
const SURAH_AYAH_COUNTS = [
  7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135,
  112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85, 54, 53,
  89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12,
  12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19, 26,
  30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6,
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

// Detect the script of a free-text string. Used to (a) serve the matching side of
// a one-sided bilingual source (e.g. an Arabic-only fatwa) and (b) resolve Arabic
// dua topics against the English keyword index. Returns 'arabic' when any Arabic
// letter is present, else 'english'. (Display language stays governed by the user
// setting; this only concerns retrieval/side-selection for a specific query.)
function detectLang(text) {
  return /[؀-ۿ]/.test(text || '') ? 'arabic' : 'english';
}
function isArabicText(s) { return detectLang(s) === 'arabic'; }

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
    let best = null;   // the chosen search row (carries similarity + collection_slug)

    if (parseInt(id, 10) > 0) {
      rec = await fetchOne(sid, parseInt(id, 10));
    } else if (q) {
      // Topical search: keep only the known authoritative books, then take the
      // highest-similarity match among them. limit:10 gives the filter headroom
      // since the unfiltered top hits are often minor compilations.
      const sr = await mcpCall(f, HADITH_MCP, sid, 'search_hadith', { query: q, mode: 'semantic', limit: 10 });
      const rows = (sr && sr.results) || [];
      const allowed = rows
        .filter(r => r && HADITH_ALLOWED_COLLECTIONS.has(r.collection_slug) && typeof r.similarity === 'number')
        .sort((a, b) => b.similarity - a.similarity);
      if (!allowed.length) {
        return { block: '', meta: { error: 'No authenticated narration found for: ' + q, noMatch: true } };
      }
      best = allowed[0];
      rec = await fetchOne(sid, parseInt(best.hadith_id, 10));
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
        ...(best ? { similarity: best.similarity, collectionSlug: best.collection_slug } : {}),
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
 *   - `surah` + `ayah` → that exact verse.
 *   - `query`          → semantic search; picks the highest-`relevance_score` ayah
 *                        and (unless `tafsir:false`) appends that ayah's tafsir to
 *                        the same block so a topical search arrives verse+commentary.
 * Arabic text (fetch_quran) and the Sahih International translation
 * (fetch_translation) are pulled per the language setting.
 * @param {object} opts
 * @param {number} [opts.surah] 1–114
 * @param {number} [opts.ayah]
 * @param {string} [opts.query] topic to search for instead of a fixed reference
 * @param {'arabic'|'english'|'both'} [opts.language='both']
 * @param {boolean} [opts.tafsir] force the bundled tafsir on/off; default ON for a
 *                                topical search, OFF for a direct surah:ayah ref
 * @param {Function} [opts.fetchImpl]
 * @returns {Promise<{ block:string, meta:object }>}
 */
async function getQuran({ surah, ayah, query, language = 'both', tafsir, fetchImpl } = {}) {
  const f = fetchImpl || defaultFetch();
  const q = (query == null ? '' : String(query)).trim();
  let s = parseInt(surah, 10);
  let a = parseInt(ayah, 10);
  try {
    const sid = await mcpInit(f, QURAN_MCP);
    await mcpGround(f, QURAN_MCP, sid);

    let key = (s >= 1 && s <= 114 && a >= 1) ? `${s}:${a}` : null;
    let viaSearch = false;       // resolved from a topical query (not a fixed ref)
    let relevance = null;        // top relevance_score of the chosen ayah
    if (!key && q) {
      const sr = await mcpCall(f, QURAN_MCP, sid, 'search_quran', { query: q, translations: [QURAN_TRANSLATION_EDITION] });
      // Rows arrive scored by relevance_score; sort defensively and take the best.
      const top = ((sr && sr.results) || [])
        .filter(r => r && r.ayah_key)
        .sort((x, y) => (y.relevance_score || 0) - (x.relevance_score || 0))[0];
      if (top) { key = top.ayah_key; s = top.surah; a = top.ayah; relevance = top.relevance_score ?? null; viaSearch = true; }
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
    let block = formatQuran({ arabic, english, surahName, surahNum: s, ayahNum: a, language });
    const meta = { surahName, surahNum: s, ayahNum: a, language, source: 'quran.com' };
    if (relevance != null) meta.relevanceScore = relevance;

    // Bundle the verse's tafsir into the SAME block when this came from a topical
    // search (so "find me a verse about patience" returns verse + commentary in one
    // relayed message). Explicit `tafsir` overrides; a direct ref defaults to OFF.
    const wantTafsir = (tafsir === true) || (tafsir == null && viaSearch);
    if (wantTafsir) {
      try {
        const tf = await getTafsir({ surah: s, ayah: a, language, fetchImpl: f });
        if (tf && tf.block) {
          block += '\n\n— — —\n\n' + tf.block;
          meta.tafsir = true;
          if (tf.meta && tf.meta.edition) meta.tafsirEdition = tf.meta.edition;
        }
      } catch (_) { /* tafsir is best-effort — keep the verse on any failure */ }
    }

    return { block, meta };
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

// Normalise a Latin surah name for fuzzy matching: lowercase, drop the leading
// "al-"/"ad-"/etc. assimilated article, and strip hyphens, spaces, apostrophes
// and accents so "Al-Ma'idah", "almaidah" and "maidah" all collapse together.
function normSurahName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[''`]/g, '')
    .replace(/^(al|ad|an|ar|as|at|az|ash)-/, '')
    .replace(/[^a-z]/g, '');
}

// Surahs with this many verses or fewer are fetched in full from the API.
// Everything longer gets a quran.com link instead.
const SURAH_FULL_TEXT_MAX = 10;
const QURAN_API_BASE      = 'https://api.quran.com/api/v4';
const QURAN_EN_TRANSLATION = 20; // Saheeh International

// Strip HTML tags and entities from quran.com API translation text (some
// editions embed <sup foot_note=...> footnote markers in the prose).
function stripTranslationHtml(s) {
  return String(s || '')
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ').replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ').trim();
}

/**
 * Resolve a surah by number or name (Latin or Arabic). For short surahs
 * (≤ SURAH_FULL_TEXT_MAX verses) fetches the complete text from quran.com's
 * public API and returns it as a formatted block. For longer surahs returns a
 * quran.com link. Falls back to the link on any API error.
 * @param {object} opts
 * @param {number} [opts.surah] 1–114
 * @param {string} [opts.query] surah name or number as a string
 * @param {'arabic'|'english'|'both'} [opts.language='both']
 * @param {Function} [opts.fetchImpl]
 * @returns {Promise<{ block:string, meta:object }>}
 */
// Reciter ID 7 = Mishari Rashid al-Afasy (most widely recognised voice).
const QURAN_RECITER_ID = 7;

async function getSurahLink({ surah, query, language = 'both', fetchImpl } = {}) {
  const f = fetchImpl || defaultFetch();

  // ── 1. Resolve surah number ───────────────────────────────────────────────
  let n = parseInt(surah, 10);
  if (!(n >= 1 && n <= 114)) {
    const raw = (query == null ? '' : String(query)).trim();
    const asNum = parseInt(raw, 10);
    if (asNum >= 1 && asNum <= 114 && /^\s*\d+\s*$/.test(raw)) {
      n = asNum;
    } else if (raw) {
      let idx = SURAH_AR_NAMES.indexOf(raw);
      if (idx < 0) idx = SURAH_AR_NAMES.findIndex(name => raw.includes(name) || name.includes(raw));
      if (idx < 0) {
        const want = normSurahName(raw);
        if (want) {
          idx = SURAH_NAMES.findIndex(name => normSurahName(name) === want);
          if (idx < 0) idx = SURAH_NAMES.findIndex(name => normSurahName(name).startsWith(want) || want.startsWith(normSurahName(name)));
        }
      }
      if (idx >= 0) n = idx + 1;
    }
  }
  if (!(n >= 1 && n <= 114)) {
    return { block: '', meta: { error: 'Could not identify the surah. Pass a surah number 1–114 or its name.' } };
  }

  const enName = SURAH_NAMES[n - 1];
  const arName = SURAH_AR_NAMES[n - 1];
  const ayat   = SURAH_AYAH_COUNTS[n - 1];
  const url    = `https://quran.com/${n}`;
  const baseMeta = { surahNum: n, surahName: enName, surahNameAr: arName, ayahCount: ayat, source: 'quran.com' };

  // ── 2. Fetch enrichment data: chapter meta + audio (always) ──────────────
  // Chapter info (short_text) only for long surahs — for short ones the full
  // verse text already provides enough context.
  let translatedName = null, revelationPlace = null, revelationOrder = null;
  let audioUrl = null, shortText = null;

  try {
    const fetches = [
      fetchJson(f, `${QURAN_API_BASE}/chapters/${n}`),
      fetchJson(f, `${QURAN_API_BASE}/chapter_recitations/${QURAN_RECITER_ID}/${n}`),
    ];
    if (ayat > SURAH_FULL_TEXT_MAX) {
      fetches.push(fetchJson(f, `${QURAN_API_BASE}/chapters/${n}/info?language=en`));
    }
    const results = await Promise.all(fetches);
    const chap    = results[0] && results[0].chapter;
    const recit   = results[1] && results[1].audio_file;
    const info    = results[2] && results[2].chapter_info;

    if (chap) {
      translatedName  = chap.translated_name && chap.translated_name.name  ? chap.translated_name.name : null;
      revelationPlace = chap.revelation_place || null;
      revelationOrder = chap.revelation_order || null;
    }
    if (recit && recit.audio_url) audioUrl = recit.audio_url;
    if (info  && info.short_text)  shortText = stripTranslationHtml(info.short_text);
  } catch (_) { /* enrichment is best-effort — continue without it */ }

  // ── 3. Short surah → fetch full verse text ────────────────────────────────
  if (ayat <= SURAH_FULL_TEXT_MAX) {
    try {
      const [arData, trData] = await Promise.all([
        language !== 'english'
          ? fetchJson(f, `${QURAN_API_BASE}/quran/verses/uthmani?chapter_number=${n}`)
          : null,
        language !== 'arabic'
          ? fetchJson(f, `${QURAN_API_BASE}/quran/translations/${QURAN_EN_TRANSLATION}?chapter_number=${n}`)
          : null,
      ]);
      const arVerses = (arData && arData.verses) || [];
      const trList   = (trData && trData.translations) || [];
      const count    = Math.max(arVerses.length, trList.length);
      if (count > 0) {
        const verses = Array.from({ length: count }, (_, i) => ({
          verse_key:    (arVerses[i] && arVerses[i].verse_key) || `${n}:${i + 1}`,
          text_uthmani: arVerses[i] ? arVerses[i].text_uthmani : null,
          translation:  trList[i]   ? trList[i].text           : null,
        }));
        const block = formatSurahFull({
          n, enName, arName, ayat, verses, url, language,
          translatedName, revelationPlace, revelationOrder, audioUrl,
        });
        return { block, meta: { ...baseMeta, full: true, audioUrl } };
      }
    } catch (_) { /* fall through to link */ }
  }

  // ── 4. Long surah or verse-fetch failure → enriched link ─────────────────
  const block = formatSurahLink({
    n, enName, arName, ayat, url, language,
    translatedName, revelationPlace, revelationOrder, audioUrl, shortText,
  });
  return { block, meta: { ...baseMeta, url, audioUrl } };
}

function _revelationBadge(place, order, language) {
  if (!place && !order) return null;
  const ar = language === 'arabic';
  const placeStr = place
    ? (ar ? (place === 'makkah' ? 'مكية' : 'مدنية') : (place === 'makkah' ? 'Makkan' : 'Medinan'))
    : null;
  const mod100 = order % 100;
  const mod10  = order % 10;
  const suffix = (mod100 >= 11 && mod100 <= 13) ? 'th'
    : mod10 === 1 ? 'st' : mod10 === 2 ? 'nd' : mod10 === 3 ? 'rd' : 'th';
  const orderStr = order ? (ar ? 'الترتيب النزولي ' + order : 'Revealed ' + order + suffix) : null;
  return [placeStr, orderStr].filter(Boolean).join(' · ');
}

function formatSurahFull({ n, enName, arName, ayat, verses, url, language,
    translatedName, revelationPlace, revelationOrder, audioUrl }) {
  const en = sanitizeMd(enName);
  const ar = sanitizeMd(arName);
  const tr = translatedName ? sanitizeMd(translatedName) : null;
  const parts = [];
  const isAr  = language === 'arabic';
  const isEn  = language === 'english';

  // ── Header ────────────────────────────────────────────────────────────────
  if (isAr) {
    parts.push('☪️ *سورة ' + ar + '*');
    if (tr) parts.push('_' + tr + '_');
  } else if (isEn) {
    parts.push('☪️ *Surah ' + en + (tr ? ' — ' + tr : '') + '* (' + n + ')');
  } else {
    parts.push('☪️ *سورة ' + ar + ' · ' + en + (tr ? ' — ' + tr : '') + '* (' + n + ')');
  }

  // Revelation badge + verse count on one tidy metadata line
  const badge = _revelationBadge(revelationPlace, revelationOrder, language);
  const countStr = isAr ? ayat + ' آيات' : ayat + ' verses';
  parts.push('_' + [badge, countStr].filter(Boolean).join(' · ') + '_');
  parts.push('');

  // ── Verses ────────────────────────────────────────────────────────────────
  for (const v of verses) {
    const verseAr = v.text_uthmani ? sanitizeMd(cleanWs(v.text_uthmani)) : null;
    const verseEn = v.translation  ? sanitizeMd(stripTranslationHtml(v.translation)) : null;
    const key     = v.verse_key || `${n}:?`;

    if (!isEn && verseAr) parts.push(verseAr);
    if (!isAr && verseEn) parts.push('"' + verseEn + '"');
    parts.push('_' + key + '_');
    parts.push('');
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  while (parts.length && parts[parts.length - 1] === '') parts.pop();
  parts.push('');
  parts.push(isAr ? '🔗 اقرأ على quran.com/' + n : '🔗 quran.com/' + n);
  if (audioUrl) parts.push(isAr ? '🎧 استمع: ' + audioUrl : '🎧 Listen: ' + audioUrl);
  return parts.join('\n');
}

function formatSurahLink({ n, enName, arName, ayat, url, language,
    translatedName, revelationPlace, revelationOrder, audioUrl, shortText }) {
  const en = sanitizeMd(enName);
  const ar = sanitizeMd(arName);
  const tr = translatedName ? sanitizeMd(translatedName) : null;
  const isAr = language === 'arabic';
  const isEn = language === 'english';
  const out  = [];

  // ── Header ────────────────────────────────────────────────────────────────
  if (isAr) {
    out.push('☪️ *سورة ' + ar + '*');
    if (tr) out.push('_' + tr + '_');
  } else if (isEn) {
    out.push('☪️ *Surah ' + en + (tr ? ' — ' + tr : '') + '* (' + n + ')');
  } else {
    out.push('☪️ *سورة ' + ar + ' · ' + en + (tr ? ' — ' + tr : '') + '* (' + n + ')');
  }

  // Revelation badge + verse count
  const badge = _revelationBadge(revelationPlace, revelationOrder, language);
  const countStr = isAr ? ayat + ' آية' : ayat + ' verses';
  out.push('_' + [badge, countStr].filter(Boolean).join(' · ') + '_');

  // ── Short intro ───────────────────────────────────────────────────────────
  if (shortText) {
    // Cap to ~300 chars so it's a teaser, not a wall of text
    const preview = shortText.length > 300 ? shortText.slice(0, 297) + '…' : shortText;
    out.push('');
    out.push(sanitizeMd(preview));
  }

  // ── Links ────────────────────────────────────────────────────────────────
  out.push('');
  out.push(isAr ? '📖 اقرأ السورة كاملة:' : '📖 Read the full surah:');
  out.push(url);
  if (audioUrl) {
    out.push('');
    out.push(isAr ? '🎧 استمع (مشاري راشد العفاسي):' : '🎧 Listen (Mishari al-Afasy):');
    out.push(audioUrl);
  }
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

// Arabic safety-net aliases. The dua index/titles are English-only, so an Arabic
// topic ("غضب") tokenizes to nothing and never matches. Claude is instructed to
// pass an English keyword for get_dua, but this map catches the common cases when
// an Arabic word slips through, mapping it onto the same slugs. Matched by exact
// word and by substring (so "دعاء الغضب" still resolves via "غضب").
const DUA_ALIASES_AR = {
  'غضب': 'anger',
  'نوم': 'before-sleep', 'النوم': 'before-sleep',
  'استيقاظ': 'waking', 'الاستيقاظ': 'waking',
  'سفر': 'travel', 'السفر': 'travel', 'مسافر': 'travel',
  'هم': 'distress', 'الهم': 'distress', 'حزن': 'distress', 'الحزن': 'distress',
  'كرب': 'distress', 'قلق': 'distress', 'القلق': 'distress', 'ضيق': 'distress', 'غم': 'distress',
  'مطر': 'rain', 'المطر': 'rain',
  'ريح': 'wind-blows', 'رياح': 'wind-blows', 'الريح': 'wind-blows',
  'صباح': 'morning-evening', 'الصباح': 'morning-evening', 'مساء': 'morning-evening',
  'المساء': 'morning-evening', 'أذكار': 'morning-evening', 'الأذكار': 'morning-evening', 'اذكار': 'morning-evening',
  'استغفار': 'repentance-seeking-forgiveness', 'الاستغفار': 'repentance-seeking-forgiveness',
  'توبة': 'repentance-seeking-forgiveness', 'التوبة': 'repentance-seeking-forgiveness', 'مغفرة': 'repentance-seeking-forgiveness',
  'استخارة': 'istikharah-seeking-allah', 'الاستخارة': 'istikharah-seeking-allah',
  'مريض': 'visiting-sick', 'المريض': 'visiting-sick', 'عيادة': 'visiting-sick',
  'إفطار': 'breaking-fast', 'الإفطار': 'breaking-fast', 'افطار': 'breaking-fast', 'فطور': 'breaking-fast',
  'طعام': 'before-eating', 'الطعام': 'before-eating', 'أكل': 'before-eating', 'اكل': 'before-eating',
  'منزل': 'entering-home', 'المنزل': 'entering-home', 'بيت': 'entering-home', 'البيت': 'entering-home',
  'مسجد': 'entering-mosque', 'المسجد': 'entering-mosque',
  'دين': 'setting-debt', 'الدين': 'setting-debt', 'ديْن': 'setting-debt',
  'عدو': 'against-enemy', 'العدو': 'against-enemy',
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

  // Arabic input can't match the English token index, so resolve it via the Arabic
  // safety-net map: exact word first, then substring (catches "دعاء الغضب" → غضب).
  if (isArabicText(raw)) {
    if (DUA_ALIASES_AR[raw]) return DUA_ALIASES_AR[raw];
    for (const [k, mapped] of Object.entries(DUA_ALIASES_AR)) {
      if (raw.includes(k)) return mapped;
    }
    return null;   // Arabic but unmatched — don't fall through to the English index
  }

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
  // Walk the language chain: a concise primary first, then fuller editions only
  // when the primary returns no entry for this ayah (the concise editions are
  // selective). The first edition that has text wins.
  const chain = language === 'arabic' ? TAFSIR_AR_CHAIN : TAFSIR_EN_CHAIN;
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
        if (text.length > TAFSIR_CAP) {
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
  const name = TAFSIR_NAMES[edition] || 'Tafsir';
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
// Minimum semantic `similarity` (0–1) for a USER QUESTION to be answered by the
// top published ruling. IslamQA's 32k-answer corpus always returns something, so
// below this floor we report "no close match" and let the assistant advise
// consulting a scholar rather than relay a weakly-related fatwa as authoritative.
// Genuine matches observed at ~0.5–0.65; this is set low to avoid rejecting valid
// rulings while still catching off-topic noise. Random "fatwa of the day" skips it.
const FATWA_MIN_SIMILARITY = 0.35;
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
    let chosenSimilarity = null;
    if (!(answerId > 0)) {
      // Explicit question → highest-similarity match (with a relevance floor);
      // otherwise a random topic → a random hit from the top of the list.
      const term = q || ISLAMQA_TOPICS[Math.floor(r() * ISLAMQA_TOPICS.length)];
      const sr = await mcpCall(f, ISLAMQA_MCP, sid, 'search_answers', { query: term, mode: 'semantic', limit: 10 });
      const rows = ((sr && sr.results) || []).filter(x => x && x.answer_id != null);
      if (!rows.length) return { block: '', meta: { error: 'No fatwa found for: ' + term, noMatch: true } };
      let row;
      if (q) {
        row = rows.slice().sort((x, y) => (y.similarity || 0) - (x.similarity || 0))[0];
        if (typeof row.similarity === 'number' && row.similarity < FATWA_MIN_SIMILARITY) {
          return { block: '', meta: {
            error: 'No closely-matching published fatwa for: ' + q, noMatch: true, similarity: row.similarity,
          } };
        }
      } else {
        row = rows[Math.floor(r() * Math.min(rows.length, 10))];
      }
      answerId = parseInt(row.answer_id, 10);
      chosenSimilarity = typeof row.similarity === 'number' ? row.similarity : null;
    }
    if (!(answerId > 0)) return { block: '', meta: { error: 'Could not find a fatwa' } };

    const fr = await mcpCall(f, ISLAMQA_MCP, sid, 'fetch_answer', { answer_id: answerId }, 3);
    const a = fr && fr.answer;
    if (!a || (!a.answer_en && !a.answer_ar)) {
      return { block: '', meta: { error: 'Fatwa has no answer', id: answerId } };
    }
    // Determine which language side to serve.
    // Priority: (1) if the query itself was in Arabic, serve the Arabic side —
    // the MCP found an Arabic-language fatwa and translating it to English would be
    // a content switch; (2) if the answer only exists in one language, use that;
    // (3) otherwise honour the global `language` setting.
    const queryIsArabic = isArabicText(q);
    let ar;
    if (queryIsArabic && a.answer_ar) ar = true;
    else if (!a.answer_en) ar = true;          // Arabic-only entry
    else if (!a.answer_ar) ar = false;         // English-only entry
    else ar = (language !== 'english');        // both sides present → honour setting
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
        ...(chosenSimilarity != null ? { similarity: chosenSimilarity } : {}),
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
  getHadith, getQuran, getDua, getTafsir, getFatwa, getHadithExplained, getSurahLink,
  DUA_CATEGORIES,
  formatHadith, formatQuran, formatDua, formatTafsir, formatFatwa, formatHadithExplained, formatSurahLink,
  normalizeCategory, resolveCategory, sanitizeMd, htmlToTelegram,
  detectLang, isArabicText,
};

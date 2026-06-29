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
  'malik', 'ahmed',                              // classical primary collections
]);

// Book-scoped search: resolve a user-supplied book name (any language) to a
// collection_slug so "a hadith about patience in Bukhari" filters to that book.
// Keys are normalised (lowercased, "al-"/diacritics/punctuation stripped — see
// normBookName); values are slugs from HADITH_ALLOWED_COLLECTIONS. Arabic names
// are matched as-is (Arabic isn't normalised away by normBookName).
const HADITH_BOOK_ALIASES = {
  bukhari: 'bukhari', sahihbukhari: 'bukhari', sahihalbukhari: 'bukhari',
  'البخاري': 'bukhari', 'صحيح البخاري': 'bukhari',
  muslim: 'muslim', sahihmuslim: 'muslim',
  'مسلم': 'muslim', 'صحيح مسلم': 'muslim',
  abudawud: 'abudawud', abudawood: 'abudawud', sunanabidawud: 'abudawud', dawud: 'abudawud',
  'أبو داود': 'abudawud', 'ابو داود': 'abudawud', 'سنن أبي داود': 'abudawud', 'سنن ابي داود': 'abudawud',
  tirmidhi: 'tirmidhi', altirmidhi: 'tirmidhi', jamitirmidhi: 'tirmidhi', sunantirmidhi: 'tirmidhi',
  'الترمذي': 'tirmidhi', 'الترمذى': 'tirmidhi', 'سنن الترمذي': 'tirmidhi', 'جامع الترمذي': 'tirmidhi',
  nasai: 'nasai', annasai: 'nasai', sunannasai: 'nasai',
  'النسائي': 'nasai', 'النسائى': 'nasai', 'سنن النسائي': 'nasai',
  ibnmajah: 'ibnmajah', sunanibnmajah: 'ibnmajah', majah: 'ibnmajah',
  'ابن ماجه': 'ibnmajah', 'سنن ابن ماجه': 'ibnmajah',
  malik: 'malik', muwatta: 'malik', muwattamalik: 'malik', almuwatta: 'malik',
  'مالك': 'malik', 'موطأ مالك': 'malik', 'الموطأ': 'malik', 'موطأ': 'malik',
  ahmad: 'ahmed', ahmed: 'ahmed', musnadahmad: 'ahmed', musnad: 'ahmed',
  'أحمد': 'ahmed', 'احمد': 'ahmed', 'مسند أحمد': 'ahmed', 'مسند احمد': 'ahmed',
  darimi: 'darimi', addarimi: 'darimi', sunandarimi: 'darimi',
  'الدارمي': 'darimi', 'سنن الدارمي': 'darimi',
};

// Group shorthands expand to several slugs ("the sahihayn", "the six books").
const HADITH_BOOK_GROUPS = {
  sahihayn: ['bukhari', 'muslim'], sahihain: ['bukhari', 'muslim'],
  'الصحيحين': ['bukhari', 'muslim'], 'الصحيحان': ['bukhari', 'muslim'],
  sixbooks: ['bukhari', 'muslim', 'abudawud', 'tirmidhi', 'nasai', 'ibnmajah'],
  thesixbooks: ['bukhari', 'muslim', 'abudawud', 'tirmidhi', 'nasai', 'ibnmajah'],
  kutubsittah: ['bukhari', 'muslim', 'abudawud', 'tirmidhi', 'nasai', 'ibnmajah'],
  'الكتب الستة': ['bukhari', 'muslim', 'abudawud', 'tirmidhi', 'nasai', 'ibnmajah'],
  'الصحاح الستة': ['bukhari', 'muslim', 'abudawud', 'tirmidhi', 'nasai', 'ibnmajah'],
};

// Normalise a Latin book name for alias lookup: lowercase, drop the assimilated
// "al-"/"at-"/… article, strip diacritics, spaces, hyphens and apostrophes. Arabic
// text is left intact (the alias keys hold the Arabic forms verbatim).
function normBookName(s) {
  const raw = String(s || '').trim().toLowerCase();
  if (/[؀-ۿ]/.test(raw)) return raw.replace(/\s+/g, ' ').trim(); // Arabic: keep as-is (collapsed ws)
  return raw
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[''`]/g, '')
    .replace(/^(al|ad|an|ar|as|at|az|ash)-/, '')
    .replace(/[^a-z0-9]/g, '');
}

// Latin alias keys, used for the fuzzy fallback below. Arabic keys are excluded —
// typo-matching Arabic script is error-prone, so Arabic names must match exactly.
const HADITH_BOOK_LATIN_KEYS = Object.keys(HADITH_BOOK_ALIASES).filter(k => !/[؀-ۿ]/.test(k));

// Levenshtein edit distance (small strings; iterative two-row).
function _editDistance(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Tolerant resolution of a NORMALISED Latin book key to a slug: exact → prefix →
// nearest (edit distance ≤ 2), so "bukhary", "tirmizi", "sahih bukari" still land.
// Arabic keys are not fuzzed (returns null) — they must match an alias exactly.
function fuzzyBook(key) {
  if (!key || /[؀-ۿ]/.test(key)) return null;
  if (HADITH_BOOK_ALIASES[key]) return HADITH_BOOK_ALIASES[key];
  if (key.length >= 4) {
    const pre = HADITH_BOOK_LATIN_KEYS.find(k => k.startsWith(key) || key.startsWith(k));
    if (pre) return HADITH_BOOK_ALIASES[pre];
  }
  if (key.length >= 5) {
    let best = null, bestD = 3;
    for (const k of HADITH_BOOK_LATIN_KEYS) {
      const d = _editDistance(key, k);
      if (d < bestD) { bestD = d; best = k; }
    }
    if (best) return HADITH_BOOK_ALIASES[best];
  }
  return null;
}

// Resolve a books argument (array or comma/"and"-separated string of names) to a
// Set of collection slugs, intersected with the allowlist. Returns null when no
// book was requested (caller then uses the full allowlist), or an empty Set when
// names were given but none resolved (caller surfaces an "unknown book" error).
function resolveBooks(books) {
  if (books == null) return null;
  // Split a free-text list on commas/slashes, English "and", and the Arabic
  // conjunction و (attached "ومسلم" or spaced "و مسلم"). The waw is consumed by
  // the split; a leading-waw strip below catches any that slips through an array.
  const list = Array.isArray(books)
    ? books
    : String(books).split(/[,/]|\band\b|\s+و\s*/).map(s => s.trim());
  const names = list.filter(Boolean);
  if (!names.length) return null;
  const slugs = new Set();
  for (const name of names) {
    const key = normBookName(name);
    if (!key) continue;
    if (HADITH_BOOK_GROUPS[key]) { HADITH_BOOK_GROUPS[key].forEach(s => slugs.add(s)); continue; }
    let slug = HADITH_BOOK_ALIASES[key];
    // A stray leading Arabic conjunction ("ومسلم" → "مسلم") arriving in an array.
    if (!slug && key.length > 2 && key.startsWith('و')) slug = HADITH_BOOK_ALIASES[key.slice(1)];
    if (!slug) slug = fuzzyBook(key);
    if (slug && HADITH_ALLOWED_COLLECTIONS.has(slug)) slugs.add(slug);
  }
  return slugs; // possibly empty → caller treats as "unrecognised book(s)"
}

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
// Asbab al-Nuzul mode: Ibn Kathir leads because it systematically embeds the
// sabab narrations; Ma'arif/Tazkirul are fallbacks for verses Ibn Kathir skips.
// Arabic tries ar-ibn-kathir first (exists on quran.com); falls through silently
// on a miss so we always get something meaningful.
const TAFSIR_EN_CHAIN_ASBAB = ['en-ibn-kathir', 'en-maarif-ul-quran', 'en-tazkirul-quran'];
const TAFSIR_AR_CHAIN_ASBAB = ['ar-ibn-kathir', 'ar-jalalayn', 'ar-saadi'];
// Human-readable names for the citation line, keyed by edition id.
const TAFSIR_NAMES = {
  'en-tazkirul-quran': 'Tazkirul Quran',
  'en-maarif-ul-quran': "Ma'arif al-Qur'an",
  'en-ibn-kathir': 'Tafsir Ibn Kathir',
  'ar-saadi': 'تفسير السعدي',
  'ar-jalalayn': 'تفسير الجلالين',
  'ar-ibn-kathir': 'تفسير ابن كثير',
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
async function getHadith({ query, id, books, language = 'both', fetchImpl, rng } = {}) {
  const f = fetchImpl || defaultFetch();
  const r = rng || Math.random;
  const q = (query == null ? '' : String(query)).trim();
  const bookSet = resolveBooks(books); // null = any allowed book; empty Set = unrecognised
  if (bookSet && bookSet.size === 0) {
    return { block: '', meta: { error: 'Unrecognised book. Supported: Bukhari, Muslim, Abu Dawud, '
      + 'Tirmidhi, Nasai, Ibn Majah, Malik (Muwatta), Ahmad, Darimi.', badBook: true } };
  }
  const allow = bookSet || HADITH_ALLOWED_COLLECTIONS; // active collection filter
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
      // Topical search: keep only the requested book(s) (default: all authoritative
      // books), then take the highest-similarity match among them. A book filter
      // narrows the pool, so widen the fetch limit when one is active to keep recall.
      const limit = bookSet ? 40 : 10;
      const sr = await mcpCall(f, HADITH_MCP, sid, 'search_hadith', { query: q, mode: 'semantic', limit });
      const rows = (sr && sr.results) || [];
      const allowed = rows
        .filter(r => r && allow.has(r.collection_slug) && typeof r.similarity === 'number')
        .sort((a, b) => b.similarity - a.similarity);
      if (!allowed.length) {
        const where = bookSet ? ' in ' + [...bookSet].join(', ') : '';
        return { block: '', meta: { error: 'No authenticated narration found for: ' + q + where, noMatch: true } };
      }
      best = allowed[0];
      rec = await fetchOne(sid, parseInt(best.hadith_id, 10));
    } else if (bookSet) {
      // Random within specific collection(s) ("a random hadith from Bukhari"):
      // the global id space can't honour a collection filter, so draw from a few
      // random everyday topics, keep only rows from the requested book(s), and
      // pick one at random among them. Different topics each round widen the pool.
      const tried = new Set();
      let pool = [];
      for (let attempt = 0; attempt < 5 && !pool.length; attempt++) {
        let term;
        do { term = HADITH_TOPICS[Math.floor(r() * HADITH_TOPICS.length)]; }
        while (tried.has(term) && tried.size < HADITH_TOPICS.length);
        tried.add(term);
        const sr = await mcpCall(f, HADITH_MCP, sid, 'search_hadith', { query: term, mode: 'semantic', limit: 40 });
        pool = ((sr && sr.results) || []).filter(rw => rw && allow.has(rw.collection_slug));
      }
      if (!pool.length) {
        const where = [...bookSet].join(', ');
        return { block: '', meta: { error: 'Could not find a hadith in ' + where + ' right now. '
          + 'Try naming a topic, e.g. "a hadith about patience in ' + where + '".', noMatch: true } };
      }
      best = pool[Math.floor(r() * pool.length)];
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
async function getQuran({ surah, ayah, query, language = 'both', tafsir, fetchImpl, rng } = {}) {
  const f = fetchImpl || defaultFetch();
  const r = rng || Math.random;
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
    // No ref AND no query → open random verse across the whole mushaf (each surah
    // weighted by its ayah count for a uniform draw over all 6,236 ayat). Routed
    // through viaSearch so the tafsir-bundle path fires, matching a topical pick.
    // Only fires when neither surah nor ayah was supplied — an out-of-range ref
    // (e.g. surah 999) is an error, not a random request.
    if (!key && !q && Number.isNaN(s) && Number.isNaN(a)) {
      const totalAyat = SURAH_AYAH_COUNTS.reduce((sum, c) => sum + c, 0);
      let pick = Math.floor(r() * totalAyat);
      let si = 0;
      while (si < SURAH_AYAH_COUNTS.length && pick >= SURAH_AYAH_COUNTS[si]) { pick -= SURAH_AYAH_COUNTS[si]; si++; }
      s = si + 1; a = pick + 1;
      key = `${s}:${a}`;
      viaSearch = true;
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

    // Always bundle tafsir with the verse so the user gets verse + commentary in
    // one card. Pass tafsir:false to suppress (verse alone).
    const wantTafsir = tafsir !== false;
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
  out.push(`[quran.com](https://quran.com/${surahNum}/${ayahNum})`);
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

// Wrap an audio URL as a Markdown hyperlink so Telegram renders it as a
// tappable link. Raw URLs containing underscores (e.g. mishari_al_afasy)
// are mangled by Telegram's Markdown parser — _al_ is read as italic markers
// and the underscores are stripped, producing a broken URL. Enclosing the URL
// in [label](url) syntax prevents that: Telegram treats the () content literally.
function _audioLink(audioUrl, isAr) {
  const label = isAr ? '🎧 استمع — مشاري راشد العفاسي' : '🎧 Listen — Mishari al-Afasy';
  return '[' + label + '](' + audioUrl + ')';
}

function formatSurahFull({ n, enName, arName, ayat, verses, url, language,
    translatedName, revelationPlace, revelationOrder, audioUrl }) {
  const en = sanitizeMd(enName);
  const ar = sanitizeMd(arName);
  // translatedName is always English — only show in English or bilingual mode
  const tr = (!language || language !== 'arabic') && translatedName ? sanitizeMd(translatedName) : null;
  const parts = [];
  const isAr  = language === 'arabic';
  const isEn  = language === 'english';

  // ── Header ────────────────────────────────────────────────────────────────
  if (isAr) {
    parts.push('☪️ *سورة ' + ar + '*');
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
  if (audioUrl) parts.push(_audioLink(audioUrl, isAr));
  return parts.join('\n');
}

function formatSurahLink({ n, enName, arName, ayat, url, language,
    translatedName, revelationPlace, revelationOrder, audioUrl, shortText }) {
  const en = sanitizeMd(enName);
  const ar = sanitizeMd(arName);
  // translatedName is always English — skip in Arabic-only mode
  const tr = language !== 'arabic' && translatedName ? sanitizeMd(translatedName) : null;
  const isAr = language === 'arabic';
  const isEn = language === 'english';
  const out  = [];

  // ── Header ────────────────────────────────────────────────────────────────
  if (isAr) {
    out.push('☪️ *سورة ' + ar + '*');
  } else if (isEn) {
    out.push('☪️ *Surah ' + en + (tr ? ' — ' + tr : '') + '* (' + n + ')');
  } else {
    out.push('☪️ *سورة ' + ar + ' · ' + en + (tr ? ' — ' + tr : '') + '* (' + n + ')');
  }

  // Revelation badge + verse count
  const badge = _revelationBadge(revelationPlace, revelationOrder, language);
  const countStr = isAr ? ayat + ' آية' : ayat + ' verses';
  out.push('_' + [badge, countStr].filter(Boolean).join(' · ') + '_');

  // ── Short intro — only in English / bilingual (API only returns English text) ──
  if (shortText && !isAr) {
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
    out.push(_audioLink(audioUrl, isAr));
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
  // "Contentment" (rida — accepting Allah's decree) has no dedicated chapter; the
  // closest honest home is the dua for when something pleases or displeases you.
  contentment: 'something-pleases-happens', content: 'something-pleases-happens',
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
  'supplication', 'supplications', 'dua', 'duas', 'recited', 'recite', 'be', 'some', 'who', 'his',
  // Over-common religious filler: present in dozens of titles, so it carries no
  // discriminating signal. Without this, a query like "reliance on Allah" scored a
  // false 2-point match on the lone token "allah" and mis-resolved to istikharah.
  'allah', 'god', 'lord']);

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
// Sentinel words that mean "give me ANY dua" — intercept before the alias maps so
// standalone generic words ("adhkar", "أذكار") don't funnel to morning-evening.
// Compound phrases ("morning adhkar", "أذكار الصباح") won't match because the
// sentinel does an exact check on the full trimmed/lowercased input.
const DUA_RANDOM_WORDS = new Set([
  // English generics
  'random', 'any', 'surprise', 'anything', 'whatever', 'random dua', 'any dua',
  'adhkar', 'azkar', 'general',
  // Arabic generics (standalone — not part of a compound phrase)
  'أذكار', 'الأذكار', 'اذكار', 'ذكر', 'دعاء',
  // Arabic "random"
  'عشوائي', 'عشوائية',
]);

async function getDua({ query, category, language = 'both', rng, offset = 0 } = {}) {
  const r = rng || Math.random;
  const input = query || category;
  // No input OR sentinel word ("random", "any", "surprise" …) → uniform random chapter.
  const wantRandom = !input || DUA_RANDOM_WORDS.has(String(input).trim().toLowerCase());
  const slug = wantRandom
    ? DUA_CATEGORIES[Math.floor(r() * DUA_CATEGORIES.length)]
    : resolveCategory(input);
  const cat  = slug ? HISN.categories[slug] : null;
  if (!cat) {
    return { block: '', meta: { error: 'Unknown dua category', query: input, available: DUA_CATEGORIES.slice(0, 40) } };
  }

  const entries = Array.isArray(cat.entries) ? cat.entries : [];
  const blocks = [];
  let used = 0;
  let shown = 0;
  let skipped = 0;

  for (const e of entries) {
    const piece = formatDuaEntry(e, language);
    if (!piece) continue;
    if (skipped < offset) { skipped++; continue; }
    const cost = piece.length + (shown > 0 ? DUA_SEP_LEN : 0);
    if (shown > 0 && used + cost > DUA_MAX_CHARS) break;
    blocks.push(piece);
    used += cost;
    shown += 1;
  }

  const nextOffset = offset + shown;
  const remaining  = entries.length - nextOffset;
  return {
    block: formatDua({ title: cat.title, blocks, remaining, language }),
    meta:  { category: slug, title: cat.title, offset, count: shown, total: entries.length, nextOffset, language },
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
 * @param {boolean} [opts.asbab] when true, lead with Ibn Kathir (embeds sabab narrations)
 * @param {Function} [opts.fetchImpl]
 * @returns {Promise<{ block:string, meta:object }>}
 */
async function getTafsir({ surah, ayah, language = 'both', asbab, fetchImpl } = {}) {
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
  // asbab mode leads with Ibn Kathir because it systematically records the
  // sabab narrations; fallbacks cover the verses it doesn't address individually.
  const chain = asbab
    ? (language === 'arabic' ? TAFSIR_AR_CHAIN_ASBAB : TAFSIR_EN_CHAIN_ASBAB)
    : (language === 'arabic' ? TAFSIR_AR_CHAIN : TAFSIR_EN_CHAIN);
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
  return ['📖 *' + name + ` — ${surahNum}:${ayahNum}*`, '', text].join('\n');
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
const ISLAMQA_TOPICS_AR = [
  'الصلاة', 'الصيام', 'الزكاة', 'الوضوء', 'الطهارة', 'الحج', 'العمرة',
  'الزواج', 'الصدقة', 'التوبة', 'رمضان', 'الجنابة', 'السنة', 'الحياء',
  'التهجد', 'الأذكار', 'الطلاق', 'النكاح', 'العبادة', 'الإسلام',
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
      const topicPool = (!q && language !== 'english') ? ISLAMQA_TOPICS_AR : ISLAMQA_TOPICS;
      const term = q || topicPool[Math.floor(r() * topicPool.length)];
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
    // When the query was in Arabic, steer toward the Arabic side for content that
    // has both languages — the MCP found an Arabic-language fatwa and an English
    // translation would be a content switch. Apply this as an effective language
    // override only when language wasn't already forced to 'english'.
    const effectiveLang = (isArabicText(q) && a.answer_ar && language !== 'english')
      ? 'arabic' : language;
    const showAr = effectiveLang !== 'english';
    return {
      block: formatFatwa({
        titleAr:    a.title_ar    || '',
        titleEn:    a.title_en    || '',
        questionAr: a.question_ar || '',
        questionEn: a.question_en || '',
        answerAr:   a.answer_ar   || '',
        answerEn:   a.answer_en   || '',
        sourceAr:   a.source_url_ar || a.url_ar || '',
        sourceEn:   a.source_url_en || a.url_en || a.url || '',
        language:   effectiveLang,
      }),
      meta: {
        id: a.id, source: 'IslamQA.info', language: effectiveLang,
        url: (showAr ? (a.source_url_ar || a.url_ar) : null) || a.source_url_en || a.url_en || a.url || null,
        categories: (a.categories || []).map(c => (showAr ? c.name_ar : c.name_en) || c.name_en).filter(Boolean),
        ...(chosenSimilarity != null ? { similarity: chosenSimilarity } : {}),
      },
    };
  } catch (e) {
    return { block: '', meta: { error: 'Could not fetch fatwa: ' + e.message } };
  }
}

function formatFatwa({ titleAr, titleEn, questionAr, questionEn, answerAr, answerEn, sourceAr, sourceEn, language }) {
  // External IslamQA text can carry stray Markdown control chars that unbalance
  // Telegram's parser; strip them so only our own balanced labels remain.
  titleAr    = sanitizeMd((titleAr    || '').trim());
  titleEn    = sanitizeMd((titleEn    || '').trim());
  questionAr = sanitizeMd((questionAr || '').trim());
  questionEn = sanitizeMd((questionEn || '').trim());
  answerAr   = sanitizeMd((answerAr   || '').trim());
  answerEn   = sanitizeMd((answerEn   || '').trim());
  const showAr = language !== 'english';
  const showEn = language !== 'arabic';
  const out = [language === 'arabic' ? '⚖️ *فتوى*' : '⚖️ *Fatwa*'];
  const title = showAr ? (titleAr || titleEn) : (titleEn || titleAr);
  if (title) out.push('', '*' + title + '*');
  if (showAr && questionAr) out.push('', '*السؤال:* ' + questionAr);
  if (showEn && questionEn) out.push('', '*Question:* ' + questionEn);
  // Fallback when preferred language is unavailable
  if (showAr && !questionAr && questionEn) out.push('', '*Question:* ' + questionEn);
  if (showEn && !questionEn && questionAr) out.push('', '*السؤال:* ' + questionAr);
  if (showAr && answerAr)              out.push('', '*الجواب:* ' + answerAr);
  if (showEn && answerEn)              out.push('', '*Answer:* ' + answerEn);
  if (showAr && !answerAr && answerEn) out.push('', '*Answer:* ' + answerEn);
  if (showEn && !answerEn && answerAr) out.push('', '*الجواب:* ' + answerAr);
  const src = (showAr ? sourceAr : null) || sourceEn || '';
  const cite = ['IslamQA.info', src].filter(Boolean).join(' · ');
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

/**
 * Search HadeethEnc.com for hadiths that have a scholarly explanation (sharh),
 * returning candidate {id, title} rows for Claude to judge against the hadith the
 * user wants explained. This is the "explain THIS hadith" bridge: HadeethEnc uses
 * its own ID space (unrelated to Sunnah.com ids), so the only safe way to reach a
 * specific explained hadith is to search its corpus by the hadith's key phrase and
 * let Claude pick the genuinely-matching candidate (or fall back to its own
 * grounded explanation when none match — HadeethEnc only carries authentic hadith,
 * so weak narrations simply are not present).
 *
 * Endpoint: GET /hadeeths/search/?phrase=...&language=ar|en → [{id, title, hadith_text}]
 * @param {object} opts
 * @param {string} opts.query   key phrase of the hadith to explain
 * @param {number} [opts.offset=0]
 * @param {'arabic'|'english'|'both'} [opts.language='both']
 * @param {Function} [opts.fetchImpl]
 * @returns {Promise<{type:string, query:string, offset:number, total:number, results:Array}>}
 */
async function searchHadithExplained({ query, offset = 0, language = 'both', fetchImpl } = {}) {
  const f = fetchImpl || defaultFetch();
  const q = (query == null ? '' : String(query)).trim();
  if (!q) return { type: 'hadith_explained', query: q, offset, total: 0, results: [], error: 'query required' };
  const lang = hadeethEncLang(language);
  try {
    const rows = await fetchJson(f,
      `${HADEETHENC_BASE}/hadeeths/search/?phrase=${encodeURIComponent(q)}&language=${lang}`);
    const all = Array.isArray(rows) ? rows.filter(r => r && r.id) : [];
    const page = all.slice(offset, offset + SEARCH_RESULTS_MAX);
    if (!page.length) return { type: 'hadith_explained', query: q, offset, total: all.length, results: [] };

    const results = page.map((row, i) => {
      const title   = _truncate(sanitizeMd(cleanWs(row.title || '')), 120);
      const snippet = _truncate(sanitizeMd(_extractMatn(cleanWs(row.hadith_text || ''))), 220);
      return {
        n: offset + i + 1,
        ref: 'HadeethEnc #' + row.id,
        title: title || ('HadeethEnc #' + row.id),
        snippet,
        selector: { id: parseInt(row.id, 10) },
      };
    });
    return { type: 'hadith_explained', query: q, offset, total: all.length, results };
  } catch (e) {
    return { type: 'hadith_explained', query: q, offset, total: 0, results: [], error: 'Search failed: ' + e.message };
  }
}

// ── Two-step search functions ─────────────────────────────────────────────────
// Each returns { type, query, offset, total, results: [{n, ref, title, snippet, selector}] }.
// Results are NOT relayed — Claude sees them directly and renders the numbered menu.
// selector is the exact input for the matching get_* tool (e.g. {id} for hadith/fatwa,
// {surah,ayah} for quran, {query:slug} for dua, {surah:n} for surah).

const SEARCH_RESULTS_MAX = 5;

// Truncate to `max` chars at a word boundary (space), never mid-word.
function _truncate(s, max) {
  if (!s || s.length <= max) return s;
  const cut = s.lastIndexOf(' ', max);
  return (cut > max * 0.6 ? s.slice(0, cut) : s.slice(0, max)) + '…';
}

// Extract the matn (actual hadith text) by stripping the isnad (narrator chain).
// In Arabic hadith text the matn is always enclosed in quotes; the isnad never contains quotes.
// Falls back to splitting on the last قال: for unquoted texts, then returns as-is.
function _extractMatn(text) {
  if (!text) return text;
  // First opening Arabic/ASCII quote signals the start of the matn
  const qi = text.search(/["""«]/);
  if (qi >= 0 && qi < text.length - 10) {
    return text.slice(qi + 1).replace(/["""»\s]+$/, '').trim();
  }
  // Fallback: split on قال: and take the last segment
  const parts = text.split(/قال[ُ]?\s*:/);
  if (parts.length > 1) return parts[parts.length - 1].trim();
  // English fallback: strip "Narrated X:" prefix
  const en = text.match(/^Narrated[^:]+:\s*(.+)/is);
  if (en) return en[1].trim();
  return text;
}

/**
 * Search hadiths by topic; fetches snippet text in parallel (best-effort).
 */
// Interleave rows from each collection in round-robin so no single collection
// dominates the first page when a multi-book scope is requested.
function _balanceByCollection(rows, bookSet) {
  const queues = {};
  for (const slug of bookSet) queues[slug] = [];
  for (const r of rows) {
    if (queues[r.collection_slug]) queues[r.collection_slug].push(r);
    // rows filtered to bookSet already, but guard against unexpected slugs
  }
  const balanced = [];
  const qs = Object.values(queues);
  while (balanced.length < rows.length) {
    let added = false;
    for (const q of qs) { if (q.length) { balanced.push(q.shift()); added = true; } }
    if (!added) break;
  }
  return balanced;
}

async function searchHadith({ query, offset = 0, books, language = 'both', fetchImpl, pool } = {}) {
  const f = fetchImpl || defaultFetch();
  const q = (query == null ? '' : String(query)).trim();
  if (!q) return { type: 'hadith', query: q, offset, total: 0, results: [], error: 'query required' };
  const bookSet = resolveBooks(books); // null = any allowed book; empty Set = unrecognised
  if (bookSet && bookSet.size === 0) {
    return { type: 'hadith', query: q, offset, total: 0, results: [],
      error: 'Unrecognised book. Supported: Bukhari, Muslim, Abu Dawud, Tirmidhi, Nasai, Ibn Majah, '
        + 'Malik (Muwatta), Ahmad, Darimi.', badBook: true };
  }
  const allow = bookSet || HADITH_ALLOWED_COLLECTIONS;
  try {
    const sid = await mcpInit(f, HADITH_MCP);
    let all;
    if (pool && Array.isArray(pool) && pool.length) {
      // Serve from pre-fetched cached pool — skip MCP search for consistent paging.
      all = pool;
    } else {
      // A book filter narrows the pool, so widen the fetch to keep enough results to
      // fill (and page) the menu. Multi-book fetch is widened further for balancing.
      const limit = bookSet ? (bookSet.size > 1 ? 80 : 60) : 30;
      const sr = await mcpCall(f, HADITH_MCP, sid, 'search_hadith', { query: q, mode: 'semantic', limit });
      const rows = ((sr && sr.results) || [])
        .filter(r => r && allow.has(r.collection_slug) && r.hadith_id)
        .sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
      // Interleave across collections for multi-book scopes so both Sahihs appear.
      all = (bookSet && bookSet.size > 1) ? _balanceByCollection(rows, bookSet) : rows;
    }

    const page = all.slice(offset, offset + SEARCH_RESULTS_MAX);
    if (!page.length) return { type: 'hadith', query: q, offset, total: all.length, results: [], pool: all };

    const isAr = language === 'arabic';
    // Fetch full records for snippets in parallel (best-effort; id 10–14 avoids collisions).
    const recs = await Promise.all(page.map((row, i) =>
      mcpCall(f, HADITH_MCP, sid, 'fetch_hadith', { hadith_id: parseInt(row.hadith_id, 10) }, 10 + i)
        .then(fr => (fr && (fr.hadith || (fr.hadiths && fr.hadiths[0]))) || fr || {})
        .catch(() => {})));

    const results = page.map((row, i) => {
      const rec = recs[i] || {};
      const collEn = cleanWs(row.collection_name_english || rec.collection_name_english || '');
      const collAr = cleanWs(row.collection_name_arabic  || rec.collection_name_arabic  || '');
      const chapEn = cleanWs(row.chapter_name_english    || rec.chapter_name_english    || '');
      const chapAr = cleanWs(row.chapter_name_arabic     || rec.chapter_name_arabic     || '');
      const coll   = sanitizeMd(isAr ? (collAr || collEn) : (collEn || collAr));
      const chap   = sanitizeMd(isAr ? (chapAr || chapEn) : (chapEn || chapAr));
      const ref    = coll + (row.hadith_id ? ' #' + row.hadith_id : '');
      const rawTxt = isAr
        ? (cleanWs(rec.arabic  || '') || cleanWs(rec.english || ''))
        : (cleanWs(rec.english || '') || cleanWs(rec.arabic  || ''));
      const snippet = rawTxt ? _truncate(sanitizeMd(_extractMatn(rawTxt)), 220) : '';
      return { n: offset + i + 1, ref, title: chap || ref, snippet, selector: { id: parseInt(row.hadith_id, 10) } };
    });

    return { type: 'hadith', query: q, offset, total: all.length, results, pool: all };
  } catch (e) {
    return { type: 'hadith', query: q, offset, total: 0, results: [], error: 'Search failed: ' + e.message };
  }
}

/**
 * Search Quran verses by topic. Translation text from search results used as snippet when available.
 */
async function searchQuran({ query, offset = 0, language = 'both', fetchImpl, pool } = {}) {
  const f = fetchImpl || defaultFetch();
  const q = (query == null ? '' : String(query)).trim();
  const hasPool = pool && Array.isArray(pool) && pool.length;
  if (!q && !hasPool) return { type: 'quran', query: q, offset, total: 0, results: [], error: 'query required' };
  try {
    const sid = await mcpInit(f, QURAN_MCP);
    let all;
    if (hasPool) {
      all = pool;
    } else {
      await mcpGround(f, QURAN_MCP, sid);
      const sr = await mcpCall(f, QURAN_MCP, sid, 'search_quran', { query: q, translations: [QURAN_TRANSLATION_EDITION] });
      all = ((sr && sr.results) || [])
        .filter(r => r && r.ayah_key)
        .sort((x, y) => (y.relevance_score || 0) - (x.relevance_score || 0));
    }

    const page = all.slice(offset, offset + SEARCH_RESULTS_MAX);
    if (!page.length) return { type: 'quran', query: q, offset, total: all.length, results: [], pool: all };

    const isAr = language === 'arabic';
    const tafsirEd = isAr ? TAFSIR_AR_CHAIN[0] : TAFSIR_EN_CHAIN[0];

    // Parse ayah refs upfront so the parallel tafsir fetch can reuse them.
    const parsed = page.map(r => {
      const parts = (r.ayah_key || '1:1').split(':');
      return { s: parseInt(r.surah || parts[0], 10) || 1, a: parseInt(r.ayah || parts[1], 10) || 1, r };
    });

    // Parallel tafsir snippet fetches — reuse existing MCP session (ids 10–14).
    const tafsirSnippets = await Promise.all(parsed.map(({ s, a }, i) =>
      mcpCall(f, QURAN_MCP, sid, 'fetch_tafsir', { ayahs: [`${s}:${a}`], editions: [tafsirEd] }, 10 + i)
        .then(tr => {
          const raw = ((((tr && tr.results) || {})[tafsirEd] || [])[0] || {}).text || '';
          return raw ? _truncate(sanitizeMd(stripMarkup(raw)), 150) : '';
        })
        .catch(() => '')
    ));

    const results = parsed.map(({ s, a, r }, i) => {
      const enName = (s >= 1 && s <= 114) ? SURAH_NAMES[s - 1]    : 'Surah ' + s;
      const arName = (s >= 1 && s <= 114) ? SURAH_AR_NAMES[s - 1] : '';
      const ref    = (isAr ? (arName || enName) : enName) + ' ' + s + ':' + a;
      const rawSnippet = cleanWs(r.text || r.translation || '');
      const snippet = rawSnippet ? _truncate(sanitizeMd(stripMarkup(rawSnippet)), 220) : '';
      return {
        n: offset + i + 1, ref,
        title: isAr ? (arName || enName) : enName,
        snippet,
        tafsirSnippet: tafsirSnippets[i] || '',
        url: `https://quran.com/${s}/${a}`,
        selector: { surah: s, ayah: a },
      };
    });

    return { type: 'quran', query: q, offset, total: all.length, results, pool: all };
  } catch (e) {
    return { type: 'quran', query: q, offset, total: 0, results: [], error: 'Search failed: ' + e.message };
  }
}

/**
 * Search fatwas by topic; fetches title/question from top results in parallel.
 */
async function searchFatwa({ query, offset = 0, language = 'both', fetchImpl, pool } = {}) {
  const f = fetchImpl || defaultFetch();
  const q = (query == null ? '' : String(query)).trim();
  const hasPool = pool && Array.isArray(pool) && pool.length;
  if (!q && !hasPool) return { type: 'fatwa', query: q, offset, total: 0, results: [], error: 'query required' };
  try {
    const sid = await mcpInit(f, ISLAMQA_MCP);
    let all;
    if (hasPool) {
      all = pool;
    } else {
      const sr = await mcpCall(f, ISLAMQA_MCP, sid, 'search_answers', { query: q, mode: 'semantic', limit: 30 });
      all = ((sr && sr.results) || []).filter(r => r && r.answer_id != null)
        .sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
    }

    const page = all.slice(offset, offset + SEARCH_RESULTS_MAX);
    if (!page.length) return { type: 'fatwa', query: q, offset, total: all.length, results: [], pool: all };

    const useAr = language === 'arabic' || isArabicText(q);
    // Fetch full answer records for titles/snippets in parallel (id 10–14).
    const answers = await Promise.all(page.map((row, i) =>
      mcpCall(f, ISLAMQA_MCP, sid, 'fetch_answer', { answer_id: parseInt(row.answer_id, 10) }, 10 + i)
        .then(fr => (fr && fr.answer) || {})
        .catch(() => ({}))));

    const results = page.map((row, i) => {
      const a   = answers[i] || {};
      const id  = parseInt(row.answer_id, 10);
      const titleAr   = sanitizeMd(cleanWs(a.title_ar    || row.title_ar    || ''));
      const titleEn   = sanitizeMd(cleanWs(a.title_en    || row.title_en    || ''));
      const qAr       = _truncate(sanitizeMd(cleanWs(a.question_ar || row.question_ar || '')), 220);
      const qEn       = _truncate(sanitizeMd(cleanWs(a.question_en || row.question_en || '')), 220);
      const title   = useAr ? (titleAr || titleEn) : (titleEn || titleAr);
      const snippet = useAr ? (qAr || qEn) : (qEn || qAr);
      return {
        n: offset + i + 1,
        ref: 'IslamQA #' + id,
        title: title || ('IslamQA #' + id),
        snippet: snippet || '',
        selector: { id },
      };
    });

    return { type: 'fatwa', query: q, offset, total: all.length, results, pool: all };
  } catch (e) {
    return { type: 'fatwa', query: q, offset, total: 0, results: [], error: 'Search failed: ' + e.message };
  }
}

/**
 * Search dua/adhkar categories by topic. Local only — no network.
 */
async function searchDua({ query, offset = 0, language = 'both', pool } = {}) {
  const q = (query == null ? '' : String(query)).trim();
  const hasPool = pool && Array.isArray(pool) && pool.length;
  if (!q && !hasPool) return { type: 'dua', query: q, offset, total: 0, results: [], error: 'query required' };

  let scored;
  if (hasPool) {
    scored = pool;
  } else if (isArabicText(q)) {
    let slug = DUA_ALIASES_AR[q] || null;
    if (!slug) {
      for (const [k, v] of Object.entries(DUA_ALIASES_AR)) { if (q.includes(k)) { slug = v; break; } }
    }
    scored = (slug && HISN.categories[slug])
      ? [{ slug, title: HISN.categories[slug].title }]
      : [];
  } else {
    const norm = q.toLowerCase().replace(/\s+/g, '-');
    const alias = DUA_ALIASES[norm] || DUA_ALIASES[q.toLowerCase()];
    if (alias && HISN.categories[alias]) {
      scored = [{ slug: alias, title: HISN.categories[alias].title }];
    } else {
      const tokens = duaTokens(q);
      scored = tokens.length
        ? DUA_INDEX.map(e => {
            let score = 0;
            for (const t of tokens) {
              if (e.tokens.has(t)) { score += 2; continue; }
              for (const et of e.tokens) {
                if (et.length > 2 && (et.includes(t) || t.includes(et))) { score += 1; break; }
              }
            }
            const cat = HISN.categories[e.slug];
            return { slug: e.slug, score, title: cat ? cat.title : e.slug };
          }).filter(e => e.score >= 2).sort((a, b) => b.score - a.score)
        : [];
    }
  }

  const total = scored.length;
  const page  = scored.slice(offset, offset + SEARCH_RESULTS_MAX);
  if (!page.length) return { type: 'dua', query: q, offset, total, results: [], pool: scored };

  const isAr = language === 'arabic';
  const results = page.map(({ slug, title }, i) => {
    const cat     = HISN.categories[slug] || {};
    const entries = Array.isArray(cat.entries) ? cat.entries : [];
    const first   = entries[0] || {};
    const raw     = isAr
      ? cleanWs(first.arabic  || first.english || '')
      : cleanWs(first.english || first.arabic  || '');
    const snippet = raw ? _truncate(sanitizeMd(raw), 220) : '';
    return { n: offset + i + 1, ref: sanitizeMd(title), title: sanitizeMd(title), snippet, selector: { query: slug } };
  });

  return { type: 'dua', query: q, offset, total, results, pool: scored };
}

/**
 * Resolve an ambiguous surah name to a list of candidates. Local only — no network.
 * Returns 0 (no match), 1 (unambiguous), or 2+ (menu needed).
 */
function searchSurah({ query, language = 'both' } = {}) {
  const raw = (query == null ? '' : String(query)).trim();
  if (!raw) return { type: 'surah', query: raw, results: [] };

  const asNum = parseInt(raw, 10);
  if (asNum >= 1 && asNum <= 114 && /^\s*\d+\s*$/.test(raw)) {
    return { type: 'surah', query: raw, results: [_surahResult(asNum, 1, language)] };
  }

  const seen = new Set();
  const push = n => { if (n >= 1 && n <= 114 && !seen.has(n)) seen.add(n); };

  const arExact = SURAH_AR_NAMES.indexOf(raw);
  if (arExact >= 0) push(arExact + 1);

  if (!seen.size) {
    SURAH_AR_NAMES.forEach((name, i) => { if (raw.includes(name) || name.includes(raw)) push(i + 1); });
  }

  if (!seen.size) {
    const want = normSurahName(raw);
    if (want) {
      SURAH_NAMES.forEach((name, i) => { if (normSurahName(name) === want) push(i + 1); });
      if (!seen.size) {
        SURAH_NAMES.forEach((name, i) => {
          const norm = normSurahName(name);
          if (norm.startsWith(want) || want.startsWith(norm)) push(i + 1);
        });
      }
    }
  }

  const results = [...seen].slice(0, 5).map((n, i) => _surahResult(n, i + 1, language));
  return { type: 'surah', query: raw, results };
}

function _surahResult(n, num, language) {
  const isAr  = language === 'arabic';
  const en    = SURAH_NAMES[n - 1]       || 'Surah ' + n;
  const ar    = SURAH_AR_NAMES[n - 1]    || '';
  const ayat  = SURAH_AYAH_COUNTS[n - 1] || 0;
  const ref   = isAr ? ('سورة ' + ar + ' (' + n + ')') : ('Surah ' + en + ' (' + n + ')');
  const count = isAr ? (ayat + ' آية') : (ayat + ' verses');
  return { n: num, ref, title: isAr ? (ar || en) : (en || ar), snippet: count, selector: { surah: n } };
}

function navigateAyah(surah, ayah, dir) {
  const s = parseInt(surah, 10);
  const a = parseInt(ayah, 10);
  if (!(s >= 1 && s <= 114) || !(a >= 1)) return { surah: 1, ayah: 1 };
  if (dir === 'next') {
    const maxAyah = SURAH_AYAH_COUNTS[s - 1];
    if (a < maxAyah) return { surah: s, ayah: a + 1 };
    const nextSurah = s < 114 ? s + 1 : 1;
    return { surah: nextSurah, ayah: 1 };
  }
  // prev
  if (a > 1) return { surah: s, ayah: a - 1 };
  const prevSurah = s > 1 ? s - 1 : 114;
  return { surah: prevSurah, ayah: SURAH_AYAH_COUNTS[prevSurah - 1] };
}

module.exports = {
  getHadith, getQuran, getDua, getTafsir, getFatwa, getHadithExplained, getSurahLink,
  searchHadith, searchHadithExplained, searchQuran, searchFatwa, searchDua, searchSurah,
  navigateAyah,
  DUA_CATEGORIES,
  formatHadith, formatQuran, formatDua, formatTafsir, formatFatwa, formatHadithExplained, formatSurahLink,
  normalizeCategory, resolveCategory, sanitizeMd, htmlToTelegram,
  detectLang, isArabicText, resolveBooks,
};

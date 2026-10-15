// ── अपने-आप alert (JE, 15/10/2026) ──────────────────────────────────────────────
// .github/workflows/alert.yml हर 4 घंटे (सुबह 6 से रात 10 IST) इसे चलाता है। सर्वर के लॉग (/LOGS/<दिन>,
// आज + कल) पढ़कर गंभीर गड़बड़ी छांटता है और GitHub पर "🚨 ऐप alert" issue बनाता/उसमें जोड़ता है — GitHub
// उसकी सूचना JE को Gmail और GitHub ऐप पर भेजता है। पहले JE को ख़ुद ऐप में error log खोलना पड़ता था।
//
// repo public है — इसलिए issue में लाइनमैन का नाम, device-id, error का संदेश कभी नहीं; सिर्फ़ error का
// नाम, कितने फ़ोन, कौन-सा HQ/version। पूरा ब्योरा ऐप के error log (JE मेनू) में।
//
// कौन-सी error कब alert बने — नीचे की तीन सूचियां। js/ में कोई नया logErr("…") जोड़ें तो उसे इनमें से
// किसी एक में डालें — tests/alerts/alerts-check.js यह जांचता है। सूची में न हो (पुराना/अनजाना नाम) तो
// "नई तरह की error" मानकर तुरंत alert।
// एक ही (error + दिन) पर दोबारा alert नहीं — पिछले alert issues में छुपा निशान (<!-- alert-key … -->) देखकर।
const fs = require('fs');

// 🔴 एक बार भी आए तो alert — वसूली/डेटा ख़तरे में, या नई सुरक्षा (CSP) ने ऐप का कोई काम रोका
const CRITICAL = {
  'csp-block': 'CSP (v9.230) ने ऐप का कोई पता रोका — असली ज़रूरत हो तो index.html की CSP सूची में जोड़ें',
  'storage-full': 'फ़ोन में जगह भर गई — बिना भेजी वसूली ख़तरे में हो सकती है',
  'cache-idb-fail': 'फ़ोन का डेटाबेस (IndexedDB) काम नहीं कर रहा',
  'cache-idb-open': 'फ़ोन का डेटाबेस (IndexedDB) खुला नहीं',
  'cache-idb-load': 'फ़ोन के डेटाबेस से सूचियां नहीं उठीं',
  'upload-lists-missing': 'अपलोड से पहले सूचियां सर्वर से नहीं आईं — रिमार्क/वसूली दबने का ख़तरा',
  'upload-confirm': 'लेजर अपलोड बीच में नाकाम',
  'paid-backup-fail': 'अपलोड में पुरानी वसूली सुरक्षित नहीं हो सकी',
  'pending-old': 'किसी फ़ोन पर घंटों से वसूली/बदलाव सर्वर तक नहीं गए',
  'migration-reverted': 'माइग्रेशन पलटा — डेटा का रूप बदला',
  'migration-revert-unsafe': 'माइग्रेशन पलटना असुरक्षित पाया गया',
  'migration-mixed': 'सूची में पुराना और नया रूप मिला-जुला',
  'array-put-blocked': 'पुराने रूप में पूरी सूची लिखने की कोशिश रोकी गई',
  'je-auth-fail': 'JE का Firebase login नाकाम (पासवर्ड बदला?)',
  'je-auth-missing': 'JE ऐप में है पर Firebase खाता JE वाला नहीं',
  'ledger-cut-save': 'लेजर कट-ऑफ़ सर्वर पर सेव नहीं हुआ',
  'backup': 'ऐप का बैकअप नाकाम',
};
// 🟠 3 या ज़्यादा अलग फ़ोनों से (एक ही दिन) — एक-दो फ़ोन का नेट-झटका शोर है, कई फ़ोन = असली गड़बड़ी
const MULTI_DEVICES = 3;
const MULTI = [
  'save-fail', 'sync-put-fail', 'sync-patch-fail', 'sync-del-fail', 'delete-fail', 'autopay-patch-fail',
  'appcheck-fail', 'js-error', 'promise', 'sse-never-opened', 'reauth-fail', 'reauth-needed',
  'pending-stuck-auth', 'lazy-load-fail', 'auto-logout', 'session-unknown-hq', 'je-auth-retry-fail',
  'cache-idb-slow', 'array-put-noflags', 'save-shape-probe-fail', 'migrate-fail', 'excel-parse',
  'pin-save-fail', 'ph-custom-save-fail', 'pause-save-fail', 'catname-save', 'catrename-partial',
  'catrename-move', 'hsc-publish', 'homebg-upload', 'cash-refresh-partial',
];
// ⚪ कभी alert नहीं — "ठीक हो गया"/एक-बार सफ़ाई/जानकारी वाली
const IGNORE = [
  'appcheck-recovered', 'je-auth-recovered', 'cache-reset', 'cache-prune', 'cut-clean',
  'migration-revert-fixed', 'migration-revert-already', 'migration-revert-empty', 'migration-dup-merged',
  'mig-noacc-skip', 'repeat-mark', 'hsc-conflict', 'cash-refresh-cb', 'cache-init-cb',
];

const TITLE = '🚨 ऐप alert';
const KEY_RE = /<!-- alert-key ([^>]+?) -->/g;

// u = "role|HQ|नाम" — नाम कभी बाहर नहीं, सिर्फ़ HQ
function hqOf(u) { const p = String(u || '').split('|'); return p.length >= 3 ? p[1] : '(login से पहले)'; }

/**
 * logsByDay: { "2026-10-15": { pushId: entry, … }, … }; seen: पहले alert हो चुकी keys (Set)
 * लौटाता है: [{ key, code, day, kind, why, devices, count, hqs, vers }]
 */
function findAlerts(logsByDay, seen) {
  const groups = {};
  for (const day of Object.keys(logsByDay || {})) {
    const d = logsByDay[day] || {};
    for (const id of Object.keys(d)) {
      const e = d[id];
      if (!e || typeof e !== 'object') continue;
      const code = String(e.c || '?');
      if (IGNORE.includes(code)) continue;
      const k = code + '@' + day;
      const g = groups[k] || (groups[k] = { key: k, code, day, devices: new Set(), count: 0, hqs: new Set(), vers: new Set() });
      g.count++;
      g.devices.add(String(e.d || id));
      g.hqs.add(hqOf(e.u));
      g.vers.add(String(e.v || '?'));
    }
  }
  const out = [];
  for (const g of Object.values(groups)) {
    if (seen && seen.has(g.key)) continue;
    let kind, why;
    if (CRITICAL[g.code]) { kind = 'critical'; why = CRITICAL[g.code]; }
    else if (MULTI.includes(g.code)) {
      if (g.devices.size < MULTI_DEVICES) continue;
      kind = 'multi'; why = MULTI_DEVICES + ' या ज़्यादा फ़ोनों पर एक ही गड़बड़ी';
    } else { kind = 'new'; why = 'नई तरह की error — पहले कभी नहीं देखी (scripts/check-alerts.js की सूची में नहीं)'; }
    out.push({ key: g.key, code: g.code, day: g.day, kind, why, devices: g.devices.size, count: g.count,
      hqs: [...g.hqs].sort(), vers: [...g.vers].sort() });
  }
  const rank = { critical: 0, new: 1, multi: 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || b.devices - a.devices || a.key.localeCompare(b.key));
}

// issue/comment का पाठ — कोई नाम/device/संदेश नहीं (repo public)
function renderAlerts(alerts, owner) {
  const icon = { critical: '🔴', new: '🆕', multi: '🟠' };
  const lines = alerts.map((a) => `- ${icon[a.kind]} **\`${a.code}\`** (${a.day} UTC) — ${a.why}\n  ${a.devices} फ़ोन • ${a.count} बार • HQ: ${a.hqs.join(', ')} • version: ${a.vers.join(', ')}`);
  const keys = alerts.map((a) => `<!-- alert-key ${a.key} -->`).join('\n');
  return `${owner ? '@' + owner + ' ' : ''}ऐप के सर्वर-लॉग में ${alerts.length} गंभीर गड़बड़ी:\n\n${lines.join('\n')}\n\n` +
    'पूरा ब्योरा (कौन-सा फ़ोन/लाइनमैन, error संदेश): ऐप → JE मेनू → error log। देखकर Claude को बताएं।\n' +
    'संभल जाए तो यह issue बंद कर दें — अगली नई गड़बड़ी पर नया issue बनेगा।\n\n' + keys;
}

function seenKeys(texts) {
  const s = new Set();
  for (const t of texts) { let m; KEY_RE.lastIndex = 0; while ((m = KEY_RE.exec(String(t || '')))) s.add(m[1]); }
  return s;
}

// ── असली चलना (workflow) ──
const DB_URL = 'https://adegaon-dc-top-50-default-rtdb.firebaseio.com';
const TIMEOUT_MS = 20000;
async function req(url, opts) {
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, Object.assign({ signal: ctrl.signal }, opts));
    if (!r.ok) throw new Error(url.split('?')[0] + ' → HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return r.status === 204 ? null : r.json();
  } finally { clearTimeout(tm); }
}

async function main() {
  const admin = require('firebase-admin');
  const fbTok = (await admin.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)).getAccessToken()).access_token;
  const now = Date.now();
  const days = [0, 1].map((o) => new Date(now - o * 86400000).toISOString().slice(0, 10));
  const logsByDay = {};
  for (const day of days) logsByDay[day] = (await req(`${DB_URL}/LOGS/${day}.json`, { headers: { Authorization: 'Bearer ' + fbTok } })) || {};
  console.log('लॉग पढ़े: ' + days.map((d) => d + ' (' + Object.keys(logsByDay[d]).length + ')').join(', '));

  const repo = process.env.GITHUB_REPOSITORY;
  const gh = (path, opts) => req('https://api.github.com/repos/' + repo + path, Object.assign({}, opts, {
    headers: { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
  }));
  // पिछले alert issues (खुले + बंद, हाल के) — उनमें दर्ज keys दोबारा नहीं
  const issues = ((await gh('/issues?state=all&creator=' + encodeURIComponent('github-actions[bot]') + '&per_page=30')) || [])
    .filter((i) => !i.pull_request && String(i.title).indexOf(TITLE) === 0);
  const texts = [];
  for (const i of issues) {
    texts.push(i.body);
    if (i.comments) for (const c of (await gh('/issues/' + i.number + '/comments?per_page=100')) || []) texts.push(c.body);
  }
  const alerts = findAlerts(logsByDay, seenKeys(texts));
  if (!alerts.length) { console.log('कोई नई गंभीर गड़बड़ी नहीं ✅'); return; }
  const body = renderAlerts(alerts, repo.split('/')[0]);
  const open = issues.find((i) => i.state === 'open');
  if (open) {
    await gh('/issues/' + open.number + '/comments', { method: 'POST', body: JSON.stringify({ body }) });
    console.log(`#${open.number} में ${alerts.length} नई गड़बड़ी जोड़ी`);
  } else {
    const r = await gh('/issues', { method: 'POST', body: JSON.stringify({ title: TITLE + ' — ' + alerts.map((a) => a.code).slice(0, 3).join(', '), body }) });
    console.log(`नया issue #${r.number} (${alerts.length} गड़बड़ी)`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, body + '\n');
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { main, findAlerts, renderAlerts, seenKeys, CRITICAL, MULTI, IGNORE, MULTI_DEVICES };

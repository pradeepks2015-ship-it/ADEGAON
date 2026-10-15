// ── बैकअप से छूटे रिमार्क वापस (JE, 15/10/2026) ───────────────────────────────────────
// 14/10 को दोबारा Replace अपलोड पर कुछ बकायादारों के रिमार्क गए थे; 15/10 के अपलोड से ज़्यादातर लौटे, पर जो
// किसी फ़ोन की copy में भी नहीं बचे थे वो नहीं। यह script साप्ताहिक बैकअप (12/10, .github/workflows/backup.yml)
// से वो रिमार्क लौटाता है। सिर्फ़ हाथ से चलता है: .github/workflows/restore-remarks.yml
//
// नियम (JE का भरोसा इसी पर):
//  - सिर्फ़ जोड़ना: आज का कोई रिमार्क कभी न मिटे, न बदले। बैकअप वाली बात (text) आज पहले से है
//    तो दोबारा नहीं। वसूली/राशि/स्थिति/ts कुछ नहीं छूते — सिर्फ़ remarksArr (और उसका पुराना साथी remarks)
//  - "गिनती" mode (डिफ़ॉल्ट): कुछ नहीं लिखता, सिर्फ़ गिनती। "लिखो" सिर्फ़ JE की Ok के बाद
//  - लौटे रिमार्क पर निशान restored:"backup-<तारीख़>" — ग़लत लगे तो इन्हीं को पहचानकर हटाया जा सकता है
//  - repo public है: लॉग में सिर्फ़ HQ/श्रेणी और गिनती — कोई नाम, Consumer No, रिमार्क नहीं। बैकअप की खुली
//    (बिना ताले की) Excel सिर्फ़ runner की temp जगह में, काम के बाद मिटती है, कभी upload नहीं
//  - हर सूची: पढ़ो → तुरंत लिखो (बीच में कोई लाइनमैन रिमार्क लिखे, उसकी खिड़की कुछ सेकंड)। रात में चलाना बेहतर
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const DB_URL = 'https://adegaon-dc-top-50-default-rtdb.firebaseio.com';
const HQS = ['आदेगांव', 'पिंडरई', 'जोबा', 'पाटन', 'बीबी', 'मढ़ी'];
const CATS_DEFAULT = ['कुल उपभोक्ता', 'घरेलू', 'व्यवसाय', 'कृषि', 'गवर्नमेंट', 'इंडस्ट्रियल', 'सूची-2', 'सूची-3'];
const TIMEOUT_MS = 30000;
const PATCH_CHUNK = 200;

// ऐप वाला ही (js/database.js fbPath, js/config.js hqKey)
function seg(s) { return String(s).replace(/[\s.#$[\]/]/g, '_'); }
function hqKey(hq) { return hq.replace(/[\s.#$[\]/]/g, '_'); }
// backup.js का sheet नाम
function bkSheetName(s) { return String(s).replace(/[[\]:*?/\\]/g, '_').slice(0, 31); }

// बैकअप का "रिमार्क (सभी)" खाना: "text (by) | text (by)" → [{text, by}]
function parseRemarkCell(cell) {
  const s = String(cell == null ? '' : cell).trim();
  if (!s) return [];
  return s.split(' | ').map((part) => {
    const p = part.trim();
    const m = /^([\s\S]*) \(([^()]*)\)$/.exec(p);
    return m ? { text: m[1].trim(), by: m[2].trim() } : { text: p, by: '' };
  }).filter((r) => r.text);
}

// Excel की एक sheet → { acc: [{text,by}] }
function sheetRemarks(rows) {
  const out = {};
  if (!rows || !rows.length) return out;
  const head = rows[0].map((h) => String(h || '').trim());
  const ia = head.indexOf('Consumer No'), ir = head.indexOf('रिमार्क (सभी)');
  if (ia < 0 || ir < 0) return out;
  for (const r of rows.slice(1)) {
    const acc = String(r[ia] == null ? '' : r[ia]).trim();
    const rm = parseRemarkCell(r[ir]);
    if (acc && rm.length) out[acc] = (out[acc] || []).concat(rm);
  }
  return out;
}

function asArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === 'object') return Object.keys(v).map((k) => v[k]).filter(Boolean);
  return [];
}

/**
 * एक सूची की योजना। backupByAcc: { acc: [{text,by}] }; serverRaw: सर्वर पर सूची (array या per-record object)
 * लौटाता है { patch, recs, entries, gone } — patch = Firebase multi-path PATCH (सिर्फ़ <key>/remarksArr, <key>/remarks)
 */
function planList(backupByAcc, serverRaw, cat, tag) {
  const patch = {};
  let recs = 0, entries = 0, gone = 0;
  const byAcc = {};
  if (serverRaw && typeof serverRaw === 'object') {
    for (const k of Object.keys(serverRaw)) {
      const rec = serverRaw[k];
      if (rec && typeof rec === 'object' && rec.acc != null && String(rec.acc).trim()) byAcc[String(rec.acc).trim()] = { key: k, rec };
    }
  }
  for (const acc of Object.keys(backupByAcc || {})) {
    const hit = byAcc[acc];
    if (!hit) { gone++; continue; } // उपभोक्ता आज इस सूची में नहीं — छोड़ो
    const cur = asArr(hit.rec.remarksArr);
    // मिलान सिर्फ़ text से — वही बात आज (किसी के भी नाम से) पहले से है तो दोबारा नहीं; लिखने वाले के नाम में
    // कोष्ठक हों तो बैकअप से नाम अलग करना पक्का नहीं, पर text से मिलान फिर भी सही रहता है
    const have = new Set(cur.map((r) => String(r.text || '').trim()));
    const add = [];
    for (const b of backupByAcc[acc]) {
      const k = b.text;
      if (have.has(k)) continue;
      have.add(k);
      add.push({ text: b.text, by: b.by, at: 'बैकअप ' + tag, cat, restored: 'backup-' + tag });
    }
    if (!add.length) continue;
    const next = add.concat(cur); // बैकअप वाले पुराने — पहले; आज वाले बाद में (सबसे नया आख़िर में, ऐप जैसा)
    patch[hit.key + '/remarksArr'] = next;
    patch[hit.key + '/remarks'] = String(next[next.length - 1].text || '');
    recs++; entries += add.length;
  }
  return { patch, recs, entries, gone };
}

// ── असली चलना (workflow) ──
async function req(url, opts) {
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, Object.assign({ signal: ctrl.signal }, opts));
    if (!r.ok) throw new Error(url.split('?')[0].replace(DB_URL, 'DB') + ' → HTTP ' + r.status);
    return r;
  } finally { clearTimeout(tm); }
}

async function main() {
  const mode = process.env.MODE === 'लिखो' ? 'लिखो' : 'गिनती';
  const before = process.env.BEFORE || '2026-10-14';
  const repo = process.env.GITHUB_REPOSITORY;
  const gh = (p) => req('https://api.github.com/repos/' + repo + p, { headers: { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN, Accept: 'application/vnd.github+json' } });

  // 1) BEFORE से पहले का सबसे नया बैकअप
  const arts = (await (await gh('/actions/artifacts?per_page=100')).json()).artifacts
    .filter((a) => /^adegaon-backup-/.test(a.name) && !a.expired && a.created_at < before)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  if (!arts.length) throw new Error(before + ' से पहले का कोई बैकअप नहीं मिला');
  const art = arts[0];
  const tag = art.created_at.slice(0, 10);
  console.log('बैकअप: ' + art.name + ' (' + art.created_at + ') • mode: ' + mode);

  // 2) उतारो → खोलो (पासवर्ड) → पढ़ो; खुली फ़ाइल सिर्फ़ temp में
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-'));
  let wbData;
  try {
    const zip = Buffer.from(await (await gh('/actions/artifacts/' + art.id + '/zip')).arrayBuffer());
    fs.writeFileSync(path.join(tmp, 'b.zip'), zip);
    execFileSync('unzip', ['-q', '-o', path.join(tmp, 'b.zip'), '-d', tmp]);
    const locked = fs.readdirSync(tmp).find((f) => f.endsWith('.xlsx'));
    if (!locked) throw new Error('बैकअप zip में .xlsx नहीं');
    const plain = path.join(tmp, 'plain.xlsx');
    execFileSync('python3', ['-c', 'import os,sys\nfrom msoffcrypto import OfficeFile\nf=OfficeFile(open(sys.argv[1],"rb"))\nf.load_key(password=os.environ["BACKUP_PASSWORD"])\nf.decrypt(open(sys.argv[2],"wb"))', path.join(tmp, locked), plain]);
    const XLSX = require('xlsx');
    const wb = XLSX.readFile(plain);
    wbData = {};
    for (const n of wb.SheetNames) wbData[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // 3) Firebase
  const admin = require('firebase-admin');
  const tok = (await admin.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)).getAccessToken()).access_token;
  const fb = (p, opts) => req(DB_URL + '/' + p + '.json', Object.assign({}, opts, { headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' } }));
  const catNames = (await (await fb('CAT_NAMES')).json()) || {};

  const used = new Set();
  let tRecs = 0, tEntries = 0, tGone = 0;
  const lines = [];
  for (const hq of HQS) {
    for (let i = 0; i < CATS_DEFAULT.length; i++) {
      const cn = catNames[hqKey(hq)];
      const cat = i >= 4 && cn && cn[i] != null ? cn[i] : CATS_DEFAULT[i];
      const sn = bkSheetName(hq + '_' + cat);
      if (!wbData[sn]) continue;
      used.add(sn);
      const bk = sheetRemarks(wbData[sn]);
      if (!Object.keys(bk).length) continue;
      const p = seg(hq) + '/' + seg(cat);
      const server = await (await fb(p)).json();
      const plan = planList(bk, server, cat, tag);
      tGone += plan.gone;
      if (!plan.recs) continue;
      tRecs += plan.recs; tEntries += plan.entries;
      lines.push(`${hq} / ${cat}: ${plan.recs} उपभोक्ता, ${plan.entries} रिमार्क`);
      if (mode === 'लिखो') {
        const keys = Object.keys(plan.patch);
        for (let s = 0; s < keys.length; s += PATCH_CHUNK * 2) {
          const part = {};
          for (const k of keys.slice(s, s + PATCH_CHUNK * 2)) part[k] = plan.patch[k];
          await fb(p, { method: 'PATCH', body: JSON.stringify(part) });
        }
      }
    }
  }
  const skipped = Object.keys(wbData).filter((n) => !used.has(n) && n !== 'सारांश' && n !== 'डिस्प्ले बोर्ड').length;
  const summary = [
    `## बैकअप से रिमार्क — ${mode === 'लिखो' ? '✍️ लिखे गए' : '🔢 सिर्फ़ गिनती (कुछ नहीं लिखा)'}`,
    `बैकअप: ${tag} • कुल **${tRecs} उपभोक्ता, ${tEntries} रिमार्क** ${mode === 'लिखो' ? 'लौटाए' : 'लौटेंगे'}`,
    '', ...lines.map((l) => '- ' + l), '',
    `बैकअप के ${tGone} रिमार्क-वाले उपभोक्ता आज उस सूची में नहीं (छोड़े) • मेल न खाती sheets: ${skipped}`,
  ].join('\n');
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
}

if (require.main === module) main().catch((e) => { console.error(String(e && e.message || e)); process.exit(1); });
module.exports = { main, parseRemarkCell, sheetRemarks, planList, bkSheetName, seg };

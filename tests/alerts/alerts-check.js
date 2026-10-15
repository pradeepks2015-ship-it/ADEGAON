// ── अपने-आप alert (scripts/check-alerts.js) की जांच ──
// alert ज़्यादा आए तो JE उन्हें अनदेखा करने लगेंगे, कम आए तो असली गड़बड़ी छूटेगी — इसलिए नक़ली लॉग पर:
// क्या alert बने, क्या न बने, दोबारा न आए, और issue में कोई नाम/device/संदेश न जाए (repo public)।
// साथ ही: js/ का हर logErr("…") नाम तीन सूचियों में से किसी एक में हो (नया नाम जोड़ें तो वहां भी)।
// चलाना: npm run test:alerts   (CI lint job में भी)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const { findAlerts, renderAlerts, seenKeys, CRITICAL, MULTI, IGNORE, MULTI_DEVICES } = require(path.join(ROOT, 'scripts', 'check-alerts.js'));

let n = 0;
function e(c, dev, extra) {
  return Object.assign({ t: '2026-10-15T09:00:00Z', v: '9.230', u: 'lineman|पाटन|रामू यादव', d: dev, c, m: 'गुप्त संदेश 98765', x: 'आदेगांव/घरेलू' }, extra);
}
function day(...entries) { const o = {}; for (const x of entries) o['-id' + (n++)] = x; return o; }

test('एक फ़ोन का नेट-झटका और "ठीक हो गया" वाली — कोई alert नहीं', () => {
  const logs = { '2026-10-15': day(e('appcheck-fail', 'a'), e('appcheck-recovered', 'a'), e('cache-reset', 'b'), e('save-fail', 'a'), e('save-fail', 'b')) };
  assert.deepStrictEqual(findAlerts(logs, new Set()), []);
});

test(`वही गड़बड़ी ${MULTI_DEVICES}+ अलग फ़ोनों पर → 🟠 alert (एक फ़ोन बार-बार = एक ही गिना)`, () => {
  const logs = { '2026-10-15': day(e('save-fail', 'a'), e('save-fail', 'a'), e('save-fail', 'a'), e('save-fail', 'b')) };
  assert.deepStrictEqual(findAlerts(logs, new Set()), [], 'दो ही फ़ोन — alert नहीं');
  logs['2026-10-15']['-x'] = e('save-fail', 'c', { u: 'lineman|जोबा|श्याम' });
  const a = findAlerts(logs, new Set());
  assert.strictEqual(a.length, 1);
  assert.deepStrictEqual([a[0].kind, a[0].code, a[0].devices, a[0].count, a[0].hqs], ['multi', 'save-fail', 3, 5, ['जोबा', 'पाटन']]);
});

test('गंभीर (csp-block, storage-full…) एक बार भी → 🔴; अनजाना नाम → 🆕; क्रम: 🔴, 🆕, 🟠', () => {
  const logs = {
    '2026-10-15': day(e('csp-block', 'a'), e('बिल्कुल-नई-error', 'b'), e('js-error', 'a'), e('js-error', 'b'), e('js-error', 'c')),
    '2026-10-14': day(e('storage-full', 'z', { u: '(login से पहले)' })),
  };
  const a = findAlerts(logs, new Set());
  assert.deepStrictEqual(a.map((x) => x.kind + ':' + x.code), ['critical:csp-block', 'critical:storage-full', 'new:बिल्कुल-नई-error', 'multi:js-error']);
  assert.deepStrictEqual(a[1].hqs, ['(login से पहले)']);
});

test('जो पहले alert हो चुकी (वही error + दिन) — दोबारा नहीं; अगले दिन फिर आए तो फिर', () => {
  const logs = { '2026-10-15': day(e('csp-block', 'a')) };
  const first = findAlerts(logs, new Set());
  const body = renderAlerts(first, 'je');
  assert.deepStrictEqual(findAlerts(logs, seenKeys(['कुछ और', body])), []);
  logs['2026-10-16'] = day(e('csp-block', 'a'));
  assert.deepStrictEqual(findAlerts(logs, seenKeys([body])).map((x) => x.key), ['csp-block@2026-10-16']);
});

test('issue के पाठ में लाइनमैन का नाम, device-id, error संदेश नहीं (repo public) — पर JE का @ और HQ हां', () => {
  const logs = { '2026-10-15': day(e('storage-full', 'devSECRET1'), e('csp-block', 'devSECRET2')) };
  const body = renderAlerts(findAlerts(logs, new Set()), 'pradeepks2015-ship-it');
  for (const bad of ['रामू', 'devSECRET', 'गुप्त', '98765', 'घरेलू']) assert.ok(!body.includes(bad), 'issue में "' + bad + '" नहीं होना चाहिए');
  assert.ok(body.startsWith('@pradeepks2015-ship-it '));
  assert.ok(body.includes('पाटन') && body.includes('`storage-full`') && body.includes('9.230'));
});

test('ख़राब/ख़ाली लॉग से न टूटे', () => {
  assert.deepStrictEqual(findAlerts({ '2026-10-15': null, '2026-10-14': { a: 'टेक्स्ट', b: null } }, new Set()), []);
  assert.deepStrictEqual(findAlerts({}, null), []);
});

test('js/ का हर logErr("…") नाम तीन सूचियों में से ठीक एक में', () => {
  const lists = [Object.keys(CRITICAL), MULTI, IGNORE];
  const all = lists.flat();
  assert.strictEqual(new Set(all).size, all.length, 'कोई नाम दो सूचियों में');
  const used = new Set();
  for (const f of fs.readdirSync(path.join(ROOT, 'js'))) {
    if (!f.endsWith('.js')) continue;
    for (const m of fs.readFileSync(path.join(ROOT, 'js', f), 'utf8').matchAll(/logErr\(\s*"([a-z0-9-]+)"/g)) used.add(m[1]);
  }
  assert.ok(used.size > 50, 'logErr नाम मिले ही नहीं — खोज टूटी?');
  const missing = [...used].filter((c) => !all.includes(c));
  assert.deepStrictEqual(missing, [], 'scripts/check-alerts.js की किसी सूची (CRITICAL/MULTI/IGNORE) में जोड़ें');
});

// @ts-check
/* global firebase */
// वसूली ट्रैकर — पूरा ऐप Firebase के नक़ली सर्वर (emulator) पर: असली login (Firebase Auth) + असली database + असली rules
// बाक़ी सारे टेस्ट में Firebase बंद रहता है (ताकि असली डेटा कभी न छुए) — इसलिए "सही PIN से login → वसूली सर्वर पर
// पहुंची", "ग़लत PIN पर मना", "JE का अपलोड सर्वर पर" जैसा पूरा रास्ता कभी नहीं जांचा जाता था। यहां वही ऐप, वही
// Firebase SDK (.e2e-sdk/ — index.html वाला ही version, scripts/fetch-firebase-sdk.js), बस सर्वर emulator है। असली Firebase कभी नहीं
// छूता: project "demo-…" है और हर बाहरी request बंद। App Check emulator में नहीं होता — वह यहां बंद रहता है।
// चलाना: npm run test:e2e   (Java + firebase-tools; CI में "e2e-firebase" job)। सामान्य suite में यह फ़ाइल skip होती है
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const E2E = !!process.env.FIREBASE_E2E;
// v9.230: index.html की CSP में login emulator (http://127.0.0.1:9099) नहीं — असली ऐप उसे कभी नहीं छूता। CSP की
// अपनी जांच tests/boot-ui.spec.js "CSP और integrity" में; यहां सिर्फ़ Firebase के असली रास्ते (integrity वाली library समेत)
test.use({ bypassCSP: true });
const PROJECT = 'demo-adegaon-e2e';
const NS = PROJECT + '-default-rtdb';
const DB = 'http://127.0.0.1:9000';
const AUTH = 'http://127.0.0.1:9099';
const ROOT = path.join(__dirname, '..');
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, 'database.rules.json'), 'utf8')).rules;
const JE_EMAIL = /auth\.token\.email === '([^']+)'/.exec(RULES.HQ_PIN['.read'])[1];
const HQ_UID = /auth\.uid === '([^']+)'/.exec(RULES['आदेगांव']['.write'])[1];
const HQ_EMAIL = /"आदेगांव"\s*:\s*"([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8'))[1];
const PIN = '246810';
const JE_PW = 'e2e-JE-pass#1';
const SDK_VER = /firebasejs\/([\d.]+)\/firebase-app-compat/.exec(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'))[1];

test.skip(!E2E, 'सिर्फ़ npm run test:e2e (emulator) में');
test.describe.configure({ mode: 'serial' }); // एक ही emulator — टेस्ट बारी-बारी

async function admin(method, p, body) {
  const r = await fetch(DB + '/' + encodeURI(p) + '.json?ns=' + NS, {
    method, headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return r.json();
}
async function makeUser(localId, email, password) {
  const r = await fetch(AUTH + '/identitytoolkit.googleapis.com/v1/projects/' + PROJECT + '/accounts', {
    method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ localId, email, password }),
  });
  if (!r.ok) throw new Error('user नहीं बना: ' + (await r.text()));
}

test.beforeAll(async () => {
  expect(fs.readFileSync(path.join(ROOT, '.e2e-sdk', 'VERSION'), 'utf8')).toBe(SDK_VER); // वही SDK जो ऐप चलाता है (scripts/fetch-firebase-sdk.js)
  await fetch(AUTH + '/emulator/v1/projects/' + PROJECT + '/accounts', { method: 'DELETE' });
  await makeUser(HQ_UID, HQ_EMAIL, 'vasuli-' + PIN);
  await makeUser('je-uid', JE_EMAIL, JE_PW);
});
test.beforeEach(async () => {
  await admin('PUT', '', {
    'आदेगांव': { 'कुल_उपभोक्ता': [ // सर्वर पर रास्ता fbPath() वाला — space की जगह _
      { acc: '7001', name: 'रामलाल पटेल', amount: 1200, status: 'pending' },
      { acc: '7002', name: 'श्याम यादव', amount: 800, status: 'pending' },
    ] },
  });
});

/** @param {import('@playwright/test').Page} page */
async function openOnEmulator(page) {
  // बाक़ी सब बाहर बंद — पहले लगाना ज़रूरी: Playwright में बाद में लगा route पहले चलता है, यानी नीचे वाले इससे ऊपर
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  // index.html वाली Firebase library → .e2e-sdk/ की वही फ़ाइलें (बाहर से कुछ नहीं)
  await page.route(/gstatic\.com\/firebasejs\/[\d.]+\/(firebase-[a-z-]+-compat\.js)$/, (r) => {
    const f = /\/(firebase-[a-z-]+-compat\.js)$/.exec(r.request().url())[1];
    return r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, '.e2e-sdk', f), 'utf8') });
  });
  // ऐप का Firebase सेटअप: project demo वाला, login emulator पर, App Check बंद (emulator में नहीं होता)
  await page.route(/\/js\/firebase\.js(\?|$)/, async (r) => {
    let src = fs.readFileSync(path.join(ROOT, 'js', 'firebase.js'), 'utf8');
    src = src.replace(/projectId:\s*"[^"]+"/, 'projectId: "' + PROJECT + '"')
      .replace('firebase.initializeApp(firebaseConfig);', 'firebase.initializeApp(firebaseConfig); firebase.auth().useEmulator("' + AUTH + '",{disableWarnings:true});')
      .replace(/firebase\.appCheck\(\)\.activate\([^;]*;/, 'throw new Error("e2e: App Check बंद");');
    if (!/useEmulator/.test(src) || !/e2e: App Check/.test(src)) throw new Error('firebase.js बदल गई — e2e का जोड़ फिर से देखें');
    return r.fulfill({ status: 200, contentType: 'application/javascript', body: src });
  });
  // Realtime Database की REST मांगें → emulator (namespace के साथ)। लाइव-sync (stream) यहां नहीं — ऐप ख़ुद संभालता है
  await page.route(/^https:\/\/[a-z0-9-]+\.firebaseio\.com\//, async (r) => {
    const req = r.request();
    if (/event-stream/.test(req.headers()['accept'] || '')) return r.abort();
    const u = new URL(req.url());
    u.protocol = 'http:'; u.host = '127.0.0.1:9000'; u.searchParams.set('ns', NS);
    const resp = await r.fetch({ url: u.toString() });
    return r.fulfill({ response: resp, headers: Object.assign({}, resp.headers(), { 'access-control-allow-origin': '*' }) });
  });
  await page.addInitScript(() => { try { localStorage.setItem('dc_listsort', 'ledger'); } catch (e) {} });
  await page.goto('/');
  await page.waitForFunction(() => document.getElementById('login-screen').classList.contains('active'), null, { timeout: 20000 });
  await page.waitForFunction(() => typeof AUTH_READY !== 'undefined' && AUTH_READY, null, { timeout: 20000 });
}
/** @param {import('@playwright/test').Page} page */
async function lineLogin(page, pin) {
  await page.click('#rc-lin');
  await page.fill('#uname-inp', 'e2e लाइनमैन');
  await page.selectOption('#hq-sel', 'आदेगांव');
  await page.fill('#lin-pin', pin);
  await page.click('.login-btn');
}

test('लाइनमैन: सही PIN → असली login (HQ खाता) → वसूली सर्वर पर पहुंचे', async ({ page }) => {
  await openOnEmulator(page);
  await lineLogin(page, PIN);
  await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'), null, { timeout: 20000 });
  expect(await page.evaluate(() => firebase.auth().currentUser && firebase.auth().currentUser.email)).toBe(HQ_EMAIL);
  const reqs = [];
  page.on('requestfinished', async (rq) => { if (/firebaseio/.test(rq.url())) { const rs = await rq.response(); reqs.push(rq.method() + ' ' + decodeURIComponent(rq.url()).slice(0, 140) + ' → ' + (rs && rs.status())); } });
  page.on('requestfailed', (rq) => { if (/firebaseio/.test(rq.url())) reqs.push('FAIL ' + decodeURIComponent(rq.url()).slice(0, 140)); });
  try { await expect(page.locator('.con-card').first()).toContainText('रामलाल', { timeout: 20000 }); } catch (e) {
    const logs = await page.evaluate(() => getLogs().map((l) => l.c + ': ' + l.m + ' ' + l.x));
    throw new Error('DIAG ' + JSON.stringify({ reqs, logs }, null, 1) + '\n' + e.message, { cause: e });
  }
  await page.evaluate(() => markPaid(0, '7001'));
  await expect.poll(async () => {
    const d = await admin('GET', 'आदेगांव/कुल_उपभोक्ता');
    const list = Array.isArray(d) ? d : Object.values(d || {});
    return (list.find((x) => x && x.acc === '7001') || {}).status;
  }, { timeout: 20000 }).toBe('paid');
  expect(await page.evaluate(() => Object.keys(getPending()).length)).toBe(0); // कतार में कुछ अटका नहीं
});

test('लाइनमैन: ग़लत PIN → अंदर न जाने दे, सर्वर का डेटा न बदले', async ({ page }) => {
  await openOnEmulator(page);
  await lineLogin(page, '999999');
  await page.waitForTimeout(3000);
  const s = await page.evaluate(() => ({ app: document.getElementById('app-screen').classList.contains('active'), cu: !!CU }));
  expect(s).toEqual({ app: false, cu: false });
});

test('लाइनमैन का खाता दूसरे HQ का डेटा न पढ़ सके (असली login token से)', async ({ page }) => {
  await admin('PUT', 'पिंडरई/कुल_उपभोक्ता', [{ acc: '8001', name: 'दूसरे HQ का', amount: 1, status: 'pending' }]);
  await openOnEmulator(page);
  await lineLogin(page, PIN);
  await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'), null, { timeout: 20000 });
  const st = await page.evaluate(() => _fbFetchWithAuth(FB + '/' + fbPath('पिंडरई', 'कुल उपभोक्ता') + '.json').then((r) => r.status));
  expect([401, 403]).toContain(st);
});

test('JE: असली login → लेजर अपलोड सर्वर पर पहुंचे', async ({ page }) => {
  await openOnEmulator(page);
  await page.click('#rc-sup');
  await page.fill('#uname-inp', 'e2e JE');
  await page.fill('#sup-pw', JE_PW);
  await page.click('.login-btn');
  await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'), null, { timeout: 20000 });
  expect(await page.evaluate(() => firebase.auth().currentUser && firebase.auth().currentUser.email)).toBe(JE_EMAIL);
  await page.evaluate(() => lazyLoad('js/upload.js')); // अपलोड वाली फ़ाइल ज़रूरत पर उतरती है (js/lazy.js)
  await page.evaluate(() => {
    openUpModal();
    document.getElementById('up-hq').value = 'जोबा';
    document.getElementById('up-cat').value = 'कुल उपभोक्ता';
    setUpMode('replace');
    parsedRows = [{ acc: '9001', name: 'नया लेजर', amount: 450, status: 'pending', remarksArr: [] }];
    window.__askAuto = () => true; // v9.236: अपलोड की चेतावनी ऐप के अपने डिब्बे (appAsk) में — "हां"
    confirmUpload();
  });
  await expect.poll(async () => {
    const d = await admin('GET', 'जोबा/कुल_उपभोक्ता');
    const list = Array.isArray(d) ? d : Object.values(d || {});
    return list.map((x) => x && x.acc).filter(Boolean).join(',');
  }, { timeout: 20000 }).toBe('9001');
  // v9.223: अपलोड की कट-ऑफ़ सर्वर पर (JE लिख सके — असली rules से)
  await expect.poll(async () => admin('GET', 'LEDGER_CUT/जोबा'), { timeout: 20000 }).toBeGreaterThan(20200101);
});

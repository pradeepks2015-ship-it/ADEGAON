// ── असली service worker के साथ (बाक़ी सारे टेस्ट में SW बंद रहता है — playwright.config.js) ──
// sw.js ही ऐप को बिना नेट खुलवाता है, धीमे नेट पर फ़ोन की कॉपी से चलाता है (v9.211) और नया version
// लाता है। अब तक उसकी जांच सिर्फ़ नक़ली scope में होती थी (app-shell.spec.js)। यहां असली Chromium में
// SW चालू करके वही तीन बातें देखी जाती हैं। हर टेस्ट का अपना context (अपनी cache), बाक़ियों पर असर नहीं।
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test.use({ serviceWorkers: 'allow' });

// बाहर की साइटें: Firebase SDK की जगह ख़ाली script (SW install के CORE में हैं — न मिलें तो install
// नाकाम), बाक़ी सब बंद। असली Firebase कभी नहीं छुआ जाता
async function stubExternal(context) {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => {
    if (/gstatic\.com\/firebasejs\/.*\.js$/.test(route.request().url())) {
      return route.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: '' });
    }
    return route.abort();
  });
}
async function swReady(page) {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  // clients.claim के बाद यह पन्ना SW के क़ब्ज़े में
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20000 }).toBe(true);
  // v9.214: पहली बार क़ब्ज़ा लेना "नया version" नहीं — पट्टी नहीं आनी चाहिए
  await page.waitForTimeout(300);
  await expect(page.locator('#update-banner')).toHaveCount(0);
}

test('असली SW: install होते ही बिना नेट भी ऐप खुले (login पन्ना, सारी scripts)', async ({ page, context }) => {
  await stubExternal(context);
  await swReady(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#login-screen')).toBeAttached();
  expect(await page.evaluate(() => typeof renderListWith === 'function' && typeof flushPending === 'function' && typeof APP_VER)).toBe('string');
  await context.setOffline(false);
});

test('असली SW (v9.211): अपनी फ़ाइलें फ़ोन की कॉपी से — दोबारा खोलने पर सर्वर से js/css नहीं मांगी जातीं', async ({ page, context }) => {
  await stubExternal(context);
  await swReady(page);
  // SW के ज़रिए पूरी हुई request का जवाब "fromServiceWorker" होता है — नेट से नहीं
  const fromSW = [];
  page.on('response', (r) => { if (/127\.0\.0\.1:8080\/js\/list\.js/.test(r.url())) fromSW.push(r.fromServiceWorker()); });
  await page.reload();
  await expect(page.locator('#login-screen')).toBeAttached();
  expect(fromSW).toEqual([true]);
});

// नया version: Playwright SW की sw.js वाली मांग नहीं पकड़ पाता, इसलिए इस टेस्ट का अपना छोटा सर्वर —
// repo की फ़ाइलें वैसे ही, बस sw.js की सामग्री टेस्ट बीच में बदल सकता है (असली deploy जैसा)
const http = require('http');
const ROOT = path.join(__dirname, '..');
const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg' };
function startServer(state) {
  return new Promise((resolve) => {
    const srv = http.createServer((q, r) => {
      let f = decodeURIComponent(q.url.split('?')[0]);
      if (f.endsWith('/')) f += 'index.html';
      if (f === '/sw.js') { r.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' }); r.end(state.sw); return; }
      if (f === '/rollout.json' && state.rollout !== undefined) { if (state.rollout === null) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(state.rollout)); } return; }
      const fp = path.join(ROOT, f);
      if (!fp.startsWith(ROOT)) { r.writeHead(403); r.end(); return; }
      fs.readFile(fp, (e, d) => {
        if (e) { r.writeHead(404); r.end(); return; }
        r.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream' }); r.end(d);
      });
    }).listen(0, '127.0.0.1', () => resolve(srv));
  });
}

test('असली SW: नया version (sw.js बदला) — install होकर "नया version आ गया" पट्टी आए, नई cache में सारी फ़ाइलें', async ({ page, context }) => {
  const src = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const state = { sw: src, rollout: { waitMin: 0 } }; // v9.231: बिना इंतज़ार (canary की जांच नीचे अलग)
  const srv = await startServer(state);
  try {
    await stubExternal(context);
    const base = 'http://127.0.0.1:' + srv.address().port + '/';
    await page.goto(base);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20000 }).toBe(true);
    await expect(page.locator('#update-banner')).toHaveCount(0); // पहली बार — पट्टी नहीं (v9.214)
    // deploy: नया CACHE_NAME
    state.sw = src.replace(/var CACHE_NAME="([^"]+)";/, 'var CACHE_NAME="$1-next";');
    expect(state.sw).not.toBe(src);
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
    await expect(page.locator('#update-banner')).toBeVisible({ timeout: 20000 });
    const keys = await page.evaluate(() => caches.keys());
    expect(keys.some((k) => /-next$/.test(k))).toBe(true);
    // नया SW अब नई cache से — अगली बार खोलने पर नई फ़ाइलें। (पुरानी cache का नाम कभी-कभी कुछ देर रह जाता है:
    // पुराना SW उसी पल चल रही कोई request उसमें रख देता है — अगले version के activate पर वह भी हटती है)
    await page.reload();
    expect(await page.evaluate(() => caches.keys().then((ks) => Promise.all(ks.map((k) => caches.open(k).then((c) => c.match('./js/list.js')).then((m) => [k, !!m])))))).toContainEqual([keys.find((k) => /-next$/.test(k)), true]);
  } finally {
    srv.close();
  }
});

// ── v9.231: "पहले JE, फिर सब" (sw.js का _canaryGate) ──
// लाइनमैन फ़ोन: नया sw.js पहली बार दिखे तो मना (पुराना चलता रहे), waitMin बाद उतरे; JE फ़ोन: तुरंत;
// hold: कभी नहीं; पहली बार ऐप खुलना: रोक नहीं। "समय बीता" = dc-role में "पहली बार दिखा" को पीछे करना
async function canaryOpen(page, context, state) {
  const srv = await startServer(state);
  await stubExternal(context);
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  await page.goto(base);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20000 }).toBe(true);
  return srv;
}
const nextSw = (src) => src.replace(/var CACHE_NAME="([^"]+)";/, 'var CACHE_NAME="$1-next";');
const hasNext = (page) => page.evaluate(() => caches.keys().then((ks) => ks.some((k) => /-next$/.test(k))));
const seenKeys = (page) => page.evaluate(() => caches.open('dc-role').then((c) => c.keys()).then((ks) => ks.map((q) => q.url.split('/').pop())));
const tryUpdate = (page) => page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()).then(() => 'ok', (e) => 'मना: ' + e.message));

test('canary: लाइनमैन फ़ोन — नया version पहले मना (पुराना चले), 10 मिनट बाद उतरे', async ({ page, context }) => {
  const src = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const state = { sw: src, rollout: { waitMin: 10 } };
  const srv = await canaryOpen(page, context, state); // पहली बार — रोक नहीं (controller बन गया)
  try {
    state.sw = nextSw(src);
    await tryUpdate(page);
    await expect.poll(() => seenKeys(page), { timeout: 15000 }).toContainEqual(expect.stringMatching(/^seen-.*-next$/));
    await page.waitForTimeout(1500);
    expect(await hasNext(page)).toBe(false);
    await expect(page.locator('#update-banner')).toHaveCount(0);
    // पुराना version बिना रुकावट
    await page.reload();
    await expect(page.locator('#login-screen')).toBeAttached();
    // 11 मिनट बीते
    await page.evaluate(() => caches.open('dc-role').then((c) => c.keys().then((ks) => Promise.all(ks.filter((q) => /seen-/.test(q.url)).map((q) => c.put(q, new Response(String(Date.now() - 11 * 60000))))))));
    await tryUpdate(page);
    await expect(page.locator('#update-banner')).toBeVisible({ timeout: 20000 });
    expect(await hasNext(page)).toBe(true);
  } finally { srv.close(); }
});

test('canary: JE फ़ोन (JE login का निशान) — नया version तुरंत; hold पर भी', async ({ page, context }) => {
  const src = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const state = { sw: src, rollout: { waitMin: 10, hold: true } };
  const srv = await canaryOpen(page, context, state);
  try {
    await page.evaluate(() => markJeDevice()); // वही function जो JE login पर चलता है (js/reports.js)
    await expect.poll(() => seenKeys(page)).toContain('je-device');
    state.sw = nextSw(src);
    await tryUpdate(page);
    await expect(page.locator('#update-banner')).toBeVisible({ timeout: 20000 });
    expect(await hasNext(page)).toBe(true);
    expect(await seenKeys(page)).toContain('je-device'); // नए SW के activate ने JE का निशान नहीं मिटाया
  } finally { srv.close(); }
});

test('canary: hold — लाइनमैन फ़ोन पर समय बीतने पर भी नहीं; rollout.json न मिले तो डिफ़ॉल्ट 10 मिनट (अटके नहीं)', async ({ page, context }) => {
  const src = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const state = { sw: src, rollout: { waitMin: 0, hold: true } };
  const srv = await canaryOpen(page, context, state);
  try {
    state.sw = nextSw(src);
    await tryUpdate(page);
    await page.waitForTimeout(2500);
    expect(await hasNext(page)).toBe(false);
    await expect(page.locator('#update-banner')).toHaveCount(0);
    // rollout.json ग़ायब: पहली बार मना + समय नोट, 11 मिनट बाद उतरे
    state.rollout = null;
    await tryUpdate(page);
    await expect.poll(() => seenKeys(page), { timeout: 15000 }).toContainEqual(expect.stringMatching(/^seen-.*-next$/));
    await page.waitForTimeout(1500);
    expect(await hasNext(page)).toBe(false);
    await page.evaluate(() => caches.open('dc-role').then((c) => c.keys().then((ks) => Promise.all(ks.filter((q) => /seen-/.test(q.url)).map((q) => c.put(q, new Response(String(Date.now() - 11 * 60000))))))));
    await tryUpdate(page);
    await expect(page.locator('#update-banner')).toBeVisible({ timeout: 20000 });
  } finally { srv.close(); }
});

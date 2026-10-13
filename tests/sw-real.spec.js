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
  const state = { sw: src };
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

// @ts-check
// वसूली ट्रैकर — टेस्ट: app-shell (साझा helpers: tests/helpers.js)
const { test, lazyTest, expect, fs, path, LAZY_FILES, openApp, loginLineman, loginJE } = require('./helpers');

test.describe('अपडेट बैनर — नया version आने पर रीलोड prompt', () => {
  test('_showUpdateBanner — बैनर दिखता है, दोबारा बुलाने पर डुप्लीकेट नहीं बनता, बटन रीलोड करता है', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      _showUpdateBanner();
      _showUpdateBanner(); // दोबारा — डुप्लीकेट नहीं बनना चाहिए
      const banners = document.querySelectorAll('#update-banner');
      const btn = document.getElementById('update-banner-btn');
      return { count: banners.length, text: document.getElementById('update-banner').textContent, hasBtn: !!btn, hasOnclick: typeof btn.onclick === 'function' };
    });
    expect(r.count).toBe(1);
    expect(r.text).toContain('नया version');
    expect(r.hasBtn).toBe(true);
    expect(r.hasOnclick).toBe(true);
  });

  test('_swSetupAutoUpdate — tab वापस visible होने पर reg.update() ख़ुद बुलाया जाए (browser के अपने-आप घंटों बाद जांचने का इंतज़ार न करना पड़े)', async ({ page }) => {
    await openApp(page);
    const called = await page.evaluate(() => {
      return new Promise((resolve) => {
        _pendingUpdate = false; // नया handler: pending update होने पर reload — यहां यही जांचना नहीं है
        var updateCalls = 0;
        var fakeReg = { update: function () { updateCalls++; return Promise.resolve(); } };
        _swSetupAutoUpdate(fakeReg);
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        setTimeout(function () { resolve(updateCalls); }, 50);
      });
    });
    expect(called).toBeGreaterThan(0);
  });
});

test.describe('PWA installable — manifest + icons', () => {
  test('_headers — sw.js/index.html कभी भी browser/CDN/मोबाइल-नेटवर्क से cache न हों (bug: device पुराने version पर हमेशा के लिए अटक जाना)', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', '_headers'), 'utf8');
    const noCacheFor = (route) => {
      const idx = content.indexOf(route + '\n');
      expect(idx, route + ' के लिए _headers में rule होना चाहिए').toBeGreaterThan(-1);
      const block = content.slice(idx, idx + 200);
      expect(block).toMatch(/Cache-Control:\s*no-cache/);
    };
    noCacheFor('/sw.js');
    noCacheFor('/index.html');
  });

  test('sw.js — Excel/CSV वाली भारी vendor लाइब्रेरी (862KB xlsx) eager-precache list में न हों (bug: हर version-update पर हर device बेवजह दोबारा डाउनलोड करता, चाहे कभी इस्तेमाल हो या न हो)', () => {
    const swContent = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
    const cdnBlock = swContent.slice(swContent.indexOf('var CORE='), swContent.indexOf('];') + 2);
    expect(cdnBlock).not.toContain('vendor/xlsx');
    expect(cdnBlock).not.toContain('vendor/papaparse');
    // पर lazy-load वाला रास्ता (js/storage.js: ensureLibs) अब भी सही जगह से लोड करता हो
    const storageContent = fs.readFileSync(path.join(__dirname, '..', 'js', 'storage.js'), 'utf8');
    expect(storageContent).toContain('vendor/xlsx.full.min.js');
    expect(storageContent).toContain('vendor/papaparse.min.js');
  });

  // असली production (v9.127 के deploy के दौरान): "setSyncStatus is not defined" — सर्वर ने
  // js/ui-core.js के बदले कोई ग़लत जवाब (404/5xx) दिया और service worker उसे ज्यों का त्यों
  // script बनाकर लौटा देता था, इसलिए उस फ़ाइल का कोई function बनता ही नहीं। नीचे वाला catch
  // सिर्फ़ network *टूटने* पर चलता है, ग़लत status पर नहीं — यही छेद था।
  // यहाँ sw.js का असली fetch-handler एक नक़ली scope में चलाकर उसका व्यवहार जांचा जाता है
  // (सिर्फ़ source में शब्द ढूंढना काफ़ी नहीं — वह असल बर्ताव नहीं बताता)
  test('sw.js — सर्वर ग़लत जवाब (404/5xx) दे तो cache वाली सही प्रति मिले, error-पन्ना script बनकर न चले', async () => {
    const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
    // नक़ली service-worker दुनिया
    function run(netRes, cached, mode) {
      let handler = null, answered = null;
      const scope = {
        addEventListener: (t, fn) => { if (t === 'fetch') handler = fn; },
        skipWaiting: () => Promise.resolve(),
        clients: { claim: () => Promise.resolve() },
      };
      const cachesStub = {
        open: () => Promise.resolve({ put: () => Promise.resolve(), add: () => Promise.resolve() }),
        keys: () => Promise.resolve([]),
        match: (req) => Promise.resolve(cached[typeof req === 'string' ? req : req.url] || undefined),
      };
      new Function('self', 'caches', 'fetch', swSrc)(scope, cachesStub,
        () => (netRes instanceof Error ? Promise.reject(netRes) : Promise.resolve(netRes)));
      handler({
        request: { url: 'https://x/js/ui-core.js', method: 'GET', mode: mode || 'no-cors' },
        respondWith: (p) => { answered = p; },
      });
      return answered;
    }
    const good = { ok: true, body: 'सही script', clone: () => ({}) };
    const bad = { ok: false, status: 404, body: 'ग़लत — error पन्ना' };
    const cachedCopy = { ok: true, body: 'cache वाली सही प्रति' };

    // 1. ठीक जवाब — वही मिले
    expect((await run(good, {})).body).toBe('सही script');
    // 2. ग़लत status पर cache वाली सही प्रति मिले (यही असली fix है)
    expect((await run(bad, { 'https://x/js/ui-core.js': cachedCopy })).body).toBe('cache वाली सही प्रति');
    // 3. cache में भी कुछ न हो — तब असली जवाब लौटे (चुपचाप undefined नहीं)
    expect((await run(bad, {})).body).toBe('ग़लत — error पन्ना');
    // 4. network पूरी तरह टूटे — पहले जैसा cache-fallback चलता रहे
    expect((await run(new Error('offline'), { 'https://x/js/ui-core.js': cachedCopy })).body).toBe('cache वाली सही प्रति');
  });

  test('sw.js — install atomic रहे: कोई भी CORE (js/*.js) फ़ाइल cache होने में नाकाम रहे तो पूरा install नाकाम माना जाए, सिर्फ़ OPTIONAL (icons/manifest) चुपचाप skip हों (bug: partial cache — कुछ js file cache हो जातीं कुछ नहीं, बाद में offline पड़े device पर "X is not defined" जैसी errors)', () => {
    const swContent = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
    const coreBlock = swContent.slice(swContent.indexOf('var CORE='), swContent.indexOf('var OPTIONAL='));
    const installBlock = swContent.slice(swContent.indexOf('addEventListener("install"'), swContent.indexOf('addEventListener("activate"'));
    // index.html में <script src="js/..."> से लोड होने वाली हर फ़ाइल CORE में मौजूद हो
    const indexContent = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const scriptSrcs = [...indexContent.matchAll(/<script src="(js\/[^"]+)">/g)].map((m) => m[1]);
    expect(scriptSrcs.length).toBeGreaterThan(5);
    scriptSrcs.forEach((src) => {
      expect(coreBlock, src + ' CORE में होना चाहिए').toContain('./' + src);
    });
    // CORE वाले c.add() पर कोई per-file .catch न हो — नाकामी पूरे install (Promise.all) को reject करे
    expect(installBlock).toMatch(/CORE\.map\(function\(u\)\{return c\.add\(u\);\}\)/);
    // OPTIONAL वाले c.add() पर .catch(function(){}) हो — चुपचाप skip हों, install न रुके
    expect(installBlock).toMatch(/OPTIONAL\.map\(function\(u\)\{return c\.add\(u\)\.catch\(function\(\)\{\}\);\}\)/);
  });

  test('index.html में manifest लिंक है और manifest.json सही/मान्य है', async ({ page }) => {
    await openApp(page);
    const href = await page.evaluate(() => document.querySelector('link[rel="manifest"]')?.getAttribute('href'));
    expect(href).toBe('manifest.json');
    const manifest = await page.evaluate(() => fetch('manifest.json').then((r) => r.json()));
    expect(manifest.name).toContain('वसूली ट्रैकर');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    for (const icon of manifest.icons) {
      const res = await page.evaluate((src) => fetch(src).then((r) => r.status), icon.src);
      expect(res).toBe(200);
    }
  });

  test('apple-touch-icon लिंक मौजूद है और फ़ाइल लोड होती है', async ({ page }) => {
    await openApp(page);
    const href = await page.evaluate(() => document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'));
    expect(href).toBeTruthy();
    const status = await page.evaluate((src) => fetch(src).then((r) => r.status), href);
    expect(status).toBe(200);
  });

  test('viewport pinch-zoom बंद न हो — कमज़ोर नज़र वाले उपयोगकर्ता टेक्स्ट बड़ा कर सकें (accessibility)', async ({ page }) => {
    await openApp(page);
    const content = await page.evaluate(() => document.querySelector('meta[name="viewport"]')?.getAttribute('content'));
    expect(content).not.toContain('user-scalable=no');
    expect(content).not.toMatch(/maximum-scale=1(\.0)?\b/);
  });
});

test.describe('error logging', () => {
  test('logErr entry बनाता है और बिना पकड़ी error अपने आप log होती है', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => { try { localStorage.removeItem('dc_logs3'); } catch (e) {} });
    await page.evaluate(() => logErr('test-ctx', new Error('जांच'), 'extra'));
    await page.evaluate(() => { setTimeout(() => { throw new Error('uncaught-जांच'); }, 0); });
    await page.waitForTimeout(500);
    const logs = await page.evaluate(() => getLogs());
    expect(logs.some((l) => l.c === 'test-ctx' && l.m.indexOf('जांच') > -1)).toBe(true);
    expect(logs.some((l) => l.c === 'js-error' && l.m.indexOf('uncaught') > -1)).toBe(true);
  });

  test('cross-origin वाली खाली "Script error." लॉग नहीं होती (कोई सुराग नहीं देती, सिर्फ़ शोर) — पर असली errors लॉग होती रहती हैं', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => { try { localStorage.removeItem('dc_logs3'); } catch (e) {} });
    // ब्राउज़र cross-origin script की error पर बिल्कुल यही खाली signature देता है — filename/lineno/error कुछ नहीं
    await page.evaluate(() => {
      window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.', filename: '', lineno: 0, colno: 0, error: null }));
    });
    // असली (हमारे कोड जैसी, filename/lineno सहित) error अब भी सामान्य तरीके से लॉग होनी चाहिए
    await page.evaluate(() => {
      window.dispatchEvent(new ErrorEvent('error', { message: 'असली गड़बड़ी', filename: 'js/list.js', lineno: 42, error: new Error('असली गड़बड़ी') }));
    });
    await page.waitForTimeout(200);
    const logs = await page.evaluate(() => getLogs());
    expect(logs.some((l) => l.c === 'js-error' && l.m === 'Script error.')).toBe(false);
    expect(logs.some((l) => l.c === 'js-error' && l.m.indexOf('असली गड़बड़ी') > -1)).toBe(true);
  });

  test('App Check की "reCAPTCHA Timeout" वाली unhandled promise rejection लॉग नहीं होती (SDK के अंदर की, हम पकड़ नहीं सकते; monitor mode में असर भी नहीं) — पर असली promise rejection अब भी लॉग होती है', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => { try { localStorage.removeItem('dc_logs3'); } catch (e) {} });
    await page.evaluate(() => {
      window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', {
        promise: Promise.resolve(), reason: new Error('reCAPTCHA Timeout (b)'),
      }));
    });
    await page.evaluate(() => {
      window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', {
        promise: Promise.resolve(), reason: new Error('असली promise गड़बड़ी'),
      }));
    });
    await page.waitForTimeout(200);
    const logs = await page.evaluate(() => getLogs());
    expect(logs.some((l) => l.c === 'promise' && l.m.indexOf('reCAPTCHA Timeout') > -1)).toBe(false);
    expect(logs.some((l) => l.c === 'promise' && l.m.indexOf('असली promise गड़बड़ी') > -1)).toBe(true);
  });

  test('clearServerLogs — "सभी डिवाइस" वाले (server) logs को DELETE करता है, ताकि JE पुराने ढेर से छुटकारा पा सके', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => openLogModal());
    const deletedPaths = await page.evaluate(() => new Promise((resolve) => {
      const deleted = [];
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('/LOGS/') > -1 && opts && opts.method === 'DELETE') {
          deleted.push(url);
          return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
        }
        return orig(url, opts);
      };
      window.confirm = () => true;
      clearServerLogs();
      setTimeout(() => { window.fetch = orig; resolve(deleted); }, 300);
    }));
    // आज + कल — दोनों दिन के server logs हटने चाहिए (fetchServerLogs जिन 2 दिन को दिखाता है, वही)
    expect(deletedPaths.length).toBe(2);
    await expect(page.locator('#toast')).toContainText('साफ़ हो गए');
  });

  test('refreshLogBadge — पिछली बार देखने के बाद नई server error आई हो तो "एरर लॉग" पर गिनती वाला बैज दिखे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => { localStorage.setItem('dc_log_seen_ts', String(Date.now() - 60000)); }); // 1 मिनट पहले देखा था
    await page.evaluate(() => new Promise((resolve) => {
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('/LOGS/') > -1 && (!opts || !opts.method)) {
          const today = new Date().toISOString().slice(0, 10);
          const isToday = url.indexOf('/LOGS/' + today) > -1;
          const data = isToday ? { a: { t: new Date().toISOString(), c: 'js-error', m: 'नई गड़बड़ी' } } : null;
          return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
        }
        return orig(url, opts);
      };
      refreshLogBadge();
      setTimeout(() => { window.fetch = orig; resolve(); }, 300);
    }));
    // badge profile-menu (बंद dropdown) के अंदर है, इसलिए ancestor-visibility नहीं — सिर्फ़ अपनी inline style जांचें
    expect(await page.evaluate(() => document.getElementById('log-badge').style.display)).toBe('inline-block');
    expect(await page.evaluate(() => document.getElementById('log-badge').textContent)).toBe('1');
  });

  test('"एरर लॉग" खोलने पर बैज छुप जाए और "देखा हुआ" समय अपडेट हो — दोबारा वही पुरानी errors न गिनी जाएं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => {
      document.getElementById('log-badge').textContent = '3';
      document.getElementById('log-badge').style.display = 'inline-block';
    });
    const beforeSeen = await page.evaluate(() => Number(localStorage.getItem('dc_log_seen_ts')) || 0);
    await page.evaluate(() => openLogModal());
    expect(await page.evaluate(() => document.getElementById('log-badge').style.display)).toBe('none');
    const afterSeen = await page.evaluate(() => Number(localStorage.getItem('dc_log_seen_ts')) || 0);
    expect(afterSeen).toBeGreaterThan(beforeSeen);
  });
});

// Firebase का दैनिक quota US-Pacific आधी रात को रीसेट होता है, इसलिए v9.120 से ऐप उसी खिड़की का
// दिन इस्तेमाल करता है (_usageQuotaDay), UTC का नहीं। ये टेस्ट पहले UTC दिन मानकर चलते थे और
// इसीलिए सिर्फ़ घड़ी की मेहरबानी से पास होते थे — रोज़ 00:00 UTC से ~08:00 UTC के बीच (भारत में
// सुबह 5:30 से दोपहर 1:30) दोनों तारीख़ें अलग होतीं और stub मेल न खाता। असली CI failure यही थी।
// यहाँ वही दिन जान-बूझकर एक *अलग* रास्ते से निकाला गया है (toLocaleDateString), ताकि जाँच ऐप के
// अपने function को दोहराकर गोल-गोल न हो जाए
function quotaDay(offset) {
  const d = new Date();
  if (offset) d.setDate(d.getDate() - offset);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

test.describe('डेटा उपयोग (Firebase Blaze plan) — अनुमानित ट्रेंड ट्रैकिंग', () => {
  test('trackUsageBytes जमा होता है और _usageFlush /USAGE/{तारीख़} पर POST करके काउंटर रीसेट कर देता है', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const result = await page.evaluate(() => new Promise((resolve) => {
      trackUsageBytes(500);
      trackUsageBytes(300);
      const orig = window.fetch;
      var posted = null;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('/USAGE/') > -1 && opts && opts.method === 'POST') {
          posted = { url: url, body: JSON.parse(opts.body) };
          return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
        }
        return orig(url, opts);
      };
      _usageFlush();
      setTimeout(() => { window.fetch = orig; resolve({ posted: posted, remaining: _usageBytes }); }, 200);
    }));
    expect(result.posted.url).toContain('/USAGE/' + quotaDay(0));
    expect(result.posted.body.b).toBe(800);
    expect(result.remaining).toBe(0);
  });

  test('openUsageModal — सिर्फ JE खोल सकते हैं', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => openUsageModal());
    expect(await page.evaluate(() => document.getElementById('usage-overlay').classList.contains('open'))).toBe(false);
    await expect(page.locator('#toast')).toContainText('सिर्फ JE');
  });

  test('_usageRender — पिछले दिन से 50% से ज़्यादा बढ़ोतरी हो तो चेतावनी दिखे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate((curDay) => new Promise((resolve) => {
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('/USAGE/') > -1 && (!opts || !opts.method)) {
          var isCur = url.indexOf('/USAGE/' + curDay) > -1;
          var data = isCur ? { a: { d: 'dev1', b: 3000000, t: Date.now() } } : { a: { d: 'dev1', b: 1000000, t: Date.now() } };
          return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
        }
        return orig(url, opts);
      };
      _usageRender();
      setTimeout(() => { window.fetch = orig; resolve(); }, 300);
    }), quotaDay(0));
    await expect(page.locator('#usage-content')).toContainText('ज़्यादा डेटा इस्तेमाल हुआ');
  });

  test('_usageRender — बढ़ोतरी सामान्य हो तो कोई चेतावनी न दिखे, बस दोनों दिनों का आंकड़ा दिखे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => new Promise((resolve) => {
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('/USAGE/') > -1 && (!opts || !opts.method)) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ a: { d: 'dev1', b: 2000000, t: Date.now() } }) });
        }
        return orig(url, opts);
      };
      _usageRender();
      setTimeout(() => { window.fetch = orig; resolve(); }, 300);
    }));
    const content = await page.locator('#usage-content').innerText();
    expect(content).not.toContain('असामान्य बढ़ोतरी');
    expect(content).toContain('MB');
  });

  test('_usageRender — आज के 360MB/day free-कोटा का सही % दिखे (asli Firebase console जैसा daily quota)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => new Promise((resolve) => {
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('/USAGE/') > -1 && (!opts || !opts.method)) {
          // 180MB आज = 360MB में से 50%
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ a: { d: 'dev1', b: 180 * 1024 * 1024, t: Date.now() } }) });
        }
        return orig(url, opts);
      };
      _usageRender();
      setTimeout(() => { window.fetch = orig; resolve(); }, 300);
    }));
    const content = await page.locator('#usage-content').innerText();
    expect(content).toContain('180.0 MB / 360 MB');
    expect(content).toContain('50%');
  });
});

// JE का स्वतंत्र-आकलन वाला अनुरोध (29 सित) — तीन सुधार: (1) 930KB की xlsx अब पेज रोककर नहीं
// उतरती, (2) SheetJS 0.18.5 → 0.20.3 (दो ज्ञात खामियां बंद), (3) PIN कम से कम 6 अंक।
test.describe('vendor libs अब ज़रूरत पड़ने पर ही उतरें (index.html में eager <script> नहीं)', () => {
  test('index.html में vendor/xlsx और papaparse के <script src> tag न हों', async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    expect(html).not.toMatch(/<script[^>]+src=["']vendor\/xlsx\.full\.min\.js/);
    expect(html).not.toMatch(/<script[^>]+src=["']vendor\/papaparse\.min\.js/);
  });

  test('ऐप खुलते ही XLSX/Papa लोड न हों — लाइनमैन 930KB न उतारे', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await page.evaluate(() => ({ xlsx: typeof window.XLSX, papa: typeof window.Papa }));
    expect(r.xlsx).toBe('undefined');
    expect(r.papa).toBe('undefined');
  });

  test('ensureXLSX — एक ही script दो बार न जुड़े, और दोनों callers को नतीजा मिले', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      // असली फ़ाइल न उतारें (930KB) — बस गिनें कि कितने <script> जुड़े
      const added = [];
      const origAppend = document.head.appendChild.bind(document.head);
      document.head.appendChild = function (el) {
        if (el.tagName === 'SCRIPT' && /vendor\//.test(el.src || '')) {
          added.push(el.src);
          setTimeout(() => el.onload && el.onload(), 10); // उतरने का नाटक
          return el;
        }
        return origAppend(el);
      };
      const got = [];
      ensureXLSX((ok) => got.push(ok));
      ensureXLSX((ok) => got.push(ok)); // पहली अभी उतर ही रही है
      setTimeout(() => {
        document.head.appendChild = origAppend;
        resolve({ scripts: added.length, got });
      }, 60);
    }));
    expect(r.scripts).toBe(1);        // script सिर्फ़ एक बार जुड़ी
    expect(r.got).toEqual([true, true]); // पर दोनों caller को जवाब मिला
  });

  test('lib न उतर पाए (offline) तो अगली बार दोबारा कोशिश हो — हमेशा के लिए अटके नहीं', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      let n = 0;
      const origAppend = document.head.appendChild.bind(document.head);
      document.head.appendChild = function (el) {
        if (el.tagName === 'SCRIPT' && /vendor\//.test(el.src || '')) {
          n++;
          setTimeout(() => el.onerror && el.onerror(), 10); // नाकाम
          return el;
        }
        return origAppend(el);
      };
      const got = [];
      ensurePapa((ok) => {
        got.push(ok);
        ensurePapa((ok2) => {               // दोबारा माँगें
          got.push(ok2);
          document.head.appendChild = origAppend;
          resolve({ tries: n, got });
        });
      });
    }));
    expect(r.got).toEqual([false, false]);
    expect(r.tries).toBe(2); // पहली नाकामी के बाद रास्ता बंद नहीं हुआ
  });

  test('sw.js अब भी vendor फ़ाइलों को precache न करे (मोबाइल डेटा बचे)', async () => {
    const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
    expect(sw).not.toMatch(/["']\.\/vendor\/xlsx\.full\.min\.js["']/);
    expect(sw).not.toMatch(/["']\.\/vendor\/papaparse\.min\.js["']/);
  });
});

test.describe('SheetJS का संस्करण — ज्ञात खामियों वाला 0.18.5 दोबारा न लौटे', () => {
  test('vendor/xlsx.full.min.js 0.20.2 या नया हो', async () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'vendor', 'xlsx.full.min.js'), 'utf8');
    const m = js.match(/"(0\.\d+\.\d+)"/g) || [];
    const vers = m.map((s) => s.replace(/"/g, ''))
      .filter((v) => /^0\.(1[89]|2\d)\./.test(v)); // सिर्फ़ SheetJS जैसे संस्करण-अंक
    expect(vers.length).toBeGreaterThan(0);
    const [maj, min, pat] = vers[0].split('.').map(Number);
    const num = maj * 10000 + min * 100 + pat;
    expect(num).toBeGreaterThanOrEqual(2002); // 0.20.2 — ReDoS और prototype-pollution दोनों बंद
  });
});

// ── v9.189: logo छोटा, WhatsApp पर लिंक की झलक — बिना ऐप धीमी किए, बिना बैंडविड्थ बढ़ाए ──
// login पन्ने का logo 92px में दिखता था पर 327 KB की icon-512.png उतरती थी; और sw.js हर नए फ़ोन
// पर icon-512 + icon-maskable-512 (~510 KB) भी precache करता था, जो सिर्फ़ install के वक़्त चाहिए
test.describe('logo और लिंक-झलक (v9.189)', () => {
  test('login logo छोटी WebP फ़ाइल हो (< 30 KB) और सचमुच दिखे', async ({ page }) => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    expect(html).toMatch(/<img class="login-logo" src="icons\/login-logo\.webp"/);
    const size = fs.statSync(path.join(__dirname, '..', 'icons', 'login-logo.webp')).size;
    expect(size).toBeLessThan(30 * 1024);
    await openApp(page);
    const w = await page.evaluate(() => new Promise((res) => {
      const im = document.querySelector('.login-logo');
      if (im.complete) res(im.naturalWidth); else im.onload = () => res(im.naturalWidth);
    }));
    expect(w).toBe(276); // 92px × 3 (तेज़ स्क्रीन)
  });

  test('WebP न खुले तो पहले icon-192.png, फिर ⚡ (logo की जगह ख़ाली न रहे)', async ({ page }) => {
    await page.route('**/icons/login-logo.webp', (r) => r.fulfill({ status: 404, body: '' }));
    await openApp(page);
    await page.waitForFunction(() => { const im = document.querySelector('.login-logo'); return im && /icon-192\.png$/.test(im.src); });
    const ok = await page.evaluate(() => new Promise((res) => {
      const im = document.querySelector('.login-logo');
      if (im.complete) res(im.naturalWidth > 0); else im.onload = () => res(im.naturalWidth > 0);
    }));
    expect(ok).toBe(true);
  });

  test('sw.js — 512px वाले icons precache न हों; जो भी precache सूची में है वह फ़ाइल सचमुच मौजूद हो', () => {
    const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
    const block = sw.slice(sw.indexOf('var CORE='), sw.indexOf('self.addEventListener("install"'));
    const code = block.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(code).not.toContain('icon-512.png');
    expect(code).not.toContain('icon-maskable-512.png');
    expect(code).toContain('./icons/login-logo.webp');
    const local = (code.match(/"\.\/[^"]+"/g) || []).map((s) => s.slice(3, -1)).filter((s) => s);
    local.forEach((f) => expect(fs.existsSync(path.join(__dirname, '..', f)), f).toBe(true));
  });

  test('WhatsApp/Google झलक — description, og:title, og:image (पूरा https पता, फ़ाइल मौजूद और 300 KB से छोटी)', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const meta = (attr, key) => { const m = html.match(new RegExp('<meta ' + attr + '="' + key + '" content="([^"]+)"')); return m ? m[1] : null; };
    expect(meta('name', 'description')).toBeTruthy();
    expect(meta('property', 'og:title')).toBeTruthy();
    const img = meta('property', 'og:image');
    // असली चालू ऐप GitHub Pages पर है — पते में repo का हिस्सा (/ADEGAON/) होता है
    expect(img).toMatch(/^https:\/\/pradeepks2015-ship-it\.github\.io\/ADEGAON\/icons\/[^/]+\.png$/);
    expect(meta('property', 'og:url')).toBe('https://pradeepks2015-ship-it.github.io/ADEGAON/');
    const file = path.join(__dirname, '..', img.replace(/^https:\/\/[^/]+\/ADEGAON\//, ''));
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.statSync(file).size).toBeLessThan(300 * 1024);
  });
});

// ── v9.193: Google के लाल ठप्पे (8/10, phishing) से बचाव — login पन्ने पर ऐप की साफ़ पहचान ──
test.describe('login पन्ने पर ऐप की पहचान (v9.193)', () => {
  test('अंग्रेज़ी पंक्ति "not the department\'s official website" दिखे और Privacy Policy का लिंक काम करे', async ({ page }) => {
    await openApp(page);
    const d = page.locator('#login-screen .login-disclaimer');
    await expect(d).toBeVisible();
    // JE की चुनी पंक्ति (विकल्प ग)
    await expect(d).toContainText('made for the internal office use of Adegaon DC');
    await expect(d).toContainText("not the department's official website");
    // पहले वाली "बिल भुगतान नहीं होता" पंक्ति JE ने हटवाई थी
    await expect(d).not.toContainText(/payment/i);
    const a = d.locator('a');
    await expect(a).toHaveAttribute('href', 'privacy.html');
    await expect(a).toHaveAttribute('rel', /noopener/);
    const r = await page.request.get('/privacy.html');
    expect(r.ok()).toBe(true);
    expect(await r.text()).toContain('This is not an official website');
  });

  test('v9.194: privacy.html पूरी अंग्रेज़ी में हो (Google का जांचक पढ़ सके) — टिप्पणी छोड़कर कोई हिंदी अक्षर नहीं', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'privacy.html'), 'utf8');
    expect(html).toMatch(/<html lang="en">/);
    const text = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
    expect(text).not.toMatch(/[\u0900-\u097F]/);
    expect(text).toContain('does not collect any payment, bank, UPI or card details');
  });
});

// ── v9.195: JE की स्क्रीनें ज़रूरत पड़ने पर ही उतरें — कोई बटन चुपचाप न टूटे ──
// यहां lazyTest है (ऊपर वाला test नहीं) — यानी index.html में lazy फ़ाइलें नहीं जोड़ी जातीं, असली
// लाइनमैन-फ़ोन जैसा रास्ता चलता है
test.describe('lazy फ़ाइलें (v9.195)', () => {
  const root = path.join(__dirname, '..');
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  const espree = require('espree');
  const strip = (s) => {
    const a = espree.parse(s, { ecmaVersion: 2022, comment: true, range: true });
    let t = s;
    a.comments.slice().reverse().forEach((c) => { t = t.slice(0, c.range[0]) + ' ' + t.slice(c.range[1]); });
    return t;
  };
  const lazyEntry = () => {
    const src = read('js/lazy.js');
    const block = src.slice(src.indexOf('var LAZY_ENTRY'), src.indexOf('};', src.indexOf('var LAZY_ENTRY')) + 2);
    return Function('"use strict";' + block.replace('var LAZY_ENTRY =', 'return'))();
  };

  test('हर वह नाम जिसे बाक़ी ऐप lazy फ़ाइल से बुलाता है, LAZY_ENTRY में हो (वरना बटन "not defined" पर टूटे)', () => {
    const entry = lazyEntry();
    expect(Object.keys(entry).sort()).toEqual([...LAZY_FILES].sort());
    const others = fs.readdirSync(path.join(root, 'js')).map((f) => 'js/' + f)
      .filter((f) => f.endsWith('.js') && !LAZY_FILES.includes(f));
    const src = {};
    others.forEach((f) => { src[f] = strip(read(f)); });
    src['index.html'] = read('index.html').replace(/<!--[\s\S]*?-->/g, '');
    const missing = [];
    for (const f of LAZY_FILES) {
      const ast = espree.parse(read(f), { ecmaVersion: 2022 });
      const fns = [];
      ast.body.forEach((n) => {
        // lazy फ़ाइल में ऊपर-स्तर पर सिर्फ़ declarations — कोई चलने वाला कोड नहीं (क्रम/समय पर निर्भरता न हो)
        expect(['FunctionDeclaration', 'VariableDeclaration'], f + ' में ऊपर-स्तर का ' + n.type).toContain(n.type);
        if (n.type === 'FunctionDeclaration') fns.push(n.id.name);
        else n.declarations.forEach((d) => {
          const re = new RegExp('(^|[^\\w$.])' + d.id.name.replace(/\$/g, '\\$') + '(?![\\w$])');
          const users = Object.keys(src).filter((k) => re.test(src[k]));
          expect(users, f + ' का var ' + d.id.name + ' बाहर इस्तेमाल न हो (stub सिर्फ़ functions के लिए है)').toEqual([]);
        });
      });
      for (const nm of fns) {
        const re = new RegExp('(^|[^\\w$.])' + nm.replace(/\$/g, '\\$') + '(?![\\w$])');
        if (Object.keys(src).some((k) => re.test(src[k])) && !entry[f].includes(nm)) missing.push(f + ': ' + nm);
      }
      // उल्टा भी: LAZY_ENTRY का हर नाम उस फ़ाइल में सचमुच function हो
      entry[f].forEach((nm) => expect(fns, f + ' में ' + nm).toContain(nm));
    }
    expect(missing).toEqual([]);
  });

  test('index.html और sw.js की पहले-उतरने वाली सूची में lazy फ़ाइलें न हों; lazy.js हो', () => {
    const html = read('index.html');
    LAZY_FILES.forEach((f) => expect(html).not.toContain(`<script src="${f}"`));
    expect(html).toContain('<script src="js/lazy.js"></script>');
    expect(html.indexOf('js/lazy.js')).toBeLessThan(html.indexOf('js/ui-core.js'));
    const sw = read('sw.js');
    const core = sw.slice(sw.indexOf('var CORE='), sw.indexOf('var OPTIONAL='));
    LAZY_FILES.forEach((f) => expect(core).not.toContain('"./' + f + '"'));
    expect(core).toContain('"./js/lazy.js"');
  });

  lazyTest('लाइनमैन: lazy फ़ाइलें नहीं उतरतीं, फिर भी PDF/Excel बटन असली हों — PDF बिना नेट भी (upload.js बंद होने पर भी) चले', async ({ page }) => {
    const got = [];
    page.on('request', (r) => { const m = r.url().match(/\/(js\/[\w-]+\.js)/); if (m) got.push(m[1]); });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openApp(page);
    await loginLineman(page);
    await page.waitForTimeout(5000); // JE वाला preload (4 सेकंड) लाइनमैन पर न चले
    LAZY_FILES.forEach((f) => expect(got, f).not.toContain(f));
    expect(await page.evaluate(() => typeof processRows)).toBe('undefined');
    // PDF/Excel अब js/reports.js में — शुरू से असली, stub नहीं (v9.195 की पहली कोशिश में ये upload.js में थे
    // और गांव में बिना नेट पहली बार PDF दबाने पर "नेट चाहिए" आता — JE के सवाल से पकड़ा गया)
    expect(await page.evaluate(() => [typeof downloadPDF, !!downloadPDF._lazyStub, typeof downloadExcel, !!downloadExcel._lazyStub, typeof _filteredForDownload]))
      .toEqual(['function', false, 'function', false, 'function']);
    await page.route('**/js/upload.js*', (r) => r.abort());
    await page.evaluate(() => { cSet(activeHQ, activeCat, [{ acc: '1', name: 'क', amount: 100, status: 'pending' }]); activeFilter = 'all'; window.__opened = 0; window.open = function () { window.__opened++; return null; }; });
    await page.click('button[onclick="downloadPDF()"]');
    await page.waitForFunction(() => window.__opened === 1);
    expect(got).not.toContain('js/upload.js');
    expect(await page.evaluate(() => getLogs().filter((l) => l.c === 'lazy-load-fail').length)).toBe(0);
    expect(errors).toEqual([]);
  });

  lazyTest('हर lazy फ़ाइल उतरने के बाद उसका हर stub असली function से बदल जाए', async ({ page }) => {
    await openApp(page);
    const res = await page.evaluate(async () => {
      const out = {};
      for (const f of Object.keys(LAZY_ENTRY)) {
        await lazyLoad(f);
        out[f] = LAZY_ENTRY[f].filter((n) => typeof window[n] !== 'function' || window[n]._lazyStub);
      }
      return out;
    });
    Object.values(res).forEach((left) => expect(left).toEqual([]));
  });

  lazyTest('stub से बुलाने पर वही arguments असली function तक पहुंचें (डेटा-उपयोग: लाइनमैन को "सिर्फ JE" संदेश)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => openUsageModal());
    await expect(page.locator('#toast')).toContainText('सिर्फ JE डेटा उपयोग देख सकते हैं');
    expect(await page.evaluate(() => !!window.openUsageModal._lazyStub)).toBe(false);
  });

  lazyTest('फ़ाइल न उतरे (नेट नहीं) तो बटन चुपचाप न बैठे — साफ़ संदेश + error log; नेट लौटने पर दोबारा दबाना चले', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => { window.lazyPreloadAll = function () {}; }); // preload रोककर असली stub रास्ता
    await loginJE(page);
    await page.route('**/js/upload.js*', (r) => r.abort());
    await page.locator('button', { hasText: 'अपलोड' }).first().click();
    await expect(page.locator('#toast')).toContainText('यह सुविधा अभी खुल नहीं पाई');
    const log = await page.evaluate(() => getLogs().filter((l) => l.c === 'lazy-load-fail').map((l) => l.x + ' | ' + l.m));
    expect(log.length).toBe(1);
    expect(log[0]).toContain('openUpModal');
    expect(log[0]).toContain('js/upload.js');
    await expect(page.locator('#up-overlay')).not.toHaveClass(/open/);
    await page.unroute('**/js/upload.js*');
    await page.locator('button', { hasText: 'अपलोड' }).first().click();
    await expect(page.locator('#up-overlay')).toHaveClass(/open/);
    expect(await page.evaluate(() => typeof processRows)).toBe('function');
  });

  lazyTest('JE के फ़ोन पर login के बाद चारों lazy फ़ाइलें अपने-आप पहले से उतरें (बिना नेट भी खुलें)', async ({ page }) => {
    const got = [];
    page.on('request', (r) => { const m = r.url().match(/\/(js\/[\w-]+\.js)/); if (m) got.push(m[1]); });
    await openApp(page);
    await loginJE(page);
    await page.waitForFunction(() => Object.keys(LAZY_ENTRY).every((f) =>
      LAZY_ENTRY[f].every((n) => typeof window[n] === 'function' && !window[n]._lazyStub)), null, { timeout: 15000 });
    LAZY_FILES.forEach((f) => expect(got, f).toContain(f));
  });

  lazyTest('JE: अपलोड बटन (stub से) सचमुच अपलोड-खिड़की खोले', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => { window.lazyPreloadAll = function () {}; }); // preload रोककर असली stub रास्ता
    await loginJE(page);
    expect(await page.evaluate(() => !!window.openUpModal._lazyStub)).toBe(true);
    await page.locator('button', { hasText: 'अपलोड' }).first().click();
    await expect(page.locator('#up-overlay')).toHaveClass(/open/);
  });
});

// ── v9.196: Google Search से ऐप छिपे — अनजान लोग खोजकर "धोखा" की रिपोर्ट न करें (ठप्पे से बचाव, क) ──
test.describe('Google Search से छिपाव (v9.196)', () => {
  test('index.html में robots noindex हो, पर WhatsApp झलक (og:*) बनी रहे', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /^https:\/\//);
    await expect(page.locator('meta[property="og:title"]')).toHaveCount(1);
  });
});

// @ts-check
// वसूली ट्रैकर — टेस्ट: network-bandwidth (साझा helpers: tests/helpers.js)
const { test, expect, fs, path, openApp, loginLineman, loginJE } = require('./helpers');

test.describe('_cashRefreshAll — कमज़ोर नेटवर्क पर एक अटकी श्रेणी पूरी स्क्रीन को न रोके', () => {
  test('एक श्रेणी का fetch कभी जवाब न दे तो भी timeout के बाद पुरानी cache के साथ आगे बढ़ता है, बाकी अपडेट होती हैं', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      _CASH_REFRESH_TIMEOUT_MS = 200; // टेस्ट में तेज़ जांच के लिए छोटा
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('टेस्ट_HQ8/घरेलू') > -1) {
          return new Promise(() => {}); // कभी resolve/reject नहीं होगा — अटकी हुई श्रेणी
        }
        if (typeof url === 'string' && url.indexOf('टेस्ट_HQ8') > -1) {
          return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve([{ acc: '1', status: 'pending' }]) });
        }
        return orig(url, opts);
      };
      cSet('टेस्ट HQ8', 'घरेलू', [{ acc: 'OLD', status: 'pending' }]); // अटकी श्रेणी की पुरानी cache
      const start = Date.now();
      _cashRefreshAll(['टेस्ट HQ8'], function () {
        window.fetch = orig;
        resolve({
          ms: Date.now() - start,
          stuckStillOld: cGet('टेस्ट HQ8', 'घरेलू')[0].acc === 'OLD',
          othersUpdated: cGet('टेस्ट HQ8', 'कुल उपभोक्ता')[0].acc === '1',
        });
      });
    }));
    expect(r.ms).toBeLessThan(2000);
    expect(r.stuckStillOld).toBe(true);
    expect(r.othersUpdated).toBe(true);
  });

  // असली लॉग (JE, कमज़ोर नेट): सभी 48 सूचियां एक साथ मंगाने से पीछे वाले मुख्यालय (पाटन/बीबी/मढ़ी)
  // 8 सेकंड में पूरे नहीं हो पाते थे (19/48 नाकाम)
  test('एक बार में सिर्फ़ _CASH_REFRESH_CONCURRENCY (6) सूचियां मंगाई जाएं, बाकी पहले वालों के निपटने पर', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      _CASH_REFRESH_TIMEOUT_MS = 80;
      let calls = 0, first = -1;
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('टेस्ट_HQ50') > -1) { calls++; return new Promise(() => {}); }
        return orig(url, opts);
      };
      _cashRefreshAll(['टेस्ट HQ50'], function (n) { window.fetch = orig; resolve({ first: first, calls: calls, n: n }); }, true);
      first = calls; // सिर्फ़ शुरुआती (synchronous) requests
    }));
    expect(r.first).toBe(6);  // एक साथ सिर्फ़ 6
    expect(r.calls).toBe(8);  // बाकी 2 बाद में — आख़िर में सभी 8 श्रेणियां मंगाई गईं
    expect(r.n).toBe(8);      // कोई जवाब नहीं आया — सब timeout गिनी गईं
  });

  // असली लॉग: JE ने रिफ्रेश चलते-चलते दोबारा दबाया, पहले की अधूरी requests के ऊपर 48 नई चढ़ गईं (48/48 नाकाम)
  test('रिफ्रेश चलते दोबारा बुलाने पर नया रिफ्रेश न चले — उसी में जुड़कर उसका नतीजा मिले', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      let calls = 0;
      const results = [];
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('टेस्ट_HQ51') > -1) {
          calls++;
          return new Promise((res) => setTimeout(() => res({ status: 304, ok: false, headers: { get: () => null } }), 30));
        }
        return orig(url, opts);
      };
      const done = (n) => { results.push(n); if (results.length === 2) { window.fetch = orig; resolve({ calls: calls, results: results, busy: busy }); } };
      _cashRefreshAll(['टेस्ट HQ51'], done, true);
      const busy = _cashRefreshBusy();
      _cashRefreshAll(['टेस्ट HQ51'], done, true); // चलते हुए दोबारा — जैसे बटन दोबारा दबाया
    }));
    expect(r.busy).toBe(true);
    expect(r.calls).toBe(8);         // 16 नहीं — दूसरी बार कोई नई request नहीं गई
    expect(r.results).toEqual([0, 0]); // दोनों callers को उसी रिफ्रेश का नतीजा मिला
  });

  test('timeout के बाद देर से पहुंची सूची cache में आए और caller का onLate बुलाया जाए (स्क्रीन पुरानी न दिखती रहे)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      _CASH_REFRESH_TIMEOUT_MS = 50;
      let failN = -1;
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('टेस्ट_HQ52/घरेलू') > -1) {
          return new Promise((res) => setTimeout(() => res({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve([{ acc: 'NEW', status: 'pending' }]) }), 150));
        }
        if (typeof url === 'string' && url.indexOf('टेस्ट_HQ52') > -1) {
          return Promise.resolve({ status: 304, ok: false, headers: { get: () => null } });
        }
        return orig(url, opts);
      };
      const fallback = setTimeout(() => { window.fetch = orig; resolve({ failN: failN, late: false }); }, 3000);
      _cashRefreshAll(['टेस्ट HQ52'], function (n) { failN = n; }, true, function () {
        clearTimeout(fallback);
        window.fetch = orig;
        resolve({ failN: failN, late: true, acc: cGet('टेस्ट HQ52', 'घरेलू')[0].acc });
      });
    }));
    expect(r.failN).toBe(1);   // cb के वक़्त "घरेलू" अभी timeout थी
    expect(r.late).toBe(true); // बाद में पहुंची तो onLate बुलाया गया
    expect(r.acc).toBe('NEW'); // और उसका ताज़ा data cache में आ गया
  });
});

test.describe('Firebase permission-denied response को असली record न समझा जाए', () => {
  test('fbGet — HTTP 401/403 पर मिलने वाला {"error":"..."} JSON असली consumer record न बने (bug: ₹NaN वाला टूटा हुआ card)', async ({ page }) => {
    await openApp(page);
    const result = await page.evaluate(() => new Promise((resolve) => {
      var orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('टेस्ट_HQ11/घरेलू') > -1) {
          return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ error: 'Permission denied' }) });
        }
        return orig(url, opts);
      };
      fbGet('टेस्ट HQ11', 'घरेलू', function (data) {
        window.fetch = orig;
        resolve(data);
      });
    }));
    expect(result).toEqual([]);
  });

  test('startListen — pollOnce पर भी permission-denied response से टूटा हुआ record न बने', async ({ page }) => {
    await openApp(page);
    const result = await page.evaluate(() => new Promise((resolve) => {
      var orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('टेस्ट_HQ12/घरेलू') > -1) {
          return Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ error: 'Permission denied' }) });
        }
        return orig(url, opts);
      };
      cSet('टेस्ट HQ12', 'घरेलू', [{ acc: 'OLD', name: 'पुराना', amount: '10', status: 'pending' }]);
      startListen('टेस्ट HQ12', 'घरेलू');
      setTimeout(function () {
        window.fetch = orig;
        stopListen();
        resolve(cGet('टेस्ट HQ12', 'घरेलू'));
      }, 300);
    }));
    expect(result.length).toBe(1);
    expect(result[0].acc).toBe('OLD'); // पुराना cache जस का तस रहे, कोई टूटा record न जुड़े
  });
});

test.describe('Firebase bandwidth — एक ही list बेवजह बार-बार डाउनलोड न हो (bug: RTDB free download quota रोज़ पार होना)', () => {
  test('"online" event — बार-बार नेटवर्क आने-जाने पर हर बार पूरा prefetchAll() न चले (bug: गांव में सिग्नल आने-जाने पर दिन में कई बार सभी HQ/श्रेणी का पूरा data दोबारा डाउनलोड होना — बिना कुछ खोले भी)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const calledAfterOnline = await page.evaluate(() => new Promise((resolve) => {
      var called = false;
      var orig = window.prefetchAll;
      window.prefetchAll = function () { called = true; };
      window.dispatchEvent(new Event('online'));
      setTimeout(() => { window.prefetchAll = orig; resolve(called); }, 3500); // पुराने कोड में 3s बाद setTimeout से चलता था
    }));
    expect(calledAfterOnline).toBe(false);
  });

  // असली bug: prefetchAll() हर cold-start पर चलता था — लाइनमैन के लिए 8 पूरी लिस्ट, JE के लिए 48।
  // मोबाइल पर ऐप दिन में कई बार minimize होकर मरता-खुलता है, तो यह दिन में दर्जनों बार दोहराता था,
  // जबकि वही लिस्टें पहले से device पर सेव थीं
  test('prefetchAll — दिन में एक बार से ज़्यादा न चले (bug: हर बार ऐप खुलने पर सभी श्रेणियों की पूरी लिस्ट दोबारा download)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      CU = { role: 'lineman', name: 'प्रीफ़ेच', hq: HQS[1] };
      var key = _prefetchKey();
      localStorage.removeItem(key);
      var first = _prefetchDue();                                   // कभी हुआ ही नहीं → चलना चाहिए
      localStorage.setItem(key, String(Date.now()));
      var rightAfter = _prefetchDue();                              // अभी-अभी हुआ → न चले
      localStorage.setItem(key, String(Date.now() - 23 * 60 * 60 * 1000));
      var after23h = _prefetchDue();                                // 23 घंटे → अभी भी न चले
      localStorage.setItem(key, String(Date.now() - 25 * 60 * 60 * 1000));
      var after25h = _prefetchDue();                                // एक दिन से ज़्यादा → चले
      localStorage.setItem(key, String(Date.now() + 5 * 60 * 60 * 1000));
      var futureClock = _prefetchDue();                             // घड़ी पीछे हो गई → भरोसा न करें, चले
      return { first: first, rightAfter: rightAfter, after23h: after23h, after25h: after25h, futureClock: futureClock };
    });
    expect(r.first).toBe(true);
    expect(r.rightAfter).toBe(false);
    expect(r.after23h).toBe(false);
    expect(r.after25h).toBe(true);
    expect(r.futureClock).toBe(true);
  });

  test('prefetchAll — रुका हुआ prefetch एक भी नेटवर्क call न करे, पर force=true उसे फिर भी चलाए', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      CU = { role: 'lineman', name: 'प्रीफ़ेच', hq: HQS[1] };
      localStorage.setItem(_prefetchKey(), String(Date.now())); // आज हो चुका है
      var hits = 0;
      var orig = window.fetch;
      window.fetch = function (u, o) { if (String(u).indexOf(FB) === 0) hits++; return orig(u, o); };
      prefetchAll();
      var throttled = hits;
      prefetchAll(true);
      var forced = hits;
      window.fetch = orig;
      _prefetchRun = false;
      return { throttled: throttled, forced: forced };
    });
    expect(r.throttled).toBe(0);   // एक भी बाइट नहीं
    expect(r.forced).toBeGreaterThan(0);
  });

  test('prefetchAll — हर HQ का अपना अलग हिसाब (एक HQ का prefetch दूसरे HQ के लाइनमैन को न रोके)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      CU = { role: 'lineman', name: 'क', hq: HQS[1] };
      var k1 = _prefetchKey();
      localStorage.setItem(k1, String(Date.now()));
      var sameHq = _prefetchDue();
      CU = { role: 'lineman', name: 'ख', hq: HQS[2] };
      var otherHq = _prefetchDue();
      CU = { role: 'supervisor', name: 'जेई', hq: HQS[0] };
      var je = _prefetchDue();
      return { k1: k1, sameHq: sameHq, otherHq: otherHq, je: je, jeKey: _prefetchKey() };
    });
    expect(r.sameHq).toBe(false);
    expect(r.otherHq).toBe(true);
    expect(r.je).toBe(true);
    expect(r.jeKey).not.toBe(r.k1);
  });

  test('EventSource बंद (readyState=2, जैसे ~1 घंटे बाद token expire) होने पर पहली बार में सीधे भारी polling पर न जाए — पहले ताज़ा token से दोबारा जोड़ने की कोशिश हो', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.waitForFunction(() => !!liveSource, null, { timeout: 15000 });
    const r = await page.evaluate(() => {
      var es = liveSource;
      es.close(); // असली (network-blocked) EventSource का अपना देर वाला error न आए — वरना वह भी थोपे गए readyState=2 से "पूरी तरह बंद" रास्ते पर जाकर दूसरी बार reconnect चला देता (test-race, ~1/15 flaky)
      Object.defineProperty(es, 'readyState', { value: 2, configurable: true });
      es.onerror();
      return { attempts: _esReconnectAttempts, pollActive: !!pollTimer };
    });
    expect(r.attempts).toBe(1);
    expect(r.pollActive).toBe(false); // पहली बार में polling शुरू नहीं हुई — पहले reconnect की कोशिश
  });

  test('EventSource लगातार 3 बार जल्दी बंद हो (असली समस्या) तो आख़िरकार polling पर जाए — सुरक्षा-जाल बना रहे', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.waitForFunction(() => !!liveSource, null, { timeout: 15000 });
    const r = await page.evaluate(() => {
      var es = liveSource;
      Object.defineProperty(es, 'readyState', { value: 2, configurable: true });
      es.onerror(); es.onerror(); es.onerror(); es.onerror(); // 4 बार — तीसरी कोशिश के बाद आख़िरी बार polling पर जाना चाहिए
      return { attempts: _esReconnectAttempts, pollActive: !!pollTimer };
    });
    expect(r.pollActive).toBe(true);
  });

  // असली नाप: कमज़ोर नेट वाले एक लाइनमैन ने अकेले पूरे DC का 27% खाया — हर नेट-झटके (readyState 0)
  // पर browser ~3 सेकंड में खुद दोबारा जोड़ता था, और Firebase हर बार जुड़ते ही पूरी list भेजता है
  test('नेट-झटके (readyState=0) पर browser का तुरंत reconnect रुके, और बार-बार टूटने पर इंतज़ार दोगुना होता जाए (अधिकतम सीमा तक)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      ES_BACKOFF_BASE_MS = 30; ES_BACKOFF_MAX_MS = 100; ES_STABLE_MS = 60000;
      let created = 0;
      window.FetchLiveSource = function () { created++; this.readyState = 1; this.addEventListener = function () {}; this.close = function () { this.readyState = 2; }; };
      _esBackoffMs = 0; _esOpenedAt = 0;
      _openLive(activeHQ, activeCat);
      const seen = [];
      let n = 0;
      (function step() {
        const es = liveSource;
        es.readyState = 0; es.onerror();
        seen.push({ bo: _esBackoffMs, closed: es.readyState === 2, kept: liveSource === es });
        if (++n >= 4) return resolve({ seen: seen, created: created });
        const t0 = Date.now();
        (function wait() {
          if (liveSource && liveSource !== es) return step();
          if (Date.now() - t0 > 3000) return resolve({ seen: seen, created: created, timeout: true });
          setTimeout(wait, 5);
        })();
      })();
    }));
    expect(r.timeout).toBeUndefined();
    expect(r.seen.map((s) => s.bo)).toEqual([30, 60, 100, 100]); // दोगुना, फिर अधिकतम पर टिका
    expect(r.seen.every((s) => s.closed)).toBe(true); // browser का अपना reconnect हर बार रोका गया
    expect(r.seen.every((s) => s.kept)).toBe(true);   // रुकने के दौरान liveSource खाली नहीं हुआ
    expect(r.created).toBe(4); // शुरुआती 1 + रुककर 3 बार दोबारा जुड़ा
  });

  test('connection ES_STABLE_MS तक टिक जाए तो अगले झटके पर इंतज़ार फिर शुरू से (लंबी सज़ा न मिले)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const bo = await page.evaluate(() => {
      ES_BACKOFF_BASE_MS = 30; ES_BACKOFF_MAX_MS = 100; ES_STABLE_MS = 60000;
      window.FetchLiveSource = function () { this.readyState = 1; this.addEventListener = function () {}; this.close = function () { this.readyState = 2; }; };
      _openLive(activeHQ, activeCat);
      _esBackoffMs = 100; // पहले कई बार टूट चुका था
      const es = liveSource;
      es.onopen();
      _esOpenedAt = Date.now() - 61000; // 61 सेकंड टिका रहा
      es.readyState = 0; es.onerror();
      return _esBackoffMs;
    });
    expect(bo).toBe(30);
  });

  test('रुकने के दौरान tab बदल गया तो पुराने tab के लिए दोबारा न जुड़े', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      ES_BACKOFF_BASE_MS = 30;
      let created = 0;
      window.FetchLiveSource = function () { created++; this.readyState = 1; this.addEventListener = function () {}; this.close = function () { this.readyState = 2; }; };
      _esBackoffMs = 0; _esOpenedAt = 0;
      _openLive(activeHQ, activeCat);
      const es = liveSource;
      es.readyState = 0; es.onerror();
      activeCat = activeCat === CATS[1] ? CATS[2] : CATS[1]; // इंतज़ार के बीच उपयोगकर्ता दूसरी श्रेणी पर चला गया
      setTimeout(() => resolve({ created: created }), 150);
    }));
    expect(r.created).toBe(1); // सिर्फ़ शुरुआती — पुराने tab के लिए दोबारा नहीं जुड़ा
  });

  // जांच (App Check "outdated client" ~15%): EventSource में App Check header जा ही नहीं सकता —
  // शक है कि सर्वर live-sync मना करता है। एक बार भी खुले बिना सीधे CLOSED = HTTP स्तर पर मनाही
  test('live-sync एक बार भी जुड़े बिना सीधे CLOSED हो तो "एरर लॉग" में दर्ज हो — पर हर ऐप-खुलने पर सिर्फ़ एक बार', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await page.evaluate(() => {
      const logs = [];
      window.logErr = function (c, m, x) { logs.push({ c: c, m: String(m), x: String(x || '') }); };
      window.FetchLiveSource = function () { this.readyState = 0; this.addEventListener = function () {}; this.close = function () { this.readyState = 2; }; };
      _sseNeverOpenedLogged = false;
      _openLive(activeHQ, activeCat);
      let es = liveSource; es.readyState = 2; es.onerror();
      _openLive(activeHQ, activeCat); // दोबारा वही — इस बार लॉग नहीं होना चाहिए
      es = liveSource; es.readyState = 2; es.onerror();
      return logs.filter((l) => l.c === 'sse-never-opened');
    });
    expect(r.length).toBe(1);
    expect(r[0].x).toContain('AppCheck token'); // token था या नहीं — यही असली सुराग है
  });

  test('fetch stream की मनाही — लॉग में तरीका (fetch), HTTP status और सर्वर का जवाब भी दर्ज हो', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      const logs = [];
      window.logErr = function (c, m, x) { if (c === 'sse-never-opened') logs.push(String(x || '')); };
      var orig = window.fetch;
      window.fetch = function (url, opts) {
        if (opts && opts.headers && opts.headers.Accept === 'text/event-stream') {
          return Promise.resolve(new Response('{\n  "error" : "Permission denied"\n}', { status: 403 }));
        }
        return orig(url, opts);
      };
      _sseNeverOpenedLogged = false;
      _openLive(activeHQ, activeCat);
      setTimeout(() => { window.fetch = orig; stopListen(); resolve(logs); }, 300);
    }));
    expect(r.length).toBe(1);
    expect(r[0]).toContain('तरीका: fetch');
    expect(r[0]).toContain('HTTP 403');
    expect(r[0]).toContain('"error" : "Permission denied"');
  });

  test('जुड़ने के बाद टूटे (जैसे token expire) या नेट का झटका (readyState 0) हो — तो "कभी नहीं जुड़ा" वाला लॉग न बने', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const n = await page.evaluate(() => {
      let count = 0;
      window.logErr = function (c) { if (c === 'sse-never-opened') count++; };
      window.FetchLiveSource = function () { this.readyState = 1; this.addEventListener = function () {}; this.close = function () { this.readyState = 2; }; };
      _sseNeverOpenedLogged = false;
      _openLive(activeHQ, activeCat);
      let es = liveSource; es.onopen(); es.readyState = 2; es.onerror(); // खुला था, फिर बंद
      _openLive(activeHQ, activeCat);
      es = liveSource; es.readyState = 0; es.onerror(); // नेट का झटका, कभी खुला नहीं
      return count;
    });
    expect(n).toBe(0);
  });

  // कदम 2: EventSource App Check header नहीं भेज सकता था, इसलिए हर device पर live-sync मना होता था
  // ("sse-never-opened" हर HQ से)। FetchLiveSource वही streaming endpoint fetch से खोलता है — fetch
  // wrapper token और App Check header जोड़ता है। यहां नकली stream (ReadableStream) से उसका व्यवहार जांचते हैं
  const fakeStream = (page, spec) => page.evaluate((sp) => new Promise((resolve) => {
    var enc = new TextEncoder(), ctl = null, seenOpts = null, seenUrl = null;
    var orig = window.fetch;
    window._rawFetchForTest = orig;
    window.fetch = function (url, opts) {
      if (opts && opts.headers && opts.headers.Accept === 'text/event-stream') {
        seenOpts = opts; seenUrl = url;
        if (sp.status && sp.status !== 200) return Promise.resolve(new Response('{"error":"Permission denied"}', { status: sp.status }));
        var body = new ReadableStream({ start: function (c) { ctl = c; } });
        return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
      }
      return orig(url, opts);
    };
    var es = new FetchLiveSource(FB + '/' + fbPath('आदेगांव', 'कुल उपभोक्ता') + '.json');
    var got = [], errs = [], opened = false;
    es.addEventListener('put', function (e) { got.push(['put', JSON.parse(e.data)]); });
    es.addEventListener('patch', function (e) { got.push(['patch', JSON.parse(e.data)]); });
    es.onopen = function () { opened = true; };
    es.onerror = function () { errs.push(es.readyState); };
    setTimeout(function () {
      (sp.chunks || []).forEach(function (ch) { if (ctl) ctl.enqueue(enc.encode(ch)); });
      if (sp.closeStream && ctl) ctl.close();
      if (sp.userClose) { es.close(); if (ctl) ctl.enqueue(enc.encode('event: put\ndata: {"path":"/","data":1}\n\n')); }
      setTimeout(function () {
        window.fetch = orig;
        resolve({ opened: opened, got: got, errs: errs, rs: es.readyState, accept: seenOpts && seenOpts.headers.Accept, url: seenUrl });
      }, 80);
    }, 30);
  }), spec);

  test('FetchLiveSource — put/patch event सही पढ़े, एक event दो टुकड़ों में आए तब भी; keep-alive अनदेखा', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await fakeStream(page, { chunks: [
      'event: put\ndata: {"path":"/","data":{"1":{"acc":"1"}}}\n\nevent: keep-alive\ndata: null\n\nevent: pat',
      'ch\ndata: {"path":"/","data":{"1":{"acc":"1","status":"paid"}}}\n\n',
    ] });
    expect(r.opened).toBe(true);
    expect(r.accept).toBe('text/event-stream');
    expect(r.url).not.toContain('auth='); // token fetch wrapper खुद जोड़ता है — URL में दोबारा नहीं
    expect(r.got).toEqual([
      ['put', { path: '/', data: { 1: { acc: '1' } } }],
      ['patch', { path: '/', data: { 1: { acc: '1', status: 'paid' } } }],
    ]);
    expect(r.errs).toEqual([]);
  });

  test('FetchLiveSource — सर्वर की मनाही (403) = एक बार भी खुले बिना CLOSED (readyState 2), EventSource जैसा', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await fakeStream(page, { status: 403 });
    expect(r.opened).toBe(false);
    expect(r.errs).toEqual([2]);
  });

  test('FetchLiveSource — "auth_revoked" (token expire) या "cancel" पर CLOSED, stream का टूटना = नेट का झटका (0)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const a = await fakeStream(page, { chunks: ['event: auth_revoked\ndata: "credential is no longer valid"\n\n'] });
    expect(a.opened).toBe(true);
    expect(a.errs).toEqual([2]);
    const c = await fakeStream(page, { chunks: ['event: cancel\ndata: null\n\n'] });
    expect(c.errs).toEqual([2]);
    const d = await fakeStream(page, { closeStream: true });
    expect(d.errs).toEqual([0]);
  });

  test('FetchLiveSource — close() के बाद कोई event या error न आए', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await fakeStream(page, { userClose: true });
    expect(r.got).toEqual([]);
    expect(r.errs).toEqual([]);
    expect(r.rs).toBe(2);
  });

  // v9.167 — असली (v9.166 लॉग): stream login/सही HQ account पक्का होने से पहले खुल जाता → "Permission denied"
  test('FetchLiveSource — stream तभी खुले जब सही HQ account पक्का हो और उसका ताज़ा token मिल जाए', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      var order = [];
      var hqOk = null;
      window.firebase = { auth: function () { return { currentUser: { email: 'x', getIdToken: function () { order.push('token'); return Promise.resolve('hq-token'); } } }; } };
      AUTH_READY = true;
      var origEnsure = window._ensureCorrectHqAuth;
      window._ensureCorrectHqAuth = function (cb) { order.push('ensure'); hqOk = cb; }; // sign-in अभी चल रहा है
      var raw = _rawFetch;
      _rawFetch = function (url, opts) {
        if (opts && opts.headers && opts.headers.Accept === 'text/event-stream') { order.push('stream:' + (String(url).indexOf('auth=hq-token') > -1 ? 'hq' : 'other')); return new Promise(function () {}); }
        return raw(url, opts);
      };
      AC_READY = true;
      var es = new FetchLiveSource(FB + '/' + fbPath('आदेगांव', 'कुल उपभोक्ता') + '.json');
      setTimeout(() => {
        var before = order.slice();
        hqOk(); // अब सही account तय हुआ
        setTimeout(() => {
          es.close(); _rawFetch = raw; window._ensureCorrectHqAuth = origEnsure; window.firebase = undefined;
          resolve({ before: before, after: order });
        }, 100);
      }, 100);
    }));
    expect(r.before).toEqual(['ensure']); // account पक्का होने तक stream नहीं खुला
    expect(r.after).toEqual(['ensure', 'token', 'stream:hq']); // फिर ताज़ा token से खुला
  });

  test('असली fetch wrapper से जाए — login token (?auth=) और App Check header दोनों लगें', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      var raw = _rawFetch;
      ID_TOKEN = 'tok-123'; AC_TOKEN = 'ac-456'; AC_READY = true;
      _rawFetch = function (url, opts) {
        if (opts && opts.headers && opts.headers.Accept === 'text/event-stream') {
          _rawFetch = raw;
          resolve({ url: String(url), ac: opts.headers['X-Firebase-AppCheck'] });
          return new Promise(function () {});
        }
        return raw(url, opts);
      };
      var es = new FetchLiveSource(FB + '/' + fbPath('आदेगांव', 'कुल उपभोक्ता') + '.json');
      setTimeout(function () { es.close(); }, 500);
    }));
    expect(r.url).toContain('auth=tok-123');
    expect(r.ac).toBe('ac-456');
  });

  test('_tokenExpiryRecheck — token-expiry reconnect से पहले हल्की ETag जांच हो; कुछ नहीं बदला (304) तो भारी reconnect टलता रहे, EventSource दोबारा न खुले (JE का सवाल: "ऐप खुला छोड़ने पर cost बढ़ती है क्या?")', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.waitForFunction(() => !!liveSource, null, { timeout: 15000 });
    const r = await page.evaluate(() => new Promise((resolve) => {
      window.ES_RECONNECT_DELAY_MS = 10; // तेज़ जांच के लिए छोटा किया (टेस्ट-only)
      window.TOKEN_RECHECK_MS = 40;
      var sawEtagHeader = false, startListenCalls = 0;
      var origStartListen = window.startListen;
      window.startListen = function (h, c) { startListenCalls++; return origStartListen(h, c); };
      var orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf(fbPath(activeHQ, activeCat)) > -1 && (!opts || !opts.method)) {
          if (opts && opts.headers && opts.headers['X-Firebase-ETag']) sawEtagHeader = true;
          return Promise.resolve({ status: 304, ok: false, headers: { get: () => null } });
        }
        return orig(url, opts);
      };
      var es = liveSource;
      es.close(); // असली (network-blocked) EventSource का अपना देर वाला error न आए — वरना वह भी थोपे गए readyState=2 से "पूरी तरह बंद" रास्ते पर जाकर दूसरी बार reconnect चला देता (test-race, ~1/15 flaky)
      Object.defineProperty(es, 'readyState', { value: 2, configurable: true });
      es.onerror(); // token expire जैसा — पहला attempt
      setTimeout(() => {
        window.fetch = orig;
        window.startListen = origStartListen;
        resolve({ sawEtagHeader: sawEtagHeader, startListenCalls: startListenCalls, esOpenAgain: liveSource === es ? false : !!liveSource });
      }, 150); // ES_RECONNECT_DELAY_MS(10) + TOKEN_RECHECK_MS(40) से काफ़ी ज़्यादा — दोनों टिक चुके हों
    }));
    expect(r.sawEtagHeader).toBe(true);   // हल्की जांच हुई
    expect(r.startListenCalls).toBe(0);   // कुछ नहीं बदला — भारी reconnect (नया EventSource) नहीं हुआ
    expect(r.esOpenAgain).toBe(false);    // कोई नया live connection नहीं खुला
  });

  test('_tokenExpiryRecheck — कुछ बदला निकले (200) तो असली (पूरा) reconnect हो, _openLive बुलाया जाए', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.waitForFunction(() => !!liveSource, null, { timeout: 15000 });
    const r = await page.evaluate(() => new Promise((resolve) => {
      window.ES_RECONNECT_DELAY_MS = 10;
      var openLiveCalls = 0;
      var origOpenLive = window._openLive;
      window._openLive = function (h, c) { openLiveCalls++; return origOpenLive(h, c); };
      var orig = window.fetch;
      window.fetch = function (url, opts) {
        // सिर्फ़ हल्की ETag जांच नकली — live-stream (FetchLiveSource) की अपनी request असली रास्ते से जाए
        var isStream = opts && opts.headers && opts.headers.Accept === 'text/event-stream';
        if (typeof url === 'string' && url.indexOf(fbPath(activeHQ, activeCat)) > -1 && (!opts || !opts.method) && !isStream) {
          return Promise.resolve({
            ok: true, status: 200, headers: { get: () => '"new-etag"' },
            json: () => Promise.resolve([{ acc: '1', status: 'pending', amount: 100 }]),
          });
        }
        return orig(url, opts);
      };
      var es = liveSource;
      es.close(); // असली (network-blocked) EventSource का अपना देर वाला error न आए — वरना वह भी थोपे गए readyState=2 से "पूरी तरह बंद" रास्ते पर जाकर दूसरी बार reconnect चला देता (test-race, ~1/15 flaky)
      Object.defineProperty(es, 'readyState', { value: 2, configurable: true });
      es.onerror();
      setTimeout(() => {
        window.fetch = orig;
        window._openLive = origOpenLive;
        resolve({ openLiveCalls: openLiveCalls });
      }, 300); // भारी parallel-suite load में 100ms कभी-कभी कम पड़ता था — मार्जिन बढ़ाया
    }));
    expect(r.openLiveCalls).toBe(1); // बदला हुआ data मिला — असली reconnect हुआ
  });

  test('_tokenExpiryRecheck — हल्की जांच ही नाकाम (network error) हो तो पुराने, हमेशा-safe रास्ते (_openLive) पर लौट जाए', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.waitForFunction(() => !!liveSource, null, { timeout: 15000 });
    const r = await page.evaluate(() => new Promise((resolve) => {
      window.ES_RECONNECT_DELAY_MS = 10;
      var openLiveCalls = 0;
      var origOpenLive = window._openLive;
      window._openLive = function (h, c) { openLiveCalls++; return origOpenLive(h, c); };
      var orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf(fbPath(activeHQ, activeCat)) > -1 && (!opts || !opts.method)) {
          return Promise.reject(new Error('network down'));
        }
        return orig(url, opts);
      };
      var es = liveSource;
      es.close(); // असली (network-blocked) EventSource का अपना देर वाला error न आए — वरना वह भी थोपे गए readyState=2 से "पूरी तरह बंद" रास्ते पर जाकर दूसरी बार reconnect चला देता (test-race, ~1/15 flaky)
      Object.defineProperty(es, 'readyState', { value: 2, configurable: true });
      es.onerror();
      setTimeout(() => {
        window.fetch = orig;
        window._openLive = origOpenLive;
        resolve({ openLiveCalls: openLiveCalls });
      }, 300); // भारी parallel-suite load में 100ms कभी-कभी कम पड़ता था — मार्जिन बढ़ाया
    }));
    expect(r.openLiveCalls).toBe(1); // जांच नाकाम — फिर भी असली reconnect की कोशिश हुई, डेटा अटका न रहे
  });

  test('pollOnce (आख़िरी सहारे वाला भारी fallback) — ETag भेजे, और HTTP 304 (कुछ नहीं बदला) पर कोई दोबारा render/error न हो', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.waitForFunction(() => !!liveSource, null, { timeout: 15000 });
    const r = await page.evaluate(() => new Promise((resolve) => {
      var es = liveSource;
      Object.defineProperty(es, 'readyState', { value: 2, configurable: true });
      var sawEtagHeader = false, renderCalls = 0;
      var origRenderListWith = renderListWith;
      window.renderListWith = function (d) { renderCalls++; origRenderListWith(d); };
      var orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf(fbPath(activeHQ, activeCat)) > -1) {
          if (opts && opts.headers && opts.headers['X-Firebase-ETag']) sawEtagHeader = true;
          return Promise.resolve({ status: 304, ok: false, headers: { get: () => null } });
        }
        return orig(url, opts);
      };
      es.onerror(); es.onerror(); es.onerror(); es.onerror(); // polling शुरू करो — यही पहला pollOnce() ट्रिगर करता है
      setTimeout(() => {
        window.fetch = orig;
        window.renderListWith = origRenderListWith;
        resolve({ sawEtagHeader: sawEtagHeader, renderCalls: renderCalls });
      }, 300);
    }));
    expect(r.sawEtagHeader).toBe(true);
    expect(r.renderCalls).toBe(0); // 304 पर न दोबारा render हुआ, न ही असली null-data समझकर कोई गड़बड़ हुई
  });

  test('fbGet — cached data हो तो background refresh ETag header भेजे', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      cSet(activeHQ, activeCat, [{ acc: '1', status: 'pending', amount: 100 }]);
      _etagSet(activeHQ, activeCat, '"etag-abc"'); // पहले से ETag store है
      var sawEtag = false, sawIfNoneMatch = false;
      var orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf(fbPath(activeHQ, activeCat)) > -1 && (!opts || !opts.method)) {
          if (opts && opts.headers && opts.headers['X-Firebase-ETag']) sawEtag = true;
          if (opts && opts.headers && opts.headers['if-none-match']) sawIfNoneMatch = true;
          return Promise.resolve({ status: 304, ok: false, headers: { get: () => null } });
        }
        return orig(url, opts);
      };
      fbGet(activeHQ, activeCat, function () {});
      setTimeout(() => { window.fetch = orig; resolve({ sawEtag, sawIfNoneMatch }); }, 200);
    }));
    expect(r.sawEtag).toBe(true);       // ETag header भेजा
    expect(r.sawIfNoneMatch).toBe(true); // पहले से store ETag if-none-match में भेजा
  });

  test('fbGet — background refresh 304 मिले तो cache/render न बदले', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      var origData = [{ acc: '99', status: 'pending', amount: 500 }];
      cSet(activeHQ, activeCat, origData);
      var renderCalls = 0;
      var origRender = renderListWith;
      window.renderListWith = function (d) { renderCalls++; origRender(d); };
      var orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf(fbPath(activeHQ, activeCat)) > -1 && (!opts || !opts.method)) {
          return Promise.resolve({ status: 304, ok: false, headers: { get: () => null } });
        }
        return orig(url, opts);
      };
      fbGet(activeHQ, activeCat, function () {});
      setTimeout(() => {
        window.fetch = orig;
        window.renderListWith = origRender;
        resolve({ cacheLen: cGet(activeHQ, activeCat).length, renderCalls });
      }, 200);
    }));
    expect(r.cacheLen).toBe(1);    // cache पहले जैसी — 304 ने कुछ नहीं बदला
    expect(r.renderCalls).toBe(0); // render नहीं हुआ
  });

  test('SW update hidden — document.hidden पर controllerchange _reloadPage() बुलाए, banner नहीं', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      // SW registration पर हो सकता है पहले से banner आ गया हो — clean slate चाहिए
      var existing = document.getElementById('update-banner');
      if (existing) existing.remove();
      _pendingUpdate = false;
      var reloadCalled = false;
      window._reloadPage = function () { reloadCalled = true; };
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      return { reloadCalled: reloadCalled, hasBanner: !!document.getElementById('update-banner') };
    });
    expect(r.reloadCalled).toBe(true);  // hidden था — silently reload
    expect(r.hasBanner).toBe(false);    // banner नहीं — user की screen पर nothing shown
  });

  test('SW update visible — banner दिखे और _pendingUpdate set हो', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      var existing = document.getElementById('update-banner');
      if (existing) existing.remove();
      _pendingUpdate = false;
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
      return {
        bannerVisible: !!document.getElementById('update-banner'),
        pendingUpdate: _pendingUpdate,
      };
    });
    expect(r.bannerVisible).toBe(true);
    expect(r.pendingUpdate).toBe(true);
  });

  test('startListen — EventSource सफलतापूर्वक बनते ही तुरंत redundant REST fetch न हो (caller पहले ही data दिखा चुका होता है, और EventSource खुद जुड़ते ही पूरा data भेजता है)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const immediateFetchCount = await page.evaluate(() => {
      var count = 0;
      var orig = window.fetch;
      window.fetch = function (url, opts) {
        // live-stream खुद (Accept: text/event-stream) redundant नहीं — वही तो "EventSource" है (देखें FetchLiveSource)
        var isStream = opts && opts.headers && opts.headers.Accept === 'text/event-stream';
        if (typeof url === 'string' && url.indexOf(fbPath(activeHQ, activeCat)) > -1 && (!opts || !opts.method) && !isStream) count++;
        return orig(url, opts);
      };
      startListen(activeHQ, activeCat); // सिर्फ़ synchronous हिस्सा जांचना है — EventSource async है
      window.fetch = orig;
      return count;
    });
    expect(immediateFetchCount).toBe(0);
  });

  test('startListen — tab-revisit: हाल ही में (grace window में) ताज़ा देखी list पर वापस आने पर कुछ नहीं बदला (304) तो _openLive तुरंत न बुलाए, ETag header भेजा जाए', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      var hq = 'आदेगांव', cat = 'कुल उपभोक्ता';
      cSet(hq, cat, [{ acc: '1', status: 'pending', amount: 100 }]);
      _lastLiveAt[hq + '/' + cat] = Date.now(); // अभी-अभी ताज़ा सिंक हुआ मान लो
      var openLiveCalls = 0;
      var origOpenLive = window._openLive;
      window._openLive = function () { openLiveCalls++; };
      var sawEtagHeader = false;
      var orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf(fbPath(hq, cat)) > -1 && (!opts || !opts.method)) {
          if (opts && opts.headers && opts.headers['X-Firebase-ETag']) sawEtagHeader = true;
          return Promise.resolve({ status: 304, ok: false, headers: { get: () => null } });
        }
        return orig(url, opts);
      };
      startListen(hq, cat);
      setTimeout(() => {
        window.fetch = orig;
        window._openLive = origOpenLive;
        resolve({ sawEtagHeader: sawEtagHeader, openLiveCalls: openLiveCalls });
      }, 150);
    }));
    expect(r.sawEtagHeader).toBe(true);
    expect(r.openLiveCalls).toBe(0); // 304 पर SSE तुरंत नहीं खुला
  });

  test('startListen — tab-revisit: 304 के बाद grace window बीतते ही (उपयोगकर्ता अब भी उसी tab पर हो तो) असली live-connection अपने-आप जुड़े', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      var hq = 'आदेगांव', cat = 'कुल उपभोक्ता';
      activeHQ = hq; activeCat = cat;
      cSet(hq, cat, [{ acc: '1', status: 'pending', amount: 100 }]);
      var origGrace = window.TAB_REVISIT_GRACE_MS;
      window.TAB_REVISIT_GRACE_MS = 60; // तेज़ जांच के लिए छोटा किया (टेस्ट-only)
      _lastLiveAt[hq + '/' + cat] = Date.now();
      var openLiveCalls = 0;
      var origOpenLive = window._openLive;
      window._openLive = function () { openLiveCalls++; };
      var orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf(fbPath(hq, cat)) > -1 && (!opts || !opts.method)) {
          return Promise.resolve({ status: 304, ok: false, headers: { get: () => null } });
        }
        return orig(url, opts);
      };
      startListen(hq, cat);
      setTimeout(() => {
        var beforeGraceEnds = openLiveCalls; // 60ms अभी नहीं बीते
        setTimeout(() => {
          window.fetch = orig;
          window._openLive = origOpenLive;
          window.TAB_REVISIT_GRACE_MS = origGrace;
          resolve({ beforeGraceEnds: beforeGraceEnds, afterGraceEnds: openLiveCalls });
        }, 250);
      }, 20);
    }));
    expect(r.beforeGraceEnds).toBe(0);
    expect(r.afterGraceEnds).toBe(1);
  });

  test('startListen — tab-revisit: deferred reconnect सिर्फ़ तभी चले जब उपयोगकर्ता अब भी उसी tab पर हो — बीच में कहीं और चले गए तो न चले', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      var hq = 'आदेगांव', cat = 'कुल उपभोक्ता';
      activeHQ = hq; activeCat = cat;
      cSet(hq, cat, [{ acc: '1', status: 'pending', amount: 100 }]);
      var origGrace = window.TAB_REVISIT_GRACE_MS;
      window.TAB_REVISIT_GRACE_MS = 60;
      _lastLiveAt[hq + '/' + cat] = Date.now();
      var openLiveCalls = 0;
      var origOpenLive = window._openLive;
      window._openLive = function () { openLiveCalls++; };
      var orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf(fbPath(hq, cat)) > -1 && (!opts || !opts.method)) {
          return Promise.resolve({ status: 304, ok: false, headers: { get: () => null } });
        }
        return orig(url, opts);
      };
      startListen(hq, cat);
      setTimeout(() => { activeCat = 'घरेलू'; }, 15); // grace बीतने से पहले ही कहीं और चले गए
      setTimeout(() => {
        window.fetch = orig;
        window._openLive = origOpenLive;
        window.TAB_REVISIT_GRACE_MS = origGrace;
        resolve({ openLiveCalls: openLiveCalls });
      }, 250);
    }));
    expect(r.openLiveCalls).toBe(0); // पुरानी tab के लिए दोबारा live न जुड़े
  });

  test('startListen — tab-revisit: कुछ बदला निकले (200) तो सीधे _openLive बुलाया जाए (वही ताज़ा data ले आएगा)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      var hq = 'आदेगांव', cat = 'कुल उपभोक्ता';
      cSet(hq, cat, [{ acc: '1', status: 'pending', amount: 100 }]);
      _lastLiveAt[hq + '/' + cat] = Date.now();
      var openLiveCalls = 0;
      var origOpenLive = window._openLive;
      window._openLive = function () { openLiveCalls++; };
      var orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf(fbPath(hq, cat)) > -1 && (!opts || !opts.method)) {
          return Promise.resolve({
            ok: true, status: 200, headers: { get: () => '"new-etag"' },
            json: () => Promise.resolve([{ acc: '1', status: 'paid', amount: 100 }]),
          });
        }
        return orig(url, opts);
      };
      startListen(hq, cat);
      setTimeout(() => {
        window.fetch = orig;
        window._openLive = origOpenLive;
        resolve({ openLiveCalls: openLiveCalls });
      }, 300);
    }));
    expect(r.openLiveCalls).toBe(1);
  });

  test('startListen — tab-revisit: पहली बार (_lastLiveAt न हो) — कोई ETag pre-check नहीं, सीधे _openLive (पुराना व्यवहार अपरिवर्तित)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      var hq = 'पिंडरई', cat = 'कुल उपभोक्ता'; // इस key का _lastLiveAt कभी नहीं भरा
      var openLiveCalls = 0, preCheckFetches = 0;
      var origOpenLive = window._openLive;
      window._openLive = function () { openLiveCalls++; };
      var orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf(fbPath(hq, cat)) > -1 && (!opts || !opts.method)) preCheckFetches++;
        return orig(url, opts);
      };
      startListen(hq, cat);
      window.fetch = orig;
      window._openLive = origOpenLive;
      return { openLiveCalls: openLiveCalls, preCheckFetches: preCheckFetches };
    });
    expect(r.preCheckFetches).toBe(0);
    expect(r.openLiveCalls).toBe(1);
  });

  test('startListen — tab-revisit: offline pending बदलाव हों तो gate न लगे, सीधे _openLive (stale cache पर भरोसा न किया जाए)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      var hq = 'आदेगांव', cat = 'कुल उपभोक्ता';
      cSet(hq, cat, [{ acc: '1', status: 'pending', amount: 100 }]);
      _lastLiveAt[hq + '/' + cat] = Date.now();
      markPending(hq, cat, 'put');
      var openLiveCalls = 0, preCheckFetches = 0;
      var origOpenLive = window._openLive;
      window._openLive = function () { openLiveCalls++; };
      var orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf(fbPath(hq, cat)) > -1 && (!opts || !opts.method)) preCheckFetches++;
        return orig(url, opts);
      };
      startListen(hq, cat);
      window.fetch = orig;
      window._openLive = origOpenLive;
      clearPendingKey(cKey(hq, cat));
      return { openLiveCalls: openLiveCalls, preCheckFetches: preCheckFetches };
    });
    expect(r.preCheckFetches).toBe(0);
    expect(r.openLiveCalls).toBe(1);
  });

  test('_cashRefreshAll — 5 मिनट के cooldown के अंदर दोबारा बुलाने पर network fetch न हो (बैकअप/village-report/WhatsApp-scorecard बार-बार खुलने पर बचत)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      var fetchCount = 0;
      var orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('टेस्ट_HQ9') > -1) {
          fetchCount++;
          return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve([{ acc: '1', status: 'pending' }]) });
        }
        return orig(url, opts);
      };
      _cashRefreshAll(['टेस्ट HQ9'], function () {
        var firstCount = fetchCount;
        _cashRefreshAll(['टेस्ट HQ9'], function () {
          window.fetch = orig;
          resolve({ firstCount: firstCount, secondCount: fetchCount });
        });
      });
    }));
    expect(r.firstCount).toBeGreaterThan(0);
    expect(r.secondCount).toBe(r.firstCount);
  });

  test('_cashRefreshAll — force=true हो तो cooldown नज़रअंदाज़ करके हमेशा ताज़ा fetch हो (कैश-लिस्ट apply में सटीकता सबसे ज़रूरी)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      var fetchCount = 0;
      var orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('टेस्ट_HQ10') > -1) {
          fetchCount++;
          return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve([{ acc: '1', status: 'pending' }]) });
        }
        return orig(url, opts);
      };
      _cashRefreshAll(['टेस्ट HQ10'], function () {
        var firstCount = fetchCount;
        _cashRefreshAll(['टेस्ट HQ10'], function () {
          window.fetch = orig;
          resolve({ firstCount: firstCount, secondCount: fetchCount });
        }, true);
      });
    }));
    expect(r.secondCount).toBeGreaterThan(r.firstCount);
  });

  test('openWaScorecard ("स्कोरकार्ड डिस्प्ले") — खोलते ही network fetch न हो, सिर्फ़ cache से दिखे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const fetchCount = await page.evaluate(() => new Promise((resolve) => {
      var count = 0;
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('.json') > -1 && (!opts || !opts.method)) count++;
        return orig(url, opts);
      };
      openWaScorecard();
      setTimeout(() => { window.fetch = orig; resolve(count); }, 300);
    }));
    expect(fetchCount).toBe(0);
  });

  test('loadWaScorecard (रिफ्रेश बटन) — force=true के साथ _cashRefreshAll बुलाए, cooldown नज़रअंदाज़ करके', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const forced = await page.evaluate(() => new Promise((resolve) => {
      var seenForce = null;
      const orig = _cashRefreshAll;
      _cashRefreshAll = function (hqs, cb, force) { seenForce = force; cb(); };
      loadWaScorecard();
      setTimeout(() => { _cashRefreshAll = orig; resolve(seenForce); }, 100);
    }));
    expect(forced).toBe(true);
  });

  test('renderScBody (मुख्य "स्कोरकार्ड" बटन) — 5 मिनट के cooldown के अंदर दोबारा खोलने/HQ-tab बदलने पर network fetch न हो (bug: पहले हर बार 8 categories बिना रोक-टोक फिर से डाउनलोड होती थीं)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      scActiveHQ = 'आदेगांव';
      var fetchCount = 0;
      var orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('आदेगांव') > -1 && (!opts || !opts.method)) {
          fetchCount++;
          return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve([]) }); // असली fetch जैसा सफल जवाब — तभी cooldown रिकॉर्ड होगा
        }
        return orig(url, opts);
      };
      renderScBody();
      setTimeout(() => {
        var firstCount = fetchCount;
        renderScBody(); // दोबारा (जैसे HQ-tab फिर क्लिक करना) — cooldown के अंदर
        setTimeout(() => { window.fetch = orig; resolve({ firstCount: firstCount, secondCount: fetchCount }); }, 200);
      }, 300);
    }));
    expect(r.firstCount).toBeGreaterThan(0); // पहली बार असली fetch हुआ
    expect(r.secondCount).toBe(r.firstCount); // दोबारा cooldown के अंदर — कोई नया fetch नहीं
  });

  test('lineman के लिए "स्कोरकार्ड" बटन छुपा रहे (header + bottom-nav) — यह JE का काम है, हर खुलने पर कई categories का data मंगाता है', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const hidden = await page.evaluate(() => ({
      hdr: getComputedStyle(document.getElementById('sc-hdr-btn')).display,
      bnav: getComputedStyle(document.getElementById('sc-bnav-btn')).display,
    }));
    expect(hidden.hdr).toBe('none');
    expect(hidden.bnav).toBe('none');
  });

  test('openScorecard — lineman सीधे function बुलाए तो भी न खुले (defense-in-depth)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const opened = await page.evaluate(() => {
      openScorecard();
      return document.getElementById('sc-overlay').classList.contains('open');
    });
    expect(opened).toBe(false);
  });

  test('visibilitychange — देर तक background में पड़े रहने पर listen/timer रुकें (bug: background में पड़ा device घंटों तक चुपचाप bandwidth खर्च करता रहना)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.waitForFunction(() => !!catNamesTimer, null, { timeout: 15000 }); // startListen fbGet callback के बाद async चलता है
    const r = await page.evaluate(() => new Promise((resolve) => {
      _pendingUpdate = false; // नया handler: pending update होने पर reload — यहां यही जांचना नहीं है
      LISTEN_HIDE_GRACE_MS = 60; // टेस्ट में छोटा करके तुरंत जांच
      var hadTimerBefore = !!catNamesTimer;
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      setTimeout(() => {
        var timerClearedOnHide = !catNamesTimer;
        var listenClearedOnHide = !liveSource && !pollTimer;
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        setTimeout(() => {
          resolve({ hadTimerBefore: hadTimerBefore, timerClearedOnHide: timerClearedOnHide, listenClearedOnHide: listenClearedOnHide, timerResumedOnShow: !!catNamesTimer });
        }, 50);
      }, 200);
    }));
    expect(r.hadTimerBefore).toBe(true);
    expect(r.timerClearedOnHide).toBe(true);
    expect(r.listenClearedOnHide).toBe(true);
    expect(r.timerResumedOnShow).toBe(true);
  });

  // असली bandwidth bug: startListen() हर बार नया EventSource खोलता है और Firebase जुड़ते ही पहले
  // "put" event में पूरी list भेज देता है। लाइनमैन दिन भर ऐप से बाहर-अंदर होता रहता है (WhatsApp,
  // कैमरा, कॉल) — हर बार पूरी "कुल उपभोक्ता" लिस्ट दोबारा उतरती थी
  test('visibilitychange — थोड़ी देर के लिए ऐप से बाहर जाकर वापस आने पर connection टूटे ही नहीं (वरना हर बार पूरी लिस्ट दोबारा download)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.waitForFunction(() => !!liveSource || !!pollTimer, null, { timeout: 15000 });
    const r = await page.evaluate(() => new Promise((resolve) => {
      _pendingUpdate = false;
      var before = liveSource;
      var restarted = 0;
      var origStart = window.startListen;
      window.startListen = function (h, c) { restarted++; return origStart(h, c); };
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      setTimeout(() => { // grace से बहुत पहले वापस आ गए
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        setTimeout(() => {
          window.startListen = origStart;
          resolve({ restarted: restarted, sameSource: liveSource === before, stillLive: !!liveSource || !!pollTimer });
        }, 100);
      }, 100);
    }));
    expect(r.restarted).toBe(0);   // दोबारा जुड़ने की कोशिश ही न हो
    expect(r.sameSource).toBe(true); // वही पुराना connection चलता रहे
    expect(r.stillLive).toBe(true);
  });
});

test.describe('Firebase download quota — ETag device पर सहेजा जाए (bug: ऐप बंद/minimize होते ही ETag मिट जाता, हर बार हर list पूरी दोबारा download)', () => {
  test('fbGet — पहली बार का ETag localStorage में सहेजा जाए और अगली बार if-none-match में भेजा जाए', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      localStorage.removeItem(ETAG_KEY);
      cSet('आदेगांव', 'कुल उपभोक्ता', [{ acc: '1', name: 'क', amt: 100 }]);
      _etagSet('आदेगांव', 'कुल उपभोक्ता', 'etag-abc');
    });
    const sent = await page.evaluate(() => new Promise((resolve) => {
      var orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf(fbPath('आदेगांव', 'कुल उपभोक्ता')) > -1) {
          window.fetch = orig;
          resolve((opts && opts.headers && opts.headers['if-none-match']) || null);
        }
        return orig(url, opts);
      };
      fbGet('आदेगांव', 'कुल उपभोक्ता', function () {});
      setTimeout(() => resolve('कोई request ही नहीं'), 5000);
    }));
    expect(sent).toBe('etag-abc');
  });

  test('_etagGet — cache खाली हो तो सहेजा ETag इस्तेमाल न हो (वरना 304 पर न नया data मिलेगा न पुराना)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      cSet('जोबा', 'घरेलू', [{ acc: '9', name: 'ख', amt: 5 }]);
      _etagSet('जोबा', 'घरेलू', 'etag-xyz');
      var withCache = _etagGet('जोबा', 'घरेलू');
      cSet('जोबा', 'घरेलू', []); // cache मिट गया (जैसे localStorage quota भरने पर)
      return { withCache: withCache, withoutCache: _etagGet('जोबा', 'घरेलू') };
    });
    expect(r.withCache).toBe('etag-xyz');
    expect(r.withoutCache).toBeNull();
  });

  test('prefetchAll — हर list ETag के साथ मांगे (bug: यह ETag इस्तेमाल ही नहीं करता था, रोज़ हर device की सारी श्रेणियां पूरी दोबारा download)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      CU = { role: 'lineman', name: 'प्रीफ़ेच', hq: 'आदेगांव' };
      localStorage.removeItem(_prefetchKey());
      cSet('आदेगांव', 'कुल उपभोक्ता', [{ acc: '1', name: 'क', amt: 100 }]);
      _etagSet('आदेगांव', 'कुल उपभोक्ता', 'etag-pf');
      var withEtag = 0, total = 0;
      var orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf(FB) === 0 && (!opts || !opts.method)) {
          total++;
          if (opts && opts.headers && opts.headers['X-Firebase-ETag']) withEtag++;
        }
        return orig(url, opts);
      };
      prefetchAll(true);
      setTimeout(() => { window.fetch = orig; _prefetchRun = false; resolve({ withEtag: withEtag, total: total }); }, 2500);
    }));
    expect(r.total).toBeGreaterThan(0);
    expect(r.withEtag).toBe(r.total); // हर एक request ETag के साथ
  });
});

// JE का सवाल: "यदि मुझे आज का टोटल नेटवर्क कॉस्ट यहीं पर रोकना है तो कोई एक ऐसी मास्टर स्विच
// बन सकती है क्या" — Firebase का no-cost download quota रोज़ 360 MB का है; किसी दिन वह भरता दिखे
// तो JE एक ही स्विच से सभी devices पर आगे का download रोक सकें
// असली production: ऐप का मीटर 15.3 MB दिखा रहा था जबकि Firebase Console पर उसी वक़्त 105 MB था
// (~7 गुना) — क्योंकि trackUsageBytes सिर्फ़ fbGet की दो जगह लगा था, यानी मीटर सिर्फ़ "लिस्ट खोलना"
// गिनता था और सबसे भारी खर्च (SSE, prefetch, चरण-3 की पूरी-DB जाँच) बिल्कुल नहीं
test.describe('डेटा उपयोग का मीटर — हर डाउनलोड गिना जाए, और दिन Firebase की खिड़की से मिले', () => {
  test('trackUsageOf हर रूप का आकार जोड़े, और खाली जवाब से कुछ न जुड़े', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      _usageBytes = 0;
      trackUsageOf({ a: 1 });            // JSON = {"a":1} → 7
      var afterObj = _usageBytes;
      trackUsageOf('abcde');             // string → 5
      var afterStr = _usageBytes;
      trackUsageOf(null); trackUsageOf(undefined);
      return { afterObj: afterObj, afterStr: afterStr, afterNull: _usageBytes };
    });
    expect(r.afterObj).toBe(7);
    expect(r.afterStr).toBe(12);
    expect(r.afterNull).toBe(12); // खाली जवाब ने कुछ नहीं जोड़ा
  });

  // असली नाप (10 सितंबर, 07:15): JE के तीन device मिलकर पूरे DC का 36% — क्योंकि JE को सभी
  // 6 मुख्यालय दिखते हैं और स्कोरकार्ड का हर HQ-tab उस HQ की आठों श्रेणियाँ पढ़ता है, वह भी
  // बिना ETag। fbGet/prefetchAll में ETag पहले से था, बस यही रास्ता छूटा हुआ था
  test('स्कोरकार्ड/कैश का refresh ETag भेजे, और 304 पर cache न छेड़े (डेटा पुराना भी न पड़े)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      var hq = 'आदेगांव', cat = 'कृषि';
      cSet(hq, cat, [{ acc: '1', name: 'पुराना', amount: 5, status: 'pending' }]);
      _etagSet(hq, cat, 'W/"tag-1"');
      _lastRefreshAt = {};
      var sent = null, mode = '304';
      var orig = window.fetch;
      window.fetch = function (u, o) {
        if (String(u).indexOf(fbPath(hq, cat)) > -1) {
          sent = (o && o.headers) ? o.headers['if-none-match'] : null;
          if (mode === '304') return Promise.resolve({ status: 304, ok: false, headers: { get: () => null } });
          return Promise.resolve({ status: 200, ok: true, headers: { get: () => 'W/"tag-2"' },
            json: () => Promise.resolve([{ acc: '1', name: 'नया', amount: 9, status: 'paid' }]) });
        }
        return orig(u, o);
      };
      _cashRefreshAll([hq], function () {
        var after304 = { sent: sent, name: (cGet(hq, cat)[0] || {}).name };
        // अब सर्वर पर सचमुच बदलाव — पूरी नई सूची आनी ही चाहिए
        mode = '200'; _lastRefreshAt = {};
        _cashRefreshAll([hq], function () {
          window.fetch = orig;
          resolve({ after304: after304,
            after200: { name: (cGet(hq, cat)[0] || {}).name, status: (cGet(hq, cat)[0] || {}).status },
            newTag: _etagAll()[hq + '/' + cat] });
        }, true);
      }, true);
    }));
    expect(r.after304.sent).toBe('W/"tag-1"'); // निशान भेजा गया
    expect(r.after304.name).toBe('पुराना');     // 304 — cache जस की तस, बेवजह नहीं छेड़ी
    expect(r.after200.name).toBe('नया');        // बदला हो तो ताज़ा डेटा आता ही है
    expect(r.after200.status).toBe('paid');
    expect(r.newTag).toBe('W/"tag-2"');         // और नया निशान सहेजा गया
  });

  test('सूची सचमुच खाली हो जाए तो cache भी खाली हो (304 और "खाली जवाब" अलग-अलग पहचाने जाएँ)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      var hq = 'बीबी', cat = 'कृषि';
      cSet(hq, cat, [{ acc: '1', name: 'क', amount: 5, status: 'pending' }]);
      _lastRefreshAt = {};
      var orig = window.fetch;
      window.fetch = function (u, o) {
        if (String(u).indexOf(fbPath(hq, cat)) > -1) {
          // सब records हटा दिए गए — Firebase 200 के साथ null भेजता है (304 नहीं)
          return Promise.resolve({ status: 200, ok: true, headers: { get: () => null }, json: () => Promise.resolve(null) });
        }
        return orig(u, o);
      };
      _cashRefreshAll([hq], function () {
        window.fetch = orig;
        resolve({ len: cGet(hq, cat).length });
      }, true);
    }));
    expect(r.len).toBe(0); // हटाई हुई सूची स्क्रीन पर बनी न रहे
  });

  // चरण 3 पर ETag जान-बूझकर नहीं — 304 का मतलब होता cache से जांचना, पर cache normList() से
  // गुज़री सादी array है: उससे न "सर्वर पर array था या object" पक्का होता, न duplicate acc
  // (object दोबारा बनाने पर वे आपस में मिलकर ग़ायब हो जाते)। यानी चरण 3 ठीक वही गड़बड़ी छिपा
  // देता जिसे पकड़ने के लिए वह बना है
  test('चरण 3 की जांच हमेशा सर्वर का कच्चा सच पढ़े — वहाँ ETag न लगे', async () => {
    // v9.195: चरण 3 की JE-स्क्रीन अब अलग फ़ाइल में (ज़रूरत पड़ने पर उतरती है)
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'migration-tool.js'), 'utf8');
    const dry = src.slice(src.indexOf('function _migRunDryRun'), src.indexOf('function _migRender'));
    expect(dry.length).toBeGreaterThan(100);
    expect(dry).not.toContain('_etagHeaders');
    expect(dry).not.toContain('if-none-match');
    expect(dry).toContain('trackUsageOf(d)'); // भारी है, पर मीटर में गिना जाता है — छिपा नहीं
  });

  test('सभी भारी डाउनलोड रास्तों पर गिनती लगी हो (SSE/prefetch/चरण-3 छूटे नहीं)', async () => {
    const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    expect(read('js/database-live.js')).toContain('trackUsageOf(d); // SSE');       // live sync — सबसे भारी
    expect(read('js/database-live.js')).toContain('trackUsageOf(patchData)');       // SSE patch
    expect(read('js/storage.js').match(/trackUsageOf\(d\)/g).length).toBe(2);  // prefetch + flushPending
    expect(read('js/migration-tool.js').match(/trackUsageOf\(/g).length).toBe(1); // चरण-3 जाँच (v9.195 से अलग फ़ाइल)
    expect(read('js/migration.js').match(/trackUsageOf\(/g).length).toBe(2);      // _migrateOne + MIGRATED
    expect(read('js/home-scorecard.js')).toContain('trackUsageOf(d)');
  });

  // असली नाप: 12:29 IST पर ऐप 57.0 MB दिखा रहा था और Firebase Console 199.6 MB (एक ही
  // quota-खिड़की का)। बचे हुए रास्ते यहाँ पकड़े गए — कोई भी दोबारा छूटे तो CI बता देगा
  test('कोई भी पढ़ाई बिना गिनती के न बचे — हर fetch-GET पर trackUsageOf हो', async () => {
    const root = path.join(__dirname, '..');
    const need = {
      'js/home-scorecard.js': ['trackUsageOf(d); // होम बोर्ड'], // होम बोर्ड की पढ़ाई (कैश-refresh वाली अब ETag के साथ है, नीचे अलग टेस्ट में जांची जाती है)
      'js/profile.js': ['trackUsageOf(d); // फ़ोटो'],             // base64 फ़ोटो, दसियों KB
      'js/config.js': ['trackUsageOf(d)'],                        // CAT_NAMES
      'js/auth.js': ['trackUsageOf(d)'],                          // HQ_PIN
    };
    Object.keys(need).forEach((f) => {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      need[f].forEach((snip) => expect(src, f + ' में गिनती छूट गई').toContain(snip));
    });
    // LOGS की दोनों पढ़ाइयाँ + DEVICE_VERSIONS + LOGS-shallow
    const lg = fs.readFileSync(path.join(root, 'js/logger.js'), 'utf8');
    expect(lg.match(/trackUsageOf\(/g).length).toBeGreaterThanOrEqual(4);
  });

  // JS की .length UTF-16 इकाइयाँ गिनती है; देवनागरी का हर अक्षर UTF-8 में 3 बाइट लेता है।
  // हमारे records नाम/पता/रिमार्क सब हिंदी में रखते हैं, इसलिए पुरानी गिनती असली आकार का
  // ~60% ही दिखाती थी — मीटर के कम पड़ने की सबसे बड़ी अकेली वजह
  test('गिनती असली UTF-8 बाइट की हो, JS अक्षरों की नहीं (हिंदी 3 गुना भारी है)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      var out = {};
      _usageBytes = 0; trackUsageOf('abc');            out.ascii = _usageBytes;
      _usageBytes = 0; trackUsageOf('अआइ');            out.hindi = _usageBytes;
      _usageBytes = 0; trackUsageOf({ n: 'आनंद' });     out.obj = _usageBytes;
      out.objLen = JSON.stringify({ n: 'आनंद' }).length;
      out.fn = _utf8Len('अ');
      return out;
    });
    expect(r.ascii).toBe(3);       // ASCII — पहले जैसा
    expect(r.hindi).toBe(9);       // 3 अक्षर × 3 बाइट, पहले 3 गिने जाते थे
    expect(r.fn).toBe(3);
    expect(r.obj).toBeGreaterThan(r.objLen); // object में भी असली आकार, .length से ज़्यादा
  });

  test('दिन Firebase की खिड़की (US-Pacific) से गिना जाए, UTC से नहीं', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      var la = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
      return { day: _usageQuotaDay(0), la: la, utc: new Date().toISOString().slice(0, 10),
        prevIsEarlier: _usageQuotaDay(1) < _usageQuotaDay(0) };
    });
    expect(r.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.day).toBe(r.la);              // Pacific दिन, न कि device का या UTC का
    expect(r.prevIsEarlier).toBe(true);    // "कल" सचमुच पहले का दिन है
  });

  test('device-वार टूट-फूट दिखे — सबसे ज़्यादा खाने वाला ऊपर, और नाम टेक्स्ट ही रहे (markup न बने)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      CU = { role: 'supervisor', name: 'जेई', hq: 'आदेगांव' };
      var orig = window.fetch;
      window.fetch = function (u, o) {
        if (String(u).indexOf('/USAGE/') > -1 && (!o || !o.method || o.method === 'GET')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({
            k1: { d: 'devA', n: 'lineman|बीबी|<img src=x onerror=alert(1)>', b: 1024 * 1024 },
            k2: { d: 'devB', n: 'lineman|मढ़ी|सुनील', b: 5 * 1024 * 1024 },
            k3: { d: 'devB', n: 'lineman|मढ़ी|सुनील', b: 1024 * 1024 }
          }) });
        }
        return orig(u, o);
      };
      _usageRender();
      setTimeout(() => {
        window.fetch = orig;
        var el = document.getElementById('usage-content');
        var rows = [].slice.call(el.querySelectorAll('td.wasc-hq')).map((td) => td.textContent);
        resolve({ rows: rows, imgs: el.querySelectorAll('img').length, txt: el.textContent });
      }, 500);
    }));
    expect(r.imgs).toBe(0);                                  // नाम में HTML था, पर markup नहीं बना
    expect(r.txt).toContain('<img src=x onerror=alert(1)>');  // सादे टेक्स्ट के तौर पर दिखा
    const dev = r.rows.filter((t) => t.indexOf('(') > -1 || t.indexOf('अनजान') > -1);
    expect(dev[dev.length - 2]).toContain('सुनील');           // 6 MB वाला 1 MB वाले से ऊपर
    expect(r.txt).toContain('6.0 MB');                        // devB के दोनों टुकड़े जुड़े
  });
});

test.describe('🛑 डेटा बचाओ मोड — Firebase download रोकने का मास्टर स्विच (JE only)', () => {
  test('चालू होने पर live sync न जुड़े और prefetch न चले (सबसे बड़े दो खर्च)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await page.evaluate(() => {
      CU = { role: 'lineman', name: 'क', hq: 'आदेगांव' };
      localStorage.removeItem(_prefetchKey());
      _applyPause({ on: true });
      var live = !!liveSource || !!pollTimer;          // _applyPause ने बंद कर दिया होना चाहिए
      startListen('आदेगांव', 'कुल उपभोक्ता');
      var afterStart = !!liveSource || !!pollTimer;    // दोबारा जोड़ने की कोशिश भी न चले
      var hits = 0;
      var orig = window.fetch;
      window.fetch = function (u, o) { if (String(u).indexOf(FB) === 0) hits++; return orig(u, o); };
      prefetchAll(true);                               // force हो तब भी नहीं
      window.fetch = orig;
      _prefetchRun = false;
      _applyPause({ on: false });
      return { live: live, afterStart: afterStart, prefetchHits: hits };
    });
    expect(r.live).toBe(false);
    expect(r.afterStart).toBe(false);
    expect(r.prefetchHits).toBe(0);
  });

  test('चालू होने पर खुली लिस्ट cache से दिखे, पर उसका background refresh न हो', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [{ acc: '1', name: 'क', amount: 10, status: 'pending' }]);
      _applyPause({ on: true });
      var hits = 0, shown = 0;
      var orig = window.fetch;
      window.fetch = function (u, o) { if (String(u).indexOf(fbPath('आदेगांव', 'कुल उपभोक्ता')) > -1) hits++; return orig(u, o); };
      fbGet('आदेगांव', 'कुल उपभोक्ता', function (d) { shown = d.length; });
      setTimeout(() => { window.fetch = orig; _applyPause({ on: false }); resolve({ hits: hits, shown: shown }); }, 500);
    }));
    expect(r.shown).toBe(1);  // काम रुका नहीं — cache से पूरी लिस्ट मिली
    expect(r.hits).toBe(0);   // पर एक भी बाइट network से नहीं
  });

  test('स्विच हटते ही live sync अपने आप वापस जुड़े', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.waitForFunction(() => !!liveSource || !!pollTimer, null, { timeout: 15000 });
    const r = await page.evaluate(() => {
      _applyPause({ on: true });
      var whilePaused = !!liveSource || !!pollTimer;
      _applyPause({ on: false });
      return { whilePaused: whilePaused, afterResume: !!liveSource || !!pollTimer };
    });
    expect(r.whilePaused).toBe(false);
    expect(r.afterResume).toBe(true);
  });

  test('पट्टी सिर्फ़ चालू हालत में दिखे — लाइनमैन को पता रहे कि ऐप ख़राब नहीं है', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await page.evaluate(() => {
      _applyPause({ on: false });
      var off = document.getElementById('pause-bar').style.display;
      _applyPause({ on: true });
      var el = document.getElementById('pause-bar');
      var on = { disp: el.style.display, txt: el.textContent };
      _applyPause({ on: false });
      return { off: off, on: on };
    });
    expect(r.off).toBe('none');
    expect(r.on.disp).not.toBe('none');
    expect(r.on.txt).toContain('वसूली दर्ज हो रही है'); // डर न लगे — काम चालू है
  });

  test('स्विच device पर याद रहे — ऐप दोबारा खुलते ही (server के जवाब से पहले भी) रुका रहे', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      _applyPause({ on: true, by: 'जेई', at: Date.now() });
      var stored = localStorage.getItem(PAUSE_KEY);
      DATA_PAUSED = false; PAUSE_INFO = null;   // जैसे ऐप नए सिरे से खुली हो
      loadPauseLocal();
      var after = isDataPaused();
      _applyPause({ on: false });
      return { stored: !!stored, after: after };
    });
    expect(r.stored).toBe(true);
    expect(r.after).toBe(true);
  });

  test('स्विच सिर्फ़ JE बदल सके — lineman सीधे function बुलाए तो भी कुछ न लिखे', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await page.evaluate(() => {
      var puts = 0;
      var orig = window.fetch;
      window.fetch = function (u, o) { if (String(u).indexOf('/PAUSE.json') > -1 && o && o.method === 'PUT') puts++; return orig(u, o); };
      _pauseToggle();
      openPauseModal();
      var opened = document.getElementById('pause-overlay').classList.contains('open');
      window.fetch = orig;
      return { puts: puts, opened: opened };
    });
    expect(r.puts).toBe(0);
    expect(r.opened).toBe(false);
  });

  // सबसे संभावित गड़बड़ी यही है कि JE शाम को स्विच दबाकर भूल जाएँ और पूरी टीम कई दिन पुराने डेटा
  // पर चलती रहे। Firebase का quota वैसे भी रोज़ रीसेट होता है, तो कल इसे चालू रखने का मतलब ही नहीं
  test('स्विच आज रात अपने आप हट जाए — कल का दबाया हुआ आज लागू न हो', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      var todayStart = new Date(serverNow()); todayStart.setHours(0, 0, 0, 0);
      _applyPause({ on: true, by: 'जेई', at: serverNow() });
      var today = isDataPaused();
      _applyPause({ on: true, by: 'जेई', at: todayStart.getTime() - 3600000 }); // कल शाम
      var yesterday = isDataPaused();
      // कब दबाया पता ही न हो (पुराना रूप) — तब भरोसा करके चालू ही मानें
      _applyPause({ on: true, by: 'जेई' });
      var noTime = isDataPaused();
      _applyPause({ on: false });
      return { today: today, yesterday: yesterday, noTime: noTime };
    });
    expect(r.today).toBe(true);
    expect(r.yesterday).toBe(false); // भूल जाने पर भी कल अपने आप हट गया
    expect(r.noTime).toBe(true);
  });

  test('device पर सहेजे स्विच पर भी वही "आज तक" वाली शर्त लगे (कल का रुका हुआ ऐप खुलते ही फिर लागू न हो)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      var todayStart = new Date(serverNow()); todayStart.setHours(0, 0, 0, 0);
      localStorage.setItem(PAUSE_KEY, JSON.stringify({ on: true, i: { on: true, by: 'जेई', at: todayStart.getTime() - 7200000 } }));
      DATA_PAUSED = false;
      loadPauseLocal();
      var stale = isDataPaused();
      localStorage.setItem(PAUSE_KEY, JSON.stringify({ on: true, i: { on: true, by: 'जेई', at: serverNow() } }));
      DATA_PAUSED = false;
      loadPauseLocal();
      var fresh = isDataPaused();
      _applyPause({ on: false });
      return { stale: stale, fresh: fresh };
    });
    expect(r.stale).toBe(false);
    expect(r.fresh).toBe(true);
  });

  test('database.rules.json — PAUSE सिर्फ़ JE लिख सके, बाक़ी सब पढ़ सकें', async () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8')).rules;
    expect(rules.PAUSE).toBeTruthy();
    expect(rules.PAUSE['.read']).toBe('auth != null');
    expect(rules.PAUSE['.write']).toContain('pradeepks2015@gmail.com');
  });
});

// App Check verified% 95 तक ले जाने का आख़िरी हिस्सा: कमज़ोर नेट पर फ़ोन ख़ुद को offline मान लेता है
// (navigator.onLine=false) जबकि request असल में सर्वर तक पहुंच जाती है — पहले वह बिना App Check
// header के जाती और "unverified" में गिनती थी
test.describe('offline मानी गई request में भी तैयार token लगें', () => {
  test('navigator.onLine=false — App Check header और ?auth= दोनों लगें', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
      ID_TOKEN = 'tok-1'; AC_TOKEN = 'ac-1'; AC_READY = true;
      _rawFetch = function (url, opts) {
        resolve({ url: String(url), ac: opts && opts.headers && opts.headers['X-Firebase-AppCheck'] });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      };
      fetch(FB + '/x.json');
    }));
    expect(r.url).toContain('auth=tok-1');
    expect(r.ac).toBe('ac-1');
  });

  test('login token अभी न बना हो तो भी App Check header लगे, पर ?auth= न जुड़े', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
      ID_TOKEN = null; AC_TOKEN = 'ac-2'; AC_READY = true;
      _rawFetch = function (url, opts) {
        resolve({ url: String(url), ac: opts && opts.headers && opts.headers['X-Firebase-AppCheck'] });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      };
      fetch(FB + '/y.json');
    }));
    expect(r.url).not.toContain('auth=');   // "auth=null" जैसा कचरा न जाए
    expect(r.ac).toBe('ac-2');
  });
});

// @ts-check
// वसूली ट्रैकर — टेस्ट: migration (साझा helpers: tests/helpers.js)
const { test, expect, openApp, loginLineman, loginJE } = require('./helpers');

test.describe('चरण 3 माइग्रेशन — Dry-run जांच', () => {
  test('_migAnalyzeList — missing/duplicate/अवैध acc सही पकड़ता है', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => ({
      clean: _migAnalyzeList([{ acc: '1' }, { acc: '2' }, { acc: '3' }]),
      missing: _migAnalyzeList([{ acc: '1' }, { acc: '' }, { name: 'no-acc' }]),
      dup: _migAnalyzeList([{ acc: '5' }, { acc: '5' }, { acc: '6' }]),
      illegal: _migAnalyzeList([{ acc: '7' }, { acc: 'a.b' }, { acc: 'c#d' }]),
      alreadyObjFmt: _migAnalyzeList({ '1': { acc: '1' }, '2': { acc: '2' } }),
      empty: _migAnalyzeList(null),
    }));
    expect(r.clean).toEqual(expect.objectContaining({ tot: 3, missingAcc: 0, dupAcc: 0, illegalAcc: 0 }));
    expect(r.missing).toEqual(expect.objectContaining({ tot: 3, missingAcc: 2 }));
    expect(r.dup).toEqual(expect.objectContaining({ tot: 3, dupAcc: 1 }));
    expect(r.dup.dupSamples).toContain('5');
    expect(r.illegal).toEqual(expect.objectContaining({ tot: 3, illegalAcc: 2 }));
    expect(r.alreadyObjFmt).toEqual(expect.objectContaining({ tot: 2, alreadyObj: true }));
    // खाली श्रेणी "ठीक" मानी जाए — alreadyObj:true. पहले यह false था, जिससे _migRunDryRun का
    // reverted = isMigrated && !alreadyObj हर खाली-पर-migrated श्रेणी को लाल "(पलटा हुआ)" दिखा
    // देता था (असली रिपोर्ट में 10+ ऐसी झूठी पंक्तियां, सबमें 0 records)
    expect(r.empty).toEqual(expect.objectContaining({ tot: 0, alreadyObj: true }));
  });

  test('खाली श्रेणी झूठी "(पलटा हुआ)" न दिखे — dry-run में सिर्फ़ असली array-format वाली दिखे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => openMigModal());
    const r = await page.evaluate(() => new Promise((resolve) => {
      MIGRATED[hqKey('आदेगांव')] = {};
      MIGRATED[hqKey('आदेगांव')][catKey('कुल उपभोक्ता')] = true; // खाली, पर flag लगा है
      MIGRATED[hqKey('आदेगांव')][catKey('घरेलू')] = true;        // सच में array में पलटी हुई
      window.fetch = function (url) {
        var s = String(url);
        if (s.indexOf(fbPath('आदेगांव', 'घरेलू')) > -1) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve([{ acc: '1', name: 'क' }]) }); // array = असली revert
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(null) }); // बाक़ी सब खाली
      };
      _migRunDryRun();
      var t = setInterval(function () {
        if (MIG_REPORT && MIG_REPORT.length) {
          clearInterval(t);
          resolve(MIG_REPORT.filter(function (x) { return x.a.reverted; })
            .map(function (x) { return x.hq + '/' + x.cat; }));
        }
      }, 100);
    }));
    expect(r).toEqual(['आदेगांव/घरेलू']); // सिर्फ़ असली वाली — कोई खाली श्रेणी नहीं
  });

  test('_migAnalyzeList — acc खाली वाले record की नाम/पता/मोबाइल से पहचान (missingAccSamples) देता है', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => _migAnalyzeList([
      { acc: '1', name: 'राम कुमार' },
      { name: 'श्याम लाल', addr: 'PIPARIYA', phone: '9876543210' }, // acc ही नहीं
    ]));
    expect(r.missingAcc).toBe(1);
    expect(r.missingAccSamples).toEqual([{ name: 'श्याम लाल', addr: 'PIPARIYA', phone: '9876543210' }]);
  });

  test('_migRender — "समस्या वाले records" सूची में नाम/पता दिखाकर JE को ढूंढना आसान बनाता है', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => openMigModal());
    await page.evaluate(() => {
      _migRender([
        { hq: 'पाटन', cat: 'घरेलू', a: { tot: 5, missingAcc: 1, missingAccSamples: [{ name: 'श्याम लाल', addr: 'PIPARIYA', phone: '' }], dupAcc: 0, illegalAcc: 0 } },
      ]);
    });
    const html = await page.evaluate(() => document.getElementById('mig-content').innerHTML);
    expect(html).toContain('समस्या वाले records');
    expect(html).toContain('श्याम लाल');
    expect(html).toContain('PIPARIYA');
    expect(html).toContain('Consumer No खाली');
  });

  test('सिर्फ JE "चरण 3 जांच" खोल सकते हैं', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => openMigModal());
    expect(await page.evaluate(() => document.getElementById('mig-overlay').classList.contains('open'))).toBe(false);
  });

  test('_migConvertToObject — acc को key बनाकर o (क्रम) जोड़ता है, बिना acc वाला record छोड़ देता है', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() =>
      _migConvertToObject([{ acc: '10', name: 'क' }, { name: 'बिना-acc' }, { acc: '20', name: 'ख' }])
    );
    expect(Object.keys(r).sort()).toEqual(['10', '20']);
    expect(r['10']).toEqual(expect.objectContaining({ name: 'क', o: 0 }));
    expect(r['20']).toEqual(expect.objectContaining({ name: 'ख', o: 2 }));
  });
});

test.describe('चरण 3 — per-record write-path (_diffToPatch)', () => {
  test('बदले/नए/हटाए गए records का सही PATCH payload बनता है', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      const prev = [
        { acc: '1', status: 'pending', o: 0 },
        { acc: '2', status: 'pending', o: 1 },
        { acc: '3', status: 'paid', o: 2 },
      ];
      // acc:1 बदला (status), acc:2 वैसा ही रहा, acc:3 हटाया गया, acc:4 नया जुड़ा
      const arr = [
        { acc: '1', status: 'paid', o: 0 },
        { acc: '2', status: 'pending', o: 1 },
        { acc: '4', status: 'pending' },
      ];
      return _diffToPatch(prev, arr);
    });
    expect(r['1']).toEqual(expect.objectContaining({ status: 'paid' }));
    expect(r['2']).toBeUndefined(); // नहीं बदला — patch में नहीं आना चाहिए
    expect(r['3']).toBeNull(); // हटाया गया — null यानी delete
    expect(r['4']).toEqual(expect.objectContaining({ status: 'pending', o: 3 })); // नया — अगला क्रम मिला
  });

  test('कुछ न बदले तो खाली patch ({}) लौटे — कोई network call नहीं', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      const list = [{ acc: '1', status: 'pending', o: 0 }];
      return _diffToPatch(list, JSON.parse(JSON.stringify(list)));
    });
    expect(r).toEqual({});
  });

  // पहले acc-रहित record मिलने पर यह null लौटाता था और caller पूरी लिस्ट का array-PUT कर देता था।
  // असली production लॉग (बीबी/कुल उपभोक्ता) में दिखा कि वह रास्ता सुरक्षित था ही नहीं — _fbPut का
  // guard उसी record को वैसे भी छोड़ देता था, पर पूरा node overwrite हो जाता (साथ काम कर रहे किसी
  // और लाइनमैन की वसूली मिट सकती थी) और पूरी लिस्ट दोबारा नेट पर जाती
  test('acc-रहित record को छोड़कर बाक़ी सबका patch बने (पूरी लिस्ट का array-PUT न हो)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => _diffToPatch(
      [{ acc: '1', status: 'pending', o: 0 }],
      [{ acc: '1', status: 'paid', o: 0 }, { name: 'बिना Consumer No वाला', status: 'pending' }]
    ));
    expect(r['1']).toEqual(expect.objectContaining({ status: 'paid' })); // बाक़ी record सामान्य रूप से patch हुआ
    expect(Object.keys(r).length).toBe(1); // acc-रहित record न जुड़ा, न किसी को हटाया गया
  });

  test('acc-रहित record सिर्फ़ छूटे — पहले से सेव किसी record को हटाया न जाए', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => _diffToPatch(
      [{ acc: '1', status: 'pending', o: 0 }, { acc: '2', status: 'pending', o: 1 }],
      [{ acc: '1', status: 'pending', o: 0 }, { acc: '2', status: 'pending', o: 1 }, { name: 'नया, बिना acc' }]
    ));
    expect(r).toEqual({}); // कुछ नहीं बदला — कोई network call भी नहीं होनी चाहिए
  });

  test('_fbPutPerRecord — acc-रहित record पर पूरी लिस्ट PUT न हो, सिर्फ़ PATCH जाए, और लॉग में उपभोक्ता की पहचान आए', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      try { localStorage.removeItem('dc_logs3'); } catch (e) {}
      MIGRATED[hqKey('टेस्ट HQ30')] = {}; MIGRATED[hqKey('टेस्ट HQ30')][catKey('कुल उपभोक्ता')] = true;
      var orig = window.fetch;
      window.fetch = function (url, opts) {
        if (String(url).indexOf(fbPath('टेस्ट HQ30', 'कुल उपभोक्ता')) > -1 && opts && opts.method) {
          window.fetch = orig;
          resolve({ method: opts.method, body: JSON.parse(opts.body), logs: getLogs().filter((l) => l.c === 'mig-noacc-skip') });
          return Promise.resolve({ ok: true, json: () => Promise.resolve(true) });
        }
        return orig(url, opts);
      };
      fbSet('टेस्ट HQ30', 'कुल उपभोक्ता',
        [{ acc: '1', status: 'paid', o: 0 }, { name: 'रामू', addr: 'बीबी', phone: '9999999999', status: 'pending' }],
        [{ acc: '1', status: 'pending', o: 0 }], null);
    }));
    expect(r.method).toBe('PATCH');            // पूरी लिस्ट का PUT नहीं
    expect(r.body['1']).toBeTruthy();
    expect(r.logs.length).toBe(1);
    expect(r.logs[0].m).toContain('रामू');     // JE को पता चले किसका Consumer No भरना है
    expect(r.logs[0].m).toContain('9999999999');
  });

  test('offline में fbSet — migrated HQ/श्रेणी पर पेंडिंग queue में सिर्फ patch बनता है, पूरी array नहीं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => {
      MIGRATED['टेस्ट_HQ'] = { 'कुल_उपभोक्ता': true };
    });
    const r = await page.evaluate(() => new Promise((resolve) => {
      cSet('टेस्ट HQ', 'कुल उपभोक्ता', [{ acc: '9', status: 'pending', o: 0 }]);
      fbSet('टेस्ट HQ', 'कुल उपभोक्ता', [{ acc: '9', status: 'paid', o: 0 }], [{ acc: '9', status: 'pending', o: 0 }], function () {
        var p = getPending()['टेस्ट HQ_कुल उपभोक्ता'];
        resolve(p);
      });
    }));
    expect(r.patch).toBeTruthy();
    expect(r.patch['9']).toEqual(expect.objectContaining({ status: 'paid' }));
  });

  test('_fbPut (legacy array-PUT rasta) migrated HQ/श्रेणी पर कभी raw array नहीं भेजता — acc-रहित record छोड़कर बाकी object फॉर्मेट में', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      MIGRATED['टेस्ट_HQ6'] = { 'कुल_उपभोक्ता': true };
      let sentBody = null;
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('टेस्ट_HQ6/कुल_उपभोक्ता') > -1 && opts && opts.method === 'PUT') {
          sentBody = JSON.parse(opts.body);
          return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        return orig(url, opts);
      };
      _fbPut('टेस्ट HQ6', 'कुल उपभोक्ता', [
        { acc: '1', status: 'pending', o: 0 },
        { status: 'pending' }, // acc नहीं — सुरक्षित रूप से छोड़ा जाना चाहिए
        { acc: '2', status: 'paid', o: 1 },
      ], function () {
        window.fetch = orig;
        resolve(sentBody);
      });
    }));
    expect(Array.isArray(r)).toBe(false); // array नहीं — object होना चाहिए
    expect(Object.keys(r).sort()).toEqual(['1', '2']);
    expect(r['1'].status).toBe('pending');
    expect(r['2'].status).toBe('paid');
  });

  test('_fbPut — migrated ही न हो तो हमेशा की तरह plain array भेजता है', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      let sentBody = null;
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('टेस्ट_HQ7/कुल_उपभोक्ता') > -1 && opts && opts.method === 'PUT') {
          sentBody = JSON.parse(opts.body);
          return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        return orig(url, opts);
      };
      // v9.167: flags/रूप दोनों अनजान हों तो _fbPut पहले सर्वर पर रूप जांचता है — यह test पुराने (array) रास्ते का है, इसलिए रूप पहले से 'array' दर्ज
      _noteShape('टेस्ट HQ7', 'कुल उपभोक्ता', []);
      _fbPut('टेस्ट HQ7', 'कुल उपभोक्ता', [{ acc: '1', status: 'pending' }], function () {
        window.fetch = orig;
        resolve(sentBody);
      });
    }));
    expect(Array.isArray(r)).toBe(true);
  });

  test('_fbPut — save 401 पर रुके तो "ऑफलाइन" नहीं, साफ़ "दोबारा login करें" वाला toast दिखे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => new Promise((resolve) => {
      Object.defineProperty(navigator, 'onLine', { get: () => true });
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('टेस्ट_HQ8/कुल_उपभोक्ता') > -1 && opts && opts.method === 'PUT') {
          return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
        }
        return orig(url, opts);
      };
      // v9.167: flags/रूप दोनों अनजान हों तो _fbPut पहले सर्वर पर रूप जांचता है — यह test पुराने (array) रास्ते का है, इसलिए रूप पहले से 'array' दर्ज
      _noteShape('टेस्ट HQ8', 'कुल उपभोक्ता', []);
      _fbPut('टेस्ट HQ8', 'कुल उपभोक्ता', [{ acc: '1', status: 'pending' }], function () {
        window.fetch = orig;
        resolve();
      });
    }));
    await expect(page.locator('#toast')).toContainText('login session');
    await expect(page.locator('#toast')).not.toContainText('ऑफलाइन');
  });

  test('_fbPut — नेटवर्क fail (जैसा offline में होता है) हो तो पुराना "ऑफलाइन" वाला toast ही दिखे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => new Promise((resolve) => {
      Object.defineProperty(navigator, 'onLine', { get: () => true });
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('टेस्ट_HQ9/कुल_उपभोक्ता') > -1 && opts && opts.method === 'PUT') {
          return Promise.reject(new TypeError('Failed to fetch'));
        }
        return orig(url, opts);
      };
      _fbPut('टेस्ट HQ9', 'कुल उपभोक्ता', [{ acc: '1', status: 'pending' }], function () {
        window.fetch = orig;
        resolve();
      });
    }));
    await expect(page.locator('#toast')).toContainText('ऑफलाइन');
  });

  test('लगातार 401 (गलत HQ/account का device) — कुछ बार के बाद auto-retry रुक जाए, हमेशा के लिए hammer न करे', async ({ page }) => {
    // असली production log में यह exact पैटर्न मिला: एक लाइनमैन के device पर किसी और HQ का pending
    // बदलाव बचा रह गया था, जो कभी सफल नहीं हो सकता था (401 permission-denied) — फिर भी हर 20 सेकंड
    // दोबारा कोशिश होती रही, घंटों तक। यह टेस्ट पुष्टि करता है कि STUCK_AUTH_MAX बार बाद रुक जाए।
    await openApp(page);
    await loginJE(page);
    // toast() को असली login-welcome toast के साथ रेस से बचाने के लिए यहीं (उसी evaluate के अंदर,
    // बिना किसी async gap के) toast का टेक्स्ट भी capture कर लेते हैं — polling assert में देर होने पर
    // बाद में आया कोई और (असंबंधित, जैसे देर से आया login-welcome) toast बीच में overwrite कर सकता था
    const r = await page.evaluate(() => new Promise((resolve) => {
      Object.defineProperty(navigator, 'onLine', { get: () => true });
      AC_TOKEN = 'ac-ok'; // v9.192: App Check token था, फिर भी 401 = खाते की गड़बड़ी (token न होने वाला 401 अब "अटकी" में नहीं गिना जाता)
      let count = 0;
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('टेस्ट_HQ10/कुल_उपभोक्ता') > -1) {
          // असली 401 device पर PATCH से पहले वाली रिमार्क-पढ़ाई (_mergeServerRemarks) भी 401 ही पाती है
          if (opts && opts.method === 'PATCH') count++;
          return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
        }
        return orig(url, opts);
      };
      // असली बदलाव जैसा — कोई मौजूदा record बदला (नया/हटाया record नहीं, ताकि PATCH-path भी सही exercise हो)
      MIGRATED[hqKey('टेस्ट HQ10')] = {}; MIGRATED[hqKey('टेस्ट HQ10')][catKey('कुल उपभोक्ता')] = true;
      cSet('टेस्ट HQ10', 'कुल उपभोक्ता', [{ acc: '1', status: 'pending', o: 0 }]);
      fbSet('टेस्ट HQ10', 'कुल उपभोक्ता', [{ acc: '1', status: 'paid', o: 0 }], [{ acc: '1', status: 'pending', o: 0 }], function () {
        // पहला असल-save-attempt फेल हुआ, अब जान-बूझकर कई बार flushPending बुलाओ (जैसे हर 20 सेकंड वाला टाइमर करता)
        function loop(n) {
          if (n <= 0) {
            window.fetch = orig;
            resolve({ count: count, toastText: document.getElementById('toast').textContent });
            return;
          }
          flushPending();
          setTimeout(function () { loop(n - 1); }, 50);
        }
        loop(6);
      });
    }));
    // 1 असली save-attempt + STUCK_AUTH_MAX तक पहुंचने के लिए ज़रूरी retries — उसके बाद कोई नया PATCH नहीं जाना चाहिए
    expect(r.count).toBe(3);
    expect(r.toastText).toContain('भेजे नहीं जा पा रहे');
  });

  test('_applyPatchToArray — SSE "patch" event का delta local array पर सही लगता है (update/नया/हटाना)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      const base = [
        { acc: '1', status: 'pending', o: 0 },
        { acc: '2', status: 'pending', o: 1 },
        { acc: '3', status: 'paid', o: 2 },
      ];
      return {
        updateOnly: _applyPatchToArray(base, { '1': { acc: '1', status: 'paid', o: 0 } }),
        addNew: _applyPatchToArray(base, { '4': { acc: '4', status: 'pending', o: 3 } }),
        removeOne: _applyPatchToArray(base, { '3': null }),
        mixed: _applyPatchToArray(base, { '1': { acc: '1', status: 'paid', o: 0 }, '3': null, '5': { acc: '5', status: 'pending', o: 4 } }),
      };
    });
    expect(r.updateOnly.find((x) => x.acc === '1').status).toBe('paid');
    expect(r.updateOnly.length).toBe(3);
    expect(r.addNew.length).toBe(4);
    expect(r.addNew.find((x) => x.acc === '4')).toBeTruthy();
    expect(r.removeOne.length).toBe(2);
    expect(r.removeOne.find((x) => x.acc === '3')).toBeFalsy();
    expect(r.mixed.length).toBe(3); // 3 base - 1 हटाया + 1 नया
    expect(r.mixed.find((x) => x.acc === '1').status).toBe('paid');
    expect(r.mixed.find((x) => x.acc === '3')).toBeFalsy();
    expect(r.mixed.find((x) => x.acc === '5')).toBeTruthy();
  });
});

test.describe('चरण 3 — migration-revert ऑटो-पहचान', () => {
  test('migrated flag true + data अब भी object हो, या flag ही false हो — तो कोई चेतावनी नहीं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      try { localStorage.removeItem('dc_logs3'); } catch (e) {}
      MIGRATED['टेस्ट_HQ3'] = { 'कुल_उपभोक्ता': true };
      _checkMigrationRevert('टेस्ट HQ3', 'कुल उपभोक्ता', { '1': { acc: '1' } }); // object — ठीक है
      _checkMigrationRevert('टेस्ट HQ4', 'कुल उपभोक्ता', [{ acc: '1' }]); // migrated ही नहीं — कुछ जांचना नहीं
      return getLogs().filter((l) => l.c === 'migration-reverted');
    });
    expect(r.length).toBe(0);
  });

  // पहले सिर्फ़ "unsafe" वाला नतीजा लॉग होता था; "ok"/"already" चुपचाप निकल जाते (सिर्फ़ toast)।
  // असली production में इसी वजह से घंटों तय नहीं हो पाया कि "migration-reverted" हल हुआ या नहीं
  test('self-heal सफल हो तो "ठीक कर दिया" भी लॉग हो (सिर्फ़ toast दिखाकर चुप न रहे)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const logs = await page.evaluate(() => new Promise((resolve) => {
      try { localStorage.removeItem('dc_logs3'); } catch (e) {}
      MIGRATED[hqKey('टेस्ट HQ40')] = {}; MIGRATED[hqKey('टेस्ट HQ40')][catKey('कुल उपभोक्ता')] = true;
      window.fetch = function (url, opts) {
        if (String(url).indexOf(fbPath('टेस्ट HQ40', 'कुल उपभोक्ता')) > -1 && (!opts || !opts.method)) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve([{ acc: '1', name: 'क' }]) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(true) });
      };
      _checkMigrationRevert('टेस्ट HQ40', 'कुल उपभोक्ता', [{ acc: '1', name: 'क' }]);
      setTimeout(() => resolve(getLogs()), 400);
    }));
    expect(logs.filter((l) => l.c === 'migration-revert-fixed').length).toBe(1);
    expect(logs.filter((l) => l.c === 'migration-revert-fixed')[0].m).toContain('1 records');
  });

  test('self-heal के वक़्त list पहले से ठीक मिले तो "already" भी लॉग हो — पता चले कि कुछ करना बाक़ी नहीं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const logs = await page.evaluate(() => new Promise((resolve) => {
      try { localStorage.removeItem('dc_logs3'); } catch (e) {}
      MIGRATED[hqKey('टेस्ट HQ41')] = {}; MIGRATED[hqKey('टेस्ट HQ41')][catKey('कुल उपभोक्ता')] = true;
      window.fetch = function (url) {
        if (String(url).indexOf(fbPath('टेस्ट HQ41', 'कुल उपभोक्ता')) > -1) {
          // दोबारा पढ़ने पर object मिला — किसी और device ने बीच में ठीक कर दिया
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ '1': { acc: '1' } }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(true) });
      };
      _checkMigrationRevert('टेस्ट HQ41', 'कुल उपभोक्ता', [{ acc: '1' }]);
      setTimeout(() => resolve(getLogs()), 400);
    }));
    expect(logs.filter((l) => l.c === 'migration-revert-already').length).toBe(1);
  });

  // असली (JE, मढ़ी/कुल उपभोक्ता): सूची पुराने format में पलटी और उसमें 1134019486 के दो card थे —
  // self-heal "unsafe" पर रुक गया। अब duplicate मिलाकर एक कर दिए जाते हैं, फिर सूची ठीक होती है
  test('self-heal — duplicate Consumer No मिलाकर एक हों (नया बदलाव जीते, दोनों के रिमार्क बचें), फिर सूची ठीक हो', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      try { localStorage.removeItem('dc_logs3'); } catch (e) {}
      var hq = 'टेस्ट HQ42', cat = 'कुल उपभोक्ता', put = null;
      MIGRATED[hqKey(hq)] = {}; MIGRATED[hqKey(hq)][catKey(cat)] = true;
      var raw = [
        { acc: '5', name: 'पहला' },
        { acc: '1134019486', name: 'ASADU LAL', status: 'pending', ts: 100, remarksArr: [{ text: 'सी फॉर्म में दिया गया', by: 'Vishnu', at: '2:39' }] },
        { acc: '1134019486 ', name: 'ASADU LAL', status: 'paid', paydate: '24/9/2026', ts: 200, remarksArr: [{ text: '?', by: 'Vishnu', at: '2:46' }] },
      ];
      window.fetch = function (url, opts) {
        if (String(url).indexOf(fbPath(hq, cat)) > -1 && String(url).indexOf('/MIGRATED/') < 0) {
          if (opts && opts.method === 'PUT') { put = JSON.parse(opts.body); return Promise.resolve({ ok: true, json: () => Promise.resolve(true) }); }
          return Promise.resolve({ ok: true, json: () => Promise.resolve(raw) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(true) });
      };
      _checkMigrationRevert(hq, cat, raw);
      setTimeout(() => resolve({ put: put, logs: getLogs() }), 400);
    }));
    expect(Object.keys(r.put).sort()).toEqual(['1134019486', '5']);
    const rec = r.put['1134019486'];
    expect(rec.status).toBe('paid'); // नया (ts 200) बदलाव जीता
    expect(rec.remarksArr.map((x) => x.text)).toEqual(['सी फॉर्म में दिया गया', '?']);
    expect(rec.o).toBe(1); // पहले वाले card की जगह पर
    expect(r.logs.filter((l) => l.c === 'migration-revert-fixed').length).toBe(1);
    expect(r.logs.filter((l) => l.c === 'migration-dup-merged')[0].m).toContain('1 duplicate');
    expect(r.logs.filter((l) => l.c === 'migration-revert-unsafe').length).toBe(0);
  });

  // असली (JE, मढ़ी): v9.164 के बाद भी 1134019486 के 3 card — पलटी (array) list पर नए devices के
  // per-record PATCH ने Consumer No-key जोड़ दी, node "मिली-जुली" object बन गया और पहचान चुप रही
  test('मिली-जुली list (क्रमांक-key + Consumer No-key) पहचानी जाए और एक-एक card में ठीक हो', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      try { localStorage.removeItem('dc_logs3'); } catch (e) {}
      var hq = 'टेस्ट HQ44', cat = 'कुल उपभोक्ता', put = null;
      MIGRATED[hqKey(hq)] = {}; MIGRATED[hqKey(hq)][catKey(cat)] = true;
      var raw = {
        0: { acc: '501', name: 'क', o: 0 },
        1: { acc: '502', name: 'ASADU', o: 1, ts: 1, remarksArr: [{ text: 'सी फॉर्म', by: 'V', at: '1' }] },
        2: { acc: '503', name: 'ग', o: 2 },
        502: { acc: '502', name: 'ASADU', o: 1, ts: 5, status: 'paid', remarksArr: [{ text: 'सी फॉर्म', by: 'V', at: '1' }, { text: 'जमा', by: 'V', at: '2' }] },
      };
      window.fetch = function (url, opts) {
        if (String(url).indexOf(fbPath(hq, cat)) > -1 && String(url).indexOf('/MIGRATED/') < 0) {
          if (opts && opts.method === 'PUT') { put = JSON.parse(opts.body); return Promise.resolve({ ok: true, json: () => Promise.resolve(true) }); }
          return Promise.resolve({ ok: true, json: () => Promise.resolve(raw) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(true) });
      };
      var shapes = { mixed: _isBadShape(raw), good: _isBadShape({ 7: { acc: '7' }, 8: { acc: '8' } }), arr: _isBadShape([{ acc: '1' }]) };
      _checkMigrationRevert(hq, cat, raw);
      setTimeout(() => resolve({ shapes: shapes, put: put, logs: getLogs() }), 400);
    }));
    expect(r.shapes).toEqual({ mixed: true, good: false, arr: true });
    expect(Object.keys(r.put).sort()).toEqual(['501', '502', '503']);
    expect(r.put['502'].status).toBe('paid');
    expect(r.put['502'].remarksArr.map((x) => x.text)).toEqual(['सी फॉर्म', 'जमा']);
    expect(r.logs.filter((l) => l.c === 'migration-mixed').length).toBe(1);
    expect(r.logs.filter((l) => l.c === 'migration-revert-fixed').length).toBe(1);
  });

  test('flags लोड हुए बिना array लिखी जाए तो एक बार "array-put-noflags" लॉग हो (पलटाने वाला device पकड़ में आए)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const n = await page.evaluate(() => new Promise((resolve) => {
      var logs = [];
      window.logErr = function (c) { logs.push(c); };
      MIGRATED = {};
      window.fetch = function () { return Promise.resolve({ ok: true, json: () => Promise.resolve(true) }); };
      _fbPut('टेस्ट HQ45', 'कुल उपभोक्ता', [{ acc: '1' }]);
      _fbPut('टेस्ट HQ45', 'कुल उपभोक्ता', [{ acc: '1' }]);
      setTimeout(() => resolve(logs.filter((c) => c === 'array-put-noflags').length), 100);
    }));
    expect(n).toBe(1);
  });

  // v9.167 — असली (बीबी/Movind, v9.166): flags लोड नहीं + रूप अज्ञात → पूरी array लिखी जाती, migrated
  // list पलट जाती। अब पहले ?shallow=true से रूप जांचा जाता है
  const probePut = (page, spec) => page.evaluate((sp) => new Promise((resolve) => {
    MIGRATED = {};
    try { localStorage.removeItem(SHAPE_KEY); } catch (e) {}
    var hq = 'टेस्ट HQ46', cat = 'कुल उपभोक्ता', calls = [];
    window.fetch = function (url, opts) {
      calls.push({ url: String(url), method: (opts && opts.method) || 'GET', body: opts && opts.body });
      if (String(url).indexOf('shallow=true') > -1) {
        if (sp.fail) return Promise.reject(new Error('Failed to fetch'));
        return Promise.resolve({ ok: true, json: () => Promise.resolve(sp.keys) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(true) });
    };
    var done = function (ok) {
      var put = calls.filter((c) => c.method === 'PUT' && c.url.indexOf(fbPath(hq, cat) + '.json') > -1)[0]; // LOGS वाली PUT नहीं
      resolve({ ok: ok, put: put ? JSON.parse(put.body) : null, probed: calls.some((c) => c.url.indexOf('shallow=true') > -1), pending: isPending(hq, cat), shape: lastShape(hq, cat) });
    };
    _fbPut(hq, cat, [{ acc: '1134000011', name: 'क' }, { acc: '1134000012', name: 'ख' }], done);
  }), spec);

  test('flags नहीं + रूप अज्ञात — सर्वर पर per-record मिले तो array नहीं, per-record ही लिखा जाए', async ({ page }) => {
    await openApp(page);
    const r = await probePut(page, { keys: { 1134000011: true, 1134000012: true } });
    expect(r.probed).toBe(true);
    expect(Array.isArray(r.put)).toBe(false);
    expect(Object.keys(r.put).sort()).toEqual(['1134000011', '1134000012']);
    expect(r.shape).toBe('obj');
  });

  test('flags नहीं + रूप अज्ञात — सर्वर पर सच में array (0,1,2…) हो तो array ही लिखा जाए', async ({ page }) => {
    await openApp(page);
    const r = await probePut(page, { keys: { 0: true, 1: true } });
    expect(Array.isArray(r.put)).toBe(true);
    expect(r.shape).toBe('arr');
  });

  test('flags नहीं + रूप की जांच ही नाकाम — कुछ न लिखा जाए, बदलाव pending रहे', async ({ page }) => {
    await openApp(page);
    const r = await probePut(page, { fail: true });
    expect(r.ok).toBe(false);
    expect(r.put).toBe(null);
    expect(r.pending).toBe(true);
  });

  // JE का अनुरोध: per-record (नए फ़ॉर्मेट) वाली सूची पर असली काम (वसूल मार्क, रिमार्क) करके भी जांचें —
  // flags हों या न हों, सर्वर पर सिर्फ़ बदले record का PATCH जाए, पूरी सूची कभी नहीं (न array, न object)
  const perRecordFlow = (page, spec) => page.evaluate((sp) => new Promise((resolve) => {
    var hq = activeHQ, cat = activeCat, path = fbPath(hq, cat);
    var list = [
      { acc: '1134000001', name: 'राम', status: 'pending', amount: 500, o: 0, remarksArr: [] },
      { acc: '1134000002', name: 'श्याम', status: 'pending', amount: 700, o: 1, remarksArr: [] },
      { acc: '1134000003', name: 'गीता', status: 'pending', amount: 900, o: 2, remarksArr: [] },
    ];
    cSet(hq, cat, JSON.parse(JSON.stringify(list)));
    try { localStorage.removeItem(SHAPE_KEY); } catch (e) {}
    MIGRATED = {};
    if (sp.flags) { MIGRATED[hqKey(hq)] = {}; MIGRATED[hqKey(hq)][catKey(cat)] = true; }
    var writes = [], probes = 0;
    window.confirm = () => true;
    window.fetch = function (url, opts) {
      var u = String(url), m = (opts && opts.method) || 'GET';
      if (u.indexOf(path) > -1) {
        if (u.indexOf('shallow=true') > -1) { probes++; return Promise.resolve({ ok: true, json: () => Promise.resolve({ 1134000001: true, 1134000002: true, 1134000003: true }) }); }
        if (u.indexOf('/remarksArr.json') > -1) return Promise.resolve({ ok: true, json: () => Promise.resolve(sp.serverRmk || null) });
        if (m !== 'GET') writes.push({ m: m, u: u, body: JSON.parse(opts.body) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
    };
    renderListWith(cGet(hq, cat));
    if (sp.action === 'paid') markPaid(1, '1134000002');
    if (sp.action === 'rmk') {
      openRmkModal(1, '1134000002');
      document.getElementById('rmk-text').value = 'कल आएंगे';
      saveRmk();
    }
    setTimeout(() => resolve({ writes: writes.filter((w) => w.u.indexOf(path + '.json') > -1), probes: probes, shape: lastShape(hq, cat) }), 400);
  }), spec);

  for (const flags of [true, false]) {
    const tag = flags ? 'flags लोड' : 'flags लोड नहीं (असली बीबी वाली हालत)';
    test(`per-record सूची — "✓ वसूल" पर सिर्फ़ उसी उपभोक्ता का PATCH जाए (${tag})`, async ({ page }) => {
      await openApp(page);
      await loginLineman(page);
      const r = await perRecordFlow(page, { flags: flags, action: 'paid' });
      expect(r.writes.length).toBe(1);
      expect(r.writes[0].m).toBe('PATCH');
      expect(Object.keys(r.writes[0].body)).toEqual(['1134000002']);
      expect(r.writes[0].body['1134000002'].status).toBe('paid');
      expect(r.probes).toBe(flags ? 0 : 1); // flags न हों तो पहले एक हल्की जांच
      if (!flags) expect(r.shape).toBe('obj');
    });

    test(`per-record सूची — रिमार्क सेव पर सिर्फ़ उसी उपभोक्ता का PATCH, सर्वर के पुराने रिमार्क भी बचें (${tag})`, async ({ page }) => {
      await openApp(page);
      await loginLineman(page);
      const r = await perRecordFlow(page, { flags: flags, action: 'rmk', serverRmk: [{ text: 'पहले से', by: 'मोहन', at: '24/9/2026' }] });
      expect(r.writes.length).toBe(1);
      expect(r.writes[0].m).toBe('PATCH');
      expect(Object.keys(r.writes[0].body)).toEqual(['1134000002']);
      expect(r.writes[0].body['1134000002'].remarksArr.map((x) => x.text)).toEqual(['पहले से', 'कल आएंगे']);
    });
  }

  test('loadMigratedFlags — पढ़ाई नाकाम हो तो थोड़ा रुककर दोबारा कोशिश हो', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      MIG_FLAG_RETRY_MS = 20; MIGRATED = {};
      var n = 0;
      window.fetch = function (url) {
        if (String(url).indexOf('/MIGRATED.json') > -1) {
          n++;
          if (n === 1) return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ error: 'Permission denied' }) });
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ 'बीबी': { 'कुल_उपभोक्ता': true } }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
      };
      loadMigratedFlags();
      setTimeout(() => resolve({ n: n, flag: isMigrated('बीबी', 'कुल उपभोक्ता') }), 300);
    }));
    expect(r.n).toBe(2);
    expect(r.flag).toBe(true);
  });

  test('self-heal — Consumer No खाली हो तो पहले की तरह रुके ("unsafe")', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      try { localStorage.removeItem('dc_logs3'); } catch (e) {}
      var hq = 'टेस्ट HQ43', cat = 'कुल उपभोक्ता', puts = 0;
      MIGRATED[hqKey(hq)] = {}; MIGRATED[hqKey(hq)][catKey(cat)] = true;
      var raw = [{ acc: '1', name: 'क' }, { acc: '', name: 'ख' }];
      window.fetch = function (url, opts) {
        if (opts && opts.method === 'PUT') puts++;
        return Promise.resolve({ ok: true, json: () => Promise.resolve(raw) });
      };
      _checkMigrationRevert(hq, cat, raw);
      setTimeout(() => resolve({ puts: puts, logs: getLogs() }), 400);
    }));
    expect(r.puts).toBe(0);
    expect(r.logs.filter((l) => l.c === 'migration-revert-unsafe').length).toBe(1);
  });

  test('Consumer No में आगे-पीछे space — live बदलाव (patch) और offline sync दोनों में दूसरा card न जुड़े', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      var local = [{ acc: '1134019486 ', name: 'ASADU', o: 14, status: 'pending' }, { acc: '7', name: 'दूसरा', o: 15 }];
      var p = _applyPatchToArray(local, { '1134019486': { acc: '1134019486', name: 'ASADU', o: 14, status: 'paid' } });
      var m = mergeArrays([{ acc: ' 55', name: 'क', ts: 1 }], [{ acc: '55', name: 'क', ts: 2, status: 'paid' }]);
      var d = _applyPatchToArray(local, { '1134019486': null });
      return { pLen: p.length, pStatus: p[0].status, mLen: m.length, mStatus: m[0].status, dLen: d.length };
    });
    expect(r.pLen).toBe(2);
    expect(r.pStatus).toBe('paid');
    expect(r.mLen).toBe(1);
    expect(r.mStatus).toBe('paid');
    expect(r.dLen).toBe(1); // हटाना भी space वाले acc पर काम करे
  });

  test('migrated HQ का data array में मिले तो एक बार चेतावनी log होती है, बार-बार नहीं (गेट)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const logs = await page.evaluate(() => new Promise((resolve) => {
      try { localStorage.removeItem('dc_logs3'); } catch (e) {}
      MIGRATED['टेस्ट_HQ5'] = { 'कुल_उपभोक्ता': true };
      _checkMigrationRevert('टेस्ट HQ5', 'कुल उपभोक्ता', [{ acc: '1' }]); // पलटा हुआ — पहली बार
      _checkMigrationRevert('टेस्ट HQ5', 'कुल उपभोक्ता', [{ acc: '1' }]); // तुरंत दोबारा — गेट हो जाना चाहिए
      setTimeout(() => resolve(getLogs()), 300);
    }));
    expect(logs.filter((l) => l.c === 'migration-reverted').length).toBe(1);
  });

  test('_migrateOne — असली data-conversion सफल हो पर MIGRATED flag दोबारा-लिखना 401 से नाकाम हो (लाइनमैन के self-heal में — flag अब JE-only-write है), तो भी overall status "ok" रहे, "migrate-fail" न लॉग हो (bug: असली सफल सुधार को ग़लती से "असफल" मान लिया जाता था)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      try { localStorage.removeItem('dc_logs3'); } catch (e) {}
      var orig = window.fetch;
      window.fetch = function (url, opts) {
        if (String(url).indexOf('/MIGRATED/') > -1 && opts && opts.method === 'PUT') {
          return Promise.resolve({ ok: false, status: 401 }); // लाइनमैन के पास अब यह लिखने की अनुमति नहीं
        }
        if (String(url).indexOf(fbPath('टेस्ट HQ6', 'कुल उपभोक्ता')) > -1 && (!opts || !opts.method)) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve([{ acc: '1', name: 'क' }]) });
        }
        if (String(url).indexOf(fbPath('टेस्ट HQ6', 'कुल उपभोक्ता')) > -1 && opts && opts.method === 'PUT') {
          return Promise.resolve({ ok: true }); // असली data-PUT सफल
        }
        return orig(url, opts);
      };
      _migrateOne('टेस्ट HQ6', 'कुल उपभोक्ता', function (result) {
        window.fetch = orig;
        resolve({ result: result, logs: getLogs().filter((l) => l.c === 'migrate-fail') });
      });
    }));
    expect(r.result.status).toBe('ok');
    expect(r.logs.length).toBe(0);
  });

  // असली production लॉग में चार अलग-अलग HQ (पाटन/आदेगांव/बीबी/जोबा) से "migration-reverted" आ रहा
  // था, सब नए version वाले devices से। जड़: MIGRATED सिर्फ़ memory में था और हर बार खाली से शुरू
  // होकर network से भरता था — कमज़ोर नेट पर वो fetch नाकाम होते ही isMigrated() झूठा "नहीं" कहता,
  // और _fbPut() का guard भी उसी खाली flag को देखकर धोखा खाकर पूरा array लिख देता → माइग्रेशन पलट जाता
  test('loadMigratedFlags — सफल होने पर flags localStorage में भी सेव हों (सिर्फ़ memory में नहीं)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const saved = await page.evaluate(() => new Promise((resolve) => {
      var orig = window.fetch;
      window.fetch = function (url, opts) {
        if (String(url).indexOf('/MIGRATED.json') > -1) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ 'टेस्ट_HQ20': { 'कुल_उपभोक्ता': true } }) });
        }
        return orig(url, opts);
      };
      loadMigratedFlags();
      setTimeout(() => { window.fetch = orig; resolve(localStorage.getItem('dc_migrated3')); }, 300);
    }));
    expect(JSON.parse(saved)).toEqual({ 'टेस्ट_HQ20': { 'कुल_उपभोक्ता': true } });
  });

  test('reload के बाद network से पहले ही MIGRATED localStorage से बहाल हो जाए — isMigrated() सही जवाब दे', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      localStorage.setItem('dc_migrated3', JSON.stringify({ 'टेस्ट_HQ21': { 'कुल_उपभोक्ता': true } }));
    });
    await page.reload();
    await page.waitForFunction(() => typeof isMigrated === 'function', null, { timeout: 15000 });
    expect(await page.evaluate(() => isMigrated('टेस्ट HQ21', 'कुल उपभोक्ता'))).toBe(true);
  });

  test('MIGRATED का network-fetch नाकाम हो तो भी migrated list पर पूरा array PUT न हो (bug: माइग्रेशन चुपचाप पलट जाता था)', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      localStorage.setItem('dc_migrated3', JSON.stringify({ 'टेस्ट_HQ22': { 'कुल_उपभोक्ता': true } }));
    });
    // page.reload() के बाद इसी टेस्ट में आगे loginLineman() से क्लिक-इंटरैक्शन करना था — यही जोड़ी
    // (reload + तुरंत क्लिक) CI पर बार-बार loginLineman() के अंदर TimeoutError देती थी (धीमी/व्यस्त
    // मशीन पर), जबकि बाकी पूरी suite में हर जगह page.goto('/') (openApp() के ज़रिए) के बाद क्लिक
    // करना हमेशा भरोसेमंद रहा — इसी origin पर goto भी वैसा ही असली reload है (localStorage बना
    // रहता है) पर यहां वही आज़माया-परखा रास्ता इस्तेमाल कर रहे हैं
    await page.goto('/');
    await page.waitForFunction(() => document.getElementById('login-screen').classList.contains('active'), null, { timeout: 15000 });
    await loginLineman(page);
    const body = await page.evaluate(() => new Promise((resolve) => {
      var orig = window.fetch;
      window.fetch = function (url, opts) {
        if (String(url).indexOf('/MIGRATED.json') > -1) return Promise.reject(new Error('Failed to fetch')); // कमज़ोर नेट
        if (String(url).indexOf(fbPath('टेस्ट HQ22', 'कुल उपभोक्ता')) > -1 && opts && (opts.method === 'PUT' || opts.method === 'PATCH')) {
          window.fetch = orig;
          resolve({ method: opts.method, body: JSON.parse(opts.body) });
          return Promise.resolve({ ok: true, json: () => Promise.resolve(true) });
        }
        return orig(url, opts);
      };
      loadMigratedFlags(); // नाकाम — पर cache से flags पहले से मौजूद हैं
      setTimeout(() => {
        fbSet('टेस्ट HQ22', 'कुल उपभोक्ता', [{ acc: '1', name: 'क', amount: 100 }], [], null);
      }, 100);
    }));
    expect(Array.isArray(body.body)).toBe(false); // सबसे ज़रूरी: raw array नहीं गया
    expect(body.body['1']).toBeTruthy();          // per-record (acc-keyed) फॉर्मेट ही गया
  });

  test('_migRender — "पलटा हुआ" HQ को लाल चेतावनी के साथ अलग दिखाता है, और माइग्रेट बटन भी दिखता रहता है (मैन्युअल ठीक करने के लिए)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => openMigModal());
    await page.evaluate(() => {
      _migRender([{ hq: 'आदेगांव', cat: 'कुल उपभोक्ता', a: { tot: 5, missingAcc: 0, dupAcc: 0, illegalAcc: 0, reverted: true } }]);
    });
    const html = await page.evaluate(() => document.getElementById('mig-content').innerHTML);
    expect(html).toContain('पलटा हुआ');
    expect(html).toContain('अपने आप ठीक होने की कोशिश करती हैं');
    // बग-फिक्स: पहले 'reverted' होने पर बटन पूरी तरह गायब हो जाता था — कोई मैन्युअल रास्ता नहीं बचता था
    expect(html).toContain('अभी माइग्रेट करें');
  });

  test('_migRender — सभी HQ/श्रेणी migrated हों तो "पूरी तरह माइग्रेट हो चुका है" दिखे, बटन नहीं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => openMigModal());
    await page.evaluate(() => {
      _migRender([
        { hq: 'आदेगांव', cat: 'कुल उपभोक्ता', a: { tot: 5, missingAcc: 0, dupAcc: 0, illegalAcc: 0, migrated: true } },
        { hq: 'आदेगांव', cat: 'व्यवसाय', a: { tot: 0, missingAcc: 0, dupAcc: 0, illegalAcc: 0, migrated: false } }, // खाली — गिनती में अड़चन नहीं
      ]);
    });
    const html = await page.evaluate(() => document.getElementById('mig-content').innerHTML);
    expect(html).toContain('पूरी तरह माइग्रेट हो चुका है');
    expect(html).not.toContain('अभी माइग्रेट करें');
    expect(html).toContain('migrated');
  });

  test('_migRender — कुछ migrated, कुछ बाकी हों तो migrate बटन के साथ गिनती दिखे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => openMigModal());
    await page.evaluate(() => {
      _migRender([
        { hq: 'आदेगांव', cat: 'कुल उपभोक्ता', a: { tot: 5, missingAcc: 0, dupAcc: 0, illegalAcc: 0, migrated: true } },
        { hq: 'पिंडरई', cat: 'कुल उपभोक्ता', a: { tot: 3, missingAcc: 0, dupAcc: 0, illegalAcc: 0, migrated: false } },
      ]);
    });
    const html = await page.evaluate(() => document.getElementById('mig-content').innerHTML);
    expect(html).toContain('अभी माइग्रेट करें');
    expect(html).toContain('1 पहले से माइग्रेट');
  });
});

test.describe('बकाया ≤0 अपने-आप वसूल — migration-aware push', () => {
  test('overlayOps — amount<=0 वाले records एक ही बार paid बनते हैं (दोहराव नहीं)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      var data = [
        { acc: '1', status: 'pending', amount: 0 },
        { acc: '2', status: 'pending', amount: -50 },
        { acc: '3', status: 'pending', amount: 100 },
      ];
      var applied = overlayOps('टेस्ट HQ1', 'कुल उपभोक्ता', data);
      return { applied: applied, data: data };
    });
    expect(r.applied).toBe(2);
    expect(r.data[0].status).toBe('paid');
    expect(r.data[1].status).toBe('paid');
    expect(r.data[2].status).toBe('pending');
  });

  test('migrated HQ पर सिर्फ बदले acc का PATCH भेजा जाता है — पूरी array नहीं (bug-fix — पहले यह चुपचाप migration पलट देता था)', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      MIGRATED[hqKey('टेस्ट HQ2')] = {}; MIGRATED[hqKey('टेस्ट HQ2')][catKey('कुल उपभोक्ता')] = true;
    });
    const call = await page.evaluate(() => new Promise((resolve) => {
      const real = window.fetch;
      window.fetch = function (url, opts) {
        if (String(url).indexOf('टेस्ट_HQ2') > -1) {
          window.fetch = real;
          resolve({ method: opts.method, body: JSON.parse(opts.body) });
          return Promise.resolve({ ok: true, json: () => Promise.resolve(true) });
        }
        return real(url, opts);
      };
      var data = [
        { acc: '5', status: 'pending', amount: 0 },
        { acc: '6', status: 'pending', amount: 100 },
      ];
      overlayOps('टेस्ट HQ2', 'कुल उपभोक्ता', data);
    }));
    expect(call.method).toBe('PATCH');
    expect(Object.keys(call.body)).toEqual(['5']); // सिर्फ बदला हुआ acc — '6' (जो नहीं बदला) शामिल नहीं
    expect(call.body['5']).toEqual(expect.objectContaining({ status: 'paid' }));
  });

  test('migrated न हो तो पुराने तरीके से (पूरी array PUT) भेजा जाता है', async ({ page }) => {
    await openApp(page);
    const call = await page.evaluate(() => new Promise((resolve) => {
      const real = window.fetch;
      window.fetch = function (url, opts) {
        if (String(url).indexOf('टेस्ट_HQ3') > -1) {
          window.fetch = real;
          resolve({ method: opts.method });
          return Promise.resolve({ ok: true, json: () => Promise.resolve(true) });
        }
        return real(url, opts);
      };
      // v9.167: flags/रूप दोनों अनजान हों तो _fbPut पहले सर्वर पर रूप जांचता है — यह test पुराने (array) रास्ते का है, इसलिए रूप पहले से 'array' दर्ज
      _noteShape('टेस्ट HQ3', 'कुल उपभोक्ता', []);
      cSet('टेस्ट HQ3', 'कुल उपभोक्ता', []);
      var data = [{ acc: '7', status: 'pending', amount: 0 }];
      overlayOps('टेस्ट HQ3', 'कुल उपभोक्ता', data);
    }));
    expect(call.method).toBe('PUT');
  });
});

// असली production: मढ़ी/कुल उपभोक्ता एक ही दिन में दो बार array में पलटी (10:40 और 12:57), जबकि
// सभी devices v9.117 पर थे — यानी संदेश की अपनी वजह ("बहुत पुराना version") ग़लत थी। जड़ यह कि
// "array लिखूं या per-record" का फ़ैसला पूरी तरह MIGRATED flag पर टिका था, और उस flag की दो अलग
// हालतें (सचमुच migrated नहीं / flag लोड ही नहीं हुआ) कोड में एक जैसी (false) दिखती थीं
test.describe('माइग्रेशन पलटने से पक्का बचाव — flag नहीं, सर्वर पर दिखे असली रूप पर भरोसा', () => {
  test('flag लोड न हुआ हो पर सर्वर पर list per-record हो — तो पूरी array कभी न लिखी जाए', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      MIGRATED = {};                                  // जैसे इस device पर flag लोड ही न हुआ हो
      localStorage.removeItem(SHAPE_KEY);
      _noteShape('मढ़ी', 'कुल उपभोक्ता', { '111': { acc: '111' } }); // सर्वर पर object देखी थी
      var sent = null;
      var orig = window.fetch;
      window.fetch = function (u, o) {
        if (String(u).indexOf(fbPath('मढ़ी', 'कुल उपभोक्ता')) > -1 && o && o.method === 'PUT') {
          sent = JSON.parse(o.body);
          return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
        }
        return orig(u, o);
      };
      _fbPut('मढ़ी', 'कुल उपभोक्ता', [{ acc: '111', name: 'क' }, { acc: '222', name: 'ख' }], function () {
        window.fetch = orig;
        resolve({ isArr: Array.isArray(sent), keys: sent ? Object.keys(sent) : null });
      });
    }));
    expect(r.isArr).toBe(false);            // बिना fix के यह array जाता — माइग्रेशन पलट जाती
    expect(r.keys).toEqual(['111', '222']); // per-record रूप में, acc की key से
  });

  test('जो list सचमुच migrate नहीं हुई (सर्वर पर array ही है) उस पर पुराना व्यवहार वैसा ही रहे', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      MIGRATED = {};
      localStorage.removeItem(SHAPE_KEY);
      _noteShape('जोबा', 'सूची-3', [{ acc: '9' }]); // सर्वर पर array ही देखी थी
      var sent = null;
      var orig = window.fetch;
      window.fetch = function (u, o) {
        if (String(u).indexOf(fbPath('जोबा', 'सूची-3')) > -1 && o && o.method === 'PUT') {
          sent = JSON.parse(o.body);
          return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
        }
        return orig(u, o);
      };
      _fbPut('जोबा', 'सूची-3', [{ acc: '9', name: 'ग' }], function () {
        window.fetch = orig;
        resolve({ isArr: Array.isArray(sent) });
      });
    }));
    expect(r.isArr).toBe(true); // यहाँ array लिखना ही सही है — बचाव बेवजह आड़े न आए
  });

  test('_noteShape — हर पढ़ाई पर रूप याद रहे, और खाली/अजीब जवाब पुरानी याद न मिटाए', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      localStorage.removeItem(SHAPE_KEY);
      var out = {};
      out.none = lastShape('पाटन', 'घरेलू');
      _noteShape('पाटन', 'घरेलू', [{ acc: '1' }]);      out.arr = lastShape('पाटन', 'घरेलू');
      _noteShape('पाटन', 'घरेलू', { '1': { acc: '1' } }); out.obj = lastShape('पाटन', 'घरेलू');
      _noteShape('पाटन', 'घरेलू', null);                 out.afterNull = lastShape('पाटन', 'घरेलू');
      _noteShape('पाटन', 'घरेलू', 'कचरा');               out.afterJunk = lastShape('पाटन', 'घरेलू');
      return out;
    });
    expect(r.none).toBeNull();
    expect(r.arr).toBe('arr');
    expect(r.obj).toBe('obj');
    expect(r.afterNull).toBe('obj'); // खाली जवाब से कुछ साबित नहीं होता — पुरानी याद बनी रहे
    expect(r.afterJunk).toBe('obj');
  });

  test('list पढ़ते ही उसका रूप अपने आप दर्ज हो जाए (fbGet) — इसके लिए कोई अलग call न लगे', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      localStorage.removeItem(SHAPE_KEY);
      cSet('बीबी', 'कृषि', []); // cache खाली — पहली बार वाला रास्ता
      var calls = 0;
      var orig = window.fetch;
      window.fetch = function (u, o) {
        if (String(u).indexOf(fbPath('बीबी', 'कृषि')) > -1) {
          calls++;
          return Promise.resolve({ ok: true, headers: { get: () => null },
            json: () => Promise.resolve({ '77': { acc: '77', name: 'घ' } }) });
        }
        return orig(u, o);
      };
      fbGet('बीबी', 'कृषि', function () {});
      setTimeout(() => { window.fetch = orig; resolve({ shape: lastShape('बीबी', 'कृषि'), calls: calls }); }, 400);
    }));
    expect(r.shape).toBe('obj');
    expect(r.calls).toBe(1); // वही एक पढ़ाई, कोई अतिरिक्त नहीं
  });

  // असली production (8 सितंबर, बीबी/3 month nonpayee, 306 records) — पलटाने वाला device v9.118
  // यानी बचाव वाले version पर ही था। जड़: dc_shape3 हर device पर खाली से शुरू होता है, और
  // flushPending() ऐप खुलते ही (main.js) चल जाता है — उस वक़्त इस device ने वह list एक बार भी
  // पढ़ी नहीं होती, तो lastShape() कुछ नहीं जानता और guard array लिखने दे देता। यह रास्ता सर्वर
  // का असली रूप ठीक अपने हाथ में लिए बैठा था (fetch का जवाब), बस उसे दर्ज नहीं करता था
  test('offline बदलाव sync होते समय भी सर्वर का रूप दर्ज हो — flag खाली हो तो भी array वापस न लिखे', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      localStorage.removeItem(SHAPE_KEY);
      MIGRATED = {};                       // जैसे flag अभी लोड ही न हुआ हो (ऐप अभी-अभी खुली)
      var hq = 'बीबी', cat = 'कृषि';
      cSet(hq, cat, [{ acc: '5', name: 'क', amount: 10, status: 'paid' }]);
      markPending(hq, cat, 'put');         // offline में किया गया एक बदलाव क़तार में (पुराना array रास्ता)
      var putBody = null;
      var orig = window.fetch;
      window.fetch = function (u, o) {
        if (String(u).indexOf(fbPath(hq, cat)) > -1) {
          if (o && o.method === 'PUT') { putBody = JSON.parse(o.body); return Promise.resolve({ ok: true, json: () => Promise.resolve(null) }); }
          // सर्वर पर list per-record (object) रूप में है
          return Promise.resolve({ ok: true, headers: { get: () => null },
            json: () => Promise.resolve({ '5': { acc: '5', name: 'क', amount: 10, status: 'pending' } }) });
        }
        return orig(u, o);
      };
      flushPending();
      setTimeout(() => {
        window.fetch = orig;
        clearPendingKey(cKey(hq, cat));
        resolve({ shape: lastShape(hq, cat), wroteArray: Array.isArray(putBody), body: putBody });
      }, 700);
    }));
    expect(r.shape).toBe('obj');       // पढ़ते ही रूप दर्ज हुआ
    expect(r.wroteArray).toBe(false);  // और इसीलिए array वापस नहीं लिखी गई — माइग्रेशन बचा
    expect(r.body['5']).toBeTruthy();  // per-record रूप में ही सेव हुआ, बदलाव भी बचा
  });
});

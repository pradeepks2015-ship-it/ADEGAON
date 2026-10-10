// @ts-check
// वसूली ट्रैकर — टेस्ट: categories-rules (साझा helpers: tests/helpers.js)
const { test, expect, fs, path, openApp, loginLineman, loginJE } = require('./helpers');

test.describe('श्रेणी/HQ नाम में "/" — नेस्टेड Firebase path बनकर permission-denied (401) में फंसने से बचाव', () => {
  test('fbPath — HQ या category नाम में "/" हो तो भी सिर्फ़ 2-स्तर वाला path बने (एक भी हिस्से में "/" न बचे)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const p = await page.evaluate(() => fbPath('आदेगांव', 'vig/O&m Cases'));
    const parts = p.split('/');
    expect(parts.length).toBe(2);
    expect(parts[1]).not.toContain('/');
  });

  test('openEditCat — नाम में "/" (या .#$[]) लिखने पर रुक जाए, पुराना नाम ही बना रहे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    page.once('dialog', (d) => d.accept('vig/O&m Cases'));
    const before = await page.evaluate(() => CATS[4]);
    await page.evaluate(() => openEditCat(4, 'cat4'));
    await expect(page.locator('#toast')).toContainText('. # $ [ ] /');
    expect(await page.evaluate(() => CATS[4])).toBe(before);
  });

  // JE का अनुरोध: घरेलू/व्यवसाय/कृषि भी बदले जा सकें। "कुल उपभोक्ता" जान-बूझकर बाहर है —
  // वह मास्टर सूची है जिस पर गाँव-वार गिनती, स्कोरकार्ड और acc-dedup सब टिके हैं
  test('कुल उपभोक्ता को छोड़कर हर श्रेणी बदली जा सके — पेंसिल भी उसी हिसाब से दिखे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      var flags = [0, 1, 2, 3, 4, 5, 6, 7].map(isCatEditable);
      buildCatTabs();
      var pencils = document.querySelectorAll('#cat-tabs button[title="नाम बदलें"]').length;
      return { flags: flags, pencils: pencils, tabs: document.querySelectorAll('#cat-tabs .cat-tab').length };
    });
    expect(r.flags).toEqual([false, true, true, true, true, true, true, true]);
    expect(r.tabs).toBe(8);
    expect(r.pencils).toBe(7); // 8 में से 7 — "कुल उपभोक्ता" पर पेंसिल नहीं
  });

  test('कुल उपभोक्ता का नाम सीधे function बुलाकर भी न बदले (defense-in-depth)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      var asked = 0;
      var oP = window.prompt; window.prompt = function () { asked++; return 'कुछ और'; };
      try { openEditCat(0, 'cat0'); } finally { window.prompt = oP; }
      return { asked: asked, name: CATS[0] };
    });
    expect(r.asked).toBe(0);          // पूछा तक नहीं
    expect(r.name).toBe('कुल उपभोक्ता');
  });

  // असली ख़तरा: fbPath श्रेणी के *नाम* से बनता है, इसलिए नाम बदलना = डेटा का पता बदलना।
  // पहले rename सिर्फ़ cache+CAT_NAMES में होता था और सर्वर पर डेटा पुराने पते पर रह जाता —
  // फिर पहली ही पढ़ाई में खाली सूची cache पर लिख जाती, यानी सबकी स्क्रीन से डेटा ग़ायब
  test('नाम बदलने पर डेटा नए पते पर जाए, MIGRATED flag साथ चले, और पुराना *उसके बाद* हटे', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      var hq = 'बीबी', oldC = 'कृषि', newC = 'कृषि-नई';
      MIGRATED[hqKey(hq)] = {}; MIGRATED[hqKey(hq)][catKey(oldC)] = true;
      var calls = [];
      var orig = window.fetch;
      window.fetch = function (u, o) {
        var m = (o && o.method) || 'GET';
        var s = String(u);
        calls.push(m + ' ' + s.replace(FB, ''));
        if (m === 'GET' && s.indexOf(fbPath(hq, oldC)) > -1) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ '7': { acc: '7', name: 'क' } }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
      };
      renameCatData(hq, oldC, newC, function (res) {
        window.fetch = orig;
        var iPut = calls.findIndex((c) => c.indexOf('PUT') === 0 && c.indexOf(fbPath(hq, newC)) > -1);
        var iDel = calls.findIndex((c) => c.indexOf('DELETE') === 0 && c.indexOf(fbPath(hq, oldC)) > -1);
        resolve({ res: res, iPut: iPut, iDel: iDel,
          migNew: !!(MIGRATED[hqKey(hq)] || {})[catKey(newC)],
          migOld: !!(MIGRATED[hqKey(hq)] || {})[catKey(oldC)],
          flagPut: calls.some((c) => c.indexOf('PUT /MIGRATED/') === 0 && c.indexOf(catKey(newC)) > -1) });
      });
    }));
    expect(r.res.ok).toBe(true);
    expect(r.res.moved).toBe(1);
    expect(r.iPut).toBeGreaterThanOrEqual(0);
    expect(r.iDel).toBeGreaterThan(r.iPut); // पहले लिखो, *तब* पुराना हटाओ — बीच में नेट टूटे तो डेटा दोनों जगह रहे, कहीं नहीं ऐसा न हो
    expect(r.flagPut).toBe(true);
    expect(r.migNew).toBe(true);
    expect(r.migOld).toBe(false);
  });

  test('डेटा नए पते पर न पहुँच पाए तो नाम बदले ही नहीं (आधा-अधूरा rename न हो)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      var hq = 'बीबी', oldC = 'व्यवसाय', newC = 'व्यवसाय-नया';
      var deleted = false;
      var orig = window.fetch;
      window.fetch = function (u, o) {
        var m = (o && o.method) || 'GET';
        if (m === 'DELETE') deleted = true;
        if (m === 'GET' && String(u).indexOf(fbPath(hq, oldC)) > -1) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ '9': { acc: '9' } }) });
        }
        if (m === 'PUT') return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve(null) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
      };
      renameCatData(hq, oldC, newC, function (res) {
        window.fetch = orig;
        resolve({ ok: res.ok, deleted: deleted });
      });
    }));
    expect(r.ok).toBe(false);
    expect(r.deleted).toBe(false); // लिखाई नाकाम रही तो पुराना डेटा हाथ भी न लगे
  });

  // JE: "जो लिस्ट का नाम रीनेम कर रहा है वह अन्य 6 मुख्यालय में नहीं हो रहा" — नाम हर HQ का अपना
  // है (/CAT_NAMES/{HQ}/{index}), इसलिए अब पूछकर सभी छह में लगाया जा सकता है
  test('सभी मुख्यालयों में नाम लगे — हर HQ का अपना पुराना नाम अलग हो तो भी', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      // दो HQ में इस slot का नाम पहले से अलग-अलग है
      CAT_NAMES['पिंडरई'] = { 6: 'पुराना-पिंडरई' };
      CAT_NAMES['जोबा'] = { 6: 'सूची-2' };
      rebuildCatsForHQ(activeHQ);
      var moves = [], puts = [];
      var oF = window.fetch, oP = window.prompt, oC = window.confirm, oCnt = window.catRecordCount, oMv = window.renameCatData;
      window.prompt = () => 'एक-जैसा-नाम';
      window.confirm = () => true;                      // "सभी 6 में" + पक्का, दोनों हाँ
      window.catRecordCount = (hq, cat, cb) => cb(5);
      window.renameCatData = (hq, oldCat, newCat, cb) => { moves.push(hq + '|' + oldCat); cb({ ok: true, moved: 5 }); };
      window.fetch = function (u, o) {
        if (String(u).indexOf('/CAT_NAMES/') > -1 && o && o.method === 'PUT') {
          puts.push(String(u).replace(FB, ''));
          return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
        }
        return oF(u, o);
      };
      openEditCat(6, 'cat6');
      setTimeout(() => {
        window.fetch = oF; window.prompt = oP; window.confirm = oC;
        window.catRecordCount = oCnt; window.renameCatData = oMv;
        resolve({ moves: moves, puts: puts.length,
          names: HQS.map((h) => getCatName(h, 6)) });
      }, 600);
    }));
    expect(r.moves.length).toBe(6);                                  // छहों का डेटा हिला
    expect(r.moves).toContain('पिंडरई|पुराना-पिंडरई');                  // हर HQ का अपना पुराना नाम
    expect(r.moves).toContain('जोबा|सूची-2');
    expect(r.puts).toBe(6);                                          // हर HQ का अपना CAT_NAMES PUT
    expect(r.names).toEqual(Array(6).fill('एक-जैसा-नाम'));            // छहों में एक ही नाम
  });

  test('"सिर्फ़ इस मुख्यालय में" चुनें तो बाक़ी पाँच को हाथ न लगे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      var moves = [];
      var oP = window.prompt, oC = window.confirm, oCnt = window.catRecordCount, oMv = window.renameCatData, oF = window.fetch;
      var asked = 0;
      window.prompt = () => 'सिर्फ-यहाँ';
      window.confirm = () => (++asked === 1 ? false : true); // पहला सवाल (सभी 6?) = नहीं
      window.catRecordCount = (hq, cat, cb) => cb(2);
      window.renameCatData = (hq, oldCat, newCat, cb) => { moves.push(hq); cb({ ok: true, moved: 2 }); };
      window.fetch = function (u, o) {
        if (String(u).indexOf('/CAT_NAMES/') > -1 && o && o.method === 'PUT') return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
        return oF(u, o);
      };
      openEditCat(7, 'cat7');
      setTimeout(() => {
        window.prompt = oP; window.confirm = oC; window.catRecordCount = oCnt; window.renameCatData = oMv; window.fetch = oF;
        resolve({ moves: moves, others: HQS.filter((h) => h !== activeHQ).map((h) => getCatName(h, 7)) });
      }, 600);
    }));
    expect(r.moves).toEqual(['आदेगांव']);
    expect(r.others).toEqual(Array(5).fill('सूची-3')); // बाक़ी पाँच जस के तस
  });

  test('किसी एक HQ में डेटा न पहुँचे तो सिर्फ़ उसी का नाम पुराना रहे (बाक़ी बदल जाएँ)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      var oP = window.prompt, oC = window.confirm, oCnt = window.catRecordCount, oMv = window.renameCatData, oF = window.fetch;
      window.prompt = () => 'नया-सबमें';
      window.confirm = () => true;
      window.catRecordCount = (hq, cat, cb) => cb(3);
      window.renameCatData = (hq, oldCat, newCat, cb) => cb(hq === 'मढ़ी' ? { ok: false, why: 'net' } : { ok: true, moved: 3 });
      window.fetch = function (u, o) {
        if (String(u).indexOf('/CAT_NAMES/') > -1 && o && o.method === 'PUT') return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
        return oF(u, o);
      };
      openEditCat(6, 'cat6');
      setTimeout(() => {
        window.prompt = oP; window.confirm = oC; window.catRecordCount = oCnt; window.renameCatData = oMv; window.fetch = oF;
        resolve({ madhi: getCatName('मढ़ी', 6), others: HQS.filter((h) => h !== 'मढ़ी').map((h) => getCatName(h, 6)) });
      }, 700);
    }));
    expect(r.madhi).toBe('सूची-2');                          // नाकाम HQ का नाम नहीं बदला — डेटा दिखता रहेगा
    expect(r.others).toEqual(Array(5).fill('नया-सबमें'));
  });

  test('किसी HQ में उसी नाम की दूसरी श्रेणी हो तो रुक जाए (दो सूचियाँ मिलने से बचाव)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      CAT_NAMES['बीबी'] = { 5: 'टकराव-नाम' };
      var moved = 0;
      var oP = window.prompt, oC = window.confirm, oMv = window.renameCatData;
      window.prompt = () => 'टकराव-नाम';
      window.confirm = () => true;                       // सभी 6 में
      window.renameCatData = (hq, o2, n2, cb) => { moved++; cb({ ok: true, moved: 1 }); };
      openEditCat(6, 'cat6');
      setTimeout(() => {
        window.prompt = oP; window.confirm = oC; window.renameCatData = oMv;
        resolve({ moved: moved, txt: document.getElementById('toast').textContent });
      }, 400);
    }));
    expect(r.moved).toBe(0);
    expect(r.txt).toContain('पहले से है');
  });

  test('ऑफ़लाइन नाम बदलने की कोशिश रुक जाए — डेटा हिलाया ही नहीं जा सकता', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      var asked = 0;
      var oP = window.prompt, oOn = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
      window.prompt = function () { asked++; return 'नया नाम'; };
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
      var before = CATS[1];
      try { openEditCat(1, 'cat1'); } finally {
        window.prompt = oP;
        if (oOn) Object.defineProperty(Navigator.prototype, 'onLine', oOn);
        delete navigator.onLine;
      }
      return { asked: asked, same: CATS[1] === before };
    });
    expect(r.asked).toBe(0);   // पूछने से पहले ही रोक दिया
    expect(r.same).toBe(true);
  });
});

test.describe('पुरानी categories मिटाएं — घरेलू/व्यवसाय/कृषि/गवर्नमेंट का unused data एक साथ हटाना (JE only)', () => {
  test('clearcats-menu-item — lineman को न दिखे', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const hidden = await page.evaluate(() => getComputedStyle(document.getElementById('clearcats-menu-item')).display);
    expect(hidden).toBe('none');
  });

  test('clearOldCategoriesData — lineman सीधे function बुलाए तो भी कुछ न हो (defense-in-depth)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await page.evaluate(() => {
      cSet('आदेगांव', 'घरेलू', [{ acc: '1', name: 'X', status: 'pending', amount: 100 }]);
      clearOldCategoriesData();
      return cGet('आदेगांव', 'घरेलू').length;
    });
    expect(r).toBe(1); // कुछ नहीं हटा
  });

  test('सिर्फ़ घरेलू/व्यवसाय/कृषि/गवर्नमेंट (नाम से मिलान) मिटें — rename हो चुकी category सुरक्षित रहे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      cSet('आदेगांव', 'घरेलू', [{ acc: '1', status: 'pending', amount: 100 }]);
      cSet('आदेगांव', 'कुल उपभोक्ता', [{ acc: '1', status: 'pending', amount: 100 }]); // मास्टर — छूना नहीं चाहिए
      // पाटन में slot 4 ("गवर्नमेंट") को rename कर दिया गया है — इसे न छुआ जाए
      CAT_NAMES['पाटन'] = { 4: '3 MONTH NON PAYEE' };
      cSet('पाटन', '3 MONTH NON PAYEE', [{ acc: '2', status: 'pending', amount: 200 }]);
      window.confirm = function () { return true; };
      var origFbDel = fbDel;
      var delCalls = [];
      fbDel = function (hq, cat, cb) { delCalls.push(hq + '/' + cat); cSet(hq, cat, []); if (cb) cb(); };
      clearOldCategoriesData();
      setTimeout(() => {
        fbDel = origFbDel;
        resolve({
          delCalls: delCalls,
          adegaonGhareluGone: cGet('आदेगांव', 'घरेलू').length,
          masterSafe: cGet('आदेगांव', 'कुल उपभोक्ता').length,
          patanRenamedSafe: cGet('पाटन', '3 MONTH NON PAYEE').length,
        });
      }, 100);
    }));
    expect(r.delCalls).toContain('आदेगांव/घरेलू');
    expect(r.delCalls).not.toContain('पाटन/3 MONTH NON PAYEE'); // rename हो चुकी थी — सुरक्षित
    expect(r.adegaonGhareluGone).toBe(0);
    expect(r.masterSafe).toBe(1); // "कुल उपभोक्ता" कभी नहीं छूती
    expect(r.patanRenamedSafe).toBe(1); // rename वाली category का data सुरक्षित रहा
  });

  test('confirm में "नहीं" चुनने पर कुछ न मिटे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      cSet('आदेगांव', 'घरेलू', [{ acc: '1', status: 'pending', amount: 100 }]);
      window.confirm = function () { return false; };
      clearOldCategoriesData();
      return cGet('आदेगांव', 'घरेलू').length;
    });
    expect(r).toBe(1);
  });
});

test.describe('database.rules.json — HQ_PIN अब सिर्फ़ JE ही पढ़/लिख सके (v9.146 सुरक्षा-फिक्स: पहले "auth != null" था, यानी कोई भी login-किया — anonymous भी, ऐप अपने-आप हर visitor को anonymous sign-in करा देता है — बिना कुछ किए सीधे /HQ_PIN.json पढ़कर सभी HQ के PIN पा सकता था, और PIN से बना Firebase password इस्तेमाल करके सीधे उस HQ के असली account में घुस सकता था — असली account-takeover रास्ता)', () => {
  test('HQ_PIN का read भी CAT_NAMES/MIGRATED जैसे JE-only ही हो — किसी और को (anonymous समेत) कच्चा PIN न दिखे', () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8'));
    const hqPinRule = rules.rules.HQ_PIN;
    expect(hqPinRule, 'HQ_PIN का अपना top-level rule होना चाहिए — $other के भरोसे नहीं').toBeTruthy();
    expect(hqPinRule['.write']).toBe("auth.token.email === 'pradeepks2015@gmail.com'");
    expect(hqPinRule['.read']).toBe("auth.token.email === 'pradeepks2015@gmail.com'"); // अब login के वक़्त client PIN जांचता ही नहीं — असली जांच सीधे Firebase signIn करता है (देखें doLogin)
  });
});

test.describe('database.rules.json — MIGRATED सिर्फ़ JE लिख सके (bug: "$other" के तहत कोई भी authenticated flag पलट सकता था — array/per-record format गड़बड़ाकर data corruption का खतरा)', () => {
  test('MIGRATED का अपना explicit rule हो — सिर्फ JE-only write (सिर्फ migration.js: confirmAndRunMigration से लिखा जाता है, कोई और flow नहीं)', () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8'));
    const migratedRule = rules.rules.MIGRATED;
    expect(migratedRule, 'MIGRATED का अपना top-level rule होना चाहिए — $other के भरोसे नहीं').toBeTruthy();
    expect(migratedRule['.write']).toBe("auth.token.email === 'pradeepks2015@gmail.com'");
    expect(migratedRule['.read']).toBe('auth != null'); // हर device fbSet() से पहले isMigrated() जांचता है, इसलिए पढ़ना सबके लिए ज़रूरी है
  });
});

test.describe('database.rules.json — PH_CUSTOM_MSG (फोन-मॉडल "अपना संदेश") सिर्फ़ JE लिख सके, बाक़ी सब पढ़ सकें', () => {
  test('PH_CUSTOM_MSG का अपना explicit rule हो — CAT_NAMES जैसा ही JE-only write, सबके लिए read', () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8'));
    const rule = rules.rules.PH_CUSTOM_MSG;
    expect(rule, 'PH_CUSTOM_MSG का अपना top-level rule होना चाहिए — $other के भरोसे नहीं').toBeTruthy();
    expect(rule['.write']).toBe("auth.token.email === 'pradeepks2015@gmail.com'");
    expect(rule['.read']).toBe('auth != null'); // हर लाइनमैन का device फ़ोन-मॉडल में यही संदेश पढ़ता है
  });
});

test.describe('database.rules.json — DEVICE_VERSIONS को पूरी तरह anonymous (कभी login न किया हो) visitor लिख न सके, सिर्फ JE पढ़ सके', () => {
  test('DEVICE_VERSIONS का अपना explicit rule हो — हर लॉगिन-किया device (JE + लाइनमैन दोनों) लिख सके, पर सिर्फ JE पढ़े', () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8'));
    const dvRule = rules.rules.DEVICE_VERSIONS;
    expect(dvRule, 'DEVICE_VERSIONS का अपना top-level rule होना चाहिए — $other के भरोसे नहीं').toBeTruthy();
    expect(dvRule['.read']).toBe("auth.token.email === 'pradeepks2015@gmail.com'"); // सिर्फ JE का device-viewer इसे इस्तेमाल करता है
    const devWrite = dvRule.$dev && dvRule.$dev['.write'];
    expect(devWrite, '$dev.write होना चाहिए — startDevicePing हर लॉगिन-किया device (लाइनमैन समेत) से चलता है').toBeTruthy();
    expect(devWrite).toContain("sign_in_provider !== 'anonymous'"); // सिर्फ असल लॉगिन-किया identity लिख सके, कोरा anonymous visitor नहीं
  });
});

test.describe('database.rules.json — DEVICE_VERSIONS/$dev पर अब field-validation भी हो (v9.146: पहले कोई .validate नहीं था — कोई भी लॉगिन-किया device किसी भी दूसरे device के version-रिकॉर्ड में मनमाने आकार/आकृति का data भर सकता था)', () => {
  test('$dev पर तय fields (v/hq/role/name/t) और हर एक पर type+लंबाई की सीमा हो, अतिरिक्त field रुके', () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8'));
    const dev = rules.rules.DEVICE_VERSIONS.$dev;
    expect(dev['.validate']).toBe("newData.hasChildren(['v','hq','role','name','t'])");
    expect(dev.v['.validate']).toContain('isString()');
    expect(dev.hq['.validate']).toContain('isString()');
    expect(dev.role['.validate']).toContain('isString()');
    expect(dev.name['.validate']).toContain('isString()');
    expect(dev.t['.validate']).toContain('isNumber()');
    expect(dev.$f['.validate']).toBe(false); // pingDeviceVersion() के {v,hq,role,name,t} के अलावा कोई और field न बचे
  });
});

test.describe('database.rules.json — $other catch-all बहुत ढीला था (bug: LOGS/USAGE/PROFILE_PHOTOS कहीं explicit नहीं थे, "$other": auth != null के तहत कोई भी anonymous device मनमाना नया top-level path बनाकर junk data भर सकता था — storage/bandwidth abuse का खतरा)', () => {
  test('LOGS/USAGE/PROFILE_PHOTOS का अपना explicit rule हो, और $other पूरी तरह बंद (false) हो', () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8'));
    ['LOGS', 'USAGE', 'PROFILE_PHOTOS'].forEach((key) => {
      const rule = rules.rules[key];
      expect(rule, key + ' का अपना top-level rule होना चाहिए — $other के भरोसे नहीं').toBeTruthy();
    });
    expect(rules.rules.$other['.read']).toBe(false);
    expect(rules.rules.$other['.write']).toBe(false);
  });
});

// पहले तीनों rules सिर्फ़ ".read"/".write": "auth != null" थीं — यानी हर device (anonymous समेत)
// इन तीनों पूरे पेड़ों का मालिक था: LOGS/USAGE की कोई भी दिन-फ़ाइल मिटा सकता था (JE का पूरा
// diagnostic इतिहास एक DELETE में ग़ायब), किसी और की profile-फ़ोटो उसकी key पर लिखकर बदल सकता
// था (JE_... समेत), और चूंकि कोई size-cap नहीं था, एक ही record में मनमाने MB भरकर free plan की
// 1 GB जगह/360 MB रोज़ाना quota चूस सकता था — यानी सबके लिए ऐप बंद। अब: बनाना सबके लिए खुला
// (नई log/usage entry), पर बदलना/मिटाना सिर्फ़ JE के लिए, और हर field पर लंबाई की सीमा।
test.describe('database.rules.json — LOGS/USAGE अब append-only हों (bug: कोई भी anonymous device पूरे LOGS/USAGE मिटा सकता था और असीमित बड़ा record लिखकर free-plan की जगह भर सकता था)', () => {
  const readRules = () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8')).rules;
  const JE = "auth.token.email === 'pradeepks2015@gmail.com'";

  ['LOGS', 'USAGE'].forEach((key) => {
    test(key + ' — पेड़ के ऊपर सिर्फ़ JE (मिटाना/बदलना), नई entry हर device बना सके पर मौजूदा को छू न सके', () => {
      const rule = readRules()[key];
      // पूरा दिन मिटाना (cleanupOldServerLogs / clearServerLogs / _usageCleanupOld) — तीनों
      // सिर्फ़ JE-only modal से चलते हैं, इसलिए ऊपर का .write JE तक सीमित करना सुरक्षित है
      expect(rule['.write']).toBe(JE);
      expect(rule['.read']).toBe(JE); // पढ़ने वाले सारे रास्ते (log/usage viewer) पहले से JE-only हैं
      const idRule = rule.$day && rule.$day.$id;
      expect(idRule, key + '/$day/$id का rule होना चाहिए — POST यहीं गिरता है').toBeTruthy();
      // "auth != null" ही रहे (non-anonymous नहीं) — logErr login से पहले भी चलता है, तब device
      // firebase.js के signInAnonymously वाले session पर होता है; वरना असली शुरुआती errors छूट जातीं
      expect(idRule['.write']).toContain('auth != null');
      expect(idRule['.write']).toContain('!data.exists()');  // मौजूदा entry पर दोबारा न लिख सके
      expect(idRule['.write']).toContain('newData.exists()'); // और अकेली entry मिटा भी न सके
    });
  });

  test('LOGS की हर entry के हर field पर लंबाई की सीमा हो (logErr खुद m को 300 और x को 200 पर काटता है — rule उससे ढीली न हो जाए)', () => {
    const f = readRules().LOGS.$day.$id.$f;
    expect(f, 'LOGS/$day/$id/$f पर .validate होना चाहिए').toBeTruthy();
    expect(f['.validate']).toContain('newData.isString()');
    const cap = /length <= (\d+)/.exec(f['.validate']);
    expect(cap, 'field की लंबाई पर स्पष्ट सीमा होनी चाहिए').toBeTruthy();
    expect(Number(cap[1])).toBeGreaterThanOrEqual(300); // logErr का सबसे बड़ा field (m) कट कर 300 का होता है
    expect(Number(cap[1])).toBeLessThanOrEqual(1000);
  });

  test('USAGE की entry में सिर्फ़ d/n/b/t चलें (b संख्या हो, ऋणात्मक नहीं) — बाक़ी कोई field न घुस सके', () => {
    const idRule = readRules().USAGE.$day.$id;
    expect(idRule['.validate']).toContain("newData.hasChildren(['b'])");
    expect(idRule.b['.validate']).toContain('isNumber');
    expect(idRule.b['.validate']).toContain('>= 0'); // ऋणात्मक bytes डालकर JE का कोटा-मीटर झूठा न कर सके
    expect(idRule.t['.validate']).toContain('isNumber');
    expect(idRule.d['.validate']).toContain('length <=');
    expect(idRule.n['.validate']).toContain('length <=');
    expect(idRule.$f['.validate']).toBe(false); // अनजान field = सीधे मना
  });
});

test.describe('database.rules.json — PROFILE_PHOTOS पर मालिकाना और size-cap (bug: कोई भी device किसी की भी फ़ोटो-key पर लिख सकता था — JE_... समेत — और base64 में कितने भी MB भर सकता था)', () => {
  const readRules = () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8')).rules;

  test('हर HQ का account सिर्फ़ अपने ही HQ के prefix वाली key लिख सके (लाइनमैन-खाते HQ-वार साझा हैं, इसलिए इससे बारीक पहचान संभव ही नहीं) — पढ़ना हर logged-in (non-anonymous) device के लिए खुला रहे', () => {
    const rules = readRules();
    const pp = rules.PROFILE_PHOTOS;
    // हर device login के बाद अपनी फ़ोटो पढ़ता है (profile.js: loadProfilePhoto केवल CU सेट होने पर चलता
    // है) — इसलिए anonymous session को बाहर रखना safe है; पहले bare "auth != null" से कोई भी बिना login
    // किए सारे लाइनमैन के नाम/फ़ोटो/role देख सकता था
    expect(pp['.read']).toBe("auth != null && auth.token.firebase.sign_in_provider !== 'anonymous'");
    expect(pp['.write'], 'पूरे PROFILE_PHOTOS पर खुला .write नहीं रहना चाहिए').toBeUndefined();
    const w = pp.$key && pp.$key['.write'];
    expect(w, 'PROFILE_PHOTOS/$key पर .write होना चाहिए').toBeTruthy();
    expect(w).toContain("auth.token.email === 'pradeepks2015@gmail.com'"); // JE सब ठीक कर सके
    // हर HQ के लिए एक जोड़ी: उसी HQ का uid + उसी HQ के नाम वाला key-prefix
    const HQS = ['आदेगांव', 'पिंडरई', 'जोबा', 'पाटन', 'बीबी', 'मढ़ी'];
    HQS.forEach((hq) => {
      const uid = /auth\.uid === '([^']+)'/.exec(rules[hq]['.read'])[1];
      expect(w, hq + ' के uid + prefix की जोड़ी होनी चाहिए')
        .toContain("(auth.uid === '" + uid + "' && $key.beginsWith('" + hq + "_'))");
    });
    // profile.js का _profileKey() JE के लिए "JE_" prefix बनाता है — किसी HQ-prefix से मेल नहीं
    // खाता, इसलिए कोई लाइनमैन-खाता JE की फ़ोटो नहीं बदल सकता
    expect(w).not.toContain("$key.beginsWith('JE_')");
  });

  test('फ़ोटो का आकार rule से बंधा हो — profile.js 160×160 JPEG (कुछ KB) भेजता है, सीमा उससे कहीं ऊपर पर फिर भी सीमित', () => {
    const k = readRules().PROFILE_PHOTOS.$key;
    expect(k['.validate']).toContain("newData.hasChildren(['photo'])");
    const cap = /length <= (\d+)/.exec(k.photo['.validate']);
    expect(cap, 'photo पर स्पष्ट लंबाई-सीमा होनी चाहिए').toBeTruthy();
    expect(Number(cap[1])).toBeLessThanOrEqual(200000); // ~200 KB base64 से ज़्यादा कभी नहीं
    expect(Number(cap[1])).toBeGreaterThanOrEqual(20000); // असली फ़ोटो (~10 KB base64) आराम से आ जाए
    expect(k.ts['.validate']).toContain('isNumber');
    expect(k.$f['.validate']).toBe(false);
  });

  test('profile.js जो fields भेजता है वही rule में allowed हों (कोई field छूट जाए तो पूरा PUT rule से रुक जाएगा)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'profile.js'), 'utf8');
    const body = /JSON\.stringify\(\{([^}]*)\}\)/.exec(src.slice(src.indexOf('PROFILE_PHOTOS/"+key')));
    expect(body, 'profile.js में PUT का body मिलना चाहिए').toBeTruthy();
    const fields = body[1].split(',').map((s) => s.split(':')[0].trim());
    const k = readRules().PROFILE_PHOTOS.$key;
    fields.forEach((f) => {
      expect(k[f], 'rule में "' + f + '" के लिए .validate होना चाहिए, वरना $f: false इसे रोक देगा').toBeTruthy();
    });
  });
});

test.describe('Firebase Rules — auto-deploy पाइपलाइन (bug: JE को हर बदलाव के बाद मैन्युअली Console में paste/publish करना पड़ता था — भूलने/copy-paste ग़लती से repo और असली live-rules में चुपचाप drift हो सकता था)', () => {
  test('deploy-rules.yml — database.rules.json बदलने पर main push से ट्रिगर हो, scripts/deploy-rules.js चलाए', () => {
    const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'deploy-rules.yml'), 'utf8');
    expect(wf).toMatch(/branches:\s*\[main\]/);
    expect(wf).toContain('database.rules.json');
    expect(wf).toContain('scripts/deploy-rules.js');
    expect(wf).toContain('FIREBASE_SERVICE_ACCOUNT'); // backup.js जैसा ही service account token — कोई नई secret नहीं चाहिए
  });

  test('scripts/deploy-rules.js — असली Firebase पर PUT करने से पहले rules JSON को local parse करके पक्का करे (ग़लत/टूटा JSON गलती से live न हो जाए)', () => {
    const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'deploy-rules.js'), 'utf8');
    expect(script).toContain('database.rules.json');
    expect(script).toMatch(/JSON\.parse\(rulesContent\)/); // deploy से पहले local validation
    expect(script).toContain('.settings/rules.json'); // Firebase RTDB का असली rules-management endpoint
    expect(script).toContain("method: \"PUT\"");
  });
});

test.describe('GitHub Actions workflows — firebase-admin/xlsx version pinned हो (v9.146: पहले "npm install firebase-admin" बिना version के — हर run पर अपने-आप नया (कभी breaking) major version आ जाता, deploy-rules/backup चुपचाप टूट सकते थे)', () => {
  test('deploy-rules.yml और backup.yml दोनों में firebase-admin@<version> — बिना version वाला install न हो', () => {
    const deployWf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'deploy-rules.yml'), 'utf8');
    const backupWf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'backup.yml'), 'utf8');
    expect(deployWf).toMatch(/firebase-admin@\d+\.\d+\.\d+/);
    expect(deployWf).not.toMatch(/install --no-save firebase-admin\s*$/m); // बिना version वाला install न रह जाए
    expect(backupWf).toMatch(/firebase-admin@\d+\.\d+\.\d+/);
    expect(backupWf).toMatch(/xlsx@\d+\.\d+\.\d+/);
  });
});

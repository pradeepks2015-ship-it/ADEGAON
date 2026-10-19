// @ts-check
// वसूली ट्रैकर — टेस्ट: upload-ledger (साझा helpers: tests/helpers.js)
const { test, expect, openApp, loginLineman, loginJE } = require('./helpers');

test.describe('लिस्ट अपलोड — सिर्फ़ JE का काम, lineman को बटन न दिखे', () => {
  test('buildActionBtns — lineman के लिए "अपलोड" बटन न बने, JE के लिए बने', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const linemanBtns = await page.evaluate(() => document.getElementById('action-btns').innerHTML);
    expect(linemanBtns).not.toContain('अपलोड');
  });

  // JE: "कैटेगरी में नए एडिट टेबल नाम तुरंत नहीं आ रहे हैं जिससे अपन उसमें अपलोड नहीं कर पा रहे"
  // विकल्प index.html में hardcoded थे और सिर्फ़ slots 4-7 सिंक होते थे
  test('अपलोड की श्रेणी-सूची बदले हुए नाम तुरंत दिखाए — घरेलू/व्यवसाय/कृषि समेत', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      CAT_NAMES['आदेगांव'] = { 1: 'घरेलू-नया', 3: 'कृषि-नई', 6: '3 MONTH NON PAYEE' };
      rebuildCatsForHQ('आदेगांव');
      activeHQ = 'आदेगांव';
      openUpModal();
      var opts = [].slice.call(document.querySelectorAll('#up-cat option')).map((o) => o.value);
      closeUpModal();
      return opts;
    });
    expect(r).toEqual(['', 'कुल उपभोक्ता', 'घरेलू-नया', 'व्यवसाय', 'कृषि-नई',
      'गवर्नमेंट', 'इंडस्ट्रियल', '3 MONTH NON PAYEE', 'सूची-3']);
  });

  // इससे भी ख़तरनाक: modal के अपने HQ-चयन से दूसरा मुख्यालय चुनने पर नाम पिछले HQ के ही रहते —
  // यानी "मढ़ी" चुनकर आदेगांव के नाम पर अपलोड हो जाता, यानी बिलकुल ग़लत पते पर
  test('modal में मुख्यालय बदलते ही श्रेणी-नाम भी उसी मुख्यालय के हो जाएँ', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      CAT_NAMES['आदेगांव'] = { 6: 'आदेगांव-वाली' };
      CAT_NAMES['मढ़ी'] = { 6: 'मढ़ी-वाली' };
      activeHQ = 'आदेगांव'; rebuildCatsForHQ(activeHQ);
      openUpModal();
      var before = [].slice.call(document.querySelectorAll('#up-cat option')).map((o) => o.value);
      document.getElementById('up-hq').value = 'मढ़ी';
      onUpHqChange();
      var after = [].slice.call(document.querySelectorAll('#up-cat option')).map((o) => o.value);
      closeUpModal();
      return { before: before, after: after };
    });
    expect(r.before).toContain('आदेगांव-वाली');
    expect(r.after).toContain('मढ़ी-वाली');
    expect(r.after).not.toContain('आदेगांव-वाली'); // पिछले HQ का नाम बचा न रह जाए
  });

  test('मुख्यालय बदलने पर वह चुनाव छूट जाए जो नए मुख्यालय में है ही नहीं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      CAT_NAMES['आदेगांव'] = { 6: 'सिर्फ-आदेगांव' };
      CAT_NAMES['बीबी'] = {};
      activeHQ = 'आदेगांव'; rebuildCatsForHQ(activeHQ);
      openUpModal();
      document.getElementById('up-cat').value = 'सिर्फ-आदेगांव';
      var picked = document.getElementById('up-cat').value;
      document.getElementById('up-hq').value = 'बीबी';
      onUpHqChange();
      var after = document.getElementById('up-cat').value;
      // पर जो नाम दोनों में एक जैसा है वह बचा रहना चाहिए
      document.getElementById('up-cat').value = 'कृषि';
      document.getElementById('up-hq').value = 'जोबा';
      onUpHqChange();
      var kept = document.getElementById('up-cat').value;
      closeUpModal();
      return { picked: picked, after: after, kept: kept };
    });
    expect(r.picked).toBe('सिर्फ-आदेगांव');
    expect(r.after).toBe('');       // बीबी में वह श्रेणी है ही नहीं — चुनाव साफ़
    expect(r.kept).toBe('कृषि');     // दोनों में है — बचा रहा
  });

  test('श्रेणी का नाम HTML जैसा हो तो भी सूची में टेक्स्ट ही रहे (markup न बने)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      CAT_NAMES['आदेगांव'] = { 6: '<img src=x onerror=alert(1)>' };
      activeHQ = 'आदेगांव'; rebuildCatsForHQ(activeHQ);
      openUpModal();
      var sel = document.getElementById('up-cat');
      var out = { imgs: sel.querySelectorAll('img').length,
        txt: [].slice.call(sel.options).map((o) => o.textContent).join('|') };
      closeUpModal();
      return out;
    });
    expect(r.imgs).toBe(0);
    expect(r.txt).toContain('<img src=x onerror=alert(1)>');
  });

  test('openUpModal — lineman सीधे function बुलाए तो भी न खुले (defense-in-depth)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const opened = await page.evaluate(() => {
      openUpModal();
      return document.getElementById('up-overlay').classList.contains('open');
    });
    expect(opened).toBe(false);
  });
});

// पहले "पुरानी वसूली सुरक्षित रखें" में कोई तारीख़-जांच नहीं थी — पिछले लेजर का हर "वसूल" नए लेजर
// में भी चिपक जाता, इसलिए जिसने नया बिल जमा नहीं किया वो भी "वसूल" दिखता, लाइनमैन उस तक जाता ही
// नहीं और वसूली चुपचाप छूट जाती
test.describe('नया लेजर अपलोड — सिर्फ़ चुनी तारीख़ से दर्ज वसूली ही आगे जाए', () => {
  const seed = async (page) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => {
      // तारीख़ें आज के सापेक्ष — "पिछला लेजर" = 20 दिन पहले, "चालू खिड़की" = आज
      var dmy = (d) => d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
      var today = new Date();
      var old = new Date(today.getTime() - 20 * 86400000);
      var cut = new Date(today.getTime() - 5 * 86400000); // कट-ऑफ़ इन दोनों के बीच
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '1', name: 'सिर्फ़ पिछला लेजर', amount: 3400, status: 'paid', paydate: dmy(old), ts: Date.now() },
        { acc: '2', name: 'पिछला + चालू (दोबारा वसूल किया)', amount: 3400, status: 'paid', paydate: dmy(today), ts: Date.now() },
        { acc: '3', name: 'सिर्फ़ चालू', amount: 3400, status: 'paid', paydate: dmy(today), ts: Date.now() },
        { acc: '4', name: 'कभी नहीं', amount: 3400, status: 'pending', ts: Date.now() },
      ]);
      openUpModal();
      document.getElementById('up-hq').value = 'आदेगांव';
      document.getElementById('up-cat').value = 'कुल उपभोक्ता';
      document.getElementById('up-keepfrom').value = cut.getFullYear() + '-' + ('0' + (cut.getMonth() + 1)).slice(-2) + '-' + ('0' + cut.getDate()).slice(-2);
      setUpMode('replace');
      // नया (सितंबर) लेजर — सब pending
      parsedRows = ['1', '2', '3', '4'].map(function (a) {
        return { acc: a, name: 'उपभोक्ता ' + a, amount: 1200, status: 'pending', remarksArr: [] };
      });
    });
  };

  test('कट-ऑफ़ से पुरानी (पिछले माह की) वसूली हट जाए, इसी माह वाली बनी रहे', async ({ page }) => {
    await seed(page);
    const r = await page.evaluate(() => {
      confirmUpload();
      var d = cGet('आदेगांव', 'कुल उपभोक्ता');
      var by = {}; d.forEach(function (x) { by[x.acc] = x.status; });
      return by;
    });
    expect(r['1']).toBe('pending'); // सिर्फ़ 25 अगस्त — कट-ऑफ़ से पुरानी, हट गई
    expect(r['2']).toBe('paid');    // दोबारा वसूल करने से paydate चालू माह की — बनी रही
    expect(r['3']).toBe('paid');    // 5 सितंबर — बनी रही
    expect(r['4']).toBe('pending'); // कभी जमा ही नहीं किया
  });

  test('_upKeepPreview — अपलोड से पहले ही दिखे कि कितनी वसूली रहेगी और कितनी हटेगी', async ({ page }) => {
    await seed(page);
    const note = await page.evaluate(() => { _upKeepPreview(); return document.getElementById('up-keepnote').textContent; });
    expect(note).toContain('2 उपभोक्ता की वसूली बनी रहेगी'); // acc 2 और 3
    expect(note).toContain('1 पुरानी');                      // acc 1
  });

  test('checkbox हटा दें तो कोई वसूली आगे न जाए (पुराना व्यवहार बरकरार)', async ({ page }) => {
    await seed(page);
    const r = await page.evaluate(() => {
      document.getElementById('up-keeppaid').checked = false;
      // checkbox हटाने पर अब पुष्टि पूछी जाती है (पूरे HQ की वसूली मिटती है) — यहां "हां" मानकर
      // वही पुराना व्यवहार जांचते हैं: कोई वसूली आगे न जाए
      window.confirm = () => true;
      confirmUpload();
      return cGet('आदेगांव', 'कुल उपभोक्ता').filter(function (x) { return x.status === 'paid'; }).length;
    });
    expect(r).toBe(0);
  });
});

test.describe('लेजर अपलोड के बाद reconcileHQ चले — किसी भी category में वसूल acc सभी categories में वसूल हो (bug: जोबा में "किशन" category 176 वसूल दिखाती थी, बाद में अलग से अपलोड हुई "कुल उपभोक्ता" सिर्फ़ 29 — दोनों categories का लेजर अलग-अलग समय अपलोड होने से status नहीं मिल पाया, क्योंकि सामान्य अपलोड के बाद reconcileHQ कभी नहीं चलता था — सिर्फ़ कैश-लिस्ट अपलोड में चलता था)', () => {
  test('replace mode — नई category upload होने पर, किसी और (पहले से मौजूद) category में वसूल acc नई category में भी वसूल आए', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      // "घरेलू" में यह उपभोक्ता पहले से वसूल है (जैसे "किशन" में था)।
      // तारीख़ आज की — यह टेस्ट categories के बीच मिलान (reconcileHQ) जांचता है, वसूली का
      // पुराना/नया होना नहीं। पहले यहां तय तारीख़ '1/1/2026' थी; sweepStalePaid आने के बाद वह
      // "पिछले लेजर की" मानी जाने लगी और टेस्ट असल में वही (दूसरा) नियम जांचने लगता। पुरानी
      // तारीख़ वाला मामला अपने अलग describe ब्लॉक में जांचा जाता है (sweepStalePaid, फ़ाइल के अंत में)
      const n = new Date();
      const todayDmy = n.getDate() + '/' + (n.getMonth() + 1) + '/' + n.getFullYear();
      cSet('आदेगांव', 'घरेलू', [
        { acc: '1', name: 'राम', status: 'paid', paydate: todayDmy, amount: 100 },
      ]);
      openUpModal();
      document.getElementById('up-hq').value = 'आदेगांव';
      document.getElementById('up-cat').value = 'कुल उपभोक्ता';
      setUpMode('replace');
      // नया "कुल उपभोक्ता" लेजर — सब pending (जैसा असली नए लेजर में होता है)
      parsedRows = [{ acc: '1', name: 'राम', amount: 100, status: 'pending', remarksArr: [] }];
      confirmUpload();
      var d = cGet('आदेगांव', 'कुल उपभोक्ता');
      return { status: d.find(function (x) { return x.acc === '1'; }).status };
    });
    expect(r.status).toBe('paid'); // reconcileHQ ने "घरेलू" से मिलाकर नई "कुल उपभोक्ता" में भी वसूल कर दिया
  });

  test('merge mode — नई category upload होने पर भी reconcileHQ चले', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '1', name: 'राम', status: 'paid', paydate: '1/1/2026', amount: 100 },
      ]);
      cSet('आदेगांव', 'घरेलू', [
        { acc: '1', name: 'राम', status: 'pending', amount: 100 }, // अभी तक "बाकी" — merge में यह list खाली न होने से "merge" पथ चलेगा
      ]);
      openUpModal();
      document.getElementById('up-hq').value = 'आदेगांव';
      document.getElementById('up-cat').value = 'घरेलू';
      setUpMode('merge');
      parsedRows = [{ acc: '2', name: 'श्याम', amount: 200, status: 'pending', remarksArr: [] }]; // नया, अलग acc
      confirmUpload();
      var d = cGet('आदेगांव', 'घरेलू');
      return { status: d.find(function (x) { return x.acc === '1'; }).status };
    });
    expect(r.status).toBe('paid'); // reconcileHQ ने "कुल उपभोक्ता" से मिलाकर "घरेलू" का पुराना acc भी वसूल कर दिया
  });
});

// असली production bug (JE की रिपोर्ट, मढ़ी): एक ही Consumer No के दो अलग card एक साथ दिखे। जड़: Merge
// mode में पहले से duplicate-acc जांच थी (मौजूदा list से मिलाते वक़्त), पर Replace mode में नहीं —
// फ़ाइल में ही वही Consumer No दो बार हो (जैसे मीटर बदलने पर) तो दोनों सीधे सेव हो जाते थे। migrated
// (per-record) श्रेणी में यह सिर्फ़ दिखावटी confusion नहीं — दोनों की Firebase-key वही acc होती, तो एक
// को "वसूल" मार्क करने पर patch उसी key पर टकराता और दूसरे की वसूली चुपचाप overwrite हो सकती थी
test.describe('Replace mode अपलोड — फ़ाइल में ही duplicate Consumer No हो तो पहला रखें, बाकी skip करें', () => {
  test('same acc वाले 2 rows में से सिर्फ़ पहला बचे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      openUpModal();
      document.getElementById('up-hq').value = 'आदेगांव';
      document.getElementById('up-cat').value = 'कुल उपभोक्ता';
      setUpMode('replace');
      parsedRows = [
        { acc: '1134004076', name: 'GAREEBA CHAMAR पहला', amount: 609, status: 'pending', remarksArr: [] },
        { acc: '2', name: 'दूसरा उपभोक्ता', amount: 200, status: 'pending', remarksArr: [] },
        { acc: '1134004076', name: 'GAREEBA CHAMAR दूसरा (duplicate)', amount: 609, status: 'pending', remarksArr: [] },
      ];
      confirmUpload();
      var d = cGet('आदेगांव', 'कुल उपभोक्ता');
      return { count: d.length, names: d.map(function (x) { return x.name; }), toastText: document.getElementById('toast').textContent };
    });
    expect(r.count).toBe(2); // duplicate वाला तीसरा row skip हुआ
    expect(r.names).toContain('GAREEBA CHAMAR पहला'); // पहला occurrence बचा
    expect(r.names).not.toContain('GAREEBA CHAMAR दूसरा (duplicate)');
    expect(r.toastText).toContain('1 duplicate Consumer No skip');
  });

  test('acc-रहित रिकॉर्ड यहां नहीं छुए जाएं — वो चरण-3 की अलग समस्या है', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      openUpModal();
      document.getElementById('up-hq').value = 'आदेगांव';
      document.getElementById('up-cat').value = 'कुल उपभोक्ता';
      setUpMode('replace');
      parsedRows = [
        { acc: '', name: 'Consumer No खाली 1', amount: 100, status: 'pending', remarksArr: [] },
        { acc: '', name: 'Consumer No खाली 2', amount: 100, status: 'pending', remarksArr: [] },
      ];
      confirmUpload();
      return cGet('आदेगांव', 'कुल उपभोक्ता').length;
    });
    expect(r).toBe(2); // दोनों acc-रहित records बने रहे, ग़लती से duplicate मानकर हटे नहीं
  });
});

// (ख) पुरानी कॉपी वाला फ़ोन सेव करे तो सर्वर पर पड़ा किसी और का रिमार्क न दबे — per-record PATCH पूरा
// record भेजता है, इसलिए भेजने से पहले उस record का सर्वर वाला remarksArr पढ़कर मिलाया जाता है
test.describe('सेव से पहले सर्वर के रिमार्क मिलाओ — पुरानी कॉपी वाला फ़ोन किसी का रिमार्क न मिटाए', () => {
  const setup = (page, opts) => page.evaluate((o) => new Promise((resolve) => {
    Object.defineProperty(navigator, 'onLine', { get: () => o.online !== false, configurable: true });
    var hq = 'टेस्ट HQ31', cat = 'कुल उपभोक्ता';
    MIGRATED[hqKey(hq)] = {}; MIGRATED[hqKey(hq)][catKey(cat)] = true;
    var serverRmk = [{ text: 'कल शाम आएंगे', by: 'राजू', at: '23/9/2026, 6:00 pm' }];
    var gets = [], patches = [];
    var orig = window.fetch;
    window.fetch = function (url, init) {
      var u = String(url);
      if (u.indexOf(fbPath(hq, cat)) > -1) {
        if (init && init.method === 'PATCH') {
          patches.push(JSON.parse(init.body));
          return Promise.resolve(new Response('{}', { status: o.patchStatus || 200 }));
        }
        if (u.indexOf('/remarksArr.json') > -1) {
          gets.push(u);
          return Promise.resolve(new Response(JSON.stringify(serverRmk), { status: 200 }));
        }
      }
      return orig(url, init);
    };
    var n = o.count || 1;
    var prev = [], arr = [];
    for (var i = 0; i < n; i++) {
      prev.push({ acc: String(100 + i), name: 'उपभोक्ता', status: 'pending', o: i, remarksArr: [] });
      arr.push({ acc: String(100 + i), name: 'उपभोक्ता', status: 'paid', paydate: '24/9/2026', o: i, remarksArr: o.myRmk ? [{ text: 'मेरा', by: 'JE', at: '24/9/2026' }] : [] });
    }
    cSet(hq, cat, arr);
    fbSet(hq, cat, arr, prev, function (ok) {
      var after = function () {
        window.fetch = orig;
        resolve({ ok: ok, gets: gets.length, patches: patches, cache: cGet(hq, cat)[0].remarksArr.map(function (r) { return r.text; }) });
      };
      if (o.thenFlush) {
        o.patchStatus = 200;
        serverRmk.push({ text: 'offline के बीच डाला', by: 'मोहन', at: '24/9/2026, 9:00 am' });
        flushPending();
        setTimeout(after, 300);
      } else after();
    });
  }), opts);

  test('"वसूल" मार्क करने वाले फ़ोन पर रिमार्क नहीं था — सर्वर वाला रिमार्क PATCH में जाए, फ़ोन पर भी दिखे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await setup(page, {});
    expect(r.ok).toBe(true);
    expect(r.gets).toBe(1);
    expect(r.patches[0]['100'].status).toBe('paid');
    expect(r.patches[0]['100'].remarksArr.map((x) => x.text)).toEqual(['कल शाम आएंगे']);
    expect(r.cache).toEqual(['कल शाम आएंगे']);
  });

  test('अपना नया रिमार्क भी — सर्वर वाला पहले, अपना बाद में, कोई दोहराव नहीं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await setup(page, { myRmk: true });
    const texts = r.patches[0]['100'].remarksArr.map((x) => x.text);
    expect(texts).toEqual(['कल शाम आएंगे', 'मेरा']);
    expect(r.patches[0]['100'].remarks).toBe('मेरा');
  });

  test('थोक बदलाव (10 से ज़्यादा records, जैसे अपलोड) — हर record की अलग पढ़ाई न हो', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await setup(page, { count: 11 });
    expect(r.gets).toBe(0);
    expect(Object.keys(r.patches[0]).length).toBe(11);
  });

  test('offline में अटका patch — नेट आने पर भेजने से पहले इस बीच सर्वर पर आया रिमार्क भी मिले', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await setup(page, { patchStatus: 503, thenFlush: true });
    expect(r.ok).toBe(false);
    expect(r.patches.length).toBe(2);
    expect(r.patches[1]['100'].remarksArr.map((x) => x.text)).toEqual(['कल शाम आएंगे', 'offline के बीच डाला']);
  });
});

// असली शिकायत (JE, बीबी): कल डाले रिमार्क आज गायब। Replace/"हटाएं → अपलोड" में पहले सिर्फ़ "वसूल"
// उपभोक्ताओं के रिमार्क नई सूची में जाते थे — बाकी (अवसूल) उपभोक्ताओं के सब मिट जाते थे
test.describe('अपलोड में पुराने रिमार्क सुरक्षित — वसूल हो या बाकी, हर उपभोक्ता के', () => {
  const rmk = (t, by, at, cat) => ({ text: t, by: by || 'राजू', at: at || '23/9/2026, 5:00 pm', cat: cat });

  test('Replace — बाकी (अवसूल) उपभोक्ता का पुराना रिमार्क नई सूची में आए, फ़ाइल वाला भी बचे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate((R) => {
      cSet('बीबी', 'कुल उपभोक्ता', [
        { acc: '1', name: 'राम', status: 'pending', amount: 100, remarksArr: [R.a] },
        { acc: '2', name: 'श्याम', status: 'paid', paydate: new Date().toLocaleDateString('hi-IN'), amount: 100, remarksArr: [R.b] },
      ]);
      openUpModal();
      document.getElementById('up-hq').value = 'बीबी';
      document.getElementById('up-cat').value = 'कुल उपभोक्ता';
      setUpMode('replace');
      parsedRows = [
        { acc: '1', name: 'राम', amount: 300, status: 'pending', remarksArr: [R.f] },
        { acc: '2', name: 'श्याम', amount: 300, status: 'pending', remarksArr: [] },
        { acc: '3', name: 'नया', amount: 300, status: 'pending', remarksArr: [] },
      ];
      confirmUpload();
      var d = cGet('बीबी', 'कुल उपभोक्ता');
      var by = {}; d.forEach(function (x) { by[x.acc] = (x.remarksArr || []).map(function (y) { return y.text; }); });
      return { by: by, last1: d.find(function (x) { return x.acc === '1'; }).remarks, toast: document.getElementById('toast').textContent };
    }, { a: rmk('कल आएंगे'), b: rmk('जमा कर दिया'), f: rmk('फ़ाइल वाला', 'JE', '24/9/2026') });
    expect(r.by['1']).toEqual(['कल आएंगे', 'फ़ाइल वाला']); // पुराना पहले, फ़ाइल का आखिर में
    expect(r.last1).toBe('फ़ाइल वाला');
    expect(r.by['2']).toEqual(['जमा कर दिया']); // वसूल वाले का पहले की तरह
    expect(r.by['3']).toEqual([]);
    expect(r.toast).toContain('2 के रिमार्क सुरक्षित');
  });

  test('"हटाएं" के बाद अपलोड — backup से बाकी उपभोक्ता के रिमार्क वापस आएं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate((R) => {
      window.fetch = function () { return Promise.resolve(new Response('null', { status: 200 })); };
      cSet('बीबी', 'घरेलू', [{ acc: '7', name: 'राम', status: 'pending', amount: 100, remarksArr: [R.a] }]);
      fbDel('बीबी', 'घरेलू');
      var afterDel = cGet('बीबी', 'घरेलू').length;
      openUpModal();
      document.getElementById('up-hq').value = 'बीबी';
      document.getElementById('up-cat').value = 'घरेलू';
      setUpMode('replace');
      parsedRows = [{ acc: '7', name: 'राम', amount: 300, status: 'pending', remarksArr: [] }];
      confirmUpload();
      return { afterDel: afterDel, texts: cGet('बीबी', 'घरेलू')[0].remarksArr.map(function (y) { return y.text; }) };
    }, { a: rmk('मीटर बदलवाना है') });
    expect(r.afterDel).toBe(0);
    expect(r.texts).toEqual(['मीटर बदलवाना है']);
  });

  test('नई सूची — उपभोक्ता दूसरी category में पहले से हो तो उसके रिमार्क 📁 टैग के साथ आएं, दोहराव नहीं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate((R) => {
      cSet('बीबी', 'कुल उपभोक्ता', [{ acc: '9', name: 'राम', status: 'pending', amount: 100, remarksArr: [R.a, R.p] }]);
      cSet('बीबी', 'व्यवसाय', [{ acc: '9', name: 'राम', status: 'pending', amount: 100, remarksArr: [R.p] }]);
      cSet('बीबी', 'सूची-2', []);
      openUpModal();
      document.getElementById('up-hq').value = 'बीबी';
      document.getElementById('up-cat').value = 'सूची-2';
      setUpMode('merge'); // खाली category — replace वाला रास्ता चलेगा
      parsedRows = [{ acc: '9', name: 'राम', amount: 300, status: 'pending', remarksArr: [] }];
      confirmUpload();
      return cGet('बीबी', 'सूची-2')[0].remarksArr;
    }, { a: rmk('कुल वाला'), p: rmk('दोनों में फैला', 'राजू', '23/9/2026, 6:00 pm', 'व्यवसाय') });
    expect(r.map((y) => y.text)).toEqual(['कुल वाला', 'दोनों में फैला']); // propagate हुआ रिमार्क एक ही बार
    expect(r[0].cat).toBe('कुल उपभोक्ता'); // मूल category टैग जुड़ा
    expect(r[1].cat).toBe('व्यवसाय');
  });

  test('Merge — सिर्फ़ नए जुड़े उपभोक्ताओं में दूसरी category के रिमार्क आएं, पुराने records अछूते', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate((R) => {
      cSet('बीबी', 'कुल उपभोक्ता', [{ acc: '5', name: 'नया', status: 'pending', amount: 100, remarksArr: [R.a] }]);
      cSet('बीबी', 'घरेलू', [{ acc: '4', name: 'पुराना', status: 'pending', amount: 100, remarksArr: [] }]);
      openUpModal();
      document.getElementById('up-hq').value = 'बीबी';
      document.getElementById('up-cat').value = 'घरेलू';
      setUpMode('merge');
      parsedRows = [{ acc: '5', name: 'नया', amount: 300, status: 'pending', remarksArr: [] }];
      confirmUpload();
      var d = cGet('बीबी', 'घरेलू');
      return { n4: d.find((x) => x.acc === '4').remarksArr.length, t5: d.find((x) => x.acc === '5').remarksArr.map((y) => y.text), toast: document.getElementById('toast').textContent };
    }, { a: rmk('कुल में लिखा') });
    expect(r.n4).toBe(0);
    expect(r.t5).toEqual(['कुल में लिखा']);
    expect(r.toast).toContain('1 के रिमार्क साथ आए');
  });
});

test.describe('पुराने (v9.139 फिक्स से पहले के) अपलोड से बचे मिसमैच अपने-आप ठीक हों — reconcileHQ अब login और HQ/category tab बदलने पर भी चले, सिर्फ़ नए अपलोड पर नहीं (bug: जोबा में fix के बाद भी "कुल उपभोक्ता" में पुराना मिसमैच वैसा ही दिखता रहा — असली वजह: फिक्स सिर्फ़ भविष्य के अपलोड पर चलता है, पहले से मौजूद मिसमैच वाले device local cache को कभी नहीं छूता था)', () => {
  test('login पर सक्रिय (डिफ़ॉल्ट) HQ का पुराना मिसमैच reconcile हो जाए (auth पहले से तय मानकर)', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      window.AUTH_READY = true; // असली device पर auth तय होने के बाद वाली स्थिति — reconcileHQ तुरंत चले
      // supervisor login डिफ़ॉल्ट रूप से HQS[0] यानी "आदेगांव" पर खुलता है — वहीं पुराना मिसमैच बना देते हैं
      cSet('आदेगांव', 'कुल उपभोक्ता', [{ acc: '1', name: 'राम', status: 'pending', amount: 100 }]);
      cSet('आदेगांव', 'घरेलू', [{ acc: '1', name: 'राम', status: 'paid', paydate: '1/1/2026', amount: 100 }]);
    });
    await loginJE(page);
    const status = await page.evaluate(() => cGet('आदेगांव', 'कुल उपभोक्ता').find((x) => x.acc === '1').status);
    expect(status).toBe('paid');
  });

  test('HQ tab बदलने पर उस HQ का पुराना मिसमैच reconcile हो जाए (auth पहले से तय मानकर)', async ({ page }) => {
    await openApp(page);
    await loginJE(page); // डिफ़ॉल्ट "आदेगांव" पर लॉगिन
    await page.evaluate(() => {
      window.AUTH_READY = true;
      cSet('जोबा', 'कुल उपभोक्ता', [{ acc: '1', name: 'श्याम', status: 'pending', amount: 200 }]);
      cSet('जोबा', 'घरेलू', [{ acc: '1', name: 'श्याम', status: 'paid', paydate: '1/1/2026', amount: 200 }]);
    });
    await page.evaluate(() => {
      Array.from(document.querySelectorAll('#hq-tabs .hq-tab')).find((t) => t.textContent === 'जोबा').click();
    });
    const status = await page.evaluate(() => cGet('जोबा', 'कुल उपभोक्ता').find((x) => x.acc === '1').status);
    expect(status).toBe('paid');
  });

  test('category tab बदलने पर भी सक्रिय HQ का पुराना मिसमैच reconcile हो जाए (auth पहले से तय मानकर)', async ({ page }) => {
    await openApp(page);
    await loginJE(page); // डिफ़ॉल्ट "आदेगांव" पर लॉगिन
    await page.evaluate(() => {
      window.AUTH_READY = true;
      cSet('आदेगांव', 'कुल उपभोक्ता', [{ acc: '1', name: 'राम', status: 'pending', amount: 100 }]);
      cSet('आदेगांव', 'व्यवसाय', [{ acc: '1', name: 'राम', status: 'paid', paydate: '1/1/2026', amount: 100 }]);
    });
    await page.evaluate(() => {
      Array.from(document.querySelectorAll('#cat-tabs .cat-tab')).find((t) => t.textContent.indexOf('व्यवसाय') !== -1).click();
    });
    const status = await page.evaluate(() => cGet('आदेगांव', 'कुल उपभोक्ता').find((x) => x.acc === '1').status);
    expect(status).toBe('paid');
  });
});

test.describe('reconcileHQ अब auth तय होने तक रुके — silent restore पर Firebase account अभी अनिश्चित हो तो तुरंत fbSet न भेजें (bug v9.140: lineman डिवाइस पर सुबह ऐप खोलते ही "save-fail HTTP 401" — reconcileHQ हर login पर auth तय होने का इंतज़ार किए बिना तुरंत लिख देता था)', () => {
  test('AUTH_READY अभी false हो तो reconcileHQ तुरंत न चले, auth तय होते ही (waiter चलते ही) चले', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      window.AUTH_READY = false; // silent restore पर auth अभी resolve नहीं हुआ, जैसा असली bug में था
      _authWaiters.splice(0); // login के वक़्त की अपनी (असली) reconcileHQ waiter हटाकर सिर्फ़ इस टेस्ट का काउंट देखें
      var calls = 0;
      var origReconcile = window.reconcileHQ;
      window.reconcileHQ = function (hq) { calls++; return origReconcile(hq); };
      _afterAuthReady(function () { reconcileHQ('आदेगांव'); });
      var before = calls;
      window.AUTH_READY = true;
      _authWaiters.splice(0).forEach(function (f) { f(); }); // असली firebase.auth().onIdTokenChanged जैसा
      var after = calls;
      window.reconcileHQ = origReconcile;
      return { before: before, after: after };
    });
    expect(r.before).toBe(0); // auth तय होने से पहले न चले — 401 से बचाव
    expect(r.after).toBe(1); // auth तय होते ही चल जाए
  });

  test('_finishLogin (silent) — reconcileHQ तभी चले जब _ensureCorrectHqAuth का अपना sign-in वाक़ई पूरा हो जाए, सिर्फ़ शुरू होने पर नहीं (bug v9.141 पर भी दोहराया: sign-in अभी async चल ही रहा होता, reconcileHQ AUTH_READY देखकर उसी वक़्त अलग से चल जाता — फिर भी 401)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      window.AUTH_READY = true; // Firebase का initial auth-restore तो हो चुका है...
      var resolveSignIn;
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return {
          currentUser: { email: null }, // ...पर अभी भी anonymous — silent restore पर बिल्कुल यही होता है
          signInWithEmailAndPassword: function () {
            return new Promise((res) => { resolveSignIn = res; }); // जान-बूझकर अभी resolve नहीं करते
          },
        };
      };
      var calls = 0;
      var origReconcile = window.reconcileHQ;
      window.reconcileHQ = function (hq) { calls++; return origReconcile(hq); };
      CU = { role: 'lineman', name: 'देरी वाला', hq: 'आदेगांव', pin: '4321' };
      _finishLogin(CU.name, true); // silent = सेव किया session बहाल हुआ
      setTimeout(() => {
        var before = calls; // sign-in अभी pending है
        resolveSignIn({}); // अब असली sign-in पूरा हुआ मान लो
        setTimeout(() => {
          window.reconcileHQ = origReconcile;
          resolve({ before: before, after: calls });
        }, 50);
      }, 50);
    }));
    expect(r.before).toBe(0); // sign-in अभी पूरा नहीं हुआ था — reconcileHQ ने इंतज़ार किया, 401 से बचाव
    expect(r.after).toBe(1);  // sign-in पूरा होते ही चल गया
  });
});

test.describe('अपलोड — दो फ़ाइलें जल्दी-जल्दी चुनने पर race-condition न हो', () => {
  test('handleFile — पहली (धीमी) फ़ाइल का parse देर से पूरा हो तो भी उसे नज़रअंदाज़ करे, दूसरी (नई) फ़ाइल का ही data रहे (bug: पुराने HQ का data नए के ऊपर चढ़ जाना)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => { openUpModal(); document.getElementById('up-cat').value = 'घरेलू'; });
    const names = await page.evaluate(() => new Promise((resolve) => {
      var origReadAsText = FileReader.prototype.readAsText;
      var call = 0;
      FileReader.prototype.readAsText = function (blob) {
        var reader = this;
        var n = ++call;
        var delay = n === 1 ? 150 : 0; // पहली फ़ाइल जान-बूझकर धीमी (असली दुनिया में बड़ी Excel फ़ाइल जैसी)
        blob.text().then(function (txt) {
          setTimeout(function () {
            Object.defineProperty(reader, 'result', { value: txt, configurable: true });
            if (reader.onload) reader.onload({ target: reader });
          }, delay);
        });
      };
      var fileA = new File(['Consumer No,Consumer Name,Net Bill\n1001,OLD-HQ,100\n'], 'old.csv', { type: 'text/csv' });
      var fileB = new File(['Consumer No,Consumer Name,Net Bill\n2001,NEW-HQ,200\n'], 'new.csv', { type: 'text/csv' });
      handleFile(fileA); // धीमी, पुरानी फ़ाइल — पहले चुनी गई
      setTimeout(function () {
        handleFile(fileB); // तेज़, नई फ़ाइल — बाद में चुनी गई, पहले पूरी हो जाएगी
        setTimeout(function () {
          FileReader.prototype.readAsText = origReadAsText;
          resolve(parsedRows.map(function (r) { return r.name; }));
        }, 300);
      }, 20);
    }));
    expect(names).toEqual(['NEW-HQ']);
  });
});

// असली सवाल (JE, 28/9): "किसी मुख्यालय में कुल उपभोक्ता में नया लेजर अपलोड करूं और दूसरे बटनों में
// पुराना डाटा रहे — फिर एक को वसूल मार्क करूं तो दूसरा भी वसूल हो जाएगा क्या?" जड़ यह निकली कि
// अपलोड की तारीख़-कट-ऑफ़ सिर्फ़ उसी category पर लगती थी, और उसके तुरंत बाद चलने वाला reconcileHQ()
// दूसरे बटन में पड़ी पिछले माह की वसूली देखकर उसे नए लेजर में वापस ले आता था (नियम: किसी एक में
// वसूल = सब में वसूल)। नतीजा: जिसने नया बिल जमा नहीं किया वो भी "वसूल" दिखता और लाइनमैन उस तक
// जाता ही नहीं। अब sweepStalePaid() reconcileHQ से पहले हर बटन से पुरानी वसूली हटा देता है।
test.describe('नया लेजर अपलोड — पिछले लेजर की वसूली दूसरे बटनों से भी हटे (sweepStalePaid)', () => {
  // कट-ऑफ़ डिफ़ॉल्ट चालू माह की 1 तारीख़ है, इसलिए टेस्ट की तारीख़ें आज के हिसाब से बनें —
  // तय (hard-coded) तारीख़ रखने पर टेस्ट अगले महीने अपने-आप टूट जाता
  const dmy = (d) => d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
  const lastMonth = () => { const d = new Date(); d.setDate(1); d.setDate(0); return dmy(d); }; // पिछले माह का आख़िरी दिन
  const today = () => dmy(new Date());

  test('सुखराम वाला मामला — दूसरे बटन में पड़ी पिछले माह की वसूली नए लेजर में वापस न आए', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(([oldPay]) => {
      // "घरेलू" में पुराना (पिछले माह का) लेजर पड़ा है — सुखराम वहां वसूल है
      cSet('आदेगांव', 'घरेलू', [
        { acc: '4487654321', name: 'सुखराम', status: 'paid', paydate: oldPay, amount: 8400 },
      ]);
      openUpModal(); // कट-ऑफ़ अपने-आप चालू माह की 1 तारीख़ पर सेट होती है
      document.getElementById('up-hq').value = 'आदेगांव';
      document.getElementById('up-cat').value = 'कुल उपभोक्ता';
      setUpMode('replace');
      // नया लेजर — सुखराम का नया बिल ₹1,150, अभी बाकी
      parsedRows = [{ acc: '4487654321', name: 'सुखराम', amount: 1150, status: 'pending', remarksArr: [] }];
      confirmUpload();
      const pick = (cat) => (cGet('आदेगांव', cat).find((x) => x.acc === '4487654321') || {});
      return { master: pick('कुल उपभोक्ता'), old: pick('घरेलू') };
    }, [lastMonth()]);
    // नए लेजर में सुखराम "बाकी" ही रहे — लाइनमैन उस तक पहुंचे
    expect(r.master.status).toBe('pending');
    expect(r.master.amount).toBe(1150); // नई राशि, पुरानी ₹8,400 नहीं
    // और पुराने बटन से भी वह बासी वसूल हट जाए, वरना अगली बार फिर लौट आती
    expect(r.old.status).toBe('pending');
    expect(r.old.paydate).toBe('');
  });

  test('अपलोड के बाद reconcileHQ दोबारा चले (जैसे अगले login पर) तो भी पुरानी वसूली वापस न आए', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(([oldPay]) => {
      cSet('आदेगांव', 'घरेलू', [
        { acc: '4487654321', name: 'सुखराम', status: 'paid', paydate: oldPay, amount: 8400 },
      ]);
      openUpModal();
      document.getElementById('up-hq').value = 'आदेगांव';
      document.getElementById('up-cat').value = 'कुल उपभोक्ता';
      setUpMode('replace');
      parsedRows = [{ acc: '4487654321', name: 'सुखराम', amount: 1150, status: 'pending', remarksArr: [] }];
      confirmUpload();
      reconcileHQ('आदेगांव'); // login / HQ-tab बदलने पर यही चलता है (कट-ऑफ़ इसे पता नहीं होती)
      return { status: (cGet('आदेगांव', 'कुल उपभोक्ता').find((x) => x.acc === '4487654321') || {}).status };
    }, [lastMonth()]);
    expect(r.status).toBe('pending'); // कहीं बची ही नहीं, इसलिए लौट भी नहीं सकती
  });

  test('इसी माह (1-10 की खिड़की में) दर्ज वसूली बनी रहे — reconcileHQ उसे नए लेजर में ले ही जाए', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(([nowPay]) => {
      cSet('आदेगांव', 'घरेलू', [
        { acc: '4412345678', name: 'रामप्रसाद', status: 'paid', paydate: nowPay, amount: 11450 },
      ]);
      openUpModal();
      document.getElementById('up-hq').value = 'आदेगांव';
      document.getElementById('up-cat').value = 'कुल उपभोक्ता';
      setUpMode('replace');
      parsedRows = [{ acc: '4412345678', name: 'रामप्रसाद', amount: 12600, status: 'pending', remarksArr: [] }];
      confirmUpload();
      const pick = (cat) => (cGet('आदेगांव', cat).find((x) => x.acc === '4412345678') || {});
      return { master: pick('कुल उपभोक्ता'), old: pick('घरेलू') };
    }, [today()]);
    expect(r.master.status).toBe('paid'); // इस माह की वसूली है — बनी रहे
    expect(r.old.status).toBe('paid');    // पुराने बटन से भी न हटे
  });

  test('कट-ऑफ़ तारीख़ न हो (cut=0) तो sweepStalePaid कुछ न छुए — पुराना व्यवहार जस का तस', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(([oldPay]) => {
      cSet('आदेगांव', 'घरेलू', [
        { acc: '1', name: 'राम', status: 'paid', paydate: oldPay, amount: 100 },
      ]);
      const cleared = sweepStalePaid('आदेगांव', 0);
      return { cleared, status: cGet('आदेगांव', 'घरेलू')[0].status };
    }, [lastMonth()]);
    expect(r.cleared).toBe(0);
    expect(r.status).toBe('paid');
  });

  test('भुगतान तारीख़ ही दर्ज न हो तो वह वसूल भी पुरानी मानी जाए (अपलोड जैसा ही नियम)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      cSet('आदेगांव', 'घरेलू', [
        { acc: '1', name: 'राम', status: 'paid', paydate: '', amount: 100 },
      ]);
      const n = new Date();
      const cut = n.getFullYear() * 10000 + (n.getMonth() + 1) * 100 + 1; // चालू माह की 1 तारीख़
      const cleared = sweepStalePaid('आदेगांव', cut);
      return { cleared, status: cGet('आदेगांव', 'घरेलू')[0].status };
    });
    expect(r.cleared).toBe(1);
    expect(r.status).toBe('pending');
  });
});

// JE का अनुरोध (28/9): "कैश लिस्ट अपलोड करते समय मैं केवल IVRS नंबर अपलोड करता हूं — इसमें यह
// विकल्प भी दे देना कि IVRS नंबर के साथ पेमेंट डेट का column भी अपलोड किया जा सके"।
// पहले हर वसूली पर "आज" की तारीख़ चढ़ती थी, चाहे पैसा 2-3 दिन पहले जमा हुआ हो — इससे स्कोरकार्ड
// की तारीख़-वार तालिका झूठ बोलती, और महीने के आख़िर की वसूली अगले माह चढ़ाने पर वह नए लेजर की
// कट-ऑफ़ से "इस माह की" मानकर बच जाती (जिसने नया बिल नहीं भरा वो भी वसूल दिखता)।
test.describe('कैश लिस्ट — दूसरे column से भुगतान तारीख़ (वैकल्पिक)', () => {
  test('_cashCellToDate — CSV text, Excel Date object, Excel serial number तीनों रूप पहचाने', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => ({
      dmy: _cashCellToDate('20/9/2026'),
      iso: _cashCellToDate('2026-09-20'),
      dash: _cashCellToDate('20-09-2026'),
      dateObj: _cashCellToDate(new Date(2026, 8, 20)),
      serial: _cashCellToDate(46285), // Excel serial = 20 सितंबर 2026 (1899-12-30 से दिनों की गिनती)
      blank: _cashCellToDate(''),
      nul: _cashCellToDate(null),
      junk: _cashCellToDate('कुछ भी'), // पहचान न आए तो "" — कचरा paydate में न जाए
    }));
    expect(r.dmy).toBe('20/9/2026');
    expect(r.iso).toBe('20/9/2026');
    expect(r.dash).toBe('20/9/2026');
    expect(r.dateObj).toBe('20/9/2026');
    expect(r.serial).toBe('20/9/2026');
    expect(r.blank).toBe('');
    expect(r.nul).toBe('');
    expect(r.junk).toBe('');
  });

  test('cashCollect — जोड़ी [IVRS, तारीख़] से CASH_DATES बने, और सादी single-column लिस्ट पहले की तरह चले', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      openCashModal();
      cashCollect([['4412345678', '20/9/2026'], ['4487654321', ''], ['IVRS', 'तारीख़']]); // header पंक्ति छँट जाए
      const pair = { ivrs: CASH_IVRS.slice(), dates: Object.assign({}, CASH_DATES) };
      openCashModal();
      cashCollect(['1111111111', '2222222222']); // पुरानी single-column फाइल
      return { pair, plain: { ivrs: CASH_IVRS.slice(), dates: Object.assign({}, CASH_DATES) } };
    });
    expect(r.pair.ivrs).toEqual(['4412345678', '4487654321']);
    expect(r.pair.dates).toEqual({ '4412345678': '20/9/2026' }); // सिर्फ़ जिसकी तारीख़ मिली
    expect(r.plain.ivrs).toEqual(['1111111111', '2222222222']);
    expect(r.plain.dates).toEqual({}); // तारीख़ का column ही नहीं — पुराना व्यवहार
  });

  test('_applyCashMatched — जिसकी तारीख़ फाइल में हो उसकी वही चढ़े, बाक़ी पर आज की', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      activeHQ = 'आदेगांव';
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '4412345678', name: 'रामप्रसाद', status: 'pending', amount: 500 },
        { acc: '4487654321', name: 'सुखराम', status: 'pending', amount: 700 },
      ]);
      CASH_IVRS = ['4412345678', '4487654321'];
      CASH_DATES = { '4412345678': '20/9/2026' }; // सिर्फ़ रामप्रसाद की तारीख़ फाइल में थी
      _applyCashMatched(['आदेगांव']);
      const pick = (a) => cGet('आदेगांव', 'कुल उपभोक्ता').find((x) => x.acc === a);
      const n = new Date();
      return {
        ram: pick('4412345678'),
        sukh: pick('4487654321'),
        today: n.toLocaleDateString('hi-IN'),
      };
    });
    expect(r.ram.status).toBe('paid');
    expect(r.ram.paydate).toBe('20/9/2026');  // फाइल वाली तारीख़
    expect(r.sukh.status).toBe('paid');
    expect(r.sukh.paydate).toBe(r.today);     // तारीख़ नहीं दी थी — पुराना व्यवहार
  });

  test('CASH_DATES बिल्कुल न हो तो भी पुराना व्यवहार चले (आज की तारीख़)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      activeHQ = 'आदेगांव';
      cSet('आदेगांव', 'कुल उपभोक्ता', [{ acc: '1134022288', name: 'टेस्ट', status: 'pending', amount: 500 }]);
      CASH_IVRS = ['1134022288'];
      CASH_DATES = null; // जैसे पुराने रास्ते से आया हो
      _applyCashMatched(['आदेगांव']);
      return {
        rec: cGet('आदेगांव', 'कुल उपभोक्ता')[0],
        today: new Date().toLocaleDateString('hi-IN'),
      };
    });
    expect(r.rec.status).toBe('paid');
    expect(r.rec.paydate).toBe(r.today);
  });

  test('फाइल की तारीख़ भविष्य की हो तो आज पर समेट दी जाए (normPayDate वाला नियम)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      const f = new Date(); f.setFullYear(f.getFullYear() + 1);
      const future = f.getDate() + '/' + (f.getMonth() + 1) + '/' + f.getFullYear();
      const n = new Date();
      return { got: _cashCellToDate(future), today: n.getDate() + '/' + (n.getMonth() + 1) + '/' + n.getFullYear() };
    });
    expect(r.got).toBe(r.today);
  });
});

// JE का अनुरोध (28/9) — बिंदु 1: "पुरानी वसूली सुरक्षित रखें" का ✅ हटाने का मतलब है "कोई पुरानी
// वसूली मत रखो"। पर यह अधूरा चलता था: इस category की वसूली तो नहीं जाती थी, पर अपलोड के बाद
// reconcileHQ() दूसरे बटनों से वही वसूल वापस खींच लाता ("किसी एक में वसूल = सब में वसूल")।
// यानी ऐप वह करता ही नहीं था जो JE ने कहा — और चुपचाप। अब checkbox हटाने पर पूरे मुख्यालय से
// वसूली हटती है, पर पहले साफ़ चेतावनी देकर पूछा जाता है।
test.describe('checkbox हटाकर अपलोड — पूरे HQ से वसूली हटे, पर पहले पुष्टि पूछी जाए', () => {
  async function seed(page) {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '1', name: 'राम', status: 'paid', paydate: '20/9/2026', amount: 100 },
      ]);
      cSet('आदेगांव', 'घरेलू', [
        { acc: '1', name: 'राम', status: 'paid', paydate: '20/9/2026', amount: 100 },
        { acc: '2', name: 'श्याम', status: 'paid', paydate: '20/9/2026', amount: 200 },
      ]);
      openUpModal();
      document.getElementById('up-hq').value = 'आदेगांव';
      document.getElementById('up-cat').value = 'कुल उपभोक्ता';
      setUpMode('replace');
      document.getElementById('up-keeppaid').checked = false;
      parsedRows = [{ acc: '1', name: 'राम', amount: 100, status: 'pending', remarksArr: [] }];
    });
  }

  test('"नहीं" कहने पर अपलोड रुक जाए — एक भी record न बदले', async ({ page }) => {
    await seed(page);
    const r = await page.evaluate(() => {
      window.confirm = () => false; // JE ने चेतावनी पढ़कर मना कर दिया
      confirmUpload();
      return {
        kulLen: cGet('आदेगांव', 'कुल उपभोक्ता').length,
        kul: cGet('आदेगांव', 'कुल उपभोक्ता')[0].status,
        ghar: cGet('आदेगांव', 'घरेलू').map((x) => x.status),
      };
    });
    expect(r.kulLen).toBe(1);
    expect(r.kul).toBe('paid');          // नई लिस्ट सेव ही नहीं हुई
    expect(r.ghar).toEqual(['paid', 'paid']); // दूसरे बटन भी अछूते
  });

  test('"हां" कहने पर पूरे HQ से वसूली हटे — दूसरे बटनों से भी, और reconcileHQ वापस न ला सके', async ({ page }) => {
    await seed(page);
    const r = await page.evaluate(() => {
      window.confirm = () => true;
      confirmUpload();
      reconcileHQ('आदेगांव'); // अगले login जैसा — पुरानी वसूल कहीं बची हो तो यहीं लौट आती
      return {
        kul: cGet('आदेगांव', 'कुल उपभोक्ता')[0].status,
        ghar: cGet('आदेगांव', 'घरेलू').map((x) => x.status),
      };
    });
    expect(r.kul).toBe('pending');
    expect(r.ghar).toEqual(['pending', 'pending']); // दूसरा बटन भी साफ़ — पिछला दरवाज़ा बंद
  });

  test('चेतावनी में पूरे HQ की unique गिनती हो (एक ही acc कई बटनों में हो तो एक ही बार)', async ({ page }) => {
    await seed(page);
    const r = await page.evaluate(() => {
      let asked = '';
      window.confirm = (m) => { asked = m; return false; };
      confirmUpload();
      return { asked, count: _upCountPaid('आदेगांव') };
    });
    expect(r.count).toBe(2);            // acc 1 (दोनों बटनों में) + acc 2 = 2, तीन नहीं
    expect(r.asked).toContain('2 उपभोक्ताओं की वसूली मिट जाएगी');
    expect(r.asked).toContain('आदेगांव');
  });

  test('कोई वसूली हो ही न तो कुछ न पूछा जाए — बेवजह चेतावनी न आए', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [{ acc: '1', name: 'राम', status: 'pending', amount: 100 }]);
      openUpModal();
      document.getElementById('up-hq').value = 'आदेगांव';
      document.getElementById('up-cat').value = 'कुल उपभोक्ता';
      setUpMode('replace');
      document.getElementById('up-keeppaid').checked = false;
      parsedRows = [{ acc: '1', name: 'राम', amount: 100, status: 'pending', remarksArr: [] }];
      let asked = 0;
      window.confirm = () => { asked++; return true; };
      confirmUpload();
      return { asked, len: cGet('आदेगांव', 'कुल उपभोक्ता').length };
    });
    expect(r.asked).toBe(0);  // कुछ मिटना ही नहीं था
    expect(r.len).toBe(1);    // अपलोड फिर भी हुआ
  });

  test('checkbox लगा रहे तो कुछ न पूछा जाए (रोज़ का सामान्य रास्ता अछूता)', async ({ page }) => {
    await seed(page);
    const r = await page.evaluate(() => {
      document.getElementById('up-keeppaid').checked = true;
      let asked = 0;
      window.confirm = () => { asked++; return true; };
      confirmUpload();
      return { asked };
    });
    expect(r.asked).toBe(0);
  });
});

// JE का फ़ैसला (28/9): बिंदु 1 "बैकअप जोड़कर" लागू हो। checkbox हटाकर अपलोड करने पर पूरे मुख्यालय
// की वसूली एक साथ मिटती है और पहले ऐप के अंदर वापसी का कोई रास्ता नहीं था (सिर्फ़ GitHub वाला
// रोज़ का बैकअप, यानी घंटों का काम)। अब मिटने से ठीक पहले 7-दिनी backup रखा जाता है — वही जो
// "हटाएं" बटन के लिए पहले से बनता था (vt_paidbk_), इसलिए दोबारा अपलोड करते ही वसूली लौट आती है।
test.describe('मिटने से पहले वसूली का backup (sweepStalePaid → vt_paidbk_)', () => {
  test('sweepStalePaid — मिटाई गई वसूली localStorage में backup हो जाए', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      cSet('आदेगांव', 'घरेलू', [
        { acc: '1', name: 'राम', status: 'paid', paydate: '20/8/2026', amount: 100, updatedBy: 'रमेश' },
        { acc: '2', name: 'श्याम', status: 'pending', amount: 200 },
      ]);
      sweepStalePaid('आदेगांव', 99999999); // सब कुछ मिटाओ
      const raw = localStorage.getItem('vt_paidbk_' + cKey('आदेगांव', 'घरेलू'));
      return { raw: raw ? JSON.parse(raw) : null, status: cGet('आदेगांव', 'घरेलू')[0].status };
    });
    expect(r.status).toBe('pending');
    expect(Object.keys(r.raw.m)).toEqual(['1']);      // सिर्फ़ मिटने वाला record, "बाकी" वाला नहीं
    expect(r.raw.m['1'].paydate).toBe('20/8/2026');
    expect(r.raw.m['1'].by).toBe('रमेश');
    expect(r.raw.t).toBeGreaterThan(0);               // 7 दिन की उम्र इसी से नापी जाती है
  });

  test('कुछ न मिटे तो backup भी न लिखा जाए (पुराना backup बचा रहे)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      const key = 'vt_paidbk_' + cKey('आदेगांव', 'घरेलू');
      localStorage.setItem(key, JSON.stringify({ t: Date.now(), m: { '9': { paydate: '1/9/2026' } } }));
      cSet('आदेगांव', 'घरेलू', [{ acc: '1', name: 'राम', status: 'pending', amount: 100 }]);
      sweepStalePaid('आदेगांव', 99999999);
      return Object.keys(JSON.parse(localStorage.getItem(key)).m);
    });
    expect(r).toEqual(['9']); // पहले वाला backup ज्यों का त्यों
  });

  test('पूरा चक्र — checkbox हटाकर मिटाओ, फिर दोबारा अपलोड करने पर वसूली लौट आए', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      const n = new Date();
      const todayDmy = n.getDate() + '/' + (n.getMonth() + 1) + '/' + n.getFullYear();
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '1', name: 'राम', status: 'paid', paydate: todayDmy, amount: 100, updatedBy: 'रमेश' },
      ]);
      cSet('आदेगांव', 'घरेलू', [{ acc: '1', name: 'राम', status: 'paid', paydate: todayDmy, amount: 100 }]);

      // (1) ग़लती — checkbox हटाकर अपलोड, चेतावनी पर "हां"
      openUpModal();
      document.getElementById('up-hq').value = 'आदेगांव';
      document.getElementById('up-cat').value = 'कुल उपभोक्ता';
      setUpMode('replace');
      document.getElementById('up-keeppaid').checked = false;
      window.confirm = () => true;
      parsedRows = [{ acc: '1', name: 'राम', amount: 100, status: 'pending', remarksArr: [] }];
      confirmUpload();
      const afterWipe = cGet('आदेगांव', 'कुल उपभोक्ता')[0].status;

      // (2) सुधार — वही लेजर दोबारा, इस बार checkbox लगाकर
      openUpModal();
      document.getElementById('up-hq').value = 'आदेगांव';
      document.getElementById('up-cat').value = 'कुल उपभोक्ता';
      setUpMode('replace');
      document.getElementById('up-keeppaid').checked = true;
      parsedRows = [{ acc: '1', name: 'राम', amount: 100, status: 'pending', remarksArr: [] }];
      confirmUpload();
      const rec = cGet('आदेगांव', 'कुल उपभोक्ता')[0];
      return {
        afterWipe,
        restored: rec.status,
        paydate: rec.paydate,
        ghar: cGet('आदेगांव', 'घरेलू')[0].status, // reconcileHQ इसे भी वापस फैलाए
      };
    });
    expect(r.afterWipe).toBe('pending'); // मिट गई थी
    expect(r.restored).toBe('paid');     // backup से लौट आई
    expect(r.ghar).toBe('paid');         // और बाक़ी बटनों में भी फैल गई
  });

  test('backup बनाते समय localStorage भर जाए तो अपलोड न रुके (सिर्फ़ लॉग हो)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      const orig = localStorage.setItem.bind(localStorage);
      localStorage.setItem = (k) => { if (String(k).indexOf('vt_paidbk_') === 0) throw new Error('QuotaExceededError'); return orig.apply(null, arguments); };
      cSet('आदेगांव', 'घरेलू', [{ acc: '1', name: 'राम', status: 'paid', paydate: '20/8/2026', amount: 100 }]);
      let threw = false;
      try { sweepStalePaid('आदेगांव', 99999999); } catch (e) { threw = true; }
      localStorage.setItem = orig;
      return { threw, status: cGet('आदेगांव', 'घरेलू')[0].status };
    });
    expect(r.threw).toBe(false);      // सफ़ाई फिर भी चली
    expect(r.status).toBe('pending'); // और अपना काम कर गई
  });

  // v9.219 — असली production (13/10, JE फ़ोन): एक अपलोड पर 15 "paid-backup-fail"; पुराने backup कभी मिटते नहीं थे
  test('जगह भरे तो 7 दिन पुराने backup मिटाकर दोबारा save; ताज़ा backup बचे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      const old = Date.now() - 8 * 24 * 3600 * 1000;
      localStorage.setItem('vt_paidbk_पुराना_x', JSON.stringify({ t: old, m: { a: 1 } }));
      localStorage.setItem('vt_rmkbk_पुराना_y', JSON.stringify({ t: old, m: { a: [] } }));
      localStorage.setItem('vt_paidbk_ताज़ा_z', JSON.stringify({ t: Date.now(), m: { a: 1 } }));
      // जगह भरी है — जब तक पुराना backup मौजूद है, नई लिखाई नाकाम
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (localStorage.getItem('vt_paidbk_पुराना_x') !== null) throw new Error('QuotaExceededError');
        return orig.call(this, k, v);
      };
      let saved;
      try { saved = savePaidBackup('आदेगांव', 'घरेलू', { 1: paidBkEntry({ paydate: '1/10/2026' }) }); } finally { Storage.prototype.setItem = orig; }
      return {
        saved,
        oldGone: localStorage.getItem('vt_paidbk_पुराना_x') === null && localStorage.getItem('vt_rmkbk_पुराना_y') === null,
        freshKept: localStorage.getItem('vt_paidbk_ताज़ा_z') !== null,
        newBk: localStorage.getItem('vt_paidbk_' + cKey('आदेगांव', 'घरेलू')) !== null,
        failLogs: getLogs().filter((l) => l.c === 'paid-backup-fail' || l.c === 'storage-full').length,
      };
    });
    expect(r).toEqual({ saved: 1, oldGone: true, freshKept: true, newBk: true, failLogs: 0 });
  });

  test('जगह पूरी भरी — कई श्रेणियों पर भी "storage-full" एक ही log, जगह के हिसाब के साथ', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (/^(vt_paidbk_|dc_cache3_)/.test(String(k))) throw new Error('QuotaExceededError');
        return orig.call(this, k, v);
      };
      try {
        ['घरेलू', 'व्यवसाय', 'कुल उपभोक्ता'].forEach((c) => {
          savePaidBackup('पाटन', c, { 9: paidBkEntry({}) });
          lsSet('dc_cache3_पाटन_' + c, '[]', 'cache'); // IndexedDB न खुले तो cache का यही रास्ता (v9.220)
        });
      } finally { Storage.prototype.setItem = orig; }
      const logs = getLogs().filter((l) => l.c === 'storage-full' || l.c === 'paid-backup-fail');
      return { kinds: logs.map((l) => l.x.split(' • ')[0]).sort(), note: logs[0] && logs[0].x };
    });
    expect(r.kinds).toEqual(['cache', 'paid-backup']); // हर तरह का एक — 6 नहीं
    expect(r.note).toMatch(/कुल \d+K • cache \d+K/);
  });

  test('offline queue save न हो तो लाइनमैन को स्क्रीन पर बताएं (चुपचाप नहीं)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      const orig = Storage.prototype.setItem;
      const shown = [];
      const t = window.toast;
      window.toast = (m) => shown.push(m);
      Storage.prototype.setItem = function (k, v) {
        if (k === PENDING_KEY) throw new Error('QuotaExceededError');
        return orig.call(this, k, v);
      };
      try { markPending('आदेगांव', 'घरेलू', 'put'); markPending('आदेगांव', 'व्यवसाय', 'put'); } finally { Storage.prototype.setItem = orig; window.toast = t; }
      return { warn: shown.filter((m) => /जगह भर गई/.test(m)).length, log: getLogs().filter((l) => l.c === 'storage-full').length };
    });
    expect(r).toEqual({ warn: 1, log: 1 });
  });
});

// ── v9.200: Merge में "पुरानी वसूली सुरक्षित रखें" भ्रम न बने + सीमा की सही संख्या ──
// JE (11/10) ने Merge चुनकर "1820 पुरानी (पिछले लेजर की) हट जाएगी" देखा और पूछा कि रिमार्क रहेंगे या नहीं —
// जबकि भरी सूची पर Merge में वह तारीख़-कट-ऑफ़ लागू ही नहीं होता (सिर्फ़ नए Consumer No जुड़ते हैं)।
// और लेबल "बाकी जगह (1000 limit)" लिखा था, जबकि कुल उपभोक्ता की सीमा 3500 है
test.describe('अपलोड — Merge का साफ़ संदेश और सही सीमा (v9.200)', () => {
  const open = async (page, recs) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate((r) => {
      cSet('आदेगांव', 'कुल उपभोक्ता', r);
      openUpModal();
      document.getElementById('up-hq').value = 'आदेगांव';
      onUpHqChange();
      document.getElementById('up-cat').value = 'कुल उपभोक्ता';
      setUpMode('merge');
    }, recs);
  };
  const state = (page) => page.evaluate(() => ({
    keep: getComputedStyle(document.getElementById('up-keep-sec')).display,
    note: getComputedStyle(document.getElementById('up-merge-note')).display,
    noteText: document.getElementById('up-merge-note').textContent,
    label: document.getElementById('cnt-avail-label').textContent,
    avail: document.getElementById('cnt-avail').textContent,
  }));

  test('भरी सूची + Merge: कट-ऑफ़ वाला हिस्सा छिपे, साफ़ संदेश दिखे; Replace पर वापस', async ({ page }) => {
    await open(page, [1, 2, 3].map((a) => ({ acc: String(a), name: 'उ' + a, amount: 100, status: 'pending' })));
    let s = await state(page);
    expect(s.keep).toBe('none');
    expect(s.note).toBe('block');
    expect(s.noteText).toContain('Merge सिर्फ़ नए उपभोक्ता जोड़ता है');
    expect(s.noteText).toContain('3 उपभोक्ताओं');
    expect(s.noteText).toContain('Replace');
    await page.evaluate(() => setUpMode('replace'));
    s = await state(page);
    expect(s.keep).not.toBe('none');
    expect(s.note).toBe('none');
  });

  test('ख़ाली सूची + Merge (असल में Replace-रास्ता) — कट-ऑफ़ वाला हिस्सा दिखता रहे', async ({ page }) => {
    await open(page, []);
    const s = await state(page);
    expect(s.keep).not.toBe('none');
    expect(s.note).toBe('none');
  });

  test('सीमा का लेबल श्रेणी की असली सीमा दिखाए — कुल उपभोक्ता 3500, बाक़ी 1000', async ({ page }) => {
    await open(page, [{ acc: '1', name: 'क', amount: 1, status: 'pending' }]);
    let s = await state(page);
    expect(s.label).toBe('बाकी जगह (3500 limit)');
    expect(s.avail).toBe('3499');
    await page.evaluate(() => { document.getElementById('up-cat').value = CATS[1]; updateUpCounter(); });
    s = await state(page);
    expect(s.label).toBe('बाकी जगह (1000 limit)');
  });
});

// ── v9.201: Replace डिफ़ॉल्ट (JE का फ़ैसला) + ग़लती से छोटी फ़ाइल पर पूरी सूची न कटे ──
test.describe('अपलोड — Replace डिफ़ॉल्ट और कटने से पहले पुष्टि (v9.201)', () => {
  const seed = async (page, nOld) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate((n) => {
      const r = [];
      for (let i = 0; i < n; i++) r.push({ acc: String(1000 + i), name: 'उ' + i, amount: 100, status: 'pending', remarksArr: [] });
      cSet('आदेगांव', 'कुल उपभोक्ता', r);
      openUpModal();
      document.getElementById('up-hq').value = 'आदेगांव';
      onUpHqChange();
      document.getElementById('up-cat').value = 'कुल उपभोक्ता';
      updateUpCounter();
    }, nOld);
  };
  const rows = (accs) => accs.map((a) => ({ acc: String(a), name: 'नया ' + a, amount: 200, status: 'pending', remarksArr: [] }));

  test('खिड़की खुलते ही Replace चुना हो — पिछली बार Merge चुना था तब भी', async ({ page }) => {
    await seed(page, 3);
    expect(await page.evaluate(() => [upMode, document.getElementById('mode-rep').className.includes('sel-pending')])).toEqual(['replace', true]);
    await page.evaluate(() => { setUpMode('merge'); closeUpModal(); openUpModal(); });
    expect(await page.evaluate(() => upMode)).toBe('replace');
  });

  test('100 की सूची पर 5 वाली फ़ाइल Replace — पुष्टि मांगे; "रद्द" पर सूची जस की तस', async ({ page }) => {
    await seed(page, 100);
    const msgs = [];
    page.on('dialog', (d) => { msgs.push(d.message()); d.dismiss(); });
    await page.evaluate((r) => { parsedRows = r; confirmUpload(); }, rows([1000, 1001, 1002, 1003, 1004]));
    expect(msgs.length).toBe(1);
    expect(msgs[0]).toContain('Replace से 95 उपभोक्ता सूची से हट जाएंगे');
    expect(msgs[0]).toContain('Merge');
    expect(await page.evaluate(() => cGet('आदेगांव', 'कुल उपभोक्ता').length)).toBe(100);
    await expect(page.locator('#toast')).toContainText('अपलोड रोक दिया');
  });

  test('"OK" दबाने पर Replace हो जाए (JE ने सोच-समझकर चुना)', async ({ page }) => {
    await seed(page, 100);
    page.on('dialog', (d) => d.accept());
    await page.evaluate((r) => { parsedRows = r; confirmUpload(); }, rows([1000, 1001, 1002, 1003, 1004]));
    await page.waitForFunction(() => cGet('आदेगांव', 'कुल उपभोक्ता').length === 5);
  });

  test('ऐप के अपने डिब्बे में (v9.236): "रुको" पर कुछ नहीं, "हां" पर Replace — ब्राउज़र का डिब्बा नहीं खुले', async ({ page }) => {
    await seed(page, 100);
    let native = 0;
    page.on('dialog', (d) => { native++; d.dismiss(); });
    await page.evaluate(() => { delete window.__askAuto; });
    await page.evaluate((r) => { parsedRows = r; confirmUpload(); }, rows([1000, 1001, 1002, 1003, 1004]));
    await expect(page.locator('#ask-ov .ask-title')).toContainText('Replace से 95 उपभोक्ता');
    await page.click('#ask-ov .ask-cancel');
    await expect(page.locator('#ask-ov')).toHaveCount(0);
    expect(await page.evaluate(() => cGet('आदेगांव', 'कुल उपभोक्ता').length)).toBe(100);
    await expect(page.locator('#toast')).toContainText('अपलोड रोक दिया');
    await page.evaluate((r) => { parsedRows = r; confirmUpload(); }, rows([1000, 1001, 1002, 1003, 1004]));
    await page.click('#ask-ov .ask-danger');
    await page.waitForFunction(() => cGet('आदेगांव', 'कुल उपभोक्ता').length === 5);
    expect(native).toBe(0);
  });

  test('असली मासिक लेजर (कुछ ही हटे, कुछ नए जुड़े) — कोई पुष्टि-संदेश नहीं', async ({ page }) => {
    await seed(page, 100);
    const msgs = [];
    page.on('dialog', (d) => { msgs.push(d.message()); d.dismiss(); });
    const accs = [];
    for (let i = 10; i < 100; i++) accs.push(1000 + i); // 10 कटे
    for (let i = 0; i < 15; i++) accs.push(5000 + i);   // 15 नए
    await page.evaluate((r) => { parsedRows = r; confirmUpload(); }, rows(accs));
    await page.waitForFunction(() => cGet('आदेगांव', 'कुल उपभोक्ता').length === 105);
    expect(msgs).toEqual([]);
  });
});

// ── v9.223: अपलोड की कट-ऑफ़ सर्वर पर जाए (बाक़ी फ़ोन भी जानें — config.js: LEDGER_CUT) ──
test.describe('अपलोड — कट-ऑफ़ सर्वर पर (v9.223)', () => {
  test('Replace + "पुरानी वसूली सुरक्षित रखें" → चुनी तारीख़; checkbox हटा → आज की तारीख़', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      const up = (hq, keep) => {
        openUpModal();
        document.getElementById('up-hq').value = hq;
        document.getElementById('up-cat').value = 'कुल उपभोक्ता';
        setUpMode('replace');
        document.getElementById('up-keeppaid').checked = keep;
        document.getElementById('up-keepfrom').value = '2026-10-01';
        parsedRows = [{ acc: '1', name: 'क', amount: 10, status: 'pending', remarksArr: [] }];
        window.confirm = () => true;
        confirmUpload();
      };
      up('आदेगांव', true);
      up('पाटन', false);
      return { a: LEDGER_CUT['आदेगांव'], p: LEDGER_CUT['पाटन'] === _todayVal(), saved: JSON.parse(localStorage.getItem('dc_ledgercut1'))['आदेगांव'] };
    });
    expect(r).toEqual({ a: 20261001, p: true, saved: 20261001 });
  });
});

// ── v9.224: नया लेजर Replace होने पर वही Consumer No बाक़ी सूचियों में भी नई राशि ले (JE, 14/10) ──
test.describe('अपलोड — बाक़ी सूचियों में राशि नई (v9.224)', () => {
  const run = (page, withAmt) => page.evaluate((amtGiven) => {
    const today = new Date().toLocaleDateString('hi-IN');
    cSet('आदेगांव', 'घरेलू', [
      { acc: '1', name: 'राम', amount: '500', status: 'paid', paydate: today, remarksArr: [{ text: 'कल देगा', by: 'x', at: 'y' }], lastPayDate: '1/8/2026' },
      { acc: '2', name: 'श्याम', amount: '300', status: 'pending' },
      { acc: '3', name: 'मोहन', amount: '700', status: 'pending' },
    ]);
    cSet('आदेगांव', 'व्यवसाय', [{ acc: '1', name: 'राम', amount: '480', status: 'pending' }]);
    openUpModal();
    document.getElementById('up-hq').value = 'आदेगांव';
    document.getElementById('up-cat').value = 'कुल उपभोक्ता';
    setUpMode('replace');
    parsedRows = [
      { acc: '1', name: 'राम', amount: '1200', status: 'pending', remarksArr: [], lastPayDate: '2/10/2026' },
      { acc: '2', name: 'श्याम', amount: '0', status: 'paid', paydate: today, remarksArr: [] },
      { acc: '3', name: 'मोहन', amount: '0', status: 'pending', remarksArr: [] }, // राशि फ़ाइल में थी ही नहीं
    ];
    parsedAmtGiven = amtGiven ? { 1: true, 2: true } : {};
    window.confirm = () => true;
    confirmUpload();
    const pick = (cat, a) => cGet('आदेगांव', cat).find((x) => x.acc === a);
    const g1 = pick('घरेलू', '1'), g2 = pick('घरेलू', '2'), g3 = pick('घरेलू', '3');
    return {
      g1: [g1.amount, g1.status, g1.lastPayDate, g1.name, (g1.remarksArr || []).length],
      g2: [g2.amount, g2.status], g3: [g3.amount, g3.status], v1: pick('व्यवसाय', '1').amount,
    };
  }, withAmt);

  test('Replace के बाद: राशि (और पिछला भुगतान) नई; नाम/रिमार्क/वसूली अछूते; राशि 0 हुई तो अपने-आप वसूल; फ़ाइल में राशि न थी तो नहीं छूता', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await run(page, true);
    expect(r).toEqual({
      g1: ['1200', 'paid', '2/10/2026', 'राम', 1],
      g2: ['0', 'paid'],
      g3: ['700', 'pending'], // "कुल उपभोक्ता" में राशि वैकल्पिक — भरा "0" नहीं फैलता
      v1: '1200',
    });
  });

  test('फ़ाइल में राशि का कॉलम ही न हो — बाक़ी सूचियों की राशि जस की तस', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await run(page, false);
    expect(r.g1[0]).toBe('500');
    expect(r.g2[0]).toBe('300'); // राशि नहीं बदली (वसूल होना reconcileHQ का पुराना नियम है — फ़ाइल में वह वसूल था)
    expect(r.v1).toBe('480');
  });
});

// ── v9.227: अपलोड से पहले फ़ोन से हटाई गई सूचियां सर्वर से — JE (14/10): दोबारा Replace पर पुराने रिमार्क चले गए ──
test.describe('अपलोड — पहले सूचियां सर्वर से, फिर अपलोड (v9.227)', () => {
  const prep = (page) => page.evaluate(() => {
    openUpModal();
    document.getElementById('up-hq').value = 'आदेगांव';
    document.getElementById('up-cat').value = 'कुल उपभोक्ता';
    setUpMode('replace');
    parsedRows = [{ acc: '1', name: 'राम', amount: '900', status: 'pending', remarksArr: [] }];
    parsedAmtGiven = { 1: true };
    window.confirm = () => true;
    _listNeedMark(['आदेगांव_कुल उपभोक्ता', 'आदेगांव_घरेलू']); // जैसे v9.222 की सफ़ाई में हटीं
  });

  test('सूचियां लानी बाक़ी हों: पहले सर्वर से (उनके रिमार्क नई सूची में आएं), फिर अपलोड', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await prep(page);
    const r = await page.evaluate(() => {
      const orig = _cashRefreshAll;
      let asked = null;
      window._cashRefreshAll = (hqs, cb, force) => {
        asked = hqs.join(',') + (force ? ':force' : '');
        // सर्वर पर पुरानी सूचियां रिमार्क के साथ
        cSet('आदेगांव', 'कुल उपभोक्ता', [{ acc: '1', name: 'राम', amount: '500', status: 'pending', remarksArr: [{ text: 'कल देगा', by: 'लाइनमैन', at: '10/10/2026' }] }]);
        cSet('आदेगांव', 'घरेलू', [{ acc: '1', name: 'राम', amount: '500', status: 'pending', remarksArr: [{ text: 'घर बंद', by: 'लाइनमैन', at: '11/10/2026' }] }]);
        cb(0);
      };
      try { confirmUpload(); } finally { window._cashRefreshAll = orig; }
      const x = cGet('आदेगांव', 'कुल उपभोक्ता')[0];
      return { asked, amount: x.amount, rmk: (x.remarksArr || []).map((m) => m.text).sort(), left: listsNeedFetch('आदेगांव') };
    });
    expect(r).toEqual({ asked: 'आदेगांव:force', amount: '900', rmk: ['कल देगा', 'घर बंद'], left: [] });
  });

  test('बिना नेट — अपलोड रुके, सूची जस की तस', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await prep(page);
    const r = await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
      try { confirmUpload(); } finally { delete navigator.onLine; }
      return cGet('आदेगांव', 'कुल उपभोक्ता').length;
    });
    expect(r).toBe(0);
  });

  test('सर्वर से न आ पाएं — अपलोड रुके और लॉग में दर्ज', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await prep(page);
    const r = await page.evaluate(() => {
      const orig = _cashRefreshAll;
      window._cashRefreshAll = (hqs, cb) => cb(2); // timeout/नेट टूटा — कुछ नहीं आया
      try { confirmUpload(); } finally { window._cashRefreshAll = orig; }
      return { n: cGet('आदेगांव', 'कुल उपभोक्ता').length, log: getLogs().filter((l) => l.c === 'upload-lists-missing').length };
    });
    expect(r).toEqual({ n: 0, log: 1 });
  });
});

// v9.234 (JE 16/10): कमज़ोर नेट पर सर्वर-रिमार्क की पढ़ाई नाकाम/timeout हो तो पहले record बिना मिलान पूरा भेज दिया
// जाता था — सर्वर का रिमार्क दब जाता। अब उसके रिमार्क छोड़कर बाक़ी fields जाते हैं, पूरा record "बाक़ी" में रुकता है
test.describe('कमज़ोर नेट पर रिमार्क न दबे (v9.234)', () => {
  const run = (page, o) => page.evaluate((o) => new Promise((resolve) => {
    Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
    var hq = 'टेस्ट HQ32', cat = 'कुल उपभोक्ता';
    MIGRATED[hqKey(hq)] = {}; MIGRATED[hqKey(hq)][catKey(cat)] = true;
    var serverRmk = [{ text: 'सर्वर वाला', by: 'राजू', at: '15/10/2026, 6:00 pm' }];
    var readOk = !o.readFail, gets = 0, patches = [];
    var orig = window.fetch;
    window.fetch = function (url, init) {
      var u = String(url);
      if (u.indexOf(fbPath(hq, cat)) > -1) {
        if (init && init.method === 'PATCH') { patches.push(JSON.parse(init.body)); return Promise.resolve(new Response('{}', { status: 200 })); }
        if (u.indexOf('/remarksArr.json') > -1) {
          gets++;
          return readOk ? Promise.resolve(new Response(JSON.stringify(serverRmk), { status: 200 })) : Promise.reject(new TypeError('Failed to fetch'));
        }
      }
      return orig(url, init);
    };
    var n = o.count || 1, prev = [], arr = [];
    for (var i = 0; i < n; i++) {
      prev.push({ acc: String(200 + i), name: 'उ', status: 'pending', o: i, remarksArr: [] });
      arr.push({ acc: String(200 + i), name: 'उ', status: 'paid', paydate: '16/10/2026', o: i, remarksArr: [] });
    }
    cSet(hq, cat, arr);
    var done = function () {
      window.fetch = orig;
      var p = getPending()[cKey(hq, cat)];
      resolve({ gets: gets, patches: patches, pendKeys: p && p.patch ? Object.keys(p.patch) : [] });
    };
    if (o.viaFlush) {
      // offline में दिन भर का काम जमा — फिर नेट पर भेजा
      var patch = {}; arr.forEach(function (x) { patch[x.acc] = x; });
      markPending(hq, cat, 'put', patch);
      flushPending();
      setTimeout(done, 500);
      return;
    }
    fbSet(hq, cat, arr, prev, function () {
      if (!o.thenFlush) { done(); return; }
      readOk = true; // नेट सुधरा
      flushPending();
      setTimeout(done, 400);
    });
  }), o);

  test('रिमार्क-पढ़ाई नाकाम — वसूली (status) तुरंत जाए पर remarksArr नहीं; पूरा record "बाक़ी" में', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await run(page, { readFail: true });
    expect(r.patches.length).toBe(1);
    const p = r.patches[0];
    expect(p['200/status']).toBe('paid');
    expect(p['200/acc']).toBe('200');
    expect(p['200']).toBeUndefined(); // पूरा record (जो सर्वर का रिमार्क दबाता) नहीं गया
    expect(Object.keys(p).some((k) => /remarks/.test(k))).toBe(false);
    expect(r.pendKeys).toEqual(['200']);
  });

  test('नेट सुधरने पर रुका record मिलान होकर जाए — सर्वर वाला रिमार्क बचे, फिर "बाक़ी" ख़ाली', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await run(page, { readFail: true, thenFlush: true });
    expect(r.patches.length).toBe(2);
    expect(r.patches[1]['200'].remarksArr.map((x) => x.text)).toEqual(['सर्वर वाला']);
    expect(r.pendKeys).toEqual([]);
  });

  test('offline में जमा 15 records — भेजते वक़्त हर एक के सर्वर-रिमार्क मिलें (पहले >10 पर मिलान ही नहीं होता था)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await run(page, { count: 15, viaFlush: true });
    expect(r.gets).toBe(15);
    expect(r.patches.length).toBe(1);
    expect(Object.keys(r.patches[0]).length).toBe(15);
    expect(r.patches[0]['214'].remarksArr.map((x) => x.text)).toEqual(['सर्वर वाला']);
    expect(r.pendKeys).toEqual([]);
  });
});

test('एक उपभोक्ता का सेव सफल हो तो उसी सूची में पहले से रुका दूसरा उपभोक्ता "बाक़ी" से न छूटे (v9.234)', async ({ page }) => {
  await openApp(page);
  await loginJE(page);
  const r = await page.evaluate(() => new Promise((resolve) => {
    Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
    var hq = 'टेस्ट HQ33', cat = 'कुल उपभोक्ता';
    MIGRATED[hqKey(hq)] = {}; MIGRATED[hqKey(hq)][catKey(cat)] = true;
    var orig = window.fetch;
    window.fetch = function (url, init) {
      var u = String(url);
      if (u.indexOf(fbPath(hq, cat)) > -1) {
        if (init && init.method === 'PATCH') return Promise.resolve(new Response('{}', { status: 200 }));
        if (u.indexOf('/remarksArr.json') > -1) return Promise.resolve(new Response('null', { status: 200 }));
      }
      return orig(url, init);
    };
    // A पहले से रुका (जैसे offline में "वसूल" किया)
    markPending(hq, cat, 'put', { 1: { acc: '1', status: 'paid', o: 0 } });
    var prev = [{ acc: '1', status: 'paid', o: 0 }, { acc: '2', status: 'pending', o: 1 }];
    var arr = [{ acc: '1', status: 'paid', o: 0 }, { acc: '2', status: 'paid', o: 1 }];
    cSet(hq, cat, arr);
    fbSet(hq, cat, arr, prev, function () {
      window.fetch = orig;
      var p = getPending()[cKey(hq, cat)];
      resolve(p && p.patch ? Object.keys(p.patch) : []);
    });
  }));
  expect(r).toEqual(['1']); // पहले पूरी entry मिट जाती थी — A का "वसूल" सर्वर तक कभी न जाता
});

// v9.234 (JE 16/10): 1134007169 का रिमार्क "कुल उपभोक्ता" में था, "5 Year Nonpay" में नहीं दिखा — हर सूची की अलग copy।
// अब कार्ड/रिमार्क-खिड़की/वादा उसी HQ की सब सूचियों से उसी Consumer No के रिमार्क मिलाकर (सिर्फ़ फ़ोन की copy से)
test.describe('रिमार्क सब सूचियों से मिलाकर दिखें (v9.234)', () => {
  test('दूसरी सूची का रिमार्क इस सूची के कार्ड पर, बिना दोहराव; बैकअप-वापसी वाला दोहराव भी नहीं; कोई Firebase लिखाई नहीं', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await page.evaluate(() => {
      var hq = activeHQ, cats = [];
      for (var i = 0; i < CATS_DEFAULT.length; i++) cats.push(isCatEditable(i) ? getCatName(hq, i) : CATS_DEFAULT[i]);
      var a = { text: 'घर बंद मिला', by: 'राजू', at: '14/10/2026, 5:00 pm', cat: cats[0] };
      var restoredDup = { text: 'घर बंद मिला', by: 'राजू', at: 'बैकअप 2026-10-12', restored: 'backup-2026-10-12' };
      var b = { text: 'कल देंगे', by: 'श्याम', at: '15/10/2026, 9:00 am', due: '2099-01-01' };
      var writes = 0, orig = window.fetch;
      window.fetch = function (u, init) { if (init && init.method && init.method !== 'GET') writes++; return orig(u, init); };
      cSet(hq, cats[0], [{ acc: '1134007169', name: 'M', amount: 5120, status: 'pending', remarksArr: [a] }]);
      cSet(hq, cats[1], [{ acc: '1134007169', name: 'M', amount: 5120, status: 'pending', remarksArr: [restoredDup] },
        { acc: '9', name: 'X', amount: 1, status: 'pending', remarksArr: [] }]);
      cSet(hq, cats[2], [{ acc: ' 1134007169 ', name: 'M', status: 'pending', remarksArr: [b, a] }]);
      var x = cGet(hq, cats[1])[0];
      var all = remarksAll(x, hq).map(function (z) { return z.text + '@' + (z.cat || ''); });
      activeCat = cats[1];
      renderListWith(cGet(hq, cats[1]));
      var cardTxt = document.querySelector('.con-card .cc-rmk-list').textContent;
      window.fetch = orig;
      return { all: all, cardHas: cardTxt.indexOf('कल देंगे') > -1 && cardTxt.indexOf('घर बंद मिला') > -1,
        due: promiseDue(x), other: remarksAll(cGet(hq, cats[1])[1], hq).length, own: x.remarksArr.length, writes: writes, cat2: cats[2] };
    });
    // सिर्फ़ एक "घर बंद मिला" (असली, बैकअप वाला दोहराव नहीं), पुराना → नया
    expect(r.all.map((s) => s.split('@')[0])).toEqual(['घर बंद मिला', 'कल देंगे']);
    expect(r.all[1]).toBe('कल देंगे@' + r.cat2); // किस सूची से आया — रिमार्क खिड़की में 📁 टैग
    expect(r.cardHas).toBe(true);
    expect(r.due).toBe('2099-01-01'); // दूसरी सूची में लिखा वादा भी गिना
    expect(r.other).toBe(0);
    expect(r.own).toBe(1); // फ़ोन/सर्वर की copy नहीं बदली — सिर्फ़ दिखाने में मिलान
    expect(r.writes).toBe(0);
  });
});

// v9.239 (18/10, पाटन/कुल उपभोक्ता, राजकुमार): "पूरी सूची" वाली बाक़ी entry 28 घंटे अटकी, लॉग में कोई नाकामी नहीं।
// (क) भेजते वक़्त सर्वर-बात अटके तो समय-सीमा पर "timeout" — _flushing छूटे, अगली बार फिर कोशिश;
// (ख) per-record सूची पर पूरी सूची PUT नहीं — मिलाई हुई copy में से सिर्फ़ सर्वर से अलग उपभोक्ता PATCH
test.describe('पूरी-सूची वाली बाक़ी entry (v9.239)', () => {
  const run = (page, opts) => page.evaluate((opts) => new Promise((resolve) => {
    Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
    const hq = 'टेस्ट HQ39', cat = 'कुल उपभोक्ता';
    if (opts.migrated) { MIGRATED[hqKey(hq)] = {}; MIGRATED[hqKey(hq)][catKey(cat)] = true; }
    if (opts.hang) { FLUSH_LIST_FETCH_MS = 300; }
    const server = { 1: { acc: '1', name: 'क', status: 'pending', o: 0, remarksArr: [{ text: 'सर्वर वाला', at: 5 }] }, 2: { acc: '2', name: 'ख', status: 'pending', o: 1 } };
    const calls = [];
    const orig = window.fetch;
    window.fetch = function (url, init) {
      const u = String(url);
      if (u.indexOf(fbPath(hq, cat)) > -1) {
        const m = (init && init.method) || 'GET';
        calls.push({ m, body: init && init.body ? JSON.parse(init.body) : null });
        if (m === 'GET') return opts.hang ? new Promise(() => {}) : Promise.resolve(new Response(JSON.stringify(server), { status: 200 }));
        return Promise.resolve(new Response('{}', { status: 200 }));
      }
      return orig(url, init);
    };
    // फ़ोन में: 1 वसूल (key-क्रम अलग), 2 वैसा ही — entry बिना patch ("पूरी सूची")
    cSet(hq, cat, [{ status: 'paid', o: 0, name: 'क', acc: '1', paydate: '18/10/2026' }, { o: 1, status: 'pending', name: 'ख', acc: '2' }]);
    localStorage.setItem('dc_pending3', JSON.stringify({ [cKey(hq, cat)]: { hq, cat, type: 'put', since: Date.now() } }));
    _flushing = false;
    flushPending();
    const t0 = Date.now();
    (function wait() {
      if (_flushing && Date.now() - t0 < 5000) return setTimeout(wait, 50);
      window.fetch = orig;
      resolve({
        calls: calls.map((c) => c.m), patch: calls.filter((c) => c.m === 'PATCH').map((c) => c.body)[0] || null,
        flushing: _flushing, pending: !!getPending()[cKey(hq, cat)],
        log: getLogs().filter((l) => l.c === 'sync-put-fail').map((l) => l.m),
      });
    })();
  }), opts);

  test('per-record सूची: पूरी सूची PUT नहीं — सिर्फ़ बदला उपभोक्ता PATCH, सर्वर का रिमार्क साथ, entry ख़त्म', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await run(page, { migrated: true });
    expect(r.calls).toEqual(['GET', 'PATCH']);
    expect(Object.keys(r.patch)).toEqual(['1']); // "ख" वैसा ही था (सिर्फ़ key-क्रम अलग) — नहीं भेजा
    expect(r.patch['1'].status).toBe('paid');
    expect(r.patch['1'].remarksArr.map((x) => x.text)).toEqual(['सर्वर वाला']);
    expect(r.pending).toBe(false);
  });

  test('सर्वर से सूची उतरना अटक जाए तो समय-सीमा पर छूटे — लॉग में "timeout", entry बाक़ी में सुरक्षित, अगली बार फिर कोशिश', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await run(page, { migrated: true, hang: true });
    expect(r.calls).toEqual(['GET']);
    expect(r.flushing).toBe(false); // पहले हमेशा true रहता — उस बार ऐप खुले रहने तक भेजना बंद
    expect(r.pending).toBe(true);
    expect(r.log).toContain('timeout');
  });
});

// v9.240 (19/10, मढ़ी, राजकुमार — v9.239 पर हर कुछ मिनट "timeout"): (क) समय-सीमा भेजे जा रहे आकार के हिसाब से (3 मिनट तक);
// (ख) timeout के बाद हर 20 सेकंड वही भारी कोशिश नहीं — 2 मिनट, फिर 5 मिनट रुकें; नेट लौटे या सफल हो तो तुरंत
test.describe('timeout के बाद रुककर भेजना (v9.240)', () => {
  test('समय-सीमा आकार के हिसाब से — छोटा 60s, बड़ा ज़्यादा, 3 मिनट से ऊपर नहीं', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => [_flushMs('x'), _flushMs('x'.repeat(400 * 1024)), _flushMs('x'.repeat(5 * 1024 * 1024))]);
    expect(r).toEqual([60000, 160000, 180000]);
  });

  test('timeout के बाद 2 मिनट, फिर 5 मिनट कोई कोशिश नहीं; "online" पर तुरंत; सफल होते ही इंतज़ार ख़त्म', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
      const hq = 'टेस्ट HQ40', cat = 'कुल उपभोक्ता';
      MIGRATED[hqKey(hq)] = {}; MIGRATED[hqKey(hq)][catKey(cat)] = true;
      FLUSH_FETCH_MS = 200; REMARK_MERGE_TIMEOUT_MS = 100;
      let mode = 'hang', patches = 0;
      const orig = window.fetch;
      window.fetch = function (url, init) {
        const u = String(url);
        if (u.indexOf(fbPath(hq, cat)) > -1) {
          if (u.indexOf('/remarksArr.json') > -1) return Promise.resolve(new Response('null', { status: 200 }));
          if (init && init.method === 'PATCH') { patches++; return mode === 'hang' ? new Promise(() => {}) : Promise.resolve(new Response('{}', { status: 200 })); }
        }
        return orig(url, init);
      };
      localStorage.setItem('dc_pending3', JSON.stringify({ [cKey(hq, cat)]: { hq, cat, type: 'put', since: Date.now(), patch: { 7: { acc: '7', status: 'paid', o: 0 } } } }));
      _flushing = false; _flushTimeouts = 0; _flushBackoffUntil = 0;
      const out = {};
      const until = (f, cb) => { const t0 = Date.now(); (function w() { if (!f() && Date.now() - t0 < 5000) return setTimeout(w, 30); cb(); })(); };
      flushPending();
      until(() => !_flushing, () => {
        out.wait1 = Math.round((_flushBackoffUntil - Date.now()) / 60000);
        const before = patches; flushPending(); out.blocked = patches === before && !_flushing;
        window.dispatchEvent(new Event('online')); // नेट लौटा — तुरंत
        until(() => !_flushing && patches > before, () => {
          out.wait2 = Math.round((_flushBackoffUntil - Date.now()) / 60000);
          mode = 'ok'; _flushBackoffUntil = 0; flushPending();
          until(() => !_flushing && !getPending()[cKey(hq, cat)], () => {
            window.fetch = orig;
            out.after = { until: _flushBackoffUntil, n: _flushTimeouts, pending: !!getPending()[cKey(hq, cat)] };
            resolve(out);
          });
        });
      });
    }));
    expect(r).toEqual({ wait1: 2, blocked: true, wait2: 5, after: { until: 0, n: 0, pending: false } });
  });
});

// v9.241 (19/10, JE के फ़ोन पर 10:56): कई सूचियां एक साथ भेजीं तो 6 HQ की 8 सूचियों में 61 उपभोक्ताओं के रिमार्क "timeout" पर रुके —
// हर सूची 10-10 पढ़ाई एक साथ, ब्राउज़र कतार में रखता और 5 सेकंड की घड़ी कतार में ही बीत जाती। अब पूरे ऐप में एक साथ 6, घड़ी
// पढ़ाई शुरू होने पर; "बाक़ी" पीछे से भेजते वक़्त 15 सेकंड
test.describe('रिमार्क-पढ़ाई की कतार (v9.241)', () => {
  test('3 सूचियां × 10 उपभोक्ता एक साथ — एक बार में 6 से ज़्यादा पढ़ाई नहीं, और कतार में इंतज़ार timeout न बने', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
      REMARK_MERGE_TIMEOUT_MS = 500;
      // "सर्वर/ब्राउज़र" एक साथ 6 ही संभाले, हर पढ़ाई 300ms — बाक़ी कतार में (असली फ़ोन जैसा)
      let active = 0, maxActive = 0, reads = 0; const q = [];
      const serve = () => { while (active < 6 && q.length) { const done = q.shift(); active++; setTimeout(() => { active--; done(); serve(); }, 300); } };
      let inFlight = 0, maxInFlight = 0;
      const orig = window.fetch;
      window.fetch = function (url, init) {
        if (String(url).indexOf('/remarksArr.json') > -1) {
          reads++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
          return new Promise((res) => { q.push(() => { inFlight--; res(new Response('null', { status: 200 })); }); serve(); });
        }
        return orig(url, init);
      };
      const mk = () => { const p = {}; for (let i = 0; i < 10; i++) p[String(100 + i)] = { acc: String(100 + i), status: 'paid', remarksArr: [{ text: 'x', at: 1 }] }; return p; };
      return Promise.all(['A', 'B', 'C'].map((c) => _mergeServerRemarks('टेस्ट HQ41', 'सूची ' + c, mk())))
        .then((res) => { window.fetch = orig; return { reads, maxInFlight, holds: res.filter((x) => x.hold).length }; });
    });
    expect(r).toEqual({ reads: 30, maxInFlight: 6, holds: 0 });
  });

  test('"बाक़ी" पीछे से भेजते वक़्त रिमार्क-पढ़ाई की सीमा 15 सेकंड (सामने वाली सेव 5 सेकंड)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => ({ live: REMARK_MERGE_TIMEOUT_MS, flush: REMARK_FLUSH_TIMEOUT_MS, par: REMARK_READ_PARALLEL,
      wired: /REMARK_FLUSH_MAX,REMARK_FLUSH_TIMEOUT_MS/.test(flushPending.toString()) }));
    expect(r).toEqual({ live: 5000, flush: 15000, par: 6, wired: true });
  });
});

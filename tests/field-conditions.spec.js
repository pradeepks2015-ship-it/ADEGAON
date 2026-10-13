// @ts-check
// वसूली ट्रैकर — टेस्ट: असली मैदान जैसी हालत (13/10/2026, JE: "टेस्ट-सुरक्षा में और क्या कर सकते हैं — सभी कर दो")
// बाक़ी टेस्ट 2–10 उपभोक्ताओं की सूची पर, तेज़ कंप्यूटर पर, एक ही टैब में चलते हैं। इसलिए v9.219/220 वाली
// "फ़ोन की जगह भर गई" गड़बड़ी (एक "कुल उपभोक्ता" ही ~1M अक्षर) किसी टेस्ट में बनी ही नहीं। यहां:
//   1. असली आकार का डेटा — 6 HQ × 8 श्रेणी, "कुल उपभोक्ता" 3500, असली जैसे field
//   2. सस्ता फ़ोन + कमज़ोर नेट — CPU 4 गुना धीमा, धीमा नेटवर्क; ऐप खुलना और वसूली दर्ज करना नापा जाता है
//   3. ऐप दो जगह एक साथ खुला (Chrome टैब + इंस्टॉल ऐप) — 13/10 को Vikas के फ़ोन पर यही दिखा
//   4. पुराने version वाला फ़ोन (v9.218 जैसी हालत: localStorage में सूचियां, अटकी वसूली, backup, लॉग)
//      पर नया version खुले — कुछ न खोए
const { test, expect, openApp, loginLineman, loginJE } = require('./helpers');

const HQS6 = ['आदेगांव', 'पिंडरई', 'जोबा', 'पाटन', 'बीबी', 'मढ़ी'];
// "कुल उपभोक्ता" 3500, बाक़ी श्रेणियां उसका हिस्सा (लाइनमैन-वार/टैरिफ़-वार सूचियां असल में ऐसी ही होती हैं)
const CAT_SIZES = [3500, 1200, 400, 600, 150, 80, 900, 700];

// असली लेजर जैसे record — 13/10 के लॉग से नाप: आदेगांव "कुल उपभोक्ता" 3500 records ≈ 1050K अक्षर (~300/record)
function seedRealData(hqs, sizes) {
  const VIL = ['आदेगांव', 'पिपरिया', 'खैरी', 'सिहोरा', 'बरघाट', 'कुडारी', 'मुंगवानी', 'धनककड़ी'];
  const FN = ['रामलाल', 'श्यामसुंदर', 'मोहनलाल', 'राजकुमार', 'सुखराम', 'भगवानदास', 'हरिप्रसाद', 'गोपाल'];
  const LN = ['पटेल', 'यादव', 'साहू', 'ठाकुर', 'विश्वकर्मा', 'मरावी', 'उइके', 'नामदेव'];
  let total = 0;
  hqs.forEach((hq, h) => {
    CATS_DEFAULT.forEach((cat, c) => {
      const n = sizes[c];
      const arr = [];
      for (let i = 0; i < n; i++) {
        const k = (h * 7 + i * 13) % 64;
        arr.push({
          acc: String(4400000000 + h * 100000 + i), name: FN[k % 8] + ' ' + LN[(k >> 3) % 8],
          father: FN[(k + 3) % 8] + ' ' + LN[(k >> 3) % 8], addr: 'ग्राम ' + VIL[k % 8] + ' वार्ड ' + (i % 15 + 1) + ' तहसील लखनादौन',
          mobile: String(9800000000 + i), amount: 500 + (i * 37) % 15000, tariff: i % 5 ? 'LV1.2' : 'LV5.1',
          load: '1.0 KW', unit: String(80 + i % 300), lastPayDate: (i % 28 + 1) + '/' + (i % 9 + 1) + '/2026',
          lastPaidAmt: String(300 + i % 900), status: 'pending', paydate: '', remarksArr: i % 9 ? [] : [{ t: 'अगले हफ़्ते देंगे', by: 'लाइनमैन', at: '10/10/2026' }],
          updatedBy: '', updatedAt: '', ts: 0,
        });
      }
      cSet(hq, cat, arr);
      total += JSON.stringify(arr).length;
    });
  });
  return total;
}
const seedSrc = seedRealData.toString();
/** @param {import('@playwright/test').Page} page */
async function seed(page, hqs, sizes) {
  return page.evaluate(([src, h, s]) => (0, eval)('(' + src + ')')(h, s), [seedSrc, hqs, sizes]);
}
/** @param {import('@playwright/test').Page} page */
async function waitIdbIdle(page) {
  // IndexedDB की चालू लिखाइयां पूरी हों — एक ख़ाली readwrite transaction बाक़ी सबके बाद ही पूरी होता है
  await page.evaluate(() => new Promise((res) => {
    if (!_cacheDb) return res(null);
    const tx = _cacheDb.transaction(CACHE_DB_STORE, 'readwrite');
    tx.oncomplete = tx.onerror = () => res(null);
  }));
}
/** @param {import('@playwright/test').Page} page */
async function reopenToApp(page) {
  await page.reload();
  await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'), null, { timeout: 30000 });
}
const badLogs = (page) => page.evaluate(() => getLogs().filter((l) => /storage-full|cache-idb|quota/i.test(l.c + ' ' + l.m)).map((l) => l.c + ': ' + l.m));

test.describe('असली आकार का डेटा — 6 HQ × 8 श्रेणी (JE फ़ोन जैसा)', () => {
  test('पूरा चक्र: भरना → वसूली → बिना नेट दोबारा खोलना → लेजर अपलोड → रिपोर्ट — कुछ न खोए, जगह न भरे', async ({ page }) => {
    test.setTimeout(180000);
    await openApp(page);
    const chars = await seed(page, HQS6, CAT_SIZES);
    expect(chars).toBeGreaterThan(9000000); // localStorage (~5.24M) में यह कभी नहीं समाता — असली JE फ़ोन जितना/ज़्यादा
    await loginLineman(page); // आदेगांव
    await expect(page.locator('.con-card').first()).toBeVisible({ timeout: 20000 });

    // वसूली दर्ज — फिर बिना नेट ऐप बंद-खुलना
    const acc = await page.evaluate(() => { const d = cGet(activeHQ, activeCat); markPaid(0, d[0].acc); return d[0].acc; });
    await page.waitForFunction(() => Object.keys(getPending()).length > 0); // सर्वर तक न पहुंची → कतार में
    await waitIdbIdle(page);
    // "बिना नेट": Firebase/बाहरी हर request पहले से बंद है (helpers.js: blockExternal) — ऐप की अपनी फ़ाइलें
    // असल फ़ोन पर service worker देता है, जो टेस्ट में बंद है, इसलिए यहां पन्ना localhost से ही आता है
    await reopenToApp(page);
    const after = await page.evaluate((a) => ({
      paid: (cGet('आदेगांव', 'कुल उपभोक्ता').find((x) => x.acc === a) || {}).status,
      counts: CATS_DEFAULT.map((c) => cGet('मढ़ी', c).length),
      pending: Object.keys(getPending()).length,
    }), acc);
    expect(after.paid).toBe('paid');
    expect(after.counts).toEqual([3500, 1200, 400, 600, 150, 80, 900, 700]); // दूसरे HQ की सूचियां भी पूरी
    expect(after.pending).toBeGreaterThan(0); // वसूली सर्वर पर जाने को कतार में सुरक्षित

    // JE: पूरे "कुल उपभोक्ता" का नया लेजर (Replace) — दर्ज वसूली बनी रहे
    await page.evaluate(() => { doLogout(false); });
    await loginJE(page);
    const up = await page.evaluate((a) => {
      const rows = cGet('आदेगांव', 'कुल उपभोक्ता').map((x) => ({ acc: x.acc, name: x.name, amount: x.amount + 100, status: 'pending', remarksArr: [] }));
      openUpModal();
      document.getElementById('up-hq').value = 'आदेगांव';
      document.getElementById('up-cat').value = 'कुल उपभोक्ता';
      setUpMode('replace');
      parsedRows = rows;
      window.confirm = () => true;
      confirmUpload();
      const list = cGet('आदेगांव', 'कुल उपभोक्ता');
      return { n: list.length, paid: (list.find((x) => x.acc === a) || {}).status };
    }, acc);
    expect(up).toEqual({ n: 3500, paid: 'paid' });

    // भारी रिपोर्टें (सभी HQ का हिसाब) बिना गिरे बनें
    const rep = await page.evaluate(() => {
      const errs = [];
      ['openTodayScorecard', 'openVoiceScorecard'].forEach((f) => { try { if (typeof window[f] === 'function') window[f](); } catch (e) { errs.push(f + ': ' + e.message); } });
      return errs;
    });
    expect(rep).toEqual([]);
    await waitIdbIdle(page);
    expect(await badLogs(page)).toEqual([]);
  });
});

test.describe('सस्ता फ़ोन (CPU 4× धीमा) + नेट नहीं', () => {
  test('असली आकार के डेटा के साथ: ऐप दोबारा खुलकर सूची दिखाए और वसूली दर्ज हो — तय समय में', async ({ page, context }) => {
    test.setTimeout(240000);
    await openApp(page);
    await seed(page, ['आदेगांव', 'पिंडरई'], CAT_SIZES); // लाइनमैन फ़ोन जैसा: अपना HQ + एक पुराना
    await loginLineman(page);
    await expect(page.locator('.con-card').first()).toBeVisible({ timeout: 20000 });
    await waitIdbIdle(page);

    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    // नेट: ऐप की अपनी फ़ाइलें असल फ़ोन पर service worker (फ़ोन की copy) से आती हैं (v9.211), और Firebase
    // यहां बंद है — यानी सबसे बुरा नेट: "कुछ नहीं आता"। ऐप को फिर भी फ़ोन की copy से खुलना है

    const t0 = Date.now();
    await reopenToApp(page);
    await expect(page.locator('.con-card').first()).toBeVisible({ timeout: 60000 });
    const openMs = Date.now() - t0;

    const tapMs = await page.evaluate(() => { const d = cGet(activeHQ, activeCat); const s = performance.now(); markPaid(0, d[0].acc); return performance.now() - s; });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    console.log('धीमा फ़ोन: ऐप खुलकर सूची दिखी ' + openMs + ' ms में, वसूली दर्ज ' + Math.round(tapMs) + ' ms में');
    // सीमा: बिना cache (सर्वर से सूची) वाले पुराने अनुभव से बेहतर हो। CI मशीनें धीमी-तेज़ होती हैं, इसलिए
    // ढीली सीमा — मक़सद किसी बदलाव से ऐप का कई गुना धीमा होना पकड़ना है, मिलीसेकंड गिनना नहीं
    expect(openMs).toBeLessThan(15000);
    expect(tapMs).toBeLessThan(2000);
    expect(await page.evaluate(() => cGet(activeHQ, activeCat)[0].status)).toBe('paid');
  });
});

test.describe('ऐप दो जगह एक साथ खुला (Chrome टैब + इंस्टॉल ऐप)', () => {
  test('बिना नेट दोनों में अलग-अलग वसूली — दोनों बचें, कोई दूसरे की न मिटाए', async ({ page, context }) => {
    test.setTimeout(120000);
    await openApp(page);
    await page.evaluate(() => cSet('आदेगांव', 'कुल उपभोक्ता', [
      { acc: '101', name: 'राम', status: 'pending', amount: 100 },
      { acc: '102', name: 'श्याम', status: 'pending', amount: 200 },
      { acc: '103', name: 'मोहन', status: 'pending', amount: 300 },
    ]));
    await loginLineman(page);
    await expect(page.locator('.con-card').first()).toBeVisible({ timeout: 15000 });
    await waitIdbIdle(page);

    const page2 = await context.newPage();
    await page2.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
    await page2.goto('/');
    await page2.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'), null, { timeout: 20000 });

    // Firebase यहां वैसे भी बंद है (बिना नेट जैसा) — दोनों वसूलियां फ़ोन में ही दर्ज होंगी
    await page.evaluate(() => markPaid(0, '101'));
    await waitIdbIdle(page);
    await page2.waitForTimeout(500);
    await page2.evaluate(() => markPaid(1, '102'));
    await waitIdbIdle(page2);
    await page.waitForTimeout(500);

    // दोनों टैब अब एक जैसी सूची देखें
    const see = (p) => p.evaluate(() => cGet('आदेगांव', 'कुल उपभोक्ता').map((x) => x.status).join(','));
    expect(await see(page)).toBe('paid,paid,pending');
    expect(await see(page2)).toBe('paid,paid,pending');
    // और ऐप बंद-खुलने पर भी (फ़ोन की copy में दोनों)
    await page2.close();
    await reopenToApp(page);
    expect(await see(page)).toBe('paid,paid,pending');
  });
});

test.describe('पुराने version वाला फ़ोन नए version पर (v9.218 जैसी हालत)', () => {
  test('सूचियां, अटकी वसूली, लॉगिन, बिना-भेजे लॉग — सब बचे; बेकार पुराना backup हटे, ताज़ा बचे', async ({ page }) => {
    test.setTimeout(120000);
    const old = Date.now() - 9 * 24 * 3600 * 1000;
    const snapshot = {
      'dc_cu': JSON.stringify({ cu: { role: 'lineman', name: 'पुराना लाइनमैन', hq: 'आदेगांव', pin: '123456' }, at: Date.now() - 3600000 }),
      'dc_cache3_आदेगांव_कुल उपभोक्ता': JSON.stringify([
        { acc: '501', name: 'पुराना वसूल', status: 'paid', paydate: '12/10/2026', amount: 900, remarks: 'पुराना एक-पंक्ति रिमार्क' },
        { acc: '502', name: 'अभी बाकी', status: 'pending', amount: 700 },
      ]),
      'dc_cache3_आदेगांव_घरेलू': JSON.stringify([{ acc: '502', name: 'अभी बाकी', status: 'pending', amount: 700 }]),
      'dc_pending3': JSON.stringify({ 'आदेगांव_कुल उपभोक्ता': { hq: 'आदेगांव', cat: 'कुल उपभोक्ता', type: 'put', since: Date.now() - 7200000 } }),
      'vt_paidbk_आदेगांव_घरेलू': JSON.stringify({ t: old, m: { 1: {} } }),
      'vt_paidbk_आदेगांव_व्यवसाय': JSON.stringify({ t: Date.now() - 86400000, m: { 2: {} } }),
      'dc_logs3': JSON.stringify([{ t: new Date().toISOString(), v: '9.218', u: 'x', d: 'd', c: 'पुराना-लॉग', m: 'बिना नेट', x: '', i: 'old1', s: 1 }]),
      'dc_listsort': 'ledger',
    };
    await page.addInitScript((snap) => {
      if (sessionStorage.getItem('old-seeded')) return;
      sessionStorage.setItem('old-seeded', '1');
      Object.keys(snap).forEach((k) => localStorage.setItem(k, snap[k]));
    }, snapshot);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
    await page.goto('/');
    // बिना दोबारा login सीधे अंदर (session बचा)
    await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'), null, { timeout: 20000 });
    await expect(page.locator('.con-card').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(6000); // खुलने के 5 सेकंड बाद पुराने backup की सफ़ाई
    const r = await page.evaluate(() => ({
      user: CU && CU.name + '/' + CU.hq,
      list: cGet('आदेगांव', 'कुल उपभोक्ता').map((x) => x.acc + ':' + x.status).join(','),
      rmk: (cGet('आदेगांव', 'कुल उपभोक्ता')[0].remarksArr || []).length,
      ghar: cGet('आदेगांव', 'घरेलू').length,
      lsLists: Object.keys(localStorage).filter((k) => k.indexOf('dc_cache3_') === 0).length,
      pending: Object.keys(getPending()),
      log: getLogs().some((l) => l.i === 'old1'),
      oldBk: localStorage.getItem('vt_paidbk_आदेगांव_घरेलू') === null,
      freshBk: localStorage.getItem('vt_paidbk_आदेगांव_व्यवसाय') !== null,
    }));
    expect(r).toEqual({
      user: 'पुराना लाइनमैन/आदेगांव', list: '501:paid,502:pending', rmk: 1, ghar: 1,
      lsLists: 0, // सूचियां नए डेटाबेस में चली गईं
      pending: ['आदेगांव_कुल उपभोक्ता'], log: true, oldBk: true, freshBk: true,
    });
    // एक बार और खुले — अब सब नए डेटाबेस से
    await reopenToApp(page);
    expect(await page.evaluate(() => cGet('आदेगांव', 'कुल उपभोक्ता').length)).toBe(2);
  });
});

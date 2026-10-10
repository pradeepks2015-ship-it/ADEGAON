// @ts-check
// वसूली ट्रैकर — टेस्ट: list-filter (साझा helpers: tests/helpers.js)
const { test, expect, openApp, loginLineman, loginJE } = require('./helpers');

test.describe('"बाकी/वसूल" filter चुनकर HQ बदलने पर सही रीसेट हो (bug: वसूल entry बाकी में दिखना)', () => {
  test('"बाकी" filter चुनकर दूसरे HQ पर जाने पर filter बटन भी वापस "सभी" दिखे, अंदर से भी activeFilter="all" हो', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.click('[data-f="pending"]');
    await expect(page.locator('[data-f="pending"]')).toHaveClass(/active-pending/);
    await page.evaluate(() => {
      var tabs = document.querySelectorAll('#hq-tabs .hq-tab');
      tabs[1].click(); // कोई दूसरा HQ
    });
    await page.waitForFunction(() => typeof activeFilter !== 'undefined' && activeFilter === 'all');
    expect(await page.evaluate(() => document.querySelector('[data-f="all"]').className)).toContain('active-all');
    expect(await page.evaluate(() => document.querySelector('[data-f="pending"]').className)).toBe('filter-btn');
  });
});

test.describe('कैश लिस्ट — एक ही उपभोक्ता कई categories में हो तो सभी में status मिले', () => {
  test('_applyCashMatched के बाद reconcileHQ से बाकी categories में भी paid status मिल जाए', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => {
      activeHQ = 'आदेगांव';
      cSet('आदेगांव', 'कुल उपभोक्ता', [{ acc: '1134022288', name: 'टेस्ट उपभोक्ता', status: 'pending', amount: 500 }]);
      cSet('आदेगांव', 'घरेलू', [{ acc: '1134022288', name: 'टेस्ट उपभोक्ता', status: 'pending', amount: 500 }]);
      CASH_IVRS = ['1134022288'];
    });
    await page.evaluate(() => _applyCashMatched(['आदेगांव']));
    const statuses = await page.evaluate(() => ({
      kul: cGet('आदेगांव', 'कुल उपभोक्ता')[0].status,
      ghar: cGet('आदेगांव', 'घरेलू')[0].status,
    }));
    expect(statuses.kul).toBe('paid');
    expect(statuses.ghar).toBe('paid');
  });
});

test.describe('परफ़ॉर्मेंस — बड़ी लिस्ट (कुल उपभोक्ता का असली max 3500 records)', () => {
  test('renderListWith — पूरे 3500 records "और दिखाएं" से पूरे रेंडर करने में उचित समय लगे', async ({ page }) => {
    test.setTimeout(60000);
    await openApp(page);
    await loginLineman(page);
    await page.evaluate((hq) => {
      var arr = [];
      for (var i = 0; i < 3500; i++) {
        arr.push({
          acc: '9' + String(i).padStart(9, '0'), name: 'उपभोक्ता ' + i, addr: 'गांव ' + (i % 40),
          status: i % 3 === 0 ? 'paid' : 'pending', amount: 500 + (i % 50) * 10, phone: '9' + String(1000000000 + i),
          tariff: 'LV1', father: 'पिता ' + i,
        });
      }
      cSet(CU.hq, 'कुल उपभोक्ता', arr);
      activeCat = 'कुल उपभोक्ता';
    }, null);
    const t = await page.evaluate(() => {
      _renderLimit = 3500;
      var start = performance.now();
      renderListWith(cGet(CU.hq, 'कुल उपभोक्ता'));
      return performance.now() - start;
    });
    expect(await page.evaluate(() => document.querySelectorAll('.con-card').length)).toBe(3500);
    expect(t).toBeLessThan(2000); // CI पर असल में ~200ms लगता है — 10x मार्जिन, फिर भी भविष्य में कोई O(n²)-जैसी गड़बड़ी आने पर पकड़ लेगा
  });

  test('renderListWith — 3500 records में search/filter उचित समय में हो', async ({ page }) => {
    test.setTimeout(60000);
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => {
      var arr = [];
      for (var i = 0; i < 3500; i++) {
        arr.push({ acc: '9' + String(i).padStart(9, '0'), name: 'उपभोक्ता ' + i, addr: 'गांव ' + (i % 40), status: i % 3 === 0 ? 'paid' : 'pending', amount: 500 });
      }
      cSet(CU.hq, 'कुल उपभोक्ता', arr);
      activeCat = 'कुल उपभोक्ता';
      document.getElementById('search-inp').value = 'उपभोक्ता 34';
    });
    const t = await page.evaluate(() => {
      var start = performance.now();
      renderList();
      return performance.now() - start;
    });
    expect(t).toBeLessThan(1000);
  });

  test('_vgComputeRows — एक HQ के सभी categories मिलाकर गांव-वार जोड़ने में उचित समय लगे', async ({ page }) => {
    test.setTimeout(60000);
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => {
      var cats = ['कुल उपभोक्ता', 'घरेलू', 'व्यवसाय', 'कृषि'];
      cats.forEach(function (cat) {
        var arr = [];
        for (var i = 0; i < 1000; i++) {
          arr.push({ acc: cat + '_' + i, name: 'उपभोक्ता ' + i, addr: 'गांव ' + (i % 50), status: i % 2 === 0 ? 'paid' : 'pending', amount: 500 });
        }
        cSet('आदेगांव', cat, arr);
      });
    });
    const t = await page.evaluate(() => {
      var start = performance.now();
      _vgComputeRows('आदेगांव');
      return performance.now() - start;
    });
    expect(t).toBeLessThan(2000);
  });
});

// JE की रिपोर्ट (मढ़ी, screenshot): "बाकी" बटन हाइलाइट था, पर सूची में बीच-बीच में वसूल कार्ड भी।
// जड़: कई रास्ते activeFilter="all" कर देते हैं (जैसे _finishLogin — "बाकी" चुने रहते हुए
// logout+दोबारा login, जो _ensureCorrectHqAuth खुद भी करा देता है), पर filter बटनों की class पुरानी
// रह जाती थी — सूची असल में "सभी" होती। अब हर render पर दोनों मिलाए जाते हैं
test.describe('फ़िल्टर बटन और असली सूची कभी अलग न हों', () => {
  const seed3 = (page) => page.evaluate(() => {
    cSet(HQS[0], 'कुल उपभोक्ता', [
      { acc: '1', name: 'क', amount: 100, status: 'paid', paydate: '1/1/2026' },
      { acc: '2', name: 'ख', amount: 200, status: 'pending' },
      { acc: '3', name: 'ग', amount: 300, status: 'paid', paydate: '1/1/2026' },
    ]);
  });
  const state = (page) => page.evaluate(() => ({
    filter: activeFilter,
    hi: [].slice.call(document.querySelectorAll('.filter-btn')).filter((b) => b.className !== 'filter-btn').map((b) => b.dataset.f),
    cards: document.querySelectorAll('.con-card').length,
    paidShown: document.querySelectorAll('.con-card.paid').length,
  }));

  test('logout के बाद दोबारा login — "बाकी" बटन हाइलाइट रहकर वसूल कार्ड न दिखें', async ({ page }) => {
    await openApp(page);
    await seed3(page);
    await loginLineman(page);
    await page.waitForFunction(() => document.querySelectorAll('.con-card').length > 0, null, { timeout: 15000 });
    await page.click("[data-f='pending']");
    await page.waitForTimeout(300);
    const before = await state(page);
    expect(before).toMatchObject({ filter: 'pending', hi: ['pending'], cards: 1, paidShown: 0 });
    await page.evaluate(() => doLogout(false)); // जैसा _ensureCorrectHqAuth खुद कराता है
    await page.waitForFunction(() => document.getElementById('login-screen').classList.contains('active'), null, { timeout: 15000 });
    await loginLineman(page);
    await page.waitForFunction(() => document.querySelectorAll('.con-card').length > 0, null, { timeout: 15000 });
    await page.waitForTimeout(300);
    const after = await state(page);
    expect(after.filter).toBe('all');
    expect(after.hi).toEqual(['all']);          // बटन भी "सभी" पर — पहले "बाकी" पर अटका रह जाता था
    expect(after.paidShown).toBe(after.cards - 1); // "सभी" यानी वसूल भी दिखें, और बटन भी यही कहे
  });

  test('_syncFilterBtns — activeFilter जिस भी रास्ते से बदले, अगला render बटन मिला दे', async ({ page }) => {
    await openApp(page);
    await seed3(page);
    await loginLineman(page);
    await page.waitForFunction(() => document.querySelectorAll('.con-card').length > 0, null, { timeout: 15000 });
    const r = await page.evaluate(() => {
      var out = [];
      ['pending', 'paid', 'all'].forEach(function (f) {
        activeFilter = f;                       // बटन छुए बिना (जैसे कोई और रास्ता बदलता है)
        renderListWith(cGet(activeHQ, activeCat));
        out.push({ f: f, hi: [].slice.call(document.querySelectorAll('.filter-btn')).filter((b) => b.className !== 'filter-btn').map((b) => b.dataset.f), cards: document.querySelectorAll('.con-card').length });
      });
      return out;
    });
    expect(r).toEqual([
      { f: 'pending', hi: ['pending'], cards: 1 },
      { f: 'paid', hi: ['paid'], cards: 2 },
      { f: 'all', hi: ['all'], cards: 3 },
    ]);
  });
});

// JE का नियम: "वसूल + बाकी = कुल उपभोक्ता = सभी"। status खाली/अजीब वाले पुराने record भी "बाकी"
// में गिने जाते हैं (renderSummaryWith), इसलिए सूची भी उन्हें "बाकी" में दिखाए — वरना दोनों सूचियां
// जोड़ने पर कुल से कम बैठती थीं
test.describe('वसूल + बाकी = कुल (सूची और गिनती दोनों में)', () => {
  test('status खाली/अजीब वाले record भी "बाकी" सूची में आएं, और तीनों गिनती मिलें', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      cSet(HQS[0], 'कुल उपभोक्ता', [
        { acc: '1', name: 'क', amount: 100, status: 'paid', paydate: '1/1/2026' },
        { acc: '2', name: 'ख', amount: 200, status: 'pending' },
        { acc: '3', name: 'ग', amount: 300 },                 // status है ही नहीं (पुराना record)
        { acc: '4', name: 'घ', amount: 400, status: '' },      // खाली
        { acc: '5', name: 'ङ', amount: 500, status: 'PAID' },  // अजीब — paid नहीं माना जाएगा
      ]);
    });
    await loginLineman(page);
    await page.waitForFunction(() => document.querySelectorAll('.con-card').length > 0, null, { timeout: 15000 });
    const r = await page.evaluate(() => {
      var d = cGet(activeHQ, activeCat), out = {};
      ['all', 'paid', 'pending'].forEach(function (f) {
        activeFilter = f;
        renderListWith(d);
        out[f] = document.querySelectorAll('.con-card').length;
      });
      renderSummaryWith(d);
      var nums = [].slice.call(document.querySelectorAll('#summary .snum')).map((e) => e.textContent);
      return { list: out, sumTot: +nums[0], sumPaid: +nums[1], sumPend: +nums[2] };
    });
    expect(r.list.paid + r.list.pending).toBe(r.list.all);   // सूचियां: वसूल + बाकी = सभी
    expect(r.sumPaid + r.sumPend).toBe(r.sumTot);            // गिनती: वसूल + बाकी = कुल
    expect(r.list.paid).toBe(r.sumPaid);                     // सूची और गिनती आपस में भी मिलें
    expect(r.list.pending).toBe(r.sumPend);
    expect(r.list.all).toBe(5);
    expect(r.list.paid).toBe(1);
  });
});

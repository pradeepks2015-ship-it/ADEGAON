// @ts-check
// वसूली ट्रैकर — टेस्ट: list-filter (साझा helpers: tests/helpers.js)
const { test, lazyTest, expect, openApp, loginLineman, loginJE } = require('./helpers');

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

// ── v9.202: "बड़ी बकाया पहले" क्रम + वादा-तारीख़ (JE: उद्देश्य-अनुकूलता 9.0 → 9.5) ──
test.describe('सूची का क्रम और वादा-तारीख़ (v9.202)', () => {
  const iso = (offset) => {
    const t = new Date(); t.setDate(t.getDate() + offset);
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
  };
  // v9.207: इस सप्ताह के सोमवार से n दिन बाद (n=-1 → पिछला रविवार, 6 → इस सप्ताह का रविवार, 7 → अगला सोमवार)
  const wkDay = (n) => {
    const t = new Date(); t.setHours(12, 0, 0, 0); t.setDate(t.getDate() - ((t.getDay() + 6) % 7) + n);
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
  };
  const seed = async (page, recs) => {
    await openApp(page);
    await page.evaluate(() => { try { localStorage.removeItem('dc_listsort'); } catch (e) {} listSort = 'ledger'; });
    await loginLineman(page);
    await page.evaluate((r) => { cSet(activeHQ, activeCat, r); _renderLimit = 100; renderList(); }, recs);
  };
  const names = (page) => page.$$eval('#con-list .con-card .cc-name', (els) => els.map((e) => e.textContent.trim()));

  test('नाम वाले मेनू में "📋 लेजर क्रम" — चालू पर लेजर-क्रम; बंद पर बड़ी बकाया पहले; पसंद याद रहे', async ({ page }) => {
    await seed(page, [ // seed में लेजर-क्रम चुना है (पुराने टेस्टों जैसा)
      { acc: '1', name: 'छोटा', amount: 500, status: 'pending' },
      { acc: '2', name: 'बड़ा', amount: 52000, status: 'pending' },
      { acc: '3', name: 'मध्यम', amount: 3000, status: 'pending' },
    ]);
    expect(await names(page)).toEqual(['छोटा', 'बड़ा', 'मध्यम']);
    await page.evaluate(() => toggleUserMenu({ stopPropagation() {} }));
    await expect(page.locator('#sort-menu-state')).toHaveText('✓ चालू');
    await page.click('#sort-menu-item');
    expect(await names(page)).toEqual(['बड़ा', 'मध्यम', 'छोटा']);
    await expect(page.locator('#logout-menu')).not.toHaveClass(/open/); // दबाते ही मेनू बंद
    expect(await page.evaluate(() => localStorage.getItem('dc_listsort'))).toBe('amount');
    // डेटा का क्रम नहीं बदला — सिर्फ़ दिखाने का
    expect(await page.evaluate(() => cGet(activeHQ, activeCat).map((x) => x.acc))).toEqual(['1', '2', '3']);
    await page.evaluate(() => toggleUserMenu({ stopPropagation() {} }));
    await expect(page.locator('#sort-menu-state')).toHaveText('बंद');
    await page.click('#sort-menu-item');
    expect(await names(page)).toEqual(['छोटा', 'बड़ा', 'मध्यम']);
  });

  test('रिमार्क में आज की वादा-तारीख़ → "इस सप्ताह जमा का वादा (1)" बटन, card पर "(आज)", वसूल होते ही वादा ख़त्म', async ({ page }) => {
    await seed(page, [
      { acc: '1', name: 'वादा करने वाला', amount: 900, status: 'pending' },
      { acc: '2', name: 'दूसरा', amount: 100, status: 'pending' },
    ]);
    await page.evaluate((d) => {
      openRmkModal(0, '1');
      document.getElementById('rmk-due').value = d;
      document.getElementById('rmk-text').value = 'आज शाम देंगे';
      saveRmk();
    }, iso(0));
    const last = await page.evaluate(() => { const a = cGet(activeHQ, activeCat)[0].remarksArr; return a[a.length - 1]; });
    expect(last.due).toBe(iso(0));
    expect(last.text).toBe('आज शाम देंगे');
    await expect(page.locator('#fb-promise')).toHaveText('इस सप्ताह जमा का वादा (1)');
    await page.click('#fb-promise');
    expect(await names(page)).toEqual(['वादा करने वाला']);
    await expect(page.locator('.chip-due')).toContainText('(आज)');
    await page.evaluate(() => markPaid(0, '1'));
    await expect(page.locator('#fb-promise')).toHaveText('इस सप्ताह जमा का वादा');
    await expect(page.locator('#con-list')).toContainText('इस सप्ताह कोई वादा बाकी नहीं');
  });

  test('सिर्फ़ तारीख़ (बिना लिखे) — रिमार्क अपने-आप बने; आगे का वादा card पर दिखे पर "वादे" बटन में नहीं', async ({ page }) => {
    await seed(page, [{ acc: '1', name: 'क', amount: 900, status: 'pending' }]);
    await page.evaluate((d) => { openRmkModal(0, '1'); document.getElementById('rmk-due').value = d; saveRmk(); }, wkDay(7));
    const last = await page.evaluate(() => { const a = cGet(activeHQ, activeCat)[0].remarksArr; return a[a.length - 1]; });
    expect(last.text).toContain('को जमा करने का वादा');
    expect(last.due).toBe(wkDay(7)); // अगले सप्ताह का सोमवार
    await expect(page.locator('.chip-due')).toBeVisible();
    await expect(page.locator('#fb-promise')).toHaveText('इस सप्ताह जमा का वादा');
  });

  test('बटन में इस सप्ताह (सोमवार–रविवार) के और पिछले सप्ताहों के टूटे वादे (v9.208) — टूटे सबसे ऊपर लाल "(बीत गया)"; अगले सप्ताह के नहीं; बीती तारीख़ नई डालने से रोके', async ({ page }) => {
    await seed(page, [
      { acc: '1', name: 'रविवार वाला', amount: 1, status: 'pending', remarksArr: [{ text: 'x', by: 'a', at: '1', due: wkDay(6) }] },
      { acc: '2', name: 'पिछले सप्ताह वाला', amount: 1, status: 'pending', remarksArr: [{ text: 'y', by: 'a', at: '2', due: wkDay(-1) }] },
      { acc: '3', name: 'सोमवार वाला', amount: 1, status: 'pending', remarksArr: [{ text: 'z', by: 'a', at: '3', due: wkDay(0) }] },
      { acc: '4', name: 'अगले सप्ताह वाला', amount: 1, status: 'pending', remarksArr: [{ text: 'w', by: 'a', at: '4', due: wkDay(7) }] },
    ]);
    await expect(page.locator('#fb-promise')).toHaveText('इस सप्ताह जमा का वादा (3)');
    await page.click('#fb-promise');
    expect(await names(page)).toEqual(['पिछले सप्ताह वाला', 'सोमवार वाला', 'रविवार वाला']); // तारीख़ के क्रम में — टूटा वादा सबसे ऊपर
    await expect(page.locator('.con-card', { hasText: 'पिछले सप्ताह वाला' }).locator('.chip-due.over')).toContainText('(बीत गया)');
    await page.evaluate(() => markPaid(0, '2')); // वसूल होते ही बटन से हटे
    await expect(page.locator('#fb-promise')).toHaveText('इस सप्ताह जमा का वादा (2)');
    expect(await page.evaluate(() => { const w = _weekRange(); return [new Date(w[0] + 'T12:00').getDay(), new Date(w[1] + 'T12:00').getDay()]; })).toEqual([1, 0]);
    await page.evaluate((d) => { openRmkModal(0, '1'); document.getElementById('rmk-due').value = d; document.getElementById('rmk-text').value = 'z'; saveRmk(); }, iso(-1));
    await expect(page.locator('#toast')).toContainText('वादा-तारीख़ आज या आगे की होनी चाहिए');
    expect(await page.evaluate(() => cGet(activeHQ, activeCat)[0].remarksArr.length)).toBe(1);
  });

  test('"वसूल हुआ" चुनने पर वादा-तारीख़ वाला खाना छिपे; PDF/Excel में "इस सप्ताह के वादे" वाली सूची जाए', async ({ page }) => {
    await seed(page, [
      { acc: '1', name: 'क', amount: 1, status: 'pending', remarksArr: [{ text: 'x', by: 'a', at: '1', due: iso(0) }] },
      { acc: '2', name: 'ख', amount: 1, status: 'pending' },
    ]);
    await page.evaluate(() => { openRmkModal(0, '1'); setRmkStatus('paid'); });
    await expect(page.locator('#rmk-due-grp')).toBeHidden();
    await page.evaluate(() => setRmkStatus('pending'));
    await expect(page.locator('#rmk-due-grp')).toBeVisible();
    await page.evaluate(() => closeRmkModal());
    await page.click('#fb-promise');
    expect(await page.evaluate(() => [_filteredForDownload().map((x) => x.acc), _FILTER_LABEL[activeFilter]])).toEqual([['1'], 'इस सप्ताह जमा का वादा']);
  });
});

test.describe('"बड़ी बकाया पहले" — पंचायत नीचे, और ऐप धीमा न हो (v9.202)', () => {
  test('सरपंच/ग्राम पंचायत (LV3.1, LV3.2) बड़ी बकाया के बावजूद सबसे नीचे, आपस में बड़ी पहले', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => {
      cSet(activeHQ, activeCat, [
        { acc: '1', name: 'घर छोटा', amount: 800, tariff: 'LV1.2', status: 'pending' },
        { acc: '2', name: 'ग्राम पंचायत नल-जल', amount: 450000, tariff: 'LV3.1', status: 'pending' },
        { acc: '3', name: 'दुकान', amount: 9000, tariff: 'LV2.1', status: 'pending' },
        { acc: '4', name: 'स्ट्रीट लाइट', amount: 990000, tariff: 'LV 3.2', status: 'pending' },
        { acc: '5', name: 'घर बड़ा', amount: 25000, tariff: 'LV1.2', status: 'pending' },
      ]);
      listSort = 'amount'; _renderLimit = 100; renderList();
    });
    const names = await page.$$eval('#con-list .con-card .cc-name', (els) => els.map((e) => e.textContent.trim()));
    expect(names).toEqual(['घर बड़ा', 'दुकान', 'घर छोटा', 'स्ट्रीट लाइट', 'ग्राम पंचायत नल-जल']);
  });

  test('3500 records (रिमार्क और वादों समेत) — क्रम चालू होने से render में ख़ास फ़र्क़ न पड़े', async ({ page }) => {
    test.setTimeout(90000);
    await openApp(page);
    await loginLineman(page);
    const r = await page.evaluate(() => {
      const t0 = new Date(); const iso = t0.getFullYear() + '-' + String(t0.getMonth() + 1).padStart(2, '0') + '-' + String(t0.getDate()).padStart(2, '0');
      const arr = [];
      for (let i = 0; i < 3500; i++) {
        arr.push({ acc: '9' + String(i).padStart(9, '0'), name: 'उपभोक्ता ' + i, addr: 'गांव ' + (i % 40), amount: (i * 7919) % 60000,
          tariff: i % 50 === 0 ? 'LV3.1' : 'LV1.2', status: i % 3 === 0 ? 'paid' : 'pending',
          remarksArr: [{ text: 'घर पर नहीं', by: 'क', at: '1' }, { text: 'देंगे', by: 'क', at: '2', due: i % 10 === 0 ? iso : '' }] });
      }
      cSet(CU.hq, 'कुल उपभोक्ता', arr); activeCat = 'कुल उपभोक्ता';
      const time = (mode) => { listSort = mode; const s = performance.now(); for (let k = 0; k < 5; k++) renderListWith(cGet(CU.hq, 'कुल उपभोक्ता')); return (performance.now() - s) / 5; };
      time('ledger'); // गरम करना
      return { ledger: time('ledger'), amount: time('amount') };
    });
    // पहली 100 cards ही बनती हैं (बाक़ी "और दिखाएं" पर) — क्रम और वादों की गिनती सिर्फ़ गणना है, कोई नेट नहीं
    expect(r.amount).toBeLessThan(r.ledger + 150);
    expect(r.amount).toBeLessThan(1000);
    console.log('render (ms) — लेजर क्रम: ' + r.ledger.toFixed(1) + ', बड़ी बकाया पहले: ' + r.amount.toFixed(1));
  });
});

// JE का फ़ैसला (11/10, "ख"): नया फ़ोन / पहली बार = बड़ी बकाया पहले, कोई अतिरिक्त पंक्ति नहीं
lazyTest('डिफ़ॉल्ट क्रम = बड़ी बकाया पहले (पंचायत नीचे); मेनू में "📋 लेजर क्रम" बंद (v9.202)', async ({ page }) => {
  await openApp(page);
  expect(await page.evaluate(() => [localStorage.getItem('dc_listsort'), listSort])).toEqual([null, 'amount']);
  await loginLineman(page);
  await page.evaluate(() => {
    cSet(activeHQ, activeCat, [
      { acc: '1', name: 'छोटा', amount: 500, status: 'pending' },
      { acc: '2', name: 'पंचायत', amount: 900000, status: 'pending', tariff: 'LV3.1' },
      { acc: '3', name: 'बड़ा', amount: 52000, status: 'pending' },
    ]);
    _renderLimit = 100; renderList();
  });
  const n = await page.$$eval('#con-list .con-card .cc-name', (els) => els.map((e) => e.textContent.trim()));
  expect(n).toEqual(['बड़ा', 'छोटा', 'पंचायत']);
  await expect(page.locator('#sort-menu-state')).toHaveText('बंद');
});

test('सूची के ऊपर क्रम वाली कोई पंक्ति न हो — JE ने हटवाई (v9.202)', async () => {
  const fs = require('fs'), path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  expect(html).not.toContain('sort-hint');
  expect(html).not.toContain('क्रम चालू');
});

// ── v9.203: गांव की पट्टी — टैप करते ही उसी गांव की सूची (JE: अंग्रेज़ी नाम, सबसे ज़्यादा बाकी पहले) ──
test.describe('गांव की पट्टी (v9.203)', () => {
  const recs = [
    { acc: '1', name: 'अ', amount: 100, status: 'pending', addr: 'ADEGAON' },
    { acc: '2', name: 'ब', amount: 900, status: 'pending', addr: 'HAMEERGARH' },
    { acc: '3', name: 'स', amount: 500, status: 'pending', addr: 'HAMEERGAGH' }, // आदेगांव का स्पेलिंग-सुधार → HAMEERGARH
    { acc: '4', name: 'द', amount: 50, status: 'pending', addr: 'hameergarh ' }, // केस/स्पेस → HAMEERGARH
    { acc: '5', name: 'य', amount: 70, status: 'paid', addr: 'DEVRI' },
    { acc: '6', name: 'र', amount: 20, status: 'pending', addr: 'ADEGAON' },
  ];
  const seed = async (page) => {
    await openApp(page);
    await loginLineman(page); // पहला HQ = आदेगांव (VILLAGE_ALIASES वाला)
    await page.locator('#loader').waitFor({ state: 'hidden', timeout: 20000 }); // लोड-परत बटनों के ऊपर न रहे
    await page.evaluate((r) => { listSort = 'ledger'; cSet(activeHQ, activeCat, r); _renderLimit = 100; renderList(); }, recs);
  };
  const chips = (page) => page.$$eval('#vg-wrap .vg-chip', (els) => els.map((e) => e.textContent.trim()));
  const names = (page) => page.$$eval('#con-list .con-card .cc-name', (els) => els.map((e) => e.textContent.trim()));

  test('गांव बाकी की गिनती के साथ, सबसे ज़्यादा बाकी पहले; स्पेलिंग-भेद एक ही बटन में', async ({ page }) => {
    await seed(page);
    expect(await chips(page)).toEqual(['सभी', 'HAMEERGARH3', 'ADEGAON2', 'DEVRI0']);
    await expect(page.locator('#vg-wrap .vg-chip.on')).toHaveText('सभी');
  });

  test('गांव टैप → सिर्फ़ उसी के उपभोक्ता; "बड़ी बकाया पहले" उसी गांव में; "सभी" पर वापस', async ({ page }) => {
    await seed(page);
    await page.click('#vg-wrap .vg-chip:has-text("HAMEERGARH")');
    expect(await names(page)).toEqual(['ब', 'स', 'द']);
    await expect(page.locator('#vg-wrap .vg-chip.on')).toContainText('HAMEERGARH');
    await page.evaluate(() => setListSort('amount'));
    expect(await names(page)).toEqual(['ब', 'स', 'द']);
    await page.click('[data-f="paid"]');
    await expect(page.locator('#con-list')).toContainText('अभी कोई वसूली दर्ज नहीं');
    await page.click('[data-f="all"]');
    await page.click('#vg-wrap .vg-chip:has-text("सभी")');
    expect((await names(page)).length).toBe(6);
  });

  test('PDF/Excel भी चुने गांव का ही; श्रेणी बदलते ही गांव "सभी" पर लौटे', async ({ page }) => {
    await seed(page);
    await page.click('#vg-wrap .vg-chip:has-text("ADEGAON")');
    expect(await page.evaluate(() => _filteredForDownload().map((x) => x.acc))).toEqual(['1', '6']);
    await page.evaluate(() => { cSet(activeHQ, CATS[1], [{ acc: '9', name: 'क', amount: 1, status: 'pending', addr: 'ADEGAON' }]); });
    await page.locator('.cat-tab').nth(1).click();
    await page.waitForFunction(() => activeVillage === '');
    await expect(page.locator('#vg-wrap')).toBeHidden(); // एक ही गांव — पट्टी नहीं
  });

  test('गांव का नाम HTML बनकर न चले (escHtml) — पते में <img onerror> हो तो भी', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const fired = await page.evaluate(() => {
      window.__x = 0;
      cSet(activeHQ, activeCat, [
        { acc: '1', name: 'क', amount: 1, status: 'pending', addr: '<img src=x onerror="window.__x=1">' },
        { acc: '2', name: 'ख', amount: 1, status: 'pending', addr: 'ADEGAON' },
      ]);
      renderList();
      return new Promise((r) => setTimeout(() => r(window.__x), 300));
    });
    expect(fired).toBe(0);
    expect(await page.locator('#vg-wrap img').count()).toBe(0);
  });
});

test.describe('गांव की पट्टी — नाम वाले मेनू से दिखाएं/छिपाएं (v9.203)', () => {
  test('डिफ़ॉल्ट दिखे; मेनू से छिपाएं → पट्टी गायब + चुना गांव "सभी"; याद रहे; दोबारा दिखाएं', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.locator('#loader').waitFor({ state: 'hidden', timeout: 20000 });
    await page.evaluate(() => {
      cSet(activeHQ, activeCat, [
        { acc: '1', name: 'अ', amount: 1, status: 'pending', addr: 'ADEGAON' },
        { acc: '2', name: 'ब', amount: 2, status: 'pending', addr: 'DEVRI' },
      ]);
      renderList();
    });
    await expect(page.locator('#vg-wrap')).toBeVisible();
    await page.click('#vg-wrap .vg-chip:has-text("DEVRI")');
    expect(await page.$$eval('#con-list .con-card', (e) => e.length)).toBe(1);
    await page.evaluate(() => toggleUserMenu({ stopPropagation() {} }));
    await expect(page.locator('#vgbar-menu-state')).toHaveText('✓ दिखे');
    await page.click('#vgbar-menu-item');
    await expect(page.locator('#vg-wrap')).toBeHidden();
    await expect(page.locator('#logout-menu')).not.toHaveClass(/open/);
    expect(await page.$$eval('#con-list .con-card', (e) => e.length)).toBe(2); // छिपे गांव पर छंटी न रहे
    expect(await page.evaluate(() => localStorage.getItem('dc_vgbar'))).toBe('off');
    await page.evaluate(() => toggleUserMenu({ stopPropagation() {} }));
    await expect(page.locator('#vgbar-menu-state')).toHaveText('छिपी');
    await page.click('#vgbar-menu-item');
    await expect(page.locator('#vg-wrap')).toBeVisible();
  });
});

// ── v9.204: वादा एक टैप में — "कल / 2 दिन में / हफ़्ते में / तारीख़…" (JE ने नमूना देखकर "ठीक है" कहा) ──
test.describe('वादा एक टैप में (v9.204)', () => {
  const iso = (offset) => {
    const t = new Date(); t.setDate(t.getDate() + offset);
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
  };
  const open = async (page) => {
    await openApp(page);
    await loginLineman(page);
    await page.locator('#loader').waitFor({ state: 'hidden', timeout: 20000 });
    await page.evaluate(() => { cSet(activeHQ, activeCat, [{ acc: '1', name: 'क', amount: 900, status: 'pending' }]); renderList(); openRmkModal(0, '1'); });
  };
  const lastRmk = (page) => page.evaluate(() => { const a = cGet(activeHQ, activeCat)[0].remarksArr || []; return a[a.length - 1]; });

  test('बोलकर लिखा रिमार्क + "कल" एक टैप → वही text, कल की तारीख़; पुष्टि-पंक्ति दिखे; कैलेंडर-खाना छिपा रहे', async ({ page }) => {
    await open(page);
    await expect(page.locator('#rmk-due')).toBeHidden();
    await page.fill('#rmk-text', 'बेटा पैसे भेजेगा');
    await page.click('#rmk-due-grp .due-chip[data-d="1"]');
    await expect(page.locator('#rmk-due-grp .due-chip[data-d="1"]')).toHaveClass(/on/);
    await expect(page.locator('#rmk-due-note')).toContainText('उस सप्ताह "इस सप्ताह जमा का वादा" में दिखेगा');
    await expect(page.locator('#rmk-due')).toBeHidden();
    await page.click('#rmk-overlay .btn-save');
    const r = await lastRmk(page);
    expect([r.text, r.due]).toEqual(['बेटा पैसे भेजेगा', iso(1)]);
  });

  test('"2 दिन में" / "हफ़्ते में" सही तारीख़; दोबारा वही बटन = वादा हटे; बिना लिखे text अपने-आप', async ({ page }) => {
    await open(page);
    await page.click('#rmk-due-grp .due-chip[data-d="2"]');
    expect(await page.inputValue('#rmk-due')).toBe(iso(2));
    await page.click('#rmk-due-grp .due-chip[data-d="2"]'); // दोबारा = हटाओ
    expect(await page.inputValue('#rmk-due')).toBe('');
    await expect(page.locator('#rmk-due-grp .due-chip.on')).toHaveCount(0);
    await expect(page.locator('#rmk-due-note')).toHaveText('');
    await page.click('#rmk-due-grp .due-chip[data-d="7"]');
    await page.click('#rmk-overlay .btn-save');
    const r = await lastRmk(page);
    expect(r.due).toBe(iso(7));
    expect(r.text).toContain('को जमा करने का वादा');
  });

  test('"तारीख़…" पर ही कैलेंडर-खाना दिखे; वहां चुनी तारीख़ सेव हो; खिड़की दोबारा खुलने पर सब साफ़', async ({ page }) => {
    await open(page);
    await page.click('#rmk-due-grp .due-chip[data-d="pick"]');
    await expect(page.locator('#rmk-due')).toBeVisible();
    await page.fill('#rmk-due', iso(9));
    await expect(page.locator('#rmk-due-note')).toContainText('उस सप्ताह');
    await page.click('#rmk-overlay .btn-save');
    expect((await lastRmk(page)).due).toBe(iso(9));
    await page.evaluate(() => openRmkModal(0, '1'));
    await expect(page.locator('#rmk-due')).toBeHidden();
    await expect(page.locator('#rmk-due-grp .due-chip.on')).toHaveCount(0);
    expect(await page.inputValue('#rmk-due')).toBe('');
  });
});

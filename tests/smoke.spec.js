// @ts-check
// वसूली ट्रैकर — smoke tests
// हर बाहरी request (CDN/Firebase/Google) block की जाती है ताकि:
//  1. tests कभी असली production database को न छुएं
//  2. app का offline-first रास्ता भी हर PR पर अपने आप जांचा जाए
const { test, expect } = require('@playwright/test');

/** @param {import('@playwright/test').Page} page */
async function blockExternal(page) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
}

/** @param {import('@playwright/test').Page} page */
async function openApp(page) {
  await blockExternal(page);
  await page.goto('/');
  // startApp 2 sec के fallback timer पर चलता है
  await page.waitForFunction(() => document.getElementById('login-screen').classList.contains('active'), null, { timeout: 15000 });
}

/** @param {import('@playwright/test').Page} page */
async function loginLineman(page, name = 'टेस्ट लाइनमैन') {
  await page.click('#rc-lin');
  await page.fill('#uname-inp', name);
  await page.selectOption('#hq-sel', { index: 1 });
  await page.click('.login-btn');
  await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'), null, { timeout: 15000 });
}

/** @param {import('@playwright/test').Page} page */
async function loginJE(page, pw = 'Test#123') {
  await page.evaluate((p) => _saveJEHash(p), pw); // offline-hash रास्ता — नेट बंद है
  await page.click('#rc-sup');
  await page.fill('#uname-inp', 'टेस्ट जेई');
  await page.fill('#sup-pw', pw);
  await page.click('.login-btn');
  await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'), null, { timeout: 15000 });
}

test.describe('बूट और login', () => {
  test('app बिना नेट के भी खुलती है और version दिखाती है', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openApp(page);
    await expect(page.locator('#ver-badge')).toContainText('Version');
    expect(errors).toEqual([]);
  });

  test('lineman login चलता है — tabs और summary बनते हैं', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    expect(await page.locator('.cat-tab').count()).toBe(8);
    // summary offline में token-gate (4s) के बाद render होती है — इंतज़ार करें
    await page.waitForFunction(() => document.querySelectorAll('.sbox').length === 4, null, { timeout: 15000 });
  });

  test('JE गलत पासवर्ड पर रुकता है, सही पर अंदर जाता है', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => _saveJEHash('SahiPass#1'));
    await page.click('#rc-sup');
    await page.fill('#uname-inp', 'जेई');
    await page.fill('#sup-pw', 'galat-pass');
    await page.click('.login-btn');
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => document.getElementById('app-screen').classList.contains('active'))).toBe(false);
    await page.fill('#sup-pw', 'SahiPass#1');
    await page.click('.login-btn');
    await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'));
  });
});

test.describe('रोल-आधारित UI', () => {
  test('JE को dropdown में चारों tools दिखते हैं, lineman को नहीं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const jeVisible = await page.evaluate(() =>
      ['hsc-menu-item', 'cash-menu-item', 'log-menu-item', 'backup-menu-item', 'wasc-menu-item']
        .every((id) => document.getElementById(id).style.display !== 'none'));
    expect(jeVisible).toBe(true);
    await page.evaluate(() => doLogout(false));
    await loginLineman(page);
    const linHidden = await page.evaluate(() =>
      ['hsc-menu-item', 'cash-menu-item', 'log-menu-item', 'backup-menu-item', 'wasc-menu-item']
        .every((id) => document.getElementById(id).style.display === 'none'));
    expect(linHidden).toBe(true);
  });

  test('JE के सभी modals खुलते-बंद होते हैं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const ok = await page.evaluate(() => {
      const results = [];
      openUpModal(); results.push(document.getElementById('up-overlay').classList.contains('open')); closeUpModal();
      openScorecard(); results.push(document.getElementById('sc-overlay').classList.contains('open')); closeScModal();
      openLogModal(); results.push(document.getElementById('log-overlay').classList.contains('open')); closeLogModal();
      openHscModal(); results.push(document.getElementById('hsc-overlay').classList.contains('open')); closeHscModal();
      openCashModal(); results.push(document.getElementById('cash-overlay').classList.contains('open')); closeCashModal();
      openWaScorecard(); results.push(document.getElementById('wasc-overlay').classList.contains('open')); closeWaScorecard();
      return results;
    });
    expect(ok).toEqual([true, true, true, true, true, true]);
  });

  test('स्कोरकार्ड डिस्प्ले — सभी HQ की सही गिनती और वसूल% बनता है', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '1', status: 'paid', amount: 100 },
        { acc: '2', status: 'pending', amount: 500 },
      ]);
    });
    await page.evaluate(() => openWaScorecard());
    await page.waitForFunction(() => document.querySelectorAll('#wasc-content tbody tr').length === 6, null, { timeout: 20000 });
    const r = await page.evaluate(() => {
      const row = document.querySelectorAll('#wasc-content tbody tr')[0];
      return {
        hq: row.querySelector('.wasc-hq').textContent,
        paidBold: row.querySelector('.wasc-paid-num').textContent,
        text: row.textContent,
      };
    });
    expect(r.hq).toBe('आदेगांव');
    expect(r.paidBold).toBe('1');
    expect(r.text).toContain('50.0%');
  });
});

test.describe('डेटा और वसूली', () => {
  test('cache की लिस्ट render होती है और वसूल mark काम करता है', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '111222', name: 'राम कुमार', status: 'pending', amount: 500 },
        { acc: '333444', name: 'श्याम लाल', status: 'pending', amount: 700 },
      ]);
    });
    await loginLineman(page); // HQ index 1 = आदेगांव (index 0 placeholder)
    await expect(page.locator('.con-card').first()).toContainText('राम कुमार', { timeout: 15000 });
    await page.evaluate(() => markPaid(0));
    await page.waitForTimeout(500);
    const st = await page.evaluate(() => cGet('आदेगांव', 'कुल उपभोक्ता')[0].status);
    expect(st).toBe('paid');
  });

  test('कैश लिस्ट: नया-पुराना timestamp नियम (बोर्ड टकराव)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((res) => {
      let serverBoard = { curPaid: '999', curAmt: '9', ts: 200 };
      let putCount = 0;
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('HOME_SCORECARD') > -1) {
          if (opts && opts.method === 'PUT') { putCount++; serverBoard = JSON.parse(opts.body); return Promise.resolve({ ok: true, json: () => Promise.resolve(serverBoard) }); }
          return Promise.resolve({ ok: true, json: () => Promise.resolve(serverBoard) });
        }
        return orig(url, opts);
      };
      Object.defineProperty(navigator, 'onLine', { get: () => true });
      // पुराना local (ts=100) → server (ts=200) अपनाए, PUT न करे
      HSC = { curPaid: '0', curAmt: '0', ts: 100 };
      _setHscPending(true);
      _hscRetryPublish();
      setTimeout(() => {
        const case1 = HSC.curPaid === '999' && putCount === 0 && !_hscPending();
        // नया local (ts=300) → PUT हो
        HSC = { curPaid: '777', curAmt: '7', ts: 300 };
        _setHscPending(true);
        _hscRetryPublish();
        setTimeout(() => res({ case1, case2: putCount === 1 && serverBoard.curPaid === '777' }), 400);
      }, 400);
    }));
    expect(r.case1).toBe(true);
    expect(r.case2).toBe(true);
  });
});

test.describe('ग्राम-वार वसूली', () => {
  test('JE को सभी HQ tabs दिखते हैं, lineman को सिर्फ अपना HQ', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => openVillageModal());
    await page.waitForTimeout(500);
    const jeTabs = await page.locator('#vg-hq-tabs .hq-tab').count();
    expect(jeTabs).toBe(6); // HQS.length जितने tabs
    await page.evaluate(() => closeVillageModal());
    await page.evaluate(() => doLogout(false));
    await loginLineman(page);
    await page.evaluate(() => openVillageModal());
    await page.waitForTimeout(500);
    const linTabs = await page.locator('#vg-hq-tabs .hq-tab').count();
    expect(linTabs).toBe(1);
  });

  test('गांव-वार गिनती, खोज, राशि और योग — सीधे टेबल में सही बनते हैं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '1', addr: 'रामपुर', status: 'paid', amount: 100 },
        { acc: '2', addr: 'रामपुर', status: 'pending', amount: 200 },
        { acc: '3', addr: 'श्यामपुर', status: 'paid', amount: 150 },
      ]);
    });
    await page.evaluate(() => openVillageModal());
    await page.waitForFunction(() => document.querySelectorAll('#vg-list tbody tr').length === 2, null, { timeout: 15000 });
    // खोज
    await page.fill('#vg-search', 'राम');
    await page.waitForTimeout(200);
    expect(await page.locator('#vg-list tbody tr').count()).toBe(1);
    await page.fill('#vg-search', '');
    await page.evaluate(() => _vgRenderList());
    const footer = await page.locator('#vg-list tfoot').textContent();
    expect(footer).toContain('योग (2 गांव)');
    expect(footer).toContain('66.7%');
    expect(footer).toContain('₹200'); // बकाया
    expect(footer).toContain('₹250'); // वसूल राशि (100+150)
  });

  test('मिलते-जुलते गांव-नाम (केस भिन्नता + अलग-टोकन) रिपोर्ट में मर्ज होते हैं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => {
      cSet('जोबा', 'कुल उपभोक्ता', [
        { acc: '1', addr: 'PIPARIYA', status: 'paid', amount: 100 },
        { acc: '2', addr: 'PIPARIYA JOBA', status: 'pending', amount: 200 },
        { acc: '3', addr: 'Khubi', status: 'paid', amount: 50 },
        { acc: '4', addr: 'KHUBI', status: 'pending', amount: 60 },
      ]);
    });
    await page.evaluate(() => openVillageModal());
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      Array.from(document.querySelectorAll('#vg-hq-tabs .hq-tab')).find((t) => t.textContent === 'जोबा').click();
    });
    await page.waitForFunction(() => document.querySelectorAll('#vg-list tbody tr').length === 2, null, { timeout: 15000 });
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('#vg-list tbody tr')).map((r) => r.textContent));
    expect(rows.some((r) => r.includes('2') && (r.includes('PIPARIYA') || r.includes('Piparia')))).toBe(true);
    expect(rows.some((r) => /khubi/i.test(r) && r.includes('2'))).toBe(true);
  });
});

test.describe('गांव-वार सुधरी Excel', () => {
  test('मिलते-जुलते गांव-नाम मर्ज करके सारांश + HQ-वार sheets बनती हैं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => {
      cSet('जोबा', 'कुल उपभोक्ता', [
        { acc: '1', addr: 'PIPARIYA', name: 'राम', status: 'paid', amount: 100 },
        { acc: '2', addr: 'PIPARIYA JOBA', name: 'श्याम', status: 'pending', amount: 100 },
      ]);
    });
    const r = await page.evaluate(() => new Promise((res) => {
      var sheets = [];
      window.XLSX = {
        utils: {
          book_new: function () { return { SheetNames: [], Sheets: {} }; },
          aoa_to_sheet: function (a) { return { rows: a }; },
          book_append_sheet: function (wb, ws, nm) { wb.SheetNames.push(nm); wb.Sheets[nm] = ws; sheets.push({ name: nm, rows: ws.rows }); },
        },
        writeFile: function (wb) { res({ order: wb.SheetNames.slice(), sheets: sheets }); },
      };
      downloadVillageExcel();
    }));
    expect(r.order[0]).toBe('सारांश');
    const summarySheet = r.sheets.find((s) => s.name === 'सारांश');
    const jobaRow = summarySheet.rows.find((row) => row[0] === 'जोबा');
    expect(jobaRow[1]).toBe('PIPARIYA'); // मर्ज होकर एक ही गांव
    expect(jobaRow[2]).toBe(2); // कुल कनेक्शन
    const jobaSheet = r.sheets.find((s) => s.name === 'जोबा');
    expect(jobaSheet.rows.length).toBe(3); // header + 2 records
  });

  test('lineman भी डाउनलोड कर सकता है, पर सिर्फ अपने HQ का', async ({ page }) => {
    test.setTimeout(90000); // background prefetch (offline-gated fetches) को settle होने का समय — धीमे CI runner पर flake रोकने के लिए
    await openApp(page);
    await loginLineman(page); // HQ index 1 = पिंडरई
    await page.waitForTimeout(2000); // login के बाद का background prefetch शुरू होकर शांत हो जाए
    const myHQ = await page.evaluate(() => CU.hq);
    await page.evaluate(() => {
      cSet(CU.hq, 'कुल उपभोक्ता', [{ acc: '1', addr: 'ORAPANI', name: 'राधा', status: 'paid', amount: 100 }]);
      cSet('जोबा', 'कुल उपभोक्ता', [{ acc: '9', addr: 'PIPARIYA', name: 'गीता', status: 'paid', amount: 50 }]);
    });
    const r = await page.evaluate(() => new Promise((res) => {
      var sheets = [];
      window.XLSX = {
        utils: {
          book_new: function () { return { SheetNames: [], Sheets: {} }; },
          aoa_to_sheet: function (a) { return { rows: a }; },
          book_append_sheet: function (wb, ws, nm) { wb.SheetNames.push(nm); wb.Sheets[nm] = ws; sheets.push(nm); },
        },
        writeFile: function (wb) { res({ sheets: wb.SheetNames.slice() }); },
      };
      downloadVillageExcel();
    }));
    expect(r.sheets).toContain(myHQ);
    expect(r.sheets).not.toContain('जोबा');
  });
});

test.describe('data format (चरण 1 — दोनों ढांचे)', () => {
  test('normList पुराना array और नया per-record object दोनों पढ़ता है', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      const rec1 = { acc: '111', name: 'राम', status: 'pending', amount: 100 };
      const rec2 = { acc: '222', name: 'श्याम', status: 'paid', amount: 200 };
      // 1. पुराना ढांचा: array (null holes सहित)
      const a = normList([rec1, null, rec2]);
      // 2. नया ढांचा: object keyed by IVRS
      const b = normList({ '111': rec1, '222': rec2 });
      // 3. नया ढांचा + 'o' क्रम — upload का order बहाल हो
      const c = normList({ '111': { acc: '111', o: 2 }, '222': { acc: '222', o: 1 } });
      // 4. खाली/null
      const d = normList(null);
      return {
        arrayOk: a.length === 2 && a[0].acc === '111' && a[1].acc === '222',
        objectOk: b.length === 2 && b[0].acc === '111',
        remarksMigrated: Array.isArray(b[0].remarksArr),
        orderOk: c[0].acc === '222' && c[1].acc === '111',
        nullOk: Array.isArray(d) && d.length === 0,
      };
    });
    expect(r).toEqual({ arrayOk: true, objectOk: true, remarksMigrated: true, orderOk: true, nullOk: true });
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
});

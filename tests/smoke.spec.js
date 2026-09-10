// @ts-check
// वसूली ट्रैकर — smoke tests
// हर बाहरी request (CDN/Firebase/Google) block की जाती है ताकि:
//  1. tests कभी असली production database को न छुएं
//  2. app का offline-first रास्ता भी हर PR पर अपने आप जांचा जाए
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

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

  test('कंज्यूमर कार्ड लिस्ट लंबी हो तो .main-scroll ही अंदर scroll करे, पूरा पेज नहीं (कार्ड scroll न होने वाला bug)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => {
      var list = document.getElementById('con-list');
      var html = '';
      for (var i = 0; i < 60; i++) {
        html += '<div class="con-card"><div class="cc-top"><div class="cc-name">टेस्ट उपभोक्ता ' + i + '</div></div><div class="cc-amt">1000</div></div>';
      }
      list.innerHTML = html;
    });
    const dims = await page.evaluate(() => {
      var ms = document.querySelector('.main-scroll');
      return {
        mainScrollScrollable: ms.scrollHeight > ms.clientHeight,
        docScrollable: document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight + 5,
      };
    });
    expect(dims.mainScrollScrollable).toBe(true);
    expect(dims.docScrollable).toBe(false); // पूरा पेज/body scroll न करे — सिर्फ़ अंदर की लिस्ट
    await page.evaluate(() => { document.querySelector('.main-scroll').scrollTop = 300; });
    expect(await page.evaluate(() => document.querySelector('.main-scroll').scrollTop)).toBeGreaterThan(0);
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

  test('login session reload में बना रहे — pull-to-refresh जैसा असली page reload दोबारा login न मांगे', async ({ page }) => {
    await openApp(page);
    await loginLineman(page, 'रिलोड लाइनमैन');
    expect(await page.evaluate(() => localStorage.getItem('dc_cu'))).toContain('रिलोड लाइनमैन');
    await page.reload();
    await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'), null, { timeout: 15000 });
    expect(await page.evaluate(() => document.getElementById('login-screen').classList.contains('active'))).toBe(false);
    expect(await page.evaluate(() => CU && CU.name)).toBe('रिलोड लाइनमैन');
    // चुपचाप वापस आया — "स्वागत है" toast दोबारा न दिखे
    expect(await page.evaluate(() => document.getElementById('toast').classList.contains('show'))).toBe(false);
  });

  // मोबाइल पर ऐप minimize होने पर OS पूरा tab मार देता है। असली दुनिया में यह "नया tab, वही
  // browser profile" जैसा है — sessionStorage खाली, localStorage भरा हुआ। पहले session
  // sessionStorage में था, इसलिए हर बार दोबारा नाम+PIN भरना पड़ता था
  test('मोबाइल में ऐप minimize होकर मरने के बाद भी login बना रहे (sessionStorage उड़ जाए तब भी)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page, 'मिनिमाइज़ लाइनमैन');
    await page.evaluate(() => sessionStorage.clear()); // OS ने tab मार दिया
    await page.reload();
    await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'), null, { timeout: 15000 });
    expect(await page.evaluate(() => CU && CU.name)).toBe('मिनिमाइज़ लाइनमैन');
    expect(await page.evaluate(() => document.getElementById('login-screen').classList.contains('active'))).toBe(false);
  });

  test('loadSession — SESSION_MAX_DAYS से पुराना session न चले (खोया/छोड़ा हुआ फ़ोन हमेशा अंदर न रहे)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      var day = 24 * 60 * 60 * 1000;
      var cu = { role: 'lineman', name: 'पुराना', hq: HQS[1] };
      localStorage.setItem('dc_cu', JSON.stringify({ cu: cu, at: Date.now() - (SESSION_MAX_DAYS - 1) * day }));
      var justInside = loadSession();
      localStorage.setItem('dc_cu', JSON.stringify({ cu: cu, at: Date.now() - (SESSION_MAX_DAYS + 1) * day }));
      var expired = loadSession();
      // फ़ोन की घड़ी आगे कर दी गई हो (at भविष्य में) — भरोसा न करें, session चलने दें
      localStorage.setItem('dc_cu', JSON.stringify({ cu: cu, at: Date.now() + 90 * day }));
      var future = loadSession();
      return { justInside: justInside && justInside.name, expired: expired, future: future && future.name };
    });
    expect(r.justInside).toBe('पुराना');
    expect(r.expired).toBeNull();
    expect(r.future).toBe('पुराना');
  });

  test('loadSession — v9.107 तक के पुराने sessionStorage वाले session से भी एक बार अंदर आ जाए (अपडेट के दिन कोई बाहर न हो)', async ({ page }) => {
    await openApp(page);
    const name = await page.evaluate(() => {
      localStorage.removeItem('dc_cu');
      sessionStorage.setItem('dc_cu', JSON.stringify({ role: 'lineman', name: 'पुराने रूप वाला', hq: HQS[1] }));
      var s = loadSession();
      return s && s.name;
    });
    expect(name).toBe('पुराने रूप वाला');
  });

  test('loadSession — अधूरा/टूटा session data पर login screen ही दिखे (crash न हो)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      var out = [];
      ['{ टूटा json', JSON.stringify({ cu: { role: 'lineman', name: 'बिना HQ' }, at: Date.now() }), JSON.stringify({ cu: null, at: Date.now() }), 'null'].forEach(function (v) {
        localStorage.setItem('dc_cu', v);
        out.push(loadSession());
      });
      return out;
    });
    expect(r).toEqual([null, null, null, null]);
  });

  // login अब 30 दिन तक टिकता है, इसलिए यह और ज़रूरी हो गया: हर कोई (लाइनमैन भी, सिर्फ़ JE नहीं)
  // बिना किसी की मदद के खुद लॉगआउट कर सके — साझा फ़ोन पर अगला कर्मचारी अपने नाम से आ सके
  test('लाइनमैन खुद लॉगआउट कर सके — मेनू में बटन दिखे, दबाते ही login screen पर लौटे', async ({ page }) => {
    await openApp(page);
    await loginLineman(page, 'खुद लॉगआउट');
    await page.click('.user-pill'); // हेडर में अपना नाम — हर भूमिका को दिखता है
    const btn = page.locator('#logout-menu .logout-item', { hasText: 'लॉगआउट करें' });
    await expect(btn).toBeVisible();
    page.on('dialog', (d) => d.accept()); // "लॉगआउट करना चाहते हैं?"
    await btn.click();
    await page.waitForFunction(() => document.getElementById('login-screen').classList.contains('active'), null, { timeout: 15000 });
    expect(await page.evaluate(() => localStorage.getItem('dc_cu'))).toBeNull();
    // reload पर भी वापस अंदर न आ जाए
    await page.reload();
    await page.waitForFunction(() => document.getElementById('login-screen').classList.contains('active'), null, { timeout: 15000 });
    expect(await page.evaluate(() => document.getElementById('app-screen').classList.contains('active'))).toBe(false);
  });

  test('explicit logout के बाद session साफ़ हो जाए — अगला reload login screen पर ही रुके', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => doLogout(false));
    expect(await page.evaluate(() => localStorage.getItem('dc_cu'))).toBeNull();
    expect(await page.evaluate(() => sessionStorage.getItem('dc_cu'))).toBeNull();
    await page.reload();
    await page.waitForFunction(() => document.getElementById('login-screen').classList.contains('active'), null, { timeout: 15000 });
  });

  test('html/body और सभी scroll-containers पर overscroll-behavior-y सेट रहे — वरना native pull-to-refresh पूरा पेज reload करके गलती से logout कर देती है (v9.62 के structural scroll-fix में यह चुपचाप गायब हो गया था, बिना test के किसी को पता नहीं चला)', async ({ page }) => {
    await openApp(page);
    const val = await page.evaluate(() => getComputedStyle(document.body).overscrollBehaviorY);
    expect(val).toBe('none');
    await loginLineman(page);
    const containers = ['.main-scroll', '.msheet', '.preview-box', '.prev-rmk-list', '.log-list'];
    for (const sel of containers) {
      const cv = await page.evaluate((s) => {
        var el = document.querySelector(s);
        return el ? getComputedStyle(el).overscrollBehaviorY : null;
      }, sel);
      expect(cv, sel + ' पर overscroll-behavior-y होना चाहिए').toBe('contain');
    }
  });

  test('"वापस" बटन से बार-बार पीछे जाकर login screen तक पहुंचने पर logout से पहले पूछे — बिना पूछे logout जैसा महसूस न हो (v9.59)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    // goBack पहले activeCat को "घरेलू" पर रीसेट करके रुक जाता है (पहले श्रेणी पर लौटना पहला कदम है) —
    // यहां सीधे उस अवस्था पर पहुंचकर logout-confirm वाला अगला कदम जांचते हैं
    await page.evaluate(() => { activeCat = "घरेलू"; });
    const askedMsg = await page.evaluate(() => new Promise((resolve) => {
      var msg = null;
      window.confirm = function (m) { msg = m; return false; }; // 'नहीं' चुना
      document.getElementById('back-btn').click();
      setTimeout(() => resolve(msg), 200);
    }));
    expect(askedMsg).toContain('लॉगआउट');
    // 'नहीं' चुनने पर app-screen पर ही रहे
    expect(await page.evaluate(() => document.getElementById('app-screen').classList.contains('active'))).toBe(true);

    await page.evaluate(() => { window.confirm = function () { return true; }; }); // 'हां' चुना
    await page.click('#back-btn');
    await page.waitForFunction(() => document.getElementById('login-screen').classList.contains('active'), null, { timeout: 15000 });
  });
});

test.describe('बॉटम नेव auto-hide — लिस्ट scroll करते समय Profile/Support पट्टी छुपे, सिर्फ़ आखिर में दिखे', () => {
  test('स्क्रॉल के दौरान bnav-hidden लगे, बिल्कुल नीचे पहुंचने पर हट जाए, बीच में वापस जाने पर फिर लगे', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => {
      var list = document.getElementById('con-list');
      var html = '';
      for (var i = 0; i < 60; i++) {
        html += '<div class="con-card" style="height:80px;"><div class="cc-top"><div class="cc-name">टेस्ट उपभोक्ता ' + i + '</div></div></div>';
      }
      list.innerHTML = html;
    });
    // शुरुआत में सबसे ऊपर — bnav छुपी होनी चाहिए (आखिर तक नहीं पहुंचे)
    await page.evaluate(() => {
      var ms = document.querySelector('.main-scroll');
      ms.scrollTop = 0;
      ms.dispatchEvent(new Event('scroll'));
    });
    expect(await page.evaluate(() => document.querySelector('.bottom-nav').classList.contains('bnav-hidden'))).toBe(true);

    // बिल्कुल नीचे — bnav दिखनी चाहिए
    await page.evaluate(() => {
      var ms = document.querySelector('.main-scroll');
      ms.scrollTop = ms.scrollHeight;
      ms.dispatchEvent(new Event('scroll'));
    });
    expect(await page.evaluate(() => document.querySelector('.bottom-nav').classList.contains('bnav-hidden'))).toBe(false);

    // बीच में वापस — फिर छुप जाए
    await page.evaluate(() => {
      var ms = document.querySelector('.main-scroll');
      ms.scrollTop = 100;
      ms.dispatchEvent(new Event('scroll'));
    });
    expect(await page.evaluate(() => document.querySelector('.bottom-nav').classList.contains('bnav-hidden'))).toBe(true);
  });

  test('खाली लिस्ट में (scroll की ज़रूरत ही नहीं) bnav हमेशा दिखे', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    // _updateBnavVisibility अगले paint frame तक टलता है (देखें js/list.js) — उसका इंतज़ार करें
    await page.evaluate(() => new Promise((resolve) => {
      activeFilter = 'paid'; renderList(); // कोई paid record नहीं — खाली दिखेगा
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    expect(await page.evaluate(() => document.querySelector('.bottom-nav').classList.contains('bnav-hidden'))).toBe(false);
  });
});

test.describe('रोल-आधारित UI', () => {
  test('JE को dropdown में चारों tools दिखते हैं, lineman को नहीं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const jeVisible = await page.evaluate(() =>
      ['hsc-menu-item', 'cash-menu-item', 'log-menu-item', 'backup-menu-item', 'wasc-menu-item', 'usage-menu-item']
        .every((id) => document.getElementById(id).style.display !== 'none'));
    expect(jeVisible).toBe(true);
    await page.evaluate(() => doLogout(false));
    await loginLineman(page);
    const linHidden = await page.evaluate(() =>
      ['hsc-menu-item', 'cash-menu-item', 'log-menu-item', 'backup-menu-item', 'wasc-menu-item', 'mig-menu-item', 'usage-menu-item']
        .every((id) => document.getElementById(id).style.display === 'none'));
    expect(linHidden).toBe(true);
  });

  test('profile-मेनू के आइटम असली <button> हैं — कीबोर्ड/स्क्रीन-रीडर से भी इस्तेमाल हो सकें (accessibility)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const tags = await page.evaluate(() =>
      ['hsc-menu-item', 'wasc-menu-item', 'village-menu-item', 'cash-menu-item', 'backup-menu-item', 'log-menu-item', 'usage-menu-item', 'mig-menu-item', 'pin-menu-item']
        .map((id) => document.getElementById(id).tagName));
    expect(tags.every((t) => t === 'BUTTON')).toBe(true);
  });

  test('profile-मेनू का "स्कोरकार्ड डिस्प्ले" दबाने पर सही मॉडल खुले, गलती से नीचे का hq-tab न दब जाए (z-index bug)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const hqBefore = await page.evaluate(() => activeHQ);
    await page.click('.user-pill');
    await page.click('#wasc-menu-item');
    expect(await page.evaluate(() => document.getElementById('wasc-overlay').classList.contains('open'))).toBe(true);
    expect(await page.evaluate(() => activeHQ)).toBe(hqBefore); // नीचे का hq-tab गलती से न दब जाए
  });

  test('profile-मेनू का "होम पेज डिस्प्ले बोर्ड" दबाने पर सही मॉडल खुले, गलती से नीचे का hq-tab न दब जाए (z-index bug)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const hqBefore = await page.evaluate(() => activeHQ);
    await page.click('.user-pill');
    await page.click('#hsc-menu-item');
    expect(await page.evaluate(() => document.getElementById('hsc-overlay').classList.contains('open'))).toBe(true);
    expect(await page.evaluate(() => activeHQ)).toBe(hqBefore);
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
      openTodayScorecard(); results.push(document.getElementById('todaysc-overlay').classList.contains('open')); closeTodayScorecard();
      openMigModal(); results.push(document.getElementById('mig-overlay').classList.contains('open')); closeMigModal();
      return results;
    });
    expect(ok).toEqual([true, true, true, true, true, true, true, true]);
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

  test('स्कोरकार्ड — "कुल उपभोक्ता" में न हो ऐसे paid acc को न गिने (ग्राम-वार वसूली से मेल के लिए)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const row = await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '1', addr: 'रामपुर', status: 'pending', amount: 100 },
      ]);
      // acc '99' किसी और श्रेणी में paid है पर "कुल उपभोक्ता" (मास्टर) में मौजूद ही नहीं — असली उपभोक्ता नहीं
      cSet('आदेगांव', 'घरेलू', [
        { acc: '99', status: 'paid', amount: 200 },
      ]);
      return _waScRow('आदेगांव');
    });
    expect(row.tot).toBe(1);
    expect(row.paid).toBe(0); // acc '99' नहीं गिना जाना चाहिए — मास्टर सूची में नहीं है
  });

  test('दिनांक-वार वसूली (buildScOverview) — "कुल उपभोक्ता" में न हो ऐसे paid acc को न गिने', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const txt = await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '1', addr: 'रामपुर', status: 'pending', amount: 100 },
      ]);
      cSet('आदेगांव', 'घरेलू', [
        { acc: '99', status: 'paid', amount: 200 },
      ]);
      buildScOverview(['आदेगांव']);
      return document.getElementById('sc-overview').textContent;
    });
    expect(txt).toContain('1कुल उपभोक्ता');
    expect(txt).toContain('0✅ वसूल');
  });

  test('दिनांक-वार वसूली (renderScDateTable) — "कुल उपभोक्ता" में न हो ऐसे paid acc को न गिने', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const txt = await page.evaluate(() => {
      scActiveHQ = 'आदेगांव';
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '1', addr: 'रामपुर', status: 'pending', amount: 100 },
      ]);
      cSet('आदेगांव', 'घरेलू', [
        { acc: '99', status: 'paid', amount: 200, paydate: '1/1/2026' },
      ]);
      renderScDateTable(cGet('आदेगांव', 'घरेलू'));
      return document.getElementById('sc-body').textContent;
    });
    expect(txt).toContain('कोई वसूली नहीं'); // acc '99' मास्टर सूची में नहीं — कोई paid record नहीं बचना चाहिए
  });

  // तालिका में "उपभोक्ता"/"Consumer No" दो बार कटते हैं (पहले सिर्फ़ 3, फिर max-width+ellipsis) —
  // असली रिपोर्ट में एक दिन में 86 उपभोक्ता थे, JE उनमें से 3 भी पूरे नहीं देख पाते थे
  test('तारीख़ पर टैप → उस दिन के सारे उपभोक्ता और पूरे Consumer No दिखें (एक भी न छूटे)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      scActiveHQ = 'आदेगांव';
      var master = [];
      for (var i = 0; i < 40; i++) master.push({ acc: '11340' + (10000 + i), name: 'उपभोक्ता ' + i, status: 'paid', amount: 100, paydate: '31/8/2026' });
      master.push({ acc: '9999', name: 'अकेला', status: 'paid', amount: 50, paydate: '1/9/2026' });
      cSet('आदेगांव', 'कुल उपभोक्ता', master);
      renderScDateTable(cGet('आदेगांव', 'कुल उपभोक्ता'));
      var rows = document.querySelectorAll('#sc-body tr.sc-day-row');
      openScDayModal(SC_DAY_DATES.indexOf('31/8/2026'));
      var el = document.getElementById('scday-content');
      var txt = el.textContent;
      var chips = el.querySelectorAll('.chip-acc').length;
      var open = document.getElementById('scday-overlay').classList.contains('open');
      closeScDayModal();
      return { clickable: rows.length, chips: chips, open: open, txt: txt,
        title: document.getElementById('scday-title').textContent,
        sub: document.getElementById('scday-sub').textContent,
        closed: !document.getElementById('scday-overlay').classList.contains('open') };
    });
    expect(r.clickable).toBe(2);            // दोनों तारीख़ें दबाने लायक
    expect(r.open).toBe(true);
    expect(r.chips).toBe(40);               // सारे 40 — कोई "+37" नहीं
    expect(r.txt).toContain('1134010000');  // पहला पूरा नंबर
    expect(r.txt).toContain('1134010039');  // आख़िरी भी पूरा
    expect(r.txt).toContain('उपभोक्ता 39');
    expect(r.title).toContain('31/8/2026');
    expect(r.sub).toContain('40 उपभोक्ता');
    expect(r.closed).toBe(true);
  });

  test('सूची में नाम/नंबर टेक्स्ट ही रहें — HTML हो तो भी markup न बने', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      scActiveHQ = 'आदेगांव';
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: "5'><img src=x onerror=alert(1)>", name: '<img src=y onerror=alert(2)>', status: 'paid', amount: 10, paydate: '2/9/2026' },
      ]);
      renderScDateTable(cGet('आदेगांव', 'कुल उपभोक्ता'));
      openScDayModal(0);
      var el = document.getElementById('scday-content');
      var out = { imgs: el.querySelectorAll('img').length, txt: el.textContent };
      closeScDayModal();
      return out;
    });
    expect(r.imgs).toBe(0);
    expect(r.txt).toContain('<img src=y onerror=alert(2)>'); // सादे टेक्स्ट की तरह दिखा
  });

  test('जिस record में Consumer No न हो वह भी सूची में दिखे (चुपचाप गायब न हो)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      scActiveHQ = 'आदेगांव';
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '7001', name: 'नंबर वाला', status: 'paid', amount: 10, paydate: '3/9/2026' },
        { name: 'बिना नंबर वाला', status: 'paid', amount: 20, paydate: '3/9/2026' },
      ]);
      renderScDateTable(cGet('आदेगांव', 'कुल उपभोक्ता'));
      openScDayModal(0);
      var el = document.getElementById('scday-content');
      var out = { txt: el.textContent, chips: el.querySelectorAll('.chip-acc').length,
        rows: el.querySelectorAll('tbody tr').length };
      closeScDayModal();
      return out;
    });
    expect(r.rows).toBe(2);                       // दोनों दिखे
    expect(r.txt).toContain('बिना नंबर वाला');
    expect(r.chips).toBe(1);                      // सिर्फ़ एक के पास नंबर है
    expect(r.txt).toContain('कॉपी करें (1)');      // कॉपी बटन सिर्फ़ असली नंबरों की गिनती दिखाए
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

  test('markPaid — record का ts डिवाइस के कच्चे Date.now() की बजाय सुधरे हुए serverNow() से बने (bug: डिवाइस की ग़लत घड़ी से overlayOps/reconcileHQ जैसी ts-आधारित conflict-resolution ग़लत फ़ैसला ले सकती थी)', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [{ acc: '999', name: 'टेस्ट', status: 'pending', amount: 100 }]);
      // जैसे डिवाइस की घड़ी 30 दिन पीछे हो, पर server-offset सीखा जा चुका हो
      _serverTimeOffset = 30 * 24 * 60 * 60 * 1000;
    });
    await loginLineman(page);
    await page.waitForFunction(() => document.querySelectorAll('.con-card').length > 0, null, { timeout: 15000 });
    const r = await page.evaluate(() => {
      var before = Date.now();
      markPaid(0);
      var ts = cGet('आदेगांव', 'कुल उपभोक्ता')[0].ts;
      return { ts: ts, before: before };
    });
    expect(r.ts - r.before).toBeGreaterThan(29 * 24 * 60 * 60 * 1000); // offset लागू हुआ, कच्चा Date.now() नहीं
  });

  // JE का कहा: "जब कोई वसूल मार्क करे तो 🎉 इस तरह का कुछ सेलिब्रेशन आ सकता है क्या, बहुत शानदार
  // <नाम>, लेकिन कॉस्ट नहीं बढ़नी चाहिए" — इसीलिए यह पूरी तरह device के अंदर है
  test('वसूल मार्क करने पर जश्न दिखे — कर्मचारी का नाम और रकम के साथ, और एक भी network call न हो', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [{ acc: '777', name: 'राम कुमार', status: 'pending', amount: 4500 }]);
    });
    await loginLineman(page, 'सोहन यादव');
    await page.waitForFunction(() => document.querySelectorAll('.con-card').length > 0, null, { timeout: 15000 });
    const r = await page.evaluate(() => {
      var calls = 0;
      var orig = window.fetch;
      window.fetch = function (u, o) { if (String(u).indexOf(FB) === 0) calls++; return orig(u, o); };
      // असली record की तरह पूरा object — यहीं पकड़ में आया था कि code ग़लत field (amt) पढ़ रहा था
      _celebPaid(cGet('आदेगांव', 'कुल उपभोक्ता')[0]);
      window.fetch = orig;
      var el = document.getElementById('celeb');
      return {
        shown: !!el,
        text: el ? el.textContent : '',
        bits: el ? el.querySelectorAll('.celeb-bit').length : 0,
        clickThrough: el ? getComputedStyle(el).pointerEvents : '',
        calls: calls,
      };
    });
    expect(r.shown).toBe(true);
    expect(r.text).toContain('सोहन यादव');
    expect(r.text).toContain('4,500');
    expect(r.bits).toBeGreaterThan(0);
    expect(r.clickThrough).toBe('none'); // जश्न अगला "✓ वसूल" दबाने से न रोके
    expect(r.calls).toBe(0);             // एक भी Firebase call नहीं — कॉस्ट शून्य
  });

  test('जश्न अपने आप हट जाए, और नाम/रकम में HTML हो तो भी टेक्स्ट ही रहे (कभी markup न बने)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page, '<img src=x onerror=alert(1)>');
    const r = await page.evaluate(() => new Promise((resolve) => {
      CELEB_MS = 60; // टेस्ट में तेज़
      _celebPaid({ amount: 100 });
      var el = document.getElementById('celeb');
      // मैस्कॉट अपने आप में एक जायज़ <img> है — यहां सिर्फ़ यह देखना है कि *नाम* से
      // कोई नया img न बना हो
      var hasImg = el.querySelectorAll('img:not(.celeb-mascot)').length > 0;
      var txt = el.textContent;
      setTimeout(() => resolve({ hasImg: hasImg, txt: txt, gone: !document.getElementById('celeb') }), 700);
    }));
    expect(r.hasImg).toBe(false);           // नाम कभी असली HTML बनकर न जाए (मैस्कॉट वाला img अलग है)
    expect(r.txt).toContain('<img src=x');  // सिर्फ़ दिखने वाला टेक्स्ट
    expect(r.gone).toBe(true);              // अपने आप हट गया
  });

  // JE ने बताया: "सेलिब्रेशन बहुत कम समय के लिए दिखाई देता है, समझ ही नहीं आ पाता"। 1700ms में
  // पलक झपकते ही चला जाता था — यह test उसे चुपचाप दोबारा छोटा होने से रोकता है
  test('जश्न इतनी देर टिके कि दिख जाए (कम से कम 3 सेकंड)', async ({ page }) => {
    await openApp(page);
    const ms = await page.evaluate(() => CELEB_MS);
    expect(ms).toBeGreaterThanOrEqual(3000);
  });

  test('जश्न में अंगूठा, ताली और मैस्कॉट तीनों दिखें', async ({ page }) => {
    await openApp(page);
    await loginLineman(page, 'सुनील');
    const r = await page.evaluate(() => {
      _celebPaid({ amount: 500 });
      var el = document.getElementById('celeb');
      var out = {
        thumb: el.querySelectorAll('.celeb-thumb').length,
        thumbTxt: (el.querySelector('.celeb-thumb') || {}).textContent,
        claps: el.querySelectorAll('.celeb-clap').length,
        clapTxt: (el.querySelector('.celeb-clap') || {}).textContent,
        mascot: el.querySelectorAll('.celeb-mascot').length
      };
      el.parentNode.removeChild(el);
      return out;
    });
    expect(r.thumb).toBe(1);
    expect(r.thumbTxt).toBe('👍');
    expect(r.claps).toBe(2);      // दोनों हाथ
    expect(r.clapTxt).toBe('👏');
    expect(r.mascot).toBe(1);
  });

  // JE ने बनी हुई तालियाँ सुनकर कहा "तालियां सही नहीं आ रही हैं" और असली रिकॉर्डिंग भेजीं
  test('असली आवाज़ें तैयार हों तो वही बजें — तालियाँ, और दोनों "वाओ" में से कोई एक', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      var played = [], synth = 0;
      var oPlay = window._sndPlay, oBed = window._applauseBed, oCheer = window._cheerAt, oClap = window._clapAt;
      window._sndPlay = function (k) { played.push(k); return true; };  // सब तैयार हैं
      window._applauseBed = function () { synth++; };
      window._cheerAt = function () { synth++; };
      window._clapAt = function () { synth++; };
      var wows = {};
      try {
        for (var i = 0; i < 30; i++) { played = []; _celebSound(false); played.forEach((k) => { if (k !== 'clap') wows[k] = 1; }); }
        played = []; _celebSound(false);
      } finally {
        window._sndPlay = oPlay; window._applauseBed = oBed; window._cheerAt = oCheer; window._clapAt = oClap;
      }
      return { first: played[0], count: played.length, wowKinds: Object.keys(wows).sort(), synth: synth };
    });
    expect(r.first).toBe('clap');                        // तालियाँ सबसे पहले
    expect(r.count).toBe(2);                             // तालियाँ + एक "वाओ" (दूसरा नहीं)
    expect(r.wowKinds).toEqual(['wow1', 'wow2']);        // दोनों आवाज़ें बारी-बारी आती हैं
    expect(r.synth).toBe(0);                             // असली मिल गईं तो बनी हुई बिल्कुल न बजे
  });

  test('असली आवाज़ न उतरी हो तो बनी हुई आवाज़ पर लौट जाए (offline पहली बार)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      var bed = 0, cheer = 0;
      var oPlay = window._sndPlay, oBed = window._applauseBed, oCheer = window._cheerAt, oClap = window._clapAt;
      window._sndPlay = function () { return false; };   // कोई फ़ाइल तैयार नहीं
      window._applauseBed = function () { bed++; };
      window._cheerAt = function () { cheer++; };
      window._clapAt = function () {};
      try { _celebSound(false); } finally {
        window._sndPlay = oPlay; window._applauseBed = oBed; window._cheerAt = oCheer; window._clapAt = oClap;
      }
      return { bed: bed, cheer: cheer };
    });
    expect(r.bed).toBe(1);    // बनी हुई गड़गड़ाहट
    expect(r.cheer).toBe(1);  // बनी हुई चीयर
  });

  test('आवाज़ बंद हो तो असली फ़ाइलें उतरें ही नहीं (एक बाइट भी खर्च न हो)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      var hits = 0;
      var oLoad = window._sndLoad, oOn = window.celebSoundOn;
      window._sndLoad = function () { hits++; };
      window.celebSoundOn = function () { return false; };
      try { _sndWarm(); } finally { window._sndLoad = oLoad; window.celebSoundOn = oOn; }
      return hits;
    });
    expect(r).toBe(0);
  });

  test('तीनों आवाज़ फ़ाइलें मौजूद हों, छोटी हों, और service worker उन्हें cache करे', async () => {
    const root = path.join(__dirname, '..');
    let total = 0;
    ['clap.mp3', 'wow1.mp3', 'wow2.mp3'].forEach((n) => {
      const st = fs.statSync(path.join(root, 'sounds', n));
      expect(st.size).toBeGreaterThan(1000);
      total += st.size;
    });
    // JE की दी हुई मूल फ़ाइलें 1.88 MB की थीं — काटकर/mono करके इतनी छोटी की गईं
    expect(total).toBeLessThan(120 * 1024);
    const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
    ['clap', 'wow1', 'wow2'].forEach((n) => expect(sw).toContain('./sounds/' + n + '.mp3'));
    // CORE में नहीं — इनके बिना भी ऐप पूरा चलता है (बनी हुई आवाज़ पर लौट जाता है)
    const core = sw.slice(sw.indexOf('var CORE='), sw.indexOf('var OPTIONAL='));
    expect(core).not.toContain('sounds/');
  });

  // "जो साउंड आता है उसमें तालियों की गड़गड़ाहट सुनाई ही नहीं देती … wow का साउंड भी आना चाहिए"
  test('आवाज़ में भीड़ की गड़गड़ाहट और "वाओ" चीयर दोनों बनें, अलग-अलग तालियों के साथ', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      var bed = 0, cheer = 0, claps = 0, bedDur = 0, cheerDur = 0;
      var oBed = window._applauseBed, oCheer = window._cheerAt, oClap = window._clapAt, oPlay = window._sndPlay;
      window._sndPlay = function () { return false; }; // असली फ़ाइलें हटाकर बनी हुई आवाज़ ही जाँचें
      window._applauseBed = function (c, t, d) { bed++; bedDur = d; };
      window._cheerAt = function (c, t, d) { cheer++; cheerDur = d; };
      window._clapAt = function () { claps++; };
      try { _celebSound(false); } finally {
        window._applauseBed = oBed; window._cheerAt = oCheer; window._clapAt = oClap; window._sndPlay = oPlay;
      }
      return { bed: bed, cheer: cheer, claps: claps, bedDur: bedDur, cheerDur: cheerDur };
    });
    expect(r.bed).toBe(1);                       // गड़गड़ाहट का बिछावन
    expect(r.cheer).toBe(1);                     // "वाआआओ"
    expect(r.claps).toBeGreaterThanOrEqual(8);   // पहले सिर्फ़ 4 थीं — गड़गड़ाहट लगती ही नहीं थी
    expect(r.bedDur).toBeGreaterThanOrEqual(2);  // पूरे जश्न भर चले, आधे सेकंड में ख़त्म न हो
    expect(r.cheerDur).toBeGreaterThan(1);
  });

  test('आवाज़ बंद हो तो कुछ न बजे (JE का switch)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      var hits = 0;
      var oBed = window._applauseBed, oCheer = window._cheerAt, oClap = window._clapAt, oOn = window.celebSoundOn, oPlay = window._sndPlay;
      window._applauseBed = function () { hits++; };
      window._cheerAt = function () { hits++; };
      window._clapAt = function () { hits++; };
      window._sndPlay = function () { hits++; return true; }; // असली आवाज़ भी न बजे
      window.celebSoundOn = function () { return false; };
      try { _celebSound(false); } finally {
        window._applauseBed = oBed; window._cheerAt = oCheer; window._clapAt = oClap; window.celebSoundOn = oOn; window._sndPlay = oPlay;
      }
      return hits;
    });
    expect(r).toBe(0);
  });

  // JE की चिंता: "यदि कोई जानबूझकर बार-बार वसूल मार्क करे और फिर वापस करके फिर वसूल मार्क करे तो
  // एक्युमुलेटेड नेटवर्क कॉस्ट बहुत ज़्यादा हो जाएगी"। जश्न खुद एक बाइट खर्च नहीं करता, पर वह
  // टॉगल करने का लालच पैदा करता है — और हर मार्क Firebase पर लिखा जाकर बाक़ी फ़ोनों पर push होता है
  test('एक ही उपभोक्ता पर दिन में एक ही बार जश्न — वापस करके दोबारा मार्क करने पर नहीं', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '900', name: 'राम', status: 'pending', amount: 500 },
        { acc: '901', name: 'श्याम', status: 'pending', amount: 700 },
      ]);
    });
    await loginLineman(page, 'सोहन');
    await page.waitForFunction(() => document.querySelectorAll('.con-card').length > 0, null, { timeout: 15000 });
    const r = await page.evaluate(() => {
      localStorage.removeItem(CELEB_DONE_KEY);
      window.confirm = () => true;
      var shown = function () { var el = document.getElementById('celeb'); if (el) el.remove(); return !!el; };
      markPaid(0, '900');   var first = shown();
      markUnpaid(0, '900'); markPaid(0, '900'); var again = shown();  // वही उपभोक्ता — दोबारा नहीं
      markPaid(1, '901');   var other = shown();                     // दूसरा उपभोक्ता — दिखे
      return { first: first, again: again, other: other };
    });
    expect(r.first).toBe(true);
    expect(r.again).toBe(false); // टॉगल करने से कुछ नया नहीं मिलता — लालच ख़त्म
    expect(r.other).toBe(true);  // असली नई वसूली पर पूरा जश्न
  });

  test('एक ही उपभोक्ता को हद से ज़्यादा बार वसूल मार्क करने पर JE के लॉग में एक बार चेतावनी जाए (रोके नहीं)', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [{ acc: '950', name: 'बार-बार', status: 'pending', amount: 300 }]);
    });
    await loginLineman(page, 'सोहन');
    await page.waitForFunction(() => document.querySelectorAll('.con-card').length > 0, null, { timeout: 15000 });
    const r = await page.evaluate(() => {
      localStorage.removeItem(CELEB_DONE_KEY);
      window.confirm = () => true;
      var logged = [];
      var orig = window.logErr;
      window.logErr = function (t, m, c) { logged.push({ t: t, m: String(m) }); return orig(t, m, c); };
      var atCount = [];
      for (var i = 0; i < 6; i++) {              // 6 बार वसूल मार्क (बीच में वापस करके)
        if (i) markUnpaid(0, '950');
        markPaid(0, '950');
        atCount.push(logged.length);
      }
      var stillPaid = cGet('आदेगांव', 'कुल उपभोक्ता')[0].status;
      window.logErr = orig;
      return { warns: logged.filter(function (x) { return x.t === 'repeat-mark'; }), atCount: atCount, stillPaid: stillPaid, threshold: TOGGLE_WARN_AT };
    });
    expect(r.warns.length).toBe(1);                       // दिन में एक ही बार लॉग, हर बार नहीं
    expect(r.warns[0].m).toContain('बार-बार');            // उपभोक्ता का नाम लॉग में हो
    expect(r.warns[0].m).toContain('950');                // और क्रमांक भी
    expect(r.atCount[r.threshold - 1]).toBe(1);           // ठीक तय गिनती पर ही चेतावनी
    expect(r.stillPaid).toBe('paid');                     // काम रोका नहीं गया
  });

  test('_celebFirstTimeToday — दिन बदलने पर हिसाब फिर से शुरू हो, और सूची बढ़ती न जाए', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      localStorage.removeItem(CELEB_DONE_KEY);
      var a = _celebFirstTimeToday('55');
      var b = _celebFirstTimeToday('55');
      // जैसे कल का बचा हुआ हिसाब पड़ा हो
      localStorage.setItem(CELEB_DONE_KEY, JSON.stringify({ d: '1/1/2020', a: { '55': 1, '66': 1 } }));
      var newDay = _celebFirstTimeToday('55');
      var stored = JSON.parse(localStorage.getItem(CELEB_DONE_KEY));
      // acc ही न हो तो जश्न रोका न जाए
      var noAcc = _celebFirstTimeToday('');
      return { a: a, b: b, newDay: newDay, keys: Object.keys(stored.a), noAcc: noAcc };
    });
    expect(r.a).toBe(true);
    expect(r.b).toBe(false);
    expect(r.newDay).toBe(true);        // नया दिन — फिर से जश्न
    expect(r.keys).toEqual(['55']);     // कल का हिसाब हटा, सूची बढ़ती नहीं
    expect(r.noAcc).toBe(true);
  });

  test('जश्न में मैस्कॉट और ताली दिखे, और मैस्कॉट लोड न हो पाए तो चुपचाप छुप जाए (जश्न फिर भी पूरा)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page, 'सोहन');
    const r = await page.evaluate(() => {
      _celebPaid({ amount: 500 });
      var el = document.getElementById('celeb');
      var img = el.querySelector('.celeb-mascot');
      var claps = el.querySelectorAll('.celeb-clap').length;
      img.onerror(); // जैसे पुराने फ़ोन पर WebP न चले
      return { hasImg: !!img, src: img.getAttribute('src'), claps: claps, hiddenOnError: img.style.display, text: el.textContent };
    });
    expect(r.hasImg).toBe(true);
    expect(r.src).toBe('icons/mascot.webp');
    expect(r.claps).toBe(2);                 // दोनों तरफ़ ताली
    expect(r.hiddenOnError).toBe('none');    // न चले तो छुप जाए
    expect(r.text).toContain('सोहन');        // बाक़ी जश्न फिर भी पूरा
  });

  test('वसूली की आवाज़ — डिफ़ॉल्ट चालू, बंद करने पर कोई ध्वनि न बने, और याद रहे', async ({ page }) => {
    await openApp(page);
    await loginLineman(page, 'सोहन');
    const r = await page.evaluate(() => {
      var made = 0;
      var realCtx = window.AudioContext;
      // असली आवाज़ न बजे, सिर्फ़ यह जांचें कि बनाने की कोशिश हुई या नहीं
      window.AudioContext = function () {
        made++;
        // असली Web Audio जितना ही सतह-क्षेत्र — गड़गड़ाहट/चीयर वाला कोड buffer में सचमुच लिखता है
        // और filter की frequency को समय के साथ घुमाता है, इसलिए इनका होना ज़रूरी है
        return { currentTime: 0, sampleRate: 44100, state: 'running', destination: {},
          createBuffer: (chs, len) => ({ getChannelData: () => new Float32Array(len || 10) }),
          createBufferSource: () => ({ connect() {}, start() {}, stop() {} }),
          createBiquadFilter: () => ({ connect() {}, type: '',
            frequency: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} }, Q: {} }),
          createGain: () => ({ connect() {}, gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } }),
          createOscillator: () => ({ connect() {}, start() {}, stop() {}, frequency: {} }) };
      };
      window.webkitAudioContext = window.AudioContext;
      var onByDefault = celebSoundOn();
      _ac = null; _celebSound(false);
      var whenOn = made;
      toggleCelebSound();                 // बंद करो
      var offNow = celebSoundOn();
      var stored = localStorage.getItem('dc_celebsound');
      made = 0; _ac = null; _celebSound(false);
      var whenOff = made;
      window.AudioContext = realCtx;
      return { onByDefault: onByDefault, whenOn: whenOn, offNow: offNow, stored: stored, whenOff: whenOff };
    });
    expect(r.onByDefault).toBe(true); // बिना कुछ किए आवाज़ चालू
    expect(r.whenOn).toBe(1);
    expect(r.offNow).toBe(false);
    expect(r.stored).toBe('0');       // localStorage में याद रहे
    expect(r.whenOff).toBe(0);        // बंद है तो कुछ बने ही नहीं
  });

  test('आवाज़ का बटन प्रोफ़ाइल में हो और मौजूदा सेटिंग दिखाए', async ({ page }) => {
    await openApp(page);
    await loginLineman(page, 'सोहन');
    const r = await page.evaluate(() => {
      localStorage.setItem('dc_celebsound', '0');
      openProfileModal();
      var off = document.getElementById('sound-switch-btn').className;
      localStorage.setItem('dc_celebsound', '1');
      _syncSoundSwitch();
      var on = document.getElementById('sound-switch-btn').className;
      closeProfileModal();
      return { off: off, on: on };
    });
    expect(r.off).not.toContain('on');
    expect(r.on).toContain('on');
  });

  test('_celebTodayCount — आज की अपनी वसूली गिने: एक ही उपभोक्ता कई श्रेणियों में हो तो एक बार, दूसरे कर्मचारी की न गिने, पुरानी तारीख़ की न गिने', async ({ page }) => {
    await openApp(page);
    await loginLineman(page, 'Sohan Yadav');
    const n = await page.evaluate(() => {
      var today = new Date().toLocaleDateString('hi-IN');
      var kal = new Date(Date.now() - 86400000).toLocaleDateString('hi-IN');
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: 'A', status: 'paid', paydate: today, updatedBy: 'Sohan Yadav' },
        { acc: 'B', status: 'paid', paydate: today, updatedBy: 'SOHAN YADAV' }, // वही व्यक्ति, अलग वर्तनी
        { acc: 'C', status: 'paid', paydate: today, updatedBy: 'कोई और' },      // दूसरा कर्मचारी
        { acc: 'D', status: 'paid', paydate: kal, updatedBy: 'Sohan Yadav' },   // कल की
        { acc: 'E', status: 'pending', paydate: '', updatedBy: 'Sohan Yadav' },
      ]);
      cSet('आदेगांव', 'घरेलू', [
        { acc: 'A', status: 'paid', paydate: today, updatedBy: 'sohan yadav' }, // वही A — दोबारा न गिने
      ]);
      return _celebTodayCount('आदेगांव');
    });
    expect(n).toBe(2); // सिर्फ़ A और B
  });

  test('रिमार्क मोडल खुला रहते हुए लिस्ट का क्रम बदल जाए (background sync) — फिर भी सही record में सेव हो, acc से मिलान करके', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '111222', name: 'राम कुमार', status: 'pending', amount: 500 },
        { acc: '333444', name: 'श्याम लाल', status: 'pending', amount: 700 },
      ]);
    });
    await loginLineman(page);
    await expect(page.locator('.con-card').first()).toContainText('राम कुमार', { timeout: 15000 });
    // राम कुमार (idx 0, acc 111222) का रिमार्क मोडल खोलें
    await page.evaluate(() => openRmkModal(0, '111222'));
    await expect(page.locator('#rmk-name')).toHaveText('राम कुमार');
    // मोडल खुला रहते हुए — background sync ने क्रम पलट दिया, अब idx 0 पर श्याम लाल है
    await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '333444', name: 'श्याम लाल', status: 'pending', amount: 700 },
        { acc: '111222', name: 'राम कुमार', status: 'pending', amount: 500 },
      ]);
    });
    await page.fill('#rmk-text', 'टेस्ट रिमार्क');
    await page.evaluate(() => saveRmk());
    await page.waitForTimeout(300);
    const data = await page.evaluate(() => cGet('आदेगांव', 'कुल उपभोक्ता'));
    const ram = data.find((x) => x.acc === '111222');
    const shyam = data.find((x) => x.acc === '333444');
    expect(ram.remarksArr && ram.remarksArr[0].text).toBe('टेस्ट रिमार्क'); // सही व्यक्ति (राम) पर लगा
    expect(shyam.remarksArr).toBeFalsy(); // गलती से श्याम पर नहीं लगा
  });

  test('रिमार्क मोडल खुला रहते हुए वह record ही हट जाए — चुपचाप fail न हो, साफ़ error दिखे', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '111222', name: 'राम कुमार', status: 'pending', amount: 500 },
      ]);
    });
    await loginLineman(page);
    await expect(page.locator('.con-card').first()).toContainText('राम कुमार', { timeout: 15000 });
    await page.evaluate(() => openRmkModal(0, '111222'));
    // background sync ने वह record ही हटा दिया (जैसे JE ने लिस्ट दोबारा अपलोड कर दी हो)
    await page.evaluate(() => { cSet('आदेगांव', 'कुल उपभोक्ता', []); });
    await page.fill('#rmk-text', 'टेस्ट रिमार्क');
    await page.evaluate(() => saveRmk());
    await page.waitForTimeout(300);
    await expect(page.locator('#toast')).toContainText('अब सूची में नहीं मिला');
  });

  test('रिमार्क सेव migrated (per-record) HQ पर वाकई Firebase को PATCH भेजे — सिर्फ़ local cache में दिखकर न रह जाए (prev/arr reference-aliasing bug)', async ({ page }) => {
    // असली production bug: cGet() जो array लौटाता है वही object cSet() में वापस स्टोर होता है, तो
    // fbSet() के अंदर पुराना cGet()-आधारित prev capture हमेशा नई (already-mutated) value ही देखता था —
    // यानी prev === arr, और _diffToPatch को कभी कोई फ़र्क़ नहीं दिखता — patch हमेशा खाली, PATCH भेजा
    // ही नहीं जाता। रिमार्क सिर्फ़ local cache/localStorage में दिखता, अगली असली server sync में गायब
    // हो जाता — user को लगता "सेव हुआ" पर असल में कभी Firebase तक पहुंचा ही नहीं।
    await openApp(page);
    await page.evaluate(() => {
      MIGRATED[hqKey('आदेगांव')] = {};
      MIGRATED[hqKey('आदेगांव')][catKey('कुल उपभोक्ता')] = true;
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '555666', name: 'गीता देवी', status: 'pending', amount: 300, o: 0 },
      ]);
    });
    await loginLineman(page);
    await expect(page.locator('.con-card').first()).toContainText('गीता देवी', { timeout: 15000 });
    const sentBody = await page.evaluate(() => new Promise((resolve) => {
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('आदेगांव/कुल_उपभोक्ता') > -1 && opts && opts.method === 'PATCH') {
          resolve(JSON.parse(opts.body));
        }
        return orig(url, opts);
      };
      openRmkModal(0, '555666');
      document.getElementById('rmk-text').value = 'बकाया माफ़ी की मांग';
      saveRmk();
      setTimeout(() => resolve(null), 5500);
    }));
    expect(sentBody).toBeTruthy(); // PATCH भेजा ही नहीं गया तो यहीं fail होगा
    expect(sentBody['555666']).toBeTruthy();
    expect(sentBody['555666'].remarksArr[0].text).toBe('बकाया माफ़ी की मांग');
  });

  test('कैश लिस्ट: नया-पुराना timestamp नियम (बोर्ड टकराव)', async ({ page }) => {
    await openApp(page);
    await loginJE(page); // असली publish (PUT) सिर्फ़ JE कर सकता है — _hscRetryPublish अब यह जांचता है
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

  test('openVillageModal — खोलते ही network fetch न हो, सिर्फ़ cache से दिखे (bug: हर बार खोलने/tab बदलने पर सभी HQ की पूरी लिस्ट दोबारा डाउनलोड होना)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const fetchCount = await page.evaluate(() => new Promise((resolve) => {
      var count = 0;
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('.json') > -1 && (!opts || !opts.method)) count++;
        return orig(url, opts);
      };
      openVillageModal();
      setTimeout(() => { window.fetch = orig; resolve(count); }, 300);
    }));
    expect(fetchCount).toBe(0);
  });

  test('_vgRefresh (रिफ्रेश बटन) — force=true के साथ _cashRefreshAll बुलाए, cooldown नज़रअंदाज़ करके', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const forced = await page.evaluate(() => new Promise((resolve) => {
      var seenForce = null;
      const orig = _cashRefreshAll;
      _cashRefreshAll = function (hqs, cb, force) { seenForce = force; cb(); };
      _vgRefresh();
      setTimeout(() => { _cashRefreshAll = orig; resolve(seenForce); }, 100);
    }));
    expect(forced).toBe(true);
  });

  test('_vgRefresh — रोज़ 3 बार के बाद 4थी बार रुक जाए, साफ़ चेतावनी दिखे, कोई network fetch न हो', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      vgActiveHQ = 'आदेगांव';
      var fetchCalls = 0;
      const orig = _cashRefreshAll;
      _cashRefreshAll = function (hqs, cb) { fetchCalls++; cb(); };
      _vgRefresh(); _vgRefresh(); _vgRefresh(); // 3 बार — सभी allowed
      var after3 = fetchCalls;
      _vgRefresh(); // चौथी बार — रुक जानी चाहिए
      setTimeout(() => {
        _cashRefreshAll = orig;
        resolve({ after3: after3, after4: fetchCalls, toastText: document.getElementById('toast').textContent });
      }, 100);
    }));
    expect(r.after3).toBe(3);
    expect(r.after4).toBe(3); // चौथी बार पर कोई नया fetch नहीं हुआ
    expect(r.toastText).toContain('सीमा');
  });

  test('downloadVillageExcel — रोज़ की सीमा पार होने पर Excel भी न बने, चेतावनी दिखे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      vgActiveHQ = 'आदेगांव';
      localStorage.setItem('dc_vglimit3', JSON.stringify({ date: new Date().toISOString().slice(0, 10), counts: { 'आदेगांव': 3 } }));
      var called = false;
      const orig = _cashRefreshAll;
      _cashRefreshAll = function () { called = true; };
      downloadVillageExcel();
      setTimeout(() => {
        _cashRefreshAll = orig;
        resolve({ called: called, toastText: document.getElementById('toast').textContent });
      }, 100);
    }));
    expect(r.called).toBe(false);
    expect(r.toastText).toContain('सीमा');
  });

  test('_vgLimitState — तारीख़ बदलते ही गिनती अपने-आप रीसेट हो जाए', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const count = await page.evaluate(() => {
      localStorage.setItem('dc_vglimit3', JSON.stringify({ date: '2020-01-01', counts: { 'आदेगांव': 3 } })); // पुरानी तारीख़
      return _vgLimitCount('आदेगांव');
    });
    expect(count).toBe(0);
  });

  test('_vgLoadAndRender अब सभी 8 श्रेणियां ताज़ा करता है (स्कोरकार्ड जैसा) — सिर्फ मास्टर category नहीं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => { vgActiveHQ = 'आदेगांव'; });
    const jeHqs = await page.evaluate(() => new Promise((resolve) => {
      window._cashRefreshAll = function (hqs, cb) { resolve(hqs.slice()); cb(); };
      _vgLoadAndRender();
    }));
    expect(jeHqs.length).toBe(6); // JE — सभी HQ की सभी श्रेणियां ताज़ा हों (जैसा downloadVillageExcel में पहले से है)
    expect(jeHqs).toContain('आदेगांव');

    await page.evaluate(() => doLogout(false));
    await loginLineman(page);
    const linHqs = await page.evaluate(() => new Promise((resolve) => {
      window._cashRefreshAll = function (hqs, cb) { resolve(hqs.slice()); cb(); };
      vgActiveHQ = CU.hq;
      _vgLoadAndRender();
    }));
    expect(linHqs).toEqual([await page.evaluate(() => CU.hq)]); // lineman — सिर्फ अपना HQ
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

  test('किसी भी श्रेणी में paid mark हो तो ग्राम-वार वसूली में भी वसूल गिना जाए (स्कोरकार्ड जैसा)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => {
      // मास्टर "कुल उपभोक्ता" में यह उपभोक्ता अभी भी pending दिखा रहा है...
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '501', addr: 'टेस्टपुर', status: 'pending', amount: 300 },
      ]);
      // ...लेकिन "घरेलू" श्रेणी में उसे वसूल mark कर दिया गया है
      cSet('आदेगांव', 'घरेलू', [
        { acc: '501', addr: 'टेस्टपुर', status: 'paid', amount: 300 },
      ]);
    });
    const row = await page.evaluate(() => _vgComputeRows('आदेगांव')[0]);
    expect(row.tot).toBe(1);
    expect(row.paid).toBe(1);
    expect(row.bakaya).toBe(0);
    expect(row.paidAmt).toBe(300);
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

  test('बीबी HQ के नए मर्ज-समूह (DEORI/DEVRI, KHAMARIYA KACHHI ग्रुप, MOHGAON KACCHI, NAVALGAON ग्रुप) एक ही कुंजी में पड़ते हैं', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => ({
      deori: [_vgNormKey('बीबी', 'DEORI'), _vgNormKey('बीबी', 'DEVRI')],
      khamariya: [
        _vgNormKey('बीबी', 'KHAMARIYA KACCHI'),
        _vgNormKey('बीबी', 'KHAMARIYA KACHHI'),
        _vgNormKey('बीबी', 'KHAMARIYA KACHHI TOLA'),
        _vgNormKey('बीबी', 'KHMRIYA KACHHI'),
      ],
      mohgaon: [
        _vgNormKey('बीबी', 'MOHGAON KACCHI'),
        _vgNormKey('बीबी', 'MOHGAON KACHHI'),
        _vgNormKey('बीबी', 'Mohgaon kachi'),
        _vgNormKey('बीबी', 'MOHGAON KACHHI AUR'),
      ],
      navalgaon: [
        _vgNormKey('बीबी', 'NAVAL GAON'),
        _vgNormKey('बीबी', 'NAVALGAON'),
        _vgNormKey('बीबी', 'Nawalgaon'),
      ],
    }));
    expect(new Set(r.deori).size).toBe(1);
    expect(new Set(r.khamariya).size).toBe(1);
    expect(new Set(r.mohgaon).size).toBe(1);
    expect(new Set(r.navalgaon).size).toBe(1);
  });

  test('मढ़ी HQ के मर्ज-समूह (JAMUA/JUMUA, RAHLI/REHLI, KHAMARIYA GUJAR/MADHI) एक ही कुंजी में पड़ते हैं', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => ({
      jamua: [_vgNormKey('मढ़ी', 'JAMUA'), _vgNormKey('मढ़ी', 'JUMUA')],
      rahli: [_vgNormKey('मढ़ी', 'RAHLI'), _vgNormKey('मढ़ी', 'REHLI')],
      khamariya: [_vgNormKey('मढ़ी', 'KHAMARIYA GUJAR'), _vgNormKey('मढ़ी', 'KHAMARIYA MADHI')],
    }));
    expect(new Set(r.jamua).size).toBe(1);
    expect(new Set(r.rahli).size).toBe(1);
    expect(new Set(r.khamariya).size).toBe(1);
  });

  test('पाटन HQ के मर्ज-समूह (JUBAN/JUWAN TOLA ग्रुप, JOGANI/JOGNI TOLA) एक ही कुंजी में पड़ते हैं', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => ({
      juban: [_vgNormKey('पाटन', 'JUBAN TOLA'), _vgNormKey('पाटन', 'JUWAN TOLA'), _vgNormKey('पाटन', 'JUWANTOLA')],
      jogani: [_vgNormKey('पाटन', 'JOGANI TOLA'), _vgNormKey('पाटन', 'JOGNI TOLA')],
    }));
    expect(new Set(r.juban).size).toBe(1);
    expect(new Set(r.jogani).size).toBe(1);
  });

  test('जोबा HQ का KOMSAGHAT/KOSAMAGHT मर्ज-समूह एक ही कुंजी में पड़ता है', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => ({
      komsaghat: [_vgNormKey('जोबा', 'KOMSAGHAT'), _vgNormKey('जोबा', 'KOSAMAGHT')],
    }));
    expect(new Set(r.komsaghat).size).toBe(1);
  });

  test('पिंडरई HQ के मर्ज-समूह (KARABDOL/KARAPDOL, SINGHODI MOCHIPATHAR ग्रुप) एक ही कुंजी में पड़ते हैं', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => ({
      karabdol: [_vgNormKey('पिंडरई', 'KARABDOL'), _vgNormKey('पिंडरई', 'KARAPDOL')],
      singhodi: [
        _vgNormKey('पिंडरई', 'SINGHODI MOCHIPATHAR'),
        _vgNormKey('पिंडरई', 'SINGODI MOCHI'),
        _vgNormKey('पिंडरई', 'SINGODI MOCHIPATHAR'),
      ],
    }));
    expect(new Set(r.karabdol).size).toBe(1);
    expect(new Set(r.singhodi).size).toBe(1);
  });

  test('पाटन HQ का KALYAN PUR/KALYANPUR मर्ज-समूह एक ही कुंजी में पड़ता है', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => ({
      kalyanpur: [_vgNormKey('पाटन', 'KALYAN PUR'), _vgNormKey('पाटन', 'KALYANPUR')],
    }));
    expect(new Set(r.kalyanpur).size).toBe(1);
  });

  test('आदेगांव HQ के मर्ज-समूह (HAMEERGAGH/HAMEERGARH, CHHOTA/CHOTA BICHHUA) एक ही कुंजी में पड़ते हैं', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => ({
      hameergarh: [_vgNormKey('आदेगांव', 'HAMEERGAGH'), _vgNormKey('आदेगांव', 'HAMEERGARH')],
      bichhua: [_vgNormKey('आदेगांव', 'CHHOTA BICHHUA'), _vgNormKey('आदेगांव', 'CHOTA BICHHUA')],
    }));
    expect(new Set(r.hameergarh).size).toBe(1);
    expect(new Set(r.bichhua).size).toBe(1);
  });

  test('पिंडरई HQ का PINDARI RAIYAT/PINDRAI RAIYAT मर्ज-समूह एक ही कुंजी में पड़ता है', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => ({
      pindariRaiyat: [_vgNormKey('पिंडरई', 'PINDARI RAIYAT'), _vgNormKey('पिंडरई', 'PINDRAI RAIYAT')],
    }));
    expect(new Set(r.pindariRaiyat).size).toBe(1);
  });
});

test.describe('गांव-वार सुधरी Excel', () => {
  test('मिलते-जुलते गांव-नाम मर्ज करके सारांश + HQ-वार sheets बनती हैं', async ({ page }) => {
    test.setTimeout(90000); // background prefetch (offline-gated fetches) को settle होने का समय — धीमे CI runner पर flake रोकने के लिए
    await openApp(page);
    await loginJE(page);
    await page.waitForTimeout(2000); // login के बाद का background prefetch शुरू होकर शांत हो जाए
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

  test('HQ-वार sheet में टैरिफ श्रेणी का कॉलम भी शामिल होता है', async ({ page }) => {
    test.setTimeout(90000);
    await openApp(page);
    await loginJE(page);
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      cSet('जोबा', 'कुल उपभोक्ता', [
        { acc: '1', addr: 'PIPARIYA', name: 'राम', status: 'paid', amount: 100, tariff: 'LV1.1' },
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
        writeFile: function (wb) { res({ sheets: sheets }); },
      };
      downloadVillageExcel();
    }));
    const jobaSheet = r.sheets.find((s) => s.name === 'जोबा');
    const tariffCol = jobaSheet.rows[0].indexOf('टैरिफ');
    expect(tariffCol).toBeGreaterThan(-1);
    expect(jobaSheet.rows[1][tariffCol]).toBe('LV1.1');
  });

  test('लंबे नाम/गांव के लिए कॉलम अपने-आप चौड़ा होता है — अक्षर कटने न पाएं', async ({ page }) => {
    test.setTimeout(90000);
    await openApp(page);
    await loginJE(page);
    await page.waitForTimeout(2000);
    const longName = 'राजेन्द्र कुमार शर्मा विश्वकर्मा पुत्र स्वर्गीय';
    await page.evaluate((n) => {
      cSet('जोबा', 'कुल उपभोक्ता', [{ acc: '1', addr: 'PIPARIYA', name: n, status: 'pending', amount: 100 }]);
    }, longName);
    const r = await page.evaluate(() => new Promise((res) => {
      var sheets = [];
      window.XLSX = {
        utils: {
          book_new: function () { return { SheetNames: [], Sheets: {} }; },
          aoa_to_sheet: function (a) { return { rows: a }; },
          book_append_sheet: function (wb, ws, nm) { wb.SheetNames.push(nm); wb.Sheets[nm] = ws; sheets.push({ name: nm, cols: ws['!cols'], rows: ws.rows }); },
        },
        writeFile: function (wb) { res({ sheets: sheets }); },
      };
      downloadVillageExcel();
    }));
    const jobaSheet = r.sheets.find((s) => s.name === 'जोबा');
    const nameCol = jobaSheet.rows[0].indexOf('नाम');
    // कॉलम की चौड़ाई नाम की लंबाई से काफ़ी कम न रहे (Consumer No/तारीख जैसे narrow कॉलम की गलती न दोहराए)
    expect(jobaSheet.cols[nameCol].wch).toBeGreaterThan(longName.length * 0.9);
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

test.describe('SSE bandwidth बचत', () => {
  test('_sseFullPutData — path:"/" पर data लौटाए, वरना दोबारा fetch का संकेत दे', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => ({
      full: _sseFullPutData(JSON.stringify({ path: '/', data: [{ acc: '1' }] })),
      nullData: _sseFullPutData(JSON.stringify({ path: '/', data: null })),
      subPath: _sseFullPutData(JSON.stringify({ path: '/5', data: { acc: '1' } })),
      badJson: _sseFullPutData('not-json{'),
    }));
    expect(r.full).toEqual({ ok: true, data: [{ acc: '1' }] });
    expect(r.nullData).toEqual({ ok: true, data: null });
    expect(r.subPath).toEqual({ ok: false });
    expect(r.badJson).toEqual({ ok: false });
  });
});

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

test.describe('डिवाइस Version ट्रैकिंग', () => {
  test('login होते ही pingDeviceVersion सही payload के साथ PUT करता है', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const call = await page.evaluate(() => new Promise((resolve) => {
      const real = window.fetch;
      window.fetch = function (url, opts) {
        if (String(url).indexOf('/DEVICE_VERSIONS/') > -1) {
          resolve({ url: String(url), body: JSON.parse(opts.body), method: opts.method, ver: APP_VER });
          window.fetch = real;
          return Promise.resolve({ ok: true, json: () => Promise.resolve(true) });
        }
        return real(url, opts);
      };
      pingDeviceVersion();
    }));
    expect(call.method).toBe('PUT');
    expect(call.body).toEqual(expect.objectContaining({ v: call.ver, role: 'supervisor' }));
  });

  test('pingDeviceVersion — ts की जगह असली Firebase server-time (".sv":"timestamp") भेजे, ताकि response से offset सीखा जा सके', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const t = await page.evaluate(() => new Promise((resolve) => {
      const real = window.fetch;
      window.fetch = function (url, opts) {
        if (String(url).indexOf('/DEVICE_VERSIONS/') > -1) {
          resolve(JSON.parse(opts.body).t);
          window.fetch = real;
          return Promise.resolve({ ok: true, json: () => Promise.resolve(true) });
        }
        return real(url, opts);
      };
      pingDeviceVersion();
    }));
    expect(t).toEqual({ '.sv': 'timestamp' });
  });

  test('pingDeviceVersion — सफल response से resolved server timestamp आने पर serverNow() offset सीखे (bug: डिवाइस की ग़लत घड़ी से ts-आधारित conflict-resolution ग़लत फ़ैसला ले सकता था)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      var fakeServerTs = Date.now() + 10 * 24 * 60 * 60 * 1000; // सर्वर असल में 10 दिन "आगे" है — जैसे डिवाइस की घड़ी 10 दिन पीछे हो
      var real = window.fetch;
      window.fetch = function (url, opts) {
        if (String(url).indexOf('/DEVICE_VERSIONS/') > -1) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ v: APP_VER, t: fakeServerTs }) });
        }
        return real(url, opts);
      };
      pingDeviceVersion();
      setTimeout(() => {
        window.fetch = real;
        resolve({ diff: serverNow() - Date.now(), fakeServerTs: fakeServerTs, rawNow: Date.now() });
      }, 200);
    }));
    // serverNow() अब Date.now() से करीब 10 दिन आगे होना चाहिए (कुछ ms tolerance के साथ, request-latency के लिए)
    expect(Math.abs(r.diff - (r.fakeServerTs - r.rawNow))).toBeLessThan(5000);
  });

  test('logout पर deviceTimer साफ़ हो जाता है', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.waitForFunction(() => deviceTimer !== null);
    await page.evaluate(() => doLogout(false));
    expect(await page.evaluate(() => deviceTimer)).toBeNull();
  });

  test('_dvRender — पुराने version वाले devices को अलग/ऊपर दिखाता है', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => openMigModal());
    await page.evaluate(() => {
      window.fetch = function (url) {
        if (String(url).indexOf('/DEVICE_VERSIONS.json') > -1) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({
            d1: { v: APP_VER, hq: 'आदेगांव', role: 'supervisor', name: 'JE', t: Date.now() },
            d2: { v: '9.0', hq: 'पिंडरई', role: 'lineman', name: 'पुराना लाइनमैन', t: Date.now() - 1000 },
          }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
      };
      _dvRender();
    });
    await page.waitForFunction(() => document.getElementById('mig-devices').textContent.indexOf('पुराना लाइनमैन') > -1);
    const html = await page.evaluate(() => document.getElementById('mig-devices').innerHTML);
    expect(html).toContain('⚠️');
    // पुराना version वाली row पहले (ऊपर) आनी चाहिए
    expect(html.indexOf('पुराना लाइनमैन')).toBeLessThan(html.indexOf('JE'));
  });
});

// असली production में यह सूची ~38 entries तक पहुंच गई थी जबकि असली कर्मचारी ~28 ही थे — DEVICE_VERSIONS
// की key DEV_ID (localStorage में) है, तो browser data साफ़ होने/ऐप दोबारा install होने पर हर बार नई
// entry बनती थी ("Pradeep (JE)" की अकेले 20+ entries मिलीं)। साथ ही "पुराने version" चेतावनी उन मरे
// हुए devices से हमेशा लाल रहती थी जो अब कभी अपडेट होंगे ही नहीं — असली bug यही था
test.describe('कर्मचारी सक्रियता सूची — नाम-वार समूह, 7-दिन अवधि, पुरानी entries हटाना (JE only)', () => {
  // एक ही व्यक्ति के 3 devices + एक पुराना (40 दिन) + एक और कर्मचारी
  const mockDV = () => {
    window.fetch = function (url, opts) {
      if (String(url).indexOf('/DEVICE_VERSIONS.json') > -1) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({
          d1: { v: APP_VER, hq: 'आदेगांव', role: 'supervisor', name: 'Pradeep (JE)', t: Date.now() - 60000 },
          d2: { v: APP_VER, hq: 'आदेगांव', role: 'supervisor', name: 'pradeep (je)', t: Date.now() - 2 * 86400000 },
          d3: { v: '9.0', hq: 'आदेगांव', role: 'supervisor', name: 'PRADEEP (JE)', t: Date.now() - 3 * 86400000 },
          d4: { v: APP_VER, hq: 'पाटन', role: 'lineman', name: 'Vaibhav', t: Date.now() - 40 * 86400000 },
          d5: { v: APP_VER, hq: 'जोबा', role: 'lineman', name: 'Devendra kumar', t: Date.now() - 3600000 },
        }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
    };
  };

  // पहले यह चरण 3 (कभी-कभार वाली माइग्रेशन जांच) के अंदर दबी थी, जबकि JE इसे रोज़ देखते हैं
  test('कर्मचारी सक्रियता की अपनी स्क्रीन हो — मेनू से खुले, चरण 3 से अलग, और खुलते ही "आज" पर हो', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      _DV_WINDOW = 30; // पिछली बार कुछ और चुना हुआ था
      openDvModal();
      var dvOpen = document.getElementById('dv-overlay').classList.contains('open');
      var migOpen = document.getElementById('mig-overlay').classList.contains('open');
      var inDv = document.getElementById('dv-overlay').contains(document.getElementById('mig-devices'));
      closeDvModal();
      return { dvOpen: dvOpen, migOpen: migOpen, inDv: inDv, win: _DV_WINDOW, closed: !document.getElementById('dv-overlay').classList.contains('open') };
    });
    expect(r.dvOpen).toBe(true);
    expect(r.migOpen).toBe(false); // चरण 3 वाला मॉडल इससे न खुले
    expect(r.inDv).toBe(true);     // सूची अब इसी स्क्रीन के अंदर है
    expect(r.win).toBe(1);         // हर बार खुलते ही "आज"
    expect(r.closed).toBe(true);
  });

  test('चरण 3 खोलने पर DEVICE_VERSIONS की बेवजह fetch न हो (अब वह अलग स्क्रीन है)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const hits = await page.evaluate(() => new Promise((resolve) => {
      var n = 0;
      var orig = window.fetch;
      window.fetch = function (url, opts) {
        if (String(url).indexOf('/DEVICE_VERSIONS') > -1) n++;
        return orig(url, opts);
      };
      openMigModal();
      setTimeout(() => { window.fetch = orig; closeMigModal(); resolve(n); }, 600);
    }));
    expect(hits).toBe(0);
  });

  test('कर्मचारी सक्रियता — lineman सीधे function बुलाए तो भी न खुले (JE only)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const opened = await page.evaluate(() => {
      openDvModal();
      return document.getElementById('dv-overlay').classList.contains('open');
    });
    expect(opened).toBe(false);
  });

  test('डिफ़ॉल्ट अवधि "आज" हो, और वह कैलेंडर-दिन हो (रात 12 बजे से) — पिछले 24 घंटे नहीं', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      var d = new Date(); d.setHours(0, 0, 0, 0);
      var deflt = _DV_WINDOW;
      var todayCut = _dvCutoff();
      _dvSetWindow(7);
      var weekCut = _dvCutoff();
      _dvSetWindow(0);
      var allCut = _dvCutoff();
      _dvSetWindow(1);
      return { deflt: deflt, todayCut: todayCut, midnight: d.getTime(), weekRolling: weekCut > 0 && weekCut < d.getTime(), allCut: allCut };
    });
    expect(r.deflt).toBe(1);              // खुलते ही "आज"
    expect(r.todayCut).toBe(r.midnight);  // आज रात 12 बजे से, न कि "अभी − 24 घंटे"
    expect(r.weekRolling).toBe(true);     // 7 दिन पहले की तरह rolling ही रहे
    expect(r.allCut).toBe(0);
  });

  test('"आज" चुना हो तो "पुरानी हटाएं" बटन न दिखे (एक क्लिक में लगभग पूरी सूची मिटने से बचाव)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => openDvModal());
    await page.evaluate(mockDV);
    await page.evaluate(() => _dvRender());
    await page.waitForFunction(() => document.getElementById('mig-devices').textContent.indexOf('कर्मचारी सक्रिय') > -1);
    const r = await page.evaluate(() => {
      var el = document.getElementById('mig-devices');
      var onToday = el.textContent.indexOf('पुरानी') > -1;
      _dvSetWindow(7);
      var on7 = el.textContent.indexOf('पुरानी') > -1;
      var toastBefore = document.getElementById('toast').textContent;
      _dvSetWindow(1);
      _dvClearOld(); // "आज" पर बुलाने से कुछ न मिटे
      return { onToday: onToday, on7: on7, toastBefore: toastBefore, toastAfter: document.getElementById('toast').textContent };
    });
    expect(r.onToday).toBe(false);                     // "आज" पर बटन नहीं
    expect(r.on7).toBe(true);                          // 7 दिन पर दिखता है (Vaibhav 40 दिन पुराना)
    expect(r.toastAfter).toContain('पहले 7 या 30 दिन'); // "आज" पर _dvClearOld मना कर दे
  });

  test('एक ही व्यक्ति की अलग-अलग वर्तनी/कई devices एक ही पंक्ति में जुड़ें (3 devices दिखे), अलग नाम अलग पंक्ति में', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => openDvModal());
    await page.evaluate(mockDV);
    await page.evaluate(() => { _dvSetWindow(7); _dvRender(); }); // यह test 7-दिन वाली सूची जांचता है
    await page.waitForFunction(() => document.getElementById('mig-devices').textContent.indexOf('Devendra Kumar') > -1);
    const r = await page.evaluate(() => {
      const t = document.getElementById('mig-devices').textContent;
      return { text: t, rows: document.querySelectorAll('#mig-devices tbody tr').length };
    });
    expect(r.rows).toBe(2); // Pradeep के तीनों + Devendra = सिर्फ़ 2 पंक्तियां (Vaibhav 40 दिन पुराना, 7-दिन में नहीं)
    expect(r.text).toContain('3 devices'); // तीनों वर्तनी एक ही व्यक्ति मानी गईं
    expect(r.text).not.toContain('Vaibhav');
  });

  // JE का असली सवाल "आज कितने लोग काम पर थे" — उसे "आज कितने login हुए" से नापना v9.108 के बाद
  // ग़लत नाप है (session 30 दिन टिकता है, लोग दोबारा login करते ही नहीं)। इसलिए "सक्रिय" गिना जाता है
  test('_dvTodayStrip — आज ऐप खोलने वाले कर्मचारी/मुख्यालय गिने जाएं, एक व्यक्ति के कई device एक ही गिनें', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      var now = Date.now();
      var html = _dvTodayStrip({
        a1: { v: APP_VER, hq: 'आदेगांव', name: 'Pradeep (JE)', t: now - 60000 },
        a2: { v: APP_VER, hq: 'आदेगांव', name: 'PRADEEP (JE)', t: now - 120000 }, // वही व्यक्ति, दूसरा device
        b1: { v: APP_VER, hq: 'जोबा', name: 'Devendra kumar', t: now - 3600000 },
        c1: { v: APP_VER, hq: 'पाटन', name: 'पुराना', t: now - 5 * 86400000 },   // आज नहीं
      });
      var div = document.createElement('div');
      div.innerHTML = html;
      return div.textContent;
    });
    expect(r).toContain('2 कर्मचारी सक्रिय'); // Pradeep के दो device = एक ही व्यक्ति
    expect(r).toContain('2/' + 6 + ' मुख्यालय');
    expect(r).toContain('आज किसी ने ऐप नहीं खोला:');
    expect(r).toContain('पाटन'); // 5 दिन पुराना — आज चुप
  });

  test('_dvTodayStrip — आज कोई सक्रिय न हो तो साफ़ कहे (0 न दिखाए), और सभी मुख्यालय चुप-सूची में आएं', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      var div = document.createElement('div');
      div.innerHTML = _dvTodayStrip({ x: { v: APP_VER, hq: 'आदेगांव', name: 'क', t: Date.now() - 3 * 86400000 } });
      return div.textContent;
    });
    expect(r).toContain('आज अभी तक किसी ने ऐप नहीं खोला');
    expect(r).toContain('आदेगांव');
  });

  test('_dvTodayStrip — अवधि (7/30/सभी) बदलने पर भी "आज" वाली पट्टी वैसी ही रहे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => openDvModal());
    await page.evaluate(mockDV);
    await page.evaluate(() => _dvRender());
    await page.waitForFunction(() => document.getElementById('mig-devices').textContent.indexOf('आज') > -1);
    const r = await page.evaluate(() => {
      var el = document.getElementById('mig-devices');
      var grab = function () { var m = el.textContent.match(/(\d+) कर्मचारी सक्रिय/); return m ? m[1] : null; };
      var at7 = grab();
      _dvSetWindow(30);
      var at30 = grab();
      _dvSetWindow(0);
      var atAll = grab();
      return { at7: at7, at30: at30, atAll: atAll };
    });
    expect(r.at7).toBe('2');   // Pradeep (1 मिनट पहले) + Devendra (1 घंटा पहले)
    expect(r.at30).toBe(r.at7);
    expect(r.atAll).toBe(r.at7);
  });

  // लाइनमैन अपना नाम जैसे मन आए वैसे टाइप करते हैं ("SOHAN YADAV", "pradeep", "Devendra kumar") —
  // सूची बेतरतीब दिखती थी
  test('_dvTitle — सभी नाम एक ही रूप में दिखें (देवनागरी नाम ज्यों के त्यों), पर समूह-पहचान पर असर न हो', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => ({
      caps: _dvTitle('SOHAN YADAV'),
      small: _dvTitle('pradeep'),
      mixed: _dvTitle('Devendra kumar'),
      dotted: _dvTitle('ANIRAM.PARTE'),
      hindi: _dvTitle('आनंद कुमार कवरेती'),
      // तीनों वर्तनी की समूह-पहचान एक ही रहनी चाहिए
      sameKey: _dvNameKey('PRADEEP') === _dvNameKey('pradeep') && _dvNameKey('pradeep') === _dvNameKey('Pradeep'),
    }));
    expect(r.caps).toBe('Sohan Yadav');
    expect(r.small).toBe('Pradeep');
    expect(r.mixed).toBe('Devendra Kumar');
    expect(r.dotted).toBe('Aniram.Parte');
    expect(r.hindi).toBe('आनंद कुमार कवरेती'); // देवनागरी में छोटे/बड़े अक्षर होते ही नहीं
    expect(r.sameKey).toBe(true);
  });

  test('7 दिन चुनने पर पुरानी entry छुपे और "पुरानी हटाएं" बटन उसकी गिनती के साथ दिखे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => openDvModal());
    await page.evaluate(mockDV);
    await page.evaluate(() => { _dvSetWindow(7); _dvRender(); });
    await page.waitForFunction(() => document.getElementById('mig-devices').textContent.indexOf('Devendra Kumar') > -1);
    const txt = await page.evaluate(() => document.getElementById('mig-devices').textContent);
    expect(await page.evaluate(() => _DV_WINDOW)).toBe(7);
    expect(txt).toContain('पुरानी 1 हटाएं'); // सिर्फ़ Vaibhav (40 दिन) छुपा
  });

  test('अवधि बदलने पर एक भी नई network call न हो (bandwidth) — "सभी" चुनने पर पुरानी entry भी दिखे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => openDvModal());
    await page.evaluate(mockDV);
    await page.evaluate(() => _dvRender());
    await page.waitForFunction(() => document.getElementById('mig-devices').textContent.indexOf('Devendra Kumar') > -1);
    const r = await page.evaluate(() => {
      let calls = 0;
      window.fetch = function () { calls++; return Promise.resolve({ ok: true, json: () => Promise.resolve(null) }); };
      _dvSetWindow(0); // "सभी"
      return { calls: calls, text: document.getElementById('mig-devices').textContent };
    });
    expect(r.calls).toBe(0); // पहले से लाया हुआ data दोबारा रंगा गया, कोई नई fetch नहीं
    expect(r.text).toContain('Vaibhav'); // अब 40-दिन पुरानी entry भी दिखे
  });

  test('_dvActivity — वसूली में एक ही उपभोक्ता कई श्रेणियों में हो तो एक ही बार गिने (status propagate होता है)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const a = await page.evaluate(() => {
      const now = Date.now();
      // एक ही acc दो श्रेणियों में (propagateStatus से ऐसा होता ही है) — dedup होना चाहिए
      cSet('जोबा', 'कुल उपभोक्ता', [
        { acc: '1', name: 'A', status: 'paid', amount: 100, updatedBy: 'Devendra kumar', ts: now - 3600000 },
        { acc: '2', name: 'B', status: 'pending', amount: 100, updatedBy: 'Devendra kumar', ts: now - 3600000 },
        { acc: '3', name: 'C', status: 'paid', amount: 100, updatedBy: 'कोई और', ts: now - 40 * 86400000 }, // बहुत पुराना
      ]);
      cSet('जोबा', 'घरेलू', [
        { acc: '1', name: 'A', status: 'paid', amount: 100, updatedBy: 'Devendra kumar', ts: now - 3600000 },
      ]);
      return _dvActivity(now - 7 * 86400000);
    });
    expect(a['devendra kumar']).toEqual({ work: 2, paid: 1, rmk: 0 }); // acc "1" दो जगह था पर एक ही बार गिना
    expect(a['कोई और']).toBeUndefined(); // 7-दिन की खिड़की से बाहर
  });

  test('_dvActivity — रिमार्क अलग से गिने जाएं: हर श्रेणी के अपने (propagateStatus remarksArr copy नहीं करता), और सिर्फ़ चुनी अवधि वाले', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const a = await page.evaluate(() => {
      const now = Date.now();
      const dmy = (ago) => { const d = new Date(now - ago); return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear() + ', 2:15:30 pm'; };
      cSet('जोबा', 'कुल उपभोक्ता', [
        { acc: '1', name: 'A', status: 'pending', amount: 100, remarksArr: [
          { text: 'घर बंद', by: 'Devendra kumar', at: dmy(2 * 86400000) },
          { text: 'फिर जाना है', by: 'Devendra kumar', at: dmy(3 * 86400000) },
          { text: 'बहुत पुराना', by: 'Devendra kumar', at: dmy(40 * 86400000) }, // खिड़की से बाहर
        ] },
      ]);
      // वही acc दूसरी श्रेणी में — पर रिमार्क अलग हैं, इसलिए ये भी गिनने चाहिए (dedup नहीं)
      cSet('जोबा', 'घरेलू', [
        { acc: '1', name: 'A', status: 'pending', amount: 100, remarksArr: [
          { text: 'दूसरी श्रेणी का रिमार्क', by: 'Devendra kumar', at: dmy(86400000) },
        ] },
      ]);
      return _dvActivity(now - 7 * 86400000);
    });
    expect(a['devendra kumar'].rmk).toBe(3); // 2 + 1 दूसरी श्रेणी का; 40-दिन पुराना नहीं
    expect(a['devendra kumar'].paid).toBe(0);
  });

  test('_dvClearOld — सिर्फ़ चुनी अवधि से पुरानी entries DELETE हों, हाल की न छुएं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => openDvModal());
    await page.evaluate(mockDV);
    await page.evaluate(() => { _dvSetWindow(7); _dvRender(); }); // हटाना 7/30 दिन पर ही होता है
    await page.waitForFunction(() => document.getElementById('mig-devices').textContent.indexOf('Devendra Kumar') > -1);
    const deleted = await page.evaluate(() => {
      window.confirm = () => true;
      const gone = [];
      window.fetch = function (url, opts) {
        if (opts && opts.method === 'DELETE') gone.push(String(url));
        return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
      };
      _dvClearOld();
      return new Promise((res) => setTimeout(() => res(gone), 200));
    });
    expect(deleted.length).toBe(1);
    expect(deleted[0]).toContain('/DEVICE_VERSIONS/d4.json'); // सिर्फ़ 40-दिन पुराना Vaibhav वाला
  });

  test('_dvClearOld — lineman सीधे function बुलाए तो भी कुछ न मिटे (defense-in-depth)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const deleted = await page.evaluate(() => {
      _DV_RAW = { d4: { v: '9.0', hq: 'पाटन', role: 'lineman', name: 'Vaibhav', t: Date.now() - 40 * 86400000 } };
      _DV_WINDOW = 7;
      window.confirm = () => true;
      const gone = [];
      window.fetch = function (url, opts) {
        if (opts && opts.method === 'DELETE') gone.push(String(url));
        return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
      };
      _dvClearOld();
      return new Promise((res) => setTimeout(() => res(gone), 200));
    });
    expect(deleted.length).toBe(0);
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
      let count = 0;
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('टेस्ट_HQ10/कुल_उपभोक्ता') > -1 && opts && opts.method === 'PATCH') {
          count++;
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
    await page.reload();
    await page.waitForFunction(() => typeof loadMigratedFlags === 'function', null, { timeout: 15000 });
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
      cSet('टेस्ट HQ3', 'कुल उपभोक्ता', []);
      var data = [{ acc: '7', status: 'pending', amount: 0 }];
      overlayOps('टेस्ट HQ3', 'कुल उपभोक्ता', data);
    }));
    expect(call.method).toBe('PUT');
  });
});

test.describe('Lineman PIN — सामान्य सुरक्षा-मज़बूती', () => {
  test('HQ का PIN सेट हो तो गलत PIN से login रुकता है, सही PIN से चलता है', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => { HQ_PINS[hqKey('आदेगांव')] = '4321'; });
    await page.click('#rc-lin');
    await page.fill('#uname-inp', 'टेस्ट लाइनमैन');
    await page.selectOption('#hq-sel', { label: 'आदेगांव' });
    await page.fill('#lin-pin', '0000');
    await page.click('.login-btn');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.getElementById('app-screen').classList.contains('active'))).toBe(false);
    await page.fill('#lin-pin', '4321');
    await page.click('.login-btn');
    await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'), null, { timeout: 15000 });
  });

  test('logout पर PIN फ़ील्ड भी साफ़ हो जाए — वरना shared device पर अगले लाइनमैन को पुराने PIN से login fail दिखता (गड़बड़ी जो "logout ठीक से काम नहीं करता" जैसी दिखती थी)', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => { HQ_PINS[hqKey('आदेगांव')] = '4321'; });
    await page.click('#rc-lin');
    await page.fill('#uname-inp', 'टेस्ट लाइनमैन');
    await page.selectOption('#hq-sel', { label: 'आदेगांव' });
    await page.fill('#lin-pin', '4321');
    await page.click('.login-btn');
    await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'), null, { timeout: 15000 });
    await page.evaluate(() => doLogout(false));
    expect(await page.locator('#lin-pin').inputValue()).toBe('');
    expect(await page.locator('#uname-inp').inputValue()).toBe('');
    expect(await page.locator('#hq-sel').inputValue()).toBe('');
  });

  test('सही PIN पर उस HQ के असली Firebase account से sign-in होता है (email + PIN से बना password)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      HQ_PINS[hqKey('आदेगांव')] = '4321';
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return {
          currentUser: null,
          signInWithEmailAndPassword: function (email, pw) {
            resolve({ email: email, pw: pw });
            return Promise.resolve({});
          },
        };
      };
      selectRole('lineman');
      document.getElementById('uname-inp').value = 'टेस्ट लाइनमैन';
      document.getElementById('hq-sel').value = 'आदेगांव';
      document.getElementById('lin-pin').value = '4321';
      doLogin();
    }));
    expect(r.email).toBe('hq-adegaon@adegaondc.internal');
    expect(r.pw).toBe('vasuli-4321');
    await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'), null, { timeout: 15000 });
  });

  test('HQ sign-in reject (गलत password/server) हो तो login रुक जाता है', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      HQ_PINS[hqKey('आदेगांव')] = '4321';
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return {
          currentUser: null,
          signInWithEmailAndPassword: function () { return Promise.reject({ code: 'auth/wrong-password' }); },
        };
      };
      selectRole('lineman');
      document.getElementById('uname-inp').value = 'टेस्ट लाइनमैन';
      document.getElementById('hq-sel').value = 'आदेगांव';
      document.getElementById('lin-pin').value = '4321';
      doLogin();
    });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.getElementById('app-screen').classList.contains('active'))).toBe(false);
  });

  test('HQ sign-in के बीच नेट टूटे तो भी login आगे बढ़ जाता है (offline-सहनशील)', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      HQ_PINS[hqKey('आदेगांव')] = '4321';
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return {
          currentUser: null,
          signInWithEmailAndPassword: function () { return Promise.reject({ code: 'auth/network-request-failed' }); },
        };
      };
      selectRole('lineman');
      document.getElementById('uname-inp').value = 'टेस्ट लाइनमैन';
      document.getElementById('hq-sel').value = 'आदेगांव';
      document.getElementById('lin-pin').value = '4321';
      doLogin();
    });
    await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'), null, { timeout: 15000 });
  });

  test('_ensureCorrectHqAuth — anonymous auth में login हो तो online होते ही सही HQ account से sign-in हो (bug: login के वक़्त network कमज़ोर होने पर device हमेशा के लिए anonymous रह जाता, हर save 401 देता रहता)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      CU = { role: 'lineman', name: 'टेस्ट लाइनमैन', hq: 'आदेगांव' };
      HQ_PINS[hqKey('आदेगांव')] = '4321';
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return {
          currentUser: { email: null }, // anonymous
          signInWithEmailAndPassword: function (email, pw) {
            resolve({ email: email, pw: pw });
            return Promise.resolve({});
          },
        };
      };
      _ensureCorrectHqAuth();
    }));
    expect(r.email).toBe('hq-adegaon@adegaondc.internal');
    expect(r.pw).toBe('vasuli-4321');
  });

  // v9.108 का regression (असली production लॉग: SOHAN YADAV/बीबी, Satendra/बीबी, आनंद/आदेगांव —
  // v9.108 पर लगातार HTTP 401)। पहले tab मरने के बाद दोबारा login करना पड़ता था और वही login हर
  // बार सही HQ account पक्का कर देता था। v9.108 में session बहाल होकर चुपचाप अंदर आ जाते हैं, तो
  // Firebase का अपना session खोने/anonymous पर लौटने पर device हमेशा के लिए anonymous रह जाता।
  // "online" event यहां बचाता नहीं — वो सिर्फ़ offline→online बदलने पर चलता है
  test('सेव किया हुआ session बहाल होने पर सही HQ account पक्का हो (v9.108 regression: चुपचाप अंदर आने पर device anonymous रह जाता, हर save 401)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      HQ_PINS[hqKey('आदेगांव')] = '4321';
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return {
          currentUser: { email: null }, // Firebase अपने session से anonymous पर लौट आया
          signInWithEmailAndPassword: function (email, pw) { resolve({ email: email, pw: pw }); return Promise.resolve({}); },
        };
      };
      CU = { role: 'lineman', name: 'बहाल लाइनमैन', hq: 'आदेगांव' };
      _finishLogin(CU.name, true); // silent = सेव किया session बहाल हुआ
      setTimeout(() => resolve({ email: null, pw: null }), 8000);
    }));
    expect(r.email).toBe('hq-adegaon@adegaondc.internal');
    expect(r.pw).toBe('vasuli-4321');
  });

  test('ताज़ा login (silent नहीं) पर दोबारा sign-in की कोशिश न हो — doLogin खुद सही account से जोड़ चुका है', async ({ page }) => {
    await openApp(page);
    const calls = await page.evaluate(() => new Promise((resolve) => {
      HQ_PINS[hqKey('आदेगांव')] = '4321';
      var n = 0;
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return {
          currentUser: { email: null },
          signInWithEmailAndPassword: function () { n++; return Promise.resolve({}); },
        };
      };
      CU = { role: 'lineman', name: 'ताज़ा लाइनमैन', hq: 'आदेगांव' };
      _finishLogin(CU.name); // silent नहीं
      setTimeout(() => resolve(n), 6000);
    }));
    expect(calls).toBe(0);
  });

  test('_ensureCorrectHqAuth — सही account पहले से हो तो भी पुरानी "अटकी" गिनती साफ़ हो (bug: मैन्युअल logout+login के बाद भी अटका डेटा हमेशा के लिए अटका रह जाता था)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      CU = { role: 'lineman', name: 'अटका', hq: 'आदेगांव' };
      HQ_PINS[hqKey('आदेगांव')] = '4321';
      _authHealed = {};
      var p = {};
      p[cKey('आदेगांव', 'कुल उपभोक्ता')] = { hq: 'आदेगांव', cat: 'कुल उपभोक्ता', type: 'put', authFailCount: STUCK_AUTH_MAX };
      setPendingObj(p);
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return { currentUser: { email: 'hq-adegaon@adegaondc.internal' }, signInWithEmailAndPassword: function () { return Promise.resolve({}); } };
      };
      _ensureCorrectHqAuth();
      var after = getPending()[cKey('आदेगांव', 'कुल उपभोक्ता')].authFailCount;
      // दोबारा चलाने पर बार-बार रीसेट न हो (401 ↔ रीसेट का झूला न बने)
      var p2 = getPending();
      p2[cKey('आदेगांव', 'कुल उपभोक्ता')].authFailCount = STUCK_AUTH_MAX;
      setPendingObj(p2);
      _ensureCorrectHqAuth();
      return { after: after, second: getPending()[cKey('आदेगांव', 'कुल उपभोक्ता')].authFailCount, max: STUCK_AUTH_MAX };
    });
    expect(r.after).toBe(0);       // पहली बार साफ़ हुई — अटका डेटा दोबारा भेजा जा सकेगा
    expect(r.second).toBe(r.max);  // दूसरी बार नहीं — guard काम कर रहा है
  });

  test('पहला 401 आते ही सही account से जुड़ने की कोशिश हो (हार मानने का इंतज़ार न करे)', async ({ page }) => {
    await openApp(page);
    const tried = await page.evaluate(() => new Promise((resolve) => {
      CU = { role: 'lineman', name: '401', hq: 'आदेगांव' };
      HQ_PINS[hqKey('आदेगांव')] = '4321';
      _authHealed = {};
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return {
          currentUser: { email: null }, // anonymous — यही 401 की असली वजह
          signInWithEmailAndPassword: function (email) { resolve(email); return Promise.resolve({}); },
        };
      };
      markPending('आदेगांव', 'कुल उपभोक्ता', 'put', null, new Error('HTTP 401'));
      setTimeout(() => resolve(null), 5000);
    }));
    expect(tried).toBe('hq-adegaon@adegaondc.internal');
  });

  test('_ensureCorrectHqAuth — पहले से सही HQ account से sign-in हो तो दोबारा sign-in न हो (redundant auth call से बचाव)', async ({ page }) => {
    await openApp(page);
    const called = await page.evaluate(() => {
      CU = { role: 'lineman', name: 'टेस्ट लाइनमैन', hq: 'आदेगांव' };
      HQ_PINS[hqKey('आदेगांव')] = '4321';
      var calls = 0;
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return {
          currentUser: { email: 'hq-adegaon@adegaondc.internal' },
          signInWithEmailAndPassword: function () { calls++; return Promise.resolve({}); },
        };
      };
      _ensureCorrectHqAuth();
      return calls;
    });
    expect(called).toBe(0);
  });

  test('_ensureCorrectHqAuth — HQ का PIN सेट न हो तो कुछ न करे (anonymous ही पुराना/सही व्यवहार है)', async ({ page }) => {
    await openApp(page);
    const called = await page.evaluate(() => {
      CU = { role: 'lineman', name: 'टेस्ट लाइनमैन', hq: 'जोबा' };
      delete HQ_PINS[hqKey('जोबा')];
      var calls = 0;
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return { currentUser: { email: null }, signInWithEmailAndPassword: function () { calls++; return Promise.resolve({}); } };
      };
      _ensureCorrectHqAuth();
      return calls;
    });
    expect(called).toBe(0);
  });

  test('_ensureCorrectHqAuth — JE (supervisor) के लिए कुछ न करे (सिर्फ़ lineman पर लागू)', async ({ page }) => {
    await openApp(page);
    const called = await page.evaluate(() => {
      CU = { role: 'supervisor', name: 'टेस्ट जेई', hq: 'आदेगांव' };
      HQ_PINS[hqKey('आदेगांव')] = '4321';
      var calls = 0;
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return { currentUser: { email: null }, signInWithEmailAndPassword: function () { calls++; return Promise.resolve({}); } };
      };
      _ensureCorrectHqAuth();
      return calls;
    });
    expect(called).toBe(0);
  });

  test('_ensureCorrectHqAuth — sign-in सफल होने पर flushPending() भी बुलाया जाए (ताकि अटका data तुरंत भेजने की कोशिश हो)', async ({ page }) => {
    await openApp(page);
    const called = await page.evaluate(() => new Promise((resolve) => {
      CU = { role: 'lineman', name: 'टेस्ट लाइनमैन', hq: 'आदेगांव' };
      HQ_PINS[hqKey('आदेगांव')] = '4321';
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return { currentUser: { email: null }, signInWithEmailAndPassword: function () { return Promise.resolve({}); } };
      };
      var origFlush = flushPending;
      window.flushPending = function () { window.flushPending = origFlush; resolve(true); };
      _ensureCorrectHqAuth();
      setTimeout(() => resolve(false), 500);
    }));
    expect(called).toBe(true);
  });

  test('_resetAuthFailForHQ — सिर्फ़ उसी HQ के stuck pending entries की authFailCount रीसेट हो, दूसरे HQ की न छुएं', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      setPendingObj({
        'आदेगांव_घरेलू': { hq: 'आदेगांव', cat: 'घरेलू', authFailCount: 3 },
        'पिंडरई_घरेलू': { hq: 'पिंडरई', cat: 'घरेलू', authFailCount: 3 },
      });
      _resetAuthFailForHQ('आदेगांव');
      var p = getPending();
      return { adegaon: p['आदेगांव_घरेलू'].authFailCount, pindrai: p['पिंडरई_घरेलू'].authFailCount };
    });
    expect(r.adegaon).toBe(0);
    expect(r.pindrai).toBe(3);
  });

  test('HQ का PIN सेट न हो तो बिना PIN login चलता रहता है (पुराना व्यवहार बरकरार)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    expect(await page.evaluate(() => document.getElementById('app-screen').classList.contains('active'))).toBe(true);
  });

  test('सिर्फ JE "Lineman PIN" खोल सकते हैं', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => openPinModal());
    expect(await page.evaluate(() => document.getElementById('pin-overlay').classList.contains('open'))).toBe(false);
  });

  test('savePins — सही HQ-key से PIN payload बनता है', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => openPinModal());
    await page.fill('#pin-आदेगांव', '1111');
    const r = await page.evaluate(() => new Promise((resolve) => {
      const real = window.fetch;
      window.fetch = function (url, opts) {
        if (String(url).indexOf('/HQ_PIN.json') > -1 && opts && opts.method === 'PUT') {
          window.fetch = real;
          resolve({ body: JSON.parse(opts.body), key: hqKey('आदेगांव') });
          return Promise.resolve({ ok: true, json: () => Promise.resolve(true) });
        }
        return real(url, opts);
      };
      savePins();
    }));
    expect(r.body[r.key]).toBe('1111');
  });
});

test.describe('Firebase auth token — 401 पर force-refresh', () => {
  test('_fbFetchWithAuth — 401 मिलने पर token force-refresh करके एक बार दोबारा कोशिश करता है', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      let calls = 0;
      _rawFetch = function () {
        calls++;
        if (calls === 1) return Promise.resolve({ status: 401, ok: false });
        return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({ ok: true }) });
      };
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return { currentUser: { getIdToken: function () { ID_TOKEN = 'fresh-token'; return Promise.resolve('fresh-token'); } } };
      };
      _fbFetchWithAuth(FB + '/test.json', { method: 'GET' }).then((res) => {
        resolve({ calls: calls, status: res.status, token: ID_TOKEN });
      });
    }));
    expect(r.calls).toBe(2);
    expect(r.status).toBe(200);
    expect(r.token).toBe('fresh-token');
  });

  test('_fbFetchWithAuth — currentUser न हो तो 401 response वैसे ही लौटा देता है (दोबारा कोशिश नहीं, loop नहीं)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      let calls = 0;
      _rawFetch = function () { calls++; return Promise.resolve({ status: 401, ok: false }); };
      window.firebase = window.firebase || {};
      window.firebase.auth = function () { return { currentUser: null }; };
      _fbFetchWithAuth(FB + '/test.json', { method: 'GET' }).then((res) => {
        resolve({ calls: calls, status: res.status });
      });
    }));
    expect(r.calls).toBe(1);
    expect(r.status).toBe(401);
  });

  test('_fbFetchWithAuth — सामान्य (non-401) response पर सिर्फ एक ही बार fetch करता है', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      let calls = 0;
      _rawFetch = function () { calls++; return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({ ok: true }) }); };
      _fbFetchWithAuth(FB + '/test.json', { method: 'GET' }).then((res) => {
        resolve({ calls: calls, status: res.status });
      });
    }));
    expect(r.calls).toBe(1);
    expect(r.status).toBe(200);
  });

  test('_fbFetchWithAuth — 403 मिलने पर App Check token force-refresh करके एक बार दोबारा कोशिश करता है', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      let calls = 0;
      _rawFetch = function () {
        calls++;
        if (calls === 1) return Promise.resolve({ status: 403, ok: false });
        return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({ ok: true }) });
      };
      window.firebase = window.firebase || {};
      window.firebase.appCheck = function () {
        return { getToken: function () { AC_TOKEN = 'fresh-ac-token'; return Promise.resolve({ token: 'fresh-ac-token' }); } };
      };
      _fbFetchWithAuth(FB + '/test.json', { method: 'GET' }).then((res) => {
        resolve({ calls: calls, status: res.status, token: AC_TOKEN });
      });
    }));
    expect(r.calls).toBe(2);
    expect(r.status).toBe(200);
    expect(r.token).toBe('fresh-ac-token');
  });

  test('_fbFetchWithAuth — 403 पर retry भी असफल रहे (असली permission-denied) तो वही response लौटाता है, loop नहीं', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      let calls = 0;
      _rawFetch = function () { calls++; return Promise.resolve({ status: 403, ok: false }); };
      window.firebase = window.firebase || {};
      window.firebase.appCheck = function () {
        return { getToken: function () { return Promise.resolve({ token: 'x' }); } };
      };
      _fbFetchWithAuth(FB + '/test.json', { method: 'GET' }).then((res) => {
        resolve({ calls: calls, status: res.status });
      });
    }));
    expect(r.calls).toBe(2);
    expect(r.status).toBe(403);
  });
});

test.describe('लॉगिन और डेटा-लोड — कमज़ोर नेटवर्क पर हमेशा के लिए न अटकें', () => {
  test('verifyJE — online सर्वर जवाब न दे तो timeout के बाद offline hash से login हो जाता है', async ({ page }) => {
    await openApp(page);
    await page.evaluate((p) => new Promise((res) => {
      _sha256('dcje|' + p).then((h) => { try { localStorage.setItem('dc_jeh', h); } catch (e) {} res(); });
    }), 'Test#123');
    const r = await page.evaluate(() => new Promise((resolve) => {
      JE_VERIFY_TIMEOUT_MS = 200;
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return { signInWithEmailAndPassword: function () { return new Promise(() => {}); } }; // कभी जवाब नहीं
      };
      const start = Date.now();
      verifyJE('Test#123', function (ok, msg) {
        resolve({ ok: ok, msg: msg, ms: Date.now() - start });
      });
    }));
    expect(r.ok).toBe(true);
    expect(r.ms).toBeLessThan(2000);
  });

  test('fbGet — cache खाली हो और नेटवर्क धीमा हो तो timeout के बाद खाली लिस्ट के साथ आगे बढ़ता है', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      FB_GET_TIMEOUT_MS = 200;
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('टेस्ट_HQ9/घरेलू') > -1) {
          return new Promise(() => {}); // कभी resolve नहीं — अटकी हुई श्रेणी
        }
        return orig(url, opts);
      };
      const start = Date.now();
      fbGet('टेस्ट HQ9', 'घरेलू', function (data) {
        window.fetch = orig;
        resolve({ ms: Date.now() - start, len: data.length });
      });
    }));
    expect(r.ms).toBeLessThan(2000);
    expect(r.len).toBe(0);
  });
});

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

test.describe('प्रोफ़ाइल — बॉटम नेव, एवतार रंग, फ़ोटो अपलोड', () => {
  test('login के बाद बॉटम नेव के 4 बटन दिखते हैं', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const labels = await page.locator('.bnav-item .bnav-lbl').allTextContents();
    expect(labels).toEqual(['Home', 'स्कोरकार्ड', 'Profile', 'Support']);
  });

  test('प्रोफ़ाइल मॉडल सही नाम/भूमिका/HQ दिखाता है, बिना फ़ोटो के रंगीन शुरुआती-अक्षर एवतार दिखे', async ({ page }) => {
    await openApp(page);
    await loginLineman(page, 'राधा शर्मा');
    await page.evaluate(() => document.getElementById('update-banner')?.remove());
    await page.click('button[onclick="openProfileModal()"]');
    await expect(page.locator('#profile-name')).toHaveText('राधा शर्मा');
    expect(await page.locator('#profile-meta').textContent()).toContain('लाइनमैन');
    // कोई फ़ोटो नहीं है (server offline) — शुरुआती अक्षर दिखना चाहिए
    await page.waitForTimeout(200);
    expect(await page.locator('#profile-avatar-wrap').textContent()).toBe('र');
  });

  test('सहायता मॉडल JE का ईमेल दिखाता है', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => document.getElementById('update-banner')?.remove());
    await page.click('button[onclick="openSupportModal()"]');
    expect(await page.locator('#support-je-email').textContent()).toContain('@');
  });

  test('फ़ोटो चुनने पर compress होकर PROFILE_PHOTOS पर PUT होती है (आकार छोटा हो)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => document.getElementById('update-banner')?.remove());

    let captured = null;
    await page.route('**/PROFILE_PHOTOS/**', async (route) => {
      captured = route.request().postData();
      await route.fulfill({ status: 200, body: '{}' });
    });

    await page.click('button[onclick="openProfileModal()"]');
    // 100x100 का लाल वर्ग वाली छोटी JPEG बनाकर अपलोड करें
    const jpegBuffer = Buffer.from(
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCABkAGQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDk6KKK8I/VgooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//Z',
      'base64'
    );
    await page.setInputFiles('#profile-photo-inp', { name: 'test.jpg', mimeType: 'image/jpeg', buffer: jpegBuffer });
    await page.waitForFunction(() => !!captured, null, { timeout: 8000 }).catch(() => {});
    // Firebase SDK offline में तुरंत उपलब्ध नहीं होता — fetch wrapper 4s बाद raw fetch पर गिरता है
    await page.waitForTimeout(5000);

    expect(captured).toBeTruthy();
    const body = JSON.parse(captured);
    expect(body.photo).toMatch(/^data:image\/jpeg;base64,/);
    const approxBytes = Math.floor(body.photo.split(',')[1].length * 0.75);
    expect(approxBytes).toBeLessThan(60 * 1024); // compressed होने पर बहुत छोटा रहना चाहिए
  });

  test('डार्क मोड टॉगल — html[data-theme] बदलता है, localStorage में याद रहता है, दोबारा खोलने पर बना रहता है', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => openProfileModal());
    const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(before).not.toBe('dark');
    await page.evaluate(() => toggleTheme());
    const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(after).toBe('dark');
    expect(await page.evaluate(() => localStorage.getItem('dc_theme'))).toBe('dark');
    await expect(page.locator('#theme-switch-btn')).toHaveClass(/\bon\b/);
    // reload — theme flash न हो, तुरंत dark लागू हो; login session भी बना रहे (pull-to-refresh जैसे
    // असली reload से logout न हो — सिर्फ़ dc_cu से चुपचाप वापस अंदर आ जाए)
    await page.reload();
    await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'), null, { timeout: 15000 });
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
    // वापस light पर टॉगल करने पर साफ़ हो जाए
    await page.evaluate(() => openProfileModal());
    await page.evaluate(() => toggleTheme());
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
    expect(await page.evaluate(() => localStorage.getItem('dc_theme'))).toBe('light');
  });
});

test.describe('होम पेज डिस्प्ले बोर्ड — पूरा बोर्ड दिखाने/छुपाने का चुनाव', () => {
  test('renderHomeSc — showBoard:"0" पर home-sc बिल्कुल खाली रहे (login से पहले किसी को कुछ न दिखे)', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      HSC = { curPaid: '10', curAmt: '5', lyPaid: '8', lyAmt: '4', showBoard: '0' };
      renderHomeSc();
    });
    expect(await page.evaluate(() => document.getElementById('home-sc').innerHTML.trim())).toBe('');
  });

  test('renderHomeSc — showBoard न हो (पुराना बोर्ड) या "1" हो तो पहले जैसे दिखता रहे', async ({ page }) => {
    await openApp(page);
    const withoutFlag = await page.evaluate(() => {
      HSC = { curPaid: '10', curAmt: '5', lyPaid: '8', lyAmt: '4' }; // पुराना बोर्ड — showBoard field ही नहीं
      renderHomeSc();
      return document.getElementById('home-sc').innerHTML.length;
    });
    expect(withoutFlag).toBeGreaterThan(0);
    const withFlagOn = await page.evaluate(() => {
      HSC.showBoard = '1';
      renderHomeSc();
      return document.getElementById('home-sc').innerHTML.length;
    });
    expect(withFlagOn).toBeGreaterThan(0);
  });

  test('openHscModal — showBoard checkbox default checked रहे (नया बोर्ड या showBoard missing दोनों में)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => { HSC = null; });
    await page.evaluate(() => openHscModal());
    expect(await page.locator('#hsc-showboard').isChecked()).toBe(true);
    await page.evaluate(() => closeHscModal());
    await page.evaluate(() => { HSC = { curPaid: '10', curAmt: '5' }; }); // पुराना बोर्ड, showBoard field नहीं
    await page.evaluate(() => openHscModal());
    expect(await page.locator('#hsc-showboard').isChecked()).toBe(true);
  });

  test('saveHsc — showBoard अनचेक करके सेव करें तो publish होने वाले data में showBoard:"0" जाए', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const body = await page.evaluate(() => new Promise((resolve) => {
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('HOME_SCORECARD') > -1 && opts && opts.method === 'PUT') {
          window.fetch = orig;
          resolve(JSON.parse(opts.body));
          return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        return orig(url, opts);
      };
      openHscModal();
      document.getElementById('hsc-curpaid').value = '10';
      document.getElementById('hsc-curamt').value = '5';
      document.getElementById('hsc-showboard').checked = false;
      saveHsc();
    }));
    expect(body.showBoard).toBe('0');
  });

  test('_hscRetryPublish — lineman/login-से-पहले वाला device बिना अनुमति PUT न भेजे (bug: pending फ्लैग कभी साफ़ न होना)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page); // lineman के पास होम-बोर्ड लिखने की अनुमति नहीं (Firebase rules)
    const putAttempted = await page.evaluate(() => new Promise((resolve) => {
      HSC = { curPaid: '10', curAmt: '5', ts: Date.now() }; // local, server से नया मानकर
      const orig = window.fetch;
      let putSeen = false;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('HOME_SCORECARD') > -1) {
          if (opts && opts.method === 'PUT') { putSeen = true; return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); }
          return Promise.resolve({ ok: true, json: () => Promise.resolve(null) }); // server पर कुछ नहीं (या पुराना) — फिर भी PUT न हो
        }
        return orig(url, opts);
      };
      _hscRetryPublish();
      setTimeout(() => { window.fetch = orig; resolve(putSeen); }, 300);
    }));
    expect(putAttempted).toBe(false);
  });

  test('_hscRetryPublish — JE का device सही तरीके से publish कर सके', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const putAttempted = await page.evaluate(() => new Promise((resolve) => {
      HSC = { curPaid: '10', curAmt: '5', ts: Date.now() };
      const orig = window.fetch;
      let putSeen = false;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('HOME_SCORECARD') > -1) {
          if (opts && opts.method === 'PUT') { putSeen = true; return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); }
          return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
        }
        return orig(url, opts);
      };
      _hscRetryPublish();
      setTimeout(() => { window.fetch = orig; resolve(putSeen); }, 300);
    }));
    expect(putAttempted).toBe(true);
  });

  test('hscFetch — lineman/login-से-पहले वाले device पर पुराना cached data server से "नया" दिखे तो भी hsc-conflict लॉग न हो, बस server अपनाए (bug: बेवजह conflict लॉग + pending फ्लैग हमेशा अटकना)', async ({ page }) => {
    await openApp(page); // अभी login नहीं — CU=null, ठीक वैसे ही जैसे production logs में "(login से पहले)"
    const result = await page.evaluate(() => new Promise((resolve) => {
      localStorage.removeItem('dc_logs3');
      HSC = { curPaid: '10', curAmt: '5', ts: Date.now() }; // device पर पुराना cached data, ts server से नया दिखता है
      _setHscPending(true); // पुराने bug जैसा हाल — गलत pending फ्लैग पहले से अटका
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('HOME_SCORECARD') > -1 && (!opts || !opts.method)) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ curPaid: '20', curAmt: '9', ts: Date.now() - 100000 }) });
        }
        return orig(url, opts);
      };
      hscFetch();
      setTimeout(() => {
        window.fetch = orig;
        resolve({ pending: _hscPending(), conflictLogs: getLogs().filter((e) => e.c === 'hsc-conflict').length, adopted: HSC.curPaid });
      }, 300);
    }));
    expect(result.pending).toBe(false); // पुराना अटका pending फ्लैग साफ़ हुआ
    expect(result.conflictLogs).toBe(0); // बेवजह conflict लॉग नहीं हुआ
    expect(result.adopted).toBe('20'); // server का data अपनाया, अपना पुराना cached data नहीं
  });
});

test.describe('फोन-नंबर मॉडल — दो तरह के संदेश (सामान्य रिमाइंडर / विच्छेदन सूचना धारा 56)', () => {
  test('डिफ़ॉल्ट रूप से "सामान्य रिमाइंडर" चुना हो — नाम सहित सही sms/WhatsApp लिंक बने', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => openPhModal('राम कुमार', '9876543210', 'ACC1', 500));
    const active = await page.evaluate(() => document.querySelector('.ph-mt-btn.active').getAttribute('data-type'));
    expect(active).toBe('reminder');
    const wa = await page.evaluate(() => decodeURIComponent(document.getElementById('ph-wa-btn').href.split('text=')[1]));
    expect(wa).toContain('राम कुमार');
    expect(wa).not.toContain('धारा 56');
  });

  test('"विच्छेदन सूचना" चुनने पर नाम + आदेगांव बिजली वितरण केंद्र सिवनी वाला संदेश बने, और याद रह जाए', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => openPhModal('सीता बाई', '9876500000', 'ACC2', 3107));
    await page.evaluate(() => _phSelectMsgType('disconnect'));
    const wa = await page.evaluate(() => decodeURIComponent(document.getElementById('ph-wa-btn').href.split('text=')[1]));
    expect(wa).toContain('सीता बाई');
    expect(wa).toContain('धारा 56');
    expect(wa).toContain('आदेगांव बिजली वितरण केंद्र सिवनी');
    expect(wa).not.toContain('MPPKVVCL');
    expect(await page.evaluate(() => localStorage.getItem('dc_ph_msgtype'))).toBe('disconnect');
    // मॉडल दोबारा खोलने पर वही (याद किया हुआ) टाइप चुना हो — पर दूसरा विकल्प भी मौजूद रहे
    await page.evaluate(() => closePhModal());
    await page.evaluate(() => openPhModal('गीता देवी', '9876511111', 'ACC3', 800));
    expect(await page.evaluate(() => document.querySelector('.ph-mt-btn.active').getAttribute('data-type'))).toBe('disconnect');
    expect(await page.evaluate(() => document.querySelectorAll('.ph-mt-btn').length)).toBe(2);
    // वापस "सामान्य रिमाइंडर" पर बदल सकें
    await page.evaluate(() => _phSelectMsgType('reminder'));
    expect(await page.evaluate(() => localStorage.getItem('dc_ph_msgtype'))).toBe('reminder');
  });
});

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
        if (typeof url === 'string' && url.indexOf(fbPath(activeHQ, activeCat)) > -1 && (!opts || !opts.method)) count++;
        return orig(url, opts);
      };
      startListen(activeHQ, activeCat); // सिर्फ़ synchronous हिस्सा जांचना है — EventSource async है
      window.fetch = orig;
      return count;
    });
    expect(immediateFetchCount).toBe(0);
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
      confirmUpload();
      return cGet('आदेगांव', 'कुल उपभोक्ता').filter(function (x) { return x.status === 'paid'; }).length;
    });
    expect(r).toBe(0);
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

test.describe('आज की वसूली — मुख्यालय-वार आज के भुगतान का स्कोरकार्ड (JE only)', () => {
  test('openTodayScorecard — खोलते ही network fetch न हो, सिर्फ़ cache से दिखे (bug: हर बार खोलने पर सभी HQ/श्रेणी की पूरी लिस्ट दोबारा डाउनलोड होना)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const fetchCount = await page.evaluate(() => new Promise((resolve) => {
      var count = 0;
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('.json') > -1 && (!opts || !opts.method)) count++;
        return orig(url, opts);
      };
      openTodayScorecard();
      setTimeout(() => { window.fetch = orig; resolve(count); }, 300);
    }));
    expect(fetchCount).toBe(0);
  });

  test('loadTodayScorecard (रिफ्रेश बटन) — force=true के साथ _cashRefreshAll बुलाए, cooldown नज़रअंदाज़ करके', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const forced = await page.evaluate(() => new Promise((resolve) => {
      var seenForce = null;
      const orig = _cashRefreshAll;
      _cashRefreshAll = function (hqs, cb, force) { seenForce = force; cb(); };
      loadTodayScorecard();
      setTimeout(() => { _cashRefreshAll = orig; resolve(seenForce); }, 100);
    }));
    expect(forced).toBe(true);
  });

  test('todaysc-menu-item — lineman को न दिखे', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const linemanHidden = await page.evaluate(() => getComputedStyle(document.getElementById('todaysc-menu-item')).display);
    expect(linemanHidden).toBe('none');
  });

  test('openTodayScorecard — lineman सीधे function बुलाए तो भी न खुले (defense-in-depth)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const opened = await page.evaluate(() => {
      openTodayScorecard();
      return document.getElementById('todaysc-overlay').classList.contains('open');
    });
    expect(opened).toBe(false);
  });

  test('_todayScRow — सिर्फ़ आज की तारीख़ वाले paid records गिने, पुरानी तारीख़ और pending वाले न गिने जाएं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      var today = _todayDateStr();
      var y = new Date(); y.setDate(y.getDate() - 1);
      var yesterday = y.getDate() + '/' + (y.getMonth() + 1) + '/' + y.getFullYear();
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: 'A1', name: 'एक', status: 'paid', paydate: today, amount: '100' },
        { acc: 'A2', name: 'दो', status: 'paid', paydate: yesterday, amount: '200' },
        { acc: 'A3', name: 'तीन', status: 'pending', amount: '300' },
      ]);
      return _todayScRow('आदेगांव');
    });
    expect(r.count).toBe(1);
    expect(r.amt).toBe(100);
  });

  test('_todayScRender — सभी HQ मिलाकर सही योग (total) दिखाए', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      var today = _todayDateStr();
      HQS.forEach(function (hq, i) {
        cSet(hq, 'कुल उपभोक्ता', [{ acc: 'X' + i, name: 'उप ' + i, status: 'paid', paydate: today, amount: '50' }]);
      });
      _todayScRender();
      return { html: document.getElementById('todaysc-content').innerHTML, hqCount: HQS.length };
    });
    expect(r.html).toContain(String(r.hqCount)); // योग count सभी HQ जितना
  });
});

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

test.describe('database.rules.json — HQ_PIN सिर्फ़ JE लिख सके (bug: "$other" के तहत कोई भी authenticated — anonymous समेत — PIN बदल सकता था, लाइनमैन lock-out या account-takeover का खतरा)', () => {
  test('HQ_PIN का अपना explicit rule हो — CAT_NAMES/HOME_SCORECARD जैसा JE-only write, बाक़ी सब पढ़ सकें', () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8'));
    const hqPinRule = rules.rules.HQ_PIN;
    expect(hqPinRule, 'HQ_PIN का अपना top-level rule होना चाहिए — $other के भरोसे नहीं').toBeTruthy();
    expect(hqPinRule['.write']).toBe("auth.token.email === 'pradeepks2015@gmail.com'");
    expect(hqPinRule['.read']).toBe('auth != null'); // login के वक़्त PIN जांचने के लिए सबको पढ़ना ज़रूरी है
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

  test('हर HQ का account सिर्फ़ अपने ही HQ के prefix वाली key लिख सके (लाइनमैन-खाते HQ-वार साझा हैं, इसलिए इससे बारीक पहचान संभव ही नहीं) — पढ़ना सबके लिए खुला रहे', () => {
    const rules = readRules();
    const pp = rules.PROFILE_PHOTOS;
    expect(pp['.read']).toBe('auth != null'); // हर device app खुलते ही अपनी फ़ोटो पढ़ता है
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

test.describe('downloadPDF/downloadExcel — ऊपर चुना filter (सभी/बाकी/वसूल) मानें (bug: "कुल उपभोक्ता" tab पर "बाकी" filter चुने होने पर भी PDF/Excel में पूरी unfiltered list उतरती थी — स्क्रीन पर जो दिख रहा था उससे download मेल नहीं खाता था)', () => {
  test('downloadPDF — "बाकी" filter चुना हो तो सिर्फ़ pending records PDF में जाएं, "वसूल" वाले छूट जाएं', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '1', name: 'राम', status: 'paid', amount: 100 },
        { acc: '2', name: 'श्याम', status: 'pending', amount: 200 },
      ]);
    });
    await loginJE(page);
    const html = await page.evaluate(() => new Promise((resolve) => {
      activeHQ = 'आदेगांव'; activeCat = 'कुल उपभोक्ता'; activeFilter = 'pending';
      window.open = function () {
        return { document: { write: function (h) { resolve(h); }, close: function () {} }, print: function () {} };
      };
      downloadPDF();
    }));
    expect(html).toContain('श्याम');
    expect(html).not.toContain('राम');
    expect(html).toContain('सूची: <b>बाकी</b>'); // हेडर में साफ़ दिखे कि यह पूरी सूची नहीं, फ़िल्टर की हुई है
  });

  test('downloadPDF — "वसूल" filter चुना हो तो सिर्फ़ paid records आएं', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '1', name: 'राम', status: 'paid', amount: 100 },
        { acc: '2', name: 'श्याम', status: 'pending', amount: 200 },
      ]);
    });
    await loginJE(page);
    const html = await page.evaluate(() => new Promise((resolve) => {
      activeHQ = 'आदेगांव'; activeCat = 'कुल उपभोक्ता'; activeFilter = 'paid';
      window.open = function () {
        return { document: { write: function (h) { resolve(h); }, close: function () {} }, print: function () {} };
      };
      downloadPDF();
    }));
    expect(html).toContain('राम');
    expect(html).not.toContain('श्याम');
  });

  test('downloadPDF — "सभी" filter में पुराना व्यवहार वैसा ही रहे (सब records आएं, हेडर में filter-लेबल न जुड़े)', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '1', name: 'राम', status: 'paid', amount: 100 },
        { acc: '2', name: 'श्याम', status: 'pending', amount: 200 },
      ]);
    });
    await loginJE(page);
    const html = await page.evaluate(() => new Promise((resolve) => {
      activeHQ = 'आदेगांव'; activeCat = 'कुल उपभोक्ता'; activeFilter = 'all';
      window.open = function () {
        return { document: { write: function (h) { resolve(h); }, close: function () {} }, print: function () {} };
      };
      downloadPDF();
    }));
    expect(html).toContain('राम');
    expect(html).toContain('श्याम');
    expect(html).not.toContain('सूची: <b>');
  });

  test('downloadExcel — फ़िल्टर की हुई rows ही sheet में जाएं, filter नाम फ़ाइल/sheet-नाम में जुड़े', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '1', name: 'राम', status: 'paid', amount: 100 },
        { acc: '2', name: 'श्याम', status: 'pending', amount: 200 },
      ]);
    });
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      activeHQ = 'आदेगांव'; activeCat = 'कुल उपभोक्ता'; activeFilter = 'pending';
      var sheet = null;
      window.XLSX = {
        utils: {
          book_new: function () { return { SheetNames: [], Sheets: {} }; },
          aoa_to_sheet: function (a) { sheet = a; return { rows: a }; },
          book_append_sheet: function (wb, ws, nm) { wb.SheetNames.push(nm); wb.Sheets[nm] = ws; },
        },
        writeFile: function (wb, fname) { resolve({ sheetName: wb.SheetNames[0], fname: fname, rows: sheet }); },
      };
      downloadExcel();
    }));
    expect(r.rows.length).toBe(2); // header + 1 filtered record
    expect(r.rows[1][3]).toBe('2'); // श्याम का acc — राम (paid) नहीं आया
    expect(r.sheetName).toContain('बाकी');
    expect(r.fname).toContain('बाकी');
  });
});

test.describe('downloadPDF — कॉलम एलाइनमेंट (bug: table-layout auto होने से content के हिसाब से हर कॉलम की चौड़ाई पेज-दर-पेज बदलती थी, नाम/मोबाइल जैसे कॉलम header से मेल नहीं खाते दिखते थे)', () => {
  test('table-layout:fixed हो, हर <th> पर width% तय हो, रिमार्क को सबसे ज़्यादा चौड़ाई मिले, और नाम/मोबाइल जैसे कॉलम center-aligned हों', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [{ acc: '1', name: 'राम', phone: '9999999999', father: 'श्याम', status: 'pending', amount: 100 }]);
    });
    await loginJE(page);
    const html = await page.evaluate(() => new Promise((resolve) => {
      activeHQ = 'आदेगांव'; activeCat = 'कुल उपभोक्ता'; activeFilter = 'all';
      window.open = function () {
        return { document: { write: function (h) { resolve(h); }, close: function () {} }, print: function () {} };
      };
      downloadPDF();
    }));
    expect(html).toContain('table-layout:fixed');
    expect(html).toMatch(/<th style='width:13%'>नाम<\/th>/);
    expect(html).toMatch(/<th style='width:10%'>Mobile<\/th>/);
    // रिमार्क की चौड़ाई बाक़ी किसी भी data-कॉलम से ज़्यादा हो
    const widths = [...html.matchAll(/<th style='width:(\d+)%'>/g)].map((m) => Number(m[1]));
    const rmkWidth = /<th style='width:(\d+)%'>रिमार्क<\/th>/.exec(html);
    expect(rmkWidth).toBeTruthy();
    expect(Number(rmkWidth[1])).toBe(Math.max(...widths));
    // data row में नाम/मोबाइल सेल center-aligned हों (header से मेल खाकर दिखें)
    expect(html).toContain("text-align:center;font-weight:600;'>राम<");
    expect(html).toContain("text-align:center;color:#333;'>9999999999<");
    // दो-लाइन वाले सेल पड़ोसी row में न घुसें, इसलिए हर td top-aligned हो
    expect(html).toContain('vertical-align:top');
  });
});

test.describe('XSS सुरक्षा — PDF/print export और दिनांक-वार तालिका (bug: consumer name/remarks — जिसमें remarks लाइनमैन का free-typed text है — बिना escHtml के document.write()/innerHTML में जाकर असली स्क्रिप्ट चला सकते थे)', () => {
  test('downloadPDF (upload.js) — consumer name और remarks में स्क्रिप्ट-जैसा टेक्स्ट हो तो PDF-HTML में escape होकर जाए, असली <script>/<img onerror> न बचे', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [{
        acc: '1', name: '<img src=x onerror=alert(1)>', father: '<b>पिता</b>', phone: '9999999999',
        status: 'pending', amount: 100,
        remarksArr: [{ text: '<script>alert(2)</script>', by: '<b>कोई</b>' }],
      }]);
    });
    await loginJE(page);
    const html = await page.evaluate(() => new Promise((resolve) => {
      activeHQ = 'आदेगांव'; activeCat = 'कुल उपभोक्ता';
      window.open = function () {
        return { document: { write: function (h) { resolve(h); }, close: function () {} }, print: function () {} };
      };
      downloadPDF();
    }));
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script>alert(2)</script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
  });

  test('downloadScPDF (reports.js) — दिनांक-वार PDF में consumer name/Consumer No escape होकर जाएं', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [{ acc: '<script>alert(3)</script>', name: '<img src=x onerror=alert(4)>', status: 'paid', amount: 100, paydate: '1/1/2026' }]);
    });
    await loginJE(page);
    const html = await page.evaluate(() => new Promise((resolve) => {
      window.open = function () {
        return { document: { write: function (h) { resolve(h); }, close: function () {} }, print: function () {} };
      };
      downloadScPDF();
    }));
    expect(html).not.toContain('<script>alert(3)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(4)>');
  });

  test('renderScDateTable (स्क्रीन पर दिनांक-वार तालिका) — consumer name/Consumer No escape होकर दिखें', async ({ page }) => {
    await openApp(page);
    const html = await page.evaluate(() => {
      scActiveHQ = 'आदेगांव';
      var rec = { acc: '<script>alert(5)</script>', name: '<img src=x onerror=alert(6)>', status: 'paid', amount: 100, paydate: '1/1/2026' };
      cSet('आदेगांव', 'कुल उपभोक्ता', [rec]); // renderScDateTable इसी master-list से acc मिलान करके फ़िल्टर करता है
      renderScDateTable([rec]);
      return document.getElementById('sc-body').innerHTML;
    });
    expect(html).not.toContain('<script>alert(5)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(6)>');
  });

  test('renderListWith — con-card के onclick="...(\'...\')" में escHtml काफ़ी नहीं (सिंगल-कोट को browser वापस decode कर देता है), escJsAttr चाहिए', async ({ page }) => {
    await openApp(page);
    const html = await page.evaluate(() => {
      activeHQ = 'आदेगांव'; activeCat = 'कुल उपभोक्ता';
      var rec = { acc: "x');alert(7);//", name: "O'Brien", phone: "9'999999999", status: 'pending', amount: 100 };
      cSet('आदेगांव', 'कुल उपभोक्ता', [rec]);
      renderListWith([rec]);
      return document.getElementById('con-list').innerHTML;
    });
    // असली breakout होता तो onclick="openAccModal('x');alert(7);//')" जैसा टूटा हुआ attribute बनता —
    // escJsAttr सिंगल-कोट को \' में बदलकर JS string को समय से पहले बंद होने से रोकता है
    expect(html).not.toContain("openAccModal('x');alert(7);//');");
    expect(html).not.toContain("openPhModal('O'Brien'");
    expect(html).toContain("openAccModal('x\\');alert(7);//')");
    expect(html).toContain("openPhModal('O\\'Brien','9\\'999999999'");
    // प्लेन टेक्स्ट (display) कॉपी में escHtml अब ' को &#39; कर देता है — पर browser उसे parse करके
    // वापस साधारण ' के तौर पर दिखाता है (round-trip में कुछ नहीं टूटता, इंसान को कोई फ़र्क़ नहीं दिखता)
    expect(html).toContain('<div class="cc-name">O\'Brien</div>');
  });

  test('renderSummaryWith — श्रेणी का नाम (JE बदल सकते हैं) innerHTML में escape होकर जाए (bug: eslint-plugin-no-unsanitized ऑडिट में मिला — नाम validation सिर्फ़ Firebase-असुरक्षित चिह्न रोकती है, HTML-special चिह्न नहीं)', async ({ page }) => {
    await openApp(page);
    const html = await page.evaluate(() => {
      activeCat = "<img src=x onerror=alert(9)>";
      renderSummaryWith([]);
      return document.getElementById('summary').innerHTML;
    });
    expect(html).not.toContain('<img src=x onerror=alert(9)>');
    expect(html).toContain('&lt;img src=x onerror=alert(9)&gt;');
  });

  test('escHtml अब सिंगल-कोट (\') को भी escape करता है — openPinModal जैसे single-quoted attribute (value=\'...\') में breakout से बचाव (bug: HQ_PIN फ़ील्ड पर digit-only validation नहीं, JE कुछ भी टाइप कर सकता है)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    // .innerHTML पढ़ने पर browser हमेशा double-quote में serialize कर देता है (चाहे source में
    // single-quote हो), तो असली सुरक्षा साबित करने के लिए parsed DOM attribute ही सही जांच है —
    // अगर breakout हुआ होता तो एक अलग असली onmouseover attribute बन जाता
    const result = await page.evaluate(() => {
      HQ_PINS[hqKey('आदेगांव')] = "1' onmouseover='alert(8)";
      openPinModal();
      var el = document.getElementById('pin-आदेगांव');
      return { value: el.value, hasOnmouseover: el.getAttribute('onmouseover') !== null };
    });
    expect(result.hasOnmouseover).toBe(false);
    expect(result.value).toBe("1' onmouseover='alert(8)");
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
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'migration.js'), 'utf8');
    const dry = src.slice(src.indexOf('function _migRunDryRun'), src.indexOf('function _migRender'));
    expect(dry).not.toContain('_etagHeaders');
    expect(dry).not.toContain('if-none-match');
    expect(dry).toContain('trackUsageOf(d)'); // भारी है, पर मीटर में गिना जाता है — छिपा नहीं
  });

  test('सभी भारी डाउनलोड रास्तों पर गिनती लगी हो (SSE/prefetch/चरण-3 छूटे नहीं)', async () => {
    const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    expect(read('js/database.js')).toContain('trackUsageOf(d); // SSE');       // live sync — सबसे भारी
    expect(read('js/database.js')).toContain('trackUsageOf(patchData)');       // SSE patch
    expect(read('js/storage.js').match(/trackUsageOf\(d\)/g).length).toBe(2);  // prefetch + flushPending
    expect(read('js/migration.js').match(/trackUsageOf\(/g).length).toBe(3);   // चरण-3 जाँच + _migrateOne + MIGRATED
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
      'js/ui-core.js': ['trackUsageOf(d)'],                       // HQ_PIN
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

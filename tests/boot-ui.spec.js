// @ts-check
// वसूली ट्रैकर — टेस्ट: boot-ui (साझा helpers: tests/helpers.js)
const { test, expect, openApp, loginLineman, reloadAndWaitForApp, loginJE } = require('./helpers');

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
    await reloadAndWaitForApp(page);
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
    await reloadAndWaitForApp(page);
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
      openVoiceScorecard(); results.push(document.getElementById('voicesc-overlay').classList.contains('open')); closeVoiceScorecard();
      openMigModal(); results.push(document.getElementById('mig-overlay').classList.contains('open')); closeMigModal();
      return results;
    });
    expect(ok).toEqual([true, true, true, true, true, true, true, true, true]);
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

  test('स्कोरकार्ड (buildScOverview) — negative बकाया (advance/credit) वाले "वसूल" record गिनती में गिनें, पर राशि-जोड़ में उनका योगदान 0 माना जाए (bug: 11/9 को पिंडरई में "वसूल राशि" ही negative दिख गई थी)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const txt = await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '1', status: 'paid', amount: 100 },
        { acc: '2', status: 'paid', amount: -500 }, // advance/credit balance — बकायादार नहीं
      ]);
      buildScOverview(['आदेगांव']);
      return document.getElementById('sc-overview').textContent;
    });
    expect(txt).toContain('2✅ वसूल'); // दोनों "वसूल"/निपटे हुए गिने गए
    expect(txt).toContain('₹100वसूल राशि'); // राशि सिर्फ़ +100 — -500 का योगदान 0 माना गया, राशि negative नहीं हुई
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

  test('दिनांक-वार वसूली (renderScDateTable) — negative बकाया (advance) वाले paid record का योगदान उस दिन की राशि में 0 माना जाए, राशि कभी negative न दिखे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const txt = await page.evaluate(() => {
      scActiveHQ = 'आदेगांव';
      var today = _todayDateStr();
      var master = [
        { acc: '1', name: 'राम', status: 'paid', amount: 500, paydate: today },
        { acc: '2', name: 'श्याम', status: 'paid', amount: -800, paydate: today }, // advance
      ];
      cSet('आदेगांव', 'कुल उपभोक्ता', master);
      renderScDateTable(master);
      return document.getElementById('sc-body').innerHTML;
    });
    expect(txt).toContain('₹500'); // सिर्फ़ +500 — -800 का योगदान 0 माना गया
    expect(txt).not.toContain('-300'); // असली bug: 500-800=-300 जैसा जोड़ नहीं होना चाहिए
    expect(txt).not.toContain('₹-'); // राशि कहीं भी negative चिह्न के साथ न दिखे
  });

  // तालिका में "उपभोक्ता"/"Consumer No" दो बार कटते हैं (पहले सिर्फ़ 3, फिर max-width+ellipsis) —
  // असली रिपोर्ट में एक दिन में 86 उपभोक्ता थे, JE उनमें से 3 भी पूरे नहीं देख पाते थे
  test('तारीख़ पर टैप → उस दिन के सारे उपभोक्ता और पूरे Consumer No दिखें (एक भी न छूटे)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      scActiveHQ = 'आदेगांव';
      // दो अलग-अलग तारीख़ें — दोनों चालू बिलिंग-चक्र खिड़की (_scCycleWindow) के अंदर पक्का रहें,
      // इसलिए "आज" के सापेक्ष (हार्डकोड तारीख़ महीना बदलते ही खिड़की से बाहर निकल जाती)
      var d2 = new Date(); d2.setDate(d2.getDate() - 2);
      var day1 = d2.getDate() + '/' + (d2.getMonth() + 1) + '/' + d2.getFullYear();
      var day2 = _todayDateStr();
      var master = [];
      for (var i = 0; i < 40; i++) master.push({ acc: '11340' + (10000 + i), name: 'उपभोक्ता ' + i, status: 'paid', amount: 100, paydate: day1 });
      master.push({ acc: '9999', name: 'अकेला', status: 'paid', amount: 50, paydate: day2 });
      cSet('आदेगांव', 'कुल उपभोक्ता', master);
      renderScDateTable(cGet('आदेगांव', 'कुल उपभोक्ता'));
      var rows = document.querySelectorAll('#sc-body tr.sc-day-row');
      openScDayModal(SC_DAY_DATES.indexOf(day1));
      var el = document.getElementById('scday-content');
      var txt = el.textContent;
      var chips = el.querySelectorAll('.chip-acc').length;
      var open = document.getElementById('scday-overlay').classList.contains('open');
      closeScDayModal();
      return { clickable: rows.length, chips: chips, open: open, txt: txt,
        title: document.getElementById('scday-title').textContent,
        sub: document.getElementById('scday-sub').textContent,
        closed: !document.getElementById('scday-overlay').classList.contains('open'), day1: day1 };
    });
    expect(r.clickable).toBe(2);            // दोनों तारीख़ें दबाने लायक
    expect(r.open).toBe(true);
    expect(r.chips).toBe(40);               // सारे 40 — कोई "+37" नहीं
    expect(r.txt).toContain('1134010000');  // पहला पूरा नंबर
    expect(r.txt).toContain('1134010039');  // आख़िरी भी पूरा
    expect(r.txt).toContain('उपभोक्ता 39');
    expect(r.title).toContain(r.day1);
    expect(r.sub).toContain('40 उपभोक्ता');
    expect(r.closed).toBe(true);
  });

  test('सूची में नाम/नंबर टेक्स्ट ही रहें — HTML हो तो भी markup न बने', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      scActiveHQ = 'आदेगांव';
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: "5'><img src=x onerror=alert(1)>", name: '<img src=y onerror=alert(2)>', status: 'paid', amount: 10, paydate: _todayDateStr() },
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
        { acc: '7001', name: 'नंबर वाला', status: 'paid', amount: 10, paydate: _todayDateStr() },
        { name: 'बिना नंबर वाला', status: 'paid', amount: 20, paydate: _todayDateStr() },
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

test.describe('स्कोरकार्ड "दिनांक-वार वसूली" अब चालू बिलिंग-चक्र तक सीमित (bug: जुलाई/अगस्त जैसे पुराने महीनों की वसूली भी गिन ली जाती थी, जिससे चालू चक्र की प्रगति भ्रामक दिखती — JE: मीटर-रीडिंग 24 तारीख़ से शुरू होकर अगले महीने 8-9 तक चलती है, नया लेजर 10 को आता है, 25-महीना-अंत के बीच के भुगतान भी अगले चक्र के गिने जाने चाहिए — इसलिए खिड़की पिछले महीने की 27 से आज तक)', () => {
  test('चक्र-खिड़की से पुराना भुगतान (70 दिन पहले) — तालिका/कुल में न गिने', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const txt = await page.evaluate(() => {
      scActiveHQ = 'आदेगांव';
      var old = new Date(); old.setDate(old.getDate() - 70); // हमेशा सबसे बड़ी संभव खिड़की (~35 दिन) से भी पुराना
      var oldDate = old.getDate() + '/' + (old.getMonth() + 1) + '/' + old.getFullYear();
      var master = [{ acc: '1', name: 'पुराना', status: 'paid', amount: 100, paydate: oldDate }];
      cSet('आदेगांव', 'कुल उपभोक्ता', master);
      renderScDateTable(master);
      return document.getElementById('sc-body').textContent;
    });
    expect(txt).toContain('कोई वसूली नहीं');
  });

  test('चक्र-खिड़की की शुरुआत (पिछले महीने की 27) पर हुआ भुगतान गिना जाए — सीमा-रेखा शामिल', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const txt = await page.evaluate(() => {
      scActiveHQ = 'आदेगांव';
      var t = new Date();
      var boundary = new Date(t.getFullYear(), t.getMonth() - 1, 27);
      var boundaryDate = boundary.getDate() + '/' + (boundary.getMonth() + 1) + '/' + boundary.getFullYear();
      var master = [{ acc: '1', name: 'सीमारेखा', status: 'paid', amount: 100, paydate: boundaryDate }];
      cSet('आदेगांव', 'कुल उपभोक्ता', master);
      renderScDateTable(master);
      return document.getElementById('sc-body').textContent;
    });
    expect(txt).toContain('सीमारेखा');
    expect(txt).toContain('1 / 1'); // वसूल/कुल — गिना गया
  });

  test('चक्र-खिड़की से ठीक एक दिन पहले (पिछले महीने की 26) का भुगतान न गिने', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const txt = await page.evaluate(() => {
      scActiveHQ = 'आदेगांव';
      var t = new Date();
      var beforeBoundary = new Date(t.getFullYear(), t.getMonth() - 1, 26);
      var d = beforeBoundary.getDate() + '/' + (beforeBoundary.getMonth() + 1) + '/' + beforeBoundary.getFullYear();
      var master = [{ acc: '1', name: 'सीमारेखा-से-पहले', status: 'paid', amount: 100, paydate: d }];
      cSet('आदेगांव', 'कुल उपभोक्ता', master);
      renderScDateTable(master);
      return document.getElementById('sc-body').textContent;
    });
    expect(txt).toContain('कोई वसूली नहीं');
  });

  test('renderScBody का header चालू चक्र की तारीख़-सीमा दिखाए', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      scActiveHQ = 'आदेगांव';
      renderScBody();
      return { hdr: document.getElementById('sc-date-hdr').textContent, label: _scCycleWindow().label };
    });
    expect(r.hdr).toContain('चालू चक्र');
    expect(r.hdr).toContain(r.label);
  });

  test('downloadScPDF — पुराना (चक्र-खिड़की से बाहर) भुगतान वाली HQ का सेक्शन ही न बने', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      var old = new Date(); old.setDate(old.getDate() - 70);
      var oldDate = old.getDate() + '/' + (old.getMonth() + 1) + '/' + old.getFullYear();
      cSet('आदेगांव', 'कुल उपभोक्ता', [{ acc: '1', name: 'पुराना', status: 'paid', amount: 100, paydate: oldDate }]);
    });
    await loginJE(page);
    const html = await page.evaluate(() => new Promise((resolve) => {
      window.open = function () {
        return { document: { write: function (h) { resolve(h); }, close: function () {} }, print: function () {} };
      };
      downloadScPDF();
    }));
    expect(html).not.toContain('पुराना');
    expect(html).not.toContain('📍 आदेगांव');
  });
});

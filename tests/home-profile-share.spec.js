// @ts-check
// वसूली ट्रैकर — टेस्ट: home-profile-share (साझा helpers: tests/helpers.js)
const { test, expect, fs, path, openApp, loginLineman, loginJE } = require('./helpers');

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

  test('फ़ोटो हटाने का बटन — फ़ोटो न हो तो छुपा रहे, फ़ोटो हो तो दिखे और DELETE भेजकर avatar वापस initial पर लौटे', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => document.getElementById('update-banner')?.remove());
    await page.click('button[onclick="openProfileModal()"]');
    // पहली बार कोई फ़ोटो नहीं — बटन छुपा हो
    expect(await page.locator('#profile-photo-remove-btn').isVisible()).toBe(false);

    // फ़ोटो cache में डालकर फिर से खोलें, ताकि बटन दिखे (असली अपलोड ऊपर वाले test में पहले ही जांचा जा चुका है)।
    // मॉडल पहले से खुली है, इसलिए trigger बटन को दोबारा क्लिक करने की बजाय सीधे function बुलाएं
    // (वरना overlay उसी बटन के ऊपर होने से क्लिक इंटरसेप्ट हो जाता है)
    await page.evaluate(() => { _profilePhotoCache = 'data:image/jpeg;base64,xyz'; openProfileModal(); });
    expect(await page.locator('#profile-photo-remove-btn').isVisible()).toBe(true);

    let deleteMethod = null;
    await page.route('**/PROFILE_PHOTOS/**', async (route) => {
      deleteMethod = route.request().method();
      await route.fulfill({ status: 200, body: '{}' });
    });
    page.on('dialog', (d) => d.accept()); // "फ़ोटो हटाना चाहते हैं?"
    await page.click('#profile-photo-remove-btn');
    await page.waitForFunction(() => document.getElementById('profile-photo-remove-btn').style.display === 'none', null, { timeout: 5000 });

    expect(deleteMethod).toBe('DELETE');
    expect(await page.evaluate(() => _profilePhotoCache)).toBeNull();
    expect(await page.locator('#profile-photo-remove-btn').isVisible()).toBe(false);
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
    expect(await page.evaluate(() => document.querySelectorAll('.ph-mt-btn').length)).toBe(3);
    // वापस "सामान्य रिमाइंडर" पर बदल सकें
    await page.evaluate(() => _phSelectMsgType('reminder'));
    expect(await page.evaluate(() => localStorage.getItem('dc_ph_msgtype'))).toBe('reminder');
  });

  test('"अपना संदेश" बटन सिर्फ़ select करता है — किसी के लिए भी (JE/lineman) box नहीं खुलता, सेव किया संदेश तुरंत SMS/WhatsApp में जाए', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => { PH_CUSTOM_MSG = { text: 'सूचना: तालाब किनारे अवैध अतिक्रमण हटाएं', by: 'Pradeep', at: '1/1/2026, 10:00 am' }; });
    await page.evaluate(() => openPhModal('मोहन लाल', '9876522222', 'ACC4', 900));
    await page.evaluate(() => _phSelectMsgType('custom'));
    const r = await page.evaluate(() => ({
      boxShown: document.getElementById('ph-custom-wrap').style.display,
      active: document.querySelector('.ph-mt-btn.active').getAttribute('data-type'),
    }));
    expect(r.boxShown).toBe('none'); // lineman के लिए box कभी नहीं खुलता
    expect(r.active).toBe('custom');
    const wa = await page.evaluate(() => decodeURIComponent(document.getElementById('ph-wa-btn').href.split('text=')[1]));
    expect(wa).toBe('सूचना: तालाब किनारे अवैध अतिक्रमण हटाएं'); // कोई नाम/बकाया अपने-आप नहीं जुड़ा
  });

  test('✏️ edit-बटन — lineman को दिखता ही नहीं, JE को दिखे और दबाने पर box खुले', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => openPhModal('मोहन लाल', '9876522222', 'ACC4', 900));
    expect(await page.evaluate(() => document.getElementById('ph-mt-edit-btn').style.display)).toBe('none');
    // lineman सीधे function बुला भी ले तो भी toast से मना हो, box न खुले
    await page.evaluate(() => _phOpenCustomEdit());
    expect(await page.evaluate(() => document.getElementById('ph-custom-wrap').style.display)).toBe('none');
  });

  test('JE ✏️ दबाए तो box खुले (पिछला सेव किया संदेश भरा मिले), सेव करते ही box अपने-आप बंद हो जाए और PH_CUSTOM_MSG अपडेट हो', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => { PH_CUSTOM_MSG = { text: 'पुराना संदेश', by: 'X', at: 'Y' }; });
    await page.evaluate(() => openPhModal('गीता', '9876544444', 'ACC6', 0));
    expect(await page.evaluate(() => document.getElementById('ph-mt-edit-btn').style.display)).toBe('flex');
    expect(await page.evaluate(() => document.getElementById('ph-custom-wrap').style.display)).toBe('none'); // खुलते ही box बंद हो
    await page.evaluate(() => _phOpenCustomEdit());
    expect(await page.evaluate(() => document.getElementById('ph-custom-text').value)).toBe('पुराना संदेश');
    expect(await page.evaluate(() => document.getElementById('ph-custom-wrap').style.display)).toBe('block');

    const r = await page.evaluate(() => new Promise((resolve) => {
      let putBody = null;
      const orig = window.fetch;
      window.fetch = function (u, o) {
        if (String(u).indexOf('/PH_CUSTOM_MSG.json') > -1 && o && o.method === 'PUT') {
          putBody = JSON.parse(o.body);
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(putBody) });
        }
        return orig(u, o);
      };
      document.getElementById('ph-custom-text').value = 'योजना: नई सोलर सब्सिडी योजना लागू — कार्यालय संपर्क करें।';
      _phSaveCustomMsg();
      setTimeout(() => { window.fetch = orig; resolve({ putBody: putBody, msg: PH_CUSTOM_MSG, boxShown: document.getElementById('ph-custom-wrap').style.display }); }, 200);
    }));
    expect(r.putBody.text).toBe('योजना: नई सोलर सब्सिडी योजना लागू — कार्यालय संपर्क करें।');
    expect(r.putBody.by).toBe('टेस्ट जेई'); // loginJE का नाम — देखें loginJE() हेल्पर
    expect(r.msg.text).toBe(r.putBody.text); // local PH_CUSTOM_MSG भी उसी वक़्त अपडेट हुआ
    expect(r.boxShown).toBe('none'); // सेव होते ही box अपने-आप बंद
  });

  test('"रद्द करें" — box बिना सेव किए बंद हो जाए, PH_CUSTOM_MSG न बदले', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => { PH_CUSTOM_MSG = { text: 'असली संदेश', by: 'X', at: 'Y' }; });
    await page.evaluate(() => openPhModal('गीता', '9876544444', 'ACC6', 0));
    await page.evaluate(() => _phOpenCustomEdit());
    await page.evaluate(() => { document.getElementById('ph-custom-text').value = 'बिना सेव किया बदलाव'; });
    await page.evaluate(() => _phCloseCustomEdit());
    expect(await page.evaluate(() => document.getElementById('ph-custom-wrap').style.display)).toBe('none');
    expect(await page.evaluate(() => PH_CUSTOM_MSG.text)).toBe('असली संदेश'); // बदला नहीं
  });

  test('"अपना संदेश" — lineman _phSaveCustomMsg/_phOpenCustomEdit सीधे बुलाए तो भी Firebase पर कुछ न लिखे', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await page.evaluate(() => {
      var puts = 0;
      var orig = window.fetch;
      window.fetch = function (u, o) { if (String(u).indexOf('/PH_CUSTOM_MSG.json') > -1 && o && o.method === 'PUT') puts++; return orig(u, o); };
      _phSaveCustomMsg();
      window.fetch = orig;
      return puts;
    });
    expect(r).toBe(0);
  });

  test('"अपना संदेश" — दूसरे device पर JE का बदलाव आते ही (fetchPhCustomMsgFromFB) खुले box में तुरंत दिखे, बीच टाइपिंग में न छेड़े; box बंद हो तो कुछ न छेड़े', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => openPhModal('श्याम', '9876555555', 'ACC7', 0));
    // box अभी बंद है — इसी बीच PH_CUSTOM_MSG बदल जाए (जैसे दूसरे device से), _phRefreshCustomView
    // यहां कुछ न छेड़े (box बंद है, textarea को touch करने की ज़रूरत ही नहीं) — पर बाद में box
    // खुलने पर नया (ताज़ा) मान ज़रूर दिखे
    await page.evaluate(() => { PH_CUSTOM_MSG = { text: 'बीच में बदला संदेश', by: 'Y', at: 'Z' }; _phRefreshCustomView(); });
    await page.evaluate(() => _phOpenCustomEdit());
    expect(await page.evaluate(() => document.getElementById('ph-custom-text').value)).toBe('बीच में बदला संदेश'); // box खुलते ही ताज़ा मिला
    // _phOpenCustomEdit() खुद textarea को focus कर देता है (JE तुरंत टाइप कर सकें) — यहां सिर्फ़
    // "box खुला है पर अभी टाइप नहीं हो रहा" जांचना है, इसलिए वही focus हटा दें
    await page.evaluate(() => document.getElementById('ph-custom-text').blur());

    const r1 = await page.evaluate(() => new Promise((resolve) => {
      const orig = window.fetch;
      window.fetch = function (u, o) {
        if (String(u).indexOf('/PH_CUSTOM_MSG.json') > -1 && (!o || !o.method)) {
          return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({ text: 'नया संदेश दूसरे device से', by: 'JE', at: 'अभी' }) });
        }
        return orig(u, o);
      };
      fetchPhCustomMsgFromFB();
      setTimeout(() => { window.fetch = orig; resolve(document.getElementById('ph-custom-text').value); }, 150);
    }));
    expect(r1).toBe('नया संदेश दूसरे device से'); // box खुला था — live update दिखा
    // अभी टाइप कर रहे हों — तभी एक और live update आ जाए
    const r2 = await page.evaluate(() => {
      PH_CUSTOM_MSG = { text: 'कुछ और', by: 'X', at: 'Y' };
      const ta = document.getElementById('ph-custom-text');
      ta.value = 'JE अभी यही टाइप कर रहा है...';
      ta.focus();
      _phRefreshCustomView();
      return ta.value;
    });
    expect(r2).toBe('JE अभी यही टाइप कर रहा है...'); // focus में होने से नहीं बदला
  });

  test('"अपना संदेश" बटन का नाम भी JE बदल सकते हैं — कुछ सेव न हुआ हो तो डिफ़ॉल्ट "अपना संदेश" दिखे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => { PH_CUSTOM_MSG = { text: '', label: '', by: '', at: '' }; });
    await page.evaluate(() => openPhModal('गीता', '9876544444', 'ACC6', 0));
    expect(await page.evaluate(() => document.getElementById('ph-mt-custom-btn').textContent)).toBe('अपना संदेश');
  });

  test('JE label टाइप करके सेव करे तो बटन पर वही नाम दिखे, और अगली बार मॉडल खुलने पर भी वही रहे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => { PH_CUSTOM_MSG = { text: 'तालाब किनारे अतिक्रमण हटाएं', label: '', by: 'X', at: 'Y' }; });
    await page.evaluate(() => openPhModal('गीता', '9876544444', 'ACC6', 0));
    await page.evaluate(() => _phOpenCustomEdit());
    expect(await page.evaluate(() => document.getElementById('ph-custom-label').value)).toBe(''); // पहले कोई label सेव नहीं थी
    // टाइप करते ही तुरंत बटन पर भी दिखे (सेव होने से पहले ही, इसी device पर)
    await page.fill('#ph-custom-label', 'अतिक्रमण सूचना');
    await page.evaluate(() => document.getElementById('ph-custom-label').dispatchEvent(new Event('input')));
    expect(await page.evaluate(() => document.getElementById('ph-mt-custom-btn').textContent)).toBe('अतिक्रमण सूचना');

    const r = await page.evaluate(() => new Promise((resolve) => {
      let putBody = null;
      const orig = window.fetch;
      window.fetch = function (u, o) {
        if (String(u).indexOf('/PH_CUSTOM_MSG.json') > -1 && o && o.method === 'PUT') {
          putBody = JSON.parse(o.body);
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(putBody) });
        }
        return orig(u, o);
      };
      _phSaveCustomMsg();
      setTimeout(() => { window.fetch = orig; resolve({ putBody: putBody }); }, 200);
    }));
    expect(r.putBody.label).toBe('अतिक्रमण सूचना');

    // मॉडल बंद करके दोबारा खोलें — पुराना cache नहीं, ताज़ा (अभी सेव किया) label ही दिखे
    await page.evaluate(() => closePhModal());
    await page.evaluate(() => openPhModal('गीता', '9876544444', 'ACC6', 0));
    expect(await page.evaluate(() => document.getElementById('ph-mt-custom-btn').textContent)).toBe('अतिक्रमण सूचना');
  });

  test('lineman को label बदलने का कोई रास्ता नहीं — edit-बटन ही नहीं दिखता, पर JE का सेव किया नाम बटन पर दिखे', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => { PH_CUSTOM_MSG = { text: 'सूचना', label: 'योजना प्रचार', by: 'Pradeep', at: '1/1/2026' }; });
    await page.evaluate(() => openPhModal('मोहन लाल', '9876522222', 'ACC4', 900));
    expect(await page.evaluate(() => document.getElementById('ph-mt-custom-btn').textContent)).toBe('योजना प्रचार');
    expect(await page.evaluate(() => document.getElementById('ph-mt-edit-btn').style.display)).toBe('none');
  });

  test('दूसरे device से JE का बदला हुआ label live आते ही बटन पर दिखे (मॉडल खुली हो तब भी)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => { PH_CUSTOM_MSG = { text: 'पुराना', label: 'पुराना नाम', by: 'X', at: 'Y' }; });
    await page.evaluate(() => openPhModal('मोहन लाल', '9876522222', 'ACC4', 900));
    expect(await page.evaluate(() => document.getElementById('ph-mt-custom-btn').textContent)).toBe('पुराना नाम');
    await page.evaluate(() => new Promise((resolve) => {
      const orig = window.fetch;
      window.fetch = function (u, o) {
        if (String(u).indexOf('/PH_CUSTOM_MSG.json') > -1 && (!o || !o.method)) {
          return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({ text: 'नया', label: 'नया नाम', by: 'JE', at: 'अभी' }) });
        }
        return orig(u, o);
      };
      fetchPhCustomMsgFromFB();
      setTimeout(() => { window.fetch = orig; resolve(); }, 150);
    }));
    expect(await page.evaluate(() => document.getElementById('ph-mt-custom-btn').textContent)).toBe('नया नाम');
  });
});

// JE का अनुरोध: उपभोक्ता card सीधे WhatsApp पर शेयर हो — ऐप में जैसा दिखता है वही (फ़ोटो) + टेक्स्ट,
// मोबाइल नंबर और सारे रिमार्क समेत; बटन सबको दिखे; Firebase का कोई खर्च नहीं
test.describe('📤 उपभोक्ता card शेयर', () => {
  const seedCard = async (page, login) => {
    await openApp(page);
    await page.evaluate(() => {
      cSet(HQS[0], 'कुल उपभोक्ता', [
        { acc: '1134019486', name: 'ASADU LAL', father: 'SAUUA GOND', phone: '8224893808', amount: 10098, status: 'pending', addr: 'JAMUA', tariff: 'LV1.2', load: '0.75', unit: 'KW',
          remarksArr: [{ text: 'लाइन काटी थी', by: 'Vishnu', at: '24/9/2026' }, { text: 'सी फॉर्म में दिया गया', by: 'Vishnu', at: '24/9/2026' }] },
      ]);
    });
    await login(page);
    await page.waitForFunction(() => document.querySelectorAll('.con-card').length > 0, null, { timeout: 15000 });
  };

  for (const [who, login] of [['लाइनमैन', loginLineman], ['JE', loginJE]]) {
    test(`हर card पर शेयर का तीर दिखे (${who})`, async ({ page }) => {
      await seedCard(page, login);
      await expect(page.locator('.con-card .cc-share').first()).toBeVisible();
    });
  }

  // JE का फ़ैसला: तीर से सिर्फ़ फ़ोटो। टेक्स्ट सिर्फ़ उन फ़ोन के लिए जहां फ़ोटो शेयर नहीं होती — और
  // छोटा, क्योंकि हिंदी SMS में 70 अक्षर प्रति संदेश (पूरा ब्योरा 6-7 SMS ले लेता)
  test('_shareText — छोटा हो: नाम, Consumer No, बकाया+स्थिति; रिमार्क/मोबाइल/पता नहीं', async ({ page }) => {
    await seedCard(page, loginLineman);
    const t = await page.evaluate(() => _shareText(cGet(activeHQ, activeCat)[0]));
    for (const s of ['आदेगांव', 'ASADU LAL / SAUUA GOND', '1134019486', '₹10,098', '⏳ बाकी']) {
      expect(t).toContain(s);
    }
    for (const s of ['8224893808', 'JAMUA', 'लाइन काटी थी', 'सी फॉर्म में दिया गया']) {
      expect(t).not.toContain(s);
    }
    expect(t.length).toBeLessThan(140); // ~2 हिंदी SMS के अंदर
  });

  test('फ़ोटो-शेयर वाले फ़ोन पर — सिर्फ़ card की PNG फ़ोटो जाए (नीचे टेक्स्ट नहीं), Firebase को कोई request नहीं', async ({ page }) => {
    await seedCard(page, loginLineman);
    const r = await page.evaluate(() => new Promise((resolve) => {
      var fbCalls = 0, orig = window.fetch;
      window.fetch = function (u, o) { if (String(u).indexOf(FB) === 0) fbCalls++; return orig(u, o); };
      Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
      Object.defineProperty(navigator, 'share', { configurable: true, value: (d) => {
        resolve({ n: d.files.length, type: d.files[0].type, name: d.files[0].name, size: d.files[0].size, hasText: !!d.text, fbCalls: fbCalls });
        return Promise.resolve();
      } });
      document.querySelector('.con-card .cc-share').click();
      setTimeout(() => resolve({ timeout: true }), 5000);
    }));
    expect(r.timeout).toBeUndefined();
    expect(r.n).toBe(1);
    expect(r.type).toBe('image/png');
    expect(r.name).toBe('card-1134019486.png');
    expect(r.size).toBeGreaterThan(1000);
    expect(r.hasText).toBe(false); // सिर्फ़ फ़ोटो — WhatsApp में नीचे टेक्स्ट न आए
    expect(r.fbCalls).toBe(0);
  });

  test('_shareCardImage — ऐप वाले card से 2x तस्वीर बने, नीचे के बटन तस्वीर में न हों', async ({ page }) => {
    await seedCard(page, loginLineman);
    const r = await page.evaluate(() => new Promise((resolve) => {
      var el = document.querySelector('.con-card');
      var w = Math.ceil(el.getBoundingClientRect().width), h = Math.ceil(el.getBoundingClientRect().height);
      _shareCardImage(el, (c) => resolve(c ? { w: c.width, h: c.height, cardW: w, cardH: h, stillHasBtns: !!el.querySelector('.act-btns') } : null));
    }));
    expect(r).not.toBeNull();
    expect(r.w).toBe(r.cardW * 2);
    expect(r.h).toBeLessThan(r.cardH * 2); // बटन वाली पंक्ति हटने से तस्वीर card से छोटी
    expect(r.stillHasBtns).toBe(true);      // असली card पर बटन जस-के-तस (सिर्फ़ कॉपी से हटे)
  });

  test('फ़ोटो-शेयर न होने वाले फ़ोन पर — सीधे WhatsApp (wa.me) पूरे टेक्स्ट के साथ खुले', async ({ page }) => {
    await seedCard(page, loginLineman);
    const url = await page.evaluate(() => {
      Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
      var opened = null;
      window.open = function (u) { opened = u; return null; };
      document.querySelector('.con-card .cc-share').click();
      return opened;
    });
    expect(url.indexOf('https://wa.me/?text=')).toBe(0);
    const text = decodeURIComponent(url.slice('https://wa.me/?text='.length));
    expect(text).toContain('ASADU LAL');
    expect(text).toContain('1134019486');
  });

  test('लाइनमैन ने शेयर-मेनू खुद रद्द किया (AbortError) — WhatsApp अलग से न खुले', async ({ page }) => {
    await seedCard(page, loginLineman);
    const opened = await page.evaluate(() => new Promise((resolve) => {
      var o = null;
      window.open = function (u) { o = u; return null; };
      Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
      Object.defineProperty(navigator, 'share', { configurable: true, value: () => { var e = new Error('x'); e.name = 'AbortError'; setTimeout(() => resolve(o), 200); return Promise.reject(e); } });
      document.querySelector('.con-card .cc-share').click();
    }));
    expect(opened).toBeNull();
  });
});

// ── v9.186: डिस्प्ले बोर्ड बंद हो तब login पन्ने के पीछे पृष्ठभूमि फ़ोटो (वॉटरमार्क) — JE की मांग ──
// फ़ोटो अलग /HOME_BG पर (बोर्ड हर ऐप-खुलने पर उतरता है, उसमें ~90 KB नहीं डालनी), बोर्ड में सिर्फ़
// version (bgTs); हर फ़ोन एक बार उतारकर IndexedDB में रखता है
test.describe('पृष्ठभूमि फ़ोटो (वॉटरमार्क) — बोर्ड बंद हो तब login पन्ने के पीछे', () => {
  // असली JPEG data URL — canvas से (page के अंदर)
  const makeJpeg = (w, h) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#3a7bd5'); g.addColorStop(1, '#f7c948');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.8);
  };

  test('बोर्ड बंद + JE की फ़ोटो लगी हो → पीछे फ़ोटो दिखे (सर्वर से उतरकर)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(({ mk }) => new Promise((resolve) => {
      const img = new Function('return (' + mk + ')(320,200)')();
      let gets = 0;
      window.fetch = function (url) {
        if (String(url).indexOf('/HOME_BG.json') > -1) { gets++; return Promise.resolve({ ok: true, json: () => Promise.resolve({ img: img, ts: 5 }) }); }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
      };
      HSC = { showBoard: '0', bgTs: 5, ts: 1 };
      renderHomeSc();
      const t0 = Date.now();
      (function wait() {
        const u = document.querySelector('#login-screen > .wm-bg');
        if (u || Date.now() - t0 > 3000) resolve({ bg: u ? u.style.backgroundImage : null, gets: gets, board: document.getElementById('home-sc').innerHTML });
        else setTimeout(wait, 50);
      })();
    }), { mk: makeJpeg.toString() });
    expect(r.gets).toBe(1);
    expect(r.bg).toContain('data:image/jpeg;base64,');
    expect(r.board).toBe(''); // बोर्ड बंद ही रहे
  });

  test('बोर्ड चालू हो तो फ़ोटो न दिखे (और न उतरे)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      let gets = 0;
      window.fetch = function (url) {
        if (String(url).indexOf('/HOME_BG.json') > -1) gets++;
        return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
      };
      HSC = { showBoard: '1', curPaid: '10', curAmt: '5', bgTs: 5, ts: 1 };
      renderHomeSc();
      return new Promise((res) => setTimeout(() => res({ gets: gets, wm: !!document.querySelector('#login-screen > .wm-bg') }), 400));
    });
    expect(r.wm).toBe(false);
    expect(r.gets).toBe(0);
  });

  test('एक बार उतरी फ़ोटो दोबारा न उतरे — फ़ोन (IndexedDB) से दिखे; JE नई लगाएं (bgTs बदले) तभी उतरे', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(({ mk }) => new Promise((resolve) => {
      const img = new Function('return (' + mk + ')(320,200)')();
      let gets = 0;
      window.fetch = function (url) {
        if (String(url).indexOf('/HOME_BG.json') > -1) { gets++; return Promise.resolve({ ok: true, json: () => Promise.resolve({ img: img, ts: 7 }) }); }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
      };
      HSC = { showBoard: '0', bgTs: 7, ts: 1 };
      renderHomeSc();
      setTimeout(() => {
        // ऐप दोबारा खुलने जैसा — याद (memory) साफ़, सिर्फ़ IndexedDB बचा
        _homeBgMem = null; _homeBgTried = {};
        const ls = document.getElementById('login-screen'); const old = ls.querySelector(':scope > .wm-bg'); if (old) old.remove();
        renderHomeSc();
        setTimeout(() => {
          const afterReopen = { gets: gets, wm: !!document.querySelector('#login-screen > .wm-bg') };
          HSC = { showBoard: '0', bgTs: 8, ts: 2 }; // JE ने नई फ़ोटो लगाई
          renderHomeSc();
          setTimeout(() => resolve({ afterReopen: afterReopen, afterNew: gets }), 500);
        }, 500);
      }, 500);
    }), { mk: makeJpeg.toString() });
    expect(r.afterReopen.gets).toBe(1); // दोबारा खुलने पर network नहीं
    expect(r.afterReopen.wm).toBe(true);
    expect(r.afterNew).toBe(2);        // version बदला — अब उतरी
  });

  test('डेटा बचाओ मोड में फ़ोटो न उतरे', async ({ page }) => {
    await openApp(page);
    const gets = await page.evaluate(() => {
      let n = 0;
      window.fetch = function (url) {
        if (String(url).indexOf('/HOME_BG.json') > -1) n++;
        return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
      };
      DATA_PAUSED = true;
      HSC = { showBoard: '0', bgTs: 9, ts: 1 };
      renderHomeSc();
      return new Promise((res) => setTimeout(() => res(n), 400));
    });
    expect(gets).toBe(0);
  });

  test('सर्वर से JPEG के अलावा कुछ भी आए (SVG, ग़लत अक्षर, CSS तोड़ने की कोशिश) तो न लगे', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      const bad = [
        'data:image/svg+xml;base64,PHN2Zy8+',
        'data:image/jpeg;base64,AAAA"); background:url(https://x.example/a',
        'javascript:alert(1)',
        'data:image/jpeg;base64,' + 'A'.repeat(300001),
      ];
      return bad.map((s) => _homeBgOk(s));
    });
    expect(r).toEqual([false, false, false, false]);
  });

  test('JE फ़ोटो चुने → फ़ोन पर छोटी होकर (≤720 चौड़ी, JPEG, सीमा के अंदर) HOME_BG पर जाए, और प्रकाशित बोर्ड में वही bgTs', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      let put = null, board = null;
      window.fetch = function (url, opts) {
        if (String(url).indexOf('/HOME_BG.json') > -1 && opts && opts.method === 'PUT') { put = JSON.parse(opts.body); return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); }
        if (String(url).indexOf('/HOME_SCORECARD.json') > -1 && opts && opts.method === 'PUT') { board = JSON.parse(opts.body); return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
      };
      openHscModal();
      // बड़ी फ़ोटो (2400×1800) — कैमरे जैसी
      const c = document.createElement('canvas'); c.width = 2400; c.height = 1800;
      const x = c.getContext('2d'); for (let i = 0; i < 60; i++) { x.fillStyle = 'hsl(' + (i * 6) + ',70%,50%)'; x.fillRect(i * 40, 0, 40, 1800); }
      c.toBlob((blob) => {
        const f = new File([blob], 'photo.png', { type: 'image/png' });
        hscBgPick({ files: [f], value: 'x' });
        const t0 = Date.now();
        (function wait() {
          if (put || Date.now() - t0 > 5000) {
            if (!put) { resolve({ put: null }); return; }
            const im = new Image();
            im.onload = () => {
              document.getElementById('hsc-curpaid').value = '10';
              document.getElementById('hsc-curamt').value = '5';
              document.getElementById('hsc-showboard').checked = false;
              saveHsc();
              setTimeout(() => resolve({ put: { ts: put.ts, len: put.img.length, head: put.img.slice(0, 23) }, w: im.width, h: im.height, board: board, thumb: document.getElementById('hsc-bg-thumb').style.backgroundImage }), 200);
            };
            im.src = put.img;
          } else setTimeout(wait, 50);
        })();
      }, 'image/png');
    }));
    expect(r.put).not.toBeNull();
    expect(r.put.head).toBe('data:image/jpeg;base64,');
    expect(r.put.len).toBeLessThanOrEqual(300000);
    expect(r.w).toBe(720);
    expect(r.h).toBe(540);
    expect(r.board.bgTs).toBe(r.put.ts);
    expect(r.board.showBoard).toBe('0');
    expect(r.thumb).toContain('data:image/jpeg');
  });

  test('JE फ़ोटो हटाएं → प्रकाशित बोर्ड में bgTs 0, और सर्वर से HOME_BG मिटे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      let board = null, del = 0;
      window.fetch = function (url, opts) {
        if (String(url).indexOf('/HOME_BG.json') > -1 && opts && opts.method === 'DELETE') { del++; }
        if (String(url).indexOf('/HOME_SCORECARD.json') > -1 && opts && opts.method === 'PUT') { board = JSON.parse(opts.body); }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      };
      HSC = { curPaid: '10', curAmt: '5', showBoard: '0', bgTs: 11, ts: 1 };
      openHscModal();
      hscBgRemove();
      saveHsc();
      setTimeout(() => resolve({ bgTs: board && board.bgTs, del: del }), 300);
    }));
    expect(r.bgTs).toBe(0);
    expect(r.del).toBe(1);
  });

  // लाइनमैन का session 30 दिन टिकता है — login पन्ना शायद ही कभी दिखता है। renderHomeSc हर ऐप-
  // खुलने पर चलता है, इसलिए रोक न होती तो हर लाइनमैन का फ़ोन ~100 KB उतारता जो कभी दिखती ही नहीं
  test('login किए फ़ोन (पन्ना सामने नहीं) फ़ोटो न उतारें — logout पर पन्ना सामने आए तभी उतरे', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await page.evaluate(({ mk }) => new Promise((resolve) => {
      const img = new Function('return (' + mk + ')(320,200)')();
      let gets = 0;
      window.fetch = function (url) {
        if (String(url).indexOf('/HOME_BG.json') > -1) { gets++; return Promise.resolve({ ok: true, json: () => Promise.resolve({ img: img, ts: 12 }) }); }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
      };
      HSC = { showBoard: '0', bgTs: 12, ts: 1 };
      renderHomeSc(); // ऐप खुलने/बोर्ड आने जैसा — पर लाइनमैन अंदर है
      setTimeout(() => {
        const whileIn = gets;
        doLogout(false); // अब login पन्ना सामने
        setTimeout(() => resolve({ whileIn: whileIn, afterLogout: gets, wm: !!document.querySelector('#login-screen > .wm-bg') }), 600);
      }, 400);
    }), { mk: makeJpeg.toString() });
    expect(r.whileIn).toBe(0);
    expect(r.afterLogout).toBe(1);
    expect(r.wm).toBe(true);
  });

  test('lineman फ़ोटो नहीं लगा सकता (और नियमों में भी सिर्फ़ JE, सिर्फ़ JPEG, आकार की सीमा)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const puts = await page.evaluate(() => {
      let n = 0;
      window.fetch = function (url, opts) { if (opts && opts.method === 'PUT') n++; return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); };
      hscBgPick({ files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })], value: 'x' });
      return new Promise((res) => setTimeout(() => res(n), 300));
    });
    expect(puts).toBe(0);
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8')).rules;
    expect(rules.HOME_BG['.write']).toContain("auth.token.email === 'pradeepks2015@gmail.com'");
    expect(rules.HOME_BG.img['.validate']).toContain("beginsWith('data:image/jpeg;base64,')");
    expect(rules.HOME_BG.img['.validate']).toContain('length <= 300000');
    expect(rules.HOME_BG.$f['.validate']).toBe(false);
  });
});

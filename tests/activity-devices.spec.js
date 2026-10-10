// @ts-check
// वसूली ट्रैकर — टेस्ट: activity-devices (साझा helpers: tests/helpers.js)
const { test, expect, openApp, loginLineman, loginJE } = require('./helpers');

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
      const td = new Date(now); const today = td.getDate() + '/' + (td.getMonth() + 1) + '/' + td.getFullYear();
      // एक ही acc दो श्रेणियों में (propagateStatus से ऐसा होता ही है) — dedup होना चाहिए।
      // v9.185: वसूली भुगतान तारीख़ (paydate) से गिनी जाती है, ts से नहीं — इसलिए paydate दी है
      cSet('जोबा', 'कुल उपभोक्ता', [
        { acc: '1', name: 'A', status: 'paid', paydate: today, amount: 100, updatedBy: 'Devendra kumar', ts: now - 3600000 },
        { acc: '2', name: 'B', status: 'pending', amount: 100, updatedBy: 'Devendra kumar', ts: now - 3600000 },
        { acc: '3', name: 'C', status: 'paid', paydate: '1/1/2020', amount: 100, updatedBy: 'कोई और', ts: now - 40 * 86400000 }, // बहुत पुराना
      ]);
      cSet('जोबा', 'घरेलू', [
        { acc: '1', name: 'A', status: 'paid', paydate: today, amount: 100, updatedBy: 'Devendra kumar', ts: now - 3600000 },
      ]);
      return _dvActivity(now - 7 * 86400000);
    });
    // acc "1" दो जगह था पर एक ही बार गिना; "work" अब सिर्फ़ ग़ैर-वसूली बदलाव (acc "2")
    expect(a['devendra kumar']).toMatchObject({ work: 1, paid: 1, rmk: 0 });
    expect(a['devendra kumar'].hqs).toEqual({ 'जोबा': 1 });
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

  // ── v9.185: असली production (3/10) — विकास साहू (पिंडरई) ने दोपहर 1:09 पर वसूली की, पर पिंडरई
  // "आज किसी ने ऐप नहीं खोला" में था और विकास तालिका में थे ही नहीं; ऊपर "303 वसूली" जबकि तालिका
  // का जोड़ 57 — JE ने पकड़ा कि इसमें पुरानी वसूली भी है (गिनती ts से होती थी, paydate से नहीं)
  const todayStr = () => { const d = new Date(); return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear(); };

  test('_dvActivity — पुरानी वसूली पर आज रिमार्क/मिलान से ts आज का हो जाए, तो भी वह "आज की वसूली" न गिने (paydate से गिनती)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const a = await page.evaluate((today) => {
      const now = Date.now();
      cSet('पिंडरई', 'कुल उपभोक्ता', [
        // आज सचमुच वसूल (paydate आज)
        { acc: '11', name: 'A', status: 'paid', paydate: today, updatedBy: 'Vikas sahu', ts: now - 3600000 },
        // 20 दिन पुरानी वसूली — आज किसी ने रिमार्क लिखा, तो ts आज का और updatedBy रिमार्क वाले का
        { acc: '12', name: 'B', status: 'paid', paydate: '1/1/2026', updatedBy: 'Raja', ts: now - 60000 },
      ]);
      return _dvActivity(new Date(new Date().setHours(0, 0, 0, 0)).getTime());
    }, todayStr());
    expect(a['vikas sahu'].paid).toBe(1);
    expect(a['vikas sahu'].hqs).toEqual({ 'पिंडरई': 1 });
    expect(a['raja']).toBeUndefined(); // पुरानी वसूली — न वसूली गिनी, न "बदलाव"
  });

  test('_dvActivity — एक बटन में बाकी, दूसरे में वसूल (बीच का mismatch) हो तो भी वसूली न छूटे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const a = await page.evaluate((today) => {
      const now = Date.now();
      cSet('पिंडरई', 'कुल उपभोक्ता', [{ acc: '21', name: 'A', status: 'pending', updatedBy: 'x', ts: now - 40 * 86400000 }]);
      cSet('पिंडरई', 'घरेलू', [{ acc: '21', name: 'A', status: 'paid', paydate: today, updatedBy: 'Vikas sahu', ts: now - 60000 }]);
      return _dvActivity(new Date(new Date().setHours(0, 0, 0, 0)).getTime());
    }, todayStr());
    expect(a['vikas sahu'].paid).toBe(1); // पहले "कुल उपभोक्ता" वाली बाकी प्रति पर ही "देखा" लग जाता था
  });

  test('_dvTodayStrip — हाज़िरी न लगी हो पर आज वसूली दिखे तो वह मुख्यालय "किसी ने ऐप नहीं खोला" में न आए', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const txt = await page.evaluate((today) => {
      cSet('पिंडरई', 'कुल उपभोक्ता', [{ acc: '31', name: 'A', status: 'paid', paydate: today, updatedBy: 'Vikas sahu', ts: Date.now() - 3600000 }]);
      var div = document.createElement('div');
      div.innerHTML = _dvTodayStrip({ d5: { v: APP_VER, hq: 'जोबा', role: 'lineman', name: 'Devendra kumar', t: Date.now() - 3600000 } });
      return div.textContent;
    }, todayStr());
    expect(txt).toContain('2 कर्मचारी सक्रिय'); // Devendra (हाज़िरी) + Vikas (काम)
    expect(txt).toContain('2/6 मुख्यालय');
    const quiet = txt.split('आज किसी ने ऐप नहीं खोला:')[1] || '';
    expect(quiet).not.toContain('पिंडरई');
    expect(quiet).toContain('पाटन');
  });

  test('_dvTodayStrip — JE की कैश लिस्ट वाली वसूली उस मुख्यालय को "सक्रिय" न बनाए (मैदानी काम नहीं)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const txt = await page.evaluate((today) => {
      cSet('बीबी', 'कुल उपभोक्ता', [{ acc: '41', name: 'A', status: 'paid', paydate: today, updatedBy: 'Pradeep (कैश लिस्ट)', ts: Date.now() - 60000 }]);
      var div = document.createElement('div');
      div.innerHTML = _dvTodayStrip({});
      return div.textContent;
    }, todayStr());
    expect(txt.split('आज किसी ने ऐप नहीं खोला:')[1] || '').toContain('बीबी');
  });

  test('तालिका — हाज़िरी न लगी हो पर काम किया हो तो पंक्ति दिखे ("हाज़िरी नहीं"), और "पुराना version" चेतावनी न आए', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => openDvModal());
    await page.evaluate(mockDV);
    await page.evaluate((today) => {
      cSet('पिंडरई', 'कुल उपभोक्ता', [{ acc: '51', name: 'A', status: 'paid', paydate: today, updatedBy: 'Vikas sahu', ts: Date.now() - 3600000 }]);
      _dvRender();
    }, todayStr());
    await page.waitForFunction(() => document.getElementById('mig-devices').textContent.indexOf('Vikas Sahu') > -1);
    const r = await page.evaluate(() => {
      var el = document.getElementById('mig-devices');
      var row = Array.prototype.find.call(el.querySelectorAll('tr'), (tr) => tr.textContent.indexOf('Vikas Sahu') > -1);
      return { row: row ? row.textContent : '', text: el.textContent };
    });
    expect(r.row).toContain('पिंडरई');
    expect(r.row).toContain('1 वसूली');
    expect(r.row).toContain('हाज़िरी नहीं');
    expect(r.text).toContain('सभी सक्रिय devices'); // Vikas का version अज्ञात — लाल चेतावनी नहीं
  });

  test('ऐप पर लौटने (minimize से वापस) पर हाज़िरी लगे — पर घंटे में एक बार से ज़्यादा नहीं', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await page.evaluate(() => {
      var puts = 0;
      window.fetch = function (url, opts) {
        if (String(url).indexOf('/DEVICE_VERSIONS/') > -1 && opts && opts.method === 'PUT') puts++;
        return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
      };
      var fire = () => document.dispatchEvent(new Event('visibilitychange'));
      _lastPingAt = Date.now() - 2 * 3600000; // आख़िरी हाज़िरी 2 घंटे पहले
      fire();
      var afterFirst = puts;
      fire(); // तुरंत फिर लौटे — दोबारा नहीं
      return { afterFirst: afterFirst, afterSecond: puts };
    });
    expect(r.afterFirst).toBe(1);
    expect(r.afterSecond).toBe(1);
  });
});

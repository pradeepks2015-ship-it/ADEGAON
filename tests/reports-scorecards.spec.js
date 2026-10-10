// @ts-check
// वसूली ट्रैकर — टेस्ट: reports-scorecards (साझा helpers: tests/helpers.js)
const { test, expect, openApp, loginLineman, loginJE } = require('./helpers');

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

  test('_todayScRow — negative बकाया (advance) वाले "वसूल" record का योगदान amt में 0 माना जाए', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      var today = _todayDateStr();
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: 'A1', name: 'एक', status: 'paid', paydate: today, amount: '100' },
        { acc: 'A2', name: 'दो', status: 'paid', paydate: today, amount: '-600' }, // advance/credit balance
      ]);
      return _todayScRow('आदेगांव');
    });
    expect(r.count).toBe(2); // दोनों "वसूल"/निपटे हुए गिने गए
    expect(r.amt).toBe(100); // सिर्फ़ +100 — -600 का योगदान 0 माना गया
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

test.describe('मुख्यालय व टैरिफ रिपोर्ट — मुख्यालय-वार, टैरिफ-श्रेणी-वार सूची (JE only, बिना नेटवर्क कॉल के)', () => {
  test('openVoiceScorecard — खोलते ही network fetch न हो, सिर्फ़ cache से बने (JE का सवाल: "network cost बढ़ाए बिना ऐसा बटन बन सकता है क्या")', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const fetchCount = await page.evaluate(() => new Promise((resolve) => {
      var count = 0;
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('.json') > -1 && (!opts || !opts.method)) count++;
        return orig(url, opts);
      };
      openVoiceScorecard();
      setTimeout(() => { window.fetch = orig; resolve(count); }, 300);
    }));
    expect(fetchCount).toBe(0);
  });

  test('voicesc-menu-item — lineman को न दिखे, openVoiceScorecard सीधे बुलाने पर भी न खुले (defense-in-depth)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await page.evaluate(() => {
      openVoiceScorecard();
      return {
        menuHidden: getComputedStyle(document.getElementById('voicesc-menu-item')).display,
        opened: document.getElementById('voicesc-overlay').classList.contains('open'),
      };
    });
    expect(r.menuHidden).toBe('none');
    expect(r.opened).toBe(false);
  });

  test('_voiceHQBreakdown — "कुल उपभोक्ता" (master) को टैरिफ-वार गिने, दूसरी categories से सिर्फ़ वसूल-मिलान करे (bug जैसा _waScRow में — एक ही acc दो जगह न गिने)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const rows = await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '1', name: 'राम', tariff: 'LV1', status: 'pending', amount: 100 },
        { acc: '2', name: 'श्याम', tariff: 'LV1', status: 'pending', amount: 200 },
        { acc: '3', name: 'गीता', tariff: 'LV3', status: 'pending', amount: 300 },
      ]);
      // acc '1' घरेलू (LV1 की असली category tab) में paid मार्क है — master में अब भी pending दिखता
      // है, पर _waScRow जैसा dedup इसे "master में मौजूद" पहचानकर वसूल में गिन ले
      cSet('आदेगांव', 'घरेलू', [{ acc: '1', name: 'राम', tariff: 'LV1', status: 'paid', amount: 100 }]);
      return _voiceHQBreakdown('आदेगांव');
    });
    const lv1 = rows.find((r) => r.tariff === 'LV1');
    const lv3 = rows.find((r) => r.tariff === 'LV3');
    expect(lv1.tot).toBe(2);
    expect(lv1.paid).toBe(1); // सिर्फ़ acc '1', दोबारा नहीं गिना
    expect(lv1.paidAmt).toBe(100);
    expect(lv1.due).toBe(300); // दोनों pending होने पर master का due (paid mark करने से पहले जोड़ा गया)
    expect(lv3.tot).toBe(1);
    expect(lv3.paid).toBe(0);
    expect(rows[0].tariff).toBe('LV1'); // tot घटते क्रम में — LV1 (2) पहले, LV3 (1) बाद में
  });

  test('_voiceHQBreakdown — negative बकाया (advance) वाले "वसूल" record का योगदान paidAmt में 0 माना जाए', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const rows = await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '1', name: 'राम', tariff: 'LV1', status: 'paid', amount: 150 },
        { acc: '2', name: 'श्याम', tariff: 'LV1', status: 'paid', amount: -700 }, // advance/credit balance
      ]);
      return _voiceHQBreakdown('आदेगांव');
    });
    const lv1 = rows.find((r) => r.tariff === 'LV1');
    expect(lv1.paid).toBe(2); // दोनों "वसूल"/निपटे हुए गिने गए
    expect(lv1.paidAmt).toBe(150); // सिर्फ़ +150 — -700 का योगदान 0 माना गया
  });

  test('_voiceScRender — जिस HQ का "कुल उपभोक्ता" cache में नहीं, उसकी कोई पंक्ति न बने', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const html = await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [{ acc: '1', name: 'राम', tariff: 'LV1', status: 'pending', amount: 100 }]);
      _voiceScRender();
      return document.getElementById('voicesc-content').innerHTML;
    });
    expect(html).toContain('आदेगांव');
    expect(html).toContain('LV1');
    expect(html).not.toContain('पिंडरई'); // उस HQ का data cache में नहीं डाला
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

  test('downloadPDF — negative बकाया (advance) वाले "वसूल" record का योगदान वसूल-राशि सारांश में 0 माना जाए', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '1', name: 'राम', status: 'paid', amount: 300 },
        { acc: '2', name: 'श्याम', status: 'paid', amount: -900 }, // advance/credit balance
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
    // ऊपर का सारांश-कार्ड: सिर्फ़ +300 — -900 का योगदान 0 माना गया, कभी negative न दिखे
    expect(html).toContain("<b style='color:green'>₹300</b>वसूल राशि");
    // पर श्याम की अपनी row में असली (-900) बकाया वैसा ही दिखे — सिर्फ़ सारांश-जोड़ में क्लैंप होता है,
    // व्यक्तिगत record का असली आंकड़ा छुपाया नहीं जाता
    expect(html).toContain('₹-900');
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
      cSet('आदेगांव', 'कुल उपभोक्ता', [{ acc: '<script>alert(3)</script>', name: '<img src=x onerror=alert(4)>', status: 'paid', amount: 100, paydate: _todayDateStr() }]);
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
    expect(html).toContain('&lt;script&gt;alert(3)&lt;/script&gt;'); // चालू चक्र में गिना गया और escape होकर दिखा (vacuous pass न हो)
  });

  test('renderScDateTable (स्क्रीन पर दिनांक-वार तालिका) — consumer name/Consumer No escape होकर दिखें', async ({ page }) => {
    await openApp(page);
    const html = await page.evaluate(() => {
      scActiveHQ = 'आदेगांव';
      var rec = { acc: '<script>alert(5)</script>', name: '<img src=x onerror=alert(6)>', status: 'paid', amount: 100, paydate: _todayDateStr() };
      cSet('आदेगांव', 'कुल उपभोक्ता', [rec]); // renderScDateTable इसी master-list से acc मिलान करके फ़िल्टर करता है
      renderScDateTable([rec]);
      return document.getElementById('sc-body').innerHTML;
    });
    expect(html).not.toContain('<script>alert(5)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(6)>');
    expect(html).toContain('&lt;script&gt;alert(5)&lt;/script&gt;'); // चालू चक्र में गिना गया और escape होकर दिखा (vacuous pass न हो)
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

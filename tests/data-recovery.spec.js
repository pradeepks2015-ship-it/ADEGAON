// @ts-check
// वसूली ट्रैकर — टेस्ट: data-recovery (साझा helpers: tests/helpers.js)
const { test, expect, fs, path, openApp, loginLineman, loginJE } = require('./helpers');

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
        // सिर्फ़ repeat-mark गिनें — बाक़ी असंबंधित लॉग (जैसे flags लोड न होने पर array-put-noflags) गिनती न बिगाड़ें
        atCount.push(logged.filter(function (x) { return x.t === 'repeat-mark'; }).length);
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

  test('रिमार्क अब सिर्फ़ उसी category तक सीमित नहीं — उसी acc की बाकी सभी categories (कुल उपभोक्ता समेत) में भी दिखे (bug: JE की शिकायत, "घरेलू" में डाला कमेंट "कुल उपभोक्ता" में कभी नहीं दिखता था)', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [{ acc: '777', name: 'मोहन', status: 'pending', amount: 400 }]);
      cSet('आदेगांव', 'घरेलू', [{ acc: '777', name: 'मोहन', status: 'pending', amount: 400 }]);
      cSet('आदेगांव', 'व्यवसाय', [{ acc: '888', name: 'कोई और', status: 'pending', amount: 100 }]); // अलग acc — न छुए
    });
    await loginLineman(page);
    await page.evaluate(() => { activeHQ = 'आदेगांव'; activeCat = 'घरेलू'; });
    await page.evaluate(() => {
      openRmkModal(0, '777');
      document.getElementById('rmk-text').value = 'मीटर खराब है';
      saveRmk();
    });
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({
      master: cGet('आदेगांव', 'कुल उपभोक्ता').find((x) => x.acc === '777'),
      ghar: cGet('आदेगांव', 'घरेलू').find((x) => x.acc === '777'),
      vyapar: cGet('आदेगांव', 'व्यवसाय').find((x) => x.acc === '888'),
    }));
    expect(r.master.remarksArr[0].text).toBe('मीटर खराब है'); // "कुल उपभोक्ता" में भी पहुंचा
    expect(r.master.remarksArr[0].cat).toBe('घरेलू'); // असल स्रोत category टैग हुई
    expect(r.ghar.remarksArr[0].cat).toBe('घरेलू'); // जहां सीधे डाला वहां भी टैग हो (अपनी ही category)
    expect(r.vyapar.remarksArr).toBeFalsy(); // अलग acc — बिल्कुल न छुआ
  });

  test('openRmkModal — दूसरी category से आया रिमार्क 📁 टैग के साथ दिखे, अपनी ही category का रिमार्क बिना टैग', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [{ acc: '999', name: 'सीता', status: 'pending', amount: 200, remarksArr: [
        { text: 'यहीं का रिमार्क', by: 'X', at: 'कल', cat: 'कुल उपभोक्ता' },
        { text: 'घरेलू से आया', by: 'X', at: 'आज', cat: 'घरेलू' },
      ] }]);
    });
    await loginLineman(page);
    await page.evaluate(() => { activeHQ = 'आदेगांव'; activeCat = 'कुल उपभोक्ता'; openRmkModal(0, '999'); });
    const html = await page.evaluate(() => document.getElementById('prev-rmk-list').innerHTML);
    expect(html).toContain('घरेलू से आया');
    expect(html).toContain('📁 घरेलू'); // दूसरी category से आया — टैग दिखे
    expect((html.match(/📁/g) || []).length).toBe(1); // सिर्फ़ एक टैग — अपनी ही category वाले पर नहीं
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

  test('ग्राम-वार वसूली (_vgComputeRows) — negative बकाया (advance) वाले "वसूल" उपभोक्ता का योगदान paidAmt में 0 माना जाए', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '601', addr: 'गांवए', status: 'paid', amount: 400 },
        { acc: '602', addr: 'गांवए', status: 'paid', amount: -900 }, // advance/credit balance
      ]);
    });
    const row = await page.evaluate(() => _vgComputeRows('आदेगांव')[0]);
    expect(row.paid).toBe(2); // दोनों "वसूल"/निपटे हुए गिने गए
    expect(row.paidAmt).toBe(400); // सिर्फ़ +400 — -900 का योगदान 0 माना गया
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

test.describe('व्यक्ति/सूची-वार गोद लिए गांव — JE अनुरोध: हर HQ की जिन categories का नाम किसी व्यक्ति (या status) पर बदला गया है, उनमें मौजूद गांव दिखें', () => {
  test('_vgComputeAdoptions — नाम-बदली category के गांव-वार आंकड़े (कुल/बकाया/वसूल/%) लौटाए, मिलते-जुलते गांव मर्ज हों, default-नाम वाली category छूट जाए', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      CAT_NAMES['आदेगांव'] = { 1: 'किशन' }; // सिर्फ़ index 1 (घरेलू) का नाम बदला — बाकी default ही रहे
      cSet('आदेगांव', 'किशन', [
        { acc: '1', name: 'राम', addr: 'HAMEERGAGH', status: 'pending', amount: 150 },   // alias वाला ग़लत spelling
        { acc: '2', name: 'श्याम', addr: 'hameergarh', status: 'paid', amount: 200 },     // वही गांव, केस/alias दोनों भिन्न — वसूल
        { acc: '3', name: 'गीता', addr: 'CHHOTA BICHHUA', status: 'pending', amount: 100 },
      ]);
      cSet('आदेगांव', 'व्यवसाय', [ // default नाम — इसे adoptions में नहीं आना चाहिए
        { acc: '9', name: 'मोहन', addr: 'कोई और गांव', status: 'pending', amount: 100 },
      ]);
      return _vgComputeAdoptions('आदेगांव');
    });
    expect(r.length).toBe(1);              // सिर्फ़ "किशन" — "व्यवसाय" (default नाम) नहीं
    expect(r[0].cat).toBe('किशन');
    expect(r[0].villages.length).toBe(2);  // HAMEERGAGH/hameergarh मर्ज होकर एक ही गांव, CHHOTA BICHHUA अलग
    const norm = await page.evaluate((vs) => vs.map((v) => _vgNormKey('आदेगांव', v.village)), r[0].villages);
    var hameergarh = r[0].villages[norm.indexOf('HAMEERGARH')];
    expect(hameergarh.tot).toBe(2);
    expect(hameergarh.paid).toBe(1);
    expect(hameergarh.paidAmt).toBe(200);
    expect(hameergarh.bakaya).toBe(150);
    expect(hameergarh.pct).toBeCloseTo(50, 1);
    var bichhua = r[0].villages[norm.indexOf('CHHOTA BICHHUA')];
    expect(bichhua.tot).toBe(1);
    expect(bichhua.paid).toBe(0);
    expect(bichhua.bakaya).toBe(100);
  });

  test('कोई भी category नाम-बदली न हो तो खाली सूची लौटे, और UI में साफ़ संदेश दिखे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      CAT_NAMES['पिंडरई'] = {};
      vgActiveHQ = 'पिंडरई';
      _vgRenderAdoptions();
      return { rows: _vgComputeAdoptions('पिंडरई'), txt: document.getElementById('vg-adopt-list').textContent };
    });
    expect(r.rows.length).toBe(0);
    expect(r.txt).toContain('कोई नाम-बदली हुई सूची नहीं');
  });

  test('openVillageModal खुलते ही सक्रिय HQ के लिए adoptions section अपने-आप बन जाए (नाम/गांव escape होकर, XSS न बने)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      CAT_NAMES['आदेगांव'] = { 1: '<img src=x onerror=alert(1)>' };
      cSet('आदेगांव', CAT_NAMES['आदेगांव'][1], [
        { acc: '1', name: 'राम', addr: '<script>alert(2)</script>', status: 'pending', amount: 100 },
      ]);
      openVillageModal();
      var el = document.getElementById('vg-adopt-list');
      return { html: el.innerHTML, imgs: el.querySelectorAll('img').length };
    });
    expect(r.imgs).toBe(0);
    expect(r.html).not.toContain('<img src=x onerror=alert(1)>');
    expect(r.html).not.toContain('<script>alert(2)</script>');
    expect(r.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(r.html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
  });

  test('HQ tab बदलने पर adoptions section भी उस HQ के हिसाब से बदल जाए', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      CAT_NAMES['आदेगांव'] = { 1: 'आदेगांव-वाला' };
      CAT_NAMES['जोबा'] = { 1: 'जोबा-वाला' };
      cSet('आदेगांव', 'आदेगांव-वाला', [{ acc: '1', name: 'क', addr: 'गांव-अ', status: 'pending', amount: 100 }]);
      cSet('जोबा', 'जोबा-वाला', [{ acc: '2', name: 'ख', addr: 'गांव-ब', status: 'pending', amount: 100 }]);
      openVillageModal();
      var before = document.getElementById('vg-adopt-list').textContent;
      Array.from(document.querySelectorAll('#vg-hq-tabs .hq-tab')).find((t) => t.textContent === 'जोबा').click();
      var after = document.getElementById('vg-adopt-list').textContent;
      return { before: before, after: after };
    });
    expect(r.before).toContain('आदेगांव-वाला');
    expect(r.before).not.toContain('जोबा-वाला');
    expect(r.after).toContain('जोबा-वाला');
    expect(r.after).not.toContain('आदेगांव-वाला');
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

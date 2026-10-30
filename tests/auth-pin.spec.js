// @ts-check
// वसूली ट्रैकर — टेस्ट: auth-pin (साझा helpers: tests/helpers.js)
const { test, expect, fs, path, openApp, loginLineman, loginJE } = require('./helpers');

test.describe('Lineman PIN — सामान्य सुरक्षा-मज़बूती', () => {
  test('HQ का PIN सेट हो तो गलत PIN से login रुकता है, सही PIN से चलता है', async ({ page }) => {
    await openApp(page);
    // v9.146: PIN अब client पर मिलान नहीं होता (HQ_PIN सिर्फ़ JE पढ़ सकते हैं) — असली फ़ैसला
    // Firebase signInWithEmailAndPassword ही करता है, इसलिए यहां उसे mock करना ज़रूरी है
    await page.evaluate(() => {
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return {
          currentUser: null,
          signInWithEmailAndPassword: function (email, pw) {
            return pw === 'vasuli-4321' ? Promise.resolve({}) : Promise.reject({ code: 'auth/wrong-password' });
          },
        };
      };
    });
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

  test('सफल login पर CU.pin भी याद रखा जाए (v9.146: HQ_PIN अब server से दोबारा नहीं पढ़ी जा सकती, इसी device पर याद रखे pin से ही _ensureCorrectHqAuth बाद में दोबारा sign-in कर पाता है)', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return { currentUser: null, signInWithEmailAndPassword: function () { return Promise.resolve({}); } };
      };
      selectRole('lineman');
      document.getElementById('uname-inp').value = 'टेस्ट लाइनमैन';
      document.getElementById('hq-sel').value = 'आदेगांव';
      document.getElementById('lin-pin').value = '4321';
      doLogin();
    });
    await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'), null, { timeout: 15000 });
    expect(await page.evaluate(() => CU.pin)).toBe('4321');
  });

  test('HQ sign-in reject (गलत password/server) हो तो login रुक जाता है', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
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

  // v9.187 — असली production (4/10, बीबी/SOHAN): "खाता: anonymous • Permission denied"। login के बीच
  // नेट टूटने (या नेट बंद रहते login) पर डाला गया PIN याद नहीं रहता था, तो नेट लौटने पर ऐप सही
  // खाते में जा ही नहीं सकती थी और लाइनमैन को ज़बरदस्ती logout करके दोबारा PIN मांगती
  const netFailLogin = (pin) => {
    window.firebase = window.firebase || {};
    window.firebase.auth = function () {
      return { currentUser: null, signInWithEmailAndPassword: function () { return Promise.reject({ code: 'auth/network-request-failed' }); } };
    };
    selectRole('lineman');
    document.getElementById('uname-inp').value = 'SOHAN';
    document.getElementById('hq-sel').value = 'बीबी';
    document.getElementById('lin-pin').value = pin;
    doLogin();
  };

  test('login के बीच नेट टूटे → डाला PIN याद रहे; नेट लौटते ही चुपचाप सही खाते में (बिना logout, बिना दोबारा PIN)', async ({ page }) => {
    await openApp(page);
    await page.evaluate(netFailLogin, '135790');
    await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'), null, { timeout: 15000 });
    const r = await page.evaluate(() => new Promise((resolve) => {
      const saved = JSON.parse(localStorage.getItem('dc_cu') || '{}');
      let signedWith = null;
      window.firebase.auth = function () {
        return {
          currentUser: { email: null, isAnonymous: true }, // गुमनाम — असली लॉग वाली हालत
          signInWithEmailAndPassword: function (email, pw) { signedWith = { email: email, pw: pw }; return Promise.resolve({}); },
        };
      };
      _authHealed = {}; _authWrongPin = {};
      _ensureCorrectHqAuth(function () {
        resolve({ pinInCU: CU && CU.pin, pinSaved: saved.cu && saved.cu.pin, signedWith: signedWith, stillIn: !!CU });
      });
    }));
    expect(r.pinInCU).toBe('135790');
    expect(r.pinSaved).toBe('135790'); // ऐप बंद-खुलने पर भी याद रहे (session में)
    expect(r.signedWith).toEqual({ email: 'hq-bibi@adegaondc.internal', pw: 'vasuli-135790' });
    expect(r.stillIn).toBe(true); // ज़बरदस्ती logout नहीं
  });

  test('login के बीच नेट टूटे और PIN ग़लत डाला हो → नेट लौटने पर पहले जैसा logout + संदेश (ग़लत PIN से अंदर न रहे)', async ({ page }) => {
    await openApp(page);
    await page.evaluate(netFailLogin, '000000');
    await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'), null, { timeout: 15000 });
    const r = await page.evaluate(() => new Promise((resolve) => {
      window.firebase.auth = function () {
        return { currentUser: { email: null, isAnonymous: true }, signInWithEmailAndPassword: function () { return Promise.reject({ code: 'auth/wrong-password' }); }, signOut: function () { return Promise.resolve(); } };
      };
      _authHealed = {}; _authWrongPin = {};
      _ensureCorrectHqAuth(function () { setTimeout(() => resolve({ cu: CU, login: document.getElementById('login-screen').classList.contains('active') }), 100); });
    }));
    expect(r.cu).toBeNull();
    expect(r.login).toBe(true);
  });

  test('नेट बिल्कुल बंद रहते login → भी PIN याद रहे', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
      selectRole('lineman');
      document.getElementById('uname-inp').value = 'SOHAN';
      document.getElementById('hq-sel').value = 'बीबी';
      document.getElementById('lin-pin').value = '246810';
      doLogin();
    });
    await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'), null, { timeout: 15000 });
    expect(await page.evaluate(() => CU && CU.pin)).toBe('246810');
  });

  test('_ensureCorrectHqAuth — anonymous auth में login हो तो online होते ही सही HQ account से sign-in हो (bug: login के वक़्त network कमज़ोर होने पर device हमेशा के लिए anonymous रह जाता, हर save 401 देता रहता)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      // v9.146: PIN अब server (HQ_PIN, सिर्फ़ JE पढ़ सकते हैं) से नहीं — पिछले सफल login पर इसी
      // device पर याद रखा गया CU.pin इस्तेमाल होता है
      CU = { role: 'lineman', name: 'टेस्ट लाइनमैन', hq: 'आदेगांव', pin: '4321' };
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
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return {
          currentUser: { email: null }, // Firebase अपने session से anonymous पर लौट आया
          signInWithEmailAndPassword: function (email, pw) { resolve({ email: email, pw: pw }); return Promise.resolve({}); },
        };
      };
      // असली restored session में pin भी साथ बहाल होता है (पिछले सफल login पर याद रखा गया — देखें doLogin)
      CU = { role: 'lineman', name: 'बहाल लाइनमैन', hq: 'आदेगांव', pin: '4321' };
      _finishLogin(CU.name, true); // silent = सेव किया session बहाल हुआ
      setTimeout(() => resolve({ email: null, pw: null }), 8000);
    }));
    expect(r.email).toBe('hq-adegaon@adegaondc.internal');
    expect(r.pw).toBe('vasuli-4321');
  });

  test('ताज़ा login (silent नहीं) पर दोबारा sign-in की कोशिश न हो — doLogin खुद सही account से जोड़ चुका है', async ({ page }) => {
    await openApp(page);
    const calls = await page.evaluate(() => new Promise((resolve) => {
      var n = 0;
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return {
          // doLogin() खुद अपना signInWithEmailAndPassword() पहले ही सफल कर चुका है (silent नहीं),
          // तभी _finishLogin(name) बुलाया जाता है — इसलिए currentUser यहां पहले से सही account है
          currentUser: { email: 'hq-adegaon@adegaondc.internal' },
          signInWithEmailAndPassword: function () { n++; return Promise.resolve({}); },
        };
      };
      CU = { role: 'lineman', name: 'ताज़ा लाइनमैन', hq: 'आदेगांव' };
      _finishLogin(CU.name); // silent नहीं
      setTimeout(() => resolve(n), 6000);
    }));
    expect(calls).toBe(0); // _ensureCorrectHqAuth ने account पहले से सही पाया — दोबारा sign-in नहीं किया
  });

  test('_ensureCorrectHqAuth — सही account पहले से हो तो भी पुरानी "अटकी" गिनती साफ़ हो (bug: मैन्युअल logout+login के बाद भी अटका डेटा हमेशा के लिए अटका रह जाता था)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      CU = { role: 'lineman', name: 'अटका', hq: 'आदेगांव' };
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
      AC_TOKEN = 'ac-ok'; // v9.192: App Check token था, फिर भी 401 = खाते की गड़बड़ी (token न होने वाला 401 अब "अटकी" में नहीं गिना जाता)
      CU = { role: 'lineman', name: '401', hq: 'आदेगांव', pin: '4321' };
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

  test('_ensureCorrectHqAuth — PIN याद न हो (v9.146 से पहले login हुआ था) तो चुपचाप न अटके, साफ़ logout करके login screen पर भेज दे (bug: पहले हमेशा के लिए ग़लत account पर अटका रह जाता, हर save 401)', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      CU = { role: 'lineman', name: 'टेस्ट लाइनमैन', hq: 'जोबा' }; // .pin जान-बूझकर सेट नहीं किया
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return { currentUser: { email: null }, signInWithEmailAndPassword: function () { return Promise.resolve({}); } };
      };
      _ensureCorrectHqAuth();
    });
    expect(await page.evaluate(() => document.getElementById('login-screen').classList.contains('active'))).toBe(true);
    expect(await page.evaluate(() => document.getElementById('app-screen').classList.contains('active'))).toBe(false);
    expect(await page.evaluate(() => CU)).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('dc_cu'))).toBeNull();
  });

  test('_ensureCorrectHqAuth — याद रखा PIN ग़लत निकले (auth/wrong-password) तो चुपचाप न अटके, साफ़ logout करके दोबारा सही PIN मांगे (bug: JE ने बाद में PIN बदल दिया हो तो device हमेशा के लिए पुराने PIN से अटका रह जाता, हर श्रेणी में हर save 401 — पाटन/Vaibhav पर v9.152 में यही मिला)', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      CU = { role: 'lineman', name: 'टेस्ट लाइनमैन', hq: 'जोबा', pin: '1234' }; // PIN याद है, पर अब ग़लत मान लो
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return {
          currentUser: { email: null },
          signInWithEmailAndPassword: function () { return Promise.reject({ code: 'auth/wrong-password' }); },
        };
      };
      _ensureCorrectHqAuth();
    });
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.getElementById('login-screen').classList.contains('active'))).toBe(true);
    expect(await page.evaluate(() => document.getElementById('app-screen').classList.contains('active'))).toBe(false);
    expect(await page.evaluate(() => CU)).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('dc_cu'))).toBeNull();
  });

  test('_ensureCorrectHqAuth — re-auth के बीच नेट टूटे (auth/network-request-failed) तो logout न हो, session बना रहे (सच में PIN ग़लत नहीं, सिर्फ़ नेट की समस्या — अगली बार online पर अपने आप दोबारा कोशिश होगी)', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      CU = { role: 'lineman', name: 'टेस्ट लाइनमैन', hq: 'जोबा', pin: '1234' };
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return {
          currentUser: { email: null },
          signInWithEmailAndPassword: function () { return Promise.reject({ code: 'auth/network-request-failed' }); },
        };
      };
      _ensureCorrectHqAuth();
    });
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => CU && CU.hq)).toBe('जोबा'); // session बना रहा, logout नहीं हुआ (doLogout होता तो CU null हो जाता)
  });

  // v9.212 — JE (12/10): "फ़ोन का back बटन दबाकर ऐप दोबारा खोलो तो फिर PIN मांगता है"। पहले नेट के
  // अलावा हर नाकामी पर logout होता था; App Check/reCAPTCHA token न मिलना या "बहुत ज़्यादा कोशिशें"
  // PIN की ग़लती नहीं — तब लाइनमैन अंदर रहे, वजह लॉग हो, थोड़ी देर बाद फिर कोशिश
  for (const code of ['auth/firebase-app-check-token-is-invalid', 'auth/too-many-requests', 'auth/internal-error']) {
    test('_ensureCorrectHqAuth (v9.212) — ' + code + ' पर logout नहीं; लॉग में reauth-needed + reauth-fail; 1 मिनट बाद फिर कोशिश', async ({ page }) => {
      await openApp(page);
      const r = await page.evaluate((c) => new Promise((resolve) => {
        localStorage.removeItem('dc_logs3');
        CU = { role: 'lineman', name: 'टेस्ट लाइनमैन', hq: 'जोबा', pin: '1234' };
        saveSession();
        let tries = 0;
        window.firebase = window.firebase || {};
        window.firebase.auth = function () {
          return { currentUser: { email: null, isAnonymous: true }, signInWithEmailAndPassword: function () { tries++; return Promise.reject({ code: c }); } };
        };
        _ensureCorrectHqAuth(function () {
          setTimeout(() => resolve({ hq: CU && CU.hq, sess: !!localStorage.getItem('dc_cu'), retry: !!_authRetryT, tries, logs: getLogs().map((l) => l.c + '|' + l.x) }), 50);
        });
      }), code);
      expect(r.hq).toBe('जोबा');
      expect(r.sess).toBe(true);
      expect(r.retry).toBe(true);
      expect(r.tries).toBe(1);
      expect(r.logs.some((l) => l.startsWith('reauth-needed|anonymous • PIN याद:हां'))).toBe(true);
      expect(r.logs.some((l) => l === 'reauth-fail|जोबा • ' + code)).toBe(true);
      expect(r.logs.some((l) => l.startsWith('auto-logout'))).toBe(false);
    });
  }

  // v9.213 — असली जड़: JE के लॉग (12/10) में चारों लाइनमैन पर "कोई खाता नहीं"। ऐप दोबारा खुलने पर
  // Firebase सेव किया login बहाल करते हुए 5 सेकंड से ज़्यादा ले लेता (App Check/reCAPTCHA), और
  // _afterAuthReady की 5 सेकंड वाली छूट से हम उससे पहले ही "खाता नहीं" मानकर दोबारा sign-in कर बैठते
  test('_ensureCorrectHqAuth (v9.213) — Firebase अभी login बहाल कर रहा हो (AUTH_READY नहीं) तो रुके; तैयार होते ही सही खाता मिले तो दोबारा sign-in नहीं', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      localStorage.removeItem('dc_logs3');
      CU = { role: 'lineman', name: 'टेस्ट लाइनमैन', hq: 'जोबा', pin: '1234' };
      let signIns = 0, cbAt = null, user = null;
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return { get currentUser() { return user; }, signInWithEmailAndPassword: function () { signIns++; return Promise.resolve({}); } };
      };
      AUTH_LISTENING = true; AUTH_READY = false;
      _ensureCorrectHqAuth(function () { cbAt = 'called'; });
      const before = { signIns, cbAt };
      // Firebase ने सेव किया HQ खाता बहाल कर लिया
      setTimeout(() => {
        user = { email: HQ_AUTH_EMAIL['जोबा'] };
        AUTH_READY = true; _authWaiters.splice(0).forEach((f) => f());
        setTimeout(() => resolve({ before, signIns, cbAt, logs: getLogs().map((l) => l.c) }), 50);
      }, 300);
    }));
    expect(r.before).toEqual({ signIns: 0, cbAt: null }); // तैयार होने से पहले कोई फ़ैसला नहीं
    expect(r.signIns).toBe(0);
    expect(r.cbAt).toBe('called');
    expect(r.logs).not.toContain('reauth-needed');
  });

  test('_ensureCorrectHqAuth (v9.213) — Firebase बहुत देर तक तैयार न हो तो बिना sign-in/logout के आगे (cb चले)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      CU = { role: 'lineman', name: 'टेस्ट लाइनमैन', hq: 'जोबा', pin: '1234' };
      let signIns = 0;
      window.firebase = window.firebase || {};
      window.firebase.auth = function () { return { currentUser: null, signInWithEmailAndPassword: function () { signIns++; return Promise.resolve({}); } }; };
      AUTH_LISTENING = true; AUTH_READY = false; AUTH_WAIT_MAX_MS = 100;
      _ensureCorrectHqAuth(function () { resolve({ signIns, cu: CU && CU.hq }); });
    }));
    expect(r).toEqual({ signIns: 0, cu: 'जोबा' });
  });

  // पूरे रास्ते की नक़ल, असली घड़ी के बिना (page.clock): ऐप दोबारा खुला → _finishLogin वाला
  // _afterAuthReady(_ensureCorrectHqAuth) → Firebase को सेव किया login बहाल करने में 8 सेकंड लगे।
  // v9.213 से पहले 5 सेकंड पर "खाता नहीं" मानकर sign-in होता (और नाकाम होने पर PIN)
  test('ऐप दोबारा खुला, Firebase 8 सेकंड में login बहाल करे — 5 सेकंड की छूट पर भी दोबारा sign-in/logout नहीं (v9.213)', async ({ page }) => {
    await openApp(page);
    await page.clock.install();
    await page.evaluate(() => {
      localStorage.removeItem('dc_logs3');
      CU = { role: 'lineman', name: 'टेस्ट लाइनमैन', hq: 'जोबा', pin: '1234' };
      window.__t = { signIns: 0, cb: 0, user: null };
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return { get currentUser() { return window.__t.user; }, signInWithEmailAndPassword: function () { window.__t.signIns++; return Promise.reject({ code: 'auth/firebase-app-check-token-is-invalid' }); } };
      };
      AUTH_LISTENING = true; AUTH_READY = false; _authWaiters = [];
      _afterAuthReady(function () { _ensureCorrectHqAuth(function () { window.__t.cb++; }); });
      // Firebase 8 सेकंड बाद सेव किया HQ खाता बहाल करता है
      setTimeout(function () {
        window.__t.user = { email: HQ_AUTH_EMAIL['जोबा'] };
        AUTH_READY = true; _authWaiters.splice(0).forEach(function (f) { f(); });
      }, 8000);
    });
    await page.clock.runFor(6000); // 5 सेकंड वाली छूट निकल चुकी
    expect(await page.evaluate(() => [window.__t.signIns, window.__t.cb, CU && CU.hq])).toEqual([0, 0, 'जोबा']);
    await page.clock.runFor(3000); // Firebase तैयार
    expect(await page.evaluate(() => [window.__t.signIns, window.__t.cb, CU && CU.hq, getLogs().some((l) => l.c === 'reauth-needed')])).toEqual([0, 1, 'जोबा', false]);
  });

  test('_ensureCorrectHqAuth (v9.212) — auth/invalid-credential (नया Firebase ग़लत-PIN code) पर logout + लॉग में auto-logout', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      localStorage.removeItem('dc_logs3');
      CU = { role: 'lineman', name: 'टेस्ट लाइनमैन', hq: 'जोबा', pin: '1234' };
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return { currentUser: { email: null }, signInWithEmailAndPassword: function () { return Promise.reject({ code: 'auth/invalid-credential' }); } };
      };
      _ensureCorrectHqAuth();
    });
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => CU)).toBeNull();
    expect(await page.evaluate(() => getLogs().some((l) => l.c === 'auto-logout' && l.x === 'जोबा • auth/invalid-credential'))).toBe(true);
  });

  test('_ensureCorrectHqAuth — JE (supervisor) के लिए कुछ न करे (सिर्फ़ lineman पर लागू)', async ({ page }) => {
    await openApp(page);
    const called = await page.evaluate(() => {
      CU = { role: 'supervisor', name: 'टेस्ट जेई', hq: 'आदेगांव' };
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
      CU = { role: 'lineman', name: 'टेस्ट लाइनमैन', hq: 'आदेगांव', pin: '4321' };
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
    // यह टेस्ट सिर्फ़ यह जांचता है कि payload में HQ-key सही बनती है — PIN की लंबाई इसका विषय
    // नहीं। पहले यहां '1111' था; v9.178 से PIN कम से कम 6 अंक का चाहिए, इसलिए नमूना बदला
    // (लंबाई का नियम अपने अलग describe ब्लॉक में जांचा जाता है, फ़ाइल के अंत में)
    await page.fill('#pin-आदेगांव', '111111');
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
    expect(r.body[r.key]).toBe('111111');
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

  // असली production bug (v9.165 का sse-never-opened लॉग, सर्वर का जवाब "Missing appcheck token"):
  // पहला App Check getToken() नाकाम रहा तो AC_TOKEN null रह जाता, और 401 पर पुराना retry सिर्फ़
  // login token ताज़ा करता — App Check का नहीं, इसलिए retry भी उसी कमी के साथ फिर 401 खाता
  test('_fbFetchWithAuth — 401 पर AC_TOKEN missing हो तो login token के साथ App Check token भी ताज़ा हो', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      AC_TOKEN = null;
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
      window.firebase.appCheck = function () {
        return { getToken: function () { AC_TOKEN = 'fresh-ac-token'; return Promise.resolve({ token: 'fresh-ac-token' }); } };
      };
      _fbFetchWithAuth(FB + '/test.json', { method: 'GET' }).then((res) => {
        resolve({ calls: calls, status: res.status, idToken: ID_TOKEN, acToken: AC_TOKEN });
      });
    }));
    expect(r.calls).toBe(2);
    expect(r.status).toBe(200);
    expect(r.idToken).toBe('fresh-token');
    expect(r.acToken).toBe('fresh-ac-token');
  });

  test('_fbFetchWithAuth — 401 पर AC_TOKEN पहले से मौजूद हो तो सिर्फ़ login token ताज़ा हो (पुराना व्यवहार बरकरार)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      AC_TOKEN = 'already-there';
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
        resolve({ calls: calls, status: res.status, acToken: AC_TOKEN });
      });
    }));
    expect(r.calls).toBe(2);
    expect(r.acToken).toBe('already-there'); // छेड़ा नहीं गया
  });

  // असली bug: पहला App Check getToken() नाकाम रहे तो पहले अगला मौका 30 मिनट बाद मिलता — तब तक हर
  // request बिना App Check header के जाती
  test('_acRefresh (App Check) — पहली कोशिश नाकाम रहे तो 30 मिनट नहीं, जल्दी (AC_RETRY_MS में) दोबारा कोशिश हो', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      AC_TOKEN = null; AC_READY = false;
      if (_acRetryT) { clearTimeout(_acRetryT); _acRetryT = null; }
      AC_RETRY_MS = 20;
      var attempts = 0;
      window.firebase = window.firebase || {};
      window.firebase.appCheck = function () {
        return {
          getToken: function () {
            attempts++;
            if (attempts === 1) return Promise.reject(new Error('अभी तैयार नहीं'));
            return Promise.resolve({ token: 'ac-second-try' });
          },
        };
      };
      _acRefresh();
      setTimeout(() => resolve({ attempts: attempts, token: AC_TOKEN }), 200);
    }));
    expect(r.attempts).toBe(2); // पहली नाकाम, दूसरी जल्दी ही सफल
    expect(r.token).toBe('ac-second-try');
  });

  test('_acRefresh — token मिल जाए तो दोबारा जल्दी कोशिश वाला timer न लगे', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      AC_TOKEN = null; AC_READY = false;
      if (_acRetryT) { clearTimeout(_acRetryT); _acRetryT = null; }
      window.firebase = window.firebase || {};
      window.firebase.appCheck = function () {
        return { getToken: function () { return Promise.resolve({ token: 'ok-first-try' }); } };
      };
      _acRefresh();
      setTimeout(() => resolve({ token: AC_TOKEN, retryScheduled: !!_acRetryT }), 50);
    }));
    expect(r.token).toBe('ok-first-try');
    expect(r.retryScheduled).toBe(false);
  });

  // असली bug: login token 4 सेकंड में भी न बने तो पहले यहां से बिल्कुल raw fetch चला जाता — App
  // Check token उसी बीच तैयार हो चुका हो तब भी उसका header नहीं लगता था
  test('window.fetch — 4 सेकंड में login token न बने तो भी, जो App Check token तैयार हो चुका हो वह लगे', async ({ page }) => {
    await openApp(page);
    test.setTimeout(15000);
    const r = await page.evaluate(() => new Promise((resolve) => {
      ID_TOKEN = null; AC_TOKEN = 'ac-ready'; AC_READY = true;
      var seenHeader = null;
      _rawFetch = function (url, opts) {
        seenHeader = opts && opts.headers && opts.headers['X-Firebase-AppCheck'];
        return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({ ok: true }) });
      };
      fetch(FB + '/test.json').then(() => resolve({ header: seenHeader })); // असली 4-sec wait पूरा होने का इंतज़ार
    }));
    expect(r.header).toBe('ac-ready');
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

  // v9.217 — JE का लॉग (13/10): "sse-never-opened … खाता: anonymous"। JE फ़ोन के hash से अंदर आ गया, पर Firebase
  // login बाद में नाकाम हुआ और फ़ोन anonymous रह गया — बिना चेतावनी, बिना दोबारा कोशिश
  const seedHash = (page) => page.evaluate((p) => new Promise((res) => {
    _sha256('dcje|' + p).then((h) => { try { localStorage.setItem('dc_jeh', h); } catch (e) {} res(); });
  }), 'Test#123');

  test('verifyJE (v9.217) — App Check token न मिले तो "गलत पासवर्ड!" नहीं: hash से अंदर, और थोड़ी देर बाद उसी पासवर्ड से फिर Firebase login', async ({ page }) => {
    await openApp(page);
    await seedHash(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      JE_RETRY_MS = 100;
      const calls = [];
      let n = 0;
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return { currentUser: null, signInWithEmailAndPassword: function (em, pw) { calls.push(pw); n++; return n === 1 ? Promise.reject({ code: 'auth/firebase-app-check-token-is-invalid' }) : Promise.resolve({}); } };
      };
      verifyJE('Test#123', function (ok, msg) {
        CU = { role: 'supervisor', name: 'JE', hq: 'आदेगांव' };
        setTimeout(() => resolve({ ok, msg, calls, pending: _jePendingPw, stored: Object.keys(localStorage).filter((k) => localStorage.getItem(k) === 'Test#123') }), 400);
      });
    }));
    expect(r.ok).toBe(true);
    expect(r.msg).toBeNull();
    expect(r.calls).toEqual(['Test#123', 'Test#123']); // दूसरी कोशिश अपने-आप
    expect(r.pending).toBeNull(); // जुड़ते ही memory से हटा
    expect(r.stored).toEqual([]); // पासवर्ड कभी localStorage में नहीं
  });

  test('_jeRetryAuth (v9.218) — कमज़ोर नेट पर बार-बार कोशिश (2/5/10 मिनट), लॉग में सिर्फ़ पहली नाकामी, जुड़ते ही je-auth-recovered', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      localStorage.removeItem('dc_logs3');
      CU = { role: 'supervisor', name: 'JE', hq: 'आदेगांव' };
      JE_RETRY_BACKOFF_MS = [50, 50, 50];
      _jeTries = 0; _jeFirstFailAt = 0; _jeFailLogged = false; _jeRetryT = null;
      let n = 0;
      window.firebase = window.firebase || {};
      window.firebase.auth = function () { return { signInWithEmailAndPassword: function () { n++; return n <= 2 ? Promise.reject({ code: 'auth/network-request-failed' }) : Promise.resolve({}); } }; };
      _jePendingPw = 'Test#123';
      _jeRetryAuth();
      setTimeout(() => resolve({ n, pending: _jePendingPw, logs: getLogs().map((l) => l.c + '|' + l.x), strip: getComputedStyle(document.getElementById('je-auth-strip')).display }), 600);
    }));
    expect(r.n).toBe(3);
    expect(r.pending).toBeNull();
    expect(r.logs.filter((l) => l.startsWith('je-auth-retry-fail')).length).toBe(1);
    expect(r.logs.some((l) => /^je-auth-recovered\|\d+ मिनट बाद • कोशिशें: 3$/.test(l))).toBe(true);
    expect(r.strip).toBe('none');
  });

  test('verifyJE (v9.217) — सच में ग़लत पासवर्ड (auth/invalid-credential) पर "गलत पासवर्ड!" पहले जैसा', async ({ page }) => {
    await openApp(page);
    await seedHash(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      window.firebase = window.firebase || {};
      window.firebase.auth = function () { return { signInWithEmailAndPassword: function () { return Promise.reject({ code: 'auth/invalid-credential' }); } }; };
      verifyJE('Galat#1', function (ok, msg) { resolve({ ok, msg }); });
    }));
    expect(r).toEqual({ ok: false, msg: 'गलत पासवर्ड!' });
  });

  test('checkJEAuth (v9.217) — JE ऐप में पर Firebase खाता anonymous: लाल पट्टी + लॉग "je-auth-missing"; JE खाता हो तो पट्टी नहीं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      localStorage.removeItem('dc_logs3');
      _jePendingPw = null; _jeAuthLogged = false;
      let user = { isAnonymous: true, email: null };
      window.firebase = window.firebase || {};
      window.firebase.auth = function () { return { get currentUser() { return user; }, signInWithEmailAndPassword: function () { return Promise.resolve({}); } }; };
      checkJEAuth();
      const shown = getComputedStyle(document.getElementById('je-auth-strip')).display;
      const log = getLogs().find((l) => l.c === 'je-auth-missing');
      user = { email: JE_EMAIL };
      checkJEAuth();
      return { shown, x: log && log.x, after: getComputedStyle(document.getElementById('je-auth-strip')).display };
    });
    expect(r.shown).toBe('flex');
    expect(r.x).toContain('anonymous');
    expect(r.after).toBe('none');
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

test.describe('Lineman PIN — कम से कम 6 अंक (password सीधे PIN से बनता है)', () => {
  test('_pinProblem — खाली चले, छोटा/ग़ैर-अंक रुके, 6 अंक चले', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => ({
      khali: _pinProblem(''),
      chaar: _pinProblem('1234'),
      paanch: _pinProblem('12345'),
      chah: _pinProblem('123456'),
      lamba: _pinProblem('12345678'),
      akshar: _pinProblem('abc123'),
    }));
    expect(r.khali).toBe('');   // खाली = इस HQ में PIN ज़रूरी नहीं
    expect(r.chah).toBe('');
    expect(r.lamba).toBe('');
    expect(r.chaar).toContain('6 अंक');
    expect(r.paanch).toContain('6 अंक');
    expect(r.akshar).toContain('अंक');
  });

  test('savePins — एक भी PIN ग़लत हो तो कुछ भी सेव न हो (आधा-अधूरा न बचे)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      let put = 0;
      const origFetch = window.fetch;
      window.fetch = function (u, o) {
        if (String(u).indexOf('/HQ_PIN.json') > -1 && o && o.method === 'PUT') put++;
        return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
      };
      openPinModal();
      document.getElementById('pin-' + hqKey(HQS[0])).value = '123456'; // सही
      document.getElementById('pin-' + hqKey(HQS[1])).value = '12';     // ग़लत
      savePins();
      const msg = document.getElementById('toast').textContent;
      window.fetch = origFetch;
      return { put, msg };
    });
    expect(r.put).toBe(0);               // एक भी PUT नहीं गया
    expect(r.msg).toContain('6 अंक');
    expect(r.msg).toContain(' — ');      // किस HQ में गड़बड़ है, वह भी दिखा
  });

  test('savePins — सभी सही हों तो सेव हो जाए', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      let body = null;
      const origFetch = window.fetch;
      window.fetch = function (u, o) {
        if (String(u).indexOf('/HQ_PIN.json') > -1 && o && o.method === 'PUT') body = JSON.parse(o.body);
        return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
      };
      openPinModal();
      HQS.forEach((hq) => { document.getElementById('pin-' + hqKey(hq)).value = ''; });
      document.getElementById('pin-' + hqKey(HQS[0])).value = '987654';
      savePins();
      window.fetch = origFetch;
      return { body, key: hqKey(HQS[0]) };
    });
    expect(r.body).toEqual({ [r.key]: '987654' });
  });

  test('modal में पुराने छोटे PIN पर ⚠ चेतावनी दिखे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const html = await page.evaluate(() => {
      HQ_PINS = {}; HQ_PINS[hqKey(HQS[0])] = '1234'; // पुराना 4-अंकी
      openPinModal();
      return document.getElementById('pin-fields').innerHTML;
    });
    expect(html).toContain('⚠');
    expect(html).toContain('6 अंक');
  });
});

// JE ने 29/9 को Firebase Console में देखा: किसी खाते के ⋮ मेनू में सिर्फ़ "Reset password",
// "Disable account", "Delete account" हैं — कोई "Edit user" नहीं। और "Reset password" सिर्फ़
// email भेजता है, जबकि हमारे खाते hq-*@adegaondc.internal पर हैं (असली domain नहीं), इसलिए वह
// email कहीं पहुंचती ही नहीं। यानी Console से लाइनमैन का PIN बदला ही नहीं जा सकता।
// Delete का रास्ता और ख़तरनाक: नया खाता = नया UID, जबकि database.rules.json में हर मुख्यालय का
// UID हार्डकोडेड है। इसलिए scripts/set-hq-pin.js — Admin SDK से password बदलता है, UID वही रहता है।
const { execFileSync } = require('child_process');
function runSetPin(env) {
  try {
    const out = execFileSync('node', [path.join(__dirname, '..', 'scripts', 'set-hq-pin.js')],
      { env: Object.assign({}, process.env, env), encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}


test.describe('HQ PIN लागू करने वाली script', () => {
  test('अनजाना मुख्यालय रुके, और सही विकल्प गिना दे', () => {
    const r = runSetPin({ HQ: 'मंडला' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('जाना-पहचाना मुख्यालय नहीं');
    expect(r.out).toContain('मढ़ी');
    expect(r.out).toContain('सभी');
    expect(r.out).not.toContain('firebase-admin'); // जांच SDK से पहले ही हो गई
  });

  test('मुख्यालय चुना ही न हो तो रुके', () => {
    const r = runSetPin({ HQ: '' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('मुख्यालय नहीं चुना');
  });

  // टिप्पणियों में इन्हीं ग़लतियों की व्याख्या लिखी है, इसलिए मिलान सिर्फ़ असली कोड पर करें
  const codeOnly = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|#)/.test(l)).join('\n');

  test('script PIN को input के तौर पर लेती ही नहीं — इसलिए लॉग में लीक हो ही नहीं सकता', () => {
    const scr = codeOnly(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'set-hq-pin.js'), 'utf8'));
    const yml = codeOnly(fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'set-hq-pin.yml'), 'utf8'));
    // run #1 में PIN workflow input था और GitHub ने उसे step के env ब्लॉक में छाप दिया था
    expect(scr).not.toContain('NEW_PIN');
    expect(yml).not.toMatch(/new_pin/i);
    // PIN अब वहीं से आता है जहां JE भरते हैं
    expect(scr).toContain('HQ_PIN');
  });

  test('firebase-admin@14 का सही (modular) रास्ता इस्तेमाल हो — admin.auth() नहीं', () => {
    const scr = codeOnly(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'set-hq-pin.js'), 'utf8'));
    // run #1 यहीं गिरा था: "admin.auth is not a function" — v14 में top-level पर auth है ही नहीं
    expect(scr).not.toMatch(/admin\s*\.\s*auth\s*\(/);
    expect(scr).toContain('firebase-admin/auth');
    expect(scr).toContain('getAuth');
  });

  test('script के HQ ईमेल js/config.js वालों से बिल्कुल मिलें', () => {
    const cfg = fs.readFileSync(path.join(__dirname, '..', 'js', 'config.js'), 'utf8');
    const scr = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'set-hq-pin.js'), 'utf8');
    const pick = (src) => (src.match(/hq-[a-z]+@adegaondc\.internal/g) || []).sort();
    const a = pick(cfg), b = pick(scr);
    expect(b.length).toBe(6);
    expect(b).toEqual(a); // दोनों जगह एक साथ बदलने पड़ते हैं, वरना ग़लत खाते का PIN बदल जाएगा
  });

  test('password-सूत्र और hqKey js/ वालों से मिलें', () => {
    const auth = fs.readFileSync(path.join(__dirname, '..', 'js', 'auth.js'), 'utf8');
    const cfg = fs.readFileSync(path.join(__dirname, '..', 'js', 'config.js'), 'utf8');
    const scr = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'set-hq-pin.js'), 'utf8');
    // सूत्र अलग हुआ तो PIN लागू होते ही हर लाइनमैन का login टूटेगा
    expect(auth).toMatch(/return\s*"vasuli-"\s*\+\s*pin/);
    expect(scr).toMatch(/return\s*"vasuli-"\s*\+\s*pin/);
    // hqKey अलग हुआ तो script /HQ_PIN में ग़लत जगह देखेगी और "PIN भरा ही नहीं" कहकर छोड़ देगी।
    // दोनों regex एक ही अर्थ के हैं पर लिखावट अलग हो सकती है (js/ में \\[ \\] \\/ escape हैं,
    // script में eslint की पसंद के मुताबिक बिना escape) — इसलिए तुलना से पहले escape हटा दें
    const grabRe = (src) => (src.match(/hqKey\(hq\)\s*\{\s*return[^;]*?replace\((\/[^\n]+?\/g)/) || [])[1];
    const normRe = (re) => String(re).replace(/\\([[\]/])/g, '$1');
    const cfgRe = grabRe(cfg), scrRe = grabRe(scr);
    expect(cfgRe).toBeTruthy();
    expect(scrRe).toBeTruthy();
    expect(normRe(scrRe)).toBe(normRe(cfgRe));
  });

  test('MIN_PIN_LEN ऐप और script में एक जैसा हो', () => {
    const auth = fs.readFileSync(path.join(__dirname, '..', 'js', 'auth.js'), 'utf8');
    const scr = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'set-hq-pin.js'), 'utf8');
    const a = (auth.match(/MIN_PIN_LEN\s*=\s*(\d+)/) || [])[1];
    const b = (scr.match(/MIN_PIN_LEN\s*=\s*(\d+)/) || [])[1];
    expect(a).toBe('6');
    expect(b).toBe(a);
  });

  test('काम पूरा होते ही Firebase से नाता तोड़े — वरना job timeout तक अटका रहता है', () => {
    const scr = codeOnly(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'set-hq-pin.js'), 'utf8'));
    // run #2 में यही हुआ: छहों PIN लागू हो गए, पर RTDB का connection खुला रहने से Node बंद ही
    // नहीं हुआ और job 5 मिनट का timeout खाकर लाल हो गया — काम सफल, निशान झूठा
    expect(scr).toContain('goOffline');
    expect(scr).toContain('deleteApp');
    expect(scr).toMatch(/await\s+shutdown\s*\(/);      // सफल रास्ते पर सचमुच बुलाया जाए
    expect(scr).toMatch(/\.unref\s*\(\s*\)/);          // और कुछ और अटकाए तो भी निकलने का रास्ता हो
  });

  test('workflow "सभी" का विकल्प दे और PIN ऐप से लेने की बात बताए', () => {
    const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'set-hq-pin.yml'), 'utf8');
    expect(yml).toContain('- सभी');
    expect(yml).toContain('ऐप में जो भरा है');
  });
});

// असली production bug (29/9, दो devices पर एक साथ): JE ने छहों मुख्यालयों का PIN बदला, तो हर
// device का सेव किया हुआ पुराना PIN बेकार हो गया। _ensureCorrectHqAuth कई जगह से लगभग एक साथ
// बुलाया जाता है, इसलिए कई sign-in एक साथ नाकाम हुए — पहले वाले ने doLogout() करके CU को null
// कर दिया, और उसके बाद जो दूसरा catch चला वह CU.hq पढ़ते ही गिर गया:
//   promise — Cannot read properties of null (reading 'hq') — (login से पहले) — v9.179
// गिरने से cb() भी कभी नहीं चला, यानी उसका इंतज़ार करने वाला (reconcileHQ वगैरह) चुपचाप अटक गया।
test.describe('PIN बदलने पर एक साथ कई re-auth नाकाम हों तो भी कुछ न गिरे', () => {
  test('doLogout से CU null हो जाने के बाद वाला catch भी सुरक्षित चले, और cb() मिले', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      const errs = [];
      window.addEventListener('unhandledrejection', (e) => errs.push(String((e.reason && e.reason.message) || e.reason)));
      CU.pin = '111111';                 // device पर सेव पुराना PIN
      _authWrongPin = {}; _authHealed = {};
      // JE ने PIN बदल दिया — हर sign-in "ग़लत PIN" से नाकाम होगा
      window.firebase = {
        auth: function () {
          return {
            currentUser: { email: 'someone-else@x.y' }, // ग़लत account → नया sign-in ज़रूरी
            signInWithEmailAndPassword: function () {
              return Promise.reject({ code: 'auth/wrong-password' });
            },
          };
        },
      };
      let done = 0;
      const finish = () => { done++; };
      // ठीक वही स्थिति: दो कॉल लगभग एक साथ (कई श्रेणियों में एक साथ save नाकाम होना)
      _ensureCorrectHqAuth(finish);
      _ensureCorrectHqAuth(finish);
      setTimeout(() => resolve({ done, errs, cu: CU }), 400);
    }));
    expect(r.errs).toEqual([]);   // कोई unhandled rejection नहीं
    expect(r.done).toBe(2);       // दोनों callers को जवाब मिला — कोई अटका नहीं
    expect(r.cu).toBeNull();      // logout फिर भी हुआ, यानी दोबारा PIN मांगा जाएगा
  });

  test('CU null हो जाने के बाद दोबारा बुलाने पर चुपचाप लौटे', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      const errs = [];
      window.addEventListener('unhandledrejection', (e) => errs.push(String(e.reason)));
      CU = null;
      let called = false;
      _ensureCorrectHqAuth(() => { called = true; });
      setTimeout(() => resolve({ called, errs }), 200);
    }));
    expect(r.errs).toEqual([]);
    expect(r.called).toBe(true);
  });
});

// असली production bug (29/9, PIN बदलने के तुरंत बाद): कई devices पर pending-stuck-auth लग गया
// ("लगातार 3 बार 401/403 — auto-retry रोका")। _authHealed/_authWrongPin सिर्फ़ इस पन्ने की
// याददाश्त में रहते हैं, session में नहीं — और doLogout उन्हें साफ़ नहीं करता था। इसलिए PIN बदलने
// पर हुए logout के बाद, नया PIN डालकर login करने पर भी "!_authHealed[hq]" झूठ निकलता और
// _resetAuthFailForHQ()+flushPending() दोनों छूट जाते — अटकी वसूली उसी session में अटकी रह जाती।
test.describe('logout पर auth-गार्ड साफ़ हों — नया PIN डालते ही अटकी वसूली चल पड़े', () => {
  test('doLogout के बाद _authHealed/_authWrongPin खाली हों', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await page.evaluate(() => {
      _authHealed = { 'आदेगांव': true, 'मढ़ी': true };
      _authWrongPin = { 'आदेगांव': true };
      doLogout(false);
      return { healed: Object.keys(_authHealed), wrong: Object.keys(_authWrongPin), cu: CU };
    });
    expect(r.healed).toEqual([]);
    expect(r.wrong).toEqual([]);
    expect(r.cu).toBeNull();
  });

  test('पूरा चक्र — PIN बदला, logout हुआ, नया PIN से login पर अटकी entries फिर से भेजी जाएं', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const r = await page.evaluate(() => {
      const hq = CU.hq;
      // (1) पहले सब ठीक चल रहा था — यही _authHealed को true कर देता है
      _authHealed = {}; _authHealed[hq] = true;
      // (2) लगातार 401 से एक entry अटक चुकी है (pending-stuck-auth जैसी स्थिति)
      const p = {}; p[cKey(hq, 'कुल उपभोक्ता')] = { hq: hq, cat: 'कुल उपभोक्ता', authFailCount: 3 };
      setPendingObj(p);
      // (3) PIN बदलने पर logout
      doLogout(false);
      const afterLogout = Object.keys(_authHealed).length;
      // (4) नया PIN डालकर login — अब account सही है
      CU = { role: 'lineman', name: 'रमेश', hq: hq, pin: '654321' };
      window.firebase = { auth: () => ({ currentUser: { email: HQ_AUTH_EMAIL[hq] } }) };
      let cbRan = false;
      _ensureCorrectHqAuth(() => { cbRan = true; });
      const entry = getPending()[cKey(hq, 'कुल उपभोक्ता')];
      return { afterLogout, cbRan, fails: entry && entry.authFailCount };
    });
    expect(r.afterLogout).toBe(0);
    expect(r.cbRan).toBe(true);
    expect(r.fails).toBe(0); // अटकी entry फिर से भेजी जा सकती है
  });
});

// असली production bug (29/9): एक device का सेव session "Adegaon" (अंग्रेज़ी) लिए बैठा था, जबकि
// HQS में "आदेगांव" (देवनागरी) है। यह नाम न config.js में कभी था, न index.html के dropdown में —
// किसी बहुत पुराने रूप से बचा हुआ था। error log में:
//   sse-never-opened — [Adegaon/कुल उपभोक्ता • खाता: anonymous • HTTP 401 • जवाब: Permission denied]
//   cash-refresh-partial — 8/8 श्रेणी ताज़ा नहीं हो पाईं (सब Adegaon/…)
// वजह: HQ_AUTH_EMAIL["Adegaon"] undefined → _ensureCorrectHqAuth चुपचाप लौट जाता → device कभी
// सही account पर आता ही नहीं → हर पढ़ना-लिखना /Adegaon/… पर, जिसे rules का "$other": false मना
// करता। ऐप चालू दिखता रहता (cache से), पर दर्ज वसूली कभी सर्वर तक नहीं पहुंचती।
test.describe('सेव session का HQ HQS में न हो तो बहाल ही न हो', () => {
  test('अनजाने HQ वाला session null लौटे, और दोबारा न दोहराए (storage से हट जाए)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      localStorage.setItem('dc_cu', JSON.stringify({
        cu: { role: 'lineman', name: 'आनंद कुमार कवरेती', hq: 'Adegaon', pin: '123456' },
        at: Date.now(),
      }));
      const first = loadSession();
      const left = localStorage.getItem('dc_cu');
      return { first, left };
    });
    expect(r.first).toBeNull();
    expect(r.left).toBeNull(); // साफ़ हो गया — हर बार ऐप खुलने पर यही न दोहराए
  });

  test('सही HQ वाला session पहले की तरह बहाल हो', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      localStorage.setItem('dc_cu', JSON.stringify({
        cu: { role: 'lineman', name: 'रमेश', hq: HQS[0], pin: '123456' },
        at: Date.now(),
      }));
      const s = loadSession();
      return { hq: s && s.hq, name: s && s.name };
    });
    expect(r.hq).toBe('आदेगांव');
    expect(r.name).toBe('रमेश');
  });

  test('JE का session भी बहाल हो (उसका hq हमेशा HQS[0] होता है)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      localStorage.setItem('dc_cu', JSON.stringify({
        cu: { role: 'supervisor', name: 'प्रदीप', hq: HQS[0] }, at: Date.now(),
      }));
      const s = loadSession();
      return s && s.role;
    });
    expect(r).toBe('supervisor');
  });

  test('अनजाने HQ पर बिना भेजे बदलाव हों तो लॉग में गिनती भी जाए (JE को पता चले)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      let logged = null;
      const orig = window.logErr;
      window.logErr = function (ctx, msg) { if (ctx === 'session-unknown-hq') logged = String(msg); };
      const p = {}; p[cKey('Adegaon', 'कुल उपभोक्ता')] = { hq: 'Adegaon', cat: 'कुल उपभोक्ता' };
      setPendingObj(p);
      localStorage.setItem('dc_cu', JSON.stringify({
        cu: { role: 'lineman', name: 'आनंद', hq: 'Adegaon' }, at: Date.now(),
      }));
      loadSession();
      window.logErr = orig;
      return logged;
    });
    expect(r).toContain('Adegaon');
    expect(r).toContain('1 बदलाव');
    expect(r).toContain('JE देखें');
  });
});

// असली production bug की असली जड़ (JE ने बताई, 29/9): लाइनमैन आनंद ब्राउज़र का Translate बटन
// दबाकर पन्ना अंग्रेज़ी कर लेता है। login वाले HQ dropdown के options में value attribute थी ही
// नहीं, इसलिए select.value वही लौटाता जो दिखता है — और अनुवाद के बाद वह "Adegaon" हो जाता।
// फिर HQ_AUTH_EMAIL["Adegaon"] undefined → device कभी सही account पर आता ही नहीं (anonymous
// रह जाता) → हर पढ़ना-लिखना /Adegaon/… पर, जिसे rules का "$other": false मना करता।
// Translate सिर्फ़ दिखने वाला text बदलता है, attributes को नहीं छूता — इसलिए value ही असली इलाज है।
test.describe('ब्राउज़र अनुवाद से HQ का नाम न बिगड़े', () => {
  test('हर HQ option में value हो, और select पर translate="no" भी', async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const sel = html.slice(html.indexOf('id="hq-sel"'), html.indexOf('</select>', html.indexOf('id="hq-sel"')));
    expect(sel).toContain('translate="no"');
    ['आदेगांव', 'पिंडरई', 'जोबा', 'पाटन', 'बीबी', 'मढ़ी'].forEach((hq) => {
      expect(sel).toContain('value="' + hq + '"');
    });
    // बिना value वाला कोई option न बचे (खाली "-- HQ चुनें --" को छोड़कर, उसकी value="" है)
    expect(sel).not.toMatch(/<option>/);
  });

  test('अनुवाद के बाद भी select.value असली (हिंदी) नाम ही लौटाए', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      const sel = document.getElementById('hq-sel');
      sel.value = 'आदेगांव';
      const before = sel.value;
      // Chrome Translate ठीक यही करता है — सिर्फ़ दिखने वाला text बदलता है
      Array.prototype.forEach.call(sel.options, (o) => {
        if (o.value === 'आदेगांव') o.textContent = 'Adegaon';
        if (o.value === 'मढ़ी') o.textContent = 'Madhi';
      });
      return { before, after: sel.value, dikhta: sel.options[sel.selectedIndex].textContent };
    });
    expect(r.before).toBe('आदेगांव');
    expect(r.after).toBe('आदेगांव');   // ऐप को असली नाम ही मिला
    expect(r.dikhta).toBe('Adegaon');  // भले दिखने में बदल गया हो
  });

  test('अनुवादित पन्ने से किया गया login भी सही HQ पर बैठे', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      window.firebase = undefined;
      // पहले पन्ना "अनुवादित" करो, फिर सामान्य तरीक़े से login
      const sel = document.getElementById('hq-sel');
      Array.prototype.forEach.call(sel.options, (o) => { if (o.value) o.textContent = 'Translated-' + o.value; });
      document.getElementById('rc-lin').click();
      document.getElementById('uname-inp').value = 'आनंद कुमार कवरेती';
      sel.value = 'आदेगांव';
      doLogin();
      return { hq: CU && CU.hq, valid: CU ? HQS.indexOf(CU.hq) >= 0 : null };
    });
    expect(r.hq).toBe('आदेगांव');
    expect(r.valid).toBe(true); // यही वह जांच है जो v9.182 में loadSession पर भी लगी
  });
});

// ── v9.184: save/sync पर 401/403 की असली वजह लॉग में ──
// असली production (30/9): नीलेश (मढ़ी) और Manoj (पाटन) login किए हुए थे, फिर भी "save-fail HTTP 401"
// — लॉग में बस इतना था, वजह अंदाज़े से बतानी पड़ी। अब साथ में खाता, दोनों token और सर्वर का जवाब।
// message वही "HTTP 401" रहना ज़रूरी है — auth-fail गिनती और toast उसी से पहचानते हैं
test.describe('save/sync 401 — लॉग में खाता, token और सर्वर का जवाब (v9.184)', () => {
  const denied = '{\n  "error" : "Permission denied"\n}';

  test('save-fail (PATCH) 401 — खाता/AppCheck/login token/जवाब दर्ज हों, message "HTTP 401" ही रहे और auth-fail गिनती बढ़े', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate((body) => new Promise((resolve) => {
      AC_TOKEN = 'ac-ok'; // v9.192: App Check token था, फिर भी 401 = खाते की गड़बड़ी (token न होने वाला 401 अब "अटकी" में नहीं गिना जाता)
      try { localStorage.removeItem('dc_logs3'); } catch (e) {}
      var hq = 'पाटन', cat = 'वैभव';
      window.fetch = function () {
        return Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve(body) });
      };
      _fbSendPatch(hq, cat, { '123': { acc: '123', status: 'paid' } }, function () {
        setTimeout(() => {
          var l = getLogs().filter((x) => x.c === 'save-fail');
          var pend = getPending()[cKey(hq, cat)];
          resolve({ logs: l, fail: pend && pend.authFailCount });
        }, 50);
      });
    }), denied);
    expect(r.logs.length).toBe(1);
    expect(r.logs[0].m).toBe('HTTP 401');
    expect(r.logs[0].x).toContain('पाटन/वैभव');
    expect(r.logs[0].x).toContain('खाता:');
    expect(r.logs[0].x).toContain('AppCheck token:');
    expect(r.logs[0].x).toContain('login token:');
    expect(r.logs[0].x).toContain('जवाब: { "error" : "Permission denied" }');
    expect(r.fail).toBe(1); // _bumpAuthFail ने 401 पहचाना — पहले जैसा
  });

  test('save-fail — नेट/सर्वर वाली (500) नाकामी पर यह जानकारी न जुड़े (लॉग में शोर नहीं)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      try { localStorage.removeItem('dc_logs3'); } catch (e) {}
      window.fetch = function () { return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('oops') }); };
      _fbSendPatch('पाटन', 'वैभव', { '123': { acc: '123', status: 'paid' } }, function () {
        setTimeout(() => resolve(getLogs().filter((x) => x.c === 'save-fail')), 50);
      });
    }));
    expect(r.length).toBe(1);
    expect(r[0].m).toBe('HTTP 500');
    expect(r[0].x).toBe('पाटन/वैभव');
  });

  test('sync-patch-fail (offline बदलाव दोबारा भेजते वक़्त) 401 — वही जानकारी दर्ज हो', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate((body) => new Promise((resolve) => {
      try { localStorage.removeItem('dc_logs3'); } catch (e) {}
      var hq = 'मढ़ी', cat = 'मदन', k = cKey(hq, cat), p = {};
      p[k] = { hq: hq, cat: cat, type: 'put', patch: { '555': { acc: '555', status: 'paid' } } };
      setPendingObj(p);
      window.fetch = function (url, opts) {
        if (opts && opts.method === 'PATCH') return Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve(body) });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(null) }); // रिमार्क-मिलान वाली पढ़ाई
      };
      _flushing = false;
      flushPending();
      setTimeout(() => resolve(getLogs().filter((x) => x.c === 'sync-patch-fail')), 400);
    }), denied);
    expect(r.length).toBe(1);
    expect(r[0].m).toBe('HTTP 401');
    expect(r[0].x).toContain('मढ़ी/मदन');
    expect(r[0].x).toContain('खाता:');
    expect(r[0].x).toContain('जवाब: { "error" : "Permission denied" }');
  });
});

// ── v9.188: घंटों पीछे पड़े फ़ोन पर लौटते ही पुराने (ख़त्म) token न जाएं ──
// असली production (6/10): App Check Verified% 97 → 94। App Check token ~1 घंटा चलता है, ताज़ा करने
// का टाइमर (30 मिनट) minimize में Android रोक देता है — लौटते ही fetchPause और v9.185 की "हाज़िरी"
// ख़त्म token के साथ जाती थीं और "unverified" में गिनती थीं
test.describe('token ताज़गी — ख़त्म होने वाले token से पहले नया (v9.188)', () => {
  // असली जैसा JWT: payload में exp (सेकंड)
  const jwtSetup = () => {
    window.mkJwt = (expInSec, tag) => {
      const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
      return b64({ alg: 'none' }) + '.' + b64({ exp: Math.floor(Date.now() / 1000) + expInSec, t: tag }) + '.sig';
    };
  };

  test('App Check token ख़त्म हो चुका हो → request से पहले नया लिया जाए, और request उसी नए token के साथ जाए', async ({ page }) => {
    await openApp(page);
    await page.evaluate(jwtSetup);
    const r = await page.evaluate(() => new Promise((resolve) => {
      const fresh = window.mkJwt(3600, 'new');
      let gets = 0, sentAc = null;
      window.firebase = window.firebase || {};
      window.firebase.appCheck = () => ({ getToken: () => { gets++; return Promise.resolve({ token: fresh }); } });
      window.firebase.auth = () => ({ currentUser: { getIdToken: () => Promise.resolve(ID_TOKEN) } });
      _rawFetch = (url, opts) => { sentAc = opts.headers['X-Firebase-AppCheck']; return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(null) }); };
      AC_READY = true;
      ID_TOKEN = window.mkJwt(3600, 'id');
      AC_TOKEN = window.mkJwt(-60, 'old'); // एक मिनट पहले ख़त्म
      fetch(FB + '/PAUSE.json').then(() => resolve({ gets: gets, sentNew: sentAc === fresh }));
    }));
    expect(r.gets).toBe(1);
    expect(r.sentNew).toBe(true);
  });

  test('token ताज़ा हों → कोई अतिरिक्त काम नहीं (हर request पर बेवजह token न मांगे)', async ({ page }) => {
    await openApp(page);
    await page.evaluate(jwtSetup);
    const gets = await page.evaluate(() => new Promise((resolve) => {
      let n = 0;
      window.firebase = window.firebase || {};
      window.firebase.appCheck = () => ({ getToken: () => { n++; return Promise.resolve({ token: 'x' }); } });
      window.firebase.auth = () => ({ currentUser: { getIdToken: () => { n++; return Promise.resolve('y'); } } });
      _rawFetch = () => Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(null) });
      AC_READY = true;
      ID_TOKEN = window.mkJwt(3000, 'id');
      AC_TOKEN = window.mkJwt(3000, 'ac');
      Promise.all([fetch(FB + '/a.json'), fetch(FB + '/b.json')]).then(() => resolve(n));
    }));
    expect(gets).toBe(0);
  });

  test('login token ख़त्म हो चुका हो → वह भी पहले नया, और ?auth= में नया जाए', async ({ page }) => {
    await openApp(page);
    await page.evaluate(jwtSetup);
    const r = await page.evaluate(() => new Promise((resolve) => {
      const freshId = window.mkJwt(3600, 'idnew');
      let sentUrl = null;
      window.firebase = window.firebase || {};
      window.firebase.appCheck = () => ({ getToken: () => Promise.resolve({ token: AC_TOKEN }) });
      window.firebase.auth = () => ({ currentUser: { getIdToken: () => Promise.resolve(freshId) } });
      _rawFetch = (url) => { sentUrl = url; return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(null) }); };
      AC_READY = true;
      AC_TOKEN = window.mkJwt(3600, 'ac');
      ID_TOKEN = window.mkJwt(-10, 'idold');
      fetch(FB + '/x.json').then(() => resolve({ hasNew: sentUrl.indexOf(encodeURIComponent(freshId)) > -1 || sentUrl.indexOf(freshId) > -1 }));
    }));
    expect(r.hasNew).toBe(true);
  });

  test('नया token न मिले (reCAPTCHA अटका) → ज़्यादा से ज़्यादा ~4 सेकंड रुककर request फिर भी जाए (कुछ अटके नहीं)', async ({ page }) => {
    await openApp(page);
    await page.evaluate(jwtSetup);
    const r = await page.evaluate(() => new Promise((resolve) => {
      window.firebase = window.firebase || {};
      window.firebase.appCheck = () => ({ getToken: () => new Promise(() => {}) }); // कभी जवाब नहीं
      window.firebase.auth = () => ({ currentUser: { getIdToken: () => Promise.resolve(ID_TOKEN) } });
      let sent = false;
      _rawFetch = () => { sent = true; return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(null) }); };
      AC_READY = true;
      ID_TOKEN = window.mkJwt(3600, 'id');
      AC_TOKEN = window.mkJwt(-60, 'old');
      const t0 = Date.now();
      fetch(FB + '/x.json').then(() => resolve({ sent: sent, ms: Date.now() - t0 }));
    }));
    expect(r.sent).toBe(true);
    expect(r.ms).toBeGreaterThanOrEqual(3500);
    expect(r.ms).toBeLessThan(6000);
  });

  test('एक साथ कई requests (लौटते ही) → नया token सिर्फ़ एक बार मांगा जाए', async ({ page }) => {
    await openApp(page);
    await page.evaluate(jwtSetup);
    const gets = await page.evaluate(() => new Promise((resolve) => {
      let n = 0;
      const fresh = window.mkJwt(3600, 'new');
      window.firebase = window.firebase || {};
      window.firebase.appCheck = () => ({ getToken: () => { n++; return new Promise((r) => setTimeout(() => r({ token: fresh }), 100)); } });
      window.firebase.auth = () => ({ currentUser: { getIdToken: () => Promise.resolve(ID_TOKEN) } });
      _rawFetch = () => Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(null) });
      AC_READY = true;
      ID_TOKEN = window.mkJwt(3600, 'id');
      AC_TOKEN = window.mkJwt(-60, 'old');
      Promise.all([fetch(FB + '/a.json'), fetch(FB + '/b.json'), fetch(FB + '/c.json')]).then(() => resolve(n));
    }));
    expect(gets).toBe(1);
  });

  test('401 आए और App Check token ख़त्म हो चुका हो → दोबारा कोशिश से पहले App Check भी नया (पहले सिर्फ़ null होने पर होता था)', async ({ page }) => {
    await openApp(page);
    await page.evaluate(jwtSetup);
    const r = await page.evaluate(() => new Promise((resolve) => {
      const fresh = window.mkJwt(3600, 'new');
      let forced = 0, calls = 0, secondAc = null;
      window.firebase = window.firebase || {};
      window.firebase.appCheck = () => ({ getToken: (force) => { if (force) forced++; return Promise.resolve({ token: fresh }); } });
      window.firebase.auth = () => ({ currentUser: { getIdToken: () => Promise.resolve(ID_TOKEN) } });
      _rawFetch = (url, opts) => {
        calls++;
        if (calls === 1) return Promise.resolve({ status: 401, ok: false });
        secondAc = opts.headers['X-Firebase-AppCheck'];
        return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(null) });
      };
      ID_TOKEN = window.mkJwt(3600, 'id');
      AC_TOKEN = window.mkJwt(-60, 'old');
      _fbFetchWithAuth(FB + '/x.json', { method: 'GET' }).then(() => resolve({ forced: forced, secondNew: secondAc === fresh }));
    }));
    expect(r.forced).toBe(1);
    expect(r.secondNew).toBe(true);
  });

  test('JWT न हो और समय पता न हो (जैसे पुराने टेस्ट के नक़ली token) → पुराना न माना जाए', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      AC_TOKEN = 'नक़ली'; AC_TOKEN_AT = 0;
      ID_TOKEN = 'नक़ली'; ID_TOKEN_AT = 0;
      return { ac: _acStale(), id: _idStale() };
    });
    expect(r).toEqual({ ac: false, id: false });
  });
});

// ── v9.190: App Check token न बने तो वजह लॉग में ──
// असली production (9/10): App Check metrics में "outdated client" (login token था, App Check token
// नहीं) ~60% पर, फिर भी error log ख़ाली — नाकामी चुपचाप निगली जाती थी, और token-रहित फ़ोन LOGS में
// भी नहीं लिख पाता (Enforced)। इसलिए तुरंत लॉग की कोशिश + token लौटते ही पक्का लॉग
test.describe('App Check token नाकामी का लॉग (v9.190)', () => {
  const throttled = () => {
    const e = new Error('Requests throttled due to 403 error. Attempts allowed again after 01d:00m:00s');
    e.code = 'appCheck/throttled';
    return e;
  };

  test('token न बने → वजह (code + संदेश) के साथ appcheck-fail लॉग हो, और फ़ोन में नोट रहे', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate((errSrc) => new Promise((resolve) => {
      try { localStorage.removeItem('dc_logs3'); localStorage.removeItem('dc_acfail'); } catch (e) {}
      _acFailLogged = {};
      AC_TOKEN = null; AC_READY = true; AC_RETRY_MS = 100000;
      window.firebase = window.firebase || {};
      window.firebase.appCheck = () => ({ getToken: () => Promise.reject(new Function('return (' + errSrc + ')()')()) });
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
      _acRefresh();
      setTimeout(() => {
        const logs = getLogs().filter((l) => l.c === 'appcheck-fail');
        resolve({ logs: logs, note: JSON.parse(localStorage.getItem('dc_acfail') || 'null') });
      }, 100);
    }), throttled.toString());
    expect(r.logs.length).toBe(1);
    expect(r.logs[0].m).toContain('appCheck/throttled');
    expect(r.logs[0].m).toContain('01d:00m:00s');
    expect(r.logs[0].x).toContain('reCAPTCHA लोड:');
    expect(r.note.code).toBe('appCheck/throttled');
    expect(r.note.n).toBe(1);
  });

  test('वही वजह बार-बार → लॉग एक ही बार (हर 15 सेकंड की कोशिश से लॉग न भरे), पर गिनती बढ़ती रहे', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate((errSrc) => new Promise((resolve) => {
      try { localStorage.removeItem('dc_logs3'); localStorage.removeItem('dc_acfail'); } catch (e) {}
      _acFailLogged = {};
      const mk = new Function('return (' + errSrc + ')')();
      for (let i = 0; i < 5; i++) _acNoteFail(mk(), 'टेस्ट');
      resolve({ n: getLogs().filter((l) => l.c === 'appcheck-fail').length, count: JSON.parse(localStorage.getItem('dc_acfail')).n });
    }), throttled.toString());
    expect(r.n).toBe(1);
    expect(r.count).toBe(5);
  });

  test('token फिर बन जाए → "कितनी देर अटका, क्यों, कितनी कोशिशें" का पक्का लॉग, और नोट साफ़', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      try { localStorage.removeItem('dc_logs3'); } catch (e) {}
      localStorage.setItem('dc_acfail', JSON.stringify({ since: Date.now() - 125 * 60000, n: 300, code: 'appCheck/throttled', msg: 'Requests throttled due to 403 error', rc: 'हां', on: 'हां' }));
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
      _setAcToken('नया-token');
      return { logs: getLogs().filter((l) => l.c === 'appcheck-recovered'), note: localStorage.getItem('dc_acfail') };
    });
    expect(r.logs.length).toBe(1);
    expect(r.logs[0].m).toContain('2 घंटे 5 मिनट');
    expect(r.logs[0].m).toContain('appCheck/throttled');
    expect(r.logs[0].x).toContain('कोशिशें: 300');
    expect(r.note).toBeNull();
  });

  test('सामान्य हालत (पहले कोई नाकामी नहीं) → token बनने पर कोई लॉग नहीं', async ({ page }) => {
    await openApp(page);
    const n = await page.evaluate(() => {
      try { localStorage.removeItem('dc_logs3'); localStorage.removeItem('dc_acfail'); } catch (e) {}
      _setAcToken('token-1'); _setAcToken('token-2');
      return getLogs().filter((l) => /^appcheck-/.test(l.c)).length;
    });
    expect(n).toBe(0);
  });

  test('401/403 के बाद force-refresh भी नाकाम हो → वह भी लॉग हो (पहले बिल्कुल चुप था)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      try { localStorage.removeItem('dc_logs3'); localStorage.removeItem('dc_acfail'); } catch (e) {}
      _acFailLogged = {};
      window.firebase = window.firebase || {};
      window.firebase.appCheck = () => ({ getToken: () => { const e = new Error('reCAPTCHA error'); e.code = 'appCheck/recaptcha-error'; return Promise.reject(e); } });
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
      _acForceRefresh().then(() => resolve(getLogs().filter((l) => l.c === 'appcheck-fail').map((l) => l.m + ' | ' + l.x)));
    }));
    expect(r.length).toBe(1);
    expect(r[0]).toContain('appCheck/recaptcha-error');
    expect(r[0]).toContain('401/403 के बाद');
  });
});

// ── v9.192: App Check token न होने वाले 401 से वसूली "अटकी" न हो; token लौटते ही रुकी वसूली जाए ──
// असली production (8–9/10, पाटन/Neeku sarraty, v9.190 के appcheck-recovered लॉग से): reCAPTCHA ने
// 27 घंटे token नहीं दिया (Google की काली सूची के दौरान), 148 कोशिशें। तीन 401 पर entry "अटकी"
// (authFailCount 3) मानकर auto-retry रुक जाता, और token लौटने पर भी ऐप बंद-खोलने तक अटकी रहती
test.describe('App Check की कमी से वसूली अटके नहीं (v9.192)', () => {
  test('App Check token न हो तो 401 "अटकी" गिनती में न जुड़े (कितनी भी बार हो)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      const p = {}; const k = cKey('पाटन', 'कुल उपभोक्ता');
      p[k] = { hq: 'पाटन', cat: 'कुल उपभोक्ता', type: 'put', patch: { '7': { acc: '7', status: 'paid' } } };
      setPendingObj(p);
      AC_TOKEN = null;
      for (let i = 0; i < 6; i++) { const e = new Error('HTTP 401'); _bumpAuthFail(k, e); }
      return getPending()[k].authFailCount || 0;
    });
    expect(r).toBe(0);
  });

  test('token हो पर सर्वर App Check की वजह से मना करे ("Missing appcheck token") → भी "अटकी" न गिने', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      const p = {}; const k = cKey('पाटन', 'वैभव');
      p[k] = { hq: 'पाटन', cat: 'वैभव', type: 'put', patch: { '8': { acc: '8' } } };
      setPendingObj(p);
      AC_TOKEN = 'ac-ok';
      const e = new Error('HTTP 401'); e.body = '{ "error" : "Missing appcheck token" }';
      _bumpAuthFail(k, e);
      return getPending()[k].authFailCount || 0;
    });
    expect(r).toBe(0);
  });

  test('token लौटते ही "अटकी" मानी गई वसूली तुरंत भेजी जाए — ऐप बंद-खोलने का इंतज़ार नहीं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      const p = {}; const k = cKey('पाटन', 'कुल उपभोक्ता');
      p[k] = { hq: 'पाटन', cat: 'कुल उपभोक्ता', type: 'put', authFailCount: 3, patch: { '9': { acc: '9', status: 'paid' } } };
      setPendingObj(p);
      localStorage.setItem('dc_acfail', JSON.stringify({ since: Date.now() - 27 * 3600000, n: 148, code: 'appCheck/recaptcha-error', msg: 'ReCAPTCHA error', rc: 'हां', on: 'हां' }));
      let patched = 0;
      window.fetch = function (url, opts) {
        if (opts && opts.method === 'PATCH' && String(url).indexOf(fbPath('पाटन', 'कुल उपभोक्ता')) > -1) patched++;
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(null) });
      };
      _flushing = false;
      AC_TOKEN = null;
      _setAcToken('नया-token'); // reCAPTCHA फिर चला
      setTimeout(() => resolve({ patched: patched, left: Object.keys(getPending()).length }), 600);
    }));
    expect(r.patched).toBe(1);
    expect(r.left).toBe(0); // भेजी जा चुकी
  });
});

// v9.243 (JE 20/10: Firebase App Check "Verified" 97% → 94%): पर्ची नाकाम हो चुकी हो और अभी न हो तो Firebase को बेकार
// (unverified, मना होने वाली) requests न जाएं — पहले एक बार पर्ची मांगें, न मिले तो बिना नेट वही 401; "बाक़ी" रुका रहे,
// पर्ची बनते ही अपने-आप जाए
test.describe('App Check पर्ची नहीं — Firebase को बेकार requests नहीं (v9.243)', () => {
  test('पर्ची नाकाम: नेट पर request नहीं, 401 लौटे, "बाक़ी" न भेजा जाए; पर्ची बनते ही "बाक़ी" जाए', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
      const hits = [];
      const raw = _rawFetch;
      _rawFetch = function (u, o) { hits.push(String(u)); return Promise.resolve(new Response('{}', { status: 200 })); };
      let tokenOk = false, asks = 0;
      window.firebase = window.firebase || {};
      window.firebase.appCheck = () => ({ getToken: () => { asks++; return tokenOk ? Promise.resolve({ token: 'ac-new' }) : Promise.reject(Object.assign(new Error('x'), { code: 'appCheck/throttled' })); } });
      ID_TOKEN = 'id'; AC_READY = true; AC_TOKEN = null; _acGateAt = 0; _acGateJob = null;
      localStorage.setItem('dc_acfail', JSON.stringify({ since: Date.now(), n: 1 }));
      const hq = 'टेस्ट HQ43', cat = 'कुल उपभोक्ता';
      localStorage.setItem('dc_pending3', JSON.stringify({ [cKey(hq, cat)]: { hq, cat, type: 'put', since: Date.now(), patch: { 5: { acc: '5', status: 'paid', o: 0 } } } }));
      _flushing = false; _flushBackoffUntil = 0;
      fetch(FB + '/x.json').then((res) => {
        const out = { status: res.status, hits1: hits.length, asks1: asks };
        // 15 सेकंड के अंदर दोबारा — पर्ची फिर नहीं मांगी, नेट पर कुछ नहीं
        return fetch(FB + '/y.json').then((res2) => {
          out.status2 = res2.status; out.asks2 = asks; out.hits2 = hits.length;
          flushPending();
          out.flushed = _flushing || hits.length > 0;
          // पर्ची बनी — _acRefresh → _setAcToken → _acNoteOk → "बाक़ी" भेजा
          tokenOk = true; _acRefresh();
          const t0 = Date.now();
          (function wait() {
            if (hits.some((u) => u.indexOf(fbPath(hq, cat)) > -1) || Date.now() - t0 > 4000) {
              _rawFetch = raw;
              out.afterToken = hits.some((u) => u.indexOf(fbPath(hq, cat)) > -1);
              out.acfail = localStorage.getItem('dc_acfail');
              resolve(out);
            } else setTimeout(wait, 50);
          })();
        });
      });
    }));
    expect(r).toEqual({ status: 401, hits1: 0, asks1: 1, status2: 401, asks2: 1, hits2: 0, flushed: false, afterToken: true, acfail: null });
  });

  test('पर्ची कभी नाकाम नहीं हुई (dc_acfail नहीं) — पहले जैसा, कोई रोक नहीं', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => { localStorage.removeItem('dc_acfail'); AC_READY = true; AC_TOKEN = null; return _acBlocked(); });
    expect(r).toBe(false);
  });
});

// v9.248 (JE फ़ोन 24/10): login से पहले अनाम खाते पर "बाक़ी" भेजने में 3× Permission denied → "अटका"; JE login पर
// हटता नहीं था (सिर्फ़ लाइनमैन के अपने HQ पर)
test.describe('अनाम खाते पर "बाक़ी" न भेजें, JE login पर सब HQ की "अटका" हटे (v9.248)', () => {
  test('अनाम खाता: कोई भेजना नहीं; 401 पर गिनती नहीं; JE खाता बनते ही सब HQ की अटका हटे और भेजा जाए; HQ खाता = सिर्फ़ उसका HQ', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
      let user = { isAnonymous: true, email: null };
      window.firebase = { auth: () => ({ currentUser: user }) };
      AUTH_READY = true; AC_READY = true; AC_TOKEN = 'x'; localStorage.removeItem('dc_acfail');
      _flushing = false; _flushBackoffUntil = 0;
      let calls = 0;
      const orig = window.fetch;
      window.fetch = function (u, o) { if (String(u).indexOf(FB) === 0) { calls++; return Promise.resolve(new Response('{}', { status: 200 })); } return orig(u, o); };
      const k1 = cKey('बीबी', 'सुनील'), k2 = cKey('पाटन', 'वैभव');
      localStorage.setItem('dc_pending3', JSON.stringify({
        [k1]: { hq: 'बीबी', cat: 'सुनील', type: 'put', authFailCount: 3, patch: {} },
        [k2]: { hq: 'पाटन', cat: 'वैभव', type: 'put', authFailCount: 3, patch: {} },
      }));
      const out = {};
      flushPending(); out.anonCalls = calls; out.anonFlushing = _flushing;
      // अनाम पर 401 — गिनती न बढ़े
      const p = getPending(); p[k1].authFailCount = 1; setPendingObj(p);
      _bumpAuthFail(k1, Object.assign(new Error('HTTP 401'), { body: '{ "error" : "Permission denied" }' }));
      out.anonCount = getPending()[k1].authFailCount;
      const p2 = getPending(); p2[k1].authFailCount = 3; setPendingObj(p2);
      // पाटन का HQ खाता — सिर्फ़ पाटन की गिनती हटे
      user = { isAnonymous: false, email: HQ_AUTH_EMAIL['पाटन'] };
      window.fetch = () => new Promise(() => {}); // भेजना लटका रहे — सिर्फ़ गिनती देखनी है
      _authAcctReady(user);
      out.hq = { bibi: getPending()[k1].authFailCount, patan: getPending()[k2].authFailCount || 0 };
      _flushing = false;
      user = { isAnonymous: false, email: JE_EMAIL };
      _authAcctReady(user);
      out.je = { bibi: getPending()[k1].authFailCount || 0 };
      setTimeout(() => { out.flushStarted = _flushing; window.fetch = orig; resolve(out); }, 50);
    }));
    expect(r.anonCalls).toBe(0);
    expect(r.anonFlushing).toBe(false);
    expect(r.anonCount).toBe(1);
    expect(r.hq).toEqual({ bibi: 3, patan: 0 });
    expect(r.je).toEqual({ bibi: 0 });
    expect(r.flushStarted).toBe(true);
  });
});

// v9.260 (Suneel, बीबी, 27/10): डेढ़ घंटे हर ~20s "sync-patch-fail HTTP 401 … login token: नहीं था … Invalid appcheck token"।
// (1) login token न हो तो "बाक़ी" भेजना बेकार (rules HQ खाता मांगते हैं) — token आते ही भेजें
// (2) सर्वर "Invalid appcheck token" कहे तो पर्ची ज़बरदस्ती नई (मिनट में एक बार से ज़्यादा नहीं) और एक बार दोबारा
test.describe('login token / ख़राब App Check पर्ची (v9.260)', () => {
  const mkJwt = () => {
    window.mkJwt = (expInSec, tag) => {
      const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
      return b64({ alg: 'none' }) + '.' + b64({ exp: Math.floor(Date.now() / 1000) + expInSec, t: tag }) + '.sig';
    };
  };

  test('login token नहीं (Firebase login चालू) — "बाक़ी" भेजना शुरू न हो; token आते ही शुरू हो', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
      localStorage.removeItem('dc_acfail');
      AUTH_LISTENING = true; AUTH_READY = false; ID_TOKEN = null; AC_READY = true; AC_TOKEN = 'ac';
      const hq = 'टेस्ट HQ60', cat = 'कुल उपभोक्ता';
      localStorage.setItem('dc_pending3', JSON.stringify({ [cKey(hq, cat)]: { hq, cat, type: 'put', since: Date.now(), patch: { 5: { acc: '5', status: 'paid', o: 0 } } } }));
      _flushing = false; _flushBackoffUntil = 0;
      const w0 = _tokenWaiters.length;
      flushPending();
      const before = _flushing;
      flushPending(); // दोबारा बुलाने पर भी एक ही इंतज़ार
      const waiters = _tokenWaiters.length - w0;
      ID_TOKEN = 'id'; _tokenWaiters.splice(0).forEach((f) => f());
      return { before, waiters, after: _flushing };
    });
    expect(r).toEqual({ before: false, waiters: 1, after: true });
  });

  test('login token के बिना भेजी request पर "Invalid appcheck token" — नई पर्ची लेकर एक बार दोबारा; मिनट में दोबारा नहीं मांगे', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
      localStorage.removeItem('dc_acfail');
      let asks = 0; const sent = [];
      window.firebase = window.firebase || {};
      window.firebase.appCheck = () => ({ getToken: () => { asks++; return Promise.resolve({ token: 'ac-new' }); } });
      let serverOk = true;
      _rawFetch = (u, o) => {
        const ac = o && o.headers && o.headers['X-Firebase-AppCheck'];
        if (String(u).indexOf('/z') < 0) return Promise.resolve(new Response('{}', { status: 200 })); // ऐप की बाक़ी पृष्ठभूमि requests
        sent.push(ac);
        const ok = serverOk && ac === 'ac-new';
        return Promise.resolve(new Response(ok ? '{}' : '{ "error" : "Invalid appcheck token" }', { status: ok ? 200 : 401 }));
      };
      ID_TOKEN = null; AC_READY = true; AC_TOKEN = 'ac-old';
      fetch(FB + '/z.json').then((res) => {
        const out = { status: res.status, asks: asks, sent: sent.slice() };
        serverOk = false; // सर्वर फिर भी मना करे — इस बार पर्ची दोबारा नहीं मांगनी
        return fetch(FB + '/z2.json').then((res2) => { out.status2 = res2.status; out.asks2 = asks; resolve(out); });
      });
    }));
    expect(r).toEqual({ status: 200, asks: 1, sent: ['ac-old', 'ac-new'], status2: 401, asks2: 1 });
  });

  test('login token के साथ भी: पर्ची client की घड़ी से "ताज़ा" पर सर्वर "Invalid" कहे — नई पर्ची लेकर दोबारा', async ({ page }) => {
    await openApp(page);
    await page.evaluate(mkJwt);
    const r = await page.evaluate(() => new Promise((resolve) => {
      Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
      localStorage.removeItem('dc_acfail');
      let asks = 0; const sent = [];
      const fresh = window.mkJwt(3600, 'new');
      window.firebase = window.firebase || {};
      window.firebase.appCheck = () => ({ getToken: () => { asks++; return Promise.resolve({ token: fresh }); } });
      window.firebase.auth = () => ({ currentUser: { getIdToken: () => Promise.resolve(ID_TOKEN) } });
      _rawFetch = (u, o) => {
        const ac = o.headers['X-Firebase-AppCheck'];
        if (String(u).indexOf('/w.json') < 0) return Promise.resolve(new Response('{}', { status: 200 }));
        sent.push(ac === fresh ? 'new' : 'old');
        return Promise.resolve(new Response(ac === fresh ? '{}' : '{ "error" : "Invalid appcheck token" }', { status: ac === fresh ? 200 : 401 }));
      };
      AC_READY = true; ID_TOKEN = window.mkJwt(3600, 'id'); AC_TOKEN = window.mkJwt(3600, 'old'); // client को ताज़ा दिखती
      fetch(FB + '/w.json').then((res) => resolve({ status: res.status, asks, sent }));
    }));
    expect(r).toEqual({ status: 200, asks: 1, sent: ['old', 'new'] });
  });
});

// v9.264 (JE 30/10): "कोई भी लाइनमैन किसी भी HQ में login कर सकता है — इसे सामान्य बनाना है"।
// Rajkumar (आदेगांव) का फ़ोन पाटन वाले खाते पर था; दोबारा जुड़ते वक़्त नेट टूटा (auth/network-request-failed) —
// फ़ोन ख़ुद को online मानता रहा, "online" event कभी नहीं आया, 10 मिनट बाद भी ग़लत खाता (Permission denied)
test.describe('HQ बदलना सामान्य (v9.264)', () => {
  test('दोबारा जुड़ते वक़्त नेट टूटे — logout नहीं, और थोड़ी देर बाद अपने-आप फिर कोशिश', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
      CU = { role: 'lineman', name: 'टेस्ट', hq: 'आदेगांव', pin: '1234' };
      saveSession();
      if (_authRetryT) { clearTimeout(_authRetryT); _authRetryT = null; }
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return { currentUser: { email: 'hq-patan@x' }, signInWithEmailAndPassword: function () { return Promise.reject({ code: 'auth/network-request-failed' }); } };
      };
      _ensureCorrectHqAuth(function () { setTimeout(() => resolve({ hq: CU && CU.hq, retry: !!_authRetryT }), 50); });
    }));
    expect(r).toEqual({ hq: 'आदेगांव', retry: true });
  });

  test('लाइनमैन के login वाले HQ के ही "फ़ोन में रुके बदलाव" भेजे जाएं — दूसरे HQ वाले चुपचाप रुके रहें (401/अटकी गिनती नहीं)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
      localStorage.removeItem('dc_acfail');
      AUTH_LISTENING = false; ID_TOKEN = 'id'; AC_READY = true; AC_TOKEN = 'ac';
      CU = { role: 'lineman', name: 'टेस्ट', hq: 'आदेगांव', pin: '1' };
      const p = {};
      p[cKey('आदेगांव', 'कुल उपभोक्ता')] = { hq: 'आदेगांव', cat: 'कुल उपभोक्ता', type: 'put', since: Date.now(), patch: { 5: { acc: '5', status: 'paid', o: 0 } } };
      p[cKey('पाटन', 'कुल उपभोक्ता')] = { hq: 'पाटन', cat: 'कुल उपभोक्ता', type: 'put', since: Date.now(), patch: { 7: { acc: '7', status: 'paid', o: 0 } } };
      localStorage.setItem('dc_pending3', JSON.stringify(p));
      const urls = [];
      _rawFetch = (u) => { urls.push(decodeURIComponent(String(u))); return Promise.resolve(new Response('null', { status: 200 })); };
      _flushing = false; _flushBackoffUntil = 0;
      flushPending();
      setTimeout(() => {
        const pp = getPending();
        resolve({ adegaon: urls.some((u) => u.indexOf('आदेगांव') > -1), patan: urls.some((u) => u.indexOf('पाटन') > -1), patanLeft: !!pp[cKey('पाटन', 'कुल उपभोक्ता')], patanFails: (pp[cKey('पाटन', 'कुल उपभोक्ता')] || {}).authFailCount || 0 });
      }, 1500);
    }));
    expect(r).toEqual({ adegaon: true, patan: false, patanLeft: true, patanFails: 0 });
  });

  test('दूसरे HQ के "फ़ोन में रुके बदलाव" का संदेश; अपने HQ या कुछ न हो तो कुछ नहीं', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      CU = { role: 'lineman', name: 'टेस्ट', hq: 'आदेगांव' };
      const p = {};
      p[cKey('पाटन', 'कुल उपभोक्ता')] = { hq: 'पाटन', cat: 'कुल उपभोक्ता', type: 'put', patch: { 1: {}, 2: {} } };
      p[cKey('पाटन', 'अमित')] = { hq: 'पाटन', cat: 'अमित', type: 'put', patch: { 3: {} } };
      p[cKey('आदेगांव', 'कुल उपभोक्ता')] = { hq: 'आदेगांव', cat: 'कुल उपभोक्ता', type: 'put', patch: { 4: {} } };
      localStorage.setItem('dc_pending3', JSON.stringify(p));
      const other = _otherHqHeldMsg();
      localStorage.setItem('dc_pending3', JSON.stringify({ [cKey('आदेगांव', 'x')]: p[cKey('आदेगांव', 'कुल उपभोक्ता')] }));
      const none = _otherHqHeldMsg();
      return { other, none, label: (setSyncStatus(false), document.getElementById('sdot').getAttribute('title')) };
    });
    expect(r.other).toContain('पाटन');
    expect(r.other).toContain('फ़ोन में रुके');
    expect(r.none).toBe('');
    expect(r.label).toContain('1 बदलाव फ़ोन में रुके');
  });

  test('लॉगआउट (HQ बदलने) के पुष्टि-डिब्बे में अपने HQ के "फ़ोन में रुके बदलाव" की चेतावनी', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      CU = { role: 'lineman', name: 'टेस्ट', hq: 'आदेगांव' };
      localStorage.setItem('dc_pending3', JSON.stringify({ [cKey('आदेगांव', 'कुल उपभोक्ता')]: { hq: 'आदेगांव', cat: 'कुल उपभोक्ता', type: 'put', patch: { 1: {}, 2: {}, 3: {} } } }));
      let seen = null;
      const orig = appAsk;
      appAsk = function (o, cb) { seen = o; cb(false); };
      doLogout(true);
      appAsk = orig;
      return { text: [seen && seen.title, seen && seen.msg, seen && seen.warn].join(' '), still: !!CU };
    });
    expect(r.text).toContain('3 बदलाव फ़ोन में रुके');
    expect(r.still).toBe(true); // "नहीं" दबाया — लॉगआउट नहीं हुआ
  });
});

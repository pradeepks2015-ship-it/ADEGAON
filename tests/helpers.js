// @ts-check
// वसूली ट्रैकर — सारी टेस्ट फ़ाइलों के साझा helpers (10/10 तक यह सब एक ही 9878 लाइन की
// tests/smoke.spec.js में था; अब हर विषय की अपनी *.spec.js है, देखें CLAUDE.md)
// हर बाहरी request (CDN/Firebase/Google) block की जाती है ताकि:
//  1. tests कभी असली production database को न छुएं
//  2. app का offline-first रास्ता भी हर PR पर अपने आप जांचा जाए
const { test: baseTest, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// v9.195: कुछ फ़ाइलें अब ज़रूरत पड़ने पर ही उतरती हैं (js/lazy.js)। पुराने सैकड़ों टेस्ट इनके functions
// (processRows, _migAnalyzeList, _usageRender…) सीधे बुलाते हैं — उनके लिए index.html के आख़िर में
// ये फ़ाइलें पहले जैसी (साथ-साथ) जोड़ देते हैं, ताकि वे वही जांचें जो पहले जांचते थे। ज़रूरत-पर-उतरने
// वाला असली रास्ता अलग से lazyTest (बिना इस जोड़ के) वाले टेस्ट जांचते हैं — देखें "lazy फ़ाइलें"
const LAZY_FILES = ['js/upload.js', 'js/cat-admin.js', 'js/migration-tool.js', 'js/usage-view.js'];
const lazyTest = baseTest;
const test = baseTest.extend({
  context: async ({ context }, use) => {
    await context.route((u) => /^\/(index\.html)?$/.test(u.pathname), async (route) => {
      const r = await route.fetch();
      const body = (await r.text()).replace('</body>', LAZY_FILES.map((f) => `<script src="${f}"></script>`).join('') + '</body>');
      await route.fulfill({ response: r, body });
    });
    await use(context);
  },
});

/** @param {import('@playwright/test').Page} page */
async function blockExternal(page) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
  // Service Worker कभी-कभी किसी पहले चले test से बचे हुए worker-profile cache से Firebase CDN
  // scripts सीधे serve कर देता है — यह कभी network तक जाता ही नहीं, इसलिए ऊपर वाला route() इसे
  // रोक नहीं पाता। page.addInitScript(() => window.firebase = undefined) से रोकने की कोशिश भी
  // नाकाम रही (diagnostics से पक्का हुआ, देखें reloadAndWaitForApp का git history) — वह पहले चल
  // तो जाता है, पर उसके बाद असली <script src="firebase-*.js"> tag (जो SW ने cache से परोसा) फिर
  // से execute होकर window.firebase को वापस असली बना देता है। असली, पक्का fix अब playwright.config.js
  // में है: serviceWorkers:'block' — कोई भी test असली browser-registered SW पर निर्भर नहीं (sw.js
  // की जांच सिर्फ़ static/mocked-scope से होती है), इसलिए SW को सिरे से रजिस्टर ही न होने देना
  // सबसे पक्का रास्ता है, हर navigation पर window.firebase को दोबारा साफ़ करने की ज़रूरत ही नहीं
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
  // असली जड़ diagnostics से मिली: Service Worker कभी-कभी किसी पहले चले test से बचे हुए
  // worker-profile cache से Firebase CDN scripts सीधे Cache Storage से serve कर देता है — यह
  // कभी network तक जाता ही नहीं, इसलिए blockExternal का page.route() इसे रोक ही नहीं पाता।
  // नतीजा: firebase असल में defined मिल जाता, doLogin() खाली PIN के साथ भी असली Firebase
  // sign-in आज़माता, और "auth/network-request-failed" के अलावा कोई और error code मिलते ही
  // CU कभी सेट नहीं होता — login-screen हमेशा के लिए अटक जाती (CI पर बार-बार यही TimeoutError,
  // firebaseType:"object" + CU:"null" ने पक्का किया)। यहां तय offline-fallback रास्ता ही चले,
  // इसके लिए हर बार साफ़ कर देते हैं — यही व्यवहार बाकी सैकड़ों loginLineman() calls में पहले से
  // (संयोग से undefined रहने की वजह से) भरोसेमंद रहा है
  await page.evaluate(() => { window.firebase = undefined; });
  await page.click('#rc-lin');
  await page.fill('#uname-inp', name);
  await page.selectOption('#hq-sel', { index: 1 });
  await page.click('.login-btn');
  try {
    await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'), null, { timeout: 15000 });
  } catch (e) {
    // असली bug न मिलने पर स्थानीय रूप से दोहराया नहीं जा सका (सिर्फ़ CI पर) — पिछली कोशिश में
    // यहां console.log() से diagnostics भेजी थी, पर CI का "github" reporter उसे job log में
    // दिखाता ही नहीं (local "list" reporter दिखाता है, इसलिए local जांच में यह गलती पकड़ में
    // नहीं आई)। अब सीधे thrown error के message में जोड़ रहे हैं — वह हर reporter हमेशा दिखाता है
    const diag = await page.evaluate(() => ({
      selectedRole: typeof selectedRole !== 'undefined' ? selectedRole : 'undef',
      hqSelVal: document.getElementById('hq-sel') && document.getElementById('hq-sel').value,
      unameVal: document.getElementById('uname-inp') && document.getElementById('uname-inp').value,
      loginActive: document.getElementById('login-screen').classList.contains('active'),
      appActive: document.getElementById('app-screen').classList.contains('active'),
      firebaseType: typeof firebase,
      navOnline: navigator.onLine,
      CU: typeof CU !== 'undefined' ? JSON.stringify(CU) : 'undef',
      appStarted: typeof _appStarted !== 'undefined' ? _appStarted : 'undef',
    })).catch((err) => ({ evalError: String(err) }));
    e.message = '[loginLineman DIAG] ' + JSON.stringify(diag) + '\n\n' + e.message;
    throw e;
  }
}

// addInitScript वाला fix (blockExternal) दूसरी बार भी असफल रहा — दोनों reload-आधारित tests
// अब भी CI पर वैसे ही TimeoutError पर अटके। असली वजह अब भी पता नहीं, इसलिए तीसरी बार अंदाज़ा
// लगाने की बजाय (जो पिछली बार ग़लत निकला) यहां वही सिद्ध तरीक़ा दोहरा रहे हैं जिससे loginLineman
// का असली bug पकड़ में आया था: timeout पर page-side state को thrown error के .message में जोड़ दें
/** @param {import('@playwright/test').Page} page */
async function reloadAndWaitForApp(page) {
  await page.reload();
  try {
    await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'), null, { timeout: 15000 });
  } catch (e) {
    const diag = await page.evaluate(() => ({
      firebaseType: typeof firebase,
      CU: typeof CU !== 'undefined' ? JSON.stringify(CU) : 'undef',
      loginActive: document.getElementById('login-screen').classList.contains('active'),
      appActive: document.getElementById('app-screen').classList.contains('active'),
      dcCu: localStorage.getItem('dc_cu'),
      appStarted: typeof _appStarted !== 'undefined' ? _appStarted : 'undef',
      toastText: (function () { var t = document.getElementById('toast'); return t ? t.textContent : 'no-toast-el'; })(),
      toastShown: (function () { var t = document.getElementById('toast'); return t ? t.classList.contains('show') : 'no-toast-el'; })(),
      navOnline: navigator.onLine,
    })).catch((err) => ({ evalError: String(err) }));
    e.message = '[reload DIAG] ' + JSON.stringify(diag) + '\n\n' + e.message;
    throw e;
  }
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

module.exports = { test, lazyTest, expect, fs, path, LAZY_FILES, blockExternal, openApp, loginLineman, reloadAndWaitForApp, loginJE };

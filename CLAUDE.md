# वसूली ट्रैकर (Recovery Tracker)

आदेगांव Distribution Centre / लखनादौन डिवीजन सिवनी सर्कल (मध्य प्रदेश बिजली विभाग) के लिए एक ऑफ़लाइन-फर्स्ट PWA — vanilla JavaScript, कोई framework नहीं।

## 🔝 सबसे ऊपर की प्राथमिकता (JE, 15/10/2026)
**ऐप मुफ़्त रहे, बिना नेट के भी चले, और तेज़ रहे** — हर बदलाव इसी कसौटी पर:
- **मुफ़्त:** Firebase की पढ़ाई/लिखाई न बढ़े (बिल ₹0 के आसपास), कोई paid सेवा नहीं; GitHub Actions public repo में मुफ़्त
- **बिना नेट:** हर ज़रूरी काम (सूची, वसूल, रिमार्क, PDF) बिना नेट; नेट आने पर अपने-आप भेजना
- **तेज़:** खुलना फ़ोन की copy से, सस्ते फ़ोन/धीमे नेट पर भी (field-conditions टेस्ट)
इनमें से किसी पर असर डालने वाला बदलाव हो तो पहले JE को साफ़ बताएं

## Tech Stack
- Vanilla JavaScript (कोई build step नहीं)
- Firebase Realtime Database + Firebase Auth + Firebase App Check
- **असली चालू ऐप GitHub Pages पर है:** `https://pradeepks2015-ship-it.github.io/ADEGAON/` — `main` पर हर
  merge से "pages build and deployment" workflow अपने-आप चढ़ाता है। **लाइनमैन यहीं काम करते हैं — इसे कभी
  बंद/Unpublish न करें** (वरना सबके फ़ोन पर ऐप बंद)
- Netlify (साइट: adegaondc) **22/9/2026 से रुका है** — मुफ़्त plan के क्रेडिट ख़त्म, हर production deploy
  "Skipped"; वहां v9.153 पड़ा है। इसे "लाइव" न मानें, इसका पता किसी को न दें (JE का फ़ैसला 9/10: GitHub
  Pages ही रखें)। PR की "deploy-preview" हरी होना यह नहीं बताता कि production चढ़ा
- Playwright से टेस्ट

## Repo/Branch
- GitHub: `pradeepks2015-ship-it/ADEGAON`
- `main` branch से GitHub Pages अपने-आप deploy होता है (Netlify ऊपर देखें — रुका है)
- सारा development branch `claude/recovery-tractor-cloud-file-cx3d5z` पर होता है, फिर PR बनाकर `main` में merge होता है

## मुख्य फाइलें
- `js/config.js` — HQS, CATS, APP_VER, HQ_AUTH_EMAIL, JE_EMAIL, CAT_NAMES
- `js/firebase.js` — Firebase config, auth token handling
- `js/ui-core.js` — login/logout/UI core, doLogout, goBack
- `js/list.js` — कंज्यूमर लिस्ट render + filter + status (renderListWith, markPaid, propagateStatus)
- `js/database.js` — पढ़ना और बुनियाद: fbPath, ETag, normList, डेटा-बचाओ मोड, fbGet
- `js/database-write.js` — लिखना: fbSet, `_fbPut`/PATCH, सर्वर के रिमार्क मिलाना, fbDel
- `js/database-live.js` — लाइव-sync: startListen, SSE/`FetchLiveSource`, token-expiry जांच
  (v9.199 तक ये तीनों एक ही database.js में थे — **लोड-क्रम यही रहना चाहिए**: database → database-write → database-live)
- `js/village.js` — गांव-वार वसूली + VILLAGE_ALIASES (आदेगांव-विशिष्ट गांव-नाम स्पेलिंग सुधार)
- `js/home-scorecard.js` — होम पेज डिस्प्ले बोर्ड + कैश लिस्ट (bulk cash-payment upload)
- `js/reports.js` — फोन एक्शन मॉडल (SMS/WhatsApp templates), स्कोरकार्ड, PDF/Excel, service-worker registration
- `js/migration.js` — पुराने array-format से नए per-record object-format में माइग्रेशन
- `js/lazy.js` — **कुछ फ़ाइलें ज़रूरत पड़ने पर ही उतरती हैं** (v9.195): `upload.js`, `cat-admin.js`, `migration-tool.js` (चरण 3 की JE-स्क्रीन), `usage-view.js` (डेटा-उपयोग की JE-स्क्रीन)। ये `index.html`/`sw.js` CORE में **नहीं** हैं। इनका कोई function बाहर (index.html onclick या दूसरी js) से बुलाएं तो उसे `LAZY_ENTRY` में जोड़ें — टेस्ट "lazy फ़ाइलें" भूलने पर फेल होगा। इन फ़ाइलों में ऊपर-स्तर पर सिर्फ़ function/var declarations रहें। **लाइनमैन जो बटन बिना नेट दबा सकता है (जैसे PDF), उसका कोड lazy फ़ाइल में न रखें**
- `js/storage.js` — local cache (cGet/cSet/cKey), offline queue (getPending, flushPending, pendingCount), mergeArrays
- `js/auth.js` — login/logout, Lineman PIN, `_ensureCorrectHqAuth` (हर HQ का अपना Firebase account)
- `js/upload.js` — लेजर अपलोड (Replace/Merge), "पुरानी वसूली सुरक्षित रखें" + तारीख़-कट-ऑफ़, रिमार्क बचाना
- `js/share.js` — उपभोक्ता card को WhatsApp पर फ़ोटो बनाकर शेयर (SVG foreignObject से असली card की तस्वीर)
- `js/scorecards.js` — स्कोरकार्ड + तारीख़-वार तालिका, `normPayDate`/`payDateVal` (तारीख़ के सारे रूप यहीं संभलते हैं)
- `js/logger.js` — `logErr()` — असली production bugs इसी लॉग से पकड़े जाते हैं (JE मेनू → error log)
- `js/main.js`, `js/profile.js`, `js/cat-admin.js`, `js/celebration.js`
- `js/usage.js` — Firebase डेटा-उपयोग का अनुमानित ट्रेंड (Blaze plan पर बिना बताए बिल न बढ़े); JE-only viewer `js/usage-view.js` में
- `index.html`, `css/style.css`
- `sw.js` — service worker + CACHE_NAME
- `tests/*.spec.js` — पूरा टेस्ट suite, विषय-वार 12 फ़ाइलें (boot-ui, data-recovery, migration, auth-pin, upload-ledger, network-bandwidth…); साझा helpers (`openApp`, `loginLineman`, `loginJE`, lazy-फ़ाइल fixture) `tests/helpers.js` में। नया टेस्ट उसी विषय वाली फ़ाइल में जोड़ें
  - `tests/field-conditions.spec.js` — असली मैदान जैसी हालत: असली आकार का डेटा (6 HQ × 8 श्रेणी, ~9M अक्षर), सस्ता फ़ोन
    (CPU 4× धीमा), ऐप दो टैब में एक साथ, पुराने version वाले फ़ोन की हालत पर नया version। डेटा/भंडारण/खुलने से जुड़ा
    बदलाव करें तो ये ज़रूर देखें
  - `tests/e2e-firebase.spec.js` — पूरा ऐप Firebase emulator पर (असली login + database + rules)। सामान्य suite में skip;
    चलाना `npm run test:e2e` (Java + firebase-tools; यहां sandbox में proxy env हटाकर: `env -u HTTPS_PROXY -u HTTP_PROXY …`),
    CI में "e2e-firebase" job। Firebase library `scripts/fetch-firebase-sdk.js` `index.html` वाले version की npm से `.e2e-sdk/` में उतारता है (package devDependency नहीं — उसके node हिस्सों पर npm audit high देता है)
- `database.rules.json` — Firebase Realtime Database की Security Rules (source of truth — `main` पर push होते ही `.github/workflows/deploy-rules.yml` अपने-आप असली Firebase पर deploy कर देता है, देखें `scripts/deploy-rules.js`)
- `eslint.config.js` / `eslint.shared-globals.json` — CI लिंट सेटअप; कोई नई top-level global var/function (जो दूसरी js/*.js फाइल में इस्तेमाल हो) जोड़ें तो `node scripts/gen-eslint-globals.js` चलाकर globals list दोबारा बनाएं। दो फ़ाइलों में ग़लती से एक ही नाम declare न हो जाए (global scope share होने से चुपचाप overwrite का ख़तरा) — यह `npm run check-globals` (CI में भी) से अपने-आप जांचा जाता है, देखें `scripts/check-duplicate-globals.js`

## टोकन बचत (JE, 15/10/2026)
- यह फ़ाइल और `STATUS.md` (छोटी, ~10 KB) ही हर बार पढ़ें। पुराना पूरा इतिहास `docs/STATUS-history.md` (~150 KB) —
  **पूरा कभी न पढ़ें**, ज़रूरत हो तो `grep -n` से एक हिस्सा। बड़ी फ़ाइलें (`index.html`, `js/list.js`, टेस्ट) भी पूरी न पढ़ें — `grep`/offset
- पूरा suite (~20 मिनट) background में चलाएं, आउटपुट से सिर्फ़ `passed/failed` लाइनें लें
- JE "." भेजें तो मतलब "आगे बढ़ो/क्या हाल" — छोटा जवाब दें

## ज़रूरी तकनीकी तथ्य (v9.229 तक — कोड बदलें तो इन्हें ध्यान में रखें)
- **सूचियों का cache IndexedDB में** (`dc_lists`, v9.220): `cacheInit` खुलते ही सब memory (`CACHE`) में; `cGet` sync,
  `cSet` = memory + IndexedDB + दूसरे टैब को `BroadcastChannel("dc_lists")`। localStorage सिर्फ़ छोटी चीज़ें (queue, लॉग, ETag)
- **ETag** (`dc_etag3`) तभी भरोसेमंद जब उसी सूची का cache सचमुच save हुआ — save नाकाम हो तो `_etagDrop` (v9.222 की घटना)
- **फ़ोन से हटी सूची = "लानी बाक़ी"** (`dc_listneed1`, `listsNeedFetch`); **हर Replace अपलोड से पहले** उस HQ की सूचियां
  सर्वर से ताज़ा (`confirmUpload` → `_cashRefreshAll`), बिना नेट अपलोड रुके। वजह: थोक लिखाई सर्वर के रिमार्क नहीं मिलाती
  (`REMARK_MERGE_MAX`), अपलोड फ़ोन की copy से रिमार्क/वसूली उठाता है (14/10 को रिमार्क गए थे)
- **लेजर कट-ऑफ़ सर्वर पर** (`/LEDGER_CUT/<HQ>` yyyymmdd, सिर्फ़ JE लिखे): `reconcileHQ` उससे पुरानी वसूली नहीं फैलाता,
  `overlayOps` सर्वर से आई पुरानी "वसूल" को बाकी करके लौटाता है (लॉग `cut-clean`)
- Replace अपलोड बाक़ी सूचियों में उसी Consumer No की `amount`/`lastPayDate`/`lastPaidAmt` भी नई करता है (`_upSyncAmounts`)
- टेस्ट: पुराने sync अपलोड-टेस्ट के लिए `tests/helpers.js` `window.__TEST_UPLOAD_NO_REFRESH` लगाता है (असली ऐप में नहीं);
  असली रास्ता `tests/field-conditions.spec.js` "मासिक अपलोड" जांचता है। समय-निर्भर टेस्ट में `page.clock` (रात 12 के बाद फेल होते थे)
- GitHub Pages पर JE के **सारे repo एक ही origin** (`pradeepks2015-ship-it.github.io`) — localStorage/IndexedDB की जगह उनमें बंटती है
- **CSP + SRI (v9.230):** `index.html` के ऊपर `Content-Security-Policy` meta — कोई नया बाहरी पता (script/fetch/iframe)
  जोड़ें तो उसकी सूची में भी, वरना browser चुपचाप रोकेगा (लॉग `csp-block`)। Firebase version बदलें तो तीनों `integrity`
  hash भी (`scripts/check-sri.js` में तरीक़ा) — ग़लत hash = पूरे ऐप में Firebase बंद; CI lint job असली gstatic से मिलाता है
- **अपने-आप alert (15/10):** `.github/workflows/alert.yml` हर 4 घंटे (6–22 IST) `scripts/check-alerts.js` चलाता है —
  सर्वर-लॉग में गंभीर गड़बड़ी पर "🚨 ऐप alert" GitHub issue (JE को Gmail/GitHub ऐप)। **नया `logErr("नाम")` जोड़ें तो उसे
  वहां CRITICAL/MULTI/IGNORE में से एक में डालें** (`npm run test:alerts` फेल होगा)। issue public — उसमें नाम/संदेश नहीं
- **"पहले JE, फिर सब" (canary, v9.231):** नया `sw.js` JE-login वाले फ़ोन (Cache `dc-role`/`je-device`) पर तुरंत, बाक़ी फ़ोनों
  पर `rollout.json` के `waitMin` (10) मिनट बाद। JE "रोको" कहें तो `rollout.json` में `"hold": true` + बदलाव वापस; "सबको भेजो"
  पर `"hold": false`/`waitMin: 0`। सिर्फ़ ऐप-कोड पर — rules/workflows merge पर सब पर तुरंत। `sw.js` activate `dc-role` नहीं मिटाता
- **रिमार्क (v9.234):** हर सूची में उपभोक्ता की अलग copy — दिखाते वक़्त `remarksAll(x,hq)` (list.js) उसी HQ की सब
  सूचियों से उसी Consumer No के रिमार्क मिलाता है (सिर्फ़ फ़ोन की copy, कोई Firebase पढ़ाई नहीं); नया रिमार्क-दिखाने वाला कोड
  `x.remarksArr` नहीं, यही इस्तेमाल करे। भेजते वक़्त `_mergeServerRemarks` सर्वर-रिमार्क मिलाता है; पढ़ाई नाकाम हो तो रिमार्क
  छोड़कर बाक़ी fields ("acc/field" path) जाते हैं और पूरा record "बाक़ी" में रुकता है (`hold`); offline-queue भेजते वक़्त
  `REMARK_FLUSH_MAX` (500) तक 10-10 करके मिलान
- **पुष्टि-डिब्बा (v9.236):** ब्राउज़र का `confirm()`/`prompt()` नहीं — ऐप का `appAsk(o,cb)` (ui-core.js; सारा पाठ textContent,
  ख़तरनाक पर `kind:"danger"`, "रुको" ऊपर)। सिर्फ़ "वसूली वापस बाकी" (`markUnpaid`) जान-बूझकर ब्राउज़र वाला (JE 16/10)।
  टेस्ट: `tests/helpers.js` `window.__askAuto` लगाता है जो पुराने window.confirm/prompt stub से जवाब देता है; असली डिब्बा
  "ऐप का अपना पुष्टि-डिब्बा" टेस्ट (boot-ui) `__askAuto` हटाकर जांचते हैं
- **बैकअप से रिमार्क वापसी (15/10):** Actions → "Restore Remarks From Backup" (सिर्फ़ हाथ से; `scripts/restore-remarks.js`)।
  पहले "गिनती", JE की Ok पर "लिखो"। सिर्फ़ जोड़ता है (text-मिलान, `restored: "backup-<दिन>"` निशान), लॉग में कोई नाम नहीं
- इस sandbox से github.io तक पहुंच नहीं (proxy 403) — "लाइव" सिर्फ़ deployments API के `success` से पक्का करें

## काम शुरू करने से पहले
1. **`STATUS.md` पढ़ें** — अभी की स्थिति, हाल के फ़ैसले, खुले काम, और वे सुझाव जो जांच के बाद रद्द हो चुके हैं (ताकि दोबारा न उठें)। काम पूरा होने पर उसे अपडेट करते चलें।
2. `git log --oneline -20` और हाल के merged PRs देख लें — पूरा इतिहास (फ़ैसले, bug root-causes, fixes) commit messages और PR descriptions में दर्ज है।

## हर बदलाव के लिए तय प्रक्रिया (सख़्ती से पालन करें)
0. **TDD + unit/integration टेस्ट + security (JE 25/10):** हर bug-fix/feature में **पहले टेस्ट** लिखें और उसे फेल
   होते देखें (bug हो तो वही गड़बड़ी दोहराता टेस्ट), फिर कोड, फिर हरा। नए function का unit टेस्ट (Playwright `page.evaluate`
   या `node --test`), data/login/rules से जुड़े बदलाव पर integration टेस्ट (`tests/e2e-firebase.spec.js` emulator, rules के लिए
   `tests/rules/rules-check.js`)। हर बदलाव पर security नज़र से जांचें: Security Rules (कौन पढ़/लिख सकता है, अनाम खाता, बिल बढ़ाने
   वाला दुरुपयोग), XSS (`escHtml`/textContent), App Check, लॉग/issue में निजी जानकारी, नए बाहरी पते (CSP)
1. कोई भी asset/behavior बदलाव करने पर `js/config.js` का `APP_VER`, `sw.js` का `CACHE_NAME` और `rollout.json` का `ver` तीनों एक-साथ बढ़ाएं (जैसे 9.65→9.66, v82→v83)। `ver` से ही पुराने version पर अटके फ़ोन को "नया version उतर रहा है" बैनर दिखता है (v9.246, `_verCheck`) — टेस्ट मिलान जांचता है
2. बदलाव के बाद पूरा Playwright suite पास होना ज़रूरी है:
   ```
   PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test
   ```
   (local dev server: `python3 -m http.server 8080 --directory <repo-path>`)
   साथ ही CI वाली चारों जांचें भी साफ़ होनी चाहिए — यही चारों `.github/workflows/tests.yml` में भी चलती हैं:
   ```
   npm run lint           # 0 errors
   npm run check-xss      # onclick में escHtml() का सही इस्तेमाल
   npm run check-globals  # एक ही global नाम दो फ़ाइलों में declare न हो
   npm run typecheck      # type-जांच (tsc) — 0 errors; DOM/बाहरी library की जानकारी types/globals.d.ts में
   npm run test:restore   # बैकअप से रिमार्क वापसी: सिर्फ़ जोड़े, आज का न मिटे
   npm run test:alerts    # alert script: क्या alert बने/न बने, हर logErr नाम वर्गीकृत
   npm run check-sri      # Firebase की 3 बाहरी script पर integrity hash (CI में `-- --online` असली gstatic से मिलाता है)
   ```
   CI में इनके अलावा `rules` (`npm run test:rules`), `backup-lock` (`npm run test:backup`) और `e2e-firebase`
   (`npm run test:e2e`) jobs भी चलते हैं — sandbox में Java/emulator हो तो इन्हें भी चला लें
   नया top-level global (जो दूसरी js/*.js फाइल में इस्तेमाल हो) जोड़ें तो पहले `node scripts/gen-eslint-globals.js` चलाएं, वरना lint फेल होगी।
3. Commit → `git fetch origin main` करके rebase करें (पिछले squash-merge से conflict बचाने के लिए) → push → PR बनाएं → PR की "smoke" **और** "lint" दोनों CI checks पास होने का इंतज़ार करें → तभी merge करें (squash) → PR activity से unsubscribe करें।
   merge के बाद **"लाइव" तभी कहें** जब GitHub Pages का deploy सफल दिखे —
   `gh api "repos/pradeepks2015-ship-it/ADEGAON/deployments?environment=github-pages&per_page=1"` से id, फिर उसके
   `/statuses` में `success`। (9/10 तक हम "merge = Netlify पर लाइव" मानते रहे, जबकि Netlify 22/9 से रुका था।)
   GitHub पर push कभी "Internal Server Error" दे तो `git -c http.version=HTTP/1.1 push` आज़माएं (7/10 को यही चला)।
   **ध्यान:** GitHub Pages हमारी `_headers` फ़ाइल नहीं मानता (वह सिर्फ़ Netlify की है) — वहां हर फ़ाइल ~10 मिनट
   cache रहती है, इसलिए नया version फ़ोनों तक पहुंचने में 10 मिनट तक ज़्यादा लग सकते हैं
4. बड़े visual/UI बदलाव हों तो पहले screenshot लेकर दिखाएं, अनुमति के बाद ही merge करें।
5. कभी भी बिना पूछे risky/destructive git ऑपरेशन (force push to main, reset --hard, आदि) न करें।
6. Firebase Security Rules में कोई बदलाव करना हो तो पहले `database.rules.json` में बदलें, commit/PR/merge की सामान्य प्रक्रिया से गुज़ारें — merge होते ही `.github/workflows/deploy-rules.yml` अपने-आप असली Firebase Database पर rules publish कर देता है (backup.js जैसा ही `FIREBASE_SERVICE_ACCOUNT` secret इस्तेमाल होता है, कोई मैन्युअल Console कदम नहीं चाहिए)। PR merge होने के बाद Actions टैब में "Deploy Firebase Rules" workflow हरा (green) होने की पुष्टि कर लें।

## भाषा
उपयोगकर्ता (JE) से हमेशा हिंदी में बात करें — कोड कमेंट भी हिंदी में लिखे जाते हैं (established convention)।

## किसी अन्य Distribution Centre के लिए दोबारा बनाना / JE का ट्रांसफ़र
पूरी सूची (JE के काम, हर फ़ाइल में क्या बदले, `grep` से जांच) **`docs/NEW-DC-SETUP.md`** में — सिर्फ़ तभी पढ़ें।
**JE का निर्देश (15/10):** नया DC ऐप = आदेगांव के **ताज़ा `main`** की हूबहू copy — हर सुविधा, नियम, सुरक्षा, शर्तें, टेस्ट, CI सब; बदले
सिर्फ़ पहचान (नाम/HQ/Firebase/email/logo/repo)। कोई feature अपने मन से न हटाएं। नई बड़ी सुविधा जोड़ें तो
`docs/NEW-DC-SETUP.md` की "क्या-क्या है" सूची में भी एक पंक्ति जोड़ें

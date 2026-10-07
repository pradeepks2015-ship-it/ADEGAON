# वसूली ट्रैकर (Recovery Tracker)

आदेगांव Distribution Centre / लखनादौन डिवीजन सिवनी सर्कल (मध्य प्रदेश बिजली विभाग) के लिए एक ऑफ़लाइन-फर्स्ट PWA — vanilla JavaScript, कोई framework नहीं।

## Tech Stack
- Vanilla JavaScript (कोई build step नहीं)
- Firebase Realtime Database + Firebase Auth + Firebase App Check
- Netlify पर डिप्लॉय (साइट: adegaondc)
- Playwright से टेस्ट

## Repo/Branch
- GitHub: `pradeepks2015-ship-it/ADEGAON`
- `main` branch से Netlify auto-deploy होता है
- सारा development branch `claude/recovery-tractor-cloud-file-cx3d5z` पर होता है, फिर PR बनाकर `main` में merge होता है

## मुख्य फाइलें
- `js/config.js` — HQS, CATS, APP_VER, HQ_AUTH_EMAIL, JE_EMAIL, CAT_NAMES
- `js/firebase.js` — Firebase config, auth token handling
- `js/ui-core.js` — login/logout/UI core, doLogout, goBack
- `js/list.js` — कंज्यूमर लिस्ट render + filter + status (renderListWith, markPaid, propagateStatus)
- `js/database.js` — fbGet, normList, startListen
- `js/village.js` — गांव-वार वसूली + VILLAGE_ALIASES (आदेगांव-विशिष्ट गांव-नाम स्पेलिंग सुधार)
- `js/home-scorecard.js` — होम पेज डिस्प्ले बोर्ड + कैश लिस्ट (bulk cash-payment upload)
- `js/reports.js` — फोन एक्शन मॉडल (SMS/WhatsApp templates), स्कोरकार्ड, PDF/Excel, service-worker registration
- `js/migration.js` — पुराने array-format से नए per-record object-format में माइग्रेशन
- `js/storage.js` — local cache (cGet/cSet/cKey), offline queue (getPending, flushPending, pendingCount), mergeArrays
- `js/auth.js` — login/logout, Lineman PIN, `_ensureCorrectHqAuth` (हर HQ का अपना Firebase account)
- `js/upload.js` — लेजर अपलोड (Replace/Merge), "पुरानी वसूली सुरक्षित रखें" + तारीख़-कट-ऑफ़, रिमार्क बचाना
- `js/share.js` — उपभोक्ता card को WhatsApp पर फ़ोटो बनाकर शेयर (SVG foreignObject से असली card की तस्वीर)
- `js/scorecards.js` — स्कोरकार्ड + तारीख़-वार तालिका, `normPayDate`/`payDateVal` (तारीख़ के सारे रूप यहीं संभलते हैं)
- `js/logger.js` — `logErr()` — असली production bugs इसी लॉग से पकड़े जाते हैं (JE मेनू → error log)
- `js/main.js`, `js/profile.js`, `js/cat-admin.js`, `js/celebration.js`
- `js/usage.js` — Firebase डेटा-उपयोग का अनुमानित ट्रेंड (Blaze plan पर बिना बताए बिल न बढ़े, JE-only viewer)
- `index.html`, `css/style.css`
- `sw.js` — service worker + CACHE_NAME
- `tests/smoke.spec.js` — पूरा टेस्ट suite
- `database.rules.json` — Firebase Realtime Database की Security Rules (source of truth — `main` पर push होते ही `.github/workflows/deploy-rules.yml` अपने-आप असली Firebase पर deploy कर देता है, देखें `scripts/deploy-rules.js`)
- `eslint.config.js` / `eslint.shared-globals.json` — CI लिंट सेटअप; कोई नई top-level global var/function (जो दूसरी js/*.js फाइल में इस्तेमाल हो) जोड़ें तो `node scripts/gen-eslint-globals.js` चलाकर globals list दोबारा बनाएं। दो फ़ाइलों में ग़लती से एक ही नाम declare न हो जाए (global scope share होने से चुपचाप overwrite का ख़तरा) — यह `npm run check-globals` (CI में भी) से अपने-आप जांचा जाता है, देखें `scripts/check-duplicate-globals.js`

## काम शुरू करने से पहले
1. **`STATUS.md` पढ़ें** — अभी की स्थिति, हाल के फ़ैसले, खुले काम, और वे सुझाव जो जांच के बाद रद्द हो चुके हैं (ताकि दोबारा न उठें)। काम पूरा होने पर उसे अपडेट करते चलें।
2. `git log --oneline -20` और हाल के merged PRs देख लें — पूरा इतिहास (फ़ैसले, bug root-causes, fixes) commit messages और PR descriptions में दर्ज है।

## हर बदलाव के लिए तय प्रक्रिया (सख़्ती से पालन करें)
1. कोई भी asset/behavior बदलाव करने पर `js/config.js` का `APP_VER` और `sw.js` का `CACHE_NAME` दोनों एक-साथ बढ़ाएं (जैसे 9.65→9.66, v82→v83)।
2. बदलाव के बाद पूरा Playwright suite पास होना ज़रूरी है:
   ```
   PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test
   ```
   (local dev server: `python3 -m http.server 8080 --directory <repo-path>`)
   साथ ही CI वाली तीनों जांचें भी साफ़ होनी चाहिए — यही तीनों `.github/workflows/tests.yml` में भी चलती हैं:
   ```
   npm run lint           # 0 errors
   npm run check-xss      # onclick में escHtml() का सही इस्तेमाल
   npm run check-globals  # एक ही global नाम दो फ़ाइलों में declare न हो
   ```
   नया top-level global (जो दूसरी js/*.js फाइल में इस्तेमाल हो) जोड़ें तो पहले `node scripts/gen-eslint-globals.js` चलाएं, वरना lint फेल होगी।
3. Commit → `git fetch origin main` करके rebase करें (पिछले squash-merge से conflict बचाने के लिए) → push → PR बनाएं → PR की "smoke" **और** "lint" दोनों CI checks पास होने का इंतज़ार करें → तभी merge करें (squash) → PR activity से unsubscribe करें।
4. बड़े visual/UI बदलाव हों तो पहले screenshot लेकर दिखाएं, अनुमति के बाद ही merge करें।
5. कभी भी बिना पूछे risky/destructive git ऑपरेशन (force push to main, reset --hard, आदि) न करें।
6. Firebase Security Rules में कोई बदलाव करना हो तो पहले `database.rules.json` में बदलें, commit/PR/merge की सामान्य प्रक्रिया से गुज़ारें — merge होते ही `.github/workflows/deploy-rules.yml` अपने-आप असली Firebase Database पर rules publish कर देता है (backup.js जैसा ही `FIREBASE_SERVICE_ACCOUNT` secret इस्तेमाल होता है, कोई मैन्युअल Console कदम नहीं चाहिए)। PR merge होने के बाद Actions टैब में "Deploy Firebase Rules" workflow हरा (green) होने की पुष्टि कर लें।

## भाषा
उपयोगकर्ता (JE) से हमेशा हिंदी में बात करें — कोड कमेंट भी हिंदी में लिखे जाते हैं (established convention)।

## किसी अन्य Distribution Centre के लिए यह ऐप दोबारा बनानी हो तो
कोई feature/logic नहीं बदलता — सिर्फ़ नीचे की चीज़ें। सूची 1/10/2026 को पूरे repo में
`adegaon-dc-top-50`, `adegaondc`, JE email, App Check key, हर HQ नाम, "आदेगांव/Adegaon/ADEGAON",
"सिवनी", "लखनादौन" खोजकर बनाई गई है (टिप्पणियों वाली जगहें छोड़कर)। बदलाव के बाद यही खोज
दोबारा चलाकर पक्का करें कि कुछ छूटा नहीं:
`grep -rniI --exclude-dir={node_modules,.git,test-results} -e adegaon -e आदेगांव -e पिंडरई -e सिवनी -e लखनादौन -e pradeepks2015 .`

**ट्रांसफ़र हो तो पहले आदेगांव सौंपें** (वरना यह ऐप JE के निजी खातों पर टिका रहेगा): नए JE को
Firebase प्रोजेक्ट में Owner, Netlify में member, GitHub में collaborator बनाएं; `JE_EMAIL`
(`js/config.js`) और `database.rules.json` के हर `auth.token.email === '...'` में नए JE का email।

### क. JE के करने के काम (वेबसाइटों पर)
1. **Firebase:** नया प्रोजेक्ट → Realtime Database → Authentication में Email/Password चालू →
   Users → Add user: हर HQ का `hq-<नाम>@<dc>.internal`, password `vasuli-<6 अंक PIN>` (हर UID नोट करें) →
   App Check (reCAPTCHA v3, site key नोट करें; reCAPTCHA admin में नई Netlify domain जोड़ें) →
   Service accounts → नई private key (JSON — किसी को न भेजें) → Web app जोड़कर config लें
2. **Authentication → Settings → Authorized domains** में नई Netlify domain जोड़ें — छूटा तो login ही नहीं होगा
3. **GitHub:** नया repo; Settings → Secrets → Actions में `FIREBASE_SERVICE_ACCOUNT` = ऊपर का JSON
4. **Netlify:** नई साइट, नए repo के `main` से जोड़ें

### ख. कोड में बदलाव
| फ़ाइल | क्या बदलना है |
|---|---|
| `js/config.js` | `HQS`, `HQ_AUTH_EMAIL` (नया `.internal` domain), `JE_EMAIL` |
| `js/firebase.js` | `FB` (पहली पंक्ति), पूरा `firebaseConfig`, `appCheck().activate("<site key>")` |
| `.firebaserc` | project-id |
| `database.rules.json` | हर HQ की कुंजी + उसका नया UID, हर जगह JE email — फिर `main` पर merge से अपने-आप deploy |
| `scripts/backup.js` | `DB_URL`, अपनी `HQS` सूची |
| `scripts/deploy-rules.js` | `DB_URL` |
| `scripts/set-hq-pin.js` | `DB_URL`, `HQ_AUTH_EMAIL` की नक़ल |
| `.github/workflows/set-hq-pin.yml` | `options:` में HQ नाम |
| `.github/workflows/backup.yml` | artifact नाम `adegaon-backup-…` (सिर्फ़ नाम) |
| `index.html` | `<title>`, `meta description` और `og:*` (WhatsApp झलक — `og:url`/`og:image` में नई Netlify domain), org-banner, login-title, `login-sub` (डिवीजन/सर्कल), `.sb-org`, `#hdr-sub`, `#hq-sel` के options (`value` के साथ, `translate="no"` बना रहे), बिलिंग popup का डिवीजन/सर्कल पाठ |
| `icons/*` | सभी logo पर **"ADEGAON DC" छपा है** — नए DC का logo बनाकर `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` बदलें, और `login-logo.webp` (276×276 WebP, ~14 KB — बड़ी फ़ाइल न लगाएं, टेस्ट 30 KB से ऊपर पर फेल होगा) |
| `manifest.json` | `name`, `description` (install के वक़्त फ़ोन पर यही दिखता है; `short_name` पहले से सामान्य "वसूली ट्रैकर") |
| `privacy.html` | DC/डिवीजन/सर्कल का नाम, संपर्क email |
| `js/reports.js` | SMS/WhatsApp संदेशों में DC/सर्कल का नाम, नमूना CSV की गांव वाली पंक्ति, बैकअप फ़ाइल-नाम `ADEGAON_backup_`, **बिलिंग साइट `billing.mpez.co.in`** (दूसरी discom — पश्चिम/मध्य क्षेत्र — हो तो उसकी साइट) |
| `js/share.js` | फ़ोटो-शेयर कार्ड की ऊपरी पंक्ति ("आदेगांव बिजली वितरण केंद्र") |
| `js/scorecards.js` | WhatsApp स्कोरकार्ड का शीर्षक |
| `js/upload.js` | PDF रिपोर्ट का शीर्षक |
| `js/home-scorecard.js` | डिस्प्ले बोर्ड पर "ADEGAON DC" |
| `js/village.js` | `VILLAGE_ALIASES` ख़ाली करें (आदेगांव के गांवों के स्पेलिंग-सुधार हैं), Excel फ़ाइल-नाम `ADEGAON_गांव_वार_` |
| `js/migration.js` | dry-run फ़ाइल-नाम (सिर्फ़ नाम) |
| `package.json` | `name`, `description` (सिर्फ़ पहचान) |
| `sw.js` | `CACHE_NAME` का `adegaon-dc-` हिस्सा (वैकल्पिक, पर नई साइट पर साफ़ शुरुआत) |
| `.well-known/assetlinks.json` | Android ऐप (TWA) की पहचान — नया APK न बनाना हो तो फ़ाइल हटा दें |
| `google1f9a33c82033cc77.html` | Google Search Console की आदेगांव वाली पुष्टि — नई कॉपी में हटा दें |
| `tests/smoke.spec.js` | बहुत से टेस्ट HQ नाम ("आदेगांव", "पाटन"…) सीधे इस्तेमाल करते हैं — नए नामों पर बदलें, फिर पूरा suite |
| `CLAUDE.md`, `STATUS.md` | नया DC/डिवीजन/सर्कल, repo और Netlify साइट का नाम; `STATUS.md` नए सिरे से |

### ग. शुरू करना (JE)
JE login → 🔒 Lineman PIN में हर HQ का वही PIN भरें जो ऊपर Firebase में डाला → श्रेणियों के नाम →
हर HQ का लेजर अपलोड → लाइनमैनों को नया लिंक और PIN।

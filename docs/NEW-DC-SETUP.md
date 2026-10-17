# किसी अन्य Distribution Centre के लिए यह ऐप दोबारा बनाना

> CLAUDE.md से यहां लाया गया (15/10/2026, टोकन बचत) — ज़रूरत पड़ने पर ही पढ़ें।

## ⭐ मूल सिद्धांत (JE का निर्देश, 15/10/2026) — हमेशा मानें
**नए DC का ऐप = आदेगांव ऐप की हूबहू copy, उस दिन के `main` के सबसे नए version तक।** जो-जो आदेगांव में चल रहा है —
हर सुविधा, हर नियम, हर सुरक्षा, हर शर्त (terms/privacy), हर टेस्ट और CI/workflow — **सब बिना छोड़े** नए ऐप में आए।
बदलता सिर्फ़ **पहचान** है (DC/डिवीजन/सर्कल का नाम, HQ के नाम, Firebase project/keys/UID, JE email, logo, GitHub repo/Pages पता) —
नीचे "ख. कोड में बदलाव" वाली सूची। कोई feature "नए DC में शायद ज़रूरी नहीं" सोचकर **न हटाएं, न बदलें** — फ़ैसला JE का।

**कैसे:**
1. नया repo आदेगांव repo के **ताज़ा `main`** से बनाएं (पूरा copy — `.github/`, `scripts/`, `tests/`, `docs/`, `database.rules.json`,
   `privacy.html`, `firebase.json`, `eslint*`, `tsconfig.json`, `types/` समेत)। पुराना कोई zip/पुरानी copy नहीं
2. सिर्फ़ "ख." वाली पहचान-चीज़ें बदलें, फिर ऊपर वाली `grep` खोज से पक्का करें कि आदेगांव का नाम कहीं छूटा नहीं
3. **पूरा टेस्ट suite + CI की सारी jobs** (lint, smoke, rules, backup-lock, e2e-firebase) नए repo में हरी हों — टेस्ट के HQ नाम
   नए नामों पर बदलें, टेस्ट हटाएं नहीं
4. `CLAUDE.md`, `STATUS.md` नए DC के नाम से; `STATUS.md` में लिखें "आदेगांव v<X.YYY> से copy, <तारीख़>"
5. JE के वेबसाइट वाले काम ("क.") और शुरुआत ("ग.")

**आदेगांव में अभी क्या-क्या है जो नए ऐप में आना ही चाहिए (v9.231, 15/10/2026 — आगे जुड़े तो इस सूची में भी जोड़ें):**
- **लाइनमैन:** HQ + PIN login (हर HQ का अपना Firebase खाता), बिना नेट पूरा काम (IndexedDB cache, offline queue, बाद में अपने-आप
  भेजना), वसूल/वापस बाकी, रिमार्क (वादा एक टैप, "इस सप्ताह जमा का वादा", सब सूचियों से मिलाकर दिखना, बीते वादे पर दो बार टैप = "💔 वादा टूटा", महीना बदलते ही बीते वादे बटन से बाहर, कमज़ोर नेट पर सर्वर-रिमार्क न दबना), गांव की पट्टी, क्रम/फ़िल्टर (लेजर क्रम, बड़ी बकाया पहले,
  ⏳ पुराने बकायादार पहले, 🚫 कभी भुगतान नहीं), फ़ोन एक्शन (कॉल/SMS/WhatsApp, card फ़ोटो शेयर), PDF/Excel, बड़े अक्षर, dark थीम, ऐप का अपना पुष्टि-डिब्बा (appAsk — ब्राउज़र confirm/prompt नहीं; "वसूली वापस बाकी" छोड़कर),
  जश्न-आवाज़, प्रोफ़ाइल फ़ोटो, दो टैब में भी सुरक्षित
- **JE:** सब HQ, लेजर अपलोड (Replace/Merge, कट-ऑफ़ सर्वर पर, पहले सूचियां ताज़ा, रिमार्क/वसूली/राशि बचाना), कैश लिस्ट, आज की वसूली,
  ग्राम-वार, मुख्यालय व टैरिफ रिपोर्ट, स्कोरकार्ड/डिस्प्ले बोर्ड, कर्मचारी सक्रियता, एरर लॉग, डेटा उपयोग, डेटा बचाओ मोड, Lineman PIN,
  पूरा बैकअप, चरण 3, श्रेणी-नाम, विषय-वार मेनू
- **सुरक्षा/भरोसा:** Firebase Security Rules (हर HQ अलग, JE-only हिस्से, `LEDGER_CUT`), App Check (Enforced), JE पासवर्ड memory में ही,
  कट-ऑफ़ से पुरानी वसूली अपने-आप साफ़, बासी cache/ETag बचाव, एरर लॉग (बिना नेट वाली बाद में), "पहले JE, फिर सब" (नया version JE फ़ोन पर पहले, `rollout.json`), अपने-आप alert (हर 4 घंटे सर्वर-लॉग → GitHub issue, `alert.yml`), साप्ताहिक बैकअप **पासवर्ड-ताले** के साथ
  (`BACKUP_PASSWORD` secret) और बैकअप से रिमार्क वापसी (`restore-remarks.yml`, हाथ से), Dependabot (महीने में एक), privacy.html (अंग्रेज़ी), Google Search से छिपाव, Firebase scripts पर integrity (SRI) + CSP meta (index.html — नए DC का
  database/authDomain `*.firebaseio.com`/`*.firebaseapp.com` में पहले से आता है)
- **टेस्ट/CI:** ~600 Playwright टेस्ट (असली आकार का डेटा, धीमा फ़ोन, दो टैब, पुराना फ़ोन, "मासिक अपलोड"), rules emulator, e2e emulator,
  बैकअप-ताला, lint/typecheck/xss/globals/sri/alerts

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
   App Check (reCAPTCHA v3, site key नोट करें; reCAPTCHA admin में `<github-user>.github.io` जोड़ें) →
   Service accounts → नई private key (JSON — किसी को न भेजें) → Web app जोड़कर config लें
2. **Authentication → Settings → Authorized domains** में `<github-user>.github.io` जोड़ें — छूटा तो login ही नहीं होगा
3. **GitHub:** नया repo; Settings → Secrets → Actions में `FIREBASE_SERVICE_ACCOUNT` = ऊपर का JSON; और `BACKUP_PASSWORD` = बैकअप
   Excel का पासवर्ड (repo public है — इसके बिना साप्ताहिक बैकअप जान-बूझकर फेल होता है, देखें `scripts/encrypt-backup.py`)
4. **GitHub Pages:** नए repo → Settings → Pages → Source: "Deploy from a branch", `main` / root।
   (Netlify का मुफ़्त plan बार-बार deploy पर क्रेडिट ख़त्म कर देता है — 22/9/2026 को यही हुआ)

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
| `index.html` | `<title>`, `meta description` और `og:*` (WhatsApp झलक — `og:url`/`og:image` में नया GitHub Pages पता, `/<repo>/` समेत; टेस्ट भी यही पता जांचता है), org-banner, login-title, `login-sub` (डिवीजन/सर्कल), `.sb-org`, `#hdr-sub`, `#hq-sel` के options (`value` के साथ, `translate="no"` बना रहे), बिलिंग popup का डिवीजन/सर्कल पाठ |
| `icons/*` | सभी logo पर **"ADEGAON DC" छपा है** — नए DC का logo बनाकर `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` बदलें, और `login-logo.webp` (276×276 WebP, ~14 KB — बड़ी फ़ाइल न लगाएं, टेस्ट 30 KB से ऊपर पर फेल होगा) |
| `manifest.json` | `name`, `description` (install के वक़्त फ़ोन पर यही दिखता है; `short_name` पहले से सामान्य "वसूली ट्रैकर") |
| `privacy.html` | DC/डिवीजन/सर्कल का नाम, संपर्क email |
| `js/reports.js` | PDF रिपोर्ट का शीर्षक (v9.195 से यहां), SMS/WhatsApp संदेशों में DC/सर्कल का नाम, नमूना CSV की गांव वाली पंक्ति, बैकअप फ़ाइल-नाम `ADEGAON_backup_`, **बिलिंग साइट `billing.mpez.co.in`** (दूसरी discom — पश्चिम/मध्य क्षेत्र — हो तो उसकी साइट) |
| `js/share.js` | फ़ोटो-शेयर कार्ड की ऊपरी पंक्ति ("आदेगांव बिजली वितरण केंद्र") |
| `js/scorecards.js` | WhatsApp स्कोरकार्ड का शीर्षक |
| `js/home-scorecard.js` | डिस्प्ले बोर्ड पर "ADEGAON DC" |
| `js/village.js` | `VILLAGE_ALIASES` ख़ाली करें (आदेगांव के गांवों के स्पेलिंग-सुधार हैं), Excel फ़ाइल-नाम `ADEGAON_गांव_वार_` |
| `js/migration-tool.js` | dry-run फ़ाइल-नाम (सिर्फ़ नाम) |
| `package.json` | `name`, `description` (सिर्फ़ पहचान) |
| `sw.js` | `CACHE_NAME` का `adegaon-dc-` हिस्सा (वैकल्पिक, पर नई साइट पर साफ़ शुरुआत) |
| `.well-known/assetlinks.json` | Android ऐप (TWA) की पहचान — नया APK न बनाना हो तो फ़ाइल हटा दें |
| `google1f9a33c82033cc77.html` | Google Search Console की आदेगांव वाली पुष्टि — नई कॉपी में हटा दें |
| `tests/*.spec.js` | बहुत से टेस्ट HQ नाम ("आदेगांव", "पाटन"…) सीधे इस्तेमाल करते हैं — नए नामों पर बदलें, फिर पूरा suite |
| `CLAUDE.md`, `STATUS.md` | नया DC/डिवीजन/सर्कल, repo और Netlify साइट का नाम; `STATUS.md` नए सिरे से |

### ग. शुरू करना (JE)
JE login → 🔒 Lineman PIN में हर HQ का वही PIN भरें जो ऊपर Firebase में डाला → श्रेणियों के नाम →
हर HQ का लेजर अपलोड → लाइनमैनों को नया लिंक और PIN।

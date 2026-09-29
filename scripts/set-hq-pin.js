// ── ऐप में भरा हुआ PIN असली Firebase Auth पर लागू करना (GitHub Actions से, हाथ से चलाकर) ──
// लाइनमैन का login असल में Firebase Auth के उस मुख्यालय वाले खाते से होता है, और उसका password
// सीधे PIN से बनता है: "vasuli-" + PIN (देखें js/auth.js: _hqAuthPassword)।
//
// Firebase Console से यह password बदला ही नहीं जा सकता — Authentication → Users में किसी खाते के
// ⋮ मेनू में सिर्फ़ "Reset password", "Disable account" और "Delete account" हैं। "Reset password"
// सिर्फ़ email भेजता है, और हमारे खाते hq-*@adegaondc.internal पर हैं — यह असली domain ही नहीं है,
// इसलिए वह email कहीं नहीं पहुंचती (JE ने 29/9 को Console में यही देखा)। "Delete account" का
// रास्ता और ख़तरनाक है: नया खाता = नया UID, जबकि database.rules.json में हर मुख्यालय का UID
// हार्डकोडेड है — उस मुख्यालय के सभी लाइनमैन का access एक झटके में चला जाएगा।
//
// यह script PIN input के तौर पर *नहीं* लेती — जान-बूझकर। पहली कोशिश (run #1) में PIN workflow
// input था और GitHub ने उसे step के env ब्लॉक में साफ़-साफ़ लॉग में छाप दिया ("NEW_PIN: 000111")।
// ::add-mask:: भी पूरा इलाज नहीं, क्योंकि mask लगने से पहले ही वह पंक्ति छप चुकी होती है।
// इसलिए अब PIN वहीं से आता है जहां JE पहले से भरते हैं — ऐप का "🔒 Lineman PIN" पन्ना, यानी
// database का /HQ_PIN (जिसे Security Rules सिर्फ़ JE को पढ़ने देती हैं)। script उसे पढ़कर Auth पर
// लागू कर देती है। फ़ायदा यह भी कि "रिकॉर्ड" और "असली PIN" कभी अलग नहीं हो सकते।
//
// चलाने का तरीक़ा: पहले ऐप में JE मेनू → 🔒 Lineman PIN → नया PIN भरकर सेव करें,
// फिर GitHub → Actions → "HQ PIN लागू करें" → Run workflow → मुख्यालय चुनें (या "सभी")।

const DB_URL = "https://adegaon-dc-top-50-default-rtdb.firebaseio.com";

// js/config.js के HQ_AUTH_EMAIL की नक़ल — दोनों एक साथ बदलने पड़ते हैं (नया DC बनाते वक़्त भी,
// देखें CLAUDE.md का आख़िरी हिस्सा)
const HQ_AUTH_EMAIL = {
  "आदेगांव": "hq-adegaon@adegaondc.internal",
  "पिंडरई": "hq-pindrai@adegaondc.internal",
  "जोबा": "hq-joba@adegaondc.internal",
  "पाटन": "hq-patan@adegaondc.internal",
  "बीबी": "hq-bibi@adegaondc.internal",
  "मढ़ी": "hq-madhi@adegaondc.internal",
};

// js/auth.js के MIN_PIN_LEN जैसा ही नियम — 4 अंक यानी सिर्फ़ 10,000 संभावनाएं, और हर मुख्यालय
// का email js/config.js में खुला पड़ा है। 6 अंक से यह 10 लाख हो जाता है
const MIN_PIN_LEN = 6;
// js/auth.js का _hqAuthPassword — दोनों जगह एक जैसा होना ज़रूरी है, वरना login नाकाम हो जाएगा
function hqAuthPassword(pin) { return "vasuli-" + pin; }
// js/config.js का hqKey — /HQ_PIN में इसी कुंजी से PIN रखा जाता है
function hqKey(hq) { return hq.replace(/[\s.#$[\]/]/g, "_"); }

function fail(msg) { throw new Error(msg); }

// Firebase से नाता तोड़कर process को बंद होने देना। सिर्फ़ इतना ही काफ़ी होना चाहिए, पर अगर
// कोई और चीज़ event loop पकड़े रह जाए तो job हमेशा के लिए अटक जाएगा — इसलिए एक unref किया हुआ
// टाइमर भी रखा है (unref का मतलब: यह ख़ुद process को ज़िंदा नहीं रखेगा, सिर्फ़ तभी चलेगा जब
// process किसी और वजह से अब भी चल रहा हो)
async function shutdown(db, deleteApp, getApp) {
  setTimeout(function () { process.exit(0); }, 10000).unref();
  try { db.goOffline(); } catch { /* पहले से बंद हो तो कोई बात नहीं */ }
  try { await deleteApp(getApp()); } catch { /* वही */ }
}

async function main() {
  var want = (process.env.HQ || "").trim();
  if (!want) fail("मुख्यालय नहीं चुना गया");
  var all = Object.keys(HQ_AUTH_EMAIL);
  if (want !== "सभी" && !HQ_AUTH_EMAIL[want]) {
    fail('"' + want + '" कोई जाना-पहचाना मुख्यालय नहीं — ' + all.join(", ") + ' या "सभी" में से एक होना चाहिए');
  }
  var targets = want === "सभी" ? all : [want];

  var { initializeApp, cert, getApp, deleteApp } = require("firebase-admin/app");
  var { getAuth } = require("firebase-admin/auth");
  var { getDatabase } = require("firebase-admin/database");
  // firebase-admin@14 में पुराना namespace वाला रूप नहीं बचा: require("firebase-admin") से मिली
  // object में सिर्फ़ app वाले हिस्से हैं (initializeApp, cert, ...) — admin.auth() है ही नहीं।
  // पहली असली कोशिश इसी पर गिरी थी: "admin.auth is not a function"
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)), databaseURL: DB_URL });
  var auth = getAuth();

  // service account admin है, इसलिए Security Rules इसके रास्ते में नहीं आतीं
  var db = getDatabase();
  var snap = await db.ref("HQ_PIN").once("value");
  var pins = snap.val() || {};

  var done = [], skipped = [];
  for (var i = 0; i < targets.length; i++) {
    var hq = targets[i];
    var email = HQ_AUTH_EMAIL[hq];
    var pin = String(pins[hqKey(hq)] == null ? "" : pins[hqKey(hq)]).trim();

    // एक मुख्यालय की गड़बड़ी बाक़ी को न रोके — "सभी" चलाते वक़्त यही चाहिए
    if (!pin) { skipped.push(hq + " — ऐप में PIN भरा ही नहीं है"); continue; }
    if (!/^\d+$/.test(pin)) { skipped.push(hq + " — PIN में सिर्फ़ अंक होने चाहिए"); continue; }
    if (pin.length < MIN_PIN_LEN) { skipped.push(hq + " — PIN कम से कम " + MIN_PIN_LEN + " अंक का चाहिए (ऐप में " + pin.length + " अंक का है)"); continue; }

    // PIN कभी लॉग में न छपे — GitHub Actions का लॉग repo पढ़ने वाला कोई भी देख सकता है
    var user = await auth.getUserByEmail(email).catch(function (e) {
      fail("यह खाता Firebase में मिला ही नहीं (" + email + ") — " + ((e && e.message) || e));
    });
    await auth.updateUser(user.uid, { password: hqAuthPassword(pin) });
    // UID वही रहता है, इसलिए database.rules.json की अनुमतियां अछूती रहती हैं
    done.push(hq + " (" + pin.length + " अंक का PIN, UID " + user.uid + " — नहीं बदला)");
  }

  // RTDB का connection खुला रहता है और Node का event loop उसी से चलता रहता है — main() पूरा
  // होने के बाद भी process अपने-आप बंद नहीं होता। run #2 में यही हुआ: छहों PIN लागू हो गए, पर
  // job 5 मिनट का timeout खाकर लाल हो गया — काम सफल, निशान झूठा। इसलिए पढ़ाई ख़त्म होते ही
  // connection बंद करके app हटा देते हैं (fail() वाले रास्ते पर भी नीचे catch से यही होता है)
  await shutdown(db, deleteApp, getApp);

  console.log("");
  if (done.length) {
    console.log("✅ लागू हो गया:");
    done.forEach(function (d) { console.log("   • " + d); });
  }
  if (skipped.length) {
    console.log("");
    console.log("⏭ छोड़ दिए गए (ऐप में ठीक करके दोबारा चलाएं):");
    skipped.forEach(function (s) { console.log("   • " + s); });
  }
  if (!done.length) fail("एक भी मुख्यालय पर PIN लागू नहीं हुआ");

  console.log("");
  console.log("अब बस इतना बाक़ी है: जिन मुख्यालयों का PIN बदला, उनके लाइनमैनों को नया PIN बता दें।");
  console.log("उनके फ़ोन पर \"🔐 PIN बदल गया लगता है\" दिखेगा और वे login स्क्रीन पर आ जाएंगे।");
  console.log("बिना भेजी गई वसूली सुरक्षित रहती है — नया PIN डालते ही अपने-आप चली जाएगी।");
}

main().catch(function (e) {
  console.error("❌ गड़बड़:", (e && e.message) || e);
  // गड़बड़ वाले रास्ते पर भी connection खुला रह सकता है — exit(1) उसे वैसे भी बंद कर देता है,
  // इसलिए यहां अलग से shutdown की ज़रूरत नहीं (process.exit तुरंत सब गिरा देता है)
  process.exit(1);
});

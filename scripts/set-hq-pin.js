// ── किसी मुख्यालय का Lineman PIN बदलना (GitHub Actions से, हाथ से चलाकर) ──────────────────
// लाइनमैन का login असल में Firebase Auth के उस मुख्यालय वाले खाते से होता है, और उसका password
// सीधे PIN से बनता है: "vasuli-" + PIN (देखें js/auth.js: _hqAuthPassword)।
//
// Firebase Console से यह password बदला ही नहीं जा सकता — Authentication → Users में किसी
// खाते के ⋮ मेनू में सिर्फ़ "Reset password", "Disable account" और "Delete account" हैं।
// "Reset password" सिर्फ़ email भेजता है, और हमारे खाते hq-*@adegaondc.internal पर हैं —
// यह असली domain ही नहीं है, इसलिए वह email कहीं नहीं पहुंचती। (JE ने 29/9 को Console में
// यही देखा और स्क्रीनशॉट भेजा।) "Delete account" का रास्ता तो और ख़तरनाक है — नया खाता बनाने
// पर UID बदल जाता है, जबकि database.rules.json में हर मुख्यालय का UID हार्डकोडेड है; यानी उस
// मुख्यालय के सभी लाइनमैन का access एक झटके में चला जाएगा।
//
// इसलिए यही script — Admin SDK से सीधे password बदलती है। UID वही रहता है, rules अछूती रहती हैं।
// वही FIREBASE_SERVICE_ACCOUNT secret जो deploy-rules.js और backup.js इस्तेमाल करते हैं।
//
// चलाने का तरीक़ा: GitHub → Actions → "HQ PIN बदलें" → Run workflow → मुख्यालय चुनें + नया PIN
//
// ध्यान: firebase-admin जान-बूझकर नीचे (जांच पूरी होने के बाद) require होता है — ग़लत PIN/HQ
// पर SDK की ज़रूरत ही नहीं पड़नी चाहिए, और इसी से यह जांच बिना Firebase छुए स्थानीय रूप से
// टेस्ट भी हो जाती है (देखें tests/smoke.spec.js का "HQ PIN बदलने वाली script" ब्लॉक)

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

function fail(msg) { throw new Error(msg); }

async function main() {
  var hq = (process.env.HQ || "").trim();
  var pin = (process.env.NEW_PIN || "").trim();

  if (!hq) fail("HQ नहीं मिला");
  if (!HQ_AUTH_EMAIL[hq]) fail('"' + hq + '" कोई जाना-पहचाना मुख्यालय नहीं — ' + Object.keys(HQ_AUTH_EMAIL).join(", ") + " में से एक होना चाहिए");
  if (!/^\d+$/.test(pin)) fail("PIN में सिर्फ़ अंक होने चाहिए");
  if (pin.length < MIN_PIN_LEN) fail("PIN कम से कम " + MIN_PIN_LEN + " अंक का होना चाहिए (मिला: " + pin.length + " अंक)");

  var email = HQ_AUTH_EMAIL[hq];
  // PIN कभी लॉग में न छपे — GitHub Actions के लॉग repo पढ़ने वाला कोई भी देख सकता है
  console.log("मुख्यालय: " + hq + "  |  खाता: " + email + "  |  नया PIN: " + pin.length + " अंक का");

  // जांच पूरी हो चुकी — अब असली काम, इसलिए अब SDK चाहिए
  var admin = require("firebase-admin");
  admin.initializeApp({ credential: admin.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });

  var user = await admin.auth().getUserByEmail(email).catch(function (e) {
    fail("यह खाता Firebase में मिला ही नहीं (" + email + ") — " + ((e && e.message) || e));
  });
  // UID वही रहना चाहिए, वरना database.rules.json की अनुमतियां टूट जाएंगी
  console.log("खाता मिला, UID: " + user.uid + " (यह नहीं बदलेगा)");

  await admin.auth().updateUser(user.uid, { password: hqAuthPassword(pin) });

  console.log("✅ " + hq + " का PIN बदल गया।");
  console.log("");
  console.log("अब दो काम बाक़ी हैं:");
  console.log("  1. ऐप में JE मेनू → 🔒 Lineman PIN → " + hq + " के लिए यही नया PIN भरकर सेव करें (रिकॉर्ड के लिए)");
  console.log("  2. " + hq + " के लाइनमैनों को नया PIN बता दें");
  console.log("");
  console.log("उनके फ़ोन पर \"🔐 PIN बदल गया लगता है\" दिखेगा और वे login स्क्रीन पर आ जाएंगे।");
  console.log("बिना भेजी गई वसूली सुरक्षित रहती है — नया PIN डालते ही अपने-आप चली जाएगी।");
}

main().catch(function (e) {
  console.error("❌ PIN नहीं बदला:", (e && e.message) || e);
  process.exit(1);
});

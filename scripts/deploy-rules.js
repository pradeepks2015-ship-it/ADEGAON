// ── RULES AUTO-DEPLOY (GitHub Actions से database.rules.json main पर बदलते ही चलता है) ──
// database.rules.json (repo का backup/version-history) से असली Firebase Realtime Database
// की Security Rules अपने-आप live हो जाती हैं — अब JE को हर बदलाव के बाद Firebase Console में
// जाकर मैन्युअली paste/publish करने की ज़रूरत नहीं (वो तरीक़ा भूलने/copy-paste ग़लती के जोखिम
// वाला था — असली repo और live-rules में चुपचाप drift हो सकता था, किसी को पता भी न चलता)।
// backup.js जैसा ही सादा REST तरीक़ा — service account token से सीधा PUT, कोई firebase-tools
// CLI इंस्टॉल करने की ज़रूरत नहीं। यही token backup.js में भी data पढ़ने के लिए इस्तेमाल होता है।
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const DB_URL = "https://adegaon-dc-top-50-default-rtdb.firebaseio.com";
const REQ_TIMEOUT_MS = 20000; // कभी भी हमेशा के लिए न अटके

async function main() {
  var serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  var cred = admin.credential.cert(serviceAccount);
  var tokenResult = await cred.getAccessToken();
  var token = tokenResult.access_token;
  console.log("Firebase access token मिल गया, rules deploy हो रही हैं...");

  var rulesPath = path.join(__dirname, "..", "database.rules.json");
  var rulesContent = fs.readFileSync(rulesPath, "utf8");
  JSON.parse(rulesContent); // ग़लत/टूटा JSON गलती से live पर न चला जाए — पहले local parse करके पक्का करें

  var ctrl = new AbortController();
  var tm = setTimeout(function () { ctrl.abort(); }, REQ_TIMEOUT_MS);
  try {
    var res = await fetch(DB_URL + "/.settings/rules.json", {
      method: "PUT",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: rulesContent,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      var errBody = await res.text().catch(function () { return ""; });
      throw new Error("Rules deploy नाकाम — HTTP " + res.status + ": " + errBody);
    }
    console.log("✅ Rules सफलतापूर्वक live हो गईं");
  } finally {
    clearTimeout(tm);
  }
}

main().catch(function (e) {
  console.error("❌ Rules deploy में गड़बड़:", (e && e.message) || e);
  process.exit(1);
});

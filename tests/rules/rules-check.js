// ── Firebase Security Rules की असली जांच (Firebase के नक़ली सर्वर — emulator — पर) ──
// database.rules.json main पर merge होते ही असली Firebase पर अपने-आप लग जाते हैं (deploy-rules.yml)।
// पहले इनकी जांच सिर्फ़ "rule में यह शब्द लिखा है" वाली थी (tests/categories-rules.spec.js) — नियम में
// असली ग़लती (जैसे लाइनमैन अपनी ही वसूली न लिख पाए, या पाटन वाला पिंडरई का डेटा बदल सके) तब भी
// टेस्ट हरे रहते। यहां वही rules emulator में लगाकर हर तरह के खाते से सचमुच पढ़/लिखकर देखा जाता है।
// असली Firebase को यह कभी नहीं छूता (project "demo-…" — emulator ही चलता है)।
// चलाना: npm run test:rules   (Java + firebase-tools चाहिए; CI में "rules" job)
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || "127.0.0.1:9000";
const NS = "demo-adegaon-rules";
const RULES_TEXT = fs.readFileSync(path.join(__dirname, "..", "..", "database.rules.json"), "utf8");
const RULES = JSON.parse(RULES_TEXT).rules;

// JE का email और हर HQ का UID rules से ही निकालें — rules बदलें तो टेस्ट अपने-आप साथ चलें
const JE_EMAIL = /auth\.token\.email === '([^']+)'/.exec(RULES.HQ_PIN[".read"])[1];
const HQS = Object.keys(RULES).filter((k) => !/^[A-Z_$]/.test(k));
const UID = {};
HQS.forEach((hq) => { UID[hq] = /auth\.uid === '([^']+)'/.exec(RULES[hq][".write"])[1]; });

// emulator बिना signature वाला (alg:none) token मान लेता है — असली Firebase नहीं
function b64(o) { return Buffer.from(JSON.stringify(o)).toString("base64url"); }
function token(user) {
  if (!user) return null;
  const now = Math.floor(Date.now() / 1000);
  const p = {
    iss: "https://securetoken.google.com/" + NS, aud: NS, iat: now, exp: now + 3600, auth_time: now,
    sub: user.uid, user_id: user.uid,
    firebase: { sign_in_provider: user.anon ? "anonymous" : "password", identities: {} },
  };
  if (user.email) p.email = user.email;
  return b64({ alg: "none", typ: "JWT" }) + "." + b64(p) + ".";
}
const JE = { uid: "je-uid", email: JE_EMAIL };
const ANON = { uid: "anon-uid", anon: true };
const lineman = (hq) => ({ uid: UID[hq], email: "hq-test@example.internal" });

async function req(method, p, user, body) {
  // ध्यान: emulator "Authorization: Bearer <कुछ भी>" को admin मान लेता है — इसलिए आम खाते का token
  // ?auth= में (ऐप भी असली Firebase को ऐसे ही भेजता है), और admin (owner) सिर्फ़ header में
  const headers = { "Content-Type": "application/json" };
  let q = "?ns=" + NS;
  if (user === "owner") headers.Authorization = "Bearer owner";
  else if (user) q += "&auth=" + token(user);
  const r = await fetch("http://" + HOST + "/" + encodeURI(p) + ".json" + q, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return r.status;
}
const canRead = async (p, u) => (await req("GET", p, u)) === 200;
const canWrite = async (p, u, v) => (await req("PUT", p, u, v)) === 200;
const canPush = async (p, u, v) => (await req("POST", p, u, v)) === 200;

const REC = (acc) => ({ acc, name: "जांच", amount: 100, status: "pending" });

test.before(async () => {
  // rules emulator में लगाएं (owner = admin, emulator का अपना)
  const r = await fetch("http://" + HOST + "/.settings/rules.json?ns=" + NS, {
    method: "PUT", headers: { Authorization: "Bearer owner" }, body: RULES_TEXT,
  });
  assert.strictEqual(r.status, 200, "rules emulator में नहीं लगे");
});

test.beforeEach(async () => { await req("PUT", "", "owner", {}); }); // हर टेस्ट ख़ाली database से

test("rules फ़ाइल से 6 HQ और उनके UID मिले", () => {
  assert.deepStrictEqual(HQS.length, 6);
  HQS.forEach((hq) => assert.ok(UID[hq], hq + " का UID नहीं मिला"));
});

test("हर HQ का लाइनमैन अपनी सूची पढ़/लिख सके — दूसरे HQ की नहीं", async () => {
  for (const hq of HQS) {
    const me = lineman(hq);
    assert.ok(await canWrite(hq + "/घरेलू/1001", me, REC("1001")), hq + " अपनी वसूली नहीं लिख पाया");
    assert.ok(await canRead(hq + "/घरेलू", me), hq + " अपनी सूची नहीं पढ़ पाया");
    for (const other of HQS) {
      if (other === hq) continue;
      assert.ok(!(await canWrite(other + "/घरेलू/2002", me, REC("2002"))), hq + " ने " + other + " में लिख दिया");
      assert.ok(!(await canRead(other + "/घरेलू", me)), hq + " ने " + other + " पढ़ लिया");
    }
  }
});

test("JE हर HQ पढ़/लिख सके", async () => {
  for (const hq of HQS) {
    assert.ok(await canWrite(hq + "/व्यवसाय/3003", JE, REC("3003")), "JE " + hq + " में नहीं लिख पाया");
    assert.ok(await canRead(hq + "/व्यवसाय", JE), "JE " + hq + " नहीं पढ़ पाया");
  }
});

test("बिना login और anonymous — किसी HQ की सूची न पढ़ें न लिखें", async () => {
  for (const hq of HQS) {
    for (const u of [null, ANON]) {
      assert.ok(!(await canRead(hq + "/घरेलू", u)), hq + " बिना सही खाते के पढ़ी गई");
      assert.ok(!(await canWrite(hq + "/घरेलू/4004", u, REC("4004"))), hq + " में बिना सही खाते के लिखा गया");
    }
  }
});

test("उपभोक्ता रिकॉर्ड में acc (उपभोक्ता क्रमांक) ज़रूरी", async () => {
  const hq = HQS[0];
  assert.ok(!(await canWrite(hq + "/घरेलू/5005", lineman(hq), { name: "बिना क्रमांक", amount: 1 })));
  assert.ok(!(await canWrite(hq + "/घरेलू/5006", lineman(hq), { acc: "", name: "ख़ाली क्रमांक" })));
});

test("HQ_PIN — सिर्फ़ JE पढ़/लिख सके (लाइनमैन, anonymous, बिना login नहीं)", async () => {
  assert.ok(await canWrite("HQ_PIN", JE, { x: "1" }));
  assert.ok(await canRead("HQ_PIN", JE));
  for (const u of [lineman(HQS[0]), ANON, null]) {
    assert.ok(!(await canRead("HQ_PIN", u)), "HQ_PIN JE के अलावा किसी ने पढ़ लिया");
    assert.ok(!(await canWrite("HQ_PIN", u, { x: "2" })), "HQ_PIN JE के अलावा किसी ने बदल दिया");
  }
});

test("CAT_NAMES / PH_CUSTOM_MSG / PAUSE / MIGRATED — सब पढ़ सकें, सिर्फ़ JE बदले", async () => {
  for (const key of ["CAT_NAMES", "PH_CUSTOM_MSG", "PAUSE", "MIGRATED"]) {
    assert.ok(await canWrite(key, JE, { a: "1" }), key + " JE नहीं लिख पाया");
    assert.ok(await canRead(key, lineman(HQS[1])), key + " लाइनमैन नहीं पढ़ पाया");
    assert.ok(!(await canWrite(key, lineman(HQS[1]), { a: "2" })), key + " लाइनमैन ने बदल दिया");
  }
});

test("LOGS — लाइनमैन नई error जोड़ सके (हर field string ≤400), पर न पढ़े, न पुरानी बदले", async () => {
  const me = lineman(HQS[2]);
  const day = "2026-10-13";
  const entry = { t: new Date().toISOString(), c: "जांच", m: "x", i: "abc", r: new Date().toISOString() };
  assert.ok(await canPush("LOGS/" + day, me, entry), "v9.209 वाली (r सहित) entry नहीं जुड़ी");
  assert.ok(!(await canRead("LOGS/" + day, me)), "लाइनमैन ने LOGS पढ़ लिए");
  assert.ok(await canRead("LOGS/" + day, JE));
  assert.ok(!(await canPush("LOGS/" + day, me, Object.assign({}, entry, { m: "y".repeat(401) }))), "400 से लंबा field गया");
  assert.ok(!(await canPush("LOGS/" + day, me, Object.assign({}, entry, { s: 1 }))), "string न होने वाला field गया (s/a server पर नहीं जाने चाहिए)");
  await req("PUT", "LOGS/" + day + "/fixed", "owner", entry);
  assert.ok(!(await canWrite("LOGS/" + day + "/fixed", me, Object.assign({}, entry, { m: "बदला" }))), "पुरानी entry बदल दी गई");
});

test("LEDGER_CUT (v9.223) — सब login वाले पढ़ें, सिर्फ़ JE लिखे, सिर्फ़ yyyymmdd संख्या", async () => {
  assert.ok(await canWrite("LEDGER_CUT/" + HQS[0], JE, 20261001), "JE कट-ऑफ़ नहीं लिख पाया");
  assert.ok(await canRead("LEDGER_CUT", lineman(HQS[1])), "लाइनमैन कट-ऑफ़ नहीं पढ़ पाया");
  assert.ok(!(await canRead("LEDGER_CUT", null)), "बिना login कट-ऑफ़ पढ़ लिया");
  assert.ok(!(await canWrite("LEDGER_CUT/" + HQS[0], lineman(HQS[0]), 20261001)), "लाइनमैन ने कट-ऑफ़ बदल दिया");
  assert.ok(!(await canWrite("LEDGER_CUT/" + HQS[0], JE, "2026-10-01")), "string कट-ऑफ़ गई");
  assert.ok(!(await canWrite("LEDGER_CUT/" + HQS[0], JE, 1)), "बेतुकी कट-ऑफ़ गई");
});

test("DEVICE_VERSIONS — असली खाता अपनी हाज़िरी लिखे; anonymous नहीं; अनजाना field नहीं", async () => {
  const ping = { v: "9.213", hq: HQS[3], role: "lineman", name: "जांच", t: Date.now() };
  assert.ok(await canWrite("DEVICE_VERSIONS/dev1", lineman(HQS[3]), ping));
  assert.ok(!(await canWrite("DEVICE_VERSIONS/dev2", ANON, ping)));
  assert.ok(!(await canWrite("DEVICE_VERSIONS/dev3", lineman(HQS[3]), Object.assign({ extra: "x" }, ping))));
  assert.ok(!(await canRead("DEVICE_VERSIONS", lineman(HQS[3]))), "लाइनमैन ने सबकी हाज़िरी पढ़ ली");
});

test("PROFILE_PHOTOS — लाइनमैन सिर्फ़ अपने HQ वाली key पर फ़ोटो रखे", async () => {
  const hq = HQS[4], other = HQS[5];
  const photo = { photo: "data:image/jpeg;base64,AAAA", name: "जांच", role: "lineman", hq };
  assert.ok(await canWrite("PROFILE_PHOTOS/" + hq + "_जांच", lineman(hq), photo));
  assert.ok(!(await canWrite("PROFILE_PHOTOS/" + other + "_जांच", lineman(hq), photo)));
});

test("अनजाना ऊपरी रास्ता ($other) — किसी के लिए नहीं, JE के लिए भी नहीं", async () => {
  for (const u of [lineman(HQS[0]), ANON, JE]) {
    assert.ok(!(await canWrite("कुछ_नया/x", u, { a: "1" })), "अनजाने रास्ते पर लिखा गया");
  }
});

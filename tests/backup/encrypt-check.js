// ── बैकअप के ताले (scripts/encrypt-backup.py) की जांच ──
// repo public है — साप्ताहिक बैकअप की Excel बिना ताले के artifact में चली गई तो उपभोक्ताओं के नाम/मोबाइल/
// पते कोई भी उतार सकता है (12/10/2026 को पकड़ा गया)। पहले इस ताले का कोई टेस्ट नहीं था — टूटता तो पता
// रविवार रात के बैकअप पर ही चलता। यहां वही script असली जैसी Excel (SheetJS, backup.js वाली ही library) पर:
//   - पासवर्ड न हो → नाकाम (exit 1) और सादी फ़ाइल मिट जाए
//   - पासवर्ड हो → फ़ाइल तालाबंद (अंदर नाम/मोबाइल पढ़ने में न आएं), सही पासवर्ड से वही डेटा लौटे, ग़लत से नहीं
// चलाना: npm run test:backup   (python3 + msoffcrypto-tool 5.4.2 चाहिए; CI में "backup-lock" job)
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const PY = process.env.PYTHON || "python3";
const XLSX = require(path.join(ROOT, "vendor", "xlsx.full.min.js"));
if (XLSX.set_fs) XLSX.set_fs(fs); // ऐप वाली browser-प्रति को node में फ़ाइल लिखने-पढ़ने देना
const MOBILE = "9876501234";

function sample(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["नाम", "Mobile"], ["रामलाल पटेल", MOBILE]]), "सारांश");
  const f = path.join(dir, "ADEGAON_backup_test.xlsx");
  XLSX.writeFile(wb, f);
  return f;
}
function run(dir, pw) {
  const env = Object.assign({}, process.env);
  delete env.BACKUP_PASSWORD;
  if (pw) env.BACKUP_PASSWORD = pw;
  return spawnSync(PY, [path.join(ROOT, "scripts", "encrypt-backup.py"), dir], { env, encoding: "utf8" });
}
function decrypt(file, pw) {
  const code = "import sys,msoffcrypto\nf=msoffcrypto.OfficeFile(open(sys.argv[1],'rb'))\nf.load_key(password=sys.argv[2])\nf.decrypt(open(sys.argv[3],'wb'))";
  const out = file + ".dec.xlsx";
  const r = spawnSync(PY, ["-c", code, file, pw, out], { encoding: "utf8" });
  return r.status === 0 ? out : null;
}

test("पासवर्ड (secret) न हो — बैकअप नाकाम हो और सादी फ़ाइल मिट जाए", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-"));
  sample(dir);
  const r = run(dir, "");
  assert.strictEqual(r.status, 1, r.stderr);
  assert.match(r.stderr, /BACKUP_PASSWORD/);
  assert.deepStrictEqual(fs.readdirSync(dir), [], "बिना ताले की फ़ाइल बची रह गई");
});

test("पासवर्ड हो — तालाबंद फ़ाइल; अंदर मोबाइल पढ़ने में न आए; सही पासवर्ड से वही डेटा, ग़लत से नहीं", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-"));
  const f = sample(dir);
  const r = run(dir, "जांच पासवर्ड 123");
  assert.strictEqual(r.status, 0, r.stderr);
  const bytes = fs.readFileSync(f);
  assert.strictEqual(bytes.subarray(0, 8).toString("hex"), "d0cf11e0a1b11ae1", "फ़ाइल Office के ताले वाले रूप में नहीं");
  assert.ok(!bytes.includes(Buffer.from(MOBILE)), "तालाबंद फ़ाइल में मोबाइल नंबर सादा दिखा");
  assert.ok(!fs.readdirSync(dir).some((n) => n.endsWith(".locked")), "बीच की फ़ाइल बची रह गई");
  const ok = decrypt(f, "जांच पासवर्ड 123");
  assert.ok(ok, "सही पासवर्ड से नहीं खुली");
  const rows = XLSX.utils.sheet_to_json(XLSX.readFile(ok).Sheets["सारांश"], { header: 1 });
  assert.deepStrictEqual(rows[1], ["रामलाल पटेल", MOBILE]);
  assert.strictEqual(decrypt(f, "ग़लत"), null, "ग़लत पासवर्ड से खुल गई");
});

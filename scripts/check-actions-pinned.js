#!/usr/bin/env node
// ── Security (JE 25/10): GitHub Actions के बाहरी actions पक्के commit SHA से ──
// "actions/checkout@v7" जैसा tag बाद में किसी और commit पर खिसकाया जा सकता है — उस action के repo में
// कोई सेंध लगे तो हमारे workflows में चलकर FIREBASE_SERVICE_ACCOUNT जैसे secrets चुरा सकता है।
// 40 अक्षर का SHA बदला नहीं जा सकता। यह जांच हर workflow की हर "uses:" देखती है (CI lint job में)।
// नया action जोड़ें तो: git ls-remote https://github.com/<owner>/<repo> refs/tags/<tag> से SHA लें,
// और "uses: owner/repo@<sha> # <tag>" लिखें
const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", ".github", "workflows");
const bad = [];
let n = 0;
for (const f of fs.readdirSync(dir).filter((x) => /\.ya?ml$/.test(x))) {
  fs.readFileSync(path.join(dir, f), "utf8").split("\n").forEach((line, i) => {
    const m = /^\s*-?\s*uses:\s*([^\s#]+)/.exec(line);
    if (!m) return;
    n++;
    const ref = m[1];
    if (ref.startsWith("./")) return; // इसी repo का action
    if (!/@[0-9a-f]{40}$/.test(ref)) bad.push(f + ":" + (i + 1) + "  " + ref);
  });
}
if (bad.length) {
  console.error("❌ ये actions पक्के commit SHA से नहीं जुड़े (tag खिसक सकता है):\n  " + bad.join("\n  "));
  process.exit(1);
}
console.log("✅ सभी " + n + " actions commit SHA से जुड़े हैं");

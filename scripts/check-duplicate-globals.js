// हर js/*.js फ़ाइल global scope share करती है (कोई build step/module system नहीं, सीधे <script>
// tags) — अगर दो फ़ाइलें ग़लती से एक ही नाम का top-level function/variable declare कर दें, तो
// दूसरी वाली चुपचाप पहली को overwrite कर देती है। कोई compile-time error नहीं आता, bug सिर्फ़
// runtime पर (शायद किसी एक ही screen पर) दिखता है। यह स्क्रिप्ट हर PR पर ऐसे टकराव को पहले ही
// पकड़ लेती है — gen-eslint-globals.js जो नाम इकट्ठा करता है, उन्हीं में से किसी को एक से
// ज़्यादा फ़ाइल में declare होता देख ले तो fail हो जाती है।
// चलाएं: node scripts/check-duplicate-globals.js
const fs = require("fs");
const path = require("path");
const espree = require("espree");

const jsDir = path.join(__dirname, "..", "js");
const declaredIn = new Map(); // name -> [files]

for (const f of fs.readdirSync(jsDir).filter((n) => n.endsWith(".js"))) {
  const src = fs.readFileSync(path.join(jsDir, f), "utf8");
  const ast = espree.parse(src, { ecmaVersion: 2021, sourceType: "script" });
  for (const node of ast.body) {
    let name = null;
    if (node.type === "VariableDeclaration") {
      node.declarations.forEach((d) => {
        if (d.id.type === "Identifier") {
          if (!declaredIn.has(d.id.name)) declaredIn.set(d.id.name, []);
          declaredIn.get(d.id.name).push(f);
        }
      });
      continue;
    } else if (node.type === "FunctionDeclaration" && node.id) {
      name = node.id.name;
    }
    if (name) {
      if (!declaredIn.has(name)) declaredIn.set(name, []);
      declaredIn.get(name).push(f);
    }
  }
}

const dupes = [...declaredIn.entries()].filter(([, files]) => files.length > 1);

if (dupes.length) {
  console.error("❌ Global नाम टकराव मिला — एक ही नाम एक से ज़्यादा js/*.js फ़ाइल में declare हुआ है (दूसरी वाली पहली को चुपचाप overwrite कर देगी):\n");
  dupes.forEach(([name, files]) => console.error(`  ${name} — ${files.join(", ")}`));
  process.exit(1);
}
console.log("✅ Global नाम टकराव जांच पास — कोई भी नाम एक से ज़्यादा फ़ाइल में declare नहीं हुआ");

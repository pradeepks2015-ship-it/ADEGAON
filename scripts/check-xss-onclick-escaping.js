// onclick="fn('...')" जैसे HTML attribute के अंदर escHtml() का इस्तेमाल ग़लत है — वो सिर्फ़
// & < > " escape करता है, सिंगल-कोट (') नहीं। अगर account/नाम/फ़ोन में कभी ' आ जाए तो onclick
// की JS string समय से पहले बंद होकर बाक़ी हिस्सा असली JS code की तरह चल सकती है (देखें js/list.js
// का escJsAttr — यही सही तरीक़ा है)। यह असली bug PR #114 में मिला और ठीक हुआ; अब हर PR पर यह
// स्क्रिप्ट js/*.js में यही ग़लत पैटर्न दोबारा न आए यह पक्का करती है।
// चलाएं: node scripts/check-xss-onclick-escaping.js
const fs = require("fs");
const path = require("path");

const jsDir = path.join(__dirname, "..", "js");
const onclickRe = /onclick=\\"[\s\S]*?\\"/g;
const problems = [];

for (const f of fs.readdirSync(jsDir).filter((n) => n.endsWith(".js"))) {
  const src = fs.readFileSync(path.join(jsDir, f), "utf8");
  let m;
  onclickRe.lastIndex = 0;
  while ((m = onclickRe.exec(src))) {
    const span = m[0];
    if (/escHtml\(/.test(span)) {
      const line = src.slice(0, m.index).split("\n").length;
      problems.push(`${f}:${line} — onclick attribute में escHtml() मिला, escJsAttr() होना चाहिए (सिंगल-कोट escape नहीं होता):\n    ${span}`);
    }
  }
}

if (problems.length) {
  console.error('❌ XSS check नाकाम — onclick="...(\'...\')" attribute में escHtml() (ग़लत) मिला, escJsAttr() (सही) होना चाहिए:\n');
  problems.forEach((p) => console.error(p + "\n"));
  process.exit(1);
}
console.log("✅ XSS check पास — कोई onclick attribute escHtml() ग़लत तरीक़े से इस्तेमाल नहीं कर रहा");

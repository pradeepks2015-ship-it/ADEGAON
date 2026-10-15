// v9.230: बाहर (gstatic) से आने वाली Firebase की हर script पर integrity (SRI) — जांच
// index.html की हर बाहरी <script src="https://…"> पर integrity="sha384-…" और crossorigin होना ज़रूरी।
// ब्राउज़र उतरी फ़ाइल का hash मिलाता है; Google की फ़ाइल (या रास्ते में कोई) बदल दे तो script चलती ही नहीं।
// इसलिए hash ग़लत लिखा = पूरे ऐप में Firebase बंद — वही ग़लती merge से पहले यहीं पकड़नी है:
//   node scripts/check-sri.js            → बनावट + sw.js के CORE में वही पते + .e2e-sdk/ (npm की प्रति) हो तो उससे hash
//   node scripts/check-sri.js --online   → असली gstatic से फ़ाइल उतारकर hash मिलाना (CI lint job; यहां sandbox से
//                                          gstatic बंद है, इसलिए सिर्फ़ CI में)
// Firebase version बदलें तो नया hash: npm pack firebase@<ver> से तीनों फ़ाइलें (scripts/fetch-firebase-sdk.js) →
//   openssl dgst -sha384 -binary <फ़ाइल> | base64
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const online = process.argv.includes('--online');
const errs = [];

const tags = html.match(/<script\b[^>]*\bsrc=["']https?:\/\/[^>]*>/g) || [];
if (!tags.length) errs.push('index.html में कोई बाहरी script नहीं मिली — यह जांच पुरानी तो नहीं?');
const list = tags.map((t) => {
  const src = (/\bsrc=["']([^"']+)/.exec(t) || [])[1];
  const integ = (/\bintegrity=["']([^"']+)/.exec(t) || [])[1];
  if (!integ || !/^sha(256|384|512)-[A-Za-z0-9+/]+=*$/.test(integ)) errs.push(src + ': integrity="sha384-…" नहीं');
  if (!/\bcrossorigin=["']anonymous["']/.test(t)) errs.push(src + ': crossorigin="anonymous" नहीं (इसके बिना SRI काम नहीं करता)');
  if (sw.indexOf('"' + src + '"') === -1) errs.push(src + ': sw.js के CORE में यही पता नहीं');
  return { src, integ };
});

function hashOf(buf, integ) {
  const algo = integ.split('-')[0];
  return algo + '-' + crypto.createHash(algo).update(buf).digest('base64');
}

(async () => {
  for (const { src, integ } of list) {
    if (!integ) continue;
    const local = path.join(ROOT, '.e2e-sdk', src.split('/').pop());
    const ver = (/firebasejs\/([\d.]+)\//.exec(src) || [])[1];
    const stamp = path.join(ROOT, '.e2e-sdk', 'VERSION');
    if (fs.existsSync(local) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === ver) {
      const h = hashOf(fs.readFileSync(local), integ);
      if (h !== integ) errs.push(src + ': npm वाली प्रति का hash ' + h + ' — index.html में ' + integ);
      else console.log('✓ npm प्रति  ' + src.split('/').pop());
    }
    if (online) {
      const r = await fetch(src);
      if (!r.ok) { errs.push(src + ': उतरी नहीं (HTTP ' + r.status + ')'); continue; }
      const h = hashOf(Buffer.from(await r.arrayBuffer()), integ);
      if (h !== integ) errs.push(src + ': असली फ़ाइल का hash ' + h + ' — index.html में ' + integ);
      else console.log('✓ gstatic    ' + src.split('/').pop());
    }
  }
  if (errs.length) {
    console.error('SRI जांच फेल:\n  ' + errs.join('\n  '));
    process.exit(1);
  }
  console.log('SRI ठीक — ' + list.length + ' बाहरी script' + (online ? ' (असली gstatic से मिलान)' : ''));
})().catch((e) => { console.error(e); process.exit(1); });

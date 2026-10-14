// e2e टेस्ट (tests/e2e-firebase.spec.js) के लिए Firebase की browser library — वही version जो index.html
// gstatic से लेता है, npm registry से सिर्फ़ 3 तैयार फ़ाइलें .e2e-sdk/ में। पूरा "firebase" npm package
// devDependency नहीं बनाया: उसके साथ node वाले हिस्से (undici, protobufjs…) आते हैं जिन पर npm audit "high"
// देता है (14/10/2026, CI lint job) — जबकि ऐप/टेस्ट उन्हें कभी इस्तेमाल नहीं करते
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '.e2e-sdk');
const FILES = ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-app-check-compat.js'];
const ver = /firebasejs\/([\d.]+)\/firebase-app-compat/.exec(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'))[1];

const stamp = path.join(OUT, 'VERSION');
if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === ver && FILES.every((f) => fs.existsSync(path.join(OUT, f)))) {
  console.log('Firebase SDK ' + ver + ' पहले से .e2e-sdk/ में');
  process.exit(0);
}
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const tgz = execFileSync('npm', ['pack', 'firebase@' + ver, '--pack-destination', OUT, '--silent'], { encoding: 'utf8' }).trim().split('\n').pop();
execFileSync('tar', ['-xzf', path.join(OUT, tgz), '-C', OUT, '--strip-components=1'].concat(FILES.map((f) => 'package/' + f)));
fs.rmSync(path.join(OUT, tgz));
fs.writeFileSync(stamp, ver);
console.log('Firebase SDK ' + ver + ' → .e2e-sdk/ (' + FILES.join(', ') + ')');

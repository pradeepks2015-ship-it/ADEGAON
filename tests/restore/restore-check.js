// ── बैकअप से रिमार्क वापसी (scripts/restore-remarks.js) की जांच ──
// असली डेटा पर लिखने वाला काम — इसलिए नियम यहां पक्के: सिर्फ़ जोड़ना, आज का कुछ न मिटे/बदले, दोबारा न जुड़े,
// वसूली/राशि/ts न छुए, आज सूची में न हो तो छोड़े, array और per-record दोनों रूप।
// चलाना: npm run test:restore   (CI lint job में भी)
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { parseRemarkCell, sheetRemarks, planList, bkSheetName } = require(path.join(__dirname, '..', '..', 'scripts', 'restore-remarks.js'));

test('बैकअप का रिमार्क खाना पढ़ना — "text (by) | text (by)", text में कोष्ठक भी', () => {
  assert.deepStrictEqual(parseRemarkCell('घर पर नहीं (Vaibhav) | बिना नाम'), [{ text: 'घर पर नहीं', by: 'Vaibhav' }, { text: 'बिना नाम', by: '' }]);
  assert.deepStrictEqual(parseRemarkCell('मीटर ख़राब (कल देखा) (Satyam)'), [{ text: 'मीटर ख़राब (कल देखा)', by: 'Satyam' }]);
  // नाम में ही कोष्ठक — नाम अलग नहीं हो पाता, पूरा text बनता है (दोबारा जुड़ने से बचाव नीचे text-मिलान में)
  assert.deepStrictEqual(parseRemarkCell('वादा (राम (पाटन))'), [{ text: 'वादा (राम (पाटन))', by: '' }]);
  assert.deepStrictEqual(parseRemarkCell(''), []);
  assert.deepStrictEqual(parseRemarkCell(null), []);
});

test('sheet → Consumer No वार रिमार्क (ख़ाली छोड़े, संख्या वाला Consumer No भी)', () => {
  const rows = [['क्र.', 'नाम', 'Consumer No', 'रिमार्क (सभी)'], [1, 'अ', 1134007169, 'घर बंद (V)'], [2, 'ब', '9001', ''], [3, 'स', '', 'x (y)']];
  assert.deepStrictEqual(sheetRemarks(rows), { 1134007169: [{ text: 'घर बंद', by: 'V' }] });
  assert.deepStrictEqual(sheetRemarks([['बिना', 'सही', 'कॉलम']]), {});
});

test('योजना: ख़ाली रिमार्क वाले में बैकअप जुड़े; आज वाला पहले से हो तो दोबारा नहीं; आज का कुछ न मिटे', () => {
  const server = {
    1134007169: { acc: '1134007169', name: 'MAHENDRA', amount: 5120, status: 'pending', ts: 77 },
    9001: { acc: '9001', remarksArr: [{ text: 'नया आज का', by: 'JE', at: '15/10' }], remarks: 'नया आज का', ts: 5 },
    9002: { acc: '9002', remarksArr: [{ text: 'घर बंद', by: 'V', at: '10/10' }] },
  };
  const backup = {
    1134007169: [{ text: 'घर पर नहीं', by: 'Vaibhav' }, { text: 'घर पर नहीं', by: 'Vaibhav' }],
    9001: [{ text: 'पुराना', by: 'Satyam' }],
    9002: [{ text: 'घर बंद', by: 'V' }],
    5555: [{ text: 'हट चुका उपभोक्ता', by: 'X' }],
  };
  const p = planList(backup, server, 'कुल उपभोक्ता', '2026-10-12');
  assert.deepStrictEqual([p.recs, p.entries, p.gone], [2, 2, 1]);
  assert.deepStrictEqual(Object.keys(p.patch).sort(), ['1134007169/remarks', '1134007169/remarksArr', '9001/remarks', '9001/remarksArr']);
  assert.deepStrictEqual(p.patch['1134007169/remarksArr'], [{ text: 'घर पर नहीं', by: 'Vaibhav', at: 'बैकअप 2026-10-12', cat: 'कुल उपभोक्ता', restored: 'backup-2026-10-12' }]);
  // आज वाला बचा, सबसे नया आख़िर में, "remarks" आज वाला ही
  assert.deepStrictEqual(p.patch['9001/remarksArr'].map((r) => r.text), ['पुराना', 'नया आज का']);
  assert.strictEqual(p.patch['9001/remarks'], 'नया आज का');
  // वसूली/राशि/स्थिति/ts कभी नहीं
  assert.ok(Object.keys(p.patch).every((k) => /\/(remarksArr|remarks)$/.test(k)));
});

test('वही बात आज किसी और नाम से हो तब भी दोबारा नहीं', () => {
  const p = planList({ 3: [{ text: 'घर बंद', by: 'V' }] }, { 3: { acc: '3', remarksArr: [{ text: 'घर बंद', by: 'दूसरा' }] } }, 'घरेलू', 't');
  assert.strictEqual(p.recs, 0);
});

test('दूसरी बार चलाएं तो कुछ नहीं (जो लौट चुके वो दोबारा नहीं)', () => {
  const server = { 7: { acc: '7' } };
  const backup = { 7: [{ text: 'अ', by: 'ब' }] };
  const first = planList(backup, server, 'घरेलू', '2026-10-12');
  server[7].remarksArr = first.patch['7/remarksArr'];
  assert.strictEqual(planList(backup, server, 'घरेलू', '2026-10-12').recs, 0);
});

test('पुराना array रूप और remarksArr object रूप भी; ख़ाली/बिगड़ा सर्वर डेटा से न टूटे', () => {
  const arr = [{ acc: '11', remarksArr: { a: { text: 'x', by: 'y' } } }, null, { acc: '12' }];
  const p = planList({ 11: [{ text: 'x', by: 'y' }, { text: 'z', by: 'y' }], 12: [{ text: 'q', by: 'w' }] }, arr, 'कृषि', 't');
  assert.deepStrictEqual(Object.keys(p.patch).sort(), ['0/remarks', '0/remarksArr', '2/remarks', '2/remarksArr']);
  assert.deepStrictEqual(p.patch['0/remarksArr'].map((r) => r.text), ['z', 'x']);
  assert.deepStrictEqual(planList({ 1: [{ text: 'a', by: 'b' }] }, null, 'c', 't'), { patch: {}, recs: 0, entries: 0, gone: 1 });
});

test('sheet नाम backup.js जैसा (31 अक्षर, : / आदि बदले)', () => {
  assert.strictEqual(bkSheetName('पाटन_कुल उपभोक्ता'), 'पाटन_कुल उपभोक्ता');
  assert.strictEqual(bkSheetName('a/b:c'), 'a_b_c');
  assert.strictEqual(bkSheetName('x'.repeat(40)).length, 31);
});

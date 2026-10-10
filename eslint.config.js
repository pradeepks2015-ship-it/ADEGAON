// वसूली ट्रैकर — कोई build step/framework नहीं, सभी js/*.js फाइलें एक ही global scope
// शेयर करती हैं (index.html में एक-एक करके <script> से लोड होती हैं) और ज़्यादातर टॉप-लेवल
// function index.html के inline onclick="" से बुलाए जाते हैं — इसलिए no-unused-vars सिर्फ़
// function के अंदर वाले local variables पर लागू है, टॉप-लेवल पर नहीं।
const js = require("@eslint/js");
const globals = require("globals");
const noUnsanitized = require("eslint-plugin-no-unsanitized");

// js/*.js में परिभाषित सभी टॉप-लेवल var/function — बाकी फाइलों में इस्तेमाल होते हैं
const sharedGlobals = require("./eslint.shared-globals.json");

module.exports = [
  js.configs.recommended,
  {
    files: ["eslint.config.js"],
    languageOptions: { sourceType: "commonjs", ecmaVersion: 2021, globals: { ...globals.node } },
  },
  {
    files: ["js/**/*.js"],
    plugins: { "no-unsanitized": noUnsanitized },
    languageOptions: {
      sourceType: "script",
      ecmaVersion: 2021,
      globals: {
        ...globals.browser,
        ...Object.fromEntries(sharedGlobals.map((g) => [g, "writable"])),
        XLSX: "readonly",
        Papa: "readonly",
        firebase: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { vars: "local", args: "none", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-prototype-builtins": "off",
      "no-useless-escape": "off",
      "no-misleading-character-class": "off", // ऀ-ॿ जैसी Devanagari Unicode range जान-बूझकर है
      // हर global यहीं परिभाषित भी होता है — ESLint को हर definition site पर "redeclare"
      // जैसा लगता है, जबकि यह इस no-build-step, multi-file shared-namespace architecture
      // का सामान्य पैटर्न है, कोई असली बग नहीं
      "no-redeclare": "off",
      // innerHTML/document.write में कोई भी field escHtml()/escJsAttr() से गुज़रे बिना सीधे न जाए —
      // भविष्य में कोई नया field जोड़ते समय escHtml लगाना भूल जाए तो यह तुरंत पकड़ ले (जैसे बग
      // reports.js/upload.js में मैनुअल ऑडिट से मिला था)। यह .map().join("") जैसे pattern के अंदर
      // की escHtml() calls नहीं देख पाता — वहां हर जगह मैनुअली जांचकर eslint-disable-next-line लगाया
      // गया है, कारण के साथ।
      "no-unsanitized/method": ["error", { escape: { methods: ["escHtml", "escJsAttr"] } }],
      "no-unsanitized/property": ["error", { escape: { methods: ["escHtml", "escJsAttr"] } }],
      // ── कोड-गुणवत्ता कदम 2 (10/10, v9.197): असली bug पकड़ने वाले नियम ──
      // चालू करते वक़्त इन सब में ग़लतियां 0 थीं — यानी कोई कोड नहीं बदला, बस आगे कोई ऐसी ग़लती
      // जुड़े तो CI तुरंत रोक दे। जान-बूझकर छोड़े: no-var (1288 जगह, सिर्फ़ शैली), no-implicit-coercion
      // (+x जैसा जान-बूझकर), consistent-return (13 जगह — बदलने में व्यवहार बदलने का जोखिम), no-shadow
      // (3 जगह, अलग-अलग function में एक ही नाम — हानिरहित)
      eqeqeq: ["error", "smart"],                  // == सिर्फ़ null के साथ (x==null), बाक़ी हर जगह ===
      "no-self-compare": "error",                  // x===x जैसी टाइपो
      "no-constant-binary-expression": "error",    // a||{} === b जैसी हमेशा-एक-जैसी शर्त
      "no-unreachable-loop": "error",
      "no-unmodified-loop-condition": "error",     // कभी न रुकने वाला loop
      "no-dupe-else-if": "error",
      "no-template-curly-in-string": "error",      // "${x}" — backtick भूल गए
      "no-promise-executor-return": "error",
      "array-callback-return": "error",            // .map/.filter में return भूलना
      "no-return-assign": "error",
      "no-sequences": "error",
      "no-throw-literal": "error",                 // throw "x" — stack/लॉग खो जाता है
      "no-unused-expressions": ["error", { allowShortCircuit: true, allowTernary: true }],
      "default-case-last": "error",
    },
  },
  {
    files: ["scripts/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      ecmaVersion: 2021,
      globals: { ...globals.node },
    },
    rules: {
      "no-useless-escape": "off",
    },
  },
  {
    // page.evaluate(() => {...}) के अंदर browser-context कोड भी इसी फाइल में है, जो app के
    // global variables/functions इस्तेमाल करता है — इसलिए वही sharedGlobals यहां भी चाहिए
    files: ["tests/**/*.js", "playwright.config.js"],
    languageOptions: {
      sourceType: "commonjs",
      ecmaVersion: 2021,
      globals: {
        ...globals.node,
        ...globals.browser,
        ...Object.fromEntries(sharedGlobals.map((g) => [g, "writable"])),
        XLSX: "writable",
        Papa: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { vars: "local", args: "none", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-redeclare": "off",
    },
  },
];

// ── type-जांच (tsc --checkJs, कोड-गुणवत्ता कदम 3) के लिए जानकारी — ऐप में नहीं जाती, सिर्फ़ CI जांच ──

// बाहरी libraries जो <script> से global बनकर आती हैं (Firebase CDN, vendor/xlsx, vendor/papaparse)
declare var firebase: any;
declare var XLSX: any;
declare var Papa: any;
declare var grecaptcha: any;

// document.getElementById() हमेशा सादा HTMLElement बताता है, जबकि हमारे कोड में वह input/select/a
// होता है — हर जगह cast लिखने के बजाय यहां एक बार बता देते हैं कि ये गुण हो सकते हैं
interface HTMLElement {
  value: any;
  checked: boolean;
  href: string;
  max: any;
  type: string;
  files: FileList | null;
  src: string;
  disabled: boolean;
  /** toast का टाइमर (js/ui-core.js) */
  _t: any;
}
interface Element {
  dataset: DOMStringMap;
  style: CSSStyleDeclaration;
}
interface Window {
  /** पुराने Safari/Android WebView का AudioContext (js/celebration.js) */
  webkitAudioContext: typeof AudioContext;
  [key: string]: any;
}

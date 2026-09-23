var HQS = ["आदेगांव","पिंडरई","जोबा","पाटन","बीबी","मढ़ी"];
var CATS = ["कुल उपभोक्ता","घरेलू","व्यवसाय","कृषि","गवर्नमेंट","इंडस्ट्रियल","सूची-2","सूची-3"];
var CICO = ["👥","🏠","🏪","🌾","🏛️","🏭","📋","📌"];
// JE का पासवर्ड अब code में नहीं — Firebase Authentication से verify होता है (देखें ui-core.js: verifyJE)
var JE_EMAIL = "pradeepks2015@gmail.com";
// हर HQ का अपना असली (गुमनाम नहीं) Firebase account — Security Rules अब सिर्फ़ इसी HQ के account
// (या JE) को उस HQ का data पढ़ने/लिखने देती हैं। password नहीं है यहां — वो लाइनमैन के टाइप किए
// PIN से बनता है (देखें ui-core.js: _hqAuthPassword), ताकि कोड में कोई असली secret न रहे।
var HQ_AUTH_EMAIL = {
  "आदेगांव":"hq-adegaon@adegaondc.internal",
  "पिंडरई":"hq-pindrai@adegaondc.internal",
  "जोबा":"hq-joba@adegaondc.internal",
  "पाटन":"hq-patan@adegaondc.internal",
  "बीबी":"hq-bibi@adegaondc.internal",
  "मढ़ी":"hq-madhi@adegaondc.internal"
};
var APP_VER = "9.158"; // हर अपडेट पर यह नंबर बढ़ाएं
document.getElementById("ver-badge").textContent="Version "+APP_VER+" • Offline + Auto Sync";
var MAX_RECORDS = 1000;
// Per-category limits: "कुल उपभोक्ता"=3500, others=1000
function getMaxRecords(cat){
  if(!cat) return MAX_RECORDS;
  if(cat==="कुल उपभोक्ता") return 3500;
  return 1000;
}
// ── CAT_NAMES System ─────────────────────────────────────────
// Firebase path: /CAT_NAMES/{HQ_key}/{cat_index} = "नाम"
// पहले सिर्फ़ 4-7 बदले जा सकते थे। JE ने घरेलू/व्यवसाय/कृषि भी बदलने लायक चाहे, इसलिए अब 1 से
// आगे सब बदले जा सकते हैं। सिर्फ़ 0 (कुल उपभोक्ता) बाहर है — वह मास्टर सूची है जिस पर गाँव-वार
// गिनती, स्कोरकार्ड और acc-dedup सब टिके हैं (कोड में हर जगह सीधे CATS[0] लिखा है)।
// ध्यान: नाम बदलना = Firebase पर डेटा का पता बदलना (fbPath नाम से ही बनता है) — इसीलिए
// openEditCat अब renameCatData() से पूरा डेटा नए पते पर ले जाता है, देखें js/database.js
var CATS_DEFAULT = ["कुल उपभोक्ता","घरेलू","व्यवसाय","कृषि","गवर्नमेंट","इंडस्ट्रियल","सूची-2","सूची-3"];
var CAT_NAMES = {}; // {HQ: {4:"नाम", 5:"नाम", 6:"नाम", 7:"नाम"}}

function hqKey(hq){ return (hq||activeHQ).replace(/[\s.#$\[\]\/]/g,"_"); }
function catKey(cat){ return (cat||"").replace(/[\s.#$\[\]\/]/g,"_"); }
function isCatEditable(i){ return i>=1; }

function getCatName(hq,i){
  return (CAT_NAMES[hq]&&CAT_NAMES[hq][i]!=null) ? CAT_NAMES[hq][i] : CATS_DEFAULT[i];
}

function rebuildCatsForHQ(hq){
  if(!hq) hq=activeHQ;
  for(var i=0;i<CATS_DEFAULT.length;i++){
    CATS[i] = isCatEditable(i) ? getCatName(hq,i) : CATS_DEFAULT[i];
  }
}

function saveCatNames(){
  try{localStorage.setItem("dc_catnames3",JSON.stringify(CAT_NAMES));}catch(e){}
}

function applyFBCatNames(d){
  if(!d||typeof d!=="object") return false;
  var changed=false;
  Object.keys(d).forEach(function(hk){
    var hq=HQS.find(function(h){return hqKey(h)===hk;})||hk;
    if(!CAT_NAMES[hq]) CAT_NAMES[hq]={};
    CATS_DEFAULT.forEach(function(_,i){
      if(!isCatEditable(i)) return;
      if(d[hk][i]!=null&&CAT_NAMES[hq][i]!==d[hk][i]){
        CAT_NAMES[hq][i]=d[hk][i]; changed=true;
      }
    });
  });
  return changed;
}

// Firebase REST API permission-denied जैसी errors भी valid JSON response देती हैं (जैसे
// {"error":"Permission denied"}), HTTP status भले ही 401/403 हो — पहले हम हर fetch के बाद बिना
// r.ok जांचे सीधे r.json() मानकर आगे बढ़ जाते थे, तो normList() उस error-object की value
// (एक साधारण string) को असली consumer record समझकर एक टूटा हुआ (₹NaN वाला, नाम-पता खाली)
// card बना देता था — असली bug यही था, सिर्फ़ rules की समस्या नहीं। अब हर जगह पहले HTTP
// status जांचते हैं; असफल हो तो वही रास्ता चलता है जो genuine network-failure के लिए पहले
// से बना है (हर fetch chain का catch handler)।
function _fbJson(r){
  if(!r.ok) throw new Error("HTTP "+r.status);
  return r.json();
}

function loadCatNames(){
  try{var s=localStorage.getItem("dc_catnames3");if(s)CAT_NAMES=JSON.parse(s);}catch(e){}
  fetchCatNamesFromFB(false);
}

function fetchCatNamesFromFB(showToast){
  fetch(FB+"/CAT_NAMES.json?t="+Date.now())
    .then(_fbJson)
    .then(function(d){
      trackUsageOf(d);
      var changed=applyFBCatNames(d);
      if(changed){
        saveCatNames();
        if(activeHQ) rebuildCatsForHQ(activeHQ);
        if(CU&&document.getElementById("app-screen").classList.contains("active")){
          buildCatTabs();
          if(showToast) toast("🔄 श्रेणी नाम अपडेट हुए","inf");
        }
      }
    }).catch(function(){});
}

// ── फोन-मॉडल का "अपना संदेश" — सिर्फ़ JE बदल सके, बदलते ही हर मुख्यालय के हर लाइनमैन को दिखे ──
// CAT_NAMES जैसा ही पैटर्न: छोटा shared value, JE-only write (database.rules.json), सब पढ़ सकें,
// localStorage में cache ताकि offline भी पिछला संदेश दिखता रहे (देखें js/reports.js)
var PH_CUSTOM_MSG = {text:"",by:"",at:""};
function loadPhCustomMsg(){
  try{var s=localStorage.getItem("dc_ph_custom_msg");if(s)PH_CUSTOM_MSG=JSON.parse(s);}catch(e){}
  fetchPhCustomMsgFromFB();
}
function fetchPhCustomMsgFromFB(){
  fetch(FB+"/PH_CUSTOM_MSG.json?t="+Date.now())
    .then(_fbJson)
    .then(function(d){
      trackUsageOf(d);
      if(!d||typeof d!=="object"||d.text==null) return;
      PH_CUSTOM_MSG={text:d.text,by:d.by||"",at:d.at||""};
      try{localStorage.setItem("dc_ph_custom_msg",JSON.stringify(PH_CUSTOM_MSG));}catch(e){}
      // फ़ोन मॉडल अभी "अपना संदेश" टैब पर खुली हो (JE दूसरे device से बदल दे, यह device उसी वक़्त
      // उसे देख रहा हो) तो तुरंत ताज़ा दिखे — _phRefreshCustomView, js/reports.js
      if(typeof _phRefreshCustomView==="function") _phRefreshCustomView();
    }).catch(function(){});
}
var CU = null, activeHQ = "", activeCat = "", activeFilter = "all";
var upMode = "merge", parsedRows = [], selectedRole = "", rmkStatus = "pending";
var pollTimer = null;

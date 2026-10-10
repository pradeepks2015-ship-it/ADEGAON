// ── Firebase डेटा: पढ़ना और बुनियाद (fbPath, ETag, normList, डेटा-बचाओ मोड, ढांचा, fbGet) ──
// कोड-गुणवत्ता कदम 4 (v9.199): पहले यह सब एक ही 1059 लाइन की database.js में था। अब तीन फ़ाइलें, उसी
// क्रम में लोड होती हैं (index.html/sw.js): यह → js/database-write.js (लिखना) → js/database-live.js (लाइव-sync)

// "/" भी यहां ज़रूरी है (सिर्फ़ .#$[] नहीं) — वरना कोई category-नाम जिसमें "/" हो (जैसे किसी JE ने
// "vig/O&m Cases" जैसा नाम रख दिया हो) असली path से एक स्तर नीचे नेस्टेड हो जाता है, जो Security
// Rules के ढांचे से मेल नहीं खाता और हमेशा के लिए permission-denied (401) देता रहता है — असली bug यही था
function fbPath(hq,cat){
  return hq.replace(/[\s.#$\[\]\/]/g,"_")+"/"+cat.replace(/[\s.#$\[\]\/]/g,"_");
}

// per-(hq+"/"+cat) ETag — Firebase 304 (खाली जवाब) देता है अगर data नहीं बदला, तो पूरा data दोबारा
// डाउनलोड करने की ज़रूरत नहीं। पहले यह सिर्फ़ JS memory में था, यानी ऐप बंद/minimize होते ही मिट जाता
// और अगली बार खुलने पर हर list फिर से पूरी डाउनलोड होती थी — मोबाइल पर ऐप दिन में कई बार मरता-खुलता
// है, इसलिए असल में यह बचत मिलती ही नहीं थी। अब localStorage में, cache के साथ-साथ।
// शर्त: ETag पर तभी भरोसा करें जब उसी key का cache भी मौजूद हो — वरना 304 आने पर हमारे पास न नया
// data होगा न पुराना (cache अलग से मिट सकता है, जैसे quota भरने पर)
var ETAG_KEY="dc_etag3";
function _etagAll(){try{return JSON.parse(localStorage.getItem(ETAG_KEY))||{};}catch(e){return {};}}
function _etagGet(hq,cat){
  if(!cGet(hq,cat).length) return null; // cache ही नहीं है — पूरा data मंगाना ही पड़ेगा
  return _etagAll()[hq+"/"+cat]||null;
}
function _etagSet(hq,cat,tag){
  if(!tag) return;
  var a=_etagAll(); a[hq+"/"+cat]=tag;
  try{localStorage.setItem(ETAG_KEY,JSON.stringify(a));}catch(e){}
}
// ETag भेजने वाले request के headers — एक ही जगह, ताकि हर caller एक जैसा व्यवहार करे
function _etagHeaders(hq,cat){
  var h={"X-Firebase-ETag":"true"};
  var t=_etagGet(hq,cat);
  if(t) h["if-none-match"]=t;
  return h;
}

// ── FORMAT NORMALIZER: server से आई लिस्ट को हमेशा एक जैसा array बनाओ ──
// पुराना ढांचा: array | नया (आने वाला) per-record ढांचा: object {IVRS: record}
// नए ढांचे में हर record का 'o' field उसका क्रम बताएगा — उसी से order बहाल होता है
// चरण 3 (per-record migration) में सिर्फ लिखने वाला code बदलेगा — पढ़ना यहीं से दोनों संभालता है
function normList(d){
  if(!d) return [];
  var arr=Array.isArray(d)?d.filter(Boolean):Object.keys(d).map(function(k){return d[k];}).filter(Boolean);
  arr=arr.map(migrateRemarks);
  var hasO=false;
  for(var i=0;i<arr.length;i++){ if(arr[i]&&arr[i].o!=null){hasO=true;break;} }
  if(hasO) arr.sort(function(a,b){return (Number(a&&a.o)||0)-(Number(b&&b.o)||0);});
  return arr;
}

// ── 🛑 डेटा बचाओ मोड (मास्टर स्विच) ────────────────────────────────────────────
// Firebase का no-cost download quota रोज़ 360 MB का है। किसी दिन वह भरता दिखे तो JE एक ही
// स्विच से सभी devices पर आगे का download रोक सकें — यह आपातकालीन ब्रेक है, रोज़ का हथियार नहीं।
//
// रुकता क्या है: live sync (SSE), prefetch, खुली list का background refresh, स्कोरकार्ड का
// ताज़ा data। चलता क्या रहता है: पूरी ऐप device के अपने cache से (यह ऐप वैसे भी offline-first
// है), और सबसे ज़रूरी — *वसूली दर्ज करना*। वह upload है, download quota में गिनता ही नहीं,
// इसलिए लाइनमैन का काम एक पल के लिए भी नहीं रुकता।
//
// स्विच पढ़ने का अपना खर्च: /PAUSE में बस {on:true/false} है। हर device इसे 5 मिनट में एक बार
// देखता है, और वह भी सिर्फ़ तब जब ऐप सामने खुली हो — background में पड़े device को कुछ पूछने की
// ज़रूरत ही नहीं, वह वैसे भी कुछ खर्च नहीं कर रहा। पूरे DC का दिन भर का हिसाब ~150 KB, यानी
// 360 MB का 0.04% — जो यह बचाता है उसके सामने कुछ भी नहीं।
var DATA_PAUSED=false;
var PAUSE_INFO=null;          // {on, by, at} — किसने, कब दबाया
var PAUSE_KEY="dc_paused";    // device पर याद, ताकि ऐप खुलते ही (जवाब आने से पहले भी) सही व्यवहार हो
var PAUSE_POLL_MS=5*60*1000;
var _pauseTimer=null;
function isDataPaused(){ return !!DATA_PAUSED; }
function loadPauseLocal(){
  try{
    var s=JSON.parse(localStorage.getItem(PAUSE_KEY));
    if(s&&typeof s==="object"){
      PAUSE_INFO=s.i||null;
      // device पर सहेजी हालत पर भी वही "आज तक" वाली शर्त लगती है — वरना कल का रुका हुआ स्विच
      // ऐप खुलते ही फिर से लागू हो जाता, जबकि quota तब तक रीसेट हो चुका होता है
      DATA_PAUSED=PAUSE_INFO?_pauseStillValid(PAUSE_INFO):!!s.on;
    }
  }catch(e){}
}
// स्विच अपने आप उसी दिन तक चलता है — आधी रात के बाद अपने आप हट जाता है।
// वजह दो हैं: (1) Firebase का quota वैसे भी रोज़ रीसेट होता है, तो कल इसे चालू रखने का कोई
// मतलब ही नहीं; (2) सबसे संभावित गड़बड़ी यही है कि JE शाम को दबाकर भूल जाएँ और पूरी टीम कई दिन
// पुराने डेटा पर चलती रहे। समय की तुलना serverNow() से होती है (device की घड़ी ग़लत हो सकती है)
function _pauseStillValid(d){
  if(!d||!d.on) return false;
  var at=Number(d.at)||0;
  if(!at) return true; // कब दबाया पता ही नहीं — भरोसा कर लो, चालू मानो
  var s=new Date(serverNow()); s.setHours(0,0,0,0);
  return at>=s.getTime(); // आज ही दबाया गया हो, तभी
}
function _applyPause(d){
  var on=_pauseStillValid(d);
  var was=DATA_PAUSED;
  DATA_PAUSED=on;
  PAUSE_INFO=(d&&typeof d==="object")?d:null;
  try{ localStorage.setItem(PAUSE_KEY,JSON.stringify({on:on,i:PAUSE_INFO})); }catch(e){}
  renderPauseBar();
  if(on===was) return;
  if(on){
    stopListen(); // सबसे बड़ा खर्च यही है — तुरंत बंद
  } else if(CU&&activeHQ&&activeCat){
    startListen(activeHQ,activeCat); // वापस चालू — जुड़ते ही ताज़ा data अपने आप आ जाता है
  }
}
function fetchPause(){
  if(!navigator.onLine) return;
  fetch(FB+"/PAUSE.json?t="+Date.now()).then(_fbJson).then(function(d){trackUsageOf(d);_applyPause(d);}).catch(function(){});
}
// सिर्फ़ तब पूछो जब ऐप सामने खुली हो — छुपे/बंद device को स्विच जानने की ज़रूरत ही नहीं
function startPausePoll(){
  if(_pauseTimer) return;
  _pauseTimer=setInterval(function(){
    if(document.hidden||!navigator.onLine) return;
    fetchPause();
  },PAUSE_POLL_MS);
}

// ── सर्वर पर लिस्ट किस रूप में है — flag नहीं, असली सबूत ───────────────────────────────────
// माइग्रेशन बार-बार पलटने की जड़ यह थी कि "पूरी array लिखूं या per-record object" का फ़ैसला पूरी
// तरह MIGRATED flag पर टिका था — और उस flag की दो बिल्कुल अलग हालतें कोड में एक जैसी (false)
// दिखती हैं:
//   (क) "यह श्रेणी सचमुच migrate नहीं हुई"      → array लिखना सही
//   (ख) "मुझे पता ही नहीं चला, flag लोड न हुआ"  → array लिखना विनाशकारी (माइग्रेशन पलट जाता है)
// यानी अनिश्चितता में कोड सबसे ख़तरनाक रास्ता चुनता था। (असली production: मढ़ी/कुल उपभोक्ता एक ही
// दिन में दो बार पलटी, जबकि सभी devices v9.117 पर थे — यानी "पुराना version" वाली वजह ग़लत थी।)
//
// अब flag के अलावा असली सबूत भी देखते हैं: ऐप हर बार लिस्ट पढ़ती ही है, तो उसी पढ़ाई से याद रख
// लेते हैं कि सर्वर पर वह लिस्ट array थी या object। पूरी array लिखने से पहले अगर आख़िरी बार object
// देखी थी, तो array कभी नहीं लिखते — चाहे flag कुछ भी कहे। इसके लिए एक भी नई network call नहीं।
var SHAPE_KEY="dc_shape3";
function _shapeAll(){ try{ return JSON.parse(localStorage.getItem(SHAPE_KEY))||{}; }catch(e){ return {}; } }
// हर बार जब सर्वर से कच्चा data मिले, उसका रूप दर्ज कर लें
function _noteShape(hq,cat,raw){
  if(raw==null||typeof raw!=="object") return; // खाली/अजीब — इससे कुछ नहीं कह सकते, पुरानी याद रहने दो
  var s=Array.isArray(raw)?"arr":"obj";
  var a=_shapeAll(), k=hq+"/"+cat;
  if(a[k]===s) return; // बदला नहीं — localStorage को बेवजह न छेड़ें
  a[k]=s;
  try{ localStorage.setItem(SHAPE_KEY,JSON.stringify(a)); }catch(e){}
}
function lastShape(hq,cat){ return _shapeAll()[hq+"/"+cat]||null; }
// श्रेणी का नाम बदलने पर device की तीनों यादें भी साथ चलें — वरना नए नाम की पहली पढ़ाई में
// ETag/shape दोनों अनजान रहते, और shape अनजान होने का मतलब है _fbPut का माइग्रेशन-बचाव अंधा
function _moveLocalKeys(hq,oldCat,newCat){
  try{
    var e=_etagAll(); if(e[hq+"/"+oldCat]!=null){ e[hq+"/"+newCat]=e[hq+"/"+oldCat]; delete e[hq+"/"+oldCat]; localStorage.setItem(ETAG_KEY,JSON.stringify(e)); }
  }catch(err){}
  try{
    var s=_shapeAll(); if(s[hq+"/"+oldCat]!=null){ s[hq+"/"+newCat]=s[hq+"/"+oldCat]; delete s[hq+"/"+oldCat]; localStorage.setItem(SHAPE_KEY,JSON.stringify(s)); }
  }catch(err2){}
}

// ── श्रेणी का नाम बदलना = Firebase पर उसका पता बदलना ─────────────────────────────────────────
// fbPath(hq,cat) श्रेणी के *नाम* से ही बनता है, इसलिए नाम बदलते ही डेटा का पता बदल जाता है।
// पहले rename सिर्फ़ device के cache और CAT_NAMES में होता था — सर्वर पर डेटा पुराने पते पर ही
// पड़ा रहता और नया पता खाली रहता। कुछ ही सेकंड में fbGet उस खाली पते से जवाब लाकर
// cSet(hq,cat,[]) कर देता, यानी सूची सबकी स्क्रीन से ग़ायब (डेटा Firebase पर बचा रहता, पर ऐप में
// कुछ न दिखता) और पुराना नोड हमेशा के लिए अनाथ पड़ा रह जाता। अब पूरा सामान साथ ले जाया जाता है।
//
// क्रम जान-बूझकर ऐसा है कि किसी भी क़दम पर रुक जाने से डेटा न मरे:
//   पढ़ो → नए पते पर लिखो → MIGRATED flag ले जाओ → *तब* पुराना हटाओ
// यानी बीच में नेट टूटे तो सबसे बुरी हालत यह है कि डेटा दोनों पतों पर है (दिखता रहेगा) —
// कभी किसी पते पर नहीं, ऐसा नहीं हो सकता
function renameCatData(hq,oldCat,newCat,cb){
  if(!navigator.onLine){ cb({ok:false,why:"offline"}); return; }
  fetch(FB+"/"+fbPath(hq,oldCat)+".json?t="+Date.now())
    .then(_fbJson)
    .then(function(raw){
      trackUsageOf(raw);
      var n=raw?(Array.isArray(raw)?raw.filter(Boolean).length:Object.keys(raw).length):0;
      if(!raw||!n){ // खाली श्रेणी — ले जाने को कुछ नहीं, सिर्फ़ नाम बदलेगा
        _moveLocalKeys(hq,oldCat,newCat);
        cb({ok:true,moved:0});
        return null;
      }
      _noteShape(hq,oldCat,raw);
      var wasObj=!Array.isArray(raw);
      return fetch(FB+"/"+fbPath(hq,newCat)+".json",{
        method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(raw)
      }).then(function(r){
        if(!r.ok) throw new Error("HTTP "+r.status);
        // MIGRATED flag भी नए नाम पर — वरना नए पते की per-record list "माइग्रेट नहीं हुई" मानी
        // जाती और पहली ही पूरी लिखाई उसे वापस array बना देती (वही पुराना पलटने वाला bug)
        if(!isMigrated(hq,oldCat)) return null;
        return fetch(FB+"/MIGRATED/"+hqKey(hq)+"/"+catKey(newCat)+".json",{
          method:"PUT",headers:{"Content-Type":"application/json"},body:"true"
        }).catch(function(){}); // सिर्फ़ JE लिख सकता है; न लिख पाए तो भी डेटा तो पहुँच ही चुका
      }).then(function(){
        // अब पुराना हटाना सुरक्षित है — डेटा नए पते पर पहुँच चुका
        return fetch(FB+"/"+fbPath(hq,oldCat)+".json",{method:"DELETE"}).catch(function(){});
      }).then(function(){
        if(isMigrated(hq,oldCat)){
          fetch(FB+"/MIGRATED/"+hqKey(hq)+"/"+catKey(oldCat)+".json",{method:"DELETE"}).catch(function(){});
          if(!MIGRATED[hqKey(hq)]) MIGRATED[hqKey(hq)]={};
          MIGRATED[hqKey(hq)][catKey(newCat)]=true;
          delete MIGRATED[hqKey(hq)][catKey(oldCat)];
          try{localStorage.setItem(MIG_FLAG_KEY,JSON.stringify(MIGRATED));}catch(e){}
        }
        _moveLocalKeys(hq,oldCat,newCat);
        _noteShape(hq,newCat,wasObj?{}:[]); // जो रूप भेजा वही अब सर्वर पर है
        cb({ok:true,moved:n});
      });
    })
    .catch(function(e){
      logErr("catrename-move",e,hq+"/"+oldCat+" → "+newCat);
      cb({ok:false,why:"net"});
    });
}
// नाम बदलने से पहले JE को गिनती दिखा सकें — सिर्फ़ गिनती चाहिए, पूरा data नहीं, इसलिए
// shallow=true: Firebase तब हर record की जगह सिर्फ़ {key:true} भेजता है (कहीं हल्का)
function catRecordCount(hq,cat,cb){
  if(!navigator.onLine){ cb(null); return; }
  fetch(FB+"/"+fbPath(hq,cat)+".json?shallow=true&t="+Date.now())
    .then(_fbJson)
    .then(function(d){
      trackUsageOf(d);
      cb(!d?0:(Array.isArray(d)?d.filter(Boolean).length:Object.keys(d).length));
    })
    .catch(function(){ cb(null); });
}

var FB_GET_TIMEOUT_MS=8000; // टेस्ट में छोटा करके तेज़ जांच की जा सकती है
function fbGet(hq,cat,cb){
  var cached=cGet(hq,cat);
  // pending offline बदलाव हैं तो server data से overwrite मत करो — पहले sync
  if(isPending(hq,cat)){
    cb(cached);
    if(navigator.onLine) flushPending();
    return;
  }
  if(cached.length){
    cb(cached); // तुरंत cache से दिखाएं — fast!
    if(isDataPaused()) return; // 🛑 डेटा बचाओ मोड — cache से दिखाया जा चुका, refresh नहीं करेंगे
    // background silent refresh — ETag भेजने पर अगर data नहीं बदला तो Firebase 304 देता है (खाली response,
    // पूरी list दोबारा नहीं) — list बार-बार खोलने पर bandwidth बचत; पहली बार ETag मिलता है, अगली बार भेजते हैं
    fetch(FB+"/"+fbPath(hq,cat)+".json?t="+Date.now(),{headers:_etagHeaders(hq,cat)})
      .then(function(r){
        if(r.status===304) return; // कुछ नहीं बदला — यहीं रुक जाओ (bandwidth बचत)
        if(!r.ok) throw new Error("HTTP "+r.status);
        var _tag=r.headers.get("ETag");
        return r.json().then(function(d){
          trackUsageOf(d);
          _noteShape(hq,cat,d);
          _checkMigrationRevert(hq,cat,d); // migrated list कहीं पुराने device ने वापस array में तो नहीं बदल दी
          var data=normList(d);
          overlayOps(hq,cat,data);
          var changed=JSON.stringify(data)!==JSON.stringify(cached);
          cSet(hq,cat,data);
          _etagSet(hq,cat,_tag); // cache लिखने के *बाद* ही — तभी अगली बार 304 पर भरोसा किया जा सकता है
          if(changed) cb(data);
          setSyncStatus(true);
        });
      }).catch(function(){setSyncStatus(false);});
    return;
  }
  // Cache empty — network से load; कमज़ोर नेटवर्क पर हमेशा के लिए न अटकें —
  // तय समय (8 सेकंड) में जवाब न आए तो खाली लिस्ट के साथ आगे बढ़ो, UI न रुके
  var settled=false;
  var tm=setTimeout(function(){
    if(settled)return; settled=true;
    cb([]);
    setSyncStatus(false);
  },FB_GET_TIMEOUT_MS);
  var _tag0=null;
  fetch(FB+"/"+fbPath(hq,cat)+".json?t="+Date.now(),{headers:{"X-Firebase-ETag":"true"}})
    .then(function(r){ _tag0=r.headers.get("ETag"); return _fbJson(r); })
    .then(function(d){
      trackUsageOf(d);
      _noteShape(hq,cat,d);
      _checkMigrationRevert(hq,cat,d);
      var data=normList(d);
      overlayOps(hq,cat,data);
      cSet(hq,cat,data);
      _etagSet(hq,cat,_tag0); // पहली बार का ETag भी सहेजो — अगली बार यह list मुफ़्त में ताज़ा होगी
      if(settled){
        // देर से जवाब आया — अगर अभी भी यही list खुली है तो ताज़ा data दिखा दो
        if(typeof CU!=="undefined"&&CU&&hq===activeHQ&&cat===activeCat){renderSummaryWith(data);renderListWith(data);}
        return;
      }
      settled=true; clearTimeout(tm);
      cb(data);
      setSyncStatus(true);
    })
    .catch(function(){
      if(settled)return; settled=true; clearTimeout(tm);
      cb([]);
      setSyncStatus(false);
    });
}

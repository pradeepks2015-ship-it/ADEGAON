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
  fetch(FB+"/PAUSE.json?t="+Date.now()).then(_fbJson).then(_applyPause).catch(function(){});
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
          trackUsageBytes(JSON.stringify(d||"").length);
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
      trackUsageBytes(JSON.stringify(d||"").length);
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

// prevArr हमेशा caller को खुद देना होगा (mutation से *पहले* का deep-clone snapshot) —
// यहां cGet(hq,cat) से prev निकालना ग़लत होगा, क्योंकि caller अक्सर वही array reference
// mutate करके पहले ही cSet कर चुका होता है, तो cGet यहां तक आते-आते नया (already-mutated) data
// ही लौटाता — prev===arr बन जाता और _diffToPatch को कभी कोई फ़र्क़ नहीं दिखता (patch हमेशा खाली,
// यानी मौजूदा record में कोई भी बदलाव — रिमार्क, वसूली वगैरह — Firebase पर कभी जाता ही नहीं था,
// सिर्फ़ स्थानीय cache में दिखता रहता और अगली असली sync में ग़ायब हो जाता — असली bug यही था)
function fbSet(hq,cat,arr,prevArr,cb){
  cSet(hq,cat,arr);
  if(arr.length>200){
    toast("⏳ "+arr.length+" records सेव हो रहे हैं...","inf");
  }
  if(isMigrated(hq,cat)) _fbPutPerRecord(hq,cat,prevArr||[],arr,cb);
  else _fbPut(hq,cat,arr,cb);
}

// पूरी array PUT करने वाला इकलौता (legacy) रास्ता — इसीलिए यहीं गारंटी दी गई है कि यह किसी
// migrated (per-record/object) HQ/श्रेणी पर कभी raw array नहीं भेजेगा, चाहे कोई भी caller
// (कोई भी 'acc missing' fallback वगैरह) इसे बुलाए — वरना माइग्रेशन चुपचाप पलट जाता (असली bug यही था)
function _asPerRecord(hq,cat,arr){
  var obj={},skip=0;
  (arr||[]).forEach(function(x,i){
    if(!x||x.acc==null||String(x.acc).trim()===""){skip++;return;}
    var rec=JSON.parse(JSON.stringify(x));
    if(rec.o==null) rec.o=i;
    obj[String(x.acc).trim()]=rec;
  });
  if(skip) logErr("mig-noacc-skip",skip+" record बिना acc के मिले — उन्हें सेव नहीं किया (मैन्युअल जांच ज़रूरी), बाकी सुरक्षित रूप से per-record फॉर्मेट में सेव किए",hq+"/"+cat);
  return obj;
}
function _fbPut(hq,cat,arr,cb){
  var body,wrote;
  if(isMigrated(hq,cat)){
    wrote=_asPerRecord(hq,cat,arr);
    body=JSON.stringify(wrote);
  } else if(lastShape(hq,cat)==="obj"){
    // flag कहता है "migrated नहीं" — पर सर्वर पर आख़िरी बार यही list per-record (object) रूप में
    // देखी गई थी। दोनों में से सच वही है जो आँखों-देखा है: flag इस device पर लोड न हो पाया होगा।
    // यहाँ array लिखना पूरी माइग्रेशन पलटा देता (असली production bug — मढ़ी/कुल उपभोक्ता एक दिन में
    // दो बार पलटी)। इसलिए array नहीं, per-record ही लिखते हैं — यूज़र का बदलाव भी बचता है और
    // format भी। साथ ही एक बार लॉग कर देते हैं ताकि JE को पता चले कि किस device का flag अटका है
    logErr("array-put-blocked","इस device का MIGRATED flag इस list के लिए लोड नहीं हुआ था, पर सर्वर पर list per-record रूप में है — पूरी array लिखने से रोका और सही (per-record) रूप में ही सेव किया। माइग्रेशन पलटने से बच गया",hq+"/"+cat);
    wrote=_asPerRecord(hq,cat,arr);
    body=JSON.stringify(wrote);
  } else {
    wrote=arr;
    body=JSON.stringify(arr);
  }
  fetch(FB+"/"+fbPath(hq,cat)+".json",{
    method:"PUT",
    headers:{"Content-Type":"application/json"},
    body:body
  }).then(function(r){
    if(!r.ok) throw new Error("HTTP "+r.status);
    // अभी-अभी हमने सर्वर पर जो रूप लिखा, अब सर्वर पर वही है — याद रख लो (कोई network call नहीं)
    _noteShape(hq,cat,wrote);
    clearPendingKey(cKey(hq,cat));
    updTime(); setSyncStatus(true);
    if(cb) cb(true);
  }).catch(function(e){
    if(navigator.onLine) logErr("save-fail",e,hq+"/"+cat); // ऑनलाइन होते हुए save fail — असली गड़बड़
    markPending(hq,cat,"put",null,e);
    setSyncStatus(false);
    _saveFailToast(e);
    if(cb) cb(false);
  });
}

// "ऑफलाइन" कहना तभी सही है जब असली वजह नेटवर्क हो — 401/403 का मतलब है login session ही
// अमान्य हो गया (जैसे PIN बदल गया या token का auto-refresh नाकाम रहा), वहां गुमराह करने वाला
// "ऑफलाइन" न दिखाकर साफ़ बताएं कि दोबारा login चाहिए, ताकि यूज़र को असली समस्या पता चले
function _saveFailToast(e){
  var msg=(e&&e.message)||"";
  if(/HTTP (401|403)/.test(msg)){
    toast("🔐 सेव नहीं हुआ — login session खत्म हो गया लगता है। Logout करके दोबारा login करें","err");
  } else {
    toast("📴 ऑफलाइन — बदलाव device पर save है, नेट आते ही अपने आप sync होगा","inf");
  }
}

// migrated (per-record) HQ/श्रेणी के लिए — prev/arr में जो record बदले/जुड़े/हटे हों सिर्फ उन्हें PATCH करना,
// पूरी लिस्ट दोबारा नहीं भेजना (bandwidth बचत + concurrent-edit टकराव खत्म)
// acc-रहित record को छोड़कर बाक़ी सबका patch बनाएं।
// पहले यह ऐसे record पर null लौटाता था और caller पूरी लिस्ट का array-PUT कर देता था — पर वह
// "सुरक्षित" रास्ता असल में सुरक्षित था ही नहीं: _fbPut का guard उस array को object में बदलकर
// वही acc-रहित record वैसे भी छोड़ देता था (mig-noacc-skip), यानी वो record किसी भी हाल में सेव
// नहीं होता था — उल्टा पूरा node overwrite हो जाता, जिससे उसी वक़्त किसी और लाइनमैन की दर्ज की
// वसूली मिट सकती थी (per-record PATCH बनाया ही इसीलिए गया था), और पूरी लिस्ट दोबारा भेजने से
// नेट भी लगता। असली production लॉग में यही जोड़ी बार-बार दिखी: mig-noacc-fallback + mig-noacc-skip
function _diffToPatch(prev,arr){
  var prevByAcc={};
  (prev||[]).forEach(function(x){ if(x&&x.acc!=null&&String(x.acc).trim()!=="") prevByAcc[String(x.acc).trim()]=x; });
  var maxO=-1;
  (prev||[]).forEach(function(x){ if(x&&x.o!=null&&Number(x.o)>maxO) maxO=Number(x.o); });
  var patch={},changed=false,nextO=maxO+1,newAccSet={};
  (arr||[]).forEach(function(x){
    if(!x||x.acc==null||String(x.acc).trim()==="") return; // acc नहीं — इसे per-record key दी ही नहीं जा सकती
    var k=String(x.acc).trim();
    newAccSet[k]=1;
    if(x.o==null) x.o=nextO++; // नया record — मौजूदा क्रम के आखिर में जुड़े
    var old=prevByAcc[k];
    if(!old||JSON.stringify(old)!==JSON.stringify(x)){ patch[k]=x; changed=true; }
  });
  Object.keys(prevByAcc).forEach(function(k){
    if(!newAccSet[k]){ patch[k]=null; changed=true; } // हटाया गया record — PATCH में null = delete
  });
  return changed?patch:{};
}

// acc-रहित records की पहचान — नाम/पता/मोबाइल से, ताकि JE उन्हें ढूंढकर Consumer No भर सके
// (acc खुद ही गायब है, इसलिए पहचानने का और कोई ज़रिया नहीं — _migRender की probRows जैसा ही तरीक़ा)
function _noAccLabels(arr){
  return (arr||[]).filter(function(x){ return x&&(x.acc==null||String(x.acc).trim()===""); })
    .map(function(x){ return (x.name||"(नाम नहीं)")+(x.addr?" — "+x.addr:"")+(x.phone?" — "+x.phone:""); });
}

function _fbPutPerRecord(hq,cat,prev,arr,cb){
  // acc-रहित record किसी भी तरीक़े से per-record सेव नहीं हो सकता (acc ही उसकी key है) — बाक़ी
  // सबका patch भेज दें, और JE को साफ़ बताएं कि किस उपभोक्ता का Consumer No भरना है
  var noAcc=_noAccLabels(arr);
  if(noAcc.length){
    logErr("mig-noacc-skip",noAcc.length+" record बिना Consumer No के हैं, इसलिए वो सेव नहीं हो पा रहे (बाक़ी सब सेव हो गए)। ठीक करने के लिए: चरण 3 जांच → दोबारा जांचें → \"समस्या वाले records\"। "+noAcc.slice(0,2).join(" | "),hq+"/"+cat);
  }
  var patch=_diffToPatch(prev,arr);
  if(!Object.keys(patch).length){ if(cb) cb(true); return; } // कुछ बदला ही नहीं — network call भी नहीं
  fetch(FB+"/"+fbPath(hq,cat)+".json",{
    method:"PATCH",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(patch)
  }).then(function(r){
    if(!r.ok) throw new Error("HTTP "+r.status);
    clearPendingKey(cKey(hq,cat));
    updTime(); setSyncStatus(true);
    if(cb) cb(true);
  }).catch(function(e){
    if(navigator.onLine) logErr("save-fail",e,hq+"/"+cat);
    markPending(hq,cat,"put",patch,e);
    setSyncStatus(false);
    _saveFailToast(e);
    if(cb) cb(false);
  });
}

// _diffToPatch का उल्टा काम — server से SSE "patch" event में मिला delta (acc: नया/बदला record,
// या acc: null यानी हटाया गया) local array पर लगाना, ताकि पूरी लिस्ट दोबारा मंगाने की ज़रूरत न पड़े
function _applyPatchToArray(arr,patch){
  var byAcc={};
  (arr||[]).forEach(function(x,i){ if(x&&x.acc!=null) byAcc[String(x.acc)]=i; });
  var out=(arr||[]).slice();
  var removeIdx=[];
  Object.keys(patch).forEach(function(k){
    var val=patch[k];
    if(val===null){
      if(byAcc.hasOwnProperty(k)) removeIdx.push(byAcc[k]);
    } else if(byAcc.hasOwnProperty(k)){
      out[byAcc[k]]=val;
    } else {
      out.push(val);
    }
  });
  if(removeIdx.length){
    removeIdx.sort(function(a,b){return b-a;}); // पीछे से हटाएं ताकि बाकी index न बिगड़ें
    removeIdx.forEach(function(i){ out.splice(i,1); });
  }
  return out;
}

function fbDel(hq,cat,cb){
  // हटाने से पहले paid records का backup — ताकि "हटाएं → अपलोड" में वसूली न उड़े
  try{
    var old=cGet(hq,cat)||[],bk={};
    old.forEach(function(e){
      if(e&&e.acc&&e.status==="paid")bk[String(e.acc).trim()]={paydate:e.paydate||"",by:e.updatedBy||"",at:e.updatedAt||"",ts:e.ts||0,remarksArr:e.remarksArr||[]};
    });
    if(Object.keys(bk).length)localStorage.setItem("vt_paidbk_"+cKey(hq,cat),JSON.stringify({t:Date.now(),m:bk}));
  }catch(e){}
  cSet(hq,cat,[]);
  fetch(FB+"/"+fbPath(hq,cat)+".json",{method:"DELETE"})
    .then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);clearPendingKey(cKey(hq,cat));if(cb)cb();})
    .catch(function(e){if(navigator.onLine)logErr("delete-fail",e,hq+"/"+cat);markPending(hq,cat,"del",null,e);toast("📴 ऑफलाइन — नेट आने पर लिस्ट सभी के लिए हटेगी","inf");if(cb)cb();});
}

// Migrate old single-string remarks to array format
function migrateRemarks(x){
  if(!x) return x;
  if(!x.remarksArr){
    x.remarksArr = [];
    if(x.remarks && x.remarks.trim()){
      x.remarksArr.push({
        text: x.remarks.trim(),
        by: x.updatedBy || x.uploadedBy || "—",
        at: x.updatedAt || x.uploadedAt || ""
      });
    }
  }
  return x;
}

var catNamesTimer = null;
var liveSource = null; // real-time SSE stream (Firebase REST streaming)
// EventSource का URL जुड़ते वक़्त का ID_TOKEN अपने साथ रखता है — Firebase ID token ~1 घंटे बाद
// expire होता है, तो एक ही list घंटों खुली रहने पर स्ट्रीम बंद (readyState=2) हो सकती है। पहले
// यहां से सीधे हमेशा के लिए हर-15-सेकंड वाले भारी polling (पूरी लिस्ट दोबारा) पर चले जाते थे, कभी
// वापस सस्ते live-sync पर नहीं लौटते — असली bandwidth bug यही था, बिना किसी modal/बटन के, सिर्फ़
// list देर तक खुली रहने से। अब पहले ताज़ा token के साथ EventSource दोबारा जोड़ने की कोशिश होती है
var _esReconnectAttempts = 0;

function stopListen(){
  if(pollTimer){clearInterval(pollTimer);pollTimer=null;}
  if(liveSource){liveSource.close();liveSource=null;}
}

// SSE "put" event का data पार्स करना — Firebase पूरे node (path:"/") के बदलाव पर event में ही नया data दे देता है
// तभी {ok:true,data} लौटाएं ताकि caller दोबारा fetch न करे; कोई और path/parse-issue हो तो {ok:false} (caller safe fallback ले)
function _sseFullPutData(evData){
  try{
    var msg=JSON.parse(evData);
    if(msg&&msg.path==="/") return {ok:true,data:msg.data};
  }catch(e){}
  return {ok:false};
}

function startListen(hq,cat){
  stopListen();
  // 🛑 डेटा बचाओ मोड — live sync ही सबसे बड़ा download खर्च है, इसलिए जुड़ें ही नहीं।
  // स्विच हटते ही _applyPause खुद दोबारा जोड़ देता है, और जुड़ते ही पूरा ताज़ा data आ जाता है
  if(isDataPaused()) return;

  function applyIncoming(d){
    _noteShape(hq,cat,d);
    _checkMigrationRevert(hq,cat,d); // migrated list कहीं पुराने device ने वापस array में तो नहीं बदल दी
    var data=normList(d);
    overlayOps(hq,cat,data);
    var prev=cGet(hq,cat);
    var changed=JSON.stringify(data)!==JSON.stringify(prev);
    cSet(hq,cat,data);
    if(changed){ // सिर्फ बदला हो तभी re-render
      renderSummaryWith(data);
      renderListWith(data);
    }
    setSyncStatus(true); updTime();
  }

  // migrated (per-record) HQ/श्रेणी में "patch" event से मिला delta local array पर लगाना —
  // पूरी लिस्ट दोबारा मंगाने की ज़रूरत नहीं (bandwidth बचत, वैसे ही जैसे "put" event के लिए ऊपर की गई)
  // migration-revert जांच यहां ज़रूरी नहीं — "patch" event खुद सबूत है कि data अब भी सही per-record रूप में है
  function applyPatchLocal(patchData){
    var merged=_applyPatchToArray(cGet(hq,cat)||[],patchData);
    var data=normList(merged);
    overlayOps(hq,cat,data);
    var prev=cGet(hq,cat);
    var changed=JSON.stringify(data)!==JSON.stringify(prev);
    cSet(hq,cat,data);
    if(changed){
      renderSummaryWith(data);
      renderListWith(data);
    }
    setSyncStatus(true); updTime();
  }

  // Firebase का ETag तरीक़ा — "X-Firebase-ETag" भेजने पर जवाब में एक ETag मिलता है; अगली बार वही
  // "if-none-match" में भेजने पर, अगर list बिल्कुल नहीं बदली, तो सर्वर सिर्फ़ खाली HTTP 304 देता है
  // (पूरी list दोबारा नहीं) — यह fallback (पहले से महंगा तरीक़ा) है, तो इसे जितना हल्का बना सकें उतना अच्छा;
  // ज़्यादातर 15-सेकंड वाले poll में असल में कुछ बदला ही नहीं होता, तो यह लगभग-मुफ़्त हो जाएगा
  // ETag अब सबका साझा (localStorage वाला) है — पहले यहां अपना अलग in-memory _pollEtag था, यानी
  // हर बार polling शुरू होने पर पहला poll हमेशा पूरी list डाउनलोड करता था
  function pollOnce(){
    if(isPending(hq,cat)){if(navigator.onLine)flushPending();return;}
    fetch(FB+"/"+fbPath(hq,cat)+".json?t="+Date.now(),{headers:_etagHeaders(hq,cat)})
      .then(function(r){
        if(r.status===304) return; // कुछ नहीं बदला — यहीं रुक जाओ (असली null value से अलग रखना ज़रूरी)
        if(!r.ok) throw new Error("HTTP "+r.status);
        var tag=r.headers.get("ETag");
        return r.json().then(function(d){ applyIncoming(d); _etagSet(hq,cat,tag); });
      })
      .catch(function(){setSyncStatus(false);});
  }

  function startPolling(){
    if(pollTimer) return;
    pollOnce();
    pollTimer=setInterval(pollOnce,15000);
  }

  // असली real-time: Firebase REST streaming (Server-Sent Events) — बदलाव होते ही तुरंत मिलता है, हर 15 sec पूछने की ज़रूरत नहीं
  if(typeof EventSource==="function"){
    try{
      var url=FB+"/"+fbPath(hq,cat)+".json"+(ID_TOKEN?("?auth="+encodeURIComponent(ID_TOKEN)):"");
      var es=new EventSource(url);
      liveSource=es;
      // "put" event में Firebase पहले से पूरा नया data भेज देता है — उसी को इस्तेमाल करो,
      // दोबारा fetch करके एक ही data दो बार डाउनलोड मत करो (bandwidth बचत)
      es.addEventListener("put",function(ev){
        if(isPending(hq,cat))return;
        var r=_sseFullPutData(ev.data);
        if(r.ok){ applyIncoming(r.data); return; }
        pollOnce(); // सुरक्षित fallback
      });
      es.addEventListener("patch",function(ev){
        if(isPending(hq,cat))return;
        try{
          var msg=JSON.parse(ev.data);
          if(msg&&msg.path==="/"&&msg.data&&typeof msg.data==="object"){
            applyPatchLocal(msg.data);
            return;
          }
        }catch(e){}
        pollOnce(); // सुरक्षित fallback
      });
      es.onopen=function(){setSyncStatus(true);_esReconnectAttempts=0;};
      es.onerror=function(){
        setSyncStatus(false);
        if(es.readyState===2){ // CLOSED — स्ट्रीम पूरी तरह टूट गई (जैसे token expire)
          if(liveSource===es) liveSource=null;
          if(_esReconnectAttempts<3){
            // पहले ताज़ा ID_TOKEN के साथ सस्ता live-sync दोबारा जोड़ने की कोशिश — token expire होना
            // सामान्य बात है (हर ~1 घंटे), भारी polling पर जाने की ज़रूरत नहीं
            _esReconnectAttempts++;
            setTimeout(function(){ startListen(hq,cat); },2000);
          } else {
            // लगातार 3 बार तुरंत बंद हो रहा है (शायद असली permission समस्या) — तभी polling पर जाओ
            startPolling();
          }
        }
        // वरना EventSource खुद reconnect करने की कोशिश करता रहेगा
      };
      // यहां pollOnce() जान-बूझकर नहीं बुलाया — caller (fbGet, हमेशा startListen से ठीक पहले/इसी
      // callback में चलता है) पहले ही ताज़ा data दिखा चुका होता है, और EventSource जुड़ते ही खुद अपना
      // पहला "put" event भेजता है जिसमें पूरा मौजूदा data होता है — तीसरी बार वही data डाउनलोड करना
      // सिर्फ़ बेवजह Firebase bandwidth (और पैसा) खर्च कर रहा था, कोई UI फ़ायदा नहीं था
    }catch(e){
      startPolling();
    }
  } else {
    startPolling();
  }

  // CAT_NAMES/MIGRATED flags कम बदलने वाली चीज़ें हैं (JE कभी-कभार नाम बदलता है) — पहले 30 sec था,
  // पर list खुली रहने के हर पल यह चलता रहता है (कई घंटे, कई devices साथ-साथ) — जुड़कर असली bandwidth
  // बन जाता है। हर नए login/reload पर startApp() में loadCatNames()+loadMigratedFlags() से वैसे भी
  // तुरंत सही value मिल जाती है — यह timer सिर्फ़ उस rare स्थिति के लिए है जब कोई device बिना reload
  // किए बहुत देर लगातार खुला रहे और उसी दौरान कोई category rename हो जाए, इसलिए 12 घंटे काफ़ी है
  if(catNamesTimer) clearInterval(catNamesTimer);
  catNamesTimer=setInterval(function(){
    fetchCatNamesFromFB(true);
    loadMigratedFlags();
  },12*60*60*1000);
}


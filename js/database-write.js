// ── Firebase डेटा: लिखना (fbSet, _fbPut, PATCH, सर्वर के रिमार्क मिलाना, fbDel) ──
// कोड-गुणवत्ता कदम 4 (v9.199): js/database.js से अलग की गई — लोड-क्रम: database.js → यह → database-live.js

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
  // v9.167: flag न भी हो, पर सर्वर पर list per-record दिखी हो (या अभी जांच में दिखे) तो भी सिर्फ़ बदले
  // records का PATCH — पूरी list लिखने से उसी पल किसी और लाइनमैन का बदलाव दब सकता था
  if(isMigrated(hq,cat)||lastShape(hq,cat)==="obj"){ _fbPutPerRecord(hq,cat,prevArr||[],arr,cb); return; }
  if(!lastShape(hq,cat)&&!Object.keys(MIGRATED||{}).length){
    // flags लोड नहीं + रूप अज्ञात — _fbPut की जांच चलाओ; per-record निकले तो PATCH, वरना वही array
    fetch(FB+"/"+fbPath(hq,cat)+".json?shallow=true&t="+Date.now())
      .then(_fbJson)
      .then(function(d){
        var sh=_shapeFromShallow(d);
        _noteShape(hq,cat,sh==="obj"?{}:[]);
        if(sh==="obj") _fbPutPerRecord(hq,cat,prevArr||[],arr,cb);
        else _fbPutNow(hq,cat,arr,cb);
      })
      .catch(function(e){
        if(navigator.onLine) logErr("save-shape-probe-fail",e,hq+"/"+cat);
        markPending(hq,cat,"put",null,e);
        setSyncStatus(false);
        _saveFailToast(e);
        if(cb) cb(false);
      });
    return;
  }
  _fbPut(hq,cat,arr,cb);
}

// पूरी array PUT करने वाला इकलौता (legacy) रास्ता — इसीलिए यहीं गारंटी दी गई है कि यह किसी
// migrated (per-record/object) HQ/श्रेणी पर कभी raw array नहीं भेजेगा, चाहे कोई भी caller
// (कोई भी 'acc missing' fallback वगैरह) इसे बुलाए — वरना माइग्रेशन चुपचाप पलट जाता (असली bug यही था)
function _asPerRecord(hq,cat,arr){
  var obj={},skip=0;
  (arr||[]).forEach(function(x,i){
    if(!x||x.acc==null||String(x.acc).trim()===""){ if(!_isGhostRec(x)) skip++; return; }
    var rec=JSON.parse(JSON.stringify(x));
    if(rec.o==null) rec.o=i;
    obj[String(x.acc).trim()]=rec;
  });
  if(skip) logErr("mig-noacc-skip",skip+" record बिना acc के मिले — उन्हें सेव नहीं किया (मैन्युअल जांच ज़रूरी), बाकी सुरक्षित रूप से per-record फॉर्मेट में सेव किए",hq+"/"+cat);
  return obj;
}
var _arrayPutLogged={};
// ── flags लोड हुए बिना array लिखने से पहले सर्वर पर list का असली रूप जांचो (v9.167) ──
// असली production (v9.166 लॉग, बीबी/कुल उपभोक्ता, Movind): "array-put-noflags" — इस device पर MIGRATED
// flags लोड ही नहीं हुए (ऐप खुलते वक़्त login पूरा होने से पहले /MIGRATED पढ़ा गया → Permission denied)
// और list का रूप भी पहले कभी नहीं देखा था। ऐसे में पूरी array लिखना migrated list को पलट देता — यही
// मढ़ी/1134019486 के duplicate card की जड़ थी। अब पहले ?shallow=true से सिर्फ़ keys (हल्का) मंगाकर
// रूप पक्का करते हैं: key Consumer No जैसी (गैर-क्रमांक) = per-record; सब 0,1,2… = array। जांच ही नाकाम
// हो तो array नहीं लिखते — बदलाव device पर pending रहता है, flushPending बाद में पूरा रूप देखकर भेजेगा
function _shapeFromShallow(d){
  if(!d||typeof d!=="object") return null;
  var ks=Object.keys(d);
  if(!ks.length) return null;
  // Consumer No भी अंकों वाले ही हैं (जैसे 1134019486) — इसलिए "सिर्फ़ अंक" से फ़र्क़ नहीं पता चलता।
  // array के क्रमांक 0…(records-1) होते हैं, जो getMaxRecords (3500) से कभी ऊपर नहीं जाते;
  // Consumer No उससे कहीं बड़े (10 अंक)
  return ks.every(function(k){ return /^\d+$/.test(k)&&Number(k)<=10000; })?"arr":"obj";
}
function _fbPut(hq,cat,arr,cb){
  if(!isMigrated(hq,cat)&&!lastShape(hq,cat)&&!Object.keys(MIGRATED||{}).length){
    fetch(FB+"/"+fbPath(hq,cat)+".json?shallow=true&t="+Date.now())
      .then(_fbJson)
      .then(function(d){
        var sh=_shapeFromShallow(d);
        _noteShape(hq,cat,sh==="obj"?{}:[]); // खाली/नहीं = array लिखना सुरक्षित
        _fbPutNow(hq,cat,arr,cb);
      })
      .catch(function(e){
        if(navigator.onLine) logErr("save-shape-probe-fail",e,hq+"/"+cat);
        markPending(hq,cat,"put",null,e);
        setSyncStatus(false);
        _saveFailToast(e);
        if(cb) cb(false);
      });
    return;
  }
  _fbPutNow(hq,cat,arr,cb);
}
function _fbPutNow(hq,cat,arr,cb){
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
    // जांच: migrated list को array में पलटने वाला device कौन है? सबसे संभावित वजह — इस device पर
    // MIGRATED flags लोड ही नहीं हुए (बिल्कुल खाली)। ऐसे में पूरी array लिखते वक़्त एक बार लॉग करो
    // (logErr अपने-आप लाइनमैन/version/device जोड़ता है) — ताकि असली लिखने वाला पकड़ा जा सके
    var _ak=hq+"/"+cat;
    if(!_arrayPutLogged[_ak]&&!Object.keys(MIGRATED||{}).length){
      _arrayPutLogged[_ak]=true;
      logErr("array-put-noflags","MIGRATED flags लोड हुए बिना पूरी list array रूप में लिखी जा रही है — अगर यह list migrated है तो यही उसे पलट देगा",hq+"/"+cat+" • पिछला रूप: "+(lastShape(hq,cat)||"अज्ञात"));
    }
  }
  fetch(FB+"/"+fbPath(hq,cat)+".json",{
    method:"PUT",
    headers:{"Content-Type":"application/json"},
    body:body
  }).then(function(r){
    if(!r.ok) return _fbHttpErr(r);
    // अभी-अभी हमने सर्वर पर जो रूप लिखा, अब सर्वर पर वही है — याद रख लो (कोई network call नहीं)
    _noteShape(hq,cat,wrote);
    clearPendingKey(cKey(hq,cat));
    updTime(); setSyncStatus(true);
    if(cb) cb(true);
  }).catch(function(e){
    if(navigator.onLine) logErr("save-fail",e,hq+"/"+cat+_authDiag(e)); // ऑनलाइन होते हुए save fail — असली गड़बड़
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
  return (arr||[]).filter(function(x){ return !_isGhostRec(x)&&(x.acc==null||String(x.acc).trim()===""); })
    .map(function(x){ return (x.name||"(नाम नहीं)")+(x.addr?" — "+x.addr:"")+(x.phone?" — "+x.phone:""); });
}

// ── सर्वर पर पहले से पड़े रिमार्क कभी न दबें — JE की शिकायत (बीबी): कल डाले रिमार्क आज गायब ──
// per-record PATCH पूरा record भेजता है। जिस फ़ोन पर उस उपभोक्ता की कॉपी पुरानी हो (किसी और ने बाद
// में रिमार्क डाला, इस फ़ोन तक अभी नहीं पहुंचा), वह "वसूल" मार्क करे या अपना रिमार्क डाले तो सर्वर
// का record उसी पुरानी कॉपी से बदल जाता — दूसरे का रिमार्क चुपचाप मिट जाता। अब PATCH से ठीक पहले
// बदले records के सर्वर वाले remarksArr (सिर्फ़ वही छोटा हिस्सा) पढ़कर अपने में मिला लेते हैं
// (text|by|at से dedup — ऐप में रिमार्क हटाने का कोई रास्ता नहीं, इसलिए जोड़ना हमेशा सुरक्षित है)।
// थोक बदलाव (अपलोड जैसे, REMARK_MERGE_MAX से ज़्यादा records) में नहीं — वहां हर record की अलग
// पढ़ाई भारी पड़ती, और अपलोड पुराने रिमार्क पहले ही खुद जोड़ लेता है (देखें upload.js)।
// पढ़ाई नाकाम (offline) हो तो patch जैसा है वैसा — PATCH भी fail होकर pending बनेगा, और
// flushPending भेजने से पहले यही मिलान दोबारा करेगा
var REMARK_MERGE_MAX=10;
var REMARK_MERGE_TIMEOUT_MS=20000; // v9.268 (JE 31/10): 5s → 20s — आनंद जैसे बहुत कमज़ोर नेट पर बार-बार timeout; सेव फ़ोन में तुरंत, यह पीछे चलता है
// v9.234 (JE 16/10): offline में जमा patch (दिन भर का काम) नेट आने पर भेजते वक़्त 10 से ज़्यादा records
// हों तब भी मिलान — 10-10 करके। पहले >10 पर मिलान होता ही नहीं था और फ़ोन की पुरानी copy सर्वर के रिमार्क दबा देती
var REMARK_FLUSH_MAX=500;
var REMARK_MERGE_BATCH=10;
var _rmkHoldLogged={};
// v9.241 (19/10, JE के फ़ोन पर 10:56 — 6 HQ की 8 सूचियों में 61 उपभोक्ताओं के रिमार्क "timeout" पर रुके, नेट ठीक होते हुए):
// कई सूचियां एक साथ भेजी जाएं तो हर सूची 10-10 पढ़ाई एक साथ छोड़ती थी (80 तक) — ब्राउज़र उन्हें कतार में रखता और
// 5 सेकंड की घड़ी कतार में ही बीत जाती। अब पूरे ऐप में एक साथ ज़्यादा से ज़्यादा REMARK_READ_PARALLEL पढ़ाई,
// और घड़ी तभी चलती है जब पढ़ाई सचमुच शुरू हो
var REMARK_READ_PARALLEL=6;
var REMARK_FLUSH_TIMEOUT_MS=20000; // "बाक़ी" पीछे से भेजते वक़्त (कोई इंतज़ार नहीं कर रहा) — v9.268 से सामने वाली सेव जितना ही (20s)
var _rmkActive=0,_rmkQueue=[];
function _rmkSlot(run){
  return new Promise(function(resolve,reject){
    function go(){
      _rmkActive++;
      run().then(function(v){ done(); resolve(v); },function(e){ done(); reject(e); });
    }
    function done(){ _rmkActive--; var nx=_rmkQueue.shift(); if(nx) nx(); }
    if(_rmkActive<REMARK_READ_PARALLEL) go(); else _rmkQueue.push(go);
  });
}
// लौटाता है {send, hold}: send = अभी भेजने लायक़ patch; hold = वे records जिनके सर्वर-रिमार्क पढ़े नहीं जा सके
// (कमज़ोर नेट पर timeout/नाकामी)। v9.234 से पहले ऐसे record बिना मिलान पूरे भेज दिए जाते थे — सर्वर का
// रिमार्क दब जाता। अब उनके रिमार्क छोड़कर बाक़ी fields ("acc/status" जैसे अलग path) तुरंत जाते हैं, और पूरा
// record "बाक़ी" (pending) में रुकता है — अगली बार मिलान होकर ही भेजा जाएगा
function _mergeServerRemarks(hq,cat,patch,max,timeoutMs){
  var tmo=timeoutMs||REMARK_MERGE_TIMEOUT_MS;
  var keys=Object.keys(patch||{}).filter(function(k){ return patch[k]&&typeof patch[k]==="object"&&k.indexOf("/")<0; });
  if(!keys.length||keys.length>(max||REMARK_MERGE_MAX)||!navigator.onLine) return Promise.resolve({send:patch,hold:null});
  var gained={},failed={};
  function one(k){
    // धीमे नेट पर यह पढ़ाई असली सेव को देर तक न रोके — REMARK_MERGE_TIMEOUT_MS बाद हार मानो (record रुकेगा)
    return _rmkSlot(function(){
      var timer=0;
      return Promise.race([
        fetch(FB+"/"+fbPath(hq,cat)+"/"+encodeURIComponent(k)+"/remarksArr.json?t="+Date.now()).then(_fbJson),
        new Promise(function(_,rej){ timer=setTimeout(function(){ rej(new Error("timeout")); },tmo); })
      ]).then(function(v){ clearTimeout(timer); return v; },function(e){ clearTimeout(timer); throw e; });
    })
      .then(function(srv){
        trackUsageOf(srv);
        if(!srv||typeof srv!=="object") return;
        var srvArr=Array.isArray(srv)?srv:Object.keys(srv).map(function(i){ return srv[i]; });
        var mine=patch[k].remarksArr||[];
        var seen={},out=[];
        srvArr.concat(mine).forEach(function(r){
          if(!r||typeof r!=="object") return;
          var rk=rmkKeyOf(r);
          if(!seen[rk]){ seen[rk]=1; out.push(r); }
        });
        out=rmkTrim(out); // v9.247: 10 से ज़्यादा नहीं — सर्वर पर पड़ा पुराना (यहां हटा) लौटे नहीं
        var mineK={}; mine.forEach(function(r){ if(r&&typeof r==="object") mineK[rmkKeyOf(r)]=1; });
        if(out.length===mine.length&&out.every(function(r){ return mineK[rmkKeyOf(r)]; })) return; // सर्वर पर ऐसा कुछ नहीं जो इस फ़ोन पर न हो
        patch[k].remarksArr=out;
        patch[k].remarks=out[out.length-1].text; // backward-compat field — saveRmk जैसा ही
        gained[k]=out;
      })
      .catch(function(e){ failed[k]=String((e&&e.message)||e||"?").slice(0,60); });
  }
  var chain=/** @type {Promise<any>} */(Promise.resolve());
  for(var i=0;i<keys.length;i+=REMARK_MERGE_BATCH){
    (function(part){ chain=chain.then(function(){ return Promise.all(part.map(one)); }); })(keys.slice(i,i+REMARK_MERGE_BATCH));
  }
  return chain.then(function(){
    // सर्वर से मिले रिमार्क इस फ़ोन की कॉपी में भी तुरंत दिखें (SSE के भरोसे न रहें)
    if(Object.keys(gained).length){
      var d=cGet(hq,cat)||[];
      d.forEach(function(x){
        var k=x&&x.acc!=null?String(x.acc).trim():"";
        if(k&&gained[k]){ x.remarksArr=JSON.parse(JSON.stringify(gained[k])); x.remarks=gained[k][gained[k].length-1].text; }
      });
      cSet(hq,cat,d);
      if(CU&&hq===activeHQ&&cat===activeCat){ renderSummaryWith(d); renderListWith(d); }
    }
    if(!Object.keys(failed).length) return {send:patch,hold:null};
    var send={},hold={};
    Object.keys(patch).forEach(function(k){
      var rec=patch[k];
      if(!failed[k]){ send[k]=rec; return; }
      hold[k]=rec;
      Object.keys(rec).forEach(function(f){ if(f!=="remarksArr"&&f!=="remarks") send[k+"/"+f]=rec[f]; });
    });
    // हर 20 सेकंड वाली कोशिश पर लॉग न भरे — हर सूची पर एक बार (इस बार ऐप खुलने तक)
    // v9.237: वजह भी (timeout = कमज़ोर नेट; HTTP 401 = login/App Check अभी तैयार नहीं) — यह अपने-आप संभलने वाली
    // हालत है, alert नहीं बनती (check-alerts IGNORE); घंटों अटके तो "pending-old" alert आता है
    var why=failed[Object.keys(failed)[0]];
    if(!_rmkHoldLogged[hq+"/"+cat]) logErr("remark-merge-hold",Object.keys(hold).length+" उपभोक्ता के सर्वर-रिमार्क पढ़े नहीं जा सके — उनकी वसूली/बाक़ी बदलाव भेजे, रिमार्क वाला हिस्सा बाद में मिलाकर भेजा जाएगा",hq+"/"+cat+" • वजह: "+why);
    _rmkHoldLogged[hq+"/"+cat]=1;
    return {send:send,hold:hold};
  });
}

// v9.262: यह लॉग हर सेव पर जाता था (Satendra, 3 मिनट में 12 बार) — एक सूची का फ़ोन से दिन में एक ही बार
var NOACC_LOG_KEY="dc_noacclog1";
function _noAccLog(hq,cat,noAcc){
  if(!noAcc||!noAcc.length) return;
  var day=new Date().toISOString().slice(0,10), seen;
  try{ seen=JSON.parse(localStorage.getItem(NOACC_LOG_KEY)||"{}")||{}; }catch(e){ seen={}; }
  var k=hq+"/"+cat;
  if(seen[k]===day) return;
  seen[k]=day;
  try{ localStorage.setItem(NOACC_LOG_KEY,JSON.stringify(seen)); }catch(e){}
  logErr("mig-noacc-skip",noAcc.length+" उपभोक्ता का Consumer No खाली है (नाम है), इसलिए उनके बदलाव सेव नहीं हो पा रहे (बाक़ी सब सेव हो गए)। ठीक करने के लिए: सूची में Consumer No भरकर दोबारा अपलोड करें। "+noAcc.slice(0,2).join(" | "),hq+"/"+cat);
}
function _fbPutPerRecord(hq,cat,prev,arr,cb){
  // acc-रहित record किसी भी तरीक़े से per-record सेव नहीं हो सकता (acc ही उसकी key है) — बाक़ी
  // सबका patch भेज दें, और JE को साफ़ बताएं कि किस उपभोक्ता का Consumer No भरना है
  _noAccLog(hq,cat,_noAccLabels(arr));
  var patch=_diffToPatch(prev,arr);
  if(!Object.keys(patch).length){ if(cb) cb(true); return; } // कुछ बदला ही नहीं — network call भी नहीं
  _mergeServerRemarks(hq,cat,patch).then(function(res){ _fbSendPatch(hq,cat,patch,cb,res); });
}
// res (v9.234): _mergeServerRemarks का {send, hold} — send भेजो; hold वाले पूरे records "बाक़ी" में रुकें।
// नाकाम हो तो पूरा मूल patch ही "बाक़ी" में (ताकि अगली बार फिर से मिलान हो)
function _fbSendPatch(hq,cat,patch,cb,res){
  var send=res&&res.send||patch, hold=res&&res.hold;
  fetch(FB+"/"+fbPath(hq,cat)+".json",{
    method:"PATCH",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(send)
  }).then(function(r){
    if(!r.ok) return _fbHttpErr(r);
    pendingDropRecs(hq,cat,patch,false); // यह सेव सबसे नया — इन records का पुराना "बाक़ी" रूप भी बेकार
    if(hold) markPending(hq,cat,"put",hold);
    updTime(); setSyncStatus(!isPending(hq,cat));
    if(cb) cb(true);
  }).catch(function(e){
    if(navigator.onLine) logErr("save-fail",e,hq+"/"+cat+_authDiag(e));
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
  // trimmed मिलान — देखें storage.js: accKeyOf (वरना space वाले acc पर एक ही उपभोक्ता का दूसरा card जुड़ जाता)
  (arr||[]).forEach(function(x,i){ var ak=accKeyOf(x); if(ak) byAcc[ak]=i; });
  var out=(arr||[]).slice();
  var removeIdx=[];
  Object.keys(patch).forEach(function(pk){
    var val=patch[pk];
    var k=String(pk).trim();
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

// किसी record से backup-entry बनाएं — "वसूल" की वो सारी जानकारी जो लौटाने के लिए चाहिए
function paidBkEntry(e){
  return {paydate:e.paydate||"",by:e.updatedBy||"",at:e.updatedAt||"",ts:e.ts||0,remarksArr:e.remarksArr||[]};
}
// मिटाई जा रही वसूली का 7-दिनी backup (localStorage में) — पहले सिर्फ़ fbDel ("हटाएं") यह रखता
// था; अब sweepStalePaid भी रखता है (देखें list.js), क्योंकि checkbox हटाकर अपलोड करने पर पूरे
// मुख्यालय की वसूली एक साथ मिटती है और ऐप के अंदर वापसी का कोई रास्ता नहीं बचता था।
// लौटती कैसे है: उसी category में दोबारा लेजर अपलोड करते ही upload.js का vt_paidbk_ वाला
// restore इसे उठा लेता है, और फिर reconcileHQ उसे बाक़ी सभी बटनों में फैला देता है।
// quota बचाने के लिए सिर्फ़ वही records रखें जो सच में मिट रहे हैं — पूरी paid सूची नहीं
// (6 HQ × 8 categories का पूरा data localStorage की सीमा पार कर सकता है)। quota भर जाए तो
// throw होता है, इसलिए पूरा काम try में — backup न बन पाए तो भी अपलोड रुकना नहीं चाहिए
function savePaidBackup(hq,cat,map){
  try{
    if(!map||!Object.keys(map).length) return 0;
    // भर जाए तो lsSet ख़ुद पुराने backup हटाकर दोबारा कोशिश करता है और "storage-full" log एक ही बार
    // (पहले यहां हर श्रेणी पर अलग "paid-backup-fail" — 13/10 को एक अपलोड पर 15 पंक्तियां)
    if(!lsSet("vt_paidbk_"+cKey(hq,cat),JSON.stringify({t:Date.now(),m:map}),"paid-backup")) return 0;
    return Object.keys(map).length;
  }catch(e){ logErr("paid-backup-fail",e,hq+"/"+cat); return 0; }
}
function fbDel(hq,cat,cb){
  // हटाने से पहले paid records का backup — ताकि "हटाएं → अपलोड" में वसूली न उड़े
  var old=cGet(hq,cat)||[],bk={};
  old.forEach(function(e){
    if(e&&e.acc&&e.status==="paid")bk[String(e.acc).trim()]=paidBkEntry(e);
  });
  savePaidBackup(hq,cat,bk);
  // बाकी (अवसूल) उपभोक्ताओं के रिमार्क का भी backup — ऊपर वाला सिर्फ़ "वसूल" का रखता था, इसलिए
  // "हटाएं → अपलोड" के बाद बाकी उपभोक्ताओं पर लिखे रिमार्क हमेशा के लिए मिट जाते थे (JE की शिकायत,
  // बीबी)। अपलोड इसे _upCollectOldRemarks() में वापस लेता है (देखें js/upload.js)
  try{
    var rbk={};
    (cGet(hq,cat)||[]).forEach(function(e){
      if(e&&e.acc&&e.remarksArr&&e.remarksArr.length) rbk[String(e.acc).trim()]=e.remarksArr;
    });
    if(Object.keys(rbk).length)lsSet("vt_rmkbk_"+cKey(hq,cat),JSON.stringify({t:Date.now(),m:rbk}),"rmk-backup");
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

// ── OFFLINE STORAGE: data device पर save रहता है, बिना नेट भी app पूरा चलता है ──
var LS_PREFIX="dc_cache3_";
function cKey(hq,cat){return hq+"_"+cat;}
function cGet(hq,cat){
  var k=cKey(hq,cat);
  _noteListUse(k);
  if(CACHE[k]===undefined){
    // IndexedDB तैयार होने पर सब सूचियां पहले ही CACHE में आ चुकी होती हैं (cacheInit) — यहां सिर्फ़
    // पुराना रास्ता: IndexedDB न खुला हो, या उसके तैयार होने से पहले कोई सूची मांगी गई
    try{var s=localStorage.getItem(LS_PREFIX+k);CACHE[k]=s?JSON.parse(s).map(migrateRemarks):[];}catch(e){CACHE[k]=[];}
  }
  return CACHE[k]||[];
}
// v9.234: हर cSet पर बढ़ता है — list.js का सब-सूचियों वाला रिमार्क-index (remarksAll) इसी से जानता है कि दोबारा बनाना है
var _cacheGen=0;
function cSet(hq,cat,d){
  var k=cKey(hq,cat);
  CACHE[k]=d;
  _cacheGen++;
  _noteListUse(k);
  _listNeedDone(k);
  _listsBcPost(k,d);
  if(!_cacheReady){ _cacheDirty[k]=true; return; } // cacheInit ख़ुद लिख देगा
  if(_cacheDb){ _idbPut(k,d,hq+"/"+cat); return; }
  if(_cacheSlow){ _cacheDirty[k]=true; return; } // v9.249: IndexedDB देर से खुलेगा — तब तक memory में, localStorage में नहीं
  if(!lsSet(LS_PREFIX+k,JSON.stringify(d),"cache")) _etagDrop(hq+"/"+cat);
}
// v9.222: सूची फ़ोन में save न हो पाए तो उसका ETag ("सर्वर पर कौन-सा version") भी हटाएं। असली production
// (13–14/10): जगह भरी होने से नया लेजर फ़ोन में save नहीं हुआ (पुरानी सूची पड़ी रही), पर नया ETag save हो
// गया — अगली बार सर्वर ने "कुछ नहीं बदला" (304) कहा और ऐप पुरानी सूची को ही ताज़ा मानता रहा। फिर
// reconcileHQ ("किसी एक में वसूल = सब में वसूल") ने पिछले लेजर की वसूली नए लेजर में चढ़ाकर सर्वर पर भेज दी —
// आदेगांव/जोबा/पाटन/बीबी में रातों-रात सैकड़ों पुरानी "वसूल"। ETag न हो तो अगली बार पूरी सूची सर्वर से आती है
function _etagDrop(ek){
  try{
    var a=JSON.parse(localStorage.getItem("dc_etag3")||"{}")||{};
    if(a[ek]===undefined) return;
    delete a[ek];
    localStorage.setItem("dc_etag3",JSON.stringify(a));
  }catch(e){}
}

// ── v9.227: फ़ोन से हटाई गई सूचियां "सर्वर से लानी बाक़ी" ──
// JE (14/10): v9.222 की एक-बार सफ़ाई के बाद Replace अपलोड किया तो बकायादारों के पुराने रिमार्क चले गए — अपलोड
// पुराने रिमार्क (और वसूली) फ़ोन में रखी सूचियों से उठाता है (upload.js: _upCollectOldRemarks), और वे सूचियां
// फ़ोन से हट चुकी थीं। अब जो सूची फ़ोन से हटाई जाए (_cacheStaleReset, cachePruneUnused) उसे यहां "बाक़ी" लिखते हैं;
// सर्वर से आते ही (cSet) निशान हटता है। अपलोड इसे देखकर पहले उस HQ की सूचियां ताज़ा करता है (confirmUpload)
var LIST_NEED_KEY="dc_listneed1";
function _listNeedAll(){ try{ return JSON.parse(localStorage.getItem(LIST_NEED_KEY)||"{}")||{}; }catch(e){ return {}; } }
function _listNeedMark(keys){
  if(!keys.length) return;
  var a=_listNeedAll();
  keys.forEach(function(k){ a[k]=1; });
  try{ localStorage.setItem(LIST_NEED_KEY,JSON.stringify(a)); }catch(e){}
}
function _listNeedDone(k){
  var a=_listNeedAll();
  if(!a[k]) return;
  delete a[k];
  try{ localStorage.setItem(LIST_NEED_KEY,JSON.stringify(a)); }catch(e){}
}
// जिन फ़ोनों पर v9.222 की सफ़ाई v9.227 से पहले हो चुकी (जैसे JE फ़ोन) — उनके लिए एक बार (main.js, श्रेणी-नाम
// लोड होने के बाद — वरना बदले नाम वाली श्रेणियों की key ग़लत बनती): फ़ोन में जो सूची
// अभी नहीं है (या ख़ाली है) उसे "लानी बाक़ी" मानें। सर्वर पर सचमुच ख़ाली हो तो पहली ताज़गी पर निशान हट जाता है
function _listNeedInit(){
  try{
    if(localStorage.getItem("dc_listneed_init")) return;
    if(!_cacheResetThisBoot&&localStorage.getItem(CACHE_RESET_FLAG)){
      var miss=[];
      HQS.forEach(function(hq){
        for(var i=0;i<CATS_DEFAULT.length;i++){
          var k=cKey(hq,isCatEditable(i)?getCatName(hq,i):CATS_DEFAULT[i]);
          if(!(CACHE[k]&&CACHE[k].length)) miss.push(k);
        }
      });
      _listNeedMark(miss);
    }
    localStorage.setItem("dc_listneed_init","1");
  }catch(e){}
}
// इस HQ की कौन-सी श्रेणियां सर्वर से लानी बाक़ी हैं (नाम)
function listsNeedFetch(hq){
  var a=_listNeedAll(), out=[];
  for(var i=0;i<CATS_DEFAULT.length;i++){
    var c=isCatEditable(i)?getCatName(hq,i):CATS_DEFAULT[i];
    if(a[cKey(hq,c)]) out.push(c);
  }
  return out;
}

// ── v9.223: 30 दिन से न खोली/न बदली सूचियां फ़ोन से हटें ──
// लाइनमैन फ़ोन में कभी दूसरे HQ से login हुआ हो तो उसकी पूरी सूचियां (~1 MB) हमेशा पड़ी रहती थीं (13/10 के लॉग:
// SOHAN/बीबी और Vaibhav/पाटन के फ़ोन में आदेगांव की "कुल उपभोक्ता"), और नाम बदली श्रेणियों की पुरानी सूचियां भी
// (JE फ़ोन: 89 सूचियां, असली 48)। हर सूची का "आख़िरी इस्तेमाल का दिन" याद रखते हैं (दिन में एक बार लिखा जाता
// है); 30 दिन बीतें और बिना-भेजी वसूली न हो तो हटती है। ज़रूरत पड़े तो खोलते ही सर्वर से फिर आ जाती है
var LIST_USED_KEY="dc_listused1", LIST_UNUSED_DAYS=30;
/** @type {Object<string,number>|null} */ var _listUsed=null;
function _listUsedLoad(){
  if(_listUsed) return _listUsed;
  try{ _listUsed=JSON.parse(localStorage.getItem(LIST_USED_KEY)||"{}")||{}; }catch(e){ _listUsed={}; }
  return _listUsed;
}
function _noteListUse(k){
  var u=_listUsedLoad(), day=Math.floor(Date.now()/86400000);
  if(u[k]===day) return;
  u[k]=day;
  try{ localStorage.setItem(LIST_USED_KEY,JSON.stringify(u)); }catch(e){}
}
// ऐप खुलने के कुछ सेकंड बाद एक बार (main.js) — लौटाता है कितनी हटीं
function cachePruneUnused(){
  if(!_cacheReady) return 0;
  var u=_listUsedLoad(), today=Math.floor(Date.now()/86400000), pend=getPending(), gone=[];
  Object.keys(CACHE).forEach(function(k){
    if(pend[k]) return;
    if(u[k]===undefined){ u[k]=today; return; } // पहली बार दिखी — आज से गिनती (बिना जाने न हटाएं)
    if(today-u[k]>LIST_UNUSED_DAYS) gone.push(k);
  });
  _listNeedMark(gone);
  gone.forEach(function(k){
    delete CACHE[k]; delete u[k];
    try{ localStorage.removeItem(LS_PREFIX+k); }catch(e){}
    var hq=(typeof HQS!=="undefined"?HQS:[]).filter(function(h){ return k.indexOf(h+"_")===0; })[0];
    if(hq) _etagDrop(hq+"/"+k.slice(hq.length+1));
  });
  if(_cacheDb&&gone.length){
    try{ var st=_cacheDb.transaction(CACHE_DB_STORE,"readwrite").objectStore(CACHE_DB_STORE); gone.forEach(function(k){ st.delete(k); }); }catch(e){}
  }
  try{ localStorage.setItem(LIST_USED_KEY,JSON.stringify(u)); }catch(e){}
  if(gone.length) logErr("cache-prune",LIST_UNUSED_DAYS+" दिन से न खुली "+gone.length+" सूचियां फ़ोन से हटीं",gone.slice(0,6).join(", ").slice(0,190));
  return gone.length;
}

// ── v9.221: ऐप दो जगह एक साथ खुला (Chrome टैब + इंस्टॉल ऐप) ──
// हर टैब की सूचियां उसकी अपनी memory (CACHE) में रहती हैं। पहले: टैब-1 में वसूली दर्ज हुई, फिर टैब-2 ने
// अपनी (पुरानी) memory वाली सूची में दूसरी वसूली दर्ज करके पूरी सूची फ़ोन में लिख दी — टैब-1 वाली वसूली
// फ़ोन की copy से मिट गई (नए "field-conditions" टेस्ट ने पकड़ा; 13/10 को Vikas के फ़ोन पर ऐप दो जगह
// खुला मिला था)। अब हर बदली सूची बाक़ी खुले टैबों को भी भेजी जाती है (सिर्फ़ इसी फ़ोन के अंदर — नेट नहीं),
// और वे अपनी memory उसी से बदल लेते हैं; दिख रही सूची हो तो दोबारा बनाते हैं
/** @type {BroadcastChannel|null} */ var _listsBc=null;
try{ if(typeof BroadcastChannel!=="undefined") _listsBc=new BroadcastChannel("dc_lists"); }catch(e){}
function _listsBcPost(k,d){ try{ if(_listsBc) _listsBc.postMessage({k:k,d:d}); }catch(e){} }
if(_listsBc) _listsBc.onmessage=function(ev){
  var m=ev&&ev.data;
  if(!m||typeof m.k!=="string"||!Array.isArray(m.d)) return;
  CACHE[m.k]=m.d; // लिखाई भेजने वाला टैब कर चुका — यहां सिर्फ़ memory
  _cacheGen++;
  try{
    if(typeof CU!=="undefined"&&CU&&typeof activeHQ!=="undefined"&&cKey(activeHQ,activeCat)===m.k
      &&document.getElementById("app-screen").classList.contains("active")) renderList();
  }catch(e){}
};

// ── v9.220: सूचियों का cache IndexedDB में ──
// v9.219 के "storage-full" लॉग (13/10): JE फ़ोन ही नहीं, लाइनमैन फ़ोन भी भरे — localStorage की सीमा
// ~5M अक्षर, और "कुल उपभोक्ता" की एक सूची ही ~1M (आदेगांव 1050K, पाटन 808K)। cache न बचे तो बिना
// नेट ऐप में अपनी ही सूची नहीं खुलती, और हर बार खुलने पर पूरी सूची दोबारा उतरती है।
// IndexedDB की सीमा फ़ोन की खाली जगह के हिसाब से सैकड़ों MB है। ढांचा वही रखा: ऐप खुलते ही सारी
// सूचियां memory (CACHE) में, cGet पहले जैसा तुरंत; cSet memory में + पीछे IndexedDB में लिखता है।
// पहली बार localStorage वाली सारी सूचियां IndexedDB में जाती हैं और वहां से हटती हैं — localStorage
// offline queue/लॉग जैसी छोटी पर ज़रूरी चीज़ों के लिए खाली हो जाता है।
// IndexedDB न खुले (पुराना/अजीब browser, private mode) तो सब कुछ पहले जैसा localStorage में।
var CACHE_DB_NAME="dc_lists", CACHE_DB_STORE="lists", CACHE_INIT_MAX_MS=4000;
/** @type {IDBDatabase|null} */ var _cacheDb=null;
var _cacheReady=false;
/** @type {Object<string,boolean>} */ var _cacheDirty={}; // तैयार होने से पहले cSet हुई सूचियां
/** @type {Array<Function>} */ var _cacheWaiters=[];
var _cacheInitStarted=false;
// ── v9.249 (JE फ़ोन 24/10: cache-idb-slow ×3, फिर storage-full) ──
// IndexedDB 4 सेकंड में न खुला तो पहले पूरा session localStorage पर चलता — 1 MB की सूचियां वहां लिखी जातीं और
// ~5 MB भर जाता (GitHub Pages पर JE के सारे ऐप वही जगह बांटते हैं; LAKHNADON वाला 1.2 MB), और IndexedDB देर
// से खुलता भी तो छोड़ दिया जाता (फ़ोन में रखी सूचियां उस session में दिखती ही नहीं)। अब: तब तक सूचियां सिर्फ़
// memory में (_cacheSlow), localStorage में नहीं; IndexedDB खुलते ही अपनाया (_cacheAdopt) — उसकी सूचियां दिखें,
// इस बीच बदली सूचियां उसमें लिखी जाएं। बिना भेजी वसूली (queue) पहले की तरह localStorage में — वह छोटी है।
// सूची save न हुई हो तो उसका ETag नहीं सहेजते (_cacheUnsaved — v9.222 वाली बासी-सूची घटना)
var _cacheSlow=false;
function _cacheUnsaved(hq,cat){ return _cacheSlow&&!!_cacheDirty[cKey(hq,cat)]; }
/** @param {IDBDatabase} db */
function _cacheAdopt(db){
  _cacheLoadAll(db,function(ok){
    if(!ok||!_cacheSlow) return;
    _cacheSlow=false; _cacheDb=db; _cacheGen++;
    var dirty=_cacheDirty; _cacheDirty={};
    Object.keys(dirty).forEach(function(k){ if(CACHE[k]) _idbPut(k,CACHE[k]); });
    logErr("cache-idb-late","IndexedDB देर से खुला — अपनाया ("+Object.keys(dirty).length+" बदली सूची लिखी)");
    try{
      if(typeof CU!=="undefined"&&CU&&typeof activeHQ!=="undefined"&&activeHQ&&typeof renderListWith==="function"){
        var d=cGet(activeHQ,activeCat); renderSummaryWith(d); renderListWith(d);
      }
    }catch(e){}
  });
}
// Chrome से "यह डेटा जगह कम होने पर अपने-आप न मिटाना" — बिना पॉप-अप, मिले न मिले कोई फ़र्क़ नहीं
function _cachePersist(){
  try{
    if(navigator.storage&&navigator.storage.persisted&&navigator.storage.persist){
      navigator.storage.persisted().then(function(p){ if(!p) return navigator.storage.persist(); }).catch(function(){});
    }
  }catch(e){}
}
/** @param {string} k @param {any} d @param {string} [ek] ETag की key (hq/cat) */
function _idbPut(k,d,ek){
  try{
    var tx=_cacheDb.transaction(CACHE_DB_STORE,"readwrite");
    tx.objectStore(CACHE_DB_STORE).put(d,k);
    tx.oncomplete=function(){ try{ if(localStorage.getItem(LS_PREFIX+k)!==null) localStorage.removeItem(LS_PREFIX+k); }catch(e){} };
    tx.onerror=tx.onabort=function(){ _idbFail(k,d,tx.error,ek); };
  }catch(e){ _idbFail(k,d,e,ek); }
}
/** @param {string} k @param {any} d @param {any} err @param {string} [ek] */
function _idbFail(k,d,err,ek){
  if(!_lsFullLogged.idb){ _lsFullLogged.idb=true; logErr("cache-idb-fail",err||"?",k.slice(0,40)); }
  // कम से कम पुराने रास्ते से बचाने की कोशिश — वह भी न हो तो ETag हटाएं (ऊपर _etagDrop वाली वजह)
  if(!lsSet(LS_PREFIX+k,JSON.stringify(d),"cache")&&ek) _etagDrop(ek);
}
// ऐप खुलते ही एक बार — तैयार होने (या CACHE_INIT_MAX_MS) पर cb। दोबारा बुलाने पर बस इंतज़ार
/** @param {Function} [cb] */
function cacheInit(cb){
  if(_cacheReady){ if(cb) cb(); return; }
  if(cb) _cacheWaiters.push(cb);
  if(_cacheInitStarted) return;
  _cacheInitStarted=true;
  var done=function(db){
    if(_cacheReady) return;
    _cacheReady=true; _cacheDb=db;
    _cacheStaleReset(db);
    // तैयार होने से पहले बदली सूचियां अब सही जगह लिखें
    if(db||!_cacheSlow){
      Object.keys(_cacheDirty).forEach(function(k){
        if(db) _idbPut(k,CACHE[k]); else lsSet(LS_PREFIX+k,JSON.stringify(CACHE[k]),"cache");
      });
      _cacheDirty={};
    }
    var w=_cacheWaiters; _cacheWaiters=[];
    w.forEach(function(f){ try{ f(); }catch(e){ logErr("cache-init-cb",e); } });
  };
  _cachePersist();
  var timer=setTimeout(function(){ _cacheSlow=true; logErr("cache-idb-slow","IndexedDB "+CACHE_INIT_MAX_MS/1000+" सेकंड में नहीं खुला — खुलने तक सूचियां memory में"); done(null); },CACHE_INIT_MAX_MS);
  var fin=function(db){ clearTimeout(timer); done(db); };
  try{
    if(typeof indexedDB==="undefined") return fin(null);
    var rq=indexedDB.open(CACHE_DB_NAME,1);
    rq.onupgradeneeded=function(){ rq.result.createObjectStore(CACHE_DB_STORE); };
    // सचमुच नहीं खुलेगा — पुराना रास्ता (localStorage); slow वाली memory-सूचियां भी अब वहीं
    var noIdb=function(){ if(_cacheSlow){ _cacheSlow=false; Object.keys(_cacheDirty).forEach(function(k){ lsSet(LS_PREFIX+k,JSON.stringify(CACHE[k]),"cache"); }); _cacheDirty={}; } fin(null); };
    rq.onerror=function(){ logErr("cache-idb-open",rq.error||"?"); noIdb(); };
    rq.onblocked=function(){ noIdb(); };
    rq.onsuccess=function(){
      var db=rq.result;
      if(_cacheReady){ if(_cacheSlow) _cacheAdopt(db); return; } // v9.249: देर से खुला — अब अपनाएं
      _cacheLoadAll(db,function(ok){ fin(ok?db:null); });
    };
  }catch(e){ logErr("cache-idb-open",e); fin(null); }
}
// ── v9.222: फ़ोन में पड़ी बासी सूचियां एक बार हटाएं (ऊपर _etagDrop वाली घटना) ──
// जिस फ़ोन की जगह कभी भरी थी, उसमें पिछले लेजर की सूची "ताज़ा" बनकर पड़ी हो सकती है, और उसका reconcileHQ
// वही पुरानी वसूली फिर सर्वर पर भेज देगा। कौन-सी सूची बासी है यह फ़ोन ख़ुद नहीं जान सकता, इसलिए v9.222 के
// पहली बार खुलने पर सारी सूचियां और सारे ETag एक बार हटते हैं — सूचियां सर्वर से पूरी ताज़ा आती हैं (एक बार का
// डेटा: लाइनमैन ~1–2 MB, JE ~9 MB)। जिस सूची में बिना-भेजी वसूली (offline queue) हो वह नहीं हटती — वह वसूली न खोए
var CACHE_RESET_FLAG="dc_cachefix1";
/** @param {IDBDatabase|null} db */
var _cacheResetThisBoot=false;
function _cacheStaleReset(db){
  try{ if(localStorage.getItem(CACHE_RESET_FLAG)) return; }catch(e){ return; }
  _cacheResetThisBoot=true; // इसी बार हुई — हटाई सूचियां नीचे ख़ुद "लानी बाक़ी" लिखी जाती हैं (_listNeedInit की ज़रूरत नहीं)
  var pend=getPending(), n=0, keys={};
  Object.keys(CACHE).forEach(function(k){ keys[k]=1; });
  try{ for(var i=0;i<localStorage.length;i++){ var lk=localStorage.key(i)||""; if(lk.indexOf(LS_PREFIX)===0) keys[lk.slice(LS_PREFIX.length)]=1; } }catch(e){}
  var gone=Object.keys(keys).filter(function(k){ return !pend[k]&&!_cacheDirty[k]; });
  _listNeedMark(gone);
  gone.forEach(function(k){
    if(CACHE[k]&&CACHE[k].length) n++;
    delete CACHE[k];
    try{ localStorage.removeItem(LS_PREFIX+k); }catch(e){}
  });
  if(db&&gone.length){
    try{
      var st=db.transaction(CACHE_DB_STORE,"readwrite").objectStore(CACHE_DB_STORE);
      gone.forEach(function(k){ st.delete(k); });
    }catch(e){}
  }
  try{ localStorage.removeItem("dc_etag3"); localStorage.setItem(CACHE_RESET_FLAG,String(Date.now())); }catch(e){}
  // v9.225: login वाला prefetch दिन में एक बार चलता है — सूचियां हटाने के बाद उसका "आज हो चुका" निशान भी हटे, वरना
  // अगले 24 घंटे वे सूचियां फ़ोन में आती ही नहीं (JE फ़ोन पर "कर्मचारी सक्रियता" में सबका काम "—", 14/10)
  try{ Object.keys(localStorage).forEach(function(lk){ if(lk.indexOf("dc_prefetch_")===0) localStorage.removeItem(lk); }); }catch(e){}
  if(n) logErr("cache-reset","फ़ोन की पुरानी सूचियां हटाईं — अब सर्वर से ताज़ा आएंगी (v9.222, एक बार)",n+" सूची • बिना-भेजी वसूली वाली रखीं: "+Object.keys(pend).length);
}

// IndexedDB की सारी सूचियां CACHE में; फिर localStorage में बची पुरानी सूचियां IndexedDB में ले जाएं
function _cacheLoadAll(db,cb){
  try{
    var tx=db.transaction(CACHE_DB_STORE,"readwrite"), st=tx.objectStore(CACHE_DB_STORE);
    var cur=st.openCursor();
    cur.onsuccess=function(){
      var c=cur.result;
      if(c){
        var k=String(c.key);
        // ऐप ने इस बीच इसे बदला हो तो memory वाली ही सही
        if(!_cacheDirty[k]) CACHE[k]=Array.isArray(c.value)?c.value:[];
        c.continue();
        return;
      }
      // localStorage से migration — उसी transaction में, ताकि सब एक साथ हो
      var lsKeys=[];
      try{ for(var i=0;i<localStorage.length;i++){ var lk=localStorage.key(i)||""; if(lk.indexOf(LS_PREFIX)===0) lsKeys.push(lk); } }catch(e){}
      lsKeys.forEach(function(lk){
        var k=lk.slice(LS_PREFIX.length);
        // localStorage में सूची तभी बचती है जब अभी migration हुआ ही न हो, या IndexedDB की लिखाई
        // नाकाम होकर वहां गई हो (_idbFail) — दोनों में वही ताज़ा
        if(!_cacheDirty[k]){
          try{ CACHE[k]=JSON.parse(localStorage.getItem(lk)||"[]").map(migrateRemarks); }catch(e){ return; }
        }
        st.put(CACHE[k],k);
      });
      tx.oncomplete=function(){
        lsKeys.forEach(function(lk){ try{ localStorage.removeItem(lk); }catch(e){} });
        cb(true);
      };
    };
    tx.onerror=tx.onabort=function(){ logErr("cache-idb-load",tx.error||"?"); cb(false); };
  }catch(e){ logErr("cache-idb-load",e); cb(false); }
}

// ── v9.219: फ़ोन की जगह (localStorage) भर जाए तो ──
// असली production (13/10, JE फ़ोन, नए लेजर अपलोड के वक़्त): "vt_paidbk_… exceeded the quota" — 15 बार।
// जांच में दो बातें निकलीं: (1) vt_paidbk_/vt_rmkbk_ backup सिर्फ़ 7 दिन काम आते हैं (upload.js,
// RMK_BK_MAX_AGE_MS), पर कभी मिटते नहीं थे — हर अपलोड पर ढेर बढ़ता गया; (2) cSet और offline queue
// (setPendingObj) quota भरने पर चुपचाप नाकाम होते थे — न log, न संदेश। cache न बचे तो हर बार ऐप
// खुलने पर वही सूची पूरी दोबारा उतरती है (ETag तभी चलता है जब cache हो — database.js), और queue न बचे
// तो बिना नेट दर्ज वसूली ऐप बंद होते ही खो सकती है।
// अब: हर लिखाई lsSet से — भरने पर पहले 7 दिन से पुराने backup मिटाकर दोबारा कोशिश; फिर भी न हो तो
// "storage-full" log (हर तरह का एक बार प्रति खुलना) जिसमें जगह का हिसाब हो, ताकि अगला कदम नाप पर तय हो
var LS_BK_PREFIXES=["vt_paidbk_","vt_rmkbk_"], LS_BK_MAX_AGE_MS=7*24*60*60*1000;
/** @type {Object<string,boolean>} */ var _lsFullLogged={};
// 7 दिन से पुराने (या टूटे) backup हटाएं — लौटाता है कितने हटे
function lsPurgeOldBackups(){
  var gone=0, now=Date.now(), keys=[];
  try{ for(var i=0;i<localStorage.length;i++) keys.push(localStorage.key(i)); }catch(e){ return 0; }
  keys.forEach(function(k){
    if(!k||!LS_BK_PREFIXES.some(function(p){return k.indexOf(p)===0;})) return;
    var t=0;
    try{ t=(JSON.parse(localStorage.getItem(k)||"{}")||{}).t||0; }catch(e){}
    if(now-t>=LS_BK_MAX_AGE_MS){ try{ localStorage.removeItem(k); gone++; }catch(e){} }
  });
  return gone;
}
// जगह का हिसाब (हज़ार अक्षरों में): कुल / सूचियों का cache / backup / सबसे बड़ी key
function lsUsageNote(){
  var tot=0, cache=0, bk=0, nCache=0, big="", bigN=0;
  try{
    for(var i=0;i<localStorage.length;i++){
      var k=localStorage.key(i)||"", n=k.length+(localStorage.getItem(k)||"").length;
      tot+=n;
      if(k.indexOf(LS_PREFIX)===0){ cache+=n; nCache++; }
      else if(LS_BK_PREFIXES.some(function(p){return k.indexOf(p)===0;})) bk+=n;
      if(n>bigN){ bigN=n; big=k; }
    }
  }catch(e){}
  var K=function(n){return Math.round(n/1000)+"K";};
  return "कुल "+K(tot)+" • cache "+K(cache)+" ("+nCache+" सूची) • backup "+K(bk)+" • सबसे बड़ी "+big+" "+K(bigN);
}
// localStorage.setItem — भरने पर पुराने backup हटाकर एक बार दोबारा। लौटाता है सफल हुआ या नहीं
function lsSet(key,val,kind){
  try{ localStorage.setItem(key,val); return true; }catch(e){
    if(lsPurgeOldBackups()>0){ try{ localStorage.setItem(key,val); return true; }catch(e2){} }
    if(!_lsFullLogged[kind]){
      _lsFullLogged[kind]=true;
      logErr("storage-full",e,kind+" • "+key.slice(0,40)+" • "+Math.round(val.length/1000)+"K • "+lsUsageNote());
    }
    return false;
  }
}

// ── OFFLINE SYNC QUEUE: offline बदलाव queue में, नेट आते ही अपने आप Firebase sync ──
var PENDING_KEY="dc_pending3";
// 401/403 का मतलब है यह account/device उस HQ/श्रेणी के डेटा के लिए अधिकृत ही नहीं (जैसे किसी और
// HQ का लाइनमैन बना device जिस पर पहले किसी और HQ का काम बचा रह गया था) — नेटवर्क वापस आने पर भी
// दोबारा कोशिश करते रहने से कभी सफलता नहीं मिलेगी, इसलिए इतनी बार लगातार 401/403 के बाद हर 20 सेकंड
// वाला auto-retry रोक दो (असली production log में यही 401 महीनों घंटों तक हर 20 सेकंड दोहराता मिला)।
// डेटा device पर सुरक्षित रहता है, बस चुपचाप हैमर करना बंद — और एक बार साफ़ चेतावनी दिखा दो।
var STUCK_AUTH_MAX=3;
function getPending(){try{return JSON.parse(localStorage.getItem(PENDING_KEY))||{};}catch(e){return {};}}
var _pendFullToastAt=0;
function setPendingObj(p){
  // queue न बचे तो बिना नेट दर्ज वसूली ऐप बंद होने पर खो सकती है — इसलिए यहां स्क्रीन पर भी बताएं
  if(lsSet(PENDING_KEY,JSON.stringify(p),"pending")||typeof toast!=="function") return;
  if(Date.now()-_pendFullToastAt<60000) return; // हर लिखाई पर नहीं — मिनट में एक बार
  _pendFullToastAt=Date.now();
  toast("⚠️ फ़ोन की जगह भर गई — नेट चालू करके ऐप खुला रखें ताकि वसूली सर्वर पर चली जाए","err");
}
function _bumpAuthFail(k,err){
  var p=getPending();
  var entry=p[k];
  if(!entry) return;
  var msg=(err&&err.message)||"";
  // App Check token ही न हो (या सर्वर ने App Check की वजह से मना किया हो) तो यह खाते/PIN की
  // गड़बड़ी नहीं — "अटकी" गिनती में न जोड़ें। असली production (8–9/10, पाटन/Neeku sarraty):
  // reCAPTCHA ने 27 घंटे token नहीं दिया (Google की काली सूची के दौरान); तीन 401 पर वसूली "अटकी"
  // मानकर अपने-आप भेजना बंद हो जाता, और token लौटने पर भी ऐप बंद-खोलने तक अटकी रहती
  var acMissing=(typeof AC_TOKEN!=="undefined"&&!AC_TOKEN)||/app ?check/i.test((err&&err.body)||"");
  if(/HTTP (401|403)/.test(msg)&&acMissing){
    p[k]=entry; setPendingObj(p); // गिनती जैसी है वैसी — token लौटते ही _acNoteOk भेज देगा
    return;
  }
  // v9.248: उस वक़्त खाता ही नहीं/अनाम था — यह "इस HQ के लिए अधिकृत नहीं" नहीं, गिनती न बढ़े
  // (पर सही HQ खाते से जुड़ने की कोशिश ज़रूर — यही 401 की असली वजह है; _ensureCorrectHqAuth का अपना guard है)
  if(/HTTP (401|403)/.test(msg)&&typeof _fbAcctNone==="function"&&_fbAcctNone()){
    p[k]=entry; setPendingObj(p);
    try{_ensureCorrectHqAuth();}catch(e){}
    return;
  }
  if(/HTTP (401|403)/.test(msg)){
    entry.authFailCount=(entry.authFailCount||0)+1;
    // हार मानने से पहले खुद ठीक होने की एक कोशिश: 401 की सबसे आम वजह यह है कि device सही HQ
    // account की जगह anonymous पर है। _ensureCorrectHqAuth सही account से दोबारा sign-in करके
    // अटका डेटा अपने आप भेज देता है (उसमें अपना guard है, इसलिए बार-बार नहीं चलेगा)।
    // पहले यह सिर्फ़ "online" event पर होता था — यानी जो device पहले से online था उस पर कभी नहीं
    if(entry.authFailCount===1){ try{_ensureCorrectHqAuth();}catch(e){} }
    if(entry.authFailCount===STUCK_AUTH_MAX){
      logErr("pending-stuck-auth","लगातार "+STUCK_AUTH_MAX+" बार 401/403 — यह account/device "+entry.hq+"/"+entry.cat+" के लिए अधिकृत नहीं लगता, auto-retry रोका। डेटा device पर सुरक्षित है — सही account से login करें या JE को बताएं",entry.hq+"/"+entry.cat);
      toast("⚠️ "+entry.hq+"/"+entry.cat+" के बदलाव भेजे नहीं जा पा रहे (login/account समस्या) — JE को बताएं","err");
    }
  } else {
    entry.authFailCount=0; // असली network-fail वापस आया तो पुरानी auth-fail गिनती मायने नहीं रखती
  }
  p[k]=entry;
  setPendingObj(p);
}
// patch दिया हो (migrated HQ/श्रेणी की per-record बचत) तो पहले से पेंडिंग patch के साथ जोड़ें —
// ताकि नेट आने पर सिर्फ असल बदले records ही PATCH हों, पूरी लिस्ट नहीं
// err दिया हो (असल सेव-प्रयास की fetch error) तो उसी से auth-fail गिनती अपडेट होती है
function markPending(hq,cat,type,patch,err){
  var p=getPending();
  var k=cKey(hq,cat);
  var entry=p[k]||{hq:hq,cat:cat,type:type||"put"};
  entry.type=type||entry.type;
  if(!entry.since) entry.since=Date.now(); // कब से भेजना बाकी — checkOldPending (v9.209)
  if(patch){
    entry.patch=entry.patch||{};
    Object.keys(patch).forEach(function(pk){ entry.patch[pk]=patch[pk]; });
  }
  p[k]=entry;
  setPendingObj(p);
  setSyncStatus(navigator.onLine);
  if(err!==undefined) _bumpAuthFail(k,err);
}
function clearPendingKey(k){var p=getPending();delete p[k];setPendingObj(p);}
// v9.234: भेजे गए records ही "बाक़ी" से हटें — पहले किसी एक उपभोक्ता का सेव सफल होते ही पूरी सूची की entry हटती थी,
// तो उसी सूची में पहले से रुका (offline वाला, या सर्वर-रिमार्क न पढ़ पाने से रुका) दूसरा उपभोक्ता चुपचाप छूट जाता।
// onlySame: तभी हटाओ जब "बाक़ी" वाला रूप वही हो जो भेजा (भेजते-भेजते उसी पर नया बदलाव आया हो तो वह बचे)
function pendingDropRecs(hq,cat,recs,onlySame){
  var p=getPending(),k=cKey(hq,cat),e=p[k];
  if(!e) return;
  if(!e.patch){ delete p[k]; setPendingObj(p); return; }
  Object.keys(recs||{}).forEach(function(rk){
    if(!onlySame||JSON.stringify(e.patch[rk])===JSON.stringify(recs[rk])) delete e.patch[rk];
  });
  if(!Object.keys(e.patch).length) delete p[k];
  setPendingObj(p);
}

// ── v9.209: बहुत देर से अटकी वसूली की चेतावनी ──
// पहले सिर्फ़ login/account वाली अटकन (लगातार 401/403) पकड़ी जाती थी। कोई लाइनमैन 2–3 दिन नेट पर
// न आए, या फ़ोन में बदलाव किसी और वजह से न जा पाएं, तो वसूली फ़ोन में ही पड़ी रहती और JE को पता
// नहीं चलता। अब हर पेंडिंग श्रेणी पर since (कब से) दर्ज है; PENDING_OLD_HRS से ज़्यादा हो तो
// लाइनमैन को स्क्रीन पर संदेश, और JE के एरर लॉग में "pending-old" (नेट न हो तो flushLogs बाद में भेजता है)।
// हर श्रेणी पर दिन में एक बार से ज़्यादा नहीं (oldWarnAt)। पुराने version की entry में since न हो तो
// आज से गिनें — बिना जाने "कई दिन से अटकी" न कहें
var PENDING_OLD_HRS=24;
function checkOldPending(){
  var p=getPending(), now=Date.now(), changed=false;
  /** @type {{hrs:number,cat:string}|null} */ var worst=null;
  Object.keys(p).forEach(function(k){
    var e=p[k];
    if(!e) return;
    if(!e.since){ e.since=now; changed=true; return; }
    var hrs=Math.floor((now-e.since)/3600000);
    if(hrs<PENDING_OLD_HRS) return;
    if(e.oldWarnAt&&now-e.oldWarnAt<PENDING_OLD_HRS*3600000) return;
    e.oldWarnAt=now; changed=true;
    var n=e.patch?Object.keys(e.patch).length:0;
    logErr("pending-old",hrs+" घंटे से "+e.hq+"/"+e.cat+" के बदलाव भेजे नहीं गए",
      (n?n+" उपभोक्ता":"पूरी सूची")+(e.authFailCount?" • 401/403 ×"+e.authFailCount:"")+(navigator.onLine?"":" • अभी नेट नहीं"));
    if(!worst||hrs>worst.hrs) worst={hrs:hrs,cat:e.cat};
  });
  if(changed) setPendingObj(p);
  if(worst&&typeof toast==="function"){
    toast("⚠️ "+worst.hrs+" घंटे से "+worst.cat+" की वसूली/रिमार्क भेजे नहीं गए — नेट चालू करके ऐप खुला रखें, फिर भी न जाएं तो JE को बताएं","err");
  }
  return worst;
}
// नेट हो तो पहले flushPending को मौक़ा दें — वरना दो दिन बाद नेट पर आते ही "48 घंटे से नहीं गए"
// दिखता, जबकि ठीक उसी पल भेजे जा रहे होते। नेट न हो तो तुरंत बताएं
var PENDING_CHECK_DELAY_MS=60000;
var _oldPendTimer=null;
function scheduleOldPendingCheck(){
  if(_oldPendTimer) return;
  _oldPendTimer=setTimeout(function(){
    _oldPendTimer=null;
    if(typeof CU!=="undefined"&&CU) checkOldPending();
  },navigator.onLine?PENDING_CHECK_DELAY_MS:0);
}
// ऐप पर लौटते ही भी जांच (लाइनमैन ऐप बंद नहीं करते, minimize करते हैं) — दिन में एक बार की
// सीमा checkOldPending ख़ुद रखता है
document.addEventListener("visibilitychange",function(){
  if(document.visibilityState==="visible"&&typeof CU!=="undefined"&&CU) scheduleOldPendingCheck();
});
function pendingCount(){return Object.keys(getPending()).length;}
function isPending(hq,cat){return !!getPending()[cKey(hq,cat)];}
// किसी HQ के लिए सही Firebase account से sign-in वापस मिल जाए (देखें ui-core.js: _ensureCorrectHqAuth)
// तो उस HQ की पुरानी "authFailCount" गिनती अब मान्य नहीं रह जाती — वरना flushPending() हमेशा के लिए
// उन entries को छोड़ता रहेगा (देखें नीचे STUCK_AUTH_MAX check), भले ही अब असल में sync हो सकता हो
// App Check token लंबी नाकामी के बाद लौटा — उस दौरान "अटकी" मानी गई सारी entries फिर से भेजने
// लायक़ (वो 401 खाते की वजह से नहीं, token न होने से थे)। _acNoteOk (js/firebase.js) से
function resetAuthFailAll(){
  var p=getPending(),changed=false;
  Object.keys(p).forEach(function(k){
    if(p[k]&&p[k].authFailCount){ p[k].authFailCount=0; changed=true; }
  });
  if(changed) setPendingObj(p);
  return changed;
}
function _resetAuthFailForHQ(hq){
  var p=getPending(),changed=false;
  Object.keys(p).forEach(function(k){
    if(p[k]&&p[k].hq===hq&&p[k].authFailCount){ p[k].authFailCount=0; changed=true; }
  });
  if(changed) setPendingObj(p);
}

// Record-level merge — दूसरों के बदलाव न मिटें
function rmkKeyOf(r){return (r.text||"")+"|"+(r.by||"")+"|"+(r.at||"");}
// ── v9.247 (JE 24/10): एक उपभोक्ता पर ज़्यादा से ज़्यादा 10 रिमार्क — 11वां जुड़ते ही सबसे पुराना हटे (FIFO) ──
// रिमार्क फ़ोनों/सर्वर/सूचियों के बीच "जोड़कर" मिलते हैं (किसी का न मिटे), इसलिए छंटाई हर उस जगह जहां वे जुड़ते
// या मिलते हैं (saveRmk, propagateRemark, breakPromise, mergeRecord, _mergeServerRemarks, अपलोड) — हर फ़ोन पर
// एक ही नियम: समय से सबसे पुराने हटें, ताकि हटा रिमार्क किसी और फ़ोन से लौटे भी तो अगली बार फिर वही हटे।
// चल रहे वादे (🤝 तारीख़ आज या आगे) वाला रिमार्क नहीं हटता — उसकी जगह अगला पुराना। दिखाते वक़्त भी 10 (remarksAll)
var RMK_MAX=10;
// रिमार्क का समय (ms) — "24/10/2026, 9:05:07 pm" (hi-IN) या "2026-10-12"; न पढ़ा जाए तो 0 (सबसे पुराना माना जाए)
function _rmkTs(at){
  var s=String(at==null?"":at), m=s.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\D+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|पूर्वाह्न|अपराह्न)?)?/i);
  if(m){
    var h=+(m[4]||0), ap=(m[7]||"").toLowerCase();
    if(ap==="pm"||ap==="अपराह्न"){ if(h<12) h+=12; } else if((ap==="am"||ap==="पूर्वाह्न")&&h===12) h=0;
    return new Date(+m[3],+m[2]-1,+m[1],h,+(m[5]||0),+(m[6]||0)).getTime()||0;
  }
  m=s.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m?(new Date(+m[1],+m[2]-1,+m[3]).getTime()||0):0;
}
function rmkTrim(arr){
  if(!arr||arr.length<=RMK_MAX) return arr;
  var t=new Date(), today=t.getFullYear()+"-"+String(t.getMonth()+1).padStart(2,"0")+"-"+String(t.getDate()).padStart(2,"0");
  var order=arr.map(function(r,i){ return {r:r,i:i,t:(r&&_rmkTs(r.at))||0,k:r?rmkKeyOf(r):""}; })
    .sort(function(a,b){ return a.t-b.t||(a.k<b.k?-1:a.k>b.k?1:a.i-b.i); }); // पुराना पहले; बराबरी पर हर फ़ोन पर एक ही क्रम
  var drop={}, need=arr.length-RMK_MAX;
  for(var j=0;j<order.length&&need>0;j++){
    var r=order[j].r;
    if(r&&typeof r.due==="string"&&r.due>=today) continue; // चल रहा वादा — रहे
    drop[order[j].i]=1; need--;
  }
  return arr.filter(function(_,i){ return !drop[i]; });
}
function mergeRecord(l,st){
  var base=((l.ts||0)>=(st.ts||0))?l:st;
  var out=JSON.parse(JSON.stringify(base));
  var seen={},arr=[];
  (st.remarksArr||[]).concat(l.remarksArr||[]).forEach(function(r){
    if(!r)return; var k=rmkKeyOf(r);
    if(!seen[k]){seen[k]=1;arr.push(r);}
  });
  out.remarksArr=rmkTrim(arr);
  return out;
}
// Consumer No का मिलान हमेशा खाली जगह हटाकर — असली bug (JE की रिपोर्ट, मढ़ी/कुल उपभोक्ता, 1134019486):
// कहीं acc में आगे-पीछे space रह जाए तो एक ही उपभोक्ता "अलग" मान लिया जाता और सूची में दूसरा card
// जुड़ जाता (Firebase की per-record key हमेशा trimmed acc होती है, इसलिए दोनों तरफ़ ऐसा ही मिलान चाहिए)
function accKeyOf(x){ return (x&&x.acc!=null)?String(x.acc).trim():""; }
// v9.262 (JE 28/10): फ़ोन की copy की ख़ाली entry — न Consumer No, न नाम (या object ही नहीं)। असली उपभोक्ता नहीं
// (सर्वर पर "Missing acc" 0 था), पुराने array-दौर का बचा कचरा — सर्वर से मिलाते वक़्त हटती थी नहीं (बिना acc वाली
// local entry हमेशा रखी जाती थी), इसलिए Satendra/annad के फ़ोन पर हर सेव "5 record बिना Consumer No"
function _isGhostRec(x){ return !x||typeof x!=="object"||(!accKeyOf(x)&&!String(x.name==null?"":x.name).trim()); }
function mergeArrays(local,server){
  local=(local||[]).filter(function(l){ return !_isGhostRec(l); });
  if(!server||!server.length) return local;
  if(!local.length) return server;
  var sMap={};
  server.forEach(function(x){var k=accKeyOf(x);if(k)sMap[k]=x;});
  var usedAcc={};
  var out=local.map(function(l){
    var k=accKeyOf(l);
    if(k&&sMap[k]){usedAcc[k]=1;return mergeRecord(l,sMap[k]);}
    return l;
  });
  server.forEach(function(st){
    var k=accKeyOf(st);
    if(k&&!usedAcc[k]) out.push(st);
  });
  return out;
}

// ── v9.239: "बाक़ी" भेजते वक़्त हर सर्वर-बात पर समय-सीमा ──
// असली production (18/10, पाटन/कुल उपभोक्ता, राजकुमार): पूरी-सूची वाली entry 28 घंटे अटकी रही और लॉग में
// कोई नाकामी नहीं — कमज़ोर नेट पर fetch न पूरा होता न नाकाम, _flushing हमेशा true रहता, और उस बार ऐप खुले
// रहने तक भेजना रुका रहता। अब समय बीतते ही "timeout" error — fin(false), लॉग में वजह, अगली बार फिर कोशिश
var FLUSH_FETCH_MS=60000;      // PATCH/DELETE (छोटे)
var FLUSH_LIST_FETCH_MS=120000; // पूरी सूची उतारना (कुछ MB, धीमे नेट पर)
// v9.240 (19/10, मढ़ी, राजकुमार — v9.239 पर हर कुछ मिनट "timeout"): कई दिन के जमा बदलाव (सैकड़ों उपभोक्ता) एक PATCH में
// जाएं तो धीमे नेट पर 60s कम — भेजे जा रहे आकार के हिसाब से समय (हर 4 KB पर 1s और), 3 मिनट तक
var FLUSH_FETCH_MAX_MS=180000;
function _flushMs(body){ return Math.min(FLUSH_FETCH_MAX_MS,FLUSH_FETCH_MS+Math.floor(String(body||"").length/4096)*1000); }
// timeout के बाद हर 20 सेकंड (ui-core का setInterval) वही भारी कोशिश न दोहराएं — पहले 2 मिनट, फिर 5 मिनट रुकें
// (कमज़ोर नेट पर लाइनमैन का डेटा/बैटरी बचे)। कोई भेजना सफल हो या ऐप दोबारा खुले तो फिर तुरंत। डेटा "बाक़ी" में सुरक्षित रहता है
var FLUSH_BACKOFF_MS=[120000,300000];
var _flushTimeouts=0,_flushBackoffUntil=0,_flushRoundTimeout=false;
// v9.245 (22/10, पाटन, वैभव — 5+ घंटे "Failed to fetch"): फ़ोन "नेट है" कहे पर कनेक्शन बीच में टूटे, तो भी हर 20s
// वही (पूरी सूची उतारने वाली भारी) कोशिश न हो — timeout जैसा ही 2, फिर 5 मिनट रुकें। नेट सच में लौटे ("online") तो तुरंत
function _flushNetErr(e){
  var m=(e&&e.message)||"";
  return m==="timeout"||(navigator.onLine&&/Failed to fetch|NetworkError|Load failed|network (error|connection)/i.test(m));
}
function _flushNoteErr(e){ if(_flushNetErr(e)) _flushRoundTimeout=true; } // एक दौर में कितनी भी सूचियां — गिनती एक
function _fetchT(url,opts,ms){
  var ac=(typeof AbortController!=="undefined")?new AbortController():null;
  var o=opts||{}; if(ac) o.signal=ac.signal;
  var timer=0;
  return Promise.race([
    fetch(url,o),
    new Promise(function(_,rej){ timer=setTimeout(function(){ if(ac){try{ac.abort();}catch(e){}} rej(new Error("timeout")); },ms); })
  ]).then(function(r){ clearTimeout(timer); return r; },function(e){ clearTimeout(timer); throw e; });
}
// key-क्रम से बेफ़िक्र तुलना — mergeRecord नया object बनाता है, सादा JSON.stringify हर record को "बदला" मान लेता
function _stableJson(v){
  if(v===null||typeof v!=="object") return JSON.stringify(v);
  if(Array.isArray(v)) return "["+v.map(_stableJson).join(",")+"]";
  return "{"+Object.keys(v).sort().filter(function(k){return v[k]!==undefined;}).map(function(k){return JSON.stringify(k)+":"+_stableJson(v[k]);}).join(",")+"}";
}
// v9.239: per-record (migrated) सूची की "पूरी सूची" वाली entry — मिलाई हुई copy में से सिर्फ़ वे उपभोक्ता जो
// सर्वर से अलग हैं (पहले पूरी सूची PUT होती थी: कई MB, और बीच में किसी और का बदलाव दब सकता था)।
// हटाना कभी नहीं — mergeArrays सर्वर के सब records रखता है; Consumer No-रहित records per-record में जा ही नहीं सकते
function _mergedPatch(server,merged){
  var sByAcc={},maxO=-1,patch={};
  (server||[]).forEach(function(x){ var k=accKeyOf(x); if(k) sByAcc[k]=x; if(x&&x.o!=null&&Number(x.o)>maxO) maxO=Number(x.o); });
  (merged||[]).forEach(function(x){
    var k=accKeyOf(x); if(!k) return;
    var old=sByAcc[k];
    if(old&&_stableJson(old)===_stableJson(x)) return;
    var rec=JSON.parse(JSON.stringify(x));
    if(rec.o==null) rec.o=(old&&old.o!=null)?old.o:++maxO;
    patch[k]=rec;
  });
  return patch;
}

// v9.264 (JE 30/10): कोई भी लाइनमैन किसी भी HQ में login कर सकता है। हर HQ की सूची सिर्फ़ उसी HQ के Firebase खाते से
// लिखी जा सकती है (Security Rules) — इसलिए लाइनमैन के फ़ोन में दूसरे HQ के रुके बदलाव भेजने की कोशिश बेकार 401 थी और
// तीन बार में "अटकी" गिनी जाती थी। अब वे चुपचाप फ़ोन में रुके रहते हैं, उस HQ में login होते ही (या JE login पर) जाते हैं
function _heldForOtherHq(it){ return !!(CU&&CU.role==="lineman"&&it&&it.hq&&it.hq!==CU.hq); }
function _heldCountOf(it){ return (it&&it.patch&&typeof it.patch==="object")?(Object.keys(it.patch).length||1):1; }
function _heldCountFor(hq){
  var p=getPending(),n=0;
  Object.keys(p).forEach(function(k){ if(p[k]&&p[k].hq===hq) n+=_heldCountOf(p[k]); });
  return n;
}
// "📲 पाटन के 3 बदलाव फ़ोन में रुके हैं — …" (लाइनमैन के login वाले HQ के अलावा); कुछ न हो तो ""
function _otherHqHeldMsg(){
  if(!CU||CU.role!=="lineman") return "";
  var p=getPending(),by={};
  Object.keys(p).forEach(function(k){ var it=p[k]; if(_heldForOtherHq(it)) by[it.hq]=(by[it.hq]||0)+_heldCountOf(it); });
  var hqs=Object.keys(by);
  if(!hqs.length) return "";
  return "📲 "+hqs.map(function(h){ return h+" के "+by[h]; }).join(", ")+" बदलाव फ़ोन में रुके हैं — उस HQ में (नेट के साथ) login करने पर अपने-आप जाएंगे";
}
var _flushing=false;
var _flushWaitTok=false; // v9.260: login token के इंतज़ार में एक ही flush कतार में
function flushPending(){
  if(_flushing||!navigator.onLine||Date.now()<_flushBackoffUntil) return;
  // v9.243: App Check पर्ची नाकाम है — भेजना Firebase को बेकार (unverified) requests ही देगा; पर्ची बनते ही
  // _acNoteOk (firebase.js) यही function फिर बुलाता है
  if(typeof _acBlocked==="function"&&_acBlocked()) return;
  // v9.248: login से पहले/अनाम खाते पर नहीं — असली खाता बनते ही _authAcctReady (firebase.js) फिर बुलाता है
  if(typeof _fbAcctNone==="function"&&AUTH_READY&&_fbAcctNone()){
    // लाइनमैन अंदर है पर खाता अनाम — सही HQ खाते से sign-in की कोशिश (पहले यह पहले 401 पर होती थी; अपना guard है)
    if(CU&&CU.role==="lineman"&&typeof _ensureCorrectHqAuth==="function"&&pendingCount()>0){ try{ _ensureCorrectHqAuth(); }catch(e){} }
    return;
  }
  // v9.260 (Suneel, बीबी, 27/10): login token अभी नहीं (कमज़ोर नेट पर Firebase login देर से) — HQ सूचियां बिना
  // login खाते के लिखी ही नहीं जा सकतीं, हर 20s 401 मिलता रहा। token आते ही (_tokenWaiters) एक बार भेजो
  if(typeof ID_TOKEN!=="undefined"&&!ID_TOKEN&&typeof AUTH_LISTENING!=="undefined"&&AUTH_LISTENING){
    if(!_flushWaitTok){ _flushWaitTok=true; _tokenWaiters.push(function(){ _flushWaitTok=false; flushPending(); }); }
    return;
  }
  var p=getPending();
  var keys=Object.keys(p).filter(function(k){ return !_heldForOtherHq(p[k]); }); // v9.264: दूसरे HQ के — उसी HQ के खाते से
  var needCat=false;
  try{needCat=localStorage.getItem("dc_catpending3")==="1";}catch(e){}
  if(!keys.length&&!needCat) return;
  _flushing=true; _flushRoundTimeout=false;
  var done=0,total=keys.length+(needCat?1:0),okAll=true;
  function fin(ok){
    if(!ok)okAll=false;
    done++;
    if(done>=total){
      _flushing=false;
      if(okAll){ _flushTimeouts=0; _flushBackoffUntil=0; }
      else if(_flushRoundTimeout){
        _flushBackoffUntil=Date.now()+FLUSH_BACKOFF_MS[Math.min(_flushTimeouts,FLUSH_BACKOFF_MS.length-1)];
        _flushTimeouts++;
      }
      setSyncStatus(navigator.onLine);
      if(okAll&&pendingCount()===0) toast("✅ सभी offline बदलाव sync हो गए","ok");
    }
  }
  keys.forEach(function(k){
    var it=p[k];
    if((it.authFailCount||0)>=STUCK_AUTH_MAX){
      // permanently रुका हुआ (देखें _bumpAuthFail) — डेटा सुरक्षित है, बस बार-बार hammer करना बंद
      fin(false);
      return;
    }
    if(it.type==="del"){
      _fetchT(FB+"/"+fbPath(it.hq,it.cat)+".json",{method:"DELETE"},FLUSH_FETCH_MS)
        .then(function(r){if(!r.ok)return _fbHttpErr(r);clearPendingKey(k);setSyncStatus(true);fin(true);})
        .catch(function(e){if(navigator.onLine)logErr("sync-del-fail",e,it.hq+"/"+it.cat+_authDiag(e));_flushNoteErr(e);_bumpAuthFail(k,e);setSyncStatus(false);fin(false);});
      return;
    }
    if(it.patch){
      // migrated HQ/श्रेणी — सिर्फ offline में बदले records PATCH करो; server के बाकी records को हाथ मत लगाओ
      // (इसलिए यहां fetch+merge की ज़रूरत नहीं — PATCH अपने-आप बाकी keys को बिना छेड़े रहने देता है)
      // offline में बने patch में भी भेजने से पहले सर्वर के रिमार्क मिलाओ — इस बीच किसी और ने
      // उसी उपभोक्ता पर रिमार्क डाला हो तो वो न दबे (देखें database.js: _mergeServerRemarks)
      // v9.234: 10 से ज़्यादा records हों तब भी मिलान (10-10 करके); जिनके सर्वर-रिमार्क न पढ़ पाए वो "बाक़ी" में ही रुकें
      var hold=null, sentAs=JSON.parse(JSON.stringify(it.patch)); // मिलान से पहले का रूप — "बाक़ी" से मिलाने को
      _mergeServerRemarks(it.hq,it.cat,it.patch,REMARK_FLUSH_MAX,REMARK_FLUSH_TIMEOUT_MS).then(function(res){
        hold=res.hold;
        var pb=JSON.stringify(res.send);
        return _fetchT(FB+"/"+fbPath(it.hq,it.cat)+".json",{
          method:"PATCH",headers:{"Content-Type":"application/json"},body:pb
        },_flushMs(pb));
      }).then(function(r){
        if(!r.ok)return _fbHttpErr(r);
        pendingDropRecs(it.hq,it.cat,sentAs,true);
        if(hold){
          // since वही रहे — रिमार्क-पढ़ाई बार-बार नाकाम हो तो "pending-old" alert समय पर बने
          markPending(it.hq,it.cat,"put",hold);
          var pp=getPending(); if(pp[k]&&it.since){ pp[k].since=it.since; setPendingObj(pp); }
        }
        updTime();setSyncStatus(!isPending(it.hq,it.cat));
        if(CU&&it.hq===activeHQ&&it.cat===activeCat){var d=cGet(it.hq,it.cat);renderSummaryWith(d);renderListWith(d);}
        fin(true);
      }).catch(function(e){if(navigator.onLine)logErr("sync-patch-fail",e,it.hq+"/"+it.cat+_authDiag(e));_flushNoteErr(e);_bumpAuthFail(k,e);setSyncStatus(false);fin(false);});
      return;
    }
    // put (पुराना array फॉर्मेट) — पहले server data लो, merge करो, फिर save — दोनों के बदलाव बचें
    // (_fbPut को ही बुलाओ, सीधे fetch PUT नहीं — वही एक जगह है जो migrated श्रेणी पर raw array भेजने से बचाती है)
    _fetchT(FB+"/"+fbPath(it.hq,it.cat)+".json?t="+Date.now(),{},FLUSH_LIST_FETCH_MS)
      .then(_fbJson)
      .then(function(d){
        trackUsageOf(d); // offline बदलाव भेजने से पहले वाली पढ़ाई
        // सर्वर का असली रूप ठीक यहीं, हाथ में है — नीचे _fbPut() से पूरी array लिखने से *पहले*
        // इसे दर्ज करना ज़रूरी है। v9.118 में यही जगह छूट गई थी और असली production में माइग्रेशन
        // फिर पलटा (बीबी/3 month nonpayee, v9.118 वाले device से): dc_shape3 हर device पर खाली
        // से शुरू होता है, और यह रास्ता ऐप खुलते ही (main.js का flushPending) चल जाता है — यानी
        // उस list को इस device ने अभी तक एक बार भी पढ़ा नहीं होता, इसलिए lastShape() कुछ नहीं
        // जानता और guard चुपचाप array लिखने दे देता। normList() नीचे रूप मिटा देता है (object हो
        // या array, दोनों से सादी array बनाता है), इसलिए दर्ज करने का मौक़ा बस यही एक है।
        _noteShape(it.hq,it.cat,d);
        var server=normList(d);
        var merged=mergeArrays(cGet(it.hq,it.cat),server);
        cSet(it.hq,it.cat,merged);
        // v9.239: सर्वर पर सूची per-record है — पूरी सूची PUT नहीं, सिर्फ़ अलग उपभोक्ता PATCH (देखें _mergedPatch)
        if(isMigrated(it.hq,it.cat)||_shapeFromShallow(d)==="obj"){
          var mp=_mergedPatch(server,merged), mpN=Object.keys(mp).length;
          var mpDone=function(){
            // भेजते-भेजते इसी सूची में नया बदलाव जुड़ा हो (entry में patch) तो वह "बाक़ी" में बचे
            pendingDropRecs(it.hq,it.cat,mp,true); updTime(); setSyncStatus(!isPending(it.hq,it.cat));
            if(CU&&it.hq===activeHQ&&it.cat===activeCat){renderSummaryWith(merged);renderListWith(merged);}
            fin(true);
          };
          if(!mpN){ mpDone(); return; }
          var mpb=JSON.stringify(mp);
          return _fetchT(FB+"/"+fbPath(it.hq,it.cat)+".json",{
            method:"PATCH",headers:{"Content-Type":"application/json"},body:mpb
          },_flushMs(mpb)).then(function(r){
            if(!r.ok) return _fbHttpErr(r);
            _noteShape(it.hq,it.cat,{});
            mpDone();
          });
        }
        _fbPut(it.hq,it.cat,merged,function(ok){
          if(ok&&CU&&it.hq===activeHQ&&it.cat===activeCat){renderSummaryWith(merged);renderListWith(merged);}
          fin(!!ok);
        });
      })
      .catch(function(e){if(navigator.onLine)logErr("sync-put-fail",e,it.hq+"/"+it.cat+_authDiag(e));_flushNoteErr(e);_bumpAuthFail(k,e);setSyncStatus(false);fin(false);});
  });
  if(needCat){
    var reqs=Object.keys(CAT_NAMES).map(function(hq){
      var hqData={};
      CATS_DEFAULT.forEach(function(_,i){if(isCatEditable(i)&&CAT_NAMES[hq]&&CAT_NAMES[hq][i]!=null)hqData[i]=CAT_NAMES[hq][i];});
      return fetch(FB+"/CAT_NAMES/"+hqKey(hq)+".json",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(hqData)});
    });
    Promise.all(reqs).then(function(){
      try{localStorage.removeItem("dc_catpending3");}catch(e){}
      fin(true);
    }).catch(function(){fin(false);});
  }
}

// ── PREFETCH: login के बाद सभी HQ/category की लिस्ट background में download —
// ताकि हर लिस्ट बिना खोले भी offline available रहे ──
// यह हर cold-start पर चलता था, और यही सबसे बड़ा छुपा हुआ bandwidth खर्च था: लाइनमैन के लिए
// 8 पूरी लिस्ट (1 HQ × 8 श्रेणी), JE के लिए 48 (6 HQ × 8) — हर बार ऐप खुलने पर, चाहे वही लिस्ट
// पहले से device पर सेव हो। मोबाइल पर ऐप दिन में कई बार minimize होकर मरता-खुलता है, तो यह दिन
// में दर्जनों बार दोहराता था। अब दिन में एक बार से ज़्यादा नहीं। इससे कुछ छूटता नहीं —
// जो लिस्ट खुली है वो हमेशा की तरह fbGet()+startListen() से ताज़ा ही रहती है, और पहले prefetch
// की हुई लिस्टें device पर पड़ी रहती हैं (offline इस्तेमाल पर कोई असर नहीं)
var _prefetchRun=false;
var PREFETCH_MIN_GAP_MS=24*60*60*1000;
function _prefetchKey(){
  return "dc_prefetch_"+(CU&&CU.role==="supervisor"?"je":hqKey(CU&&CU.hq));
}
function _prefetchDue(){
  var last=0;
  try{last=parseInt(localStorage.getItem(_prefetchKey())||"0",10)||0;}catch(e){}
  var now=Date.now();
  if(!last||last>now) return true; // कभी हुआ ही नहीं, या फ़ोन की घड़ी पीछे हो गई — भरोसा न करें
  return (now-last)>=PREFETCH_MIN_GAP_MS;
}
// force=true — JE के "सब कुछ दोबारा लाओ" जैसे जान-बूझकर किए गए काम के लिए (अभी कोई caller नहीं)
function prefetchAll(force){
  if(!CU||!navigator.onLine||_prefetchRun) return;
  if(isDataPaused()) return; // 🛑 डेटा बचाओ मोड — force हो तब भी नहीं, यही तो सबसे भारी काम है
  if(!force&&!_prefetchDue()) return;
  _prefetchRun=true;
  var hqs=CU.role==="supervisor"?HQS:[CU.hq];
  var jobs=[];
  hqs.forEach(function(hq){
    for(var i=0;i<CATS_DEFAULT.length;i++){
      jobs.push({hq:hq,cat:isCatEditable(i)?getCatName(hq,i):CATS_DEFAULT[i]});
    }
  });
  var idx=0,got=0;
  (function next(){
    if(idx>=jobs.length){
      _prefetchRun=false;
      // पूरा चक्र सफल हुआ तभी समय दर्ज करें — बीच में नेटवर्क टूटा तो नीचे वाला catch बिना
      // समय लिखे लौटता है, यानी अगली बार ऐप खुलते ही दोबारा पूरी कोशिश होगी
      try{localStorage.setItem(_prefetchKey(),String(Date.now()));}catch(e){}
      if(got>0) toast("📥 "+got+" लिस्ट offline के लिए device पर save हो गईं","inf");
      return;
    }
    var j=jobs[idx++];
    if(isPending(j.hq,j.cat)){next();return;}
    // ETag के साथ — जिस list में कुछ नहीं बदला उस पर Firebase खाली 304 देता है, पूरी list दोबारा
    // नहीं। पहले यहां ETag इस्तेमाल ही नहीं होता था, इसलिए हर device रोज़ अपनी सारी श्रेणियां पूरी
    // दोबारा डाउनलोड करता था — चाहे उनमें एक भी बदलाव न हुआ हो
    var _tag=null;
    fetch(FB+"/"+fbPath(j.hq,j.cat)+".json?t="+Date.now(),{headers:_etagHeaders(j.hq,j.cat)})
      .then(function(r){
        if(r.status===304){ setTimeout(next,250); return null; } // कुछ नहीं बदला — cache पहले से सही
        _tag=r.headers.get("ETag");
        return _fbJson(r).then(function(d){
          trackUsageOf(d); // login वाला prefetch — सभी HQ/श्रेणी, यानी एक भारी खर्च; यह भी गिना जाए
          _noteShape(j.hq,j.cat,d);
          var data=normList(d);
          if(data.length){cSet(j.hq,j.cat,data);_etagSet(j.hq,j.cat,_tag);got++;}
          setTimeout(next,250);
        });
      }).catch(function(){_prefetchRun=false;});
  })();
}

// self-hosted libraries (Excel/CSV) — service worker द्वारा cache होती हैं, इसलिए offline में भी load हो जाती हैं
// ── vendor libs सिर्फ़ ज़रूरत पड़ने पर ही उतरें ─────────────────────────────────────────────
// xlsx.full.min.js ~930KB की है और लाइनमैन उसे कभी छूता ही नहीं (Excel/backup सिर्फ़ JE के पास हैं)।
// sw.js में इसे precache से जान-बूझकर बाहर रखा गया है, और यह lazy-loader भी इसीलिए बना था —
// पर v9.68 (self-hosting) से index.html में इसका सीधा <script> tag भी पड़ा रह गया था, इसलिए वह
// पूरी फ़ाइल हर पहली बार, पेज को रोककर उतरती थी और यह loader उस फ़ाइल के लिए मरा हुआ कोड था।
// अब वे tag हटा दिए गए हैं — हर रास्ता यहीं से जाता है।
// एक ही script दो बार न जुड़े (दो जगह से एक साथ मांग आ सकती है), इसलिए हर src के इंतज़ार करने
// वाले एक जगह जमा होते हैं और script सिर्फ़ एक बार जुड़ती है
var _vendorWaiters={};
function _ensureVendor(src,isLoaded,cb){
  if(isLoaded()){ if(cb)cb(true); return; }
  var w=_vendorWaiters[src];
  if(w){ if(cb)w.push(cb); return; } // पहले से उतर रही है — उसी के साथ इंतज़ार करो
  w=_vendorWaiters[src]=cb?[cb]:[];
  var sc=document.createElement("script");
  sc.src=src;
  function done(ok){
    _vendorWaiters[src]=null; // नाकाम रही हो तो अगली बार दोबारा कोशिश हो सके
    w.splice(0).forEach(function(f){try{f(ok);}catch(e){}});
  }
  sc.onload=function(){done(true);};
  sc.onerror=function(){done(false);};
  document.head.appendChild(sc);
}
function ensureXLSX(cb){ _ensureVendor("vendor/xlsx.full.min.js",function(){return !!window.XLSX;},cb); }
function ensurePapa(cb){ _ensureVendor("vendor/papaparse.min.js",function(){return !!window.Papa;},cb); }
// "नेट आते ही पहले से उतार रखो" वाली warm-up कॉल (ui-core.js का online handler, main.js)।
// सिर्फ़ JE के लिए — Excel/CSV वाले सारे काम (अपलोड, कैश-लिस्ट, बैकअप, गांव-वार Excel) JE के ही
// हैं, लाइनमैन को ये बटन दिखते तक नहीं। पहले यह सबके लिए चलती थी, इसलिए index.html से <script>
// tag हटाने के बाद भी लाइनमैन का फ़ोन वही ~930KB चुपचाप उतारता रहता — यानी सुधार आधा ही होता।
// JE भी क्लिक करते वक़्त on-demand उतार ही लेते हैं (हर caller ensureXLSX(cb) से जाता है), यह
// warm-up सिर्फ़ उस क्षण का इंतज़ार बचाने के लिए है
function ensureLibs(){
  if(!CU||CU.role!=="supervisor") return;
  ensureXLSX(null); ensurePapa(null);
}


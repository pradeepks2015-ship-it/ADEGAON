// ── OFFLINE STORAGE: data device पर save रहता है, बिना नेट भी app पूरा चलता है ──
var LS_PREFIX="dc_cache3_";
function cKey(hq,cat){return hq+"_"+cat;}
function cGet(hq,cat){
  var k=cKey(hq,cat);
  if(CACHE[k]===undefined){
    try{var s=localStorage.getItem(LS_PREFIX+k);CACHE[k]=s?JSON.parse(s).map(migrateRemarks):[];}catch(e){CACHE[k]=[];}
  }
  return CACHE[k]||[];
}
function cSet(hq,cat,d){
  var k=cKey(hq,cat);
  CACHE[k]=d;
  try{localStorage.setItem(LS_PREFIX+k,JSON.stringify(d));}catch(e){}
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
function setPendingObj(p){try{localStorage.setItem(PENDING_KEY,JSON.stringify(p));}catch(e){}}
function _bumpAuthFail(k,err){
  var p=getPending();
  var entry=p[k];
  if(!entry) return;
  var msg=(err&&err.message)||"";
  if(/HTTP (401|403)/.test(msg)){
    entry.authFailCount=(entry.authFailCount||0)+1;
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
function pendingCount(){return Object.keys(getPending()).length;}
function isPending(hq,cat){return !!getPending()[cKey(hq,cat)];}
// किसी HQ के लिए सही Firebase account से sign-in वापस मिल जाए (देखें ui-core.js: _ensureCorrectHqAuth)
// तो उस HQ की पुरानी "authFailCount" गिनती अब मान्य नहीं रह जाती — वरना flushPending() हमेशा के लिए
// उन entries को छोड़ता रहेगा (देखें नीचे STUCK_AUTH_MAX check), भले ही अब असल में sync हो सकता हो
function _resetAuthFailForHQ(hq){
  var p=getPending(),changed=false;
  Object.keys(p).forEach(function(k){
    if(p[k]&&p[k].hq===hq&&p[k].authFailCount){ p[k].authFailCount=0; changed=true; }
  });
  if(changed) setPendingObj(p);
}

// Record-level merge — दूसरों के बदलाव न मिटें
function rmkKeyOf(r){return (r.text||"")+"|"+(r.by||"")+"|"+(r.at||"");}
function mergeRecord(l,st){
  var base=((l.ts||0)>=(st.ts||0))?l:st;
  var out=JSON.parse(JSON.stringify(base));
  var seen={},arr=[];
  (st.remarksArr||[]).concat(l.remarksArr||[]).forEach(function(r){
    if(!r)return; var k=rmkKeyOf(r);
    if(!seen[k]){seen[k]=1;arr.push(r);}
  });
  out.remarksArr=arr;
  return out;
}
function mergeArrays(local,server){
  if(!server||!server.length) return local||[];
  if(!local||!local.length) return server;
  var sMap={};
  server.forEach(function(x){if(x&&x.acc)sMap[x.acc]=x;});
  var usedAcc={};
  var out=local.map(function(l){
    if(l&&l.acc&&sMap[l.acc]){usedAcc[l.acc]=1;return mergeRecord(l,sMap[l.acc]);}
    return l;
  });
  server.forEach(function(st){
    if(st&&st.acc&&!usedAcc[st.acc]) out.push(st);
  });
  return out;
}

var _flushing=false;
function flushPending(){
  if(_flushing||!navigator.onLine) return;
  var p=getPending();
  var keys=Object.keys(p);
  var needCat=false;
  try{needCat=localStorage.getItem("dc_catpending3")==="1";}catch(e){}
  if(!keys.length&&!needCat) return;
  _flushing=true;
  var done=0,total=keys.length+(needCat?1:0),okAll=true;
  function fin(ok){
    if(!ok)okAll=false;
    done++;
    if(done>=total){
      _flushing=false;
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
      fetch(FB+"/"+fbPath(it.hq,it.cat)+".json",{method:"DELETE"})
        .then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);clearPendingKey(k);setSyncStatus(true);fin(true);})
        .catch(function(e){if(navigator.onLine)logErr("sync-del-fail",e,it.hq+"/"+it.cat);_bumpAuthFail(k,e);setSyncStatus(false);fin(false);});
      return;
    }
    if(it.patch){
      // migrated HQ/श्रेणी — सिर्फ offline में बदले records PATCH करो; server के बाकी records को हाथ मत लगाओ
      // (इसलिए यहां fetch+merge की ज़रूरत नहीं — PATCH अपने-आप बाकी keys को बिना छेड़े रहने देता है)
      fetch(FB+"/"+fbPath(it.hq,it.cat)+".json",{
        method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(it.patch)
      }).then(function(r){
        if(!r.ok)throw new Error("HTTP "+r.status);
        clearPendingKey(k);
        updTime();setSyncStatus(true);
        if(CU&&it.hq===activeHQ&&it.cat===activeCat){var d=cGet(it.hq,it.cat);renderSummaryWith(d);renderListWith(d);}
        fin(true);
      }).catch(function(e){if(navigator.onLine)logErr("sync-patch-fail",e,it.hq+"/"+it.cat);_bumpAuthFail(k,e);setSyncStatus(false);fin(false);});
      return;
    }
    // put (पुराना array फॉर्मेट) — पहले server data लो, merge करो, फिर save — दोनों के बदलाव बचें
    // (_fbPut को ही बुलाओ, सीधे fetch PUT नहीं — वही एक जगह है जो migrated श्रेणी पर raw array भेजने से बचाती है)
    fetch(FB+"/"+fbPath(it.hq,it.cat)+".json?t="+Date.now())
      .then(_fbJson)
      .then(function(d){
        var server=normList(d);
        var merged=mergeArrays(cGet(it.hq,it.cat),server);
        cSet(it.hq,it.cat,merged);
        _fbPut(it.hq,it.cat,merged,function(ok){
          if(ok&&CU&&it.hq===activeHQ&&it.cat===activeCat){renderSummaryWith(merged);renderListWith(merged);}
          fin(!!ok);
        });
      })
      .catch(function(e){if(navigator.onLine)logErr("sync-put-fail",e,it.hq+"/"+it.cat);_bumpAuthFail(k,e);setSyncStatus(false);fin(false);});
  });
  if(needCat){
    var reqs=Object.keys(CAT_NAMES).map(function(hq){
      var hqData={};
      [4,5,6,7].forEach(function(i){if(CAT_NAMES[hq]&&CAT_NAMES[hq][i]!=null)hqData[i]=CAT_NAMES[hq][i];});
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
  if(!force&&!_prefetchDue()) return;
  _prefetchRun=true;
  var hqs=CU.role==="supervisor"?HQS:[CU.hq];
  var jobs=[];
  hqs.forEach(function(hq){
    for(var i=0;i<CATS_DEFAULT.length;i++){
      jobs.push({hq:hq,cat:(i>=4)?getCatName(hq,i):CATS_DEFAULT[i]});
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
    fetch(FB+"/"+fbPath(j.hq,j.cat)+".json?t="+Date.now())
      .then(_fbJson)
      .then(function(d){
        var data=normList(d);
        if(data.length){cSet(j.hq,j.cat,data);got++;}
        setTimeout(next,250);
      }).catch(function(){_prefetchRun=false;});
  })();
}

// self-hosted libraries (Excel/CSV) — service worker द्वारा cache होती हैं, इसलिए offline में भी load हो जाती हैं
function ensureLibs(){
  if(typeof XLSX==="undefined"){
    var s1=document.createElement("script");
    s1.src="vendor/xlsx.full.min.js";
    document.head.appendChild(s1);
  }
  if(typeof Papa==="undefined"){
    var s2=document.createElement("script");
    s2.src="vendor/papaparse.min.js";
    document.head.appendChild(s2);
  }
}


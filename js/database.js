function fbPath(hq,cat){
  return hq.replace(/\s/g,"_").replace(/[.#$\[\]]/g,"_")+"/"+cat.replace(/\s/g,"_").replace(/[.#$\[\]]/g,"_");
}

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
    // background silent refresh
    fetch(FB+"/"+fbPath(hq,cat)+".json?t="+Date.now())
      .then(function(r){return r.json();})
      .then(function(d){
        var data=!d?[]:(Array.isArray(d)?d:Object.values(d).filter(Boolean));
        data=data.map(migrateRemarks);
        overlayOps(hq,cat,data);
        var changed=JSON.stringify(data)!==JSON.stringify(cached);
        cSet(hq,cat,data);
        if(changed) cb(data);
        setSyncStatus(true);
      }).catch(function(){setSyncStatus(false);});
    return;
  }
  // Cache empty — network से load
  fetch(FB+"/"+fbPath(hq,cat)+".json?t="+Date.now())
    .then(function(r){return r.json();})
    .then(function(d){
      var data=!d?[]:(Array.isArray(d)?d:Object.values(d).filter(Boolean));
      data=data.map(migrateRemarks);
      overlayOps(hq,cat,data);
      cSet(hq,cat,data);
      cb(data);
      setSyncStatus(true);
    })
    .catch(function(){
      cb([]);
      setSyncStatus(false);
    });
}

function fbSet(hq,cat,arr,cb){
  cSet(hq,cat,arr);
  if(arr.length>200){
    toast("⏳ "+arr.length+" records सेव हो रहे हैं...","inf");
  }
  _fbPut(hq,cat,arr,cb);
}

function _fbPut(hq,cat,arr,cb){
  fetch(FB+"/"+fbPath(hq,cat)+".json",{
    method:"PUT",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(arr)
  }).then(function(r){
    if(!r.ok) throw new Error("HTTP "+r.status);
    clearPendingKey(cKey(hq,cat));
    updTime(); setSyncStatus(true);
    if(cb) cb(true);
  }).catch(function(e){
    if(navigator.onLine) logErr("save-fail",e,hq+"/"+cat); // ऑनलाइन होते हुए save fail — असली गड़बड़
    markPending(hq,cat,"put");
    setSyncStatus(false);
    toast("📴 ऑफलाइन — बदलाव device पर save है, नेट आते ही अपने आप sync होगा","inf");
    if(cb) cb(false);
  });
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
    .then(function(r){if(!r.ok)throw 0;clearPendingKey(cKey(hq,cat));if(cb)cb();})
    .catch(function(e){if(navigator.onLine)logErr("delete-fail",e,hq+"/"+cat);markPending(hq,cat,"del");toast("📴 ऑफलाइन — नेट आने पर लिस्ट सभी के लिए हटेगी","inf");if(cb)cb();});
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

function stopListen(){
  if(pollTimer){clearInterval(pollTimer);pollTimer=null;}
  if(liveSource){liveSource.close();liveSource=null;}
}

function startListen(hq,cat){
  stopListen();

  function applyIncoming(d){
    var data=!d?[]:(Array.isArray(d)?d:Object.values(d).filter(Boolean));
    data = data.map(migrateRemarks);
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

  function pollOnce(){
    if(isPending(hq,cat)){if(navigator.onLine)flushPending();return;}
    fetch(FB+"/"+fbPath(hq,cat)+".json?t="+Date.now())
      .then(function(r){return r.json();})
      .then(applyIncoming)
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
      es.addEventListener("put",function(){ if(!isPending(hq,cat)) pollOnce(); });
      es.addEventListener("patch",function(){ if(!isPending(hq,cat)) pollOnce(); });
      es.onopen=function(){setSyncStatus(true);};
      es.onerror=function(){
        setSyncStatus(false);
        if(es.readyState===2){ // CLOSED — स्ट्रीम पूरी तरह टूट गई (जैसे auth fail), polling पर वापस जाओ
          if(liveSource===es) liveSource=null;
          startPolling();
        }
        // वरना EventSource खुद reconnect करने की कोशिश करता रहेगा
      };
      pollOnce(); // पहला data तुरंत दिखाएं
    }catch(e){
      startPolling();
    }
  } else {
    startPolling();
  }

  // हर 8 sec में CAT_NAMES check — JE का बदला नाम तुरंत दिखे
  if(catNamesTimer) clearInterval(catNamesTimer);
  catNamesTimer=setInterval(function(){
    fetchCatNamesFromFB(true);
  },8000);
}


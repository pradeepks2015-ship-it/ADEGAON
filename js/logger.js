// ── ERROR LOG: हर गड़बड़ी का record — device (localStorage) पर + Firebase /LOGS में ──
// रोज़ के काम में कुछ नहीं बदलता; जिस दिन कुछ गलत हो, JE "एरर लॉग" (user menu) में वजह देख सकते हैं
var LOG_KEY="dc_logs3", LOG_MAX=100;
var _logPush=0, LOG_PUSH_MAX=50; // एक session में server पर ज़्यादा से ज़्यादा 50 entries — loop/spam से बचाव
var DEV_ID=(function(){
  try{
    var d=localStorage.getItem("dc_devid");
    if(!d){d=Date.now().toString(36)+Math.random().toString(36).slice(2,7);localStorage.setItem("dc_devid",d);}
    return d;
  }catch(e){return "unknown";}
})();

// ── SERVER TIME OFFSET: डिवाइस की घड़ी ग़लत हो (गांव में आम — तारीख़/समय ग़लती से बदल जाना) तो
// ts-आधारित conflict-resolution (overlayOps/reconcileHQ/recOp — नीचे list.js) ग़लत फ़ैसला ले सकता
// था। कोई अलग/नई network call जोड़ने की बजाय — नीचे वाली DEVICE_VERSIONS ping (पहले से हर login
// + हर 4 घंटे चलती है) में अब असली Firebase server-time (".sv":"timestamp") भेजते हैं; जवाब में
// सर्वर उसे resolve करके असली timestamp लौटाता है (REST API की गारंटी-शुदा व्यवहार, response
// body हमेशा पढ़ने लायक होती है, header-CORS जैसी अनिश्चितता नहीं) — उसी से offset सीखते रहते हैं।
var _serverTimeOffset=0;
try{var _s=localStorage.getItem("dc_srvoffset");if(_s)_serverTimeOffset=Number(_s)||0;}catch(e){}
function serverNow(){ return Date.now()+_serverTimeOffset; }
function _learnServerOffset(resolvedServerTs,localNowAtRequest){
  if(typeof resolvedServerTs!=="number")return;
  _serverTimeOffset=resolvedServerTs-localNowAtRequest;
  try{localStorage.setItem("dc_srvoffset",String(_serverTimeOffset));}catch(e){}
}

// ── DEVICE VERSION TRACKING: कौन सा device किस app version पर है, यह हमेशा पता रहे ──
// चरण 3 माइग्रेशन (per-record) से पहले/बाद यह पक्का करने के लिए ज़रूरी कि कोई device पुराने
// write-path वाले code पर न रह जाए (वरना वह migrated list को दोबारा array में लिख सकता है)
var deviceTimer=null;
function pingDeviceVersion(){
  if(!navigator.onLine||!CU)return;
  var reqAt=Date.now();
  fetch(FB+"/DEVICE_VERSIONS/"+DEV_ID+".json",{
    method:"PUT",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({v:APP_VER,hq:CU.hq,role:CU.role,name:CU.name,t:{".sv":"timestamp"}})
  }).then(function(r){ return r.ok?r.json():null; })
    .then(function(d){ if(d&&typeof d.t==="number") _learnServerOffset(d.t,reqAt); })
    .catch(function(){});
}
function startDevicePing(){
  pingDeviceVersion();
  if(deviceTimer) clearInterval(deviceTimer);
  // हर 4 घंटे दोबारा — जो device हफ्तों बंद न हो (सिर्फ background में पड़ा रहे), उसकी असली (शायद पुरानी) version भी पता चलती रहे
  deviceTimer=setInterval(pingDeviceVersion,4*60*60*1000);
}
function stopDevicePing(){
  if(deviceTimer){clearInterval(deviceTimer);deviceTimer=null;}
}

// ── कर्मचारी सक्रियता + DEVICE VERSION VIEWER (सिर्फ JE) ──
// पहले यह सिर्फ़ "कौन सा device किस version पर है" दिखाता था, हर device की अलग पंक्ति के साथ।
// असली दिक्कत यह थी कि DEVICE_VERSIONS की key DEV_ID है, जो localStorage में रहती है — browser
// data साफ़ होने/ऐप दोबारा install होने पर नई DEV_ID बनती है, तो एक ही व्यक्ति की दर्जनों entries
// जमा हो जाती थीं (असली production में "Pradeep (JE)" की 20+ entries मिलीं)। नतीजा: सूची इतनी
// लंबी कि काम की न रहे, और "पुराने version" वाली चेतावनी उन मरे हुए devices की वजह से हमेशा लाल
// रहे जो अब कभी अपडेट होंगे ही नहीं। अब: (1) नाम+HQ से समूह, (2) डिफ़ॉल्ट सिर्फ़ पिछले 7 दिन,
// (3) साथ में यह भी कि हर कर्मचारी ने असल में कितना काम किया (सिर्फ़ ऐप खोलना नहीं)।
var _DV_RAW=null;      // {devKey: record} — एक बार लाकर रखा, अवधि बदलने पर दोबारा fetch नहीं (bandwidth)
var _DV_WINDOW=7;      // 7 | 30 | 0 (=सभी)
var DV_STALE_DAYS=60;  // इससे पुरानी entries viewer खुलते ही अपने आप हटें (जैसे LOGS में होता है)

// "Vikas sahu" / "vikas sahu", "Manoj kumar dehariya" / "Manoj Kumar Dehariya" — एक ही व्यक्ति
// के अलग-अलग वर्तनी वाले नाम एक ही समूह में आएं
function _dvNameKey(n){ return String(n==null?"":n).trim().toLowerCase().replace(/\s+/g," "); }

// लाइनमैन अपना नाम जैसे मन आए वैसे टाइप करते हैं — "SOHAN YADAV", "pradeep", "Devendra kumar",
// "ANIRAM.PARTE" — सूची में यह बेतरतीब दिखता था। सिर्फ़ दिखाने के लिए एक जैसा रूप दें (हर शब्द का
// पहला अक्षर बड़ा)। देवनागरी नामों पर toUpperCase/toLowerCase का कोई असर नहीं होता, वो जैसे हैं
// वैसे ही रहते हैं। समूह बनाने की key (_dvNameKey) अलग है, उस पर इसका कोई असर नहीं
function _dvTitle(n){
  return String(n==null?"":n).replace(/[^\s.]+/g,function(w){
    return w.charAt(0).toUpperCase()+w.slice(1).toLowerCase();
  });
}

function _dvAgo(t){
  if(!t) return "?";
  var mins=Math.floor((Date.now()-t)/60000);
  if(mins<2) return "अभी";
  if(mins<60) return mins+" मिनट पहले";
  var hrs=Math.floor(mins/60);
  if(hrs<24) return hrs+" घंटे पहले";
  var days=Math.floor(hrs/24);
  return days===1?"कल":(days+" दिन पहले");
}

// रिमार्क का "at" localized string है (toLocaleString("hi-IN") से, जैसे "30/8/2026, 2:15:30 pm") —
// कोई numeric timestamp नहीं। सिर्फ़ तारीख़ वाला हिस्सा (पहले comma तक) चाहिए, दिन-भर की सटीकता
// 7/30-दिन की खिड़की के लिए काफ़ी है
function _dvRmkTs(at){
  var m=String(at==null?"":at).split(",")[0].trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if(!m) return 0;
  var d=new Date(+m[3],+m[2]-1,+m[1]);
  return isNaN(d.getTime())?0:d.getTime();
}

// हर कर्मचारी ने पिछले N दिन में कितना काम किया — यह पूरी तरह उसी cached data से बनता है जो
// डिवाइस पर पहले से मौजूद है (cGet), एक भी नई network call नहीं
function _dvActivity(sinceTs){
  var out={},seen={};
  var sd=new Date(sinceTs); sd.setHours(0,0,0,0);
  var sinceDay=sd.getTime(); // रिमार्क में सिर्फ़ तारीख़ है, इसलिए दिन की शुरुआत से तुलना
  var bump=function(name){
    var k=_dvNameKey(name);
    if(!out[k]) out[k]={work:0,paid:0,rmk:0};
    return out[k];
  };
  HQS.forEach(function(hq){
    for(var i=0;i<CATS_DEFAULT.length;i++){
      var cat=(i>=4)?getCatName(hq,i):CATS_DEFAULT[i];
      (cGet(hq,cat)||[]).forEach(function(x){
        if(!x) return;
        // रिमार्क हर श्रेणी में अलग होते हैं — propagateStatus सिर्फ़ status/paydate copy करता है,
        // remarksArr नहीं — इसलिए इन्हें dedup किए बिना, हर श्रेणी से गिनना ही सही है
        (x.remarksArr||[]).forEach(function(r){
          if(!r||!r.by) return;
          var t=_dvRmkTs(r.at);
          if(t&&t>=sinceDay) bump(r.by).rmk++;
        });
        // status/updatedBy हर श्रेणी में copy हो जाता है (propagateStatus) — इसलिए एक ही उपभोक्ता
        // को एक ही बार गिनें, वरना वसूली की संख्या कई गुना बढ़ी हुई दिखेगी
        if(x.acc){ var dk=hq+"|"+String(x.acc).trim(); if(seen[dk]) return; seen[dk]=1; }
        if(!x.updatedBy||!x.ts||x.ts<sinceTs) return;
        var o=bump(x.updatedBy);
        o.work++;
        if(x.status==="paid") o.paid++;
      });
    }
  });
  return out;
}

function _dvSetWindow(d){ _DV_WINDOW=d; _dvPaint(); } // सिर्फ़ दोबारा रंगना — कोई नई fetch नहीं

function _dvRender(){
  var el=document.getElementById("mig-devices");
  if(!el)return;
  el.innerHTML="<div class='log-empty'>⏳ लोड हो रहा है...</div>";
  fetch(FB+"/DEVICE_VERSIONS.json?t="+Date.now())
    .then(_fbJson)
    .then(function(d){
      _DV_RAW=(d&&typeof d==="object")?d:{};
      _dvPaint();
      _dvAutoClean();
    })
    .catch(function(){ el.innerHTML="<div class='log-empty'>लोड नहीं हो पाया — दोबारा कोशिश करें</div>"; });
}

function _dvPaint(){
  var el=document.getElementById("mig-devices");
  if(!el)return;
  var raw=_DV_RAW||{};
  var keys=Object.keys(raw);
  if(!keys.length){ el.innerHTML="<div class='log-empty'>अभी तक कोई device record नहीं — यह नए version से अपने आप बनता है</div>"; return; }
  var cutoff=_DV_WINDOW?(Date.now()-_DV_WINDOW*86400000):0;
  var act=_dvActivity(cutoff||0);
  // नाम+HQ से समूह — एक ही व्यक्ति के कई devices/re-install एक पंक्ति में
  var people={},hidden=0;
  keys.forEach(function(k){
    var r=raw[k];
    if(!r||typeof r!=="object")return;
    var t=Number(r.t)||0;
    if(t<cutoff){hidden++;return;}
    var nk=_dvNameKey(r.name)+"|"+String(r.hq==null?"":r.hq);
    var p=people[nk];
    if(!p){ p=people[nk]={name:r.name||"?",hq:r.hq||"?",role:r.role,t:0,v:"?",devs:0,key:nk}; }
    p.devs++;
    if(t>=p.t){ p.t=t; p.v=r.v||"?"; p.name=r.name||p.name; p.role=r.role; } // सबसे नया ping ही असली version/नाम
  });
  var rows=Object.keys(people).map(function(k){return people[k];});
  if(!rows.length){
    // audit-verified: _DV_WINDOW संख्या है (7/30/0) और _dvControls() सिर्फ़ संख्याओं + hardcoded
    // markup से बनता है — कोई user-typed field नहीं
    // eslint-disable-next-line no-unsanitized/property
    el.innerHTML="<div class='log-empty'>पिछले "+_DV_WINDOW+" दिन में कोई सक्रिय नहीं — ऊपर से अवधि बदलकर देखें</div>"+_dvControls(hidden);
    return;
  }
  rows.sort(function(a,b){
    var aOld=a.v!==APP_VER, bOld=b.v!==APP_VER;
    if(aOld!==bOld) return aOld?-1:1; // पुराने version पहले दिखें — उन्हीं को अपडेट करवाना है
    return (b.t||0)-(a.t||0);
  });
  var anyOld=rows.some(function(r){return r.v!==APP_VER;});
  var html=_dvControls(hidden);
  html+=anyOld
    ?"<div style='background:rgba(240,80,80,.08);border:1px solid rgba(240,80,80,.3);border-radius:10px;padding:9px 11px;margin-bottom:8px;font-size:12px;color:var(--red);font-weight:700;'>⚠️ कुछ सक्रिय devices अभी भी पुराने version पर हैं — इन्हें अपडेट करवाएं</div>"
    :"<div style='background:rgba(0,200,150,.08);border:1px solid rgba(0,200,150,.3);border-radius:10px;padding:9px 11px;margin-bottom:8px;font-size:12px;color:var(--green);font-weight:700;'>✅ सभी सक्रिय devices v"+escHtml(APP_VER)+" पर हैं</div>";
  // जिन HQ का data इस डिवाइस पर नहीं है उनका "काम" शून्य दिखेगा — यह साफ़ बता देना ज़रूरी है,
  // वरना JE ग़लती से समझ लेगा कि वहां किसी ने काम ही नहीं किया
  var noData=HQS.filter(function(hq){ return !((cGet(hq,CATS_DEFAULT[0])||[]).length); });
  if(noData.length){
    html+="<div style='background:rgba(240,165,0,.08);border:1px solid rgba(240,165,0,.3);border-radius:10px;padding:8px 10px;margin-bottom:8px;font-size:11px;color:var(--gold2);'>ℹ️ इन मुख्यालयों का data इस डिवाइस पर नहीं है, इसलिए इनका \"काम\" शून्य दिख सकता है: <b>"+escHtml(noData.join(", "))+"</b> — \"आज की वसूली\" या \"ग्राम-वार वसूली\" में रिफ्रेश दबाकर ताज़ा करें</div>";
  }
  html+="<table class='wasc-table'><thead><tr><th class='wasc-th-left'>कर्मचारी</th><th>HQ</th><th>"+(_DV_WINDOW?(_DV_WINDOW+" दिन का काम"):"काम")+"</th><th>आख़िरी बार लॉगिन</th><th>Version</th></tr></thead><tbody>";
  rows.forEach(function(r){
    var old=r.v!==APP_VER;
    var a=act[_dvNameKey(r.name)]||{work:0,paid:0,rmk:0};
    var bits=[];
    if(a.paid) bits.push("<b style='color:var(--green);'>"+a.paid+"</b> वसूली");
    if(a.rmk) bits.push("<small style='color:#64b5f6;'>"+a.rmk+" रिमार्क</small>");
    // न वसूली न रिमार्क, पर कुछ record छुए (जैसे "वापस बाकी") — वो भी काम है, छुपे नहीं
    if(!bits.length&&a.work) bits.push("<small style='color:var(--muted);'>"+a.work+" बदलाव</small>");
    var workHtml=bits.length?bits.join("<br>"):"<span style='color:var(--red);'>—</span>";
    html+="<tr"+(old?" style='background:rgba(240,80,80,.06);'":"")+">"+
      // कोई अपने नाम में ख़ुद ही "(JE)" लिख दे तो दो बार न दिखे
      "<td class='wasc-hq'>"+escHtml(_dvTitle(r.name))+((r.role==="supervisor"&&!/\(JE\)/i.test(r.name))?" (JE)":"")+(r.devs>1?"<br><small style='color:var(--muted);font-weight:400;'>"+r.devs+" devices</small>":"")+"</td>"+
      "<td>"+escHtml(r.hq)+"</td>"+
      "<td>"+workHtml+"</td>"+
      "<td>"+escHtml(_dvAgo(r.t))+"<br><small style='color:var(--muted);'>"+escHtml(r.t?new Date(r.t).toLocaleDateString("hi-IN"):"?")+"</small></td>"+
      "<td>"+(old?"⚠️ v":"✅ v")+escHtml(r.v)+"</td></tr>";
  });
  html+="</tbody></table>";
  // audit-verified: name/hq/v/_dvAgo/तारीख़/noData सभी escHtml() से गुज़रते हैं; workHtml/old/devs
  // सिर्फ़ संख्या और hardcoded markup से बनते हैं
  // eslint-disable-next-line no-unsanitized/property
  el.innerHTML=html;
}

function _dvControls(hidden){
  var btn=function(d,lbl){
    var on=_DV_WINDOW===d;
    return "<button onclick=\"_dvSetWindow("+d+")\" style='border:1px solid "+(on?"var(--gold2)":"var(--border)")+";background:"+(on?"rgba(240,165,0,.12)":"var(--card)")+";color:"+(on?"var(--gold2)":"var(--muted)")+";border-radius:8px;padding:5px 12px;font-family:inherit;font-size:11px;font-weight:700;cursor:pointer;'>"+lbl+"</button>";
  };
  var h="<div style='display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px;'>"+
    btn(7,"7 दिन")+btn(30,"30 दिन")+btn(0,"सभी");
  if(hidden>0&&_DV_WINDOW) h+="<button onclick='_dvClearOld()' style='margin-left:auto;border:1px solid rgba(240,80,80,.3);background:rgba(240,80,80,.08);color:var(--red);border-radius:8px;padding:5px 12px;font-family:inherit;font-size:11px;font-weight:700;cursor:pointer;'>🗑️ पुरानी "+hidden+" हटाएं</button>";
  h+="</div>";
  return h;
}

// चुनी हुई अवधि से पुरानी entries हमेशा के लिए हटाएं। सुरक्षित है — जो device अब भी इस्तेमाल
// में है वो अगले login/ping पर अपनी entry दोबारा बना लेता है (देखें pingDeviceVersion)
function _dvClearOld(){
  if(!CU||CU.role!=="supervisor"){toast("सिर्फ JE यह कर सकते हैं","err");return;}
  if(!_DV_WINDOW){toast("पहले 7 या 30 दिन चुनें","inf");return;}
  var cutoff=Date.now()-_DV_WINDOW*86400000;
  var raw=_DV_RAW||{};
  var olds=Object.keys(raw).filter(function(k){
    var r=raw[k]; return r&&typeof r==="object"&&(Number(r.t)||0)<cutoff;
  });
  if(!olds.length){toast("कोई पुरानी entry नहीं — सूची पहले से साफ़ है","ok");return;}
  if(!confirm("⚠️ "+olds.length+" पुरानी entries हटेंगी (जो "+_DV_WINDOW+" दिन से नहीं दिखीं)।\n\nजो device अब भी इस्तेमाल में है, वो अगली बार login होते ही अपने आप वापस आ जाएगा — कोई डेटा नहीं खोता।\n\nजारी रखें?")) return;
  Promise.all(olds.map(function(k){
    return fetch(FB+"/DEVICE_VERSIONS/"+encodeURIComponent(k)+".json",{method:"DELETE"})
      .then(function(r){ if(r.ok) delete raw[k]; })
      .catch(function(){});
  })).then(function(){
    _dvPaint();
    toast("✅ पुरानी entries हट गईं","ok");
  });
}

// viewer खुलते ही बहुत पुरानी (DV_STALE_DAYS+) entries चुपचाप हटें, ताकि यह ढेर दोबारा न बने —
// LOGS/USAGE की तरह ही (देखें cleanupOldServerLogs)। सिर्फ़ JE का device यह कर सकता है (rules)
function _dvAutoClean(){
  if(!CU||CU.role!=="supervisor")return;
  var raw=_DV_RAW||{};
  var cutoff=Date.now()-DV_STALE_DAYS*86400000;
  Object.keys(raw).forEach(function(k){
    var r=raw[k];
    if(!r||typeof r!=="object"||(Number(r.t)||0)>=cutoff) return;
    fetch(FB+"/DEVICE_VERSIONS/"+encodeURIComponent(k)+".json",{method:"DELETE"})
      .then(function(res){ if(res.ok) delete raw[k]; }).catch(function(){});
  });
}

function getLogs(){try{return JSON.parse(localStorage.getItem(LOG_KEY))||[];}catch(e){return [];}}

// ── ERROR BADGE: JE को "एरर लॉग" खोले बिना पता चले कि किसी device पर नई error आई है ──
var LOG_SEEN_KEY="dc_log_seen_ts";
function _logSeenTs(){try{return Number(localStorage.getItem(LOG_SEEN_KEY))||0;}catch(e){return 0;}}
function _logMarkSeen(){try{localStorage.setItem(LOG_SEEN_KEY,String(Date.now()));}catch(e){}}
function refreshLogBadge(){
  var el=document.getElementById("log-badge");
  if(!el||!CU||CU.role!=="supervisor"||!navigator.onLine)return;
  var seen=_logSeenTs();
  var days=[0,1].map(function(off){return new Date(Date.now()-off*86400000).toISOString().slice(0,10);});
  Promise.all(days.map(function(day){
    return fetch(FB+"/LOGS/"+day+".json?t="+Date.now()).then(_fbJson).catch(function(){return null;});
  })).then(function(res){
    var count=0;
    res.forEach(function(d){
      if(!d||typeof d!=="object")return;
      Object.keys(d).forEach(function(k){
        var e=d[k];
        if(e&&e.t&&new Date(e.t).getTime()>seen) count++;
      });
    });
    if(count>0){el.textContent=count>99?"99+":String(count); el.style.display="inline-block";}
    else el.style.display="none";
  }).catch(function(){});
}

function logErr(ctx, err, extra){
  try{
    var m=!err?"":(err.message||String(err));
    var entry={
      t:new Date().toISOString(),
      v:(typeof APP_VER!=="undefined"?APP_VER:"?"),
      u:(typeof CU!=="undefined"&&CU)?(CU.role+"|"+CU.hq+"|"+CU.name):"(login से पहले)",
      d:DEV_ID,
      c:ctx||"",
      m:String(m).slice(0,300),
      x:extra?String(extra).slice(0,200):""
    };
    var logs=getLogs(); logs.push(entry);
    if(logs.length>LOG_MAX) logs=logs.slice(logs.length-LOG_MAX);
    try{localStorage.setItem(LOG_KEY,JSON.stringify(logs));}catch(e2){}
    // server push (fire & forget) — offline में skip; push fail होने पर दोबारा log नहीं (loop से बचाव)
    if(navigator.onLine && _logPush<LOG_PUSH_MAX && typeof FB!=="undefined"){
      _logPush++;
      var day=entry.t.slice(0,10);
      fetch(FB+"/LOGS/"+day+".json",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(entry)}).catch(function(){});
    }
  }catch(e3){}
}

// बिना पकड़ी गई हर JS error अपने आप log हो — सिवाय ब्राउज़र के जान-बूझकर छुपाई गई cross-origin
// "Script error." के (CDN लाइब्रेरी — Firebase/XLSX/PapaParse — के अंदर की error, ब्राउज़र सुरक्षा
// कारणों से filename/line/detail कुछ नहीं देता) — इसे लॉग करने से कभी कोई सुराग नहीं मिलता, सिर्फ़
// शोर बनता; असली (हमारे कोड की, same-origin) errors पहले जैसे ही पूरी जानकारी के साथ लॉग होती रहेंगी
window.addEventListener("error",function(ev){
  if(!ev) return;
  if(ev.message==="Script error."&&!ev.filename&&!ev.lineno&&!ev.error) return;
  if(ev.error||ev.message) logErr("js-error",ev.error||ev.message,(ev.filename||"").split("/").pop()+":"+(ev.lineno||""));
});
window.addEventListener("unhandledrejection",function(ev){
  logErr("promise",ev&&ev.reason);
});

// ── LOG VIEWER (सिर्फ JE) ──
function openLogModal(){
  if(!CU||CU.role!=="supervisor"){toast("सिर्फ JE लॉग देख सकते हैं","err");return;}
  var mn=document.getElementById("logout-menu"); if(mn) mn.classList.remove("open");
  document.getElementById("log-overlay").classList.add("open");
  // audit-verified: logRowsHtml() खुद हर field को escHtml() से गुज़ारता है — plugin किसी local
  // helper function के अंदर की escaping नहीं देख पाता, सिर्फ़ escape.methods में listed नाम पहचानता है
  // eslint-disable-next-line no-unsanitized/property
  document.getElementById("log-local").innerHTML=logRowsHtml(getLogs().slice().reverse());
  document.getElementById("log-srv").innerHTML='<div class="log-empty">लोड हो रहा है...</div>';
  fetchServerLogs();
  cleanupOldServerLogs();
  _logMarkSeen();
  var badge=document.getElementById("log-badge"); if(badge) badge.style.display="none";
}
function closeLogModal(){document.getElementById("log-overlay").classList.remove("open");}
function closeLogOutside(e){if(e.target===document.getElementById("log-overlay"))closeLogModal();}

function logRowsHtml(arr){
  if(!arr||!arr.length) return '<div class="log-empty">कोई error नहीं — सब ठीक है ✅</div>';
  var h="";
  arr.slice(0,100).forEach(function(e){
    if(!e)return;
    var when=(e.t||"").replace("T"," ").slice(0,19);
    h+='<div class="log-row"><div class="log-top"><span class="log-ctx">'+escHtml(e.c||"?")+'</span>'
      +'<span class="log-when">'+escHtml(when)+' UTC</span></div>'
      +'<div class="log-msg">'+escHtml(e.m||"")+(e.x?' <span class="log-x">['+escHtml(e.x)+']</span>':'')+'</div>'
      +'<div class="log-who">'+escHtml(e.u||"?")+' • v'+escHtml(e.v||"?")+' • '+escHtml(e.d||"")+'</div></div>';
  });
  return h;
}

// आज + कल के logs — सभी devices से
function fetchServerLogs(){
  var days=[0,1].map(function(off){return new Date(Date.now()-off*86400000).toISOString().slice(0,10);});
  Promise.all(days.map(function(day){
    return fetch(FB+"/LOGS/"+day+".json?t="+Date.now())
      .then(_fbJson)
      .catch(function(){return null;});
  })).then(function(res){
    var all=[];
    res.forEach(function(d){if(d&&typeof d==="object")Object.keys(d).forEach(function(k){all.push(d[k]);});});
    all.sort(function(a,b){return String(b&&b.t||"").localeCompare(String(a&&a.t||""));});
    // audit-verified: logRowsHtml() खुद हर field escHtml() से गुज़ारता है, बाक़ी branch hardcoded
    // eslint-disable-next-line no-unsanitized/property
    document.getElementById("log-srv").innerHTML=all.length?logRowsHtml(all):'<div class="log-empty">पिछले 2 दिन में किसी device पर कोई error नहीं ✅</div>';
  });
}

// 15 दिन से पुराने server logs अपने आप हटें — free plan की जगह न भरे
function cleanupOldServerLogs(){
  fetch(FB+"/LOGS.json?shallow=true&t="+Date.now())
    .then(_fbJson)
    .then(function(d){
      if(!d)return;
      var cutoff=new Date(Date.now()-15*86400000).toISOString().slice(0,10);
      Object.keys(d).forEach(function(day){
        if(day<cutoff) fetch(FB+"/LOGS/"+day+".json",{method:"DELETE"}).catch(function(){});
      });
    }).catch(function(){});
}

function clearLocalLogs(){
  try{localStorage.removeItem(LOG_KEY);}catch(e){}
  // audit-verified: logRowsHtml([]) हमेशा एक hardcoded "कोई error नहीं" संदेश लौटाता है
  // eslint-disable-next-line no-unsanitized/property
  document.getElementById("log-local").innerHTML=logRowsHtml([]);
  toast("इस डिवाइस के लॉग साफ़ हो गए","ok");
}

// "सभी डिवाइस" वाला हिस्सा (fetchServerLogs) Firebase /LOGS/{day} से आता है — पहले सिर्फ़ 15 दिन
// बाद अपने आप साफ़ होता था (cleanupOldServerLogs), JE के पास मैन्युअल तरीका नहीं था, तो पुरानी/
// पहले ही देखी-समझी entries जमा होती रहतीं और हर बार लॉग खोलने पर वही ढेर दिखता रहता — असली bug यही था
function clearServerLogs(){
  if(!confirm("⚠️ यह सभी devices से दिख रहे पिछले 2 दिन के लॉग हमेशा के लिए मिटा देगा (सिर्फ़ इस device का लॉग नहीं — सबका)। जारी रखें?"))return;
  document.getElementById("log-srv").innerHTML='<div class="log-empty">साफ़ हो रहा है...</div>';
  var days=[0,1].map(function(off){return new Date(Date.now()-off*86400000).toISOString().slice(0,10);});
  Promise.all(days.map(function(day){
    return fetch(FB+"/LOGS/"+day+".json",{method:"DELETE"}).catch(function(){});
  })).then(function(){
    toast("🗑️ सभी devices के लॉग साफ़ हो गए","ok");
    fetchServerLogs();
  });
}

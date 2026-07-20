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

function getLogs(){try{return JSON.parse(localStorage.getItem(LOG_KEY))||[];}catch(e){return [];}}

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

// बिना पकड़ी गई हर JS error अपने आप log हो
window.addEventListener("error",function(ev){
  if(ev&&(ev.error||ev.message)) logErr("js-error",ev.error||ev.message,(ev.filename||"").split("/").pop()+":"+(ev.lineno||""));
});
window.addEventListener("unhandledrejection",function(ev){
  logErr("promise",ev&&ev.reason);
});

// ── LOG VIEWER (सिर्फ JE) ──
function openLogModal(){
  if(!CU||CU.role!=="supervisor"){toast("सिर्फ JE लॉग देख सकते हैं","err");return;}
  var mn=document.getElementById("logout-menu"); if(mn) mn.classList.remove("open");
  document.getElementById("log-overlay").classList.add("open");
  document.getElementById("log-local").innerHTML=logRowsHtml(getLogs().slice().reverse());
  document.getElementById("log-srv").innerHTML='<div class="log-empty">लोड हो रहा है...</div>';
  fetchServerLogs();
  cleanupOldServerLogs();
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
      .then(function(r){return r.json();})
      .catch(function(){return null;});
  })).then(function(res){
    var all=[];
    res.forEach(function(d){if(d&&typeof d==="object")Object.keys(d).forEach(function(k){all.push(d[k]);});});
    all.sort(function(a,b){return String(b&&b.t||"").localeCompare(String(a&&a.t||""));});
    document.getElementById("log-srv").innerHTML=all.length?logRowsHtml(all):'<div class="log-empty">पिछले 2 दिन में किसी device पर कोई error नहीं ✅</div>';
  });
}

// 15 दिन से पुराने server logs अपने आप हटें — free plan की जगह न भरे
function cleanupOldServerLogs(){
  fetch(FB+"/LOGS.json?shallow=true&t="+Date.now())
    .then(function(r){return r.json();})
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
  document.getElementById("log-local").innerHTML=logRowsHtml([]);
  toast("इस डिवाइस के लॉग साफ़ हो गए","ok");
}

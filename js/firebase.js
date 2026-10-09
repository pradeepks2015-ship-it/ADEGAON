var FB = "https://adegaon-dc-top-50-default-rtdb.firebaseio.com";
var CACHE = {};

// ── FIREBASE AUTH: गुमनाम (anonymous) sign-in — बिना इसके अब DB access नहीं मिलेगा ──
// (config secret नहीं है — असली सुरक्षा Firebase Security Rules से आती है, इसे छुपाने की ज़रूरत नहीं)
var firebaseConfig = {
  apiKey: "AIzaSyAPFZ2wqPYVMyvU4WqYrKUinVERBkVqdmY",
  authDomain: "adegaon-dc-top-50.firebaseapp.com",
  databaseURL: "https://adegaon-dc-top-50-default-rtdb.firebaseio.com",
  projectId: "adegaon-dc-top-50",
  storageBucket: "adegaon-dc-top-50.firebasestorage.app",
  messagingSenderId: "265994697235",
  appId: "1:265994697235:web:6158cdf1200bd86c201de6"
};
var ID_TOKEN = null;
var AC_TOKEN = null; // App Check token — साबित करता है कि request असली app से है (अभी monitor mode)
var AC_READY = false; // पहला App Check token मिल चुका है (सफल/असफल दोनों) — वरना request अनिश्चित काल इंतज़ार न करे
// ── token ताज़े हैं या नहीं — घंटों पीछे पड़े फ़ोन पर लौटते ही पुराने token न जाएं ──
// असली production (6/10): App Check Verified% 97 → 94 (unverified 3% → 6%)। App Check token ~1 घंटा
// चलता है और _acRefresh हर 30 मिनट setInterval से — पर ऐप minimize हो तो Android यह टाइमर रोक
// देता है। घंटों बाद लौटते ही (visibilitychange) कुछ requests तुरंत जाती हैं — डेटा बचाओ स्विच
// (fetchPause) और v9.185 की "हाज़िरी" — और वो ख़त्म हो चुके token के साथ जाकर "unverified" में
// गिनती थीं (मना भी होतीं, चुपचाप — error log में नहीं)। अब हर Firebase request से पहले जांच:
// token ख़त्म होने वाला हो तो पहले नया लो (ज़्यादा से ज़्यादा FRESH_WAIT_MS रुककर, फिर जैसा है वैसा)
var AC_TOKEN_AT = 0, ID_TOKEN_AT = 0; // token *बदलने* का समय (JWT में exp न मिले तब के लिए)
var TOKEN_MARGIN_MS = 5*60*1000;      // ख़त्म होने से इतना पहले ही नया लो
var AC_FALLBACK_MS = 25*60*1000, ID_FALLBACK_MS = 50*60*1000;
var FRESH_WAIT_MS = 4000;             // नया token इतनी देर में न मिले तो request रोके न रखो
function _jwtExpMs(t){
  try{
    var p=String(t).split(".")[1];
    if(!p) return 0;
    p=p.replace(/-/g,"+").replace(/_/g,"/");
    while(p.length%4) p+="=";
    var o=JSON.parse(atob(p));
    return (o&&o.exp)?o.exp*1000:0;
  }catch(e){ return 0; }
}
// फ़ोन की घड़ी ग़लत हो सकती है — exp सर्वर का समय है, इसलिए serverNow() से तुलना (logger.js पहले लोड होता है)
function _nowSrv(){ return (typeof serverNow==="function")?serverNow():Date.now(); }
function _tokStale(tok,gotAt,fallbackMs){
  if(!tok) return false;
  var exp=_jwtExpMs(tok);
  if(exp) return exp-_nowSrv()<TOKEN_MARGIN_MS;
  return gotAt>0&&Date.now()-gotAt>fallbackMs; // समय पता ही न हो (gotAt 0) तो पुराना न मानें
}
// ── App Check token न बने तो उसकी वजह लॉग में ──
// असली production (9/10): App Check metrics में "outdated client" (login token था, App Check token
// नहीं) 1–8 अक्टूबर 5–14%, फिर 9/10 को ~60% — पर error log "पिछले 2 दिन में कोई error नहीं"।
// वजह: getToken() की नाकामी यहां चुपचाप निगल ली जाती थी, और जिस फ़ोन पर token नहीं बनता वह
// LOGS में भी नहीं लिख पाता (Enforced — लॉग को भी token चाहिए)। इसलिए दो हिस्से:
//  (1) नाकामी तुरंत लॉग करने की कोशिश — एक session में हर वजह (code) सिर्फ़ एक बार
//  (2) फ़ोन में नोट (localStorage) — token फिर बनते ही पक्का लॉग "कितनी देर अटका, क्यों, कितनी
//      कोशिशें" (उस वक़्त token है, इसलिए यह लॉग सचमुच पहुंचता है)। SDK एक ख़ास मनाही (HTTP 403)
//      पर पूरे दिन के लिए रोक देता है — तब यह लॉग अगले दिन आएगा, पर आएगा
var AC_FAIL_KEY="dc_acfail";
var _acFailLogged={};
function _acNoteFail(e,where){
  try{
    var code=String((e&&e.code)||"unknown");
    var msg=String((e&&e.message)||e||"").slice(0,180);
    var rc=(typeof grecaptcha!=="undefined")?"हां":"नहीं";
    var rec=null;
    try{ rec=JSON.parse(localStorage.getItem(AC_FAIL_KEY)||"null"); }catch(x){}
    if(!rec||typeof rec!=="object") rec={since:Date.now(),n:0};
    rec.n=(rec.n||0)+1; rec.code=code; rec.msg=msg; rec.rc=rc; rec.on=navigator.onLine?"हां":"नहीं";
    try{ localStorage.setItem(AC_FAIL_KEY,JSON.stringify(rec)); }catch(x){}
    if(_acFailLogged[code]||typeof logErr!=="function") return;
    _acFailLogged[code]=1;
    logErr("appcheck-fail",new Error(code+" • "+msg),where+" • reCAPTCHA लोड: "+rc+" • नेट: "+rec.on);
  }catch(x){}
}
function _acNoteOk(){
  try{
    var raw=localStorage.getItem(AC_FAIL_KEY);
    if(!raw) return;
    localStorage.removeItem(AC_FAIL_KEY);
    var rec=JSON.parse(raw);
    // token न होने के दौरान रुकी वसूली अभी भेजें — ऐप बंद-खोलने का इंतज़ार नहीं
    try{
      if(typeof resetAuthFailAll==="function") resetAuthFailAll();
      if(typeof flushPending==="function") setTimeout(function(){ try{ flushPending(); }catch(x){} },0);
    }catch(x){}
    if(!rec||!rec.since||typeof logErr!=="function") return;
    var mins=Math.max(0,Math.round((Date.now()-rec.since)/60000));
    var dur=mins<60?(mins+" मिनट"):(Math.floor(mins/60)+" घंटे "+(mins%60)+" मिनट");
    logErr("appcheck-recovered",new Error("App Check token "+dur+" तक नहीं बना — वजह: "+rec.code+" • "+rec.msg),
      "कोशिशें: "+rec.n+" • reCAPTCHA लोड: "+rec.rc+" • नेट: "+rec.on);
  }catch(x){}
}
function _setAcToken(t){
  t=t||null;
  if(t&&t!==AC_TOKEN) AC_TOKEN_AT=Date.now();
  AC_TOKEN=t;
  if(t) _acNoteOk(); // पहले token न बन पाया था तो अब (token के साथ) उसका पक्का लॉग
}
function _setIdToken(t){ if(t&&t!==ID_TOKEN) ID_TOKEN_AT=Date.now(); ID_TOKEN=t; }
function _acStale(){ return _tokStale(AC_TOKEN,AC_TOKEN_AT,AC_FALLBACK_MS); }
function _idStale(){ return _tokStale(ID_TOKEN,ID_TOKEN_AT,ID_FALLBACK_MS); }
var _freshJob=null; // एक साथ कई requests हों तो ताज़ा करने का काम एक ही बार
function _fbEnsureFresh(){
  if(!_acStale()&&!_idStale()) return Promise.resolve();
  if(_freshJob) return _freshJob;
  var jobs=[];
  try{
    if(_acStale()) jobs.push(firebase.appCheck().getToken(false).then(function(t){ _setAcToken(t&&t.token); }).catch(function(e){ _acNoteFail(e,"ताज़ा करते वक़्त"); }));
  }catch(e){}
  try{
    var u=firebase.auth().currentUser;
    if(u&&_idStale()) jobs.push(u.getIdToken(false).then(function(t){ _setIdToken(t); }).catch(function(){}));
  }catch(e){}
  if(!jobs.length) return Promise.resolve();
  _freshJob=Promise.race([Promise.all(jobs),new Promise(function(r){ setTimeout(r,FRESH_WAIT_MS); })])
    .then(function(){ _freshJob=null; });
  return _freshJob;
}
var _tokenWaiters = []; // app खुलते ही token बनने से पहले निकली DB-calls यहां इंतज़ार करती हैं
// Firebase अपना सेव किया हुआ login बहाल कर चुका है (चाहे मिला हो या नहीं) — तब तक
// firebase.auth().currentUser देखना भरोसेमंद नहीं
var AUTH_READY = false;
var _authWaiters = [];
// Firebase का auth तय हो जाने के बाद fn चलाओ। Firebase library ही लोड न हुई हो (offline पहली बार)
// तो कभी न अटकें — 5 सेकंड बाद वैसे भी चला दो
function _afterAuthReady(fn){
  if(AUTH_READY){fn();return;}
  var done=false;
  function run(){if(done)return;done=true;try{fn();}catch(e){}}
  _authWaiters.push(run);
  setTimeout(run,5000);
}
var _acWaiters = []; // वैसे ही App Check token के लिए — पहले सिर्फ ID_TOKEN का इंतज़ार होता था, इसलिए ज़्यादातर requests बिना App Check header के निकल जाती थीं (Verified% कम दिखता था)
var AC_RETRY_MS=15000; // App Check token न मिले तो अगली कोशिश कितनी जल्दी (30 मिनट के सामान्य refresh से अलग)
var _acRetryT=null;
// App Check token लाना/ताज़ा करना — फ़ंक्शन को यहां (top-level) रखा है, try ब्लॉक के अंदर नहीं,
// ताकि tests सीधे बुला सकें (देखें tests/smoke.spec.js)
function _acRefresh(){
  try{
    firebase.appCheck().getToken(false)
      .then(function(t){_setAcToken(t&&t.token);})
      .catch(function(e){AC_TOKEN=null;_acNoteFail(e,"ऐप खुलते/हर 30 मिनट");})
      .then(function(){
        if(!AC_READY){AC_READY=true; _acWaiters.splice(0).forEach(function(f){try{f();}catch(e){}});}
        // असली production bug (v9.165 के sse-never-opened लॉग से पकड़ा गया, सर्वर का जवाब
        // "Missing appcheck token"): पहला getToken() कभी-कभी नाकाम रह जाता (reCAPTCHA अभी लोड नहीं
        // हुआ, धीमा नेट) — AC_READY फिर भी true हो जाता है (ताकि पहली request अनिश्चित काल न
        // रुके), पर AC_TOKEN null ही रह जाता। पहले अगला मौका पूरे 30 मिनट बाद (अगला interval)
        // मिलता — तब तक हर request बिना App Check header के जाती, और Enforced database उसे मना
        // करती। अब token न मिले तो जल्दी (15 सेकंड में) दोबारा कोशिश करो
        if(_acRetryT){clearTimeout(_acRetryT);_acRetryT=null;}
        if(!AC_TOKEN) _acRetryT=setTimeout(_acRefresh,AC_RETRY_MS);
      });
  }catch(e){if(!AC_READY)AC_READY=true;}
}
try{
  firebase.initializeApp(firebaseConfig);
  try{
    firebase.appCheck().activate("6LdPa10tAAAAAHH1aA7E31NHC1c2k9k0WFEQ7UZX", true); // true = token अपने आप refresh
    _acRefresh();
    setInterval(_acRefresh, 30*60*1000);
  }catch(eAC){AC_READY=true;}
  firebase.auth().onIdTokenChanged(function(u){
    // पहली बार यह callback तभी चलता है जब Firebase अपना सेव किया हुआ (persisted) login
    // localStorage से बहाल कर चुका होता है — यानी अब currentUser पर भरोसा किया जा सकता है।
    // इससे पहले उसे देखने पर null मिल सकता है और गलत नतीजा निकलता है (देखें _afterAuthReady)
    if(!AUTH_READY){AUTH_READY=true; _authWaiters.splice(0).forEach(function(f){try{f();}catch(e){}});}
    if(u){
      u.getIdToken().then(function(t){
        _setIdToken(t);
        _tokenWaiters.splice(0).forEach(function(f){try{f();}catch(e){}});
      });
    }
    else { firebase.auth().signInAnonymously().catch(function(){setSyncStatus(false);}); }
  });
}catch(e){}

// FB (Realtime Database) की हर fetch call में auth token अपने आप जुड़ जाए — कहीं और कोड बदलने की ज़रूरत नहीं
// token अभी न बना हो तो 4 sec तक इंतज़ार — वरना app खुलते ही निकली save बिना token के 401 खा जाती है
var _rawFetch = window.fetch.bind(window);
function _withToken(url){
  return url + (url.indexOf("?")>-1?"&":"?") + "auth=" + encodeURIComponent(ID_TOKEN);
}
// App Check token हो तो header में जोड़ें (caller के opts को बिना छेड़े copy बनाकर)
function _fbOpts(opts){
  if(!AC_TOKEN) return opts;
  var o={}, k;
  if(opts) for(k in opts) o[k]=opts[k];
  var h={};
  if(o.headers) for(k in o.headers) h[k]=o.headers[k];
  h["X-Firebase-AppCheck"]=AC_TOKEN;
  o.headers=h;
  return o;
}
// token पुराना (expired) हो तो Firebase 401 देता है — device लंबे समय background में पड़ा रहने पर
// SDK का अपने-आप refresh timer देर से चलता है; इसलिए 401 मिलते ही token ज़बरदस्ती ताज़ा करके
// एक बार दोबारा कोशिश करो (PUT/PATCH/DELETE/GET सभी idempotent हैं — दोबारा भेजना सुरक्षित है)
function _fbFetchOnce(url,opts){ return _rawFetch(_withToken(url), _fbOpts(opts)); }
// App Check "enforce" मोड में कमज़ोर नेटवर्क पर reCAPTCHA token समय पर न बन पाए तो 403 आ सकता है —
// ऐसे में भी ज़बरदस्ती नया App Check token लेकर एक बार दोबारा कोशिश करो। अगर असली वजह Security
// Rules से permission-denied हो, तो retry भी वैसे ही 403 देगा — कोई नुकसान नहीं, सिर्फ़ एक अतिरिक्त कोशिश
function _acForceRefresh(){
  try{
    return firebase.appCheck().getToken(true)
      .then(function(t){_setAcToken(t&&t.token);})
      .catch(function(e){ _acNoteFail(e,"401/403 के बाद"); });
  }catch(e){return Promise.resolve();}
}
function _fbFetchWithAuth(url,opts){
  return _fbFetchOnce(url,opts).then(function(r){
    if(r.status===401){
      var u=firebase.auth().currentUser;
      if(!u) return r;
      // 401 सिर्फ़ login token expire से नहीं आता — "Missing appcheck token" पर भी सर्वर 401 देता है
      // (असली production लॉग, v9.165: "AppCheck token: था" फिर भी सर्वर मना — race थी, fetch जाते
      // वक़्त AC_TOKEN अभी null था)। इसलिए AC_TOKEN missing हो तो उसे भी ताज़ा करके login token के
      // साथ एक बार दोबारा कोशिश करो
      var acJob=(AC_TOKEN&&!_acStale())?Promise.resolve():_acForceRefresh();
      return acJob.then(function(){
        return u.getIdToken(true).then(function(t){
          _setIdToken(t);
          return _fbFetchOnce(url,opts);
        }).catch(function(){return r;});
      });
    }
    if(r.status===403){
      return _acForceRefresh().then(function(){
        return _fbFetchOnce(url,opts);
      });
    }
    return r;
  });
}
window.fetch = function(url, opts){
  if(typeof url==="string" && url.indexOf(FB)===0){
    if(ID_TOKEN && AC_READY) return _fbEnsureFresh().then(function(){ return _fbFetchWithAuth(url,opts); });
    // offline — तुरंत fail होकर offline-queue संभाले। पर v9.172 के लॉग (save-fail "Failed to fetch")
    // से पता चला कि कमज़ोर नेट पर फ़ोन ख़ुद को offline मान लेता है जबकि नेट थोड़ा-बहुत चल रहा होता है —
    // ऐसी request सर्वर तक पहुंच जाती और App Check header न होने से "unverified" में गिनती थी। इसलिए
    // यहां भी जो token तैयार हों वो लगा दो (कोई नई call नहीं, सिर्फ़ header/?auth= जुड़ता है)
    if(!navigator.onLine) return _rawFetch(ID_TOKEN?_withToken(url):url,_fbOpts(opts));
    return new Promise(function(resolve){
      var done=false;
      var tm=setTimeout(function(){
        if(done)return; done=true;
        if(ID_TOKEN){ resolve(_fbFetchWithAuth(url,opts)); return; }
        // login token 4 सेकंड में भी नहीं बना (असली bug, v9.165 लॉग "login token: नहीं था") — पहले
        // यहां से बिल्कुल raw (बिना App Check header के भी) fetch चला जाता था, भले ही उसी बीच
        // App Check token बन चुका हो। सिर्फ़ ID_TOKEN की देर की वजह से App Check header मत छोड़ो —
        // "Missing appcheck token" यहीं से भी आ रहा था
        resolve(_rawFetch(url,_fbOpts(opts)));
      },4000);
      function check(){
        if(done||!ID_TOKEN||!AC_READY)return;
        done=true; clearTimeout(tm);
        resolve(_fbFetchWithAuth(url,opts));
      }
      if(ID_TOKEN) check(); else _tokenWaiters.push(check);
      if(AC_READY) check(); else _acWaiters.push(check);
    });
  }
  return _rawFetch(url, opts);
};


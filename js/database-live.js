// ── Firebase डेटा: लाइव-sync (startListen, SSE/FetchLiveSource, token-expiry जांच) ──
// कोड-गुणवत्ता कदम 4 (v9.199): js/database.js से अलग की गई — लोड-क्रम: database.js → database-write.js → यह

var catNamesTimer = null;
var liveSource = null; // real-time SSE stream (Firebase REST streaming)
// EventSource का URL जुड़ते वक़्त का ID_TOKEN अपने साथ रखता है — Firebase ID token ~1 घंटे बाद
// expire होता है, तो एक ही list घंटों खुली रहने पर स्ट्रीम बंद (readyState=2) हो सकती है। पहले
// यहां से सीधे हमेशा के लिए हर-15-सेकंड वाले भारी polling (पूरी लिस्ट दोबारा) पर चले जाते थे, कभी
// वापस सस्ते live-sync पर नहीं लौटते — असली bandwidth bug यही था, बिना किसी modal/बटन के, सिर्फ़
// list देर तक खुली रहने से। अब पहले ताज़ा token के साथ EventSource दोबारा जोड़ने की कोशिश होती है
var _esReconnectAttempts = 0;

// ── नेट-झटके पर रुक-रुक कर दोबारा जुड़ना ──────────────────────────────────────────────────────
// असली production नाप: कमज़ोर नेट वाले एक लाइनमैन (आनंद कुमार कवरेती, आदेगांव) ने अकेले पूरे DC
// का 27% (54.5 MB) खाया — उसी दिन उसके device पर बार-बार "Failed to fetch" भी दर्ज थे। वजह:
// नेट का हर छोटा झटका (readyState 0) EventSource को ~3 सेकंड में अपने-आप दोबारा जोड़ देता है, और
// Firebase हर बार जुड़ते ही *पूरी* list भेजता है — ऊपर वाली token-expiry की सस्ती ETag जांच सिर्फ़
// पूरी तरह बंद (readyState 2) होने पर चलती है, इन झटकों पर नहीं। SSE पर "कुछ बदला?" पूछकर भी
// बचत नहीं होती (जुड़ना ही पूरी list है), इसलिए उपाय जुड़ने की गिनती घटाना है: टूटने पर browser का
// अपना reconnect रोककर खुद ES_BACKOFF_BASE_MS बाद जुड़ें, और कनेक्शन टिके बिना फिर टूटे तो इंतज़ार
// दोगुना (अधिकतम ES_BACKOFF_MAX_MS)। ES_STABLE_MS तक टिक जाए तो फिर शुरू से। पुराने तरीक़े से कभी
// ज़्यादा जुड़ना नहीं होता; कीमत बस इतनी कि कमज़ोर नेट के दौरान दूसरों के बदलाव थोड़ी देर से दिखें —
// वसूली सेव करना (PATCH) इस पर निर्भर नहीं, वह अलग से तुरंत जाता है
var ES_BACKOFF_BASE_MS=5000;
var ES_BACKOFF_MAX_MS=2*60*1000;
var ES_STABLE_MS=60*1000;
var _esBackoffMs=0;
var _esOpenedAt=0;
var _esRetryT=null;

// ── जांच: क्या Firebase live-sync को मना कर रहा है? ──────────────────────────────────────────
// Firebase Console (App Check) में ~15% requests "Unverified: outdated client" दिख रही थीं, जबकि
// Database "Enforced" पर है — यानी बिना App Check token वाली हर request मना होती है। बाक़ी सारी
// requests js/firebase.js के fetch-wrapper से token (X-Firebase-AppCheck header) के साथ जाती हैं,
// पर EventSource में header भेजने का कोई तरीक़ा ही नहीं — तो शक है कि live-sync हर बार मना होकर
// चुपचाप polling पर चला जाता है (ज़्यादा data, और लाइनमैन को कोई गड़बड़ी दिखती भी नहीं)।
// पक्का करने के लिए: connection एक बार भी खुले बिना सीधे CLOSED हो तो "एरर लॉग" में दर्ज करो —
// हर ऐप-खुलने पर सिर्फ़ एक बार, ताकि LOGS न भरे
var _sseNeverOpenedLogged=false;
// v9.164: v9.163 (fetch stream) के बाद भी एक device (मढ़ी) से यह entry आई — अब साथ में यह भी दर्ज
// होता है कि किस तरीक़े से जुड़ने की कोशिश थी (fetch stream या पुराना EventSource — बहुत पुराने
// browser पर fetch stream नहीं चलता), और fetch में सर्वर ने कौन-सा HTTP status/जवाब दिया
function _sseLogNeverOpened(hq,cat,es){
  if(_sseNeverOpenedLogged) return;
  _sseNeverOpenedLogged=true;
  var how=(typeof FetchLiveSource==="function"&&es instanceof FetchLiveSource)?"fetch":"EventSource";
  var extra=" • तरीका: "+how;
  if(es&&es.httpStatus) extra+=" • HTTP "+es.httpStatus;
  if(es&&es.errText) extra+=" • जवाब: "+es.errText;
  extra+=" • खाता: "+_liveAcctKind();
  logErr("sse-never-opened",
    "live-sync एक बार भी नहीं जुड़ा — सर्वर ने connection मना किया (App Check या account की दिक़्क़त)",
    hq+"/"+cat+" • AppCheck token: "+(AC_TOKEN?"था":"नहीं था")+" • login token: "+(ID_TOKEN?"था":"नहीं था")+extra);
}

// ── कदम 2: header भेज सकने वाला live-sync (fetch stream) ────────────────────────────────────
// ऊपर वाली जांच ने पक्का कर दिया (24 सितंबर, सभी 6 HQ के लगभग हर device पर "sse-never-opened",
// ज़्यादातर "AppCheck token: था • login token: था" के साथ): EventSource किसी भी device पर जुड़ ही
// नहीं रहा था — App Check "Enforced" है और EventSource App Check header भेज नहीं सकता, तो सर्वर
// हर बार मना कर देता, ऐप 3 कोशिशों बाद 15-सेकंड polling पर चला जाता (हर मना हुई कोशिश + हर poll
// एक अलग request, और दूसरों के बदलाव देर से दिखते)।
// यह उसी Firebase streaming endpoint से fetch() के ज़रिए जुड़ता है — fetch js/firebase.js के wrapper
// से जाता है, जो login token (?auth=) और App Check header दोनों जोड़ता है, token बनने तक (4 सेकंड
// तक) इंतज़ार करता है ("login token: नहीं था" वाली entries — ऐप login पूरा होने से पहले जुड़ रहा था),
// और 401/403 पर token ताज़ा करके एक बार दोबारा कोशिश करता है। बाक़ी ऐप के लिए यह बिल्कुल EventSource
// जैसा दिखता है (readyState 0/1/2, onopen, onerror, addEventListener, close) — इसलिए _openLive का
// सारा पुराना व्यवहार (backoff, token-expiry की सस्ती ETag जांच, patch event, polling fallback) वैसा ही:
//   • HTTP मनाही (जवाब ok नहीं) या सर्वर का "cancel"/"auth_revoked" event → readyState 2 (CLOSED)
//   • जुड़ने के बाद stream टूटना / नेट की गड़बड़ी → readyState 0 (नेट का झटका — रुककर दोबारा)
// ── v9.167: live-sync सही login पक्का होने के बाद ही ─────────────────────────────────────────
// v9.166 के बाद App Check पास होने लगा (अब "Missing appcheck token" नहीं), पर सर्वर "Permission
// denied" देने लगा — दो तरह से: "login token: नहीं था" (ऐप खुलते ही stream login token बनने से पहले
// खुल गया) और "login token: था" (token था, पर उस वक़्त device का Firebase account अभी गुमनाम/
// anonymous था — _ensureCorrectHqAuth उसी पल पीछे से सही HQ account में sign-in कर रहा था; Security
// Rules HQ का data सिर्फ़ उसी HQ के account को पढ़ने देती हैं)। यानी stream उस दौड़ में हार जाता था।
// अब stream खोलने से पहले: Firebase का auth तय हो (_afterAuthReady) → लाइनमैन का सही HQ account
// पक्का हो (_ensureCorrectHqAuth) → उसी account का ताज़ा token लिया जाए। Firebase ही न हो (offline
// पहली बार / tests) तो तुरंत
function _liveAuthReady(fn){
  var fbOk=false;
  try{ fbOk=typeof firebase!=="undefined"&&!!firebase&&typeof firebase.auth==="function"; }catch(e){}
  if(!fbOk) return fn();
  _afterAuthReady(function(){
    var go=function(){
      var u=null;
      try{ u=firebase.auth().currentUser; }catch(e){}
      if(!u) return fn();
      u.getIdToken().then(function(t){ _setIdToken(t); fn(); },function(){ fn(); });
    };
    if(typeof _ensureCorrectHqAuth==="function") _ensureCorrectHqAuth(go); else go();
  });
}
// लॉग के लिए — device किस Firebase account पर है (email नहीं, सिर्फ़ किस्म)
function _liveAcctKind(){
  try{
    var u=firebase.auth().currentUser;
    if(!u) return "कोई नहीं";
    if(u.isAnonymous||!u.email) return "anonymous";
    if(u.email===JE_EMAIL) return "JE";
    if(CU&&HQ_AUTH_EMAIL[CU.hq]===u.email) return "सही HQ";
    return "दूसरा HQ";
  }catch(e){ return "अज्ञात"; }
}
function _fetchStreamSupported(){
  return typeof fetch==="function"&&typeof AbortController==="function"&&typeof TextDecoder==="function"&&
    typeof ReadableStream!=="undefined"&&typeof Response!=="undefined"&&("body" in Response.prototype);
}
function FetchLiveSource(url){
  var self=this;
  self.readyState=0;
  self.onopen=null;
  self.onerror=null;
  self._l={};
  self._closed=false;
  /** @type {number|undefined} मनाही का HTTP status (एरर लॉग के लिए) */ self.httpStatus=undefined;
  /** @type {string|undefined} */ self.errText=undefined;
  self._ctrl=new AbortController();
  // stream तभी खोलें जब सही account (लाइनमैन = उसी HQ का account) और उसका ताज़ा login token पक्का
  // हो — देखें _liveAuthReady। तब तक readyState 0 (जुड़ रहा है) रहता है
  _liveAuthReady(function(){ if(!self._closed) self._start(url); });
}
FetchLiveSource.prototype._start=function(url){
  var self=this;
  fetch(url,{headers:{"Accept":"text/event-stream"},cache:"no-store",signal:self._ctrl.signal})
    .then(function(r){
      if(self._closed) return;
      if(!r.ok||!r.body){
        // मनाही की असली वजह "एरर लॉग" के लिए रख लो — HTTP status + सर्वर का छोटा-सा जवाब
        // (जैसे "Permission denied" या App Check वाली error) — देखें _sseLogNeverOpened
        self.httpStatus=r.status;
        var done=function(t){ self.errText=String(t||"").replace(/\s+/g," ").slice(0,120); self._fail(2); };
        if(r.text) r.text().then(done,function(){ done(""); }); else done("");
        return;
      }
      self.readyState=1;
      if(self.onopen) self.onopen();
      var reader=r.body.getReader(),dec=new TextDecoder(),buf="";
      function pump(){
        return reader.read().then(function(res){
          if(self._closed) return;
          if(res.done){ self._fail(0); return; } // सर्वर ने stream बंद की — नेट के झटके जैसा
          buf+=dec.decode(res.value,{stream:true});
          var blocks=buf.split(/\r?\n\r?\n/);
          buf=blocks.pop();
          for(var i=0;i<blocks.length&&!self._closed;i++) self._dispatch(blocks[i]);
          if(!self._closed) return pump();
        });
      }
      return pump();
    })
    .catch(function(){ if(!self._closed) self._fail(0); });
};
FetchLiveSource.prototype.addEventListener=function(type,fn){ (this._l[type]||(this._l[type]=[])).push(fn); };
FetchLiveSource.prototype.close=function(){
  this._closed=true;
  this.readyState=2;
  try{ this._ctrl.abort(); }catch(e){}
};
FetchLiveSource.prototype._fail=function(state){
  if(this._closed) return;
  this.readyState=state;
  if(state===2) this.close();
  if(this.onerror) this.onerror({});
};
FetchLiveSource.prototype._dispatch=function(block){
  var type="message",data=[];
  block.split(/\r?\n/).forEach(function(line){
    if(line.indexOf("event:")===0) type=line.slice(6).trim();
    else if(line.indexOf("data:")===0) data.push(line.slice(5).replace(/^ /,""));
  });
  // cancel = अब पढ़ने की अनुमति नहीं; auth_revoked = login token expire — दोनों में सर्वर आगे कुछ नहीं
  // भेजेगा, EventSource जैसा CLOSED मानो (वहीं से ताज़ा token के साथ सस्ता reconnect होता है)
  if(type==="cancel"||type==="auth_revoked"){ this._fail(2); return; }
  var fns=this._l[type];
  if(!fns||!fns.length) return; // keep-alive वगैरह
  var ev={type:type,data:data.join("\n")};
  fns.slice().forEach(function(f){ try{ f(ev); }catch(e){} });
};
// live-sync किससे जुड़े — fetch stream (header जाता है) जहां चले, वरना पुराना EventSource, वरना कुछ नहीं (polling)
function _liveSourceFor(hq,cat){
  if(_fetchStreamSupported()) return new FetchLiveSource(FB+"/"+fbPath(hq,cat)+".json");
  if(typeof EventSource==="function") return new EventSource(FB+"/"+fbPath(hq,cat)+".json"+(ID_TOKEN?("?auth="+encodeURIComponent(ID_TOKEN)):""));
  return null;
}

function stopListen(){
  if(pollTimer){clearInterval(pollTimer);pollTimer=null;}
  if(liveSource){liveSource.close();liveSource=null;}
  if(_esRetryT){clearTimeout(_esRetryT);_esRetryT=null;}
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

// ── TOKEN-EXPIRY RECONNECT से पहले हल्की ETag जांच ──────────────────────────────────────────
// Firebase ID token हर ~1 घंटे expire होता है, तो EventSource बंद (readyState=2) होकर दोबारा
// जुड़ता है — और हर बार जुड़ते ही SSE पूरी list भेजता है (ETag जैसा कुछ नहीं)। JE का सवाल: "ऐप
// खुला छोड़ने पर cost बढ़ती है क्या?" — जवाब था हां, ठीक इसी वजह से। असल में list ज़्यादातर बार
// उस एक घंटे में बदली ही नहीं होती (खासकर देर रात या device बस स्क्रीन जगाए पड़ा हो), इसलिए यहां
// भारी reconnect से पहले पहले एक हल्की (304 पर लगभग-मुफ़्त) जांच कर लेते हैं।
// कुछ नहीं बदला: अभी भारी reconnect मत करो, TOKEN_RECHECK_MS बाद फिर जांच लो — तब तक SSE बंद रहेगा
// (किसी और device का इसी बीच का बदलाव थोड़ी देर बाद दिखेगा, live नहीं — पर कुछ खोता नहीं)।
// कुछ बदला निकले, जांच ही नाकाम हो, या offline/pause हो — पुराने, हमेशा-safe रास्ते पर लौट जाओ
var TOKEN_RECHECK_MS=2*60*1000;
var ES_RECONNECT_DELAY_MS=2000; // token-expiry के बाद जांच से पहले थोड़ा रुकना — token सर्वर-साइड settle हो जाए
function _tokenExpiryRecheck(hq,cat){
  if(!(CU&&activeHQ===hq&&activeCat===cat)) return; // यह tab अब सक्रिय ही नहीं — असली tab की अपनी startListen संभाल लेगी
  if(!navigator.onLine||isDataPaused()){
    setTimeout(function(){_tokenExpiryRecheck(hq,cat);},TOKEN_RECHECK_MS);
    return;
  }
  fetch(FB+"/"+fbPath(hq,cat)+".json?t="+Date.now(),{headers:_etagHeaders(hq,cat)})
    .then(function(r){
      if(r.status===304){ setTimeout(function(){_tokenExpiryRecheck(hq,cat);},TOKEN_RECHECK_MS); return; }
      _openLive(hq,cat); // कुछ बदला — असली (पूरा) reconnect करो
    })
    .catch(function(){ _openLive(hq,cat); }); // जांच नाकाम — पुराने रास्ते पर लौट जाओ
}

// ── TAB-REVISIT ऑप्टिमाइज़ेशन ──────────────────────────────────────────────────────────────
// यह ठीक वही समस्या है जो ऊपर token-expiry reconnect के लिए हल की — SSE जुड़ते ही हमेशा *पूरी*
// list भेजता है, कभी सिर्फ़ 304 नहीं। JE का सवाल: "बैंडविथ cost घटाने के और उपाय?" — किसी और
// tab पर जाकर (नंबर चेक करना, तुलना करना) वापस उसी tab पर आना दिन में कई बार होता है, और हर बार
// पूरी "कुल उपभोक्ता" जैसी बड़ी list दोबारा उतरती थी।
// अब: अगर यही list हाल ही में (TAB_REVISIT_GRACE_MS के अंदर) एक बार पूरी तरह ताज़ा देखी जा चुकी है,
// तो सीधे भारी SSE न खोलें — पहले एक हल्की ETag जांच करें। कुछ नहीं बदला (304, लगभग मुफ़्त) तो
// cache पर टिके रहो, असली live-connection उस खिड़की के बीतते ही (उपयोगकर्ता अब भी उसी tab पर हो
// तभी) अपने-आप जुड़ जाएगी। कुछ बदला निकले तो सीधे _openLive — वही नई data समेत live जोड़ देगा,
// दोबारा data को हाथ से लागू करने की ज़रूरत नहीं (कोई logic दोहराया नहीं, इसलिए दोनों जगह एक जैसा
// व्यवहार पक्का रहता है)। जांच नाकाम, offline, pause, या pending बदलाव हों — पुराने, हमेशा-safe
// रास्ते पर लौट जाओ। पहली बार खोलने पर (_lastLiveAt खाली) यह छूट लागू ही नहीं होती — वहां हमेशा
// जैसा असली live sync चलता है।
// JE का सवाल: "90 सेकंड को कुछ बड़ा नहीं कर सकते?" — किया, और ui-core.js के LISTEN_HIDE_GRACE_MS
// (background में जाने पर connection कितनी देर खुला रखें) जितना ही रखा — पूरे ऐप में एक ही नियम,
// चाहे tab बदलकर हो या background से। नुक़सान भी वैसा ही जाना-पहचाना: इस खिड़की में किसी और
// device का बदलाव उतनी देर live नहीं दिखेगा (डेटा नहीं खोता, बस देर से दिखता है) — जितनी बड़ी
// खिड़की, उतनी ज़्यादा बचत पर उतनी ही ज़्यादा (हानिरहित) देरी भी।
// v9.153 के दिन असली Firebase Console में देखा गया कि रोज़ाना 360MB मुफ़्त-कोटा का 86% तक खर्च
// हो रहा है, और यह ज़्यादातर उन devices से आ रहा था जो category/मुख्यालय के बीच बार-बार आते-जाते
// हैं — हर बार जो tab 3 मिनट के अंदर दोबारा न खुले, उस पर पूरी list दोबारा SSE से उतरती थी।
// JE का फ़ैसला: 3 मिनट से बढ़ाकर 10 मिनट — "थोड़ी देर से दिखे" का जोखिम इस ऐप के इस्तेमाल के
// हिसाब से बहुत छोटा है, पर ज़्यादातर आम आना-जाना (नंबर compare करना, दूसरी category देखकर वापस
// आना) अब सस्ते (304) रास्ते में आ जाएगा
var TAB_REVISIT_GRACE_MS=10*60*1000;
var _lastLiveAt={};

function startListen(hq,cat){
  var key=hq+"/"+cat;
  var recent=_lastLiveAt[key]&&(Date.now()-_lastLiveAt[key]<TAB_REVISIT_GRACE_MS);
  if(recent&&navigator.onLine&&!isDataPaused()&&!isPending(hq,cat)){
    stopListen();
    fetch(FB+"/"+fbPath(hq,cat)+".json?t="+Date.now(),{headers:_etagHeaders(hq,cat)})
      .then(function(r){
        if(r.status===304){
          // कुछ नहीं बदला — cache भरोसेमंद है; असली live-connection अभी नहीं, टाल दो
          setTimeout(function(){
            if(activeHQ===hq&&activeCat===cat&&!liveSource&&!pollTimer) _openLive(hq,cat);
          },TAB_REVISIT_GRACE_MS);
          return;
        }
        _openLive(hq,cat); // कुछ बदला — सीधे असली reconnect, वही ताज़ा data ले आएगा
      })
      .catch(function(){ _openLive(hq,cat); }); // जांच नाकाम — पुराने, हमेशा-safe रास्ते पर लौट जाओ
    return;
  }
  _openLive(hq,cat);
}

function _openLive(hq,cat){
  stopListen();
  // 🛑 डेटा बचाओ मोड — live sync ही सबसे बड़ा download खर्च है, इसलिए जुड़ें ही नहीं।
  // स्विच हटते ही _applyPause खुद दोबारा जोड़ देता है, और जुड़ते ही पूरा ताज़ा data आ जाता है
  if(isDataPaused()) return;

  function applyIncoming(d){
    trackUsageOf(d); // SSE का सबसे भारी हिस्सा — जुड़ते ही पूरी list आती है; पहले यह बिल्कुल नहीं गिनी जाती थी
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
    _lastLiveAt[hq+"/"+cat]=Date.now(); // tab-revisit gate के लिए — "आख़िरी बार कब पक्का ताज़ा देखा"
  }

  // migrated (per-record) HQ/श्रेणी में "patch" event से मिला delta local array पर लगाना —
  // पूरी लिस्ट दोबारा मंगाने की ज़रूरत नहीं (bandwidth बचत, वैसे ही जैसे "put" event के लिए ऊपर की गई)
  // migration-revert जांच यहां ज़रूरी नहीं — "patch" event खुद सबूत है कि data अब भी सही per-record रूप में है
  function applyPatchLocal(patchData){
    trackUsageOf(patchData);
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
    _lastLiveAt[hq+"/"+cat]=Date.now();
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
  var es=null;
  try{ es=_liveSourceFor(hq,cat); }catch(e){ es=null; }
  if(es){
    try{
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
      var esOpened=false;
      es.onopen=function(){esOpened=true;setSyncStatus(true);_esReconnectAttempts=0;_esOpenedAt=Date.now();};
      es.onerror=function(){
        setSyncStatus(false);
        // एक बार भी जुड़े बिना सीधे CLOSED = सर्वर ने HTTP स्तर पर मना किया (नेट का झटका होता तो
        // readyState 0 होता) — देखें _sseLogNeverOpened
        if(!esOpened&&es.readyState===2&&navigator.onLine) _sseLogNeverOpened(hq,cat,es);
        if(es.readyState===0){ // CONNECTING — नेट का झटका, browser ~3 सेकंड में खुद जोड़ने वाला है
          var stable=_esOpenedAt&&(Date.now()-_esOpenedAt>=ES_STABLE_MS);
          _esBackoffMs=stable||!_esBackoffMs?ES_BACKOFF_BASE_MS:Math.min(_esBackoffMs*2,ES_BACKOFF_MAX_MS);
          _esOpenedAt=0;
          es.close(); // browser का अपना (तुरंत, बिना गिनती) reconnect रोको
          // liveSource जान-बूझकर यही (बंद) es रहता है — "live अभी इसी tab का है, बस रुककर जुड़ेगा";
          // कोई और रास्ता (tab-revisit वाला timer) इसे खाली देखकर बीच में ही भारी reconnect न कर दे
          if(_esRetryT) clearTimeout(_esRetryT);
          _esRetryT=setTimeout(function(){
            _esRetryT=null;
            // इस बीच tab बदला / stopListen हुआ (liveSource बदल गया), polling चालू हुई, या डेटा-बचाओ — कुछ न करें
            if(liveSource!==es||pollTimer||!(CU&&activeHQ===hq&&activeCat===cat)||isDataPaused()) return;
            _openLive(hq,cat);
          },_esBackoffMs);
          return;
        }
        if(es.readyState===2){ // CLOSED — स्ट्रीम पूरी तरह टूट गई (जैसे token expire)
          if(liveSource===es) liveSource=null;
          if(_esReconnectAttempts<3){
            // पहले ताज़ा ID_TOKEN के साथ सस्ता live-sync दोबारा जोड़ने की कोशिश — token expire होना
            // सामान्य बात है (हर ~1 घंटे), भारी polling पर जाने की ज़रूरत नहीं। सीधे startListen नहीं —
            // पहले _tokenExpiryRecheck की हल्की ETag जांच (देखें ऊपर) ताकि कुछ न बदला हो तो भारी
            // पूरी-list reconnect टाला जा सके
            _esReconnectAttempts++;
            setTimeout(function(){ _tokenExpiryRecheck(hq,cat); },ES_RECONNECT_DELAY_MS);
          } else {
            // लगातार 3 बार तुरंत बंद हो रहा है (शायद असली permission समस्या) — तभी polling पर जाओ
            startPolling();
          }
        }
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
    fetchPhCustomMsgFromFB();
    loadMigratedFlags();
  },12*60*60*1000);
}

// ── Login/Session/Auth-Recovery — ui-core.js से अलग किया गया (structure सुधार, यह पूरा
// हिस्सा "कौन लॉगिन है और किस account से" की चिंता करता है, generic UI chrome से अलग concern) ──

// ── JE पासवर्ड verify — असली जाँच Firebase Authentication करता है, code में पासवर्ड कहीं नहीं ──
function _sha256(str){
  if(!(window.crypto&&crypto.subtle&&window.TextEncoder)) return Promise.reject(new Error("no-crypto"));
  return crypto.subtle.digest("SHA-256",new TextEncoder().encode(str)).then(function(buf){
    return Array.prototype.map.call(new Uint8Array(buf),function(b){return ("0"+b.toString(16)).slice(-2);}).join("");
  });
}
// online login सफल होने पर hash device पर save — ताकि बाद में offline भी JE login चले
function _saveJEHash(pw){_sha256("dcje|"+pw).then(function(h){try{localStorage.setItem("dc_jeh",h);}catch(e){}}).catch(function(){});}
function _checkJEHash(pw,cb){
  var h=null; try{h=localStorage.getItem("dc_jeh");}catch(e){}
  if(!h){cb(false,"पहली बार JE login के लिए इन्टरनेट ज़रूरी है");return;}
  _sha256("dcje|"+pw).then(function(x){cb(x===h,x===h?null:"गलत पासवर्ड!");}).catch(function(){cb(false,"यह ब्राउज़र offline JE login support नहीं करता");});
}
var JE_VERIFY_TIMEOUT_MS=6000; // टेस्ट में छोटा करके तेज़ जांच की जा सकती है
function verifyJE(pw,cb){
  if(!pw){cb(false,"पासवर्ड डालें");return;}
  var fbAuthOk=false;
  try{fbAuthOk=typeof firebase!=="undefined"&&!!firebase.auth;}catch(e){}
  if(navigator.onLine&&fbAuthOk){
    showLoader("JE पासवर्ड जाँच रहे हैं...");
    // navigator.onLine सही होते हुए भी सिग्नल कमज़ोर हो तो सर्वर जवाब देर से दे सकता है —
    // तय समय में जवाब न आए तो हमेशा के लिए न अटकें, offline hash से आगे बढ़ जाएं
    var settled=false;
    var tm=setTimeout(function(){
      if(settled)return; settled=true;
      hideLoader();
      _checkJEHash(pw,cb);
    },JE_VERIFY_TIMEOUT_MS);
    firebase.auth().signInWithEmailAndPassword(JE_EMAIL,pw)
      .then(function(){
        _saveJEHash(pw); // भले cb timeout से जा चुका हो, hash फिर भी ताज़ा रख दो
        if(settled)return; settled=true; clearTimeout(tm);
        hideLoader();cb(true,null);
      })
      .catch(function(e){
        if(settled)return; settled=true; clearTimeout(tm);
        hideLoader();
        if(e&&e.code==="auth/network-request-failed"){_checkJEHash(pw,cb);return;} // नेट बीच में टूटा — offline hash से
        cb(false,"गलत पासवर्ड!");
      });
  } else {
    _checkJEHash(pw,cb); // offline — पिछले online login के hash से
  }
}

// ── Lineman PIN: हर HQ का एक साझा PIN (सामान्य सुरक्षा-मज़बूती — कोई भी नाम भरकर न घुस सके) ──
// असली access-control अब Security Rules से ही है (HQ_PIN सिर्फ़ JE पढ़/लिख सकते हैं, v9.146) —
// यह HQ_PINS variable अब सिर्फ़ JE के "Lineman PIN" मेनू (देखें openPinModal/savePins) के लिए है।
// लाइनमैन login के वक़्त PIN यहां से नहीं पढ़ते (देखें doLogin) — असली जांच सीधे Firebase
// signInWithEmailAndPassword करता है, और _ensureCorrectHqAuth बाद के दोबारा sign-in के लिए
// device पर याद रखे CU.pin का इस्तेमाल करता है (सर्वर से दोबारा पढ़ने का रास्ता जान-बूझकर बंद है)
var HQ_PINS={};
function loadHQPins(){
  try{var s=localStorage.getItem("dc_hqpins");if(s)HQ_PINS=JSON.parse(s);}catch(e){}
  fetchHQPinsFromFB();
}
function fetchHQPinsFromFB(){
  fetch(FB+"/HQ_PIN.json?t="+Date.now())
    .then(_fbJson)
    .then(function(d){
      trackUsageOf(d);
      if(d&&typeof d==="object"){
        var oldPin=CU?HQ_PINS[hqKey(CU.hq)]:null;
        HQ_PINS=d;
        try{localStorage.setItem("dc_hqpins",JSON.stringify(d));}catch(e){}
        // JE ने PIN बदल दिया हो तो device के पास सेव पुराना PIN गलत हो चुका है — उससे किया
        // sign-in नाकाम रहता है और device चुपचाप anonymous रह जाता (हर save 401)। ताज़ा PIN
        // मिलते ही सही account से दोबारा जुड़ने की कोशिश करें
        if(CU&&oldPin!==HQ_PINS[hqKey(CU.hq)]) _afterAuthReady(_ensureCorrectHqAuth);
      }
    }).catch(function(){});
}

function openPinModal(){
  if(!CU||CU.role!=="supervisor"){toast("सिर्फ JE PIN सेट कर सकते हैं","err");return;}
  var mn=document.getElementById("logout-menu"); if(mn) mn.classList.remove("open");
  var el=document.getElementById("pin-fields");
  // audit-verified: hq/v दोनों escHtml() से गुज़रते हैं (escHtml अब सिंगल-कोट भी escape करता है, तो
  // यहां single-quoted value='...' attribute में भी breakout नहीं हो सकता)
  // eslint-disable-next-line no-unsanitized/property
  el.innerHTML=HQS.map(function(hq){
    var v=HQ_PINS[hqKey(hq)]||"";
    return "<label class='f-label'>"+escHtml(hq)+"</label><input type='text' inputmode='numeric' class='f-input' id='pin-"+hqKey(hq)+"' value='"+escHtml(v)+"' placeholder='खाली = PIN ज़रूरी नहीं' style='margin-bottom:10px;'>";
  }).join("");
  document.getElementById("pin-overlay").classList.add("open");
}
function closePinModal(){document.getElementById("pin-overlay").classList.remove("open");}
function savePins(){
  var d={};
  HQS.forEach(function(hq){
    var v=document.getElementById("pin-"+hqKey(hq)).value.trim();
    if(v) d[hqKey(hq)]=v;
  });
  fetch(FB+"/HQ_PIN.json",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)})
    .then(function(r){
      if(!r.ok) throw new Error("HTTP "+r.status);
      HQ_PINS=d;
      try{localStorage.setItem("dc_hqpins",JSON.stringify(d));}catch(e){}
      toast("✅ PIN सेव हो गए","ok");
      closePinModal();
    })
    .catch(function(e){logErr("pin-save-fail",e);toast("⚠️ सेव नहीं हुआ — दोबारा कोशिश करें","err");});
}

function doLogin(){
  var role=selectedRole,name=document.getElementById("uname-inp").value.trim();
  if(!role){toast("भूमिका चुनें","err");return;}
  if(!name){toast("अपना नाम लिखें","err");return;}
  if(role==="supervisor"){
    verifyJE(document.getElementById("sup-pw").value,function(ok,msg){
      if(!ok){toast(msg||"गलत पासवर्ड!","err");return;}
      CU={role:"supervisor",name:name,hq:HQS[0]};
      _finishLogin(name);
    });
    return;
  }
  var hq=document.getElementById("hq-sel").value;
  if(!hq){toast("HQ चुनें","err");return;}
  var typedPin=document.getElementById("lin-pin").value.trim();
  // PIN अब यहां client-side पहले से जांची नहीं जाती (v9.146 सुरक्षा-फिक्स): पहले HQ_PIN कोई भी
  // login-किया (anonymous भी) device पढ़ सकता था — यानी बिना PIN जाने भी कोई सीधे /HQ_PIN.json
  // पढ़कर सभी HQ के असली PIN पा सकता था, और उन्हीं से बना Firebase password इस्तेमाल करके सीधे
  // उस HQ के असली account में घुस सकता था। अब HQ_PIN सिर्फ़ JE पढ़ सकते हैं (Security Rules) —
  // सही/ग़लत PIN का असली फ़ैसला पूरी तरह नीचे वाला signInWithEmailAndPassword करता है
  var hqEmail=HQ_AUTH_EMAIL[hq];
  var fbAuthOk=false;
  try{fbAuthOk=typeof firebase!=="undefined"&&!!firebase.auth;}catch(e){}
  if(hqEmail&&navigator.onLine&&fbAuthOk){
    showLoader("लॉगिन हो रहा है...");
    firebase.auth().signInWithEmailAndPassword(hqEmail,_hqAuthPassword(typedPin))
      .then(function(){
        hideLoader();
        // pin यहीं याद रखते हैं (सिर्फ़ इसी device पर, localStorage में) — _ensureCorrectHqAuth को
        // बाद में (silent restore, "online" event, session खोने पर) दोबारा sign-in करने के लिए
        // यही चाहिए होता है, और अब HQ_PIN को दोबारा server से पढ़ने का कोई रास्ता नहीं बचा
        CU={role:"lineman",name:name,hq:hq,pin:typedPin};
        _finishLogin(name);
      })
      .catch(function(e){
        hideLoader();
        if(e&&e.code==="auth/network-request-failed"){ // नेट बीच में टूटा — पुराने session/cache पर आगे बढ़ें
          CU={role:"lineman",name:name,hq:hq};
          _finishLogin(name);
          return;
        }
        toast("गलत PIN या सर्वर से जुड़ नहीं पाया — दोबारा कोशिश करें","err");
      });
    return;
  }
  // इस HQ का Firebase account कॉन्फ़िगर नहीं, या ऑफलाइन हैं — पुराने (anonymous) तरीके से आगे बढ़ें
  try{
    var u=firebase.auth().currentUser;
    if(u&&u.email) firebase.auth().signOut();
  }catch(e){}
  CU={role:"lineman",name:name,hq:hq};
  _finishLogin(name);
}
// PIN से Firebase password बनाना — कम से कम 6 अक्षर चाहिए, इसलिए आगे एक तय prefix जोड़ते हैं
// (असली secret PIN ही है, यह prefix कोई गोपनीयता नहीं जोड़ता, सिर्फ़ Firebase की न्यूनतम लंबाई पूरी करता है)
function _hqAuthPassword(pin){ return "vasuli-"+pin; }

// login के ठीक उसी वक़्त नेटवर्क कमज़ोर/बंद हो तो doLogin() पुराने anonymous रास्ते पर चला जाता है
// (device UI में तो लाइनमैन logged-in दिखता है, पर Firebase में असल में anonymous ही रहता है) —
// उस HQ का हर save तब तक 401 देता रहता है जब तक कोई मैन्युअल logout+login न करे। अब network वापस
// आते ही ("online" event पर) यहां से अपने-आप सही HQ account से दोबारा sign-in की कोशिश होती है,
// ताकि लाइनमैन को कुछ पता ही न चले और उसका pending data भी अपने आप sync हो जाए
// एक ही HQ के लिए बार-बार "अटकी हुई गिनती" रीसेट न होती रहे (वरना 401 ↔ रीसेट का झूला चलता
// रहेगा) — हर HQ के लिए app के एक session में सिर्फ़ एक बार
var _authHealed={};
// गलत/पुराने PIN से re-auth नाकाम रहे तो एक HQ के लिए सिर्फ़ एक बार logout+toast (doLogout के बाद
// CU ही null हो जाता है तो ज़्यादातर यह अपने-आप एक बार ही चलेगा, पर _ensureCorrectHqAuth कई जगह से
// लगभग एक साथ बुलाया जा सकता है — जैसे एक साथ कई श्रेणियों में save नाकाम होना — इसलिए अलग गार्ड)
var _authWrongPin={};
// cb (वैकल्पिक) — सही account असल में तय हो जाने पर ही चलता है, न कि सिर्फ़ sign-in *शुरू* होने पर।
// पहले यह हमेशा fire-and-forget था (कोई callback नहीं) — caller (जैसे reconcileHQ) इसके फ़ौरन
// बाद ही चल जाता, जबकि नीचे वाला signInWithEmailAndPassword अभी async चल ही रहा होता — असली
// production bug यही था (v9.140/v9.141 दोनों में save-fail HTTP 401, silent restore पर)
function _ensureCorrectHqAuth(cb){
  cb=cb||function(){};
  if(!CU||CU.role!=="lineman"||!navigator.onLine) return cb();
  var hqEmail=HQ_AUTH_EMAIL[CU.hq];
  if(!hqEmail) return cb();
  var fbAuthOk=false;
  try{fbAuthOk=typeof firebase!=="undefined"&&!!firebase.auth;}catch(e){}
  if(!fbAuthOk) return cb();
  var u=firebase.auth().currentUser;
  if(u&&u.email===hqEmail){
    // पहले से सही account से sign-in है — दोबारा sign-in की ज़रूरत नहीं (PIN जानने की भी नहीं)।
    // पर अगर पहले कभी 401 की वजह से इस HQ की entries "अटकी" चिह्नित हो चुकी हैं, तो वो गिनती
    // अब मान्य नहीं: account सही है यानी rules इस HQ को लिखने देती हैं। पहले यह रीसेट सिर्फ़ नए
    // sign-in पर होता था, इसलिए मैन्युअल logout+login के बाद भी अटका डेटा हमेशा के लिए अटका रह जाता था
    if(!_authHealed[CU.hq]){
      _authHealed[CU.hq]=true;
      _resetAuthFailForHQ(CU.hq);
      flushPending();
    }
    return cb();
  }
  // account ग़लत/anonymous है — असल में नया sign-in चाहिए, इसके लिए PIN ज़रूरी है। v9.146:
  // यह अब server से नहीं (HQ_PIN अब सिर्फ़ JE पढ़ सकते हैं) — पिछले सफल login पर इसी device पर
  // याद रखा गया CU.pin इस्तेमाल होता है (देखें doLogin)। याद न हो (v9.146 से पहले login हुआ था,
  // या offline/network-fail वाले fallback रास्ते से login हुआ था) तो नया sign-in नहीं कर सकते।
  // production में असली bug यही निकला: पहले यहां चुपचाप cb() बुलाकर रुक जाते थे — device हमेशा
  // के लिए ग़लत account पर अटका रह जाता, हर save 401 (कई लाइनमैन पर हुआ — sync-patch-fail बार-बार,
  // कभी अपने-आप न सुधरा)। अब चुपचाप अटकने की बजाय साफ़ logout करके login screen पर भेज देते हैं,
  // ताकि एक बार PIN दोबारा डालते ही (CU.pin सेव होकर) हमेशा के लिए ठीक हो जाए — यह तभी चलता है
  // जब AUTH_READY हो चुका हो (caller हमेशा _afterAuthReady से गुज़ारकर बुलाता है), इसलिए "ग़लत
  // account" का यह नतीजा भरोसेमंद है, कोई अस्थायी/अनिश्चित स्थिति नहीं
  var pin=CU.pin;
  if(!pin){
    doLogout(false);
    toast("🔐 सुरक्षा अपडेट — कृपया एक बार दोबारा PIN डालकर login करें","inf");
    return cb();
  }
  firebase.auth().signInWithEmailAndPassword(hqEmail,_hqAuthPassword(pin))
    .then(function(){
      _authHealed[CU.hq]=true;
      _resetAuthFailForHQ(CU.hq); // पुरानी "अनधिकृत" गिनती अब मान्य नहीं — दोबारा भेजने दो
      flushPending();
      cb();
    })
    .catch(function(e){
      // production में असली bug: यहां पहले हमेशा चुपचाप cb() बुलाकर रुक जाते थे, यह सोचकर कि
      // "पुराना/pending-queue वाला safe रास्ता संभाल लेगा" — पर वो रास्ता सिर्फ़ retry रोकता है,
      // कभी दोबारा सही PIN नहीं मांगता। नतीजा: अगर JE ने बाद में उस HQ का PIN बदल दिया (device पर
      // याद रखा CU.pin अब पुराना/ग़लत हो गया), तो यह sign-in हमेशा उसी ग़लत PIN से नाकाम होता रहता
      // — हर श्रेणी में हर save 401 (पाटन/Vaibhav पर v9.152 में यही मिला, कई श्रेणियों में एक साथ)।
      // नेटवर्क genuinely टूटा हो (auth/network-request-failed) तो logout मत करो — नेट वापस आते
      // ही "online" event पर फिर कोशिश होगी। बाक़ी हर वजह (ग़लत PIN यानी auth/wrong-password या
      // auth/invalid-credential) का मतलब है यह PIN अब काम का नहीं — !pin वाले रास्ते जैसा ही
      // साफ़ logout करके दोबारा सही PIN मांगना ही एकमात्र पक्का रास्ता है
      if(e&&e.code==="auth/network-request-failed") return cb();
      if(!_authWrongPin[CU.hq]){
        _authWrongPin[CU.hq]=true;
        doLogout(false);
        toast("🔐 PIN बदल गया लगता है — कृपया सही PIN डालकर दोबारा login करें","inf");
      }
      cb();
    });
}

// ── LOGIN SESSION ─────────────────────────────────────────────────────────────
// पहले यह sessionStorage में रखा जाता था, जो सिर्फ़ उतनी देर ज़िंदा रहता है जब तक वह tab ज़िंदा है।
// मोबाइल पर असली bug यही था: ऐप minimize करते ही Android/iOS मेमोरी बचाने के लिए उस tab को मार
// देता है, वापस खोलने पर नया tab बनता है और sessionStorage खाली मिलता है — यानी हर बार नाम+PIN
// दोबारा भरना पड़ता था। (Firebase का अपना auth session localStorage में होने से बचा रहता था,
// सिर्फ़ ऐप की अपनी पहचान खोती थी।) अब localStorage में रखते हैं, तो ऐप बंद होने/फ़ोन रीस्टार्ट
// होने पर भी login बना रहता है। यह पूरी तरह device के अंदर की बात है — इससे एक बाइट भी नेटवर्क
// खर्च नहीं होता, उल्टा हर जबरन दोबारा-login पर होने वाली auth call और prefetch बच जाती है।
var SESSION_MAX_DAYS=30; // इतने दिन ऐप बिल्कुल न खुले तो सुरक्षा के लिए दोबारा login माँगेगा
function saveSession(){
  try{localStorage.setItem("dc_cu",JSON.stringify({cu:CU,at:Date.now()}));}catch(e){}
}
function clearSession(){
  try{localStorage.removeItem("dc_cu");}catch(e){}
  try{sessionStorage.removeItem("dc_cu");}catch(e){} // v9.107 तक यहीं रखा जाता था
}
// सेव किया हुआ session लौटाए, या null। अवधि "आख़िरी बार ऐप खोलने" से गिनी जाती है (sliding) —
// रोज़ काम करने वाले लाइनमैन को कभी दोबारा login नहीं करना पड़ेगा, पर खोया/छोड़ा हुआ फ़ोन
// SESSION_MAX_DAYS बाद अपने आप बाहर हो जाएगा
function loadSession(){
  var raw=null,o;
  try{raw=localStorage.getItem("dc_cu");}catch(e){}
  if(!raw){ try{raw=sessionStorage.getItem("dc_cu");}catch(e){} } // पुराने version का session — एक बार चल जाए
  if(!raw) return null;
  try{o=JSON.parse(raw);}catch(e){return null;}
  if(!o||typeof o!=="object") return null;
  var cu=o.cu||o; // {cu,at} नया रूप — बिना cu वाला सीधा object पुराना (v9.107 तक का) रूप है
  if(!cu||!cu.role||!cu.hq||!cu.name) return null;
  var at=+o.at||0, now=Date.now();
  // at भविष्य में हो (फ़ोन की घड़ी बदली गई) तो उसे भरोसेमंद न मानें — session चलने दें, समय ताज़ा हो जाएगा
  if(at&&at<=now&&(now-at)>SESSION_MAX_DAYS*24*60*60*1000) return null;
  return cu;
}

function _finishLogin(name,silent){
  // ताकि pull-to-refresh, असली page reload, या मोबाइल का ऐप minimize करने पर tab मर जाना —
  // इनमें से कोई भी login session न मिटाए; startApp() इसी से चुपचाप वापस अंदर ले आता है
  saveSession();
  // silent = सेव किया हुआ session बहाल हुआ है, यानी इस बार signInWithEmailAndPassword नहीं चला।
  // v9.108 का असली regression यही था: पहले tab मरने के बाद दोबारा login करना पड़ता था और वही
  // login हर बार सही HQ account पक्का कर देता था। अब चुपचाप अंदर आ जाते हैं, तो अगर Firebase का
  // अपना session कहीं खो गया या anonymous पर लौट गया (firebase.js खुद ऐसा करता है), device
  // हमेशा के लिए anonymous रह जाता — हर save 401। "online" event यहां मदद नहीं करता क्योंकि वो
  // सिर्फ़ offline→online बदलने पर चलता है, पहले से online रहते हुए ऐप खोलने पर कभी नहीं।
  activeHQ=CU.hq; activeFilter="all";
  rebuildCatsForHQ(activeHQ);
  activeCat=CATS[0];
  document.getElementById("login-screen").classList.remove("active");
  document.getElementById("app-screen").classList.add("active");
  buildUI();
  showLoader("डेटा लोड हो रहा है...");
  // पुराने अपलोड (fix v9.139 से पहले के) अब भी categories के बीच वसूल-status मिसमैच लिए बैठे हो सकते हैं —
  // सिर्फ़ नए अपलोड पर reconcileHQ चलाना उन्हें कभी ठीक नहीं करता। इसलिए हर login पर भी एक बार चला
  // देते हैं — cGet() सिर्फ़ local cache पढ़ता है (कोई network cost नहीं), Firebase पर लिखा तभी जाता
  // है जब सच में कोई मिसमैच मिले (देखें reconcileHQ, js/list.js)। असली production bug (v9.140,
  // फिर v9.141 के बाद भी दोबारा हुआ): silent restore पर सिर्फ़ Firebase का auth resolve होना काफ़ी
  // नहीं — lineman अगर अभी भी पुराने/anonymous account पर हो तो _ensureCorrectHqAuth खुद अपना
  // sign-in शुरू करता है (async, fire-and-forget) और तुरंत लौट आता है; v9.141 के fix में reconcileHQ
  // उसी वक़्त अलग से (सिर्फ़ auth-ready होने पर) चल जाता था — सही account तय होने का इंतज़ार किए
  // बिना — तो भी 401 आ जाता (v9.144 पर मढ़ी/नीलेश में यही दोहराया)। अब reconcileHQ सीधे
  // _ensureCorrectHqAuth() की अपनी completion callback से चलता है, ताकि सही account असल में तय
  // होने के बाद ही लिखे (supervisor/पहले-से-सही-account मामलों में callback तुरंत ही चलता है)
  _afterAuthReady(function(){ _ensureCorrectHqAuth(function(){ reconcileHQ(activeHQ); }); });
  fbGet(activeHQ,activeCat,function(data){
    renderSummaryWith(data); renderListWith(data);
    startListen(activeHQ,activeCat);
    hideLoader(); if(!silent) toast("स्वागत है "+name+"!","ok");
    setTimeout(function(){prefetchAll();},1500); // सभी लिस्ट offline के लिए download (दिन में एक बार — देखें storage.js)
    startDevicePing(); // यह device किस app version पर है — Firebase पर दर्ज करें
  });
}

function doLogout(askConfirm){
  if(askConfirm===undefined) askConfirm=true;
  if(askConfirm&&!confirm("लॉगआउट करना चाहते हैं?"))return;
  // JE था तो Firebase session भी हटाएं — अपने आप anonymous पर लौट जाएगा (firebase.js का onIdTokenChanged)
  try{
    var u=firebase.auth().currentUser;
    if(u&&u.email) firebase.auth().signOut();
  }catch(e){}
  stopListen();
  if(catNamesTimer){clearInterval(catNamesTimer);catNamesTimer=null;}
  stopDevicePing();
  clearSession();
  CU=null; selectedRole="";
  document.getElementById("app-screen").classList.remove("active");
  document.getElementById("login-screen").classList.add("active");
  document.getElementById("uname-inp").value="";
  document.getElementById("sup-pw").value="";
  document.getElementById("hq-sel").value="";
  document.getElementById("lin-pin").value=""; // वरना shared device पर अगला लाइनमैन पुराने PIN से ही login कोशिश करता रह जाता (PIN mismatch से login fail — दिखता है जैसे logout ने कुछ किया ही नहीं)
  document.getElementById("rc-sup").classList.remove("selected");
  document.getElementById("rc-lin").classList.remove("selected");
  document.getElementById("sup-fields").style.display="none";
  document.getElementById("lin-fields").style.display="none";
  var m=document.getElementById("logout-menu");
  if(m) m.classList.remove("open");
}

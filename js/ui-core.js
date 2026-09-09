function showLoader(t){document.getElementById("loader-text").textContent=t||"लोड हो रहा है...";document.getElementById("loader").classList.remove("hidden");}
function hideLoader(){document.getElementById("loader").classList.add("hidden");}

function toast(msg,type){
  var t=document.getElementById("toast");
  t.textContent=msg; t.className="toast show "+(type||"");
  clearTimeout(t._t); t._t=setTimeout(function(){t.classList.remove("show");},3500);
}

// पट्टी में अब सिर्फ़ हरी/लाल बत्ती — कोई शब्द नहीं। पहले वाला लंबा वाक्य छोटी स्क्रीन (360px)
// पर संस्था का नाम काट देता था ("आदेगांव बिजली वि…")।
// उस वाक्य में एक और जानकारी भी थी — कितने बदलाव अभी भेजे जाने बाक़ी हैं। वह दिखनी बंद हो गई,
// इसलिए बत्ती के title/aria-label में डाल दी गई है: बत्ती दबाकर रखने पर पूरी बात दिख जाती है,
// और चौड़ाई भी नहीं घेरती। (रंग-अंधता वालों के लिए भी यही सहारा है, ताकि बत्ती का मतलब अटकल
// का विषय न रहे।)
function setSyncStatus(ok){
  var d=document.getElementById("sdot"),t=document.getElementById("stxt");
  if(!d)return;
  var n=pendingCount();
  d.className=ok?"sdot":"sdot off";
  var lbl=ok?"ऑनलाइन":"ऑफलाइन — डेटा device पर सुरक्षित है";
  if(n) lbl+=" • "+n+" बदलाव भेजना बाक़ी";
  d.setAttribute("title",lbl);
  d.setAttribute("aria-label",lbl);
  if(t) t.textContent=""; // जान-बूझकर खाली — पट्टी में सिर्फ़ बत्ती रहे
}

function updTime(){
  var now=new Date(),el=document.getElementById("stime");
  if(el) el.textContent=now.getHours()+":"+String(now.getMinutes()).padStart(2,"0");
}

// Format date+time for display
function fmtDateTime(dt){
  if(!dt) return "";
  return dt;
}

// ध्यान दें: यहां जान-बूझकर prefetchAll() नहीं बुलाया — गांव में नेटवर्क बार-बार आता-जाता रहता है,
// तो "online" event दिन में कई बार लग सकता है, और हर बार सभी HQ/श्रेणी का पूरा data दोबारा
// डाउनलोड करना असली bandwidth bug था (चारों modal-fix से भी बड़ा, क्योंकि यह बिना कुछ खोले भी अपने
// आप चलता रहता)। Login के वक़्त एक बार prefetch (offline इस्तेमाल के लिए) पहले से काफ़ी है —
// pending बदलाव flushPending() से, और जो list खुली है वो नीचे fbGet() से वैसे भी ताज़ा हो जाती है।
window.addEventListener("online",function(){
  setSyncStatus(true);
  ensureLibs();
  fetchPause(); // 🛑 स्विच का ताज़ा हाल — नेट बंद रहते हुए JE ने बदला हो सकता है
  _ensureCorrectHqAuth(); // पहले सही account पक्का करें, तभी flushPending() को असली मौक़ा मिलेगा
  flushPending();
  fetchCatNamesFromFB(false);
  hscFetch();
  if(CU&&activeHQ&&activeCat&&!isPending(activeHQ,activeCat)){
    fbGet(activeHQ,activeCat,function(d){renderSummaryWith(d);renderListWith(d);});
  }
});
window.addEventListener("offline",function(){setSyncStatus(false);});
// tab/app background में जाते ही (होम बटन दबाकर छोड़ दिया, बंद नहीं किया) live connection और
// टाइमर रोक दो — वरना background में पड़ा device घंटों तक चुपचाप Firebase bandwidth खर्च करता रहता,
// चाहे कोई देख भी नहीं रहा हो। वापस दिखने पर फिर से जोड़ लेते हैं — EventSource खुद जुड़ते ही ताज़ा
// data दे देता है, कुछ छूटता नहीं।
// ...लेकिन तुरंत बंद कर देना उससे भी महंगा निकला। startListen() हर बार नया EventSource खोलता है, और
// Firebase जुड़ते ही अपने पहले "put" event में *पूरी* list भेजता है (यह SSE का तरीक़ा है, इसमें ETag
// जैसा कुछ नहीं) — यानी ऐप से बाहर जाकर वापस आने पर हर बार पूरी "कुल उपभोक्ता" लिस्ट दोबारा उतरती थी।
// लाइनमैन दिन भर WhatsApp/कैमरा/कॉल के लिए ऐप से बाहर-अंदर होता रहता है, तो यह दिन में दर्जनों बार
// होता था — Firebase के रोज़ाना download quota का सबसे बड़ा हिस्सा यही खा रहा था।
// अब: थोड़ी देर के लिए बाहर जाने पर connection चालू ही रहने दो (SSE खुला रहने में कुछ खर्च नहीं होता,
// वो सिर्फ़ असली बदलाव भेजता है)। सच में लंबे समय के लिए background में पड़ा रहे, तभी बंद करो —
// मूल मक़सद (घंटों पड़ा device चुपचाप खर्च न करे) वैसे का वैसा पूरा होता है।
var LISTEN_HIDE_GRACE_MS=3*60*1000;
var _hideTimer=null;
document.addEventListener("visibilitychange",function(){
  if(document.hidden){
    if(_hideTimer) clearTimeout(_hideTimer);
    _hideTimer=setTimeout(function(){
      _hideTimer=null;
      stopListen();
      if(catNamesTimer){clearInterval(catNamesTimer);catNamesTimer=null;}
    },LISTEN_HIDE_GRACE_MS);
  } else {
    if(_hideTimer){ // इतनी जल्दी वापस आ गए कि connection बंद ही नहीं हुआ — कुछ करने की ज़रूरत नहीं
      clearTimeout(_hideTimer); _hideTimer=null;
      return;
    }
    fetchPause(); // वापस सामने आए — स्विच बीच में बदला हो सकता है
    if(CU&&activeHQ&&activeCat) startListen(activeHQ,activeCat);
  }
});
// हर 20 sec — pending बदलाव हों और नेट हो तो sync करते रहो
setInterval(function(){
  var needCat=false;try{needCat=localStorage.getItem("dc_catpending3")==="1";}catch(e){}
  if(navigator.onLine&&(pendingCount()>0||needCat))flushPending();
},20000);

function toggleUserMenu(e){
  e.stopPropagation();
  var m=document.getElementById("logout-menu");
  m.classList.toggle("open");
}
document.addEventListener("click",function(){
  var m=document.getElementById("logout-menu");
  if(m) m.classList.remove("open");
});

function goBack(){
  if(document.getElementById("rmk-overlay").classList.contains("open")){closeRmkModal();return;}
  if(document.getElementById("up-overlay").classList.contains("open")){closeUpModal();return;}
  if(activeFilter!=="all"){
    activeFilter="all";
    document.querySelectorAll(".filter-btn").forEach(function(b){b.className="filter-btn";});
    document.querySelector("[data-f='all']").className="filter-btn active-all";
    fbGet(activeHQ,activeCat,function(d){renderListWith(d);});
    return;
  }
  // slot 1 का नाम अब JE बदल सकता है, इसलिए "घरेलू" hardcoded नहीं — मौजूदा नाम CATS[1] से लो
  if(activeCat!==CATS[1]){
    activeCat=CATS[1]; activeFilter="all";
    buildCatTabs();
    fbGet(activeHQ,activeCat,function(d){renderSummaryWith(d);renderListWith(d);});
    startListen(activeHQ,activeCat);
    return;
  }
  if(CU&&CU.role==="supervisor"){
    var idx=HQS.indexOf(activeHQ);
    if(idx>0){
      activeHQ=HQS[idx-1];
      rebuildCatsForHQ(activeHQ);
      buildHQTabs();
      fbGet(activeHQ,activeCat,function(d){renderSummaryWith(d);renderListWith(d);});
      startListen(activeHQ,activeCat);
      return;
    }
  }
  // सबसे पीछे — login page पर जाएं (lineman के लिए, या supervisor पहले HQ पर)
  // बिना पूछे लॉगआउट जैसा महसूस न हो, इसलिए पक्का पूछें
  if(!confirm("लॉगआउट करना चाहते हैं?"))return;
  goToLogin();
}

function goToLogin(){
  // Go to login screen without clearing user data (stays logged in visually)
  stopListen();
  if(catNamesTimer){clearInterval(catNamesTimer);catNamesTimer=null;}
  document.getElementById("app-screen").classList.remove("active");
  document.getElementById("login-screen").classList.add("active");
  // Re-init on next login click — don't clear fields so user can re-enter easily
}

function selectRole(r){
  selectedRole=r;
  document.getElementById("rc-sup").classList.toggle("selected",r==="supervisor");
  document.getElementById("rc-lin").classList.toggle("selected",r==="lineman");
  document.getElementById("sup-fields").style.display=r==="supervisor"?"block":"none";
  document.getElementById("lin-fields").style.display=r==="lineman"?"block":"none";
}

function togglePw(){var i=document.getElementById("sup-pw");i.type=i.type==="password"?"text":"password";}

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
// असली access-control नहीं (Security Rules अलग से restrict नहीं करतीं) — JE खुद /HQ_PIN में सेट/बदल सकते हैं
var HQ_PINS={};
function loadHQPins(){
  try{var s=localStorage.getItem("dc_hqpins");if(s)HQ_PINS=JSON.parse(s);}catch(e){}
  fetchHQPinsFromFB();
}
function fetchHQPinsFromFB(){
  fetch(FB+"/HQ_PIN.json?t="+Date.now())
    .then(_fbJson)
    .then(function(d){
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
// ── 🛑 डेटा बचाओ मोड — पट्टी और JE का स्विच (असली रोक js/database.js में है) ───────────────
function renderPauseBar(){
  var el=document.getElementById("pause-bar");
  if(!el) return;
  if(!isDataPaused()){ el.style.display="none"; el.textContent=""; return; }
  el.style.display="block";
  // textContent — कोई user-typed नाम यहां HTML बनकर नहीं जा सकता
  el.textContent="🛑 डेटा बचाओ मोड चालू — आपकी वसूली दर्ज हो रही है, बस दूसरों का ताज़ा डेटा अभी नहीं आ रहा";
}
function openPauseModal(){
  if(!CU||CU.role!=="supervisor"){toast("सिर्फ JE यह कर सकते हैं","err");return;}
  var mn=document.getElementById("logout-menu"); if(mn) mn.classList.remove("open");
  document.getElementById("pause-overlay").classList.add("open");
  _pauseRender();
  fetchPause(); // खोलते ही ताज़ा हाल — दूसरे device से बदला हो तो वही दिखे
  setTimeout(_pauseRender,900);
}
function closePauseModal(){document.getElementById("pause-overlay").classList.remove("open");}
function _pauseRender(){
  var el=document.getElementById("pause-content");
  if(!el) return;
  var on=isDataPaused();
  var who="",when="";
  if(PAUSE_INFO&&PAUSE_INFO.by) who=String(PAUSE_INFO.by);
  if(PAUSE_INFO&&PAUSE_INFO.at) { try{ when=new Date(Number(PAUSE_INFO.at)).toLocaleString("hi-IN"); }catch(e){} }
  var h="";
  h+="<div style='background:"+(on?"rgba(240,80,80,.10)":"rgba(0,200,150,.08)")+";border:1px solid "+(on?"rgba(240,80,80,.35)":"rgba(0,200,150,.3)")+";border-radius:12px;padding:12px;margin-bottom:10px;'>";
  h+="<div style='font-size:15px;font-weight:800;color:"+(on?"var(--red)":"var(--green)")+";'>"+(on?"🛑 अभी चालू है — डाउनलोड रुका हुआ है":"✅ अभी बंद है — सब सामान्य चल रहा है")+"</div>";
  if(on&&(who||when)) h+="<div style='font-size:11px;color:var(--muted);margin-top:5px;'>"+escHtml(who?(who+" ने"):"")+(when?(" "+escHtml(when)+" को"):"")+" चालू किया</div>";
  if(on) h+="<div style='font-size:11px;color:var(--gold2);font-weight:700;margin-top:5px;'>⏱ आज रात अपने आप हट जाएगा — भूल जाने पर भी टीम कल पुराने डेटा पर नहीं रहेगी</div>";
  h+="</div>";
  h+="<div style='font-size:12px;line-height:1.75;color:var(--muted);margin-bottom:12px;'>"+
     "<b style='color:var(--text);'>चालू करने पर क्या रुकता है:</b> live sync, सभी लिस्ट का background refresh, prefetch, स्कोरकार्ड का ताज़ा डेटा।<br>"+
     "<b style='color:var(--green);'>क्या चलता रहता है:</b> पूरी ऐप device के अपने डेटा से, और सबसे ज़रूरी — <b>वसूली दर्ज करना</b> (वह upload है, quota में नहीं गिनता)।<br>"+
     "<b style='color:var(--gold2);'>ध्यान रखें:</b> चालू रहने तक आपको दूसरों की वसूली दिखना बंद हो जाएगी। बाक़ी devices तक यह ~5 मिनट में पहुँचता है।"+
     "</div>";
  h+="<button class='btn-save' style='width:100%;background:"+(on?"var(--green)":"var(--red)")+";' onclick='_pauseToggle()'>"+
     (on?"✅ वापस सामान्य करें":"🛑 अभी डाउनलोड रोकें")+"</button>";
  // audit-verified: सिर्फ़ hardcoded markup + escHtml() से गुज़रे who/when
  // eslint-disable-next-line no-unsanitized/property
  el.innerHTML=h;
}
function _pauseToggle(){
  if(!CU||CU.role!=="supervisor"){toast("सिर्फ JE यह कर सकते हैं","err");return;}
  var next=!isDataPaused();
  if(next&&!confirm("डाउनलोड रोक दें?\n\nसभी devices पर दूसरों का ताज़ा डेटा आना बंद हो जाएगा। वसूली दर्ज करना चलता रहेगा।")) return;
  var body={on:next,by:CU.name,at:{".sv":"timestamp"}};
  fetch(FB+"/PAUSE.json",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
    .then(function(r){
      if(!r.ok) throw new Error("HTTP "+r.status);
      return r.json();
    })
    .then(function(d){
      _applyPause(d&&typeof d==="object"?d:{on:next,by:CU.name});
      _pauseRender();
      toast(next?"🛑 डाउनलोड रोक दिया — बाक़ी devices तक ~5 मिनट में":"✅ वापस सामान्य — live sync फिर चालू","ok");
    })
    .catch(function(e){logErr("pause-save-fail",e);toast("⚠️ बदल नहीं पाया — दोबारा कोशिश करें","err");});
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
  var expectedPin=HQ_PINS[hqKey(hq)];
  var typedPin=document.getElementById("lin-pin").value.trim();
  if(expectedPin&&typedPin!==expectedPin){
    toast("गलत PIN! JE से सही PIN लें","err");return;
  }
  // PIN सही है और उस HQ का असली Firebase account मौजूद है — anonymous की जगह उसी से sign-in करें
  // (Security Rules अब सिर्फ़ यही असली पहचान जांचती हैं — असली access-control server से)
  var hqEmail=HQ_AUTH_EMAIL[hq];
  var fbAuthOk=false;
  try{fbAuthOk=typeof firebase!=="undefined"&&!!firebase.auth;}catch(e){}
  if(expectedPin&&hqEmail&&navigator.onLine&&fbAuthOk){
    showLoader("लॉगिन हो रहा है...");
    firebase.auth().signInWithEmailAndPassword(hqEmail,_hqAuthPassword(typedPin))
      .then(function(){
        hideLoader();
        CU={role:"lineman",name:name,hq:hq};
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
  // PIN सेट नहीं है इस HQ का, या ऑफलाइन हैं — पुराने (anonymous) तरीके से आगे बढ़ें
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
function _ensureCorrectHqAuth(){
  if(!CU||CU.role!=="lineman"||!navigator.onLine) return;
  var hqEmail=HQ_AUTH_EMAIL[CU.hq];
  var pin=HQ_PINS[hqKey(CU.hq)];
  if(!hqEmail||!pin) return; // इस HQ का PIN सेट ही नहीं — पुराना anonymous रास्ता ही सही व्यवहार है
  var fbAuthOk=false;
  try{fbAuthOk=typeof firebase!=="undefined"&&!!firebase.auth;}catch(e){}
  if(!fbAuthOk) return;
  var u=firebase.auth().currentUser;
  if(u&&u.email===hqEmail){
    // पहले से सही account से sign-in है — दोबारा sign-in की ज़रूरत नहीं। पर अगर पहले कभी
    // 401 की वजह से इस HQ की entries "अटकी" चिह्नित हो चुकी हैं, तो वो गिनती अब मान्य नहीं:
    // account सही है यानी rules इस HQ को लिखने देती हैं। पहले यह रीसेट सिर्फ़ नए sign-in पर
    // होता था, इसलिए मैन्युअल logout+login के बाद भी अटका डेटा हमेशा के लिए अटका रह जाता था
    if(!_authHealed[CU.hq]){
      _authHealed[CU.hq]=true;
      _resetAuthFailForHQ(CU.hq);
      flushPending();
    }
    return;
  }
  firebase.auth().signInWithEmailAndPassword(hqEmail,_hqAuthPassword(pin))
    .then(function(){
      _authHealed[CU.hq]=true;
      _resetAuthFailForHQ(CU.hq); // पुरानी "अनधिकृत" गिनती अब मान्य नहीं — दोबारा भेजने दो
      flushPending();
    })
    .catch(function(){}); // अभी भी नाकाम (PIN बदल गया होगा) — अगली बार "online" event पर फिर कोशिश होगी
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
  // Firebase का auth तय होने का इंतज़ार करते हैं ताकि सही account पहले से हो तो कोई नई call न जाए
  if(silent) _afterAuthReady(_ensureCorrectHqAuth);
  activeHQ=CU.hq; activeFilter="all";
  rebuildCatsForHQ(activeHQ);
  activeCat=CATS[0];
  document.getElementById("login-screen").classList.remove("active");
  document.getElementById("app-screen").classList.add("active");
  buildUI();
  showLoader("डेटा लोड हो रहा है...");
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

// नाम से तय रंग — बिना किसी फ़ोटो/स्टोरेज के हर व्यक्ति का अपना अलग एवतार रंग
var AVATAR_PALETTE=[
  ["#1f6fb2","#134a75"],["#0d6efd","#0a4fb5"],["#086b52","#054d3a"],
  ["#a34d00","#7a3900"],["#7b3fd1","#5a2ba0"],["#c41f3d","#8f1630"],
  ["#00695c","#004d43"],["#455a64","#2c3d45"]
];
function _avatarColor(name){
  var h=0;
  for(var i=0;i<(name||"").length;i++) h=(h*31+name.charCodeAt(i))>>>0;
  var pair=AVATAR_PALETTE[h%AVATAR_PALETTE.length];
  return "linear-gradient(135deg,"+pair[0]+","+pair[1]+")";
}
function buildUI(){
  var dot=document.getElementById("udot");
  dot.textContent=CU.name[0].toUpperCase();
  dot.className="udot";
  dot.style.background=_avatarColor(CU.name);
  document.getElementById("uname-disp").textContent=CU.name;
  document.getElementById("hdr-sub").textContent=CU.role==="supervisor"?"JE | सभी HQ":"Lineman | "+CU.hq;
  var info=document.getElementById("user-info-menu");
  if(info) info.textContent=(CU.role==="supervisor"?"👨‍💼 JE":"🔧 Lineman")+" | "+CU.hq+" | "+CU.name+" | v"+APP_VER;
  ["log-menu-item","hsc-menu-item","cash-menu-item","backup-menu-item","wasc-menu-item","todaysc-menu-item","pause-menu-item","dv-menu-item","mig-menu-item","pin-menu-item","usage-menu-item","clearcats-menu-item"].forEach(function(id){
    var el=document.getElementById(id);
    if(el) el.style.display=CU.role==="supervisor"?"flex":"none";
  });
  // स्कोरकार्ड (दिनांक-वार विश्लेषण) सिर्फ़ JE का काम है, lineman को फ़ील्ड-वेरिफ़िकेशन से मतलब —
  // हर खुलने पर कई categories का data मंगाता है, lineman devices पर बेवजह Firebase bandwidth खर्च होता था
  var scHdr=document.getElementById("sc-hdr-btn"); if(scHdr) scHdr.style.display=CU.role==="supervisor"?"":"none";
  var scBnav=document.getElementById("sc-bnav-btn"); if(scBnav) scBnav.style.display=CU.role==="supervisor"?"flex":"none";
  if(typeof refreshLogBadge==="function") refreshLogBadge();
  buildHQTabs(); buildCatTabs(); buildActionBtns();
  _profilePhotoCache=null; loadProfilePhoto();
}

function buildHQTabs(){
  var c=document.getElementById("hq-tabs"); c.innerHTML="";
  var hqs=CU.role==="supervisor"?HQS:[CU.hq];
  hqs.forEach(function(hq){
    var b=document.createElement("button");
    b.className="hq-tab"+(hq===activeHQ?" active":"");
    b.textContent=hq;
    b.onclick=function(){
      activeHQ=hq; activeFilter="all";
      // filter बटन की दिखावट भी "सभी" पर वापस लाएं — वरना HQ बदलने से पहले "बाकी"/"वसूल" चुना हो तो
      // वह बटन दिखने में selected ही रह जाता जबकि लिस्ट असल में "सभी" (paid समेत) दिखा रही होती —
      // यही "बाकी tab में वसूल entry दिखना" वाला bug था
      document.querySelectorAll(".filter-btn").forEach(function(x){x.className="filter-btn";});
      var allBtn=document.querySelector("[data-f='all']");
      if(allBtn) allBtn.className="filter-btn active-all";
      rebuildCatsForHQ(hq);
      activeCat=CATS[0]; // reset to first cat of new HQ
      buildHQTabs();
      buildCatTabs();
      showLoader();
      fbGet(activeHQ,activeCat,function(data){
        renderSummaryWith(data); renderListWith(data);
        startListen(activeHQ,activeCat); hideLoader();
      });
    };
    c.appendChild(b);
  });
}

function buildCatTabs(){
  rebuildCatsForHQ(activeHQ); // हर बार current HQ के नाम लो
  var c=document.getElementById("cat-tabs"); c.innerHTML="";
  CATS.forEach(function(cat,i){
    var wrap=document.createElement("div");
    wrap.style.cssText="display:flex;align-items:center;gap:3px;flex-shrink:0;";
    var b=document.createElement("button");
    b.className="cat-tab"+(cat===activeCat?" active c"+i:" c"+i);
    b.onclick=function(){
      activeCat=cat; activeFilter="all"; _renderLimit=100;
      document.querySelectorAll(".filter-btn").forEach(function(x){x.className="filter-btn";});
      document.querySelector("[data-f='all']").className="filter-btn active-all";
      buildCatTabs(); showLoader();
      fbGet(activeHQ,activeCat,function(data){
        renderSummaryWith(data); renderListWith(data);
        startListen(activeHQ,activeCat); hideLoader();
      });
    };
    b.textContent=CICO[i]+" "+cat;
    wrap.appendChild(b);
    // Edit button — सिर्फ JE (supervisor) को। सिर्फ़ "कुल उपभोक्ता" (0) fixed है, बाक़ी सब बदली
    // जा सकती हैं (JE का अनुरोध: घरेलू/व्यवसाय/कृषि भी बदलने लायक हों)
    if(isCatEditable(i)&&CU&&CU.role==="supervisor"){
      var slotKey="cat"+i;
      var e2=document.createElement("button");
      e2.textContent="✏️";
      e2.style.cssText="background:none;border:none;cursor:pointer;font-size:13px;padding:2px 4px;flex-shrink:0;";
      e2.title="नाम बदलें";
      (function(idx,sk){
        e2.onclick=function(ev){ev.stopPropagation();openEditCat(idx,sk);};
      })(i,slotKey);
      wrap.appendChild(e2);
    }
    c.appendChild(wrap);
  });
}

function openEditCat(i, slotKey){
  if(!CU||CU.role!=="supervisor"){toast("सिर्फ JE नाम बदल सकते हैं","err");return;}
  if(!isCatEditable(i)){toast("यह श्रेणी बदली नहीं जा सकती","err");return;}
  // नाम बदलना = Firebase पर डेटा का पता बदलना, और वह सिर्फ़ नेट रहते ही सुरक्षित हो सकता है।
  // ऑफ़लाइन नाम बदलने देना सबसे ख़तरनाक है: नाम बदल जाता पर डेटा पुराने पते पर रह जाता, और
  // अगली पढ़ाई में खाली सूची cache पर लिख जाती — इसलिए यहीं रोक देते हैं
  if(!navigator.onLine){toast("📴 नाम बदलने के लिए नेट ज़रूरी है — डेटा भी नए नाम पर ले जाना पड़ता है","err");return;}
  var cur=CATS[i];
  var newName=prompt(activeHQ+" — श्रेणी का नया नाम डालें:",cur);
  if(!newName||!newName.trim()||newName.trim()===cur) return;
  newName=newName.trim();
  // "/" (या .#$[]) नाम में हो तो Firebase पर गलत जगह (नेस्टेड path) सेव होकर हमेशा के लिए
  // permission-denied (401) देने लगता है — असली bug यही मिला था ("vig/O&m Cases" जैसा नाम)
  if(/[.#$\[\]\/]/.test(newName)){
    toast("⚠️ नाम में ये चिह्न न लिखें: . # $ [ ] /","err");
    return;
  }
  if(CATS.indexOf(newName)>-1){
    toast("⚠️ इसी नाम की श्रेणी पहले से है — दोनों का डेटा एक ही जगह मिल जाएगा","err");
    return;
  }
  // नाम हर मुख्यालय का अपना है (/CAT_NAMES/{HQ}/{index}), इसलिए यह पूछना ज़रूरी है — JE अक्सर
  // सभी छह में एक जैसा नाम चाहते हैं, पर कभी किसी एक HQ में अलग नाम भी रखना पड़ सकता है
  var allHQ=confirm("\""+newName+"\" नाम कहाँ लगाना है?\n\n[OK] = सभी "+HQS.length+" मुख्यालयों में\n[Cancel] = सिर्फ़ "+activeHQ+" में");
  var targets=allHQ?HQS.slice():[activeHQ];
  // हर HQ में इस slot का अपना मौजूदा नाम अलग हो सकता है — इसलिए हर एक का oldCat अलग निकालो,
  // और जिनका नाम पहले से यही है उन्हें छोड़ दो (उनका डेटा बेवजह हिलाने की ज़रूरत नहीं)
  var jobs=[],clash=null;
  targets.forEach(function(hq){
    var oc=isCatEditable(i)?getCatName(hq,i):CATS_DEFAULT[i];
    // उसी HQ की *किसी और* श्रेणी का नाम पहले से यही हो तो रुक जाओ — वरना दोनों का डेटा एक ही
    // पते पर जाकर मिल जाता (हर HQ के नाम अलग हो सकते हैं, इसलिए हर एक को अलग जाँचना पड़ता है)
    for(var k=0;k<CATS_DEFAULT.length;k++){
      if(k===i) continue;
      var other=isCatEditable(k)?getCatName(hq,k):CATS_DEFAULT[k];
      if(other===newName){ clash=hq+" › "+other; return; }
    }
    if(oc!==newName) jobs.push({hq:hq,oldCat:oc});
  });
  if(clash){toast("⚠️ "+clash+" में इसी नाम की श्रेणी पहले से है — दोनों का डेटा एक जगह मिल जाता","err");return;}
  if(!jobs.length){toast("सभी चुने हुए मुख्यालयों में यह नाम पहले से है","inf");return;}
  // पहले हर HQ की गिनती दिखाकर पक्का पूछो — JE को पता रहे कि कुल कितना डेटा हिलने वाला है
  showLoader("गिनती देख रहे हैं...");
  var pending=jobs.length;
  jobs.forEach(function(j){
    catRecordCount(j.hq,j.oldCat,function(n){
      j.n=n;
      if(--pending>0) return;
      hideLoader();
      var tot=0,unknown=false;
      jobs.forEach(function(x){ if(x.n==null) unknown=true; else tot+=x.n; });
      var msg="\""+newName+"\" नाम "+(jobs.length===1?jobs[0].hq+" में":jobs.length+" मुख्यालयों में")+" लगाएँ?\n\n";
      jobs.forEach(function(x){ msg+="• "+x.hq+" › "+x.oldCat+" — "+(x.n==null?"गिनती नहीं मिली":(x.n+" records"))+"\n"; });
      msg+="\nकुल "+tot+" records नए नाम पर ले जाए जाएँगे"+(unknown?" (कुछ की गिनती नहीं मिली)":"")+"।";
      msg+="\n\nहर मुख्यालय का डेटा एक बार पढ़ा और एक बार लिखा जाएगा, और सभी फ़ोनों पर नई सूची जाएगी — इसलिए यह काम कम-ट्रैफ़िक समय पर करें (दोपहर 12:30 के बाद)।";
      if(!confirm(msg)) return;
      _runCatRenames(i,newName,jobs);
    });
  });
}
// एक-एक करके (एक साथ नहीं) — छह HQ का डेटा एक साथ खींचना कमज़ोर नेट पर टूट जाता है, और
// टूटने पर यह बताना मुश्किल हो जाता कि कौन-सा पूरा हुआ कौन-सा नहीं। क्रम से चलने पर हर HQ
// या तो पूरा बदलता है या बिलकुल नहीं
function _runCatRenames(i,newName,jobs){
  var idx=0,okCount=0,movedTot=0,failed=[];
  function next(){
    if(idx>=jobs.length){
      hideLoader();
      if(okCount) _finishCatRename(i,newName,jobs,okCount,movedTot);
      if(failed.length){
        logErr("catrename-partial",new Error(failed.join(", ")+" में नाम नहीं बदला"),newName);
        toast("⚠️ "+failed.join(", ")+" में नाम नहीं बदला — वहाँ का डेटा जस का तस है, दोबारा कोशिश करें","err");
      }
      return;
    }
    var j=jobs[idx++];
    showLoader(j.hq+" का डेटा नए नाम पर ले जाया जा रहा है ("+idx+"/"+jobs.length+")...");
    renameCatData(j.hq,j.oldCat,newName,function(res){
      if(res.ok){ okCount++; movedTot+=(res.moved||0); j.done=true; }
      else failed.push(j.hq);
      next();
    });
  }
  next();
}
// डेटा नए पते पर पहुँच जाने के बाद ही नाम की अदला-बदली — तभी कोई भी device नए नाम पर
// जाकर खाली सूची नहीं पाएगा। सिर्फ़ उन्हीं HQ के नाम बदलते हैं जिनका डेटा सचमुच पहुँच गया
// (j.done) — जो HQ बीच में नाकाम रहा उसका पुराना नाम बना रहता है, यानी उसका डेटा दिखता रहता है
function _finishCatRename(i,newName,jobs,okCount,movedTot){
  jobs.forEach(function(j){
    if(!j.done) return;
    // 1. Cache rename
    var d=cGet(j.hq,j.oldCat);
    if(d&&d.length) cSet(j.hq,newName,d);
    cSet(j.hq,j.oldCat,[]);
    // 2. Local CAT_NAMES update
    if(!CAT_NAMES[j.hq]) CAT_NAMES[j.hq]={};
    CAT_NAMES[j.hq][i]=newName;
  });
  saveCatNames();
  // 3. CATS rebuild + UI update immediately
  rebuildCatsForHQ(activeHQ);
  var mine=null;
  jobs.forEach(function(j){ if(j.done&&j.hq===activeHQ) mine=j; });
  if(mine&&activeCat===mine.oldCat){
    activeCat=newName;
    stopListen(); startListen(activeHQ,activeCat); // पुराने पते की live-लाइन बंद, नए की चालू
  }
  buildCatTabs();
  // 4. Firebase save — हर बदले हुए HQ के नाम, एक HQ का एक PUT
  var done=0,bad=0;
  var changed=jobs.filter(function(j){return j.done;});
  changed.forEach(function(j){
    var hqData={};
    CATS_DEFAULT.forEach(function(_,idx){
      if(isCatEditable(idx)&&CAT_NAMES[j.hq]&&CAT_NAMES[j.hq][idx]!=null){
        hqData[idx]=CAT_NAMES[j.hq][idx];
      }
    });
    fetch(FB+"/CAT_NAMES/"+hqKey(j.hq)+".json",{
      method:"PUT",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(hqData)
    }).then(function(r){
      if(!r.ok){
        bad++;
        logErr("catname-save",new Error("HTTP "+r.status),j.hq);
        if(r.status===401||r.status===403) toast("🔐 नाम server पर नहीं गया — JE नेट चालू रखकर logout करके दोबारा login करें","err");
      }
      fin();
    }).catch(function(){
      bad++;
      try{localStorage.setItem("dc_catpending3","1");}catch(e){}
      fin();
    });
  });
  function fin(){
    if(++done<changed.length) return;
    if(bad){ toast("⚠️ नाम बदला पर "+bad+" मुख्यालय का sync बाक़ी — नेट आने पर अपने आप जाएगा","err"); return; }
    toast("✅ नाम बदला: "+newName+" • "+okCount+" मुख्यालय"+(movedTot?(" • "+movedTot+" records साथ गए"):"")+" (सभी को दिखेगा)","ok");
  }
}

function buildActionBtns(){
  var c=document.getElementById("action-btns"); c.innerHTML="";
  // लिस्ट अपलोड (पूरी CSV/Excel मास्टर लिस्ट बदलना) JE का काम है — lineman का काम फ़ील्ड-वेरिफ़िकेशन/
  // स्टेटस-अपडेट है, उसे यह बटन दिखने की ज़रूरत नहीं
  if(CU.role==="supervisor"){
    var b1=document.createElement("button");
    b1.className="tbtn tbtn-blue"; b1.innerHTML="📤 अपलोड"; b1.onclick=openUpModal;
    c.appendChild(b1);
    var b2=document.createElement("button");
    b2.className="tbtn tbtn-red"; b2.innerHTML="🗑️ हटाएं"; b2.onclick=clearList;
    c.appendChild(b2);
    // होम पेज डिस्प्ले बोर्ड और कैश लिस्ट अब profile dropdown में हैं (buildUI देखें)
  }
}

// ── BOTTOM NAV AUTO-HIDE: कंज्यूमर लिस्ट scroll करते समय Profile/Support वाली पट्टी छुप जाए,
// मोबाइल स्क्रीन पर ज़्यादा कार्ड दिखें — सिर्फ़ लिस्ट के बिल्कुल आखिर (scroll के end) में दोबारा दिखे ──
function _bnavAtBottom(){
  var ms=document.querySelector(".main-scroll");
  if(!ms) return true;
  return ms.scrollTop+ms.clientHeight>=ms.scrollHeight-4;
}
function _updateBnavVisibility(){
  var bnav=document.querySelector(".bottom-nav");
  if(!bnav) return;
  bnav.classList.toggle("bnav-hidden",!_bnavAtBottom());
}
function _setupBnavAutoHide(){
  var ms=document.querySelector(".main-scroll");
  if(!ms) return;
  ms.addEventListener("scroll",_updateBnavVisibility,{passive:true});
  _updateBnavVisibility();
}
_setupBnavAutoHide();


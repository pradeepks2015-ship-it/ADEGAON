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
  fetchPhCustomMsgFromFB();
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
// v9.154: database.js के TAB_REVISIT_GRACE_MS जैसा ही 3→10 मिनट किया (असली Firebase Console
// usage देखकर JE का फ़ैसला — देखें वहां का कमेंट)। पूरे ऐप में एक ही नियम बना रहे, इसलिए दोनों
// साथ बदले
var LISTEN_HIDE_GRACE_MS=10*60*1000;
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
  ["log-menu-item","hsc-menu-item","cash-menu-item","backup-menu-item","wasc-menu-item","todaysc-menu-item","voicesc-menu-item","pause-menu-item","dv-menu-item","mig-menu-item","pin-menu-item","usage-menu-item","clearcats-menu-item"].forEach(function(id){
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
      _afterAuthReady(function(){ _ensureCorrectHqAuth(function(){ reconcileHQ(hq); }); }); // पुराने मिसमैच के लिए, सही account तय होने के बाद (देखें _finishLogin वाला comment)
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
      _afterAuthReady(function(){ _ensureCorrectHqAuth(function(){ reconcileHQ(activeHQ); }); }); // पुराने मिसमैच के लिए, सही account तय होने के बाद (देखें _finishLogin वाला comment)
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


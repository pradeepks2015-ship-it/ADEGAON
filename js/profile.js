// ─── प्रोफ़ाइल: फ़ोटो अपलोड (compressed, base64), नाम-आधारित पहचान — कोई अलग user-account सिस्टम नहीं ───
function _nameKey(name){ return (name||"").trim().replace(/[\s.#$\[\]\/]/g,"_"); }
function _profileKey(){
  if(!CU) return "";
  return CU.role==="supervisor" ? "JE_"+_nameKey(CU.name) : hqKey(CU.hq)+"_"+_nameKey(CU.name);
}

function _bnavHome(){
  document.querySelector(".main-scroll").scrollTop=0;
  var all=document.querySelector('.filter-btn[data-f="all"]');
  if(all) setFilter(all);
}

function _renderAvatarInto(el, big){
  el.innerHTML="";
  var photo=_profilePhotoCache;
  if(photo){
    var img=document.createElement("img");
    img.src=photo; img.style.width="100%"; img.style.height="100%"; img.style.objectFit="cover";
    el.appendChild(img);
    el.style.background="none";
  }else{
    el.textContent=CU.name[0].toUpperCase();
    el.style.background=_avatarColor(CU.name);
  }
}

var _profilePhotoCache=null;
function loadProfilePhoto(cb){
  var key=_profileKey();
  if(!key){ if(cb)cb(); return; }
  fetch(FB+"/PROFILE_PHOTOS/"+key+".json")
    .then(_fbJson)
    .then(function(d){
      _profilePhotoCache = d && d.photo ? d.photo : null;
      var dot=document.getElementById("udot");
      if(dot) _renderAvatarInto(dot);
      if(cb) cb();
    }).catch(function(){ if(cb)cb(); });
}

function openProfileModal(){
  var mn=document.getElementById("logout-menu"); if(mn) mn.classList.remove("open");
  document.getElementById("profile-overlay").classList.add("open");
  var av=document.getElementById("profile-avatar-wrap");
  _renderAvatarInto(av);
  document.getElementById("profile-name").textContent=CU.name;
  document.getElementById("profile-meta").textContent=(CU.role==="supervisor"?"कनिष्ठ अभियंता (JE)":"लाइनमैन")+" | "+CU.hq;
  _syncThemeSwitch();
  _syncSoundSwitch();
}
function closeProfileModal(){ document.getElementById("profile-overlay").classList.remove("open"); }

// ─── वसूली पर आवाज़: चालू/बंद ───────────────────────────────────────────────
// डिफ़ॉल्ट चालू। बंद करने का रास्ता ज़रूरी है — लाइनमैन दिन में दर्जनों वसूली दर्ज करता है, और
// कभी वह बैठक में या किसी के घर पर हो सकता है जहां हर बार आवाज़ ठीक न लगे
function celebSoundOn(){
  try{ return localStorage.getItem("dc_celebsound")!=="0"; }catch(e){ return true; }
}
function _syncSoundSwitch(){
  var btn=document.getElementById("sound-switch-btn");
  if(btn) btn.className="theme-switch"+(celebSoundOn()?" on":"");
}
function toggleCelebSound(){
  var next=!celebSoundOn();
  try{ localStorage.setItem("dc_celebsound", next?"1":"0"); }catch(e){}
  _syncSoundSwitch();
  if(next){
    try{_sndWarm();}catch(e){}      // अभी-अभी चालू हुई — असली आवाज़ें अब उतारी जा सकती हैं
    _celebSound(false);             // चालू करते ही एक बार सुनाकर दिखाओ कि कैसी लगती है
  }
}

// ─── डार्क मोड: सिर्फ़ CSS वेरिएबल स्विच (html[data-theme=dark]) — कमज़ोर रोशनी/रात में आँखों को आराम,
// device की system setting से नहीं जोड़ा (उपयोगकर्ता खुद चुने) — localStorage में याद रहता है
function _syncThemeSwitch(){
  var isDark=document.documentElement.getAttribute("data-theme")==="dark";
  var btn=document.getElementById("theme-switch-btn");
  if(btn) btn.className="theme-switch"+(isDark?" on":"");
}
function toggleTheme(){
  var isDark=document.documentElement.getAttribute("data-theme")==="dark";
  var next=!isDark;
  document.documentElement.setAttribute("data-theme", next?"dark":"light");
  try{ localStorage.setItem("dc_theme", next?"dark":"light"); }catch(e){}
  var mc=document.getElementById("meta-theme-color");
  if(mc) mc.setAttribute("content", next?"#0d1520":"#eef2f7");
  _syncThemeSwitch();
}

function onPhotoSelected(input){
  var file=input.files && input.files[0];
  if(!file) return;
  if(!/^image\//.test(file.type)){ toast("सिर्फ़ फ़ोटो फ़ाइल चुनें","err"); return; }
  var reader=new FileReader();
  reader.onload=function(e){
    var img=new Image();
    img.onload=function(){
      var SIZE=160;
      var canvas=document.createElement("canvas");
      canvas.width=SIZE; canvas.height=SIZE;
      var ctx=canvas.getContext("2d");
      var scale=Math.max(SIZE/img.width, SIZE/img.height);
      var w=img.width*scale, h=img.height*scale;
      ctx.drawImage(img, (SIZE-w)/2, (SIZE-h)/2, w, h);
      var dataUrl=canvas.toDataURL("image/jpeg", 0.7);
      _profilePhotoCache=dataUrl;
      var av=document.getElementById("profile-avatar-wrap");
      if(av) _renderAvatarInto(av);
      var dot=document.getElementById("udot");
      if(dot) _renderAvatarInto(dot);
      var key=_profileKey();
      fetch(FB+"/PROFILE_PHOTOS/"+key+".json",{
        method:"PUT",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({photo:dataUrl, name:CU.name, role:CU.role, hq:CU.hq, ts:Date.now()})
      }).then(function(r){
        if(r.ok) toast("✅ फ़ोटो सेव हो गई","ok");
        else toast("⚠ फ़ोटो सेव नहीं हुई, दोबारा कोशिश करें","err");
      }).catch(function(){ toast("📴 ऑफलाइन — नेट आने पर दोबारा कोशिश करें","err"); });
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
}

function openSupportModal(){
  var mn=document.getElementById("logout-menu"); if(mn) mn.classList.remove("open");
  document.getElementById("support-overlay").classList.add("open");
  document.getElementById("support-je-email").textContent="📧 "+JE_EMAIL;
}
function closeSupportModal(){ document.getElementById("support-overlay").classList.remove("open"); }

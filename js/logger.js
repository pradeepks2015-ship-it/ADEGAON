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
var _lastPingAt=0;
// ऐप पर लौटने (minimize से वापस) पर भी हाज़िरी — पर घंटे में एक बार से ज़्यादा नहीं।
// असली production (3/10): पिंडरई के विकास साहू ने दोपहर 1:09 पर वसूली की, फिर भी "कर्मचारी
// सक्रियता" में पिंडरई "आज किसी ने ऐप नहीं खोला" में था। ping सिर्फ़ _finishLogin (नए सिरे से
// खुलना) और हर 4 घंटे के setInterval से होता था — लाइनमैन ऐप बंद नहीं करते, minimize करते हैं,
// वापस आने पर _finishLogin दोबारा नहीं चलता, और पीछे पड़े tab का टाइमर Android रोक देता है।
// खर्च: ~100 बाइट का PUT (upload — download quota में नहीं)
var PING_RESUME_GAP_MS=60*60*1000;
document.addEventListener("visibilitychange",function(){
  if(document.visibilityState!=="visible") return;
  if(Date.now()-_lastPingAt<PING_RESUME_GAP_MS) return;
  pingDeviceVersion();
});
function pingDeviceVersion(){
  if(!navigator.onLine||!CU)return;
  flushLogs(); // बिना नेट के वक़्त की errors भी अब भेज दें (v9.209)
  _lastPingAt=Date.now();
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
// 1 = आज | 7 | 30 | 0 (=सभी)। डिफ़ॉल्ट "आज" — JE रोज़ यही देखते हैं ("सिर्फ़ आज का डेटा दिखाए"),
// और ऊपर की "आज" पट्टी से नीचे की तालिका का मेल भी तभी बैठता है। 7/30/सभी एक क्लिक दूर हैं।
// ध्यान: "आज" का मतलब कैलेंडर-दिन है (रात 12 बजे से), न कि पिछले 24 घंटे — देखें _dvCutoff()
var _DV_WINDOW=1;
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
// डिवाइस पर पहले से मौजूद है (cGet), एक भी नई network call नहीं।
// हर व्यक्ति के साथ यह भी कि किन मुख्यालयों में काम दिखा (hqs) और दिखाने लायक़ नाम (name) —
// ताकि जिसकी "हाज़िरी" (DEVICE_VERSIONS ping) न लगी हो, वह भी तालिका में आ सके
//
// "वसूली" अब भुगतान तारीख़ (paydate) से गिनी जाती है, रिकॉर्ड के ts से नहीं। असली production
// (3/10): ऊपर की पट्टी में "303 वसूली" थी जबकि तालिका का जोड़ 57 — JE ने सही पकड़ा कि इसमें
// पुरानी वसूली भी है। ts हर बदलाव पर आज का हो जाता है: पुराने वसूल उपभोक्ता पर आज रिमार्क
// (saveRmk — updatedBy भी रिमार्क वाले का हो जाता है), reconcileHQ से दूसरे बटन में चढ़ाना,
// कैश लिस्ट (पुरानी paydate पर भी ts आज)। paydate इन सब में नहीं बदलती, वही असली दिन है।
// सीमा: "किसने वसूल मार्क किया" अलग से दर्ज नहीं होता — नाम updatedBy (आख़िरी बदलने वाला) से
function _dvActivity(sinceTs){
  var out={},seenPaid={},seenWork={};
  var sd=new Date(sinceTs); sd.setHours(0,0,0,0);
  var sinceDay=sd.getTime(); // रिमार्क में सिर्फ़ तारीख़ है, इसलिए दिन की शुरुआत से तुलना
  var sinceVal=sinceTs?(sd.getFullYear()*10000+(sd.getMonth()+1)*100+sd.getDate()):0; // paydate (yyyymmdd) से तुलना के लिए
  var bump=function(name,hq){
    var k=_dvNameKey(name);
    if(!out[k]) out[k]={work:0,paid:0,rmk:0,hqs:{},name:String(name)};
    if(hq) out[k].hqs[hq]=1;
    return out[k];
  };
  HQS.forEach(function(hq){
    for(var i=0;i<CATS_DEFAULT.length;i++){
      var cat=isCatEditable(i)?getCatName(hq,i):CATS_DEFAULT[i];
      (cGet(hq,cat)||[]).forEach(function(x){
        if(!x) return;
        // रिमार्क हर श्रेणी में अलग होते हैं — propagateStatus सिर्फ़ status/paydate copy करता है,
        // remarksArr नहीं — इसलिए इन्हें dedup किए बिना, हर श्रेणी से गिनना ही सही है
        (x.remarksArr||[]).forEach(function(r){
          if(!r||!r.by) return;
          var t=_dvRmkTs(r.at);
          if(t&&t>=sinceDay) bump(r.by,hq).rmk++;
        });
        // status/paydate/updatedBy हर श्रेणी में copy हो जाते हैं (propagateStatus) — इसलिए एक ही
        // उपभोक्ता को एक ही बार गिनें, वरना वसूली कई गुना बढ़ी दिखेगी। "देखा" सिर्फ़ तब दर्ज हो जब
        // गिनती सचमुच हुई — पहले हर रिकॉर्ड पर दर्ज हो जाता था, तो किसी बटन में बाकी और दूसरे में
        // वसूल वाला उपभोक्ता (बीच का mismatch) गिनती से छूट सकता था
        var dk=x.acc?(hq+"|"+String(x.acc).trim()):null;
        if(x.updatedBy&&x.status==="paid"&&(!dk||!seenPaid[dk])){
          var pv=latestPayVal(x);
          if(pv&&pv>=sinceVal){ if(dk) seenPaid[dk]=1; bump(x.updatedBy,hq).paid++; }
        }
        // बाक़ी बदलाव (जैसे "वापस बाकी") — सिर्फ़ तब दिखते हैं जब न वसूली न रिमार्क हो
        if(x.updatedBy&&x.ts&&x.ts>=sinceTs&&x.status!=="paid"&&(!dk||!seenWork[dk])){
          if(dk) seenWork[dk]=1;
          bump(x.updatedBy,hq).work++;
        }
      });
    }
  });
  return out;
}

function _dvSetWindow(d){ _DV_WINDOW=d; _dvPaint(); } // सिर्फ़ दोबारा रंगना — कोई नई fetch नहीं

// चुनी हुई अवधि की शुरुआत का समय। "आज" (=1) कैलेंडर-दिन है — आज रात 12 बजे से, न कि पिछले
// 24 घंटे; वरना कल शाम का काम भी "आज" में गिना जाता और गिनती ऊपर की "आज" पट्टी से मेल न खाती
function _dvCutoff(){
  if(!_DV_WINDOW) return 0; // सभी
  if(_DV_WINDOW===1){ var d=new Date(); d.setHours(0,0,0,0); return d.getTime(); }
  return Date.now()-_DV_WINDOW*86400000;
}
// ── "आज" की एक-पंक्ति झलक ──────────────────────────────────────────────────────
// JE का असली सवाल है "आज कितने लोग काम पर थे"। उसे "आज कितने लॉगिन हुए" से नापना अब ग़लत नाप है:
// v9.108 से session 30 दिन टिकता है, यानी लाइनमैन एक बार login करके महीने भर काम करता रहता है —
// login गिनती अक्सर 0 आती जबकि 6 लोग दिन भर काम कर रहे होते। इसलिए यहां "सक्रिय" गिना जाता है:
// DEVICE_VERSIONS का t हर बार ऐप खुलने पर (और फिर हर 4 घंटे) अपडेट होता है, तो "आज t वाला" =
// "जिसने आज ऐप खोला"। यह पूरी तरह उसी data से बनता है जो _dvPaint के पास पहले से है
// (_DV_RAW + local cache) — एक भी नई network call नहीं।
//
// "कल" की गिनती जान-बूझकर नहीं दिखाई जाती: DEVICE_VERSIONS में हर device का सिर्फ़ आख़िरी ping
// रहता है (PUT overwrite करता है, इतिहास नहीं रखता), तो जो कल भी सक्रिय था और आज भी, उसका t आज
// का है — "कल" हमेशा कम दिखेगा। ग़लत नंबर दिखाने से न दिखाना बेहतर है।
function _dvTodayLabel(){
  try{ return new Date().toLocaleDateString("hi-IN",{day:"numeric",month:"long"}); }
  catch(e){ return ""; }
}
// कैश लिस्ट से चढ़ी वसूली का updatedBy "<JE> (कैश लिस्ट)" होता है (home-scorecard.js) — वह असली
// भुगतान है, पर किसी लाइनमैन का मैदानी काम नहीं
function _dvIsCashName(n){ return /\(कैश लिस्ट\)\s*$/.test(String(n==null?"":n)); }
// JE के नाम — DEVICE_VERSIONS में role "supervisor" वाले
function _dvSupKeys(raw){
  var s={};
  Object.keys(raw||{}).forEach(function(k){
    var r=raw[k];
    if(r&&typeof r==="object"&&r.role==="supervisor") s[_dvNameKey(r.name)]=1;
  });
  return s;
}
// जिन्होंने चुनी अवधि में वसूली/रिमार्क किया पर जिनकी "हाज़िरी" (ping) उस अवधि में नहीं लगी।
// पहले ये तालिका से पूरी तरह ग़ायब रहते थे — काम ऊपर की गिनती में था, पर व्यक्ति कहीं नहीं
// (देखें pingDeviceVersion के ऊपर वाली टिप्पणी: विकास साहू, पिंडरई, 3/10)
function _dvExtras(act,pingedKeys,supKeys){
  var list=[];
  Object.keys(act||{}).forEach(function(k){
    var a=act[k];
    if(!a||!(a.paid||a.rmk)) return; // सिर्फ़ तारीख़-पक्का काम — "बदलाव" (ts) पुराना भी हो सकता है
    if(pingedKeys[k]) return;
    list.push({key:k,name:a.name,hqs:Object.keys(a.hqs||{}),cash:_dvIsCashName(a.name),sup:!!supKeys[k]});
  });
  return list;
}
function _dvTodayStrip(raw){
  var d0=new Date(); d0.setHours(0,0,0,0);
  var todayStart=d0.getTime();
  var people={},hqSet={},pinged={};
  Object.keys(raw||{}).forEach(function(k){
    var r=raw[k];
    if(!r||typeof r!=="object") return;
    if((Number(r.t)||0)<todayStart) return;
    people[_dvNameKey(r.name)+"|"+String(r.hq==null?"":r.hq)]=1; // एक ही व्यक्ति के कई device = एक
    pinged[_dvNameKey(r.name)]=1;
    if(r.hq) hqSet[r.hq]=1;
  });
  var act=_dvActivity(todayStart);
  // हाज़िरी न लगी हो पर आज वसूली/रिमार्क दिखा — वह भी सक्रिय है, और उसका मुख्यालय "चुप" नहीं।
  // JE और कैश लिस्ट इसमें नहीं गिने जाते (वह मैदानी काम नहीं, मुख्यालय को "सक्रिय" नहीं बनाता)
  _dvExtras(act,pinged,_dvSupKeys(raw)).forEach(function(x){
    if(x.cash||x.sup) return;
    people["@"+x.key]=1;
    x.hqs.forEach(function(h){ hqSet[h]=1; });
  });
  var nPeople=Object.keys(people).length;
  var paid=0,rmk=0;
  Object.keys(act).forEach(function(k){ paid+=act[k].paid||0; rmk+=act[k].rmk||0; });
  var quiet=HQS.filter(function(hq){ return !hqSet[hq]; });
  var dl=_dvTodayLabel();
  var h="<div style='background:linear-gradient(135deg,rgba(0,150,255,.10),rgba(120,80,255,.10));border:1px solid rgba(90,140,255,.32);border-radius:12px;padding:10px 12px;margin-bottom:10px;'>";
  h+="<div style='font-size:11px;color:var(--muted);font-weight:700;margin-bottom:5px;'>📅 आज"+(dl?" — "+escHtml(dl):"")+"</div>";
  if(!nPeople){
    h+="<div style='font-size:13px;font-weight:800;'>आज अभी तक किसी ने ऐप नहीं खोला</div>";
  } else {
    h+="<div style='font-size:15px;font-weight:800;line-height:1.5;'>"+
       "<span style='color:var(--gold2);'>"+nPeople+"</span> कर्मचारी सक्रिय"+
       " &nbsp;•&nbsp; <span style='color:var(--gold2);'>"+Object.keys(hqSet).length+"/"+HQS.length+"</span> मुख्यालय"+
       (paid?(" &nbsp;•&nbsp; <span style='color:var(--green);'>"+paid+"</span> वसूली"):"")+
       (rmk?(" &nbsp;•&nbsp; <span style='color:#64b5f6;font-size:13px;'>"+rmk+" रिमार्क</span>"):"")+
       "</div>";
  }
  if(quiet.length){
    h+="<div style='font-size:11px;color:var(--red);font-weight:700;margin-top:6px;'>आज किसी ने ऐप नहीं खोला: "+escHtml(quiet.join(", "))+"</div>";
  }
  h+="</div>";
  return h;
}

// रोज़ देखने वाली स्क्रीन — पहले यह "चरण 3" (कभी-कभार वाली माइग्रेशन जांच) के अंदर दबी थी
function openDvModal(){
  if(!CU||CU.role!=="supervisor"){toast("सिर्फ JE यह देख सकते हैं","err");return;}
  var mn=document.getElementById("logout-menu"); if(mn) mn.classList.remove("open");
  _DV_WINDOW=1; // हर बार खुलते ही "आज" — JE का रोज़ का सवाल यही है
  document.getElementById("dv-overlay").classList.add("open");
  _dvRender();
}
function closeDvModal(){document.getElementById("dv-overlay").classList.remove("open");}

function _dvRender(){
  var el=document.getElementById("mig-devices");
  if(!el)return;
  el.innerHTML="<div class='log-empty'>⏳ लोड हो रहा है...</div>";
  fetch(FB+"/DEVICE_VERSIONS.json?t="+Date.now())
    .then(_fbJson)
    .then(function(d){
      trackUsageOf(d);
      _DV_RAW=(d&&typeof d==="object")?d:{};
      _dvPaint();
      _dvAutoClean();
    })
    .catch(function(){ el.innerHTML="<div class='log-empty'>लोड नहीं हो पाया — दोबारा कोशिश करें</div>"; });
}

// v9.225: "🔄 ताज़ा करें" — पहले सिर्फ़ हाज़िरी (DEVICE_VERSIONS) ताज़ा होती थी, जबकि "आज का काम" फ़ोन में रखी
// सूचियों से गिना जाता है। JE (14/10): v9.222 की एक-बार सफ़ाई के बाद सूचियां फ़ोन से हट गईं, तो सबका काम "—" दिखा।
// अब पहले सभी HQ की सूचियां सर्वर से ताज़ा (ETag से — न बदली हो तो लगभग मुफ़्त; 5 मिनट की रोक _cashRefreshAll में),
// फिर हाज़िरी। नेट न हो तो सीधे हाज़िरी वाला पुराना रास्ता
function _dvRefreshAll(){
  var el=document.getElementById("mig-devices");
  if(el) el.innerHTML="<div class='log-empty'>⏳ सभी मुख्यालयों की सूचियां ताज़ा हो रही हैं...</div>";
  if(!navigator.onLine||typeof _cashRefreshAll!=="function"){ _dvRender(); return; }
  _cashRefreshAll(HQS,function(){ _dvRender(); });
}

function _dvPaint(){
  var el=document.getElementById("mig-devices");
  if(!el)return;
  var raw=_DV_RAW||{};
  var keys=Object.keys(raw);
  if(!keys.length){ el.innerHTML="<div class='log-empty'>अभी तक कोई device record नहीं — यह नए version से अपने आप बनता है</div>"; return; }
  // "आज" वाली पट्टी चुनी हुई अवधि (7/30/सभी) से स्वतंत्र है — वो हमेशा आज का ही हाल दिखाती है
  var todayStrip=_dvTodayStrip(raw);
  var cutoff=_dvCutoff();
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
  // जिसने इस अवधि में काम किया पर हाज़िरी नहीं लगी — वह भी दिखे (उसका version पता नहीं, इसलिए
  // "पुराना version" वाली चेतावनी में नहीं गिना जाता)
  var pingedKeys={};
  Object.keys(people).forEach(function(k){ pingedKeys[_dvNameKey(people[k].name)]=1; });
  _dvExtras(act,pingedKeys,_dvSupKeys(raw)).forEach(function(x){
    people["@"+x.key]={name:x.name||"?",hq:x.hqs.join(", ")||"?",role:"",t:0,v:null,devs:0,key:"@"+x.key,extra:true,cash:x.cash};
  });
  var rows=Object.keys(people).map(function(k){return people[k];});
  if(!rows.length){
    // audit-verified: _DV_WINDOW सिर्फ़ संख्या है (hardcoded शब्दों के साथ) और _dvControls()
    // सिर्फ़ संख्याओं + hardcoded markup से बनता है — कोई user-typed field नहीं
    // eslint-disable-next-line no-unsanitized/property
    el.innerHTML=todayStrip+"<div class='log-empty'>"+(_DV_WINDOW===1?"आज":("पिछले "+_DV_WINDOW+" दिन में"))+" कोई सक्रिय नहीं — ऊपर से अवधि बदलकर देखें</div>"+_dvControls(hidden);
    return;
  }
  var isOld=function(r){ return !r.extra&&r.v!==APP_VER; };
  rows.sort(function(a,b){
    var aOld=isOld(a), bOld=isOld(b);
    if(aOld!==bOld) return aOld?-1:1; // पुराने version पहले दिखें — उन्हीं को अपडेट करवाना है
    return (b.t||0)-(a.t||0);
  });
  var anyOld=rows.some(isOld);
  var html=todayStrip+_dvControls(hidden);
  html+=anyOld
    ?"<div style='background:rgba(240,80,80,.08);border:1px solid rgba(240,80,80,.3);border-radius:10px;padding:9px 11px;margin-bottom:8px;font-size:12px;color:var(--red);font-weight:700;'>⚠️ कुछ सक्रिय devices अभी भी पुराने version पर हैं — इन्हें अपडेट करवाएं</div>"
    :"<div style='background:rgba(0,200,150,.08);border:1px solid rgba(0,200,150,.3);border-radius:10px;padding:9px 11px;margin-bottom:8px;font-size:12px;color:var(--green);font-weight:700;'>✅ सभी सक्रिय devices v"+escHtml(APP_VER)+" पर हैं</div>";
  // जिन HQ का data इस डिवाइस पर नहीं है उनका "काम" शून्य दिखेगा — यह साफ़ बता देना ज़रूरी है,
  // वरना JE ग़लती से समझ लेगा कि वहां किसी ने काम ही नहीं किया
  var noData=HQS.filter(function(hq){ return !((cGet(hq,CATS_DEFAULT[0])||[]).length); });
  if(noData.length){
    html+="<div style='background:rgba(240,165,0,.08);border:1px solid rgba(240,165,0,.3);border-radius:10px;padding:8px 10px;margin-bottom:8px;font-size:11px;color:var(--gold2);'>ℹ️ इन मुख्यालयों का data इस डिवाइस पर नहीं है, इसलिए इनका \"काम\" शून्य दिख सकता है: <b>"+escHtml(noData.join(", "))+"</b> — नीचे \"🔄 ताज़ा करें\" दबाएं</div>";
  }
  html+="<table class='wasc-table'><thead><tr><th class='wasc-th-left'>कर्मचारी</th><th>HQ</th><th>"+(_DV_WINDOW===1?"आज का काम":(_DV_WINDOW?(_DV_WINDOW+" दिन का काम"):"काम"))+"</th><th>आख़िरी बार लॉगिन</th><th>Version</th></tr></thead><tbody>";
  rows.forEach(function(r){
    var old=isOld(r);
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
      (r.extra
        ?("<td><span style='color:var(--gold2);'>हाज़िरी नहीं</span><br><small style='color:var(--muted);'>"+(r.cash?"कैश लिस्ट से":"पर काम दिखा")+"</small></td><td>—</td></tr>")
        :("<td>"+escHtml(_dvAgo(r.t))+"<br><small style='color:var(--muted);'>"+escHtml(r.t?new Date(r.t).toLocaleDateString("hi-IN"):"?")+"</small></td>"+
          "<td>"+(old?"⚠️ v":"✅ v")+escHtml(r.v)+"</td></tr>"));
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
    btn(1,"आज")+btn(7,"7 दिन")+btn(30,"30 दिन")+btn(0,"सभी");
  // "आज" चुना हो तो "पुरानी हटाएं" न दिखाएं — वहां "पुरानी" का मतलब "कल और उससे पहले की सब"
  // होता, यानी एक क्लिक में लगभग पूरी सूची मिट जाती। हटाना 7/30 दिन वाली सोची-समझी सफ़ाई ही रहे
  if(hidden>0&&_DV_WINDOW&&_DV_WINDOW!==1) h+="<button onclick='_dvClearOld()' style='margin-left:auto;border:1px solid rgba(240,80,80,.3);background:rgba(240,80,80,.08);color:var(--red);border-radius:8px;padding:5px 12px;font-family:inherit;font-size:11px;font-weight:700;cursor:pointer;'>🗑️ पुरानी "+hidden+" हटाएं</button>";
  h+="</div>";
  return h;
}

// चुनी हुई अवधि से पुरानी entries हमेशा के लिए हटाएं। सुरक्षित है — जो device अब भी इस्तेमाल
// में है वो अगले login/ping पर अपनी entry दोबारा बना लेता है (देखें pingDeviceVersion)
function _dvClearOld(){
  if(!CU||CU.role!=="supervisor"){toast("सिर्फ JE यह कर सकते हैं","err");return;}
  if(!_DV_WINDOW||_DV_WINDOW===1){toast("पहले 7 या 30 दिन चुनें","inf");return;}
  var cutoff=Date.now()-_DV_WINDOW*86400000;
  var raw=_DV_RAW||{};
  var olds=Object.keys(raw).filter(function(k){
    var r=raw[k]; return r&&typeof r==="object"&&(Number(r.t)||0)<cutoff;
  });
  if(!olds.length){toast("कोई पुरानी entry नहीं — सूची पहले से साफ़ है","ok");return;}
  appAsk({icon:"🧹",title:olds.length+" पुरानी entries हटाएं?",msg:"जो "+_DV_WINDOW+" दिन से नहीं दिखीं। जो device अब भी इस्तेमाल में है, वो अगली बार login होते ही अपने आप वापस आ जाएगा — कोई डेटा नहीं खोता।",buttons:[{label:"हां, हटाओ",kind:"ok",value:true},{label:"नहीं",kind:"cancel",value:false}]},function(v){ if(v) _dvPruneNow(olds,raw); });
}
function _dvPruneNow(olds,raw){
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
    return fetch(FB+"/LOGS/"+day+".json?t="+Date.now()).then(_fbJson).then(function(d){trackUsageOf(d);return d;}).catch(function(){return null;});
  })).then(function(res){
    var count=0;
    res.forEach(function(d){
      if(!d||typeof d!=="object")return;
      Object.keys(d).forEach(function(k){
        var e=d[k];
        if(e&&e.t&&new Date(e.r||e.t).getTime()>seen) count++; // r = देर से पहुंची का भेजने का समय
      });
    });
    if(count>0){el.textContent=count>99?"99+":String(count); el.style.display="inline-block";}
    else el.style.display="none";
    // v9.229: एरर लॉग अब "JE सेटिंग व जांच" के अंदर है — बंद हिस्से पर भी गिनती दिखे
    var mb=document.getElementById("mn-admin-badge");
    if(mb){ mb.textContent=el.textContent; mb.style.display=el.style.display; }
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
      x:extra?String(extra).slice(0,200):"",
      i:Date.now().toString(36)+Math.random().toString(36).slice(2,6), // पहचान — बाद में "भेज दी" निशान लगाने को
      s:1 // 1 = अभी server पर नहीं गई (सिर्फ़ इसी फ़ोन में) — _logPost इसे server पर नहीं भेजता
    };
    var logs=getLogs(); logs.push(entry);
    if(logs.length>LOG_MAX) logs=logs.slice(logs.length-LOG_MAX);
    try{localStorage.setItem(LOG_KEY,JSON.stringify(logs));}catch(e2){}
    // server push (fire & forget) — offline या नाकाम हो तो entry पर s:1 रहता है और flushLogs()
    // नेट लौटने पर भेज देता है। push fail होने पर दोबारा logErr नहीं (loop से बचाव)
    if(navigator.onLine && _logPush<LOG_PUSH_MAX && typeof FB!=="undefined"){
      _logPush++;
      _logPost(entry).then(function(ok){ _logMarkSent(entry.i,!ok); });
    }
  }catch(e3){}
}

// ── v9.209: बिना नेट वाली errors बाद में भेजना ──
// पहले नेट न हो तो error सिर्फ़ उसी फ़ोन में रह जाती थी — गांव में ज़्यादातर काम बिना नेट होता है,
// इसलिए फ़ील्ड की सबसे ज़्यादा errors JE तक कभी पहुंचती ही नहीं थीं। अब हर entry पर s:1 ("भेजना बाकी")
// रहता है, और नेट लौटते / ऐप खुलते ही flushLogs() बाकी entries भेज देता है। देर से पहुंची entry में
// r = भेजने का समय (t = असली समय वैसा ही) — JE के लॉग में वह "📶 देर से पहुंची" दिखती है, और
// server पर आज के दिन में जाती है, ताकि "आज + कल" वाले viewer और बैज में दिखे।
// Firebase rules हर field को string मांगते हैं — इसलिए s/a (सिर्फ़ फ़ोन के निशान) server पर नहीं जाते
var LOG_FLUSH_MAX=20;      // एक बार में ज़्यादा से ज़्यादा इतनी — बाकी अगली बार
var LOG_LATE_MAX_DAYS=14;  // इससे पुरानी बिना-भेजी errors नहीं भेजतीं (server वैसे भी 15 दिन बाद मिटा देता है)
var LOG_SEND_TRIES=5;      // server बार-बार मना करे तो इतनी कोशिशों के बाद छोड़ दें
function _logPost(entry){
  var body={};
  Object.keys(entry).forEach(function(k){ if(k!=="s"&&k!=="a") body[k]=entry[k]; });
  var day=String(body.r||body.t||"").slice(0,10);
  return fetch(FB+"/LOGS/"+day+".json",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
    .then(function(r){ return !!(r&&r.ok); })
    .catch(function(){ return false; });
}
// id वाली entry का "भेजना बाकी" निशान हटाएं (ok=false हो तो सिर्फ़ कोशिश गिनें)
function _logMarkSent(id,failed){
  var logs=getLogs(), hit=false;
  logs.forEach(function(e){
    if(!e||e.i!==id) return;
    hit=true;
    if(!failed){ delete e.s; delete e.a; return; }
    e.a=(e.a||0)+1;
    if(e.a>=LOG_SEND_TRIES){ delete e.s; delete e.a; }
  });
  if(hit){ try{localStorage.setItem(LOG_KEY,JSON.stringify(logs));}catch(e2){} }
}
var _logFlushing=false;
function flushLogs(){
  if(_logFlushing||!navigator.onLine||typeof FB==="undefined") return Promise.resolve(0);
  var cutoff=Date.now()-LOG_LATE_MAX_DAYS*86400000;
  var todo=getLogs().filter(function(e){
    return e&&e.s&&e.i&&new Date(e.t).getTime()>=cutoff;
  }).slice(-LOG_FLUSH_MAX);
  if(!todo.length) return Promise.resolve(0);
  _logFlushing=true;
  var sent=0, nowIso=new Date().toISOString();
  // एक-एक करके — कमज़ोर नेट पर 20 request एक साथ न जाएं
  return todo.reduce(function(chain,e){
    return chain.then(function(){
      if(_logPush>=LOG_PUSH_MAX) return;
      _logPush++;
      var late={}; Object.keys(e).forEach(function(k){ late[k]=e[k]; });
      late.r=nowIso;
      return _logPost(late).then(function(ok){ _logMarkSent(e.i,!ok); if(ok) sent++; });
    });
  },Promise.resolve()).then(function(){ _logFlushing=false; return sent; },function(){ _logFlushing=false; return sent; });
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
// v9.230: CSP (index.html का meta) ने कुछ रोका — ऐप के किसी असली काम का पता सूची से छूटा हो तो यहीं दिखे।
// हर (नियम + साइट) एक session में एक ही बार, वरना एक रुकी चीज़ बार-बार लॉग भर देती
var _cspLogged={};
document.addEventListener("securitypolicyviolation",function(ev){
  if(!ev) return;
  var host=String(ev.blockedURI||"");
  try{ if(/^https?:/.test(host)) host=new URL(host).host; }catch(x){}
  var k=(ev.effectiveDirective||ev.violatedDirective||"?")+" "+host;
  if(_cspLogged[k]) return;
  _cspLogged[k]=1;
  logErr("csp-block",k,(String(ev.sourceFile||"").split("/").pop())+":"+(ev.lineNumber||""));
});
// Firebase App Check का reCAPTCHA v3 verification कमज़ोर नेटवर्क पर कभी-कभी समय पर पूरा नहीं होता।
// यह SDK के अपने अंदर (हमारे किसी .then()/.catch() chain के बाहर) होता है, इसलिए हम इसे पकड़ ही
// नहीं सकते — और App Check अभी सिर्फ़ "monitor mode" में है (enforce नहीं), इसका असर किसी भी
// save/read पर नहीं पड़ता, device सामान्य auth से ही काम करता रहता है। "Script error." जैसा ही
// बेमतलब शोर है (production में एक ही device पर बार-बार दिखा, कोई सुराग नहीं देता) — इसलिए लॉग नहीं करते
window.addEventListener("unhandledrejection",function(ev){
  var msg=(ev&&ev.reason&&ev.reason.message)||"";
  if(/^reCAPTCHA/i.test(msg)) return;
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
    var tag=e.s?' <span class="log-x">⏳ अभी भेजी नहीं</span>':(e.r?' <span class="log-x">📶 देर से पहुंची</span>':'');
    h+='<div class="log-row"><div class="log-top"><span class="log-ctx">'+escHtml(e.c||"?")+'</span>'
      +'<span class="log-when">'+escHtml(when)+' UTC'+tag+'</span></div>'
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
      .then(function(d){trackUsageOf(d);return d;})
      .catch(function(){return null;});
  })).then(function(res){
    var all=[];
    res.forEach(function(d){if(d&&typeof d==="object")Object.keys(d).forEach(function(k){all.push(d[k]);});});
    // देर से पहुंची (r) अपने पहुंचने के समय से — वरना पुरानी तारीख़ के नीचे दब जाती
    all.sort(function(a,b){return String(b&&(b.r||b.t)||"").localeCompare(String(a&&(a.r||a.t)||""));});
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
      trackUsageOf(d);
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
  appAsk({icon:"🗑️",title:"सभी devices के लॉग साफ़ करें?",msg:"पिछले 2 दिन के लॉग हमेशा के लिए मिटेंगे — सिर्फ़ इस device का नहीं, सबका।",buttons:[{label:"रुको, अभी नहीं",kind:"cancel",value:false},{label:"🗑️ हां, सबके लॉग मिटाओ",kind:"danger",value:true}]},function(v){ if(v) _clearServerLogsNow(); });
}
function _clearServerLogsNow(){
  document.getElementById("log-srv").innerHTML='<div class="log-empty">साफ़ हो रहा है...</div>';
  var days=[0,1].map(function(off){return new Date(Date.now()-off*86400000).toISOString().slice(0,10);});
  Promise.all(days.map(function(day){
    return fetch(FB+"/LOGS/"+day+".json",{method:"DELETE"}).catch(function(){});
  })).then(function(){
    toast("🗑️ सभी devices के लॉग साफ़ हो गए","ok");
    fetchServerLogs();
  });
}

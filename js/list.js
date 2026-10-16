function renderSummaryWith(data){
  var tot=0,paid=0,pend=0,pendAmt=0;
  data.forEach(function(c){tot++;if(c.status==="paid")paid++;else{pend++;pendAmt+=Number(c.amount)||0;}});
  var fmt=function(a){return a>=100000?"₹"+(a/100000).toFixed(1)+"L":a>=1000?"₹"+(a/1000).toFixed(1)+"K":"₹"+a;};
  // audit-verified: activeCat escHtml() से गुज़रता है, बाक़ी सब संख्या
  // eslint-disable-next-line no-unsanitized/property
  document.getElementById("summary").innerHTML=
    "<div class='sbox'><div class='snum'>"+tot+"</div><div class='slbl'>"+escHtml(activeCat)+"</div></div>"+
    "<div class='sbox'><div class='snum'>"+paid+"</div><div class='slbl'>✓ वसूल</div></div>"+
    "<div class='sbox'><div class='snum'>"+pend+"</div><div class='slbl'>✗ बाकी</div></div>"+
    "<div class='sbox'><div class='snum'>"+fmt(pendAmt)+"</div><div class='slbl'>बाकी राशि</div></div>";
}

// बटन की दिखावट हमेशा असली activeFilter जैसी — JE की रिपोर्ट (मढ़ी, screenshot): "बाकी" बटन
// हाइलाइट था पर सूची में वसूल कार्ड भी दिख रहे थे। असली वजह: कई रास्ते activeFilter="all" कर देते
// हैं (जैसे _finishLogin — यानी "बाकी" चुने रहते हुए logout+दोबारा login, जो _ensureCorrectHqAuth
// खुद भी करा देता है), पर filter बटनों की class पुरानी ("बाकी") ही रह जाती थी — सूची असल में "सभी"
// होती और वसूल कार्ड बीच में दिखते। अब हर render पर दोनों मिलाकर रखे जाते हैं, इसलिए वे कभी अलग
// नहीं हो सकते (चाहे कोई भी नया रास्ता activeFilter बदले)
function _syncFilterBtns(){
  document.querySelectorAll(".filter-btn").forEach(function(b){
    b.className="filter-btn"+(b.dataset.f===activeFilter?" active-"+activeFilter:"");
  });
}
function setFilter(btn){
  activeFilter=btn.dataset.f;
  _renderLimit=100;
  _syncFilterBtns();
  // पहले cache से तुरंत दिखाएं
  var cached=cGet(activeHQ,activeCat);
  if(cached.length) renderListWith(cached);
  // फिर network refresh
  fbGet(activeHQ,activeCat,function(d){renderListWith(d);});
}
var _searchTimer=null;
function debounceSearch(){
  clearTimeout(_searchTimer);
  _searchTimer=setTimeout(function(){renderList();},250);
}
// ── v9.202: "बड़ी बकाया पहले" क्रम + वादा-तारीख़ (JE की योजना: उद्देश्य-अनुकूलता 9.0 → 9.5) ──
// क्रम: सूची लेजर के क्रम में आती थी, तो ₹50 हज़ार वाला ₹500 वालों के बीच छिपा रहता। बटन दबाने पर
// बकाया के हिसाब से (बड़ी पहले) — सिर्फ़ दिखाने का क्रम, डेटा नहीं बदलता। गांव के अंदर चाहिए तो
// खोज में गांव का नाम लिखें (पता भी खोजा जाता है), फिर यही क्रम। पसंद हर फ़ोन पर याद रहती है
var LIST_SORT_KEY="dc_listsort";
// JE का फ़ैसला (11/10, विकल्प "ख"): डिफ़ॉल्ट = बड़ी बकाया पहले; जिसे रास्ते/बुक वाला लेजर-क्रम चाहिए वह नाम
// वाले मेनू में "📋 लेजर क्रम" चालू करे (पसंद फ़ोन पर याद रहती है)
// v9.215: तीसरा क्रम "oldpay" — ⏳ पुराने बकायादार पहले
var listSort=(function(){ try{ var v=localStorage.getItem(LIST_SORT_KEY); return (v==="ledger"||v==="oldpay")?v:"amount"; }catch(e){ return "amount"; } })();
// चालू/बंद ऊपर नाम वाले मेनू ("₹ बड़ी बकाया पहले") से — JE (11/10) ने इसे सूची के ऊपर नहीं, मेनू में चाहा
function toggleListSort(e){
  // मेनू नाम वाले बटन (user-pill) के अंदर है — क्लिक ऊपर तक जाता तो toggleUserMenu मेनू दोबारा खोल देता
  if(e&&e.stopPropagation) e.stopPropagation();
  setListSort(listSort==="ledger"?"amount":"ledger"); // पुराना-भुगतान क्रम चालू हो तब भी दबाने पर लेजर क्रम
  var mn=document.getElementById("logout-menu"); if(mn) mn.classList.remove("open");
  if(typeof toast==="function") toast(listSort==="ledger"?"📋 लेजर क्रम — चालू":"₹ बड़ी बकाया पहले — लेजर क्रम बंद","inf");
}
function setListSort(v){
  listSort=(v==="ledger"||v==="oldpay")?v:"amount";
  try{ localStorage.setItem(LIST_SORT_KEY,listSort); }catch(e){}
  _renderLimit=100;
  renderList();
}
// सरपंच/ग्राम पंचायत (टैरिफ़ LV3.1, LV3.2 — नल-जल/स्ट्रीट लाइट) की बकाया बहुत बड़ी होती है और वह लाइनमैन के
// घर-घर वाले काम की नहीं — JE (11/10): "बड़ी बकाया पहले" में भी इन्हें सबसे नीचे रखना है। टैरिफ़ लेजर से
// text में आता है ("LV3.1", "LV 3.2", "lv-3.1 (Rural)"…), इसलिए ढीला मिलान; LV3.10 जैसा कुछ न पकड़ा जाए
var _PANCHAYAT_TARIFF_RE=/LV\s*-?\s*3\s*[.\-]\s*[12](?!\d)/i;
function isPanchayatTariff(x){ return !!(x&&x.tariff&&_PANCHAYAT_TARIFF_RE.test(String(x.tariff))); }
function _syncSortBtn(){
  // मेनू में क्रम के दो विकल्प — "📋 लेजर क्रम" और "⏳ पुराने बकायादार पहले" (दोनों बंद = बड़ी बकाया पहले), साथ में "🚫 कभी भुगतान नहीं" फ़िल्टर
  /** @type {Array<[string,boolean]>} */
  var rows=[["sort-menu-state",listSort==="ledger"],["oldpay-menu-state",listSort==="oldpay"],["neverpaid-menu-state",neverPaidOnly]];
  rows.forEach(function(p){
    var on=p[1];
    var st=document.getElementById(p[0]); if(st){ st.textContent=on?"✓ चालू":"बंद"; st.className="sort-menu-state"+(on?" on":""); }
  });
}
// ── v9.216: 🚫 कभी भुगतान नहीं (JE, 13/10) ──
// लेजर में न "पिछला भुगतान तिथि" न "पिछला भुगतान राशि" (या राशि 0) — यानी कनेक्शन के बाद से कोई भुगतान दर्ज
// नहीं — और अभी भी बाकी। नाम वाले मेनू से चालू; चालू हो तो सूची (और PDF/Excel) सिर्फ़ इन्हीं की, बाकी फ़िल्टर/
// गांव/खोज के साथ। मेनू में छिपा फ़िल्टर भूल न जाएं, इसलिए सूची के ऊपर लाल पट्टी "… ✕ हटाएं"। जान-बूझकर
// याद नहीं रखा जाता — ऐप दोबारा खुले तो पूरी सूची (वरना लाइनमैन सोचेगा कि बाकी उपभोक्ता ग़ायब हो गए)।
// सिर्फ़ फ़ोन में रखी सूची से — कोई डेटा-ख़र्च नहीं
var neverPaidOnly=false;
function isNeverPaid(x){
  if(!x||x.status==="paid") return false;
  if(String(x.lastPayDate||"").trim()) return false;
  var a=String(x.lastPaidAmt==null?"":x.lastPaidAmt).replace(/[,₹\s]/g,"");
  return !a||Number(a)===0;
}
function toggleNeverPaid(e){
  if(e&&e.stopPropagation) e.stopPropagation();
  setNeverPaid(!neverPaidOnly);
  var mn=document.getElementById("logout-menu"); if(mn) mn.classList.remove("open");
}
function setNeverPaid(on){
  neverPaidOnly=!!on;
  _renderLimit=100;
  renderList();
  if(typeof toast==="function") toast(neverPaidOnly?"🚫 सिर्फ़ कभी भुगतान न करने वाले":"पूरी सूची","inf");
}
function _renderNeverPaidStrip(data){
  var el=document.getElementById("np-strip"); if(!el) return;
  if(!neverPaidOnly){ el.style.display="none"; el.innerHTML=""; return; }
  var n=(data||[]).filter(function(x){ return isNeverPaid(x)&&(!activeVillage||_villageKey(x)===activeVillage); }).length;
  el.style.display="flex";
  // audit-verified: n एक गिनती (number) है, बाक़ी सब hardcoded — कोई उपभोक्ता/बाहरी text नहीं
  // eslint-disable-next-line no-unsanitized/property
  el.innerHTML="<span>🚫 सिर्फ़ कभी भुगतान न करने वाले — <b>"+n+"</b> उपभोक्ता</span>"+
    "<button type='button' class='np-off' onclick='setNeverPaid(false)'>✕ हटाएं</button>";
}
// ── v9.215: ⏳ पुराने बकायादार पहले (JE, 13/10; v9.216 में नाम "🕰️ पुराना भुगतान पहले" से बदला) ──
// "जिसने लंबे समय से भुगतान नहीं किया वह सूची में कहीं नीचे खो जाता है" — लेजर का "पिछला भुगतान तिथि"
// (lastPayDate, अपलोड के समय लेजर से) देखकर सबसे पुराना सबसे ऊपर। जिसकी तारीख़ ही नहीं (कभी भुगतान नहीं /
// कॉलम ख़ाली) वह सबसे ऊपर। एक ही महीने वालों में बड़ी बकाया पहले; पंचायत (LV3.1/3.2) नीचे; वसूल हो चुके
// सबसे नीचे। card पर "⏰ N महीने से भुगतान नहीं" सिर्फ़ इसी क्रम में (JE का फ़ैसला)। सिर्फ़ फ़ोन में रखी
// सूची से — कोई नया डेटा/नेट नहीं
function toggleOldPaySort(e){
  if(e&&e.stopPropagation) e.stopPropagation();
  setListSort(listSort==="oldpay"?"amount":"oldpay");
  var mn=document.getElementById("logout-menu"); if(mn) mn.classList.remove("open");
  if(typeof toast==="function") toast(listSort==="oldpay"?"⏳ पुराने बकायादार पहले — चालू":"₹ बड़ी बकाया पहले — पुराने बकायादार क्रम बंद","inf");
}
var _MON={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
// लेजर की तारीख़ कई रूपों में आती है (Excel का अपना format): 13/10/2025, 13-10-25, 13.10.2025, 2025-10-13,
// 13-Oct-2025, "2025-10-13 00:00:00", और Excel का अमेरिकी 10/13/25। दोनों हिस्से 12 तक हों तो दिन/महीना
// (भारतीय) मानें; दूसरा 12 से बड़ा हो तो महीना/दिन। पहचान न हो तो null
function lastPayTs(x){
  var v=String((x&&x.lastPayDate)||"").trim();
  if(/^\d{4}-\d{1,2}-\d{1,2}[ T]/.test(v)) v=v.split(/[ T]/)[0]; // "2025-10-13 00:00:00" — समय हटाएं
  if(!v) return null;
  var y,mo,d,m;
  if((m=v.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/))){ y=+m[1]; mo=+m[2]; d=+m[3]; }
  else if((m=v.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/))){
    d=+m[1]; mo=+m[2]; y=+m[3];
    if(mo>12&&d<=12){ var t=d; d=mo; mo=t; }
  }
  else if((m=v.match(/^(\d{1,2})[\/.\- ]([A-Za-z]{3})[A-Za-z]*[\/.\- ,]*(\d{2}|\d{4})$/))){ d=+m[1]; mo=_MON[m[2].toLowerCase()]; y=+m[3]; }
  else return null;
  if(y<100) y+=2000;
  if(!mo||mo>12||!d||d>31||y<1990) return null;
  var dt=new Date(y,mo-1,d);
  if(isNaN(dt.getTime())) return null;
  var now=Date.now();
  return Math.min(dt.getTime(),now);
}
// आख़िरी भुगतान से पूरे कितने महीने (तारीख़ न हो तो null)
function monthsSincePay(x,nowD){
  var ts=lastPayTs(x); if(ts===null) return null;
  var a=new Date(ts), n=nowD||new Date();
  var mm=(n.getFullYear()-a.getFullYear())*12+(n.getMonth()-a.getMonth())-(n.getDate()<a.getDate()?1:0);
  return Math.max(0,mm);
}
function _oldPayChip(x){
  var mm=monthsSincePay(x);
  if(mm===null) return "<span class='chip chip-oldpay red'>⏰ भुगतान तारीख़ नहीं</span>";
  var cls=mm>=12?" red":mm>=6?" orange":"";
  var txt=mm<1?"इसी महीने भुगतान":mm+" महीने से भुगतान नहीं";
  return "<span class='chip chip-oldpay"+cls+"'>⏰ "+txt+"</span>";
}
// वादा: रिमार्क के साथ वैकल्पिक तारीख़ (remarksArr की entry में due:"yyyy-mm-dd")। बाकी उपभोक्ता का
// सबसे नया वादा ही गिना जाता है; वसूल होते ही वादा अपने-आप ख़त्म (status देखकर)। पुराने version वाले
// फ़ोन due को बस अनदेखा करते हैं — रिमार्क text में भी तारीख़ लिखी रहती है
function _isoToday(){ var t=new Date(); return t.getFullYear()+"-"+String(t.getMonth()+1).padStart(2,"0")+"-"+String(t.getDate()).padStart(2,"0"); }
// ── v9.234 (JE 16/10): एक ही उपभोक्ता के रिमार्क उसी HQ की सारी सूचियों से मिलाकर दिखाना ──
// हर सूची में उपभोक्ता की अलग copy है। रिमार्क जिस सूची में लिखा वहीं रहता — propagateRemark बाक़ी सूचियों में
// तभी जोड़ता है जब वो लिखने वाले फ़ोन पर उतरी हों, और Replace अपलोड फ़ोन की copy से रिमार्क उठाता है। असली
// घटना: 1134007169 का रिमार्क "कुल उपभोक्ता" में था, "5 Year Nonpay" (14/10 को अपलोड) में नहीं दिखा।
// अब दिखाते वक़्त (कार्ड, रिमार्क खिड़की, वादा, शेयर, PDF/Excel) फ़ोन में पड़ी सब सूचियों से उसी Consumer No
// के रिमार्क जुड़ते हैं — सिर्फ़ फ़ोन की copy से: कोई Firebase पढ़ाई/लिखाई नहीं, बिना नेट भी
var _rmkIdx={hq:null,gen:-1,refs:null,map:null};
function _rmkIndex(hq){
  var cats=[],refs=[];
  for(var i=0;i<CATS_DEFAULT.length;i++){
    var cat=isCatEditable(i)?getCatName(hq,i):CATS_DEFAULT[i];
    cats.push(cat);
    // cGet नहीं — वह "इस्तेमाल हुई" निशान लगाता है (न खुली सूचियों की सफ़ाई बिगड़ती)
    var d=CACHE[cKey(hq,cat)];
    refs.push(d,d?d.length:0);
  }
  var c=_rmkIdx;
  if(c.hq===hq&&c.gen===_cacheGen&&c.refs&&c.refs.length===refs.length&&refs.every(function(v,j){ return v===c.refs[j]; })) return c.map;
  var map={};
  cats.forEach(function(cat,j){
    (refs[j*2]||[]).forEach(function(x){
      if(!x||!x.remarksArr||!x.remarksArr.length||x.acc==null) return;
      var k=String(x.acc).trim(); if(!k) return;
      var a=map[k]||(map[k]=[]);
      x.remarksArr.forEach(function(r){ if(r&&r.text) a.push({r:r,cat:cat}); });
    });
  });
  _rmkIdx={hq:hq,gen:_cacheGen,refs:refs,map:map};
  return map;
}
// रिमार्क की तारीख़ (दिन) — "16/10/2026, 3:55 pm" (hi-IN) या "बैकअप 2026-10-12"; न पढ़ी जाए तो 0
function _rmkDayTs(at){
  var s=String(at==null?"":at), m=s.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if(m) return new Date(+m[3],+m[2]-1,+m[1]).getTime()||0;
  m=s.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m?(new Date(+m[1],+m[2]-1,+m[3]).getTime()||0):0;
}
function remarksAll(x,hq){
  var own=(x&&x.remarksArr)||[];
  if(!x||x.acc==null||!hq) return own;
  var extra=_rmkIndex(hq)[String(x.acc).trim()];
  if(!extra||!extra.length) return own;
  // पहचान text|by|at; बैकअप से लौटा (restored) रिमार्क और असली एक ही बात हों तो एक ही दिखे
  var seen={},seenTB={},out=[];
  function add(r,srcCat){
    if(!r||!r.text) return;
    var k=rmkKeyOf(r), tb=r.text+"|"+(r.by||"");
    if(seen[k]) return;
    if(seenTB[tb]&&(r.restored||seenTB[tb].restored)) return;
    seen[k]=1; seenTB[tb]=r;
    out.push(srcCat&&!r.cat?Object.assign({},r,{cat:srcCat}):r);
  }
  own.forEach(function(r){ add(r,null); });
  var n=out.length;
  extra.forEach(function(e){ add(e.r,e.cat); });
  if(out.length===n) return own; // दूसरी सूचियों में कुछ नया नहीं
  // क्रम: पुराना → नया (तारीख़ से); तारीख़ न पढ़ी जाए तो पिछले वाले की मानो — जगह न बदले
  var last=0;
  return out.map(function(r,i){ var t=_rmkDayTs(r.at)||last; last=t; return {r:r,t:t,i:i}; })
    .sort(function(a,b){ return a.t-b.t||a.i-b.i; }).map(function(o){ return o.r; });
}
function promiseDue(x){
  if(!x||x.status==="paid") return "";
  var a=remarksAll(x,activeHQ);
  for(var i=a.length-1;i>=0;i--){ if(a[i]&&/^\d{4}-\d{2}-\d{2}$/.test(a[i].due||"")) return a[i].due; }
  return "";
}
function _isoPlus(n){ var t=new Date(); t.setDate(t.getDate()+n); return t.getFullYear()+"-"+String(t.getMonth()+1).padStart(2,"0")+"-"+String(t.getDate()).padStart(2,"0"); }
// ── v9.204: वादा एक टैप में — "कल / 2 दिन में / हफ़्ते में / तारीख़…" (JE ने नमूना देखकर "ठीक है" कहा) ──
// बटन छिपे #rmk-due में तारीख़ भरते हैं; दोबारा वही बटन = वादा हटाओ। "तारीख़…" पर ही कैलेंडर वाला खाना दिखता है
var _duePick="";
function pickDue(btn){
  var k=(btn&&btn.dataset&&btn.dataset.d)||"", el=document.getElementById("rmk-due"); if(!el) return;
  if(_duePick===k){ _duePick=""; el.value=""; }
  else{
    _duePick=k;
    el.value=(k==="pick")?((el.value&&el.value>=_isoToday())?el.value:""):_isoPlus(Number(k));
  }
  el.style.display=(_duePick==="pick")?"block":"none";
  if(_duePick==="pick"&&el.showPicker){ try{ el.showPicker(); }catch(e){} } // कुछ पुराने browser में नहीं — तब खाना दबाएं
  _dueSync();
}
function _dueSync(){
  var el=document.getElementById("rmk-due");
  document.querySelectorAll("#rmk-due-grp .due-chip").forEach(function(b){ b.className="due-chip"+(b.dataset.d===_duePick?" on":""); });
  var n=document.getElementById("rmk-due-note");
  if(n) n.textContent=(el&&el.value)?("✓ वादा: "+_fmtDue(el.value)+" — उस सप्ताह \"इस सप्ताह जमा का वादा\" में दिखेगा"):"";
}
function _fmtDue(iso){ var p=String(iso||"").split("-"); return p.length===3?(Number(p[2])+"/"+Number(p[1])+"/"+p[0]):""; }
// वादे का निशान 🤝 — 📅 कई फ़ोनों पर "JUL 17" छपे कैलेंडर जैसा दिखता था (JE, 11/10)।
// v9.207 (JE, 11/10): बटन "इस सप्ताह जमा का वादा" — जिनकी वादा-तारीख़ चालू सप्ताह (सोमवार से रविवार) में है।
// (पहले "आज जमा का वादा" = आज या बीते दिनों के वादे।) सप्ताह फ़ोन की अपनी तारीख़ से
function _isoOf(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function _weekRange(){
  var t=new Date(); t.setHours(12,0,0,0); // दोपहर — घड़ी-बदलाव/आधी रात के किनारे से बचने को
  var mon=new Date(t); mon.setDate(t.getDate()-((t.getDay()+6)%7)); // getDay: रविवार=0 → 6 दिन पीछे
  var sun=new Date(mon); sun.setDate(mon.getDate()+6);
  return [_isoOf(mon),_isoOf(sun)];
}
// v9.208 (JE, 11/10): पिछले सप्ताहों के टूटे वादे (अब भी बाकी) भी इसी बटन में — तारीख़ के क्रम से सबसे ऊपर, लाल "(बीत गया)"।
// वसूल होते ही promiseDue() ख़ाली, तो अपने-आप हट जाते हैं। अगले सप्ताह के वादे अब भी नहीं
function isPromiseDue(x,wk){ var pd=promiseDue(x); if(!pd) return false; wk=wk||_weekRange(); return pd<=wk[1]; }
// ── v9.203: गांव की पट्टी — सूची के ऊपर गांवों के बटन, टैप करते ही उसी गांव की सूची ──
// गांव = लेजर का "पता" खाना, js/village.js वाली ही कुंजी (_vgNormKey: बड़े अक्षर + VILLAGE_ALIASES के
// स्पेलिंग-सुधार, जैसे JUMUA → JAMUA) — ताकि गांव-वार वसूली और यह पट्टी एक जैसा गिनें। JE (11/10): नाम
// अंग्रेज़ी (जैसे लेजर में), सबसे ज़्यादा बाकी वाला गांव पहले। सब फ़ोन पर पड़ी सूची से — कोई नेट नहीं।
// मुख्यालय/श्रेणी बदलते ही चुनाव "सभी" पर लौटता है (पिछला गांव भूल से न रह जाए)
var activeVillage="", _vgListFor="";
// पट्टी दिखे या नहीं — नाम वाले मेनू से (JE, 11/10: "पट्टी हटा लें या रख लें")। डिफ़ॉल्ट: दिखे।
// छिपाते ही चुना गांव भी "सभी" पर — वरना सूची किसी अनदेखे गांव पर छंटी रह जाती
var VG_BAR_KEY="dc_vgbar";
var vgBarOn=(function(){ try{ return localStorage.getItem(VG_BAR_KEY)!=="off"; }catch(e){ return true; } })();
function toggleVillageBar(e){
  if(e&&e.stopPropagation) e.stopPropagation(); // मेनू नाम वाले बटन के अंदर है — दोबारा न खुले
  vgBarOn=!vgBarOn;
  try{ localStorage.setItem(VG_BAR_KEY,vgBarOn?"on":"off"); }catch(x){}
  if(!vgBarOn) activeVillage="";
  var mn=document.getElementById("logout-menu"); if(mn) mn.classList.remove("open");
  if(typeof toast==="function") toast(vgBarOn?"📍 गांव की पट्टी — दिखेगी":"📍 गांव की पट्टी — छिपा दी","inf");
  _renderLimit=100;
  renderList();
}
function _syncVgBarMenu(){
  var st=document.getElementById("vgbar-menu-state"); if(!st) return;
  st.textContent=vgBarOn?"✓ दिखे":"छिपी";
  st.className="vgbar-menu-state"+(vgBarOn?" on":"");
}
function _villageKey(x){ return _vgNormKey(activeHQ,(x&&x.addr)||""); }
function setVillage(v){
  activeVillage=String(v||"");
  _renderLimit=100;
  renderList(); // पन्ना अपने-आप नहीं खिसकता — पट्टी दिखती रहे ताकि अगला गांव तुरंत चुना जा सके
}
function _renderVillageBar(data){
  var w=document.getElementById("vg-wrap"); if(!w) return;
  _syncVgBarMenu();
  if(!vgBarOn){ activeVillage=""; w.style.display="none"; w.innerHTML=""; return; }
  var m={};
  data.forEach(function(x){
    if(!x) return;
    var k=_villageKey(x);
    if(!m[k]) m[k]={k:k,pend:0};
    if(x.status!=="paid") m[k].pend++;
  });
  var rows=Object.keys(m).map(function(k){return m[k];});
  if(activeVillage&&!m[activeVillage]) activeVillage=""; // यह गांव अब सूची में नहीं
  if(rows.length<2){ w.style.display="none"; w.innerHTML=""; return; } // एक ही गांव — पट्टी बेकार
  rows.sort(function(a,b){ return (b.pend-a.pend)||(a.k<b.k?-1:a.k>b.k?1:0); });
  // audit-verified: गांव का नाम escHtml() से; onclick में कोई field नहीं (this.dataset.v)
  // eslint-disable-next-line no-unsanitized/property
  w.innerHTML="<span class='vg-lbl'>📍 गांव:</span>"+
    "<button type='button' class='vg-chip"+(activeVillage?"":" on")+"' data-v='' onclick='setVillage(this.dataset.v)'>सभी</button>"+
    rows.map(function(r){
      return "<button type='button' class='vg-chip"+(activeVillage===r.k?" on":"")+"' data-v='"+escHtml(r.k)+"' onclick='setVillage(this.dataset.v)'>"+
        escHtml(r.k||"(पता नहीं)")+"<b>"+r.pend+"</b></button>";
    }).join("");
  w.style.display="flex";
}
function renderList(){var d=cGet(activeHQ,activeCat);renderListWith(d);}
var _renderLimit=100;
function renderListWith(data){
  _syncFilterBtns(); // बटन और असली फ़िल्टर कभी अलग न दिखें (देखें ऊपर)
  _syncSortBtn();
  if(_vgListFor!==activeHQ+"/"+activeCat){ _vgListFor=activeHQ+"/"+activeCat; activeVillage=""; }
  _renderVillageBar(data);
  _renderNeverPaidStrip(data);
  var today=_isoToday();
  var fbP=document.getElementById("fb-promise");
  var wk=_weekRange();
  if(fbP){ var nP=data.filter(function(x){ return isPromiseDue(x,wk)&&(!activeVillage||_villageKey(x)===activeVillage); }).length; fbP.textContent="इस सप्ताह जमा का वादा"+(nP?" ("+nP+")":""); } // JE: बटन पर कैलेंडर का निशान नहीं
  var q=(document.getElementById("search-inp").value||"").toLowerCase().trim();
  var c=document.getElementById("con-list");
  var filtered=data.filter(function(x){
    var qd=q.replace(/\D/g,"");
    var matchQ=!q||
      (x.name||"").toLowerCase().includes(q)||
      (x.acc||"").toLowerCase().includes(q)||
      (qd.length>=4&&(x.phone||"").replace(/\D/g,"").includes(qd))||
      (x.phone||"").toLowerCase().includes(q)||
      (x.addr||"").toLowerCase().includes(q)||
      (x.tariff||"").toLowerCase().includes(q)||
      (x.father||"").toLowerCase().includes(q);
    // JE का नियम: वसूल + बाकी = कुल उपभोक्ता = सभी। ऊपर की गिनती (renderSummaryWith) "बाकी" में
    // हर उस record को गिनती है जो paid नहीं — इसलिए सूची भी वैसी ही छंटे। पहले सूची ठीक "pending"
    // लिखा होने पर ही दिखाती थी, तो जिस पुराने record में status खाली/कुछ और होता वह गिनती में तो
    // "बाकी" में आता पर सूची में कहीं नहीं दिखता — दोनों सूचियां जोड़ने पर कुल से कम बैठतीं
    var st=(activeFilter==="promise")?isPromiseDue(x,wk):
           (activeFilter==="paid")?(x.status==="paid"):(x.status!=="paid");
    if(activeVillage&&_villageKey(x)!==activeVillage) return false;
    if(neverPaidOnly&&!isNeverPaid(x)) return false; // v9.216
    return matchQ&&(activeFilter==="all"||st);
  });
  // वादे: सबसे पुराना (बीता) वादा सबसे ऊपर; बाक़ी में चुना हुआ क्रम
  if(activeFilter==="promise") filtered.sort(function(a,b){ var pa=promiseDue(a),pb=promiseDue(b); return pa<pb?-1:pa>pb?1:0; });
  else if(listSort==="oldpay") filtered.sort(function(a,b){
    var pa=a.status==="paid"?1:0, pb=b.status==="paid"?1:0;
    if(pa!==pb) return pa-pb; // वसूल हो चुके सबसे नीचे
    var ga=isPanchayatTariff(a)?1:0, gb=isPanchayatTariff(b)?1:0;
    if(ga!==gb) return ga-gb; // पंचायत नीचे
    var ta=lastPayTs(a), tb=lastPayTs(b);
    var ka=ta===null?-Infinity:new Date(ta).getFullYear()*12+new Date(ta).getMonth(); // महीने तक — एक ही महीने वालों में बड़ी बकाया पहले
    var kb=tb===null?-Infinity:new Date(tb).getFullYear()*12+new Date(tb).getMonth();
    if(ka!==kb) return ka<kb?-1:1;
    return (Number(b.amount)||0)-(Number(a.amount)||0);
  });
  else if(listSort==="amount") filtered.sort(function(a,b){
    var ga=isPanchayatTariff(a)?1:0, gb=isPanchayatTariff(b)?1:0;
    if(ga!==gb) return ga-gb; // पंचायत (LV3.1/LV3.2) हमेशा नीचे, आपस में बड़ी बकाया पहले
    return (Number(b.amount)||0)-(Number(a.amount)||0);
  });
  if(!filtered.length){
    var emptyMsg;
    if(activeFilter==="promise") emptyMsg="इस सप्ताह कोई वादा बाकी नहीं";
    else if(activeFilter==="paid") emptyMsg="अभी कोई वसूली दर्ज नहीं";
    else if(activeFilter==="pending") emptyMsg="सभी वसूली हो चुकी है!";
    else if(q) emptyMsg="कोई परिणाम नहीं";
    else emptyMsg="सूची खाली है";
    var emptyIco=activeFilter==="promise"?"🤝":activeFilter==="paid"?"✅":activeFilter==="pending"?"⏳":(q?"🔍":"📋");
    var emptySub=activeFilter==="promise"?"✏️ रिमार्क में 🤝 वादा डालें — उसी सप्ताह उपभोक्ता यहां दिखेगा":
                 (!q&&activeFilter==="all")?"📤 अपलोड बटन से लिस्ट डालें":"🔍 खोज या फ़िल्टर बदलें";
    // audit-verified: emptyMsg/emptyIco/emptySub सब hardcoded literals में से चुने जाते हैं (कभी भी
    // सीधे q/किसी field का value नहीं होते) — plugin ternary को समझ नहीं पाता
    // eslint-disable-next-line no-unsanitized/property
    c.innerHTML="<div class='empty'><div class='empty-ico'>"+emptyIco+"</div>"+
      "<div class='empty-t'>"+emptyMsg+"</div>"+
      "<div class='empty-s'>"+emptySub+"</div></div>";
    requestAnimationFrame(_updateBnavVisibility); // अगले paint frame तक टालें — DOM लिखने के तुरंत बाद scrollHeight पढ़ने से जबरन (महंगा) layout reflow होता है, बड़ी list पर धीमापन
    return;
  }
  var toRender=filtered.slice(0,_renderLimit);
  var hasMore=filtered.length>_renderLimit;
  // audit-verified: नीचे हर con-card में सभी consumer fields (name/father/acc/phone/addr/tariff/
  // load/unit/rmk/paydate आदि) escHtml()/escJsAttr() से गुज़रते हैं — plugin .map().join() के अंदर
  // की calls नहीं देख पाता
  // eslint-disable-next-line no-unsanitized/property
  c.innerHTML=toRender.map(function(x){
    var oi=data.indexOf(x),isPaid=x.status==="paid";
    var remarksArr=remarksAll(x,activeHQ);
    var rmkHtml="";
    if(remarksArr.length){
      rmkHtml="<div class='cc-rmk-list'>";
      remarksArr.slice().reverse().forEach(function(r){
        rmkHtml+="<div class='cc-rmk-item'><span>💬 "+escHtml(r.text)+(r.due?" <b>🤝 "+escHtml(_fmtDue(r.due))+"</b>":"")+"</span><span class='cc-rmk-by'>— "+escHtml(r.by)+(r.at?" • "+r.at:"")+"</span></div>";
      });
      rmkHtml+="</div>";
    }
    var uploadInfo="";
    if(x.updatedBy&&x.updatedAt) uploadInfo="<span class='cc-upload-info'>🔄 अपडेट: "+escHtml(x.updatedBy)+" • "+escHtml(x.updatedAt)+"</span>";
    else if(x.uploadedBy&&x.uploadedAt) uploadInfo="<span class='cc-upload-info'>📤 अपलोड: "+escHtml(x.uploadedBy)+" • "+escHtml(x.uploadedAt)+"</span>";
    var prevPayInfo="";
    if(x.lastPaidAmt&&x.lastPaidAmt.toString().trim()!==""){
      var lastAmtNum=Number(x.lastPaidAmt);
      prevPayInfo="<span style='color:#7986cb;'>📅 पिछला भुगतान: ₹"+(isNaN(lastAmtNum)?x.lastPaidAmt:lastAmtNum.toLocaleString("hi-IN"))+(x.lastPayDate?" ("+escHtml(x.lastPayDate)+")":"")+"</span>";
    } else if(x.lastPayDate&&x.lastPayDate.trim()){
      prevPayInfo="<span style='color:#7986cb;'>📅 पिछला भुगतान तिथि: "+escHtml(x.lastPayDate)+"</span>";
    }
    var payDateInfo=x.paydate?"<span class='cc-paydate'>💰 वसूल: "+escHtml(x.paydate)+"</span>":"";
    var pdue=promiseDue(x), dueChip="";
    if(pdue) dueChip="<span class='chip chip-due"+(pdue<today?" over":pdue===today?" today":"")+"'>🤝 वादा: "+escHtml(_fmtDue(pdue))+
      (pdue<today?" (बीत गया)":pdue===today?" (आज)":"")+"</span>";
    return "<div class='con-card "+(isPaid?"paid":"pending")+"'>"+
      "<div class='cc-top'><div class='cc-name'>"+escHtml(x.name)+(x.father?" / "+escHtml(x.father):"")+"</div><button class='cc-share' title='शेयर' aria-label='शेयर' onclick=\"shareCard("+oi+",'"+escJsAttr(x.acc||"")+"',this)\">"+CC_SHARE_ICON+"</button><div class='cc-rank'>#"+(oi+1)+"</div></div>"+
      "<div class='cc-amt'>₹"+Number(x.amount).toLocaleString("hi-IN")+" <span>बकाया</span></div>"+
      "<div class='cc-chips'>"+dueChip+(listSort==="oldpay"&&!isPaid?_oldPayChip(x):"")+
        (x.acc?"<span class='chip chip-acc' onclick=\"openAccModal('"+escJsAttr(x.acc)+"')\">📄 "+escHtml(x.acc)+"</span>":"")+
                (x.phone?"<span class='chip chip-ph' style='cursor:pointer;' onclick=\"openPhModal('"+escJsAttr(x.name)+"','"+escJsAttr(x.phone)+"','"+escJsAttr(x.acc||"")+"','"+(Number(x.amount)||0)+"')\">📞 "+escHtml(x.phone)+"</span>":"")+
        (x.addr?"<span class='chip chip-addr'>📍 "+escHtml(x.addr)+"</span>":"")+
      "</div>"+
      "<div class='cc-extra'>"+
        (x.tariff?"<span style='font-size:10px;padding:2px 7px;border-radius:12px;background:rgba(255,152,0,.12);color:#ffb74d;'>⚡ "+escHtml(x.tariff)+"</span>":"")+
        (x.load?"<span style='font-size:10px;padding:2px 7px;border-radius:12px;background:rgba(33,150,243,.1);color:#64b5f6;'>🔌 "+escHtml(x.load)+"</span>":"")+
        (x.unit?"<span style='font-size:10px;padding:2px 7px;border-radius:12px;background:rgba(0,200,150,.08);color:#4db6ac;'>📊 "+escHtml(x.unit)+"</span>":"")+
      "</div>"+
      "<div class='cc-bot'><span class='sbadge "+(isPaid?"sb-paid":"sb-pending")+"'>"+(isPaid?"✅ वसूल":"⏳ बाकी")+"</span>"+
      "<div class='act-btns'>"+
        "<button class='abtn abtn-rmk' onclick=\"openRmkModal("+oi+",'"+escJsAttr(x.acc||"")+"')\">✏️ रिमार्क</button>"+
        (!isPaid?"<button class='abtn abtn-pay' onclick=\"markPaid("+oi+",'"+escJsAttr(x.acc||"")+"')\">✓ वसूल</button>":
                 "<button class='abtn' style='background:rgba(255,77,109,.12);color:var(--red);border:1px solid rgba(255,77,109,.2);' onclick=\"markUnpaid("+oi+",'"+escJsAttr(x.acc||"")+"')\">↩ वापस बाकी</button>")+
      "</div></div>"+
      "<div class='cc-info'>"+prevPayInfo+payDateInfo+uploadInfo+"</div>"+
      rmkHtml+"</div>";
  }).join("")+
  (hasMore?"<div style='text-align:center;padding:14px 0 60px;'><button onclick='_renderLimit+=100;renderListWith(cGet(activeHQ,activeCat));' style='border:1px solid var(--border);background:var(--card);color:var(--muted);border-radius:10px;padding:10px 22px;font-family:\"Noto Sans Devanagari\",sans-serif;font-size:12px;cursor:pointer;'>⬇ और दिखाएं ("+toRender.length+"/"+filtered.length+")</button></div>":"");
  requestAnimationFrame(_updateBnavVisibility); // अगले paint frame तक टालें — DOM लिखने के तुरंत बाद scrollHeight पढ़ने से जबरन (महंगा) layout reflow होता है, बड़ी list पर धीमापन
}

// शेयर का मुड़ा हुआ तीर (JE का फ़ैसला: अलग बटन नहीं, बस तीर) — SVG इसलिए कि हर फ़ोन/font पर
// एक जैसा दिखे; currentColor से theme के रंग अपने-आप लगते हैं
var CC_SHARE_ICON="<svg viewBox='0 0 24 24' width='20' height='20' fill='none' stroke='currentColor' stroke-width='2.1' stroke-linecap='round' stroke-linejoin='round'><path d='M4 20v-6a5 5 0 0 1 5-5h9'/><polyline points='13,4 19,9 13,14'/></svg>";

// सिंगल-कोट (') को भी &#39; कर देते हैं — भले ही ज़्यादातर जगह double-quoted attribute
// (onclick=\"...\") या plain text content है जहां ' वैसे भी खतरनाक नहीं, पर कहीं single-quoted
// attribute (value='...') में इस्तेमाल हो (जैसे ui-core.js: openPinModal) तो वहां raw ' attribute
// को समय से पहले बंद कर सकता था — असली bug यही था (HQ_PIN फ़ील्ड पर कोई digit-only validation नहीं,
// JE कुछ भी टाइप कर सकता है)। &#39; हर जगह ' जैसा ही दिखता है, कहीं कुछ नहीं टूटता।
function escHtml(s){
  if(!s) return "";
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

// जब कोई value onclick="...('VALUE')" जैसे single-quoted JS string के अंदर, किसी HTML attribute में
// डालनी हो — escHtml() अकेले काफ़ी नहीं है। भले ही अब वो ' को &#39; कर देता है (जो HTML-parse होकर
// वापस ' बन जाता है), पर JS engine को वो ' बिना backslash के मिलता है — तो onclick की JS string
// तब भी समय से पहले बंद हो सकती है। अगर acc/नाम/फ़ोन में कभी ' आ जाए (जैसे कोई नाम "O'Brien" जैसा,
// या जान-बूझकर बनाया गया data), तो असली bug यही था। पहले JS-string के लिए escape (\ और ' दोनों,
// साथ ही newline), फिर सामान्य HTML-attribute escape (escHtml) — यही सही क्रम है, क्योंकि browser
// पहले HTML entity decode करता है, फिर उस decode हुए टेक्स्ट को JS की तरह चलाता है।
function escJsAttr(s){
  if(!s) return "";
  return escHtml(String(s).replace(/\\/g,"\\\\").replace(/'/g,"\\'").replace(/\n/g,"\\n").replace(/\r/g,"\\r"));
}

// ── एक IVRS/acc का status उस HQ की हर tab में sync ──
// ── हाल के status बदलावों का log — stale sync से वसूली उड़ने से बचाव ──
function _getOps(){try{return JSON.parse(localStorage.getItem("vt_ops")||"{}");}catch(e){return {};}}
function _setOps(o){try{localStorage.setItem("vt_ops",JSON.stringify(o));}catch(e){}}
function recOp(hq,acc,status,paydate,by,at,ts){
  if(!hq||!acc)return;
  var o=_getOps(),now=serverNow();
  Object.keys(o).forEach(function(k){if(now-(o[k].ts||0)>172800000)delete o[k];}); // 48h prune
  o[hq+"|"+String(acc).trim()]={status:status,paydate:paydate||"",by:by||"",at:at||"",ts:ts||now};
  _setOps(o);
}
var _opPushT={};
// बकाया ≤0 auto-fix से बदले records — debounce window में जमा होकर migrated HQ/श्रेणी पर सिर्फ
// इन्हीं का PATCH भेजा जाता है (पूरी array दोबारा नहीं) — हर hq|cat की अपनी अलग जमा-सूची
var _autoFixPatch={}, _autoFixUnsafe={};
var _cutCleaned=0; // इस बार ऐप खुलने से कट-ऑफ़ के कारण "बाकी" हुईं — लॉग के लिए (main.js)
function overlayOps(hq,cat,data){
  var o=_getOps(),applied=0;
  data.forEach(function(x){
    if(!x||!x.acc)return;
    var op=o[hq+"|"+String(x.acc).trim()];
    if(op&&(op.ts||0)>(x.ts||0)&&x.status!==op.status){
      x.status=op.status;x.paydate=op.paydate||"";
      if(op.by){x.updatedBy=op.by;x.updatedAt=op.at;}
      x.ts=op.ts;applied++;
    }
  });
  var key=hq+"|"+cat;
  // बकाया 0 या minus (advance) वाले records अपने आप वसूल — पुराने records पर भी, हमेशा जांचा जाता है
  data.forEach(function(x){
    if(!x||x.status==="paid")return;
    var amt=(x.amount===undefined||x.amount===null)?"":String(x.amount).trim();
    if(amt===""||isNaN(Number(amt)))return;
    if(Number(amt)<=0){
      var now=new Date();
      x.status="paid";
      x.paydate=now.toLocaleDateString("hi-IN");
      x.updatedBy="System (बकाया ≤0 auto)";
      x.updatedAt=now.toLocaleString("hi-IN");
      x.ts=serverNow();
      applied++;
      if(x.acc){ _autoFixPatch[key]=_autoFixPatch[key]||{}; _autoFixPatch[key][String(x.acc)]=x; }
      else _autoFixUnsafe[key]=true; // acc नहीं — patch-key नहीं बन सकता, सुरक्षित array-PUT पर वापस
    }
  });
  // v9.223: मुख्यालय की लेजर कट-ऑफ़ (सर्वर पर, देखें config.js: LEDGER_CUT) से पुरानी "वसूल" सर्वर से आई हो —
  // 14/10 की घटना: किसी फ़ोन की बासी सूची से पिछले माह की वसूली नए लेजर में चढ़ गई थी। अब हर फ़ोन (v9.223+)
  // सर्वर से आई सूची में ऐसी वसूली को "बाकी" करके वापस सर्वर पर भेज देता है — कोई पुराना फ़ोन फिर चढ़ाए तो भी
  // अगली बार साफ़। सिर्फ़ वही जिनकी भुगतान तारीख़ पढ़ी जा सके (तारीख़ ख़ाली/अजीब हो तो छेड़ते नहीं)
  var cut=ledgerCut(hq);
  if(cut) data.forEach(function(x){
    if(!x||x.status!=="paid"||!x.acc) return;
    var pv=latestPayVal(x);
    if(!pv||pv>=cut) return;
    x.status="pending"; x.paydate="";
    x.updatedBy="System (कट-ऑफ़ से पुरानी वसूली हटी)"; x.updatedAt=new Date().toLocaleString("hi-IN");
    x.ts=serverNow();
    applied++; _cutCleaned++;
    _autoFixPatch[key]=_autoFixPatch[key]||{}; _autoFixPatch[key][String(x.acc)]=x;
  });
  if(applied){
    clearTimeout(_opPushT[key]);
    _opPushT[key]=setTimeout(function(){
      var patch=_autoFixPatch[key],unsafe=_autoFixUnsafe[key];
      delete _autoFixPatch[key]; delete _autoFixUnsafe[key];
      // migrated HQ/श्रेणी हो और सभी बदले records का acc मिल गया हो — सिर्फ उन्हीं को PATCH करें
      // (पूरी array PUT करने से चरण 3 का migration यहीं से पलट सकता था — यही असली bug था)
      if(isMigrated(hq,cat)&&!unsafe&&patch&&Object.keys(patch).length){
        fetch(FB+"/"+fbPath(hq,cat)+".json",{
          method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(patch)
        }).catch(function(e){logErr("autopay-patch-fail",e,hq+"/"+cat);});
      } else {
        _fbPut(hq,cat,cGet(hq,cat),null);
      }
    },1500);
  }
  return applied;
}
function propagateStatus(acc,srcCat,status,paydate,dtStr,ts){
  if(!acc) return;
  recOp(activeHQ,acc,status,paydate,CU&&CU.name||"",dtStr,ts);
  for(var i=0;i<CATS_DEFAULT.length;i++){
    var cat=isCatEditable(i)?getCatName(activeHQ,i):CATS_DEFAULT[i];
    if(cat===srcCat) continue;
    var d=cGet(activeHQ,cat);
    if(!d||!d.length) continue;
    var prevSnap=JSON.parse(JSON.stringify(d));
    var changed=false;
    d.forEach(function(x){
      if(x&&x.acc&&String(x.acc).trim()===String(acc).trim()&&x.status!==status){
        x.status=status;
        x.paydate=(status==="paid")?paydate:"";
        x.updatedBy=CU.name; x.updatedAt=dtStr; x.ts=ts;
        changed=true;
      }
    });
    if(changed){ cSet(activeHQ,cat,d); fbSet(activeHQ,cat,d,prevSnap,null); }
  }
}

// ── नया लेजर आने पर पिछले लेजर की बची-खुची वसूली सभी बटनों से हटाएं ──────────────────────
// असली समस्या (JE का सवाल, 28/9): नया लेजर आम तौर पर सिर्फ़ "कुल उपभोक्ता" में अपलोड होता है और
// बाक़ी बटनों में पिछले माह का डेटा पड़ा रह जाता है। अपलोड की तारीख़-कट-ऑफ़ (up-keepfrom) सिर्फ़ उसी
// एक category पर लगती थी — तो "कुल उपभोक्ता" तो ठीक साफ़ हो जाती, पर उसके तुरंत बाद चलने वाला
// reconcileHQ() पुराने बटन में पड़ी पिछले माह की "वसूल" देखकर नियम "किसी एक में वसूल = सब में वसूल"
// लगा देता और वही पुरानी वसूली नए लेजर में लौट आती। नतीजा: जिसने नया बिल जमा नहीं किया वो भी
// "वसूल" दिखता, लाइनमैन उस तक जाता ही नहीं और वसूली चुपचाप छूट जाती — ठीक वही bug जिसे कट-ऑफ़
// से ठीक किया गया था, बस पिछले दरवाज़े से लौटता हुआ।
// अब reconcileHQ से *पहले* हर category से कट-ऑफ़ से पुरानी वसूली हटा दी जाती है, इसलिए लौटने का
// रास्ता ही नहीं बचता — और अगली बार login/tab बदलने पर चलने वाला reconcileHQ (जिसे कट-ऑफ़ पता
// नहीं होती) भी उसे वापस नहीं ला सकता, क्योंकि कहीं बची ही नहीं।
// cut=0 (तारीख़ न चुनी हो) पर कुछ नहीं होता — पुराना व्यवहार जस का तस।
function sweepStalePaid(hq,cut){
  if(!cut) return 0;
  var cleared=0;
  for(var i=0;i<CATS_DEFAULT.length;i++){
    var cat=isCatEditable(i)?getCatName(hq,i):CATS_DEFAULT[i];
    var d=cGet(hq,cat);
    if(!d||!d.length) continue;
    var prevSnap=JSON.parse(JSON.stringify(d));
    var changed=false;
    // जो वसूली यहां मिट रही है उसका backup — checkbox हटाकर अपलोड करने पर पूरे मुख्यालय की
    // वसूली एक साथ मिटती है और पहले ऐप के अंदर वापसी का कोई रास्ता नहीं था। सिर्फ़ मिटने वाले
    // records रखे जाते हैं (पूरी paid सूची नहीं) — देखें database.js: savePaidBackup
    var bk={};
    d.forEach(function(x){
      if(!x||x.status!=="paid") return;
      if(latestPayVal(x)>=cut) return; // इसी लेजर की वसूली — बनी रहे
      // भुगतान तारीख़ ही न हो तो latestPayVal 0 देता है और यह भी हटेगी — वही नियम अपलोड
      // ख़ुद भी लगाता है (upload.js का paidByAcc), इसलिए दोनों जगह एक जैसा व्यवहार
      if(x.acc) bk[String(x.acc).trim()]=paidBkEntry(x);
      x.status="pending";
      x.paydate="";
      x.ts=serverNow();
      changed=true; cleared++;
    });
    if(changed){ savePaidBackup(hq,cat,bk); cSet(hq,cat,d); fbSet(hq,cat,d,prevSnap,null); }
  }
  return cleared;
}

// ── पुराने mismatch ठीक करें: किसी भी tab में paid → हर tab में paid ──
function reconcileHQ(hq){
  var cats=[];
  for(var i=0;i<CATS_DEFAULT.length;i++) cats.push(isCatEditable(i)?getCatName(hq,i):CATS_DEFAULT[i]);
  var paidMap={};
  // v9.223: कट-ऑफ़ से पुरानी वसूली किसी और बटन में पड़ी हो (जैसे बासी सूची) तो उसे नए लेजर में न फैलाएं
  var cut=ledgerCut(hq);
  cats.forEach(function(cat){
    cGet(hq,cat).forEach(function(x){
      if(x&&x.acc&&x.status==="paid"){
        if(cut){ var pv=latestPayVal(x); if(pv&&pv<cut) return; }
        var key=String(x.acc).trim();
        if(!paidMap[key]||((x.ts||0)>(paidMap[key].ts||0)))
          paidMap[key]={paydate:x.paydate||"",by:x.updatedBy||"",at:x.updatedAt||"",ts:x.ts||0};
      }
    });
  });
  var fixed=0;
  cats.forEach(function(cat){
    var d=cGet(hq,cat); var changed=false;
    var prevSnap=JSON.parse(JSON.stringify(d));
    d.forEach(function(x){
      if(x&&x.acc&&x.status!=="paid"&&paidMap[String(x.acc).trim()]){
        var pm=paidMap[String(x.acc).trim()];
        x.status="paid"; x.paydate=pm.paydate;
        if(pm.by){x.updatedBy=pm.by;x.updatedAt=pm.at;}
        x.ts=serverNow();
        changed=true; fixed++;
      }
    });
    if(changed){ cSet(hq,cat,d); fbSet(hq,cat,d,prevSnap,null); }
  });
  return fixed;
}

// idx सिर्फ़ पिछले render के वक्त की स्थिति है — इस बीच background sync से लिस्ट बदल/छोटी हो सकती है
// (जैसे रिमार्क मोडल खुला रहते हुए टाइप करने में लगने वाला वक्त)। इसलिए acc (स्थिर पहचान) से
// पहले ढूंढें, सिर्फ़ acc न मिले (जैसे acc-रहित पुराना record) तभी idx पर भरोसा करें
function _findRecordIdx(d,idx,acc){
  if(acc){
    for(var i=0;i<d.length;i++){
      if(d[i]&&d[i].acc!=null&&String(d[i].acc).trim()===String(acc).trim()) return i;
    }
    return -1; // acc दिया गया था पर अब लिस्ट में नहीं मिला — पुराने idx पर भरोसा करना और खतरनाक होगा
  }
  return d[idx]?idx:-1;
}
function markPaid(idx,acc){
  var d=cGet(activeHQ,activeCat);
  idx=_findRecordIdx(d,idx,acc);
  if(idx<0){toast("यह रिकॉर्ड अब सूची में नहीं मिला — सूची ताज़ा हो गई होगी, दोबारा कोशिश करें","err");return;}
  var prevSnap=JSON.parse(JSON.stringify(d));
  var now=new Date();
  var dateStr=now.toLocaleDateString("hi-IN");
  var dtStr=now.toLocaleString("hi-IN");
  d[idx].status="paid";
  d[idx].paydate=dateStr;
  d[idx].updatedBy=CU.name;
  d[idx].updatedAt=dtStr;
  d[idx].ts=serverNow();
  cSet(activeHQ,activeCat,d);
  renderSummaryWith(d); renderListWith(d);
  toast("✅ वसूली दर्ज! (हर tab में अपडेट)","ok");
  // जश्न सिर्फ़ सजावट है — इसमें कुछ गड़बड़ हो तो वसूली न रुके। एक ही उपभोक्ता पर दिन में एक ही
  // बार, ताकि बार-बार टॉगल करने का लालच न रहे; और हद से ज़्यादा दोहराने पर JE को लॉग में दिखे
  try{
    var _n=_paidMarkCountToday(d[idx].acc);
    if(_n<=1) _celebPaid(d[idx]); // 0 = acc ही नहीं (गिनती नहीं हो सकती) — तब भी जश्न दिखे
    else _warnIfTooManyMarks(_n,d[idx]);
  }catch(e){}
  fbSet(activeHQ,activeCat,d,prevSnap,null);
  propagateStatus(d[idx].acc,activeCat,"paid",dateStr,dtStr,d[idx].ts);
}

function markUnpaid(idx,acc){
  if(!confirm("क्या वाकई इस उपभोक्ता की वसूली वापस 'बाकी' करनी है?")) return;
  var d=cGet(activeHQ,activeCat);
  idx=_findRecordIdx(d,idx,acc);
  if(idx<0){toast("यह रिकॉर्ड अब सूची में नहीं मिला — सूची ताज़ा हो गई होगी, दोबारा कोशिश करें","err");return;}
  var prevSnap=JSON.parse(JSON.stringify(d));
  var dtStr=new Date().toLocaleString("hi-IN");
  d[idx].status="pending";
  d[idx].paydate="";
  d[idx].updatedBy=CU.name;
  d[idx].updatedAt=dtStr;
  d[idx].ts=serverNow();
  cSet(activeHQ,activeCat,d);
  renderSummaryWith(d); renderListWith(d);
  toast("↩ वापस बाकी किया — "+d[idx].name+" (हर tab में)","inf");
  fbSet(activeHQ,activeCat,d,prevSnap,null);
  propagateStatus(d[idx].acc,activeCat,"pending","",dtStr,d[idx].ts);
}

// ── भुगतान तारीख़ (नया लेजर अपलोड करते समय छँटाई के लिए) ─────────────────────
// आदेगांव DC में मीटर रीडिंग 7 तारीख़ तक होती है और नया बिल-लेजर 10 तारीख़ को बनता है — यानी
// 1 से 10 के बीच ऐप में पुराना लेजर ही रहता है। इस बीच दर्ज हुई वसूली नए लेजर में भी बनी रहनी
// चाहिए, पर पिछले माह की वसूली नहीं (वरना जिसने नया बिल जमा नहीं किया वो भी "वसूल" दिखता रहेगा
// और लाइनमैन उस तक जाएगा ही नहीं) — यही छँटाई upload.js का _upKeepCutoff() करता है
function _payVal(s){
  var v=String(s==null?"":s).trim();
  if(!v) return 0;
  return payDateVal(normPayDate(v));
}
// उपभोक्ता की भुगतान तारीख़, तुलना-योग्य अंक (yyyymmdd) में — सिर्फ़ "वसूल" वालों की
function latestPayVal(x){
  if(!x||x.status!=="paid") return 0;
  return _payVal(x.paydate);
}

function clearList(){
  if(!confirm(activeHQ+" › "+activeCat+" की लिस्ट हटाएं?"))return;
  cSet(activeHQ,activeCat,[]);
  renderSummaryWith([]); renderListWith([]);
  toast("🗑️ लिस्ट हटाई गई","inf");
  fbDel(activeHQ,activeCat,null);
}

function openRmkModal(idx,acc){
  var d=cGet(activeHQ,activeCat);
  idx=_findRecordIdx(d,idx,acc);
  if(idx<0){toast("यह रिकॉर्ड अब सूची में नहीं मिला — सूची ताज़ा हो गई होगी, दोबारा कोशिश करें","err");return;}
  var x=d[idx]; if(!x)return;
  x=migrateRemarks(x);
  document.getElementById("rmk-key").value=idx;
  document.getElementById("rmk-acc-key").value=x.acc||"";
  document.getElementById("rmk-name").textContent=x.name;
  document.getElementById("rmk-amt").textContent="₹"+Number(x.amount).toLocaleString("hi-IN")+" बकाया";
  document.getElementById("rmk-acc").textContent="Consumer No: "+x.acc+(x.father?" | पिता/पति: "+x.father:"");
  // New remark textarea always empty
  document.getElementById("rmk-text").value="";
  var dueEl=document.getElementById("rmk-due");
  if(dueEl){ dueEl.value=""; dueEl.min=_isoToday(); dueEl.style.display="none"; }
  _duePick=""; _dueSync();
  (function(){
    var t=new Date();
    var iso=t.getFullYear()+"-"+String(t.getMonth()+1).padStart(2,"0")+"-"+String(t.getDate()).padStart(2,"0");
    var pdEl=document.getElementById("rmk-paydate");
    pdEl.max=iso;
    // stored value ISO हो तो input में दिखाएँ, d/m/y हो तो convert
    var v=x.paydate||"";
    if(/^\d{4}-\d{2}-\d{2}$/.test(v)){pdEl.value=v;}
    else if(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)){
      var pr=v.split("/");
      pdEl.value=pr[2]+"-"+pr[1].padStart(2,"0")+"-"+pr[0].padStart(2,"0");
    } else {pdEl.value="";}
  })();
  setRmkStatus(x.status||"pending");
  // Show previous remarks — v9.234: सब सूचियों से मिलाकर
  var arr=remarksAll(x,activeHQ);
  var sec=document.getElementById("prev-rmk-section");
  var lst=document.getElementById("prev-rmk-list");
  var cnt=document.getElementById("prev-rmk-count");
  if(arr.length){
    cnt.textContent=arr.length;
    var html=arr.slice().reverse().map(function(r){
      // r.cat तभी दिखाएं जब यह किसी और category से propagate होकर आया हो — यहीं (activeCat) में
      // सीधे डाला गया हो तो टैग बेकार/redundant है
      var catTag=(r.cat&&r.cat!==activeCat)?" <span class='prev-rmk-cat'>📁 "+escHtml(r.cat)+"</span>":"";
      return "<div class='prev-rmk-item'>"+
        "<div class='prev-rmk-text'>💬 "+escHtml(r.text)+(r.due?" <b>🤝 "+escHtml(_fmtDue(r.due))+"</b>":"")+catTag+"</div>"+
        "<div class='prev-rmk-meta'>— "+escHtml(r.by)+(r.at?" • "+r.at:"")+"</div>"+
      "</div>";
    }).join("");
    // audit-verified: html ऊपर .map().join() से बना — हर remark में r.text/r.by escHtml() से गुज़रा
    // eslint-disable-next-line no-unsanitized/property
    lst.innerHTML=html;
    sec.style.display="block";
  } else {
    sec.style.display="none";
  }
  document.getElementById("rmk-overlay").classList.add("open");
}
function closeRmkModal(){document.getElementById("rmk-overlay").classList.remove("open");}
function closeRmkOutside(e){if(e.target===document.getElementById("rmk-overlay"))closeRmkModal();}
function setRmkStatus(s){
  rmkStatus=s;
  document.getElementById("rs-pending").className="topt"+(s==="pending"?" sel-pending":"");
  document.getElementById("rs-paid").className="topt"+(s==="paid"?" sel-paid":"");
  document.getElementById("rmk-paydate-grp").style.display=s==="paid"?"block":"none";
  var dg=document.getElementById("rmk-due-grp"); if(dg) dg.style.display=s==="paid"?"none":"block"; // वसूल हो गया तो वादा किस बात का
}
function saveRmk(){
  var idx=parseInt(document.getElementById("rmk-key").value);
  var acc=document.getElementById("rmk-acc-key").value;
  var d=cGet(activeHQ,activeCat);
  // मोडल खुला रहते हुए (टाइप करने के दौरान) background sync से लिस्ट बदल/छोटी हो सकती थी —
  // acc से दोबारा सही record ढूंढें, सिर्फ़ idx पर भरोसा न करें (वरना गलत record में सेव होने
  // या पूरी तरह चुपचाप fail होने का खतरा था — असली bug यही था)
  idx=_findRecordIdx(d,idx,acc);
  if(idx<0){toast("⚠ यह रिकॉर्ड अब सूची में नहीं मिला — मोडल बंद करके दोबारा कोशिश करें","err");return;}
  // वादा-तारीख़ — सिर्फ़ बाकी पर; आज या आगे की ही (बीती तारीख़ का वादा बेमानी)
  var dueEl=document.getElementById("rmk-due");
  var due=(rmkStatus==="pending"&&dueEl&&/^\d{4}-\d{2}-\d{2}$/.test(dueEl.value||""))?dueEl.value:"";
  if(due&&due<_isoToday()){toast("⚠ वादा-तारीख़ आज या आगे की होनी चाहिए","err");return;}
  var prevSnap=JSON.parse(JSON.stringify(d));
  d[idx]=migrateRemarks(d[idx]);
  var now=new Date();
  var dtStr=now.toLocaleString("hi-IN");
  d[idx].status=rmkStatus;
  if(rmkStatus==="paid"){
    var pdv=document.getElementById("rmk-paydate").value; // yyyy-mm-dd from date input
    if(pdv){
      var pdd=new Date(pdv+"T00:00:00");
      var tdy=new Date(); tdy.setHours(0,0,0,0);
      if(isNaN(pdd.getTime())||pdd>tdy) pdd=tdy; // future/गलत date → आज
      d[idx].paydate=pdd.getDate()+"/"+(pdd.getMonth()+1)+"/"+pdd.getFullYear();
    } else {
      d[idx].paydate=now.toLocaleDateString("hi-IN");
    }
  }
  var newText=document.getElementById("rmk-text").value.trim();
  // सिर्फ़ तारीख़ डाली, कुछ लिखा नहीं — तब भी रिमार्क बने (text में तारीख़, ताकि पुराने फ़ोन पर भी दिखे)
  if(due&&!newText) newText="🤝 "+_fmtDue(due)+" को जमा करने का वादा";
  /** रिमार्क की एक entry — due (yyyy-mm-dd) v9.202 से, सिर्फ़ वादे वाले रिमार्क में
   * @type {{text:string, by:string, at:string, cat:string, due?:string}|null} */
  var newEntry=null;
  if(newText){
    if(!d[idx].remarksArr) d[idx].remarksArr=[];
    // cat टैग — यही वजह से बाद में दूसरी category में यह रिमार्क दिखे तो पता चले असल में कहां डाला गया था
    newEntry={text:newText,by:CU.name,at:dtStr,cat:activeCat};
    if(due) newEntry.due=due;
    d[idx].remarksArr.push(newEntry);
    // Keep backward-compat field as latest remark text
    d[idx].remarks=newText;
  }
  d[idx].updatedBy=CU.name;
  d[idx].updatedAt=dtStr;
  d[idx].ts=serverNow();
  cSet(activeHQ,activeCat,d);
  closeRmkModal();
  renderSummaryWith(d); renderListWith(d);
  var total=(d[idx].remarksArr||[]).length;
  toast(due?("✅ रिमार्क सेव — 🤝 "+_fmtDue(due)+" — उस सप्ताह \"इस सप्ताह जमा का वादा\" बटन में दिखेगा"):("✅ रिमार्क सेव! (कुल "+total+")"),"ok");
  fbSet(activeHQ,activeCat,d,prevSnap,null);
  propagateStatus(d[idx].acc,activeCat,rmkStatus,d[idx].paydate||"",dtStr,d[idx].ts);
  // JE की शिकायत: किसी category में डाला कमेंट "कुल उपभोक्ता" में नहीं दिखता था — हर category उसी
  // acc की अपनी अलग कॉपी रखती है, status तो propagateStatus पहले से मिला देता है, पर असली रिमार्क
  // text कभी नहीं। अब नया रिमार्क बाकी सभी categories की उसी acc वाली कॉपी में भी जुड़ता है
  if(newEntry) propagateRemark(d[idx].acc,activeCat,newEntry);
}
// ── हर category में एक ही Consumer No पर पड़ा रिमार्क अब सब जगह (कुल उपभोक्ता समेत) दिखे ──
// एक ही उपभोक्ता (acc) कई categories में अपनी-अपनी अलग कॉपी के तौर पर रहता है (जैसे "कुल उपभोक्ता"
// और JE की बनाई कोई खास सूची, दोनों में एक ही आदमी)। रिमार्क सिर्फ़ जहां डाला गया वहीं की कॉपी में
// रह जाता था। अब हर नया रिमार्क entry अपनी मूल category ({cat:srcCat}) टैग रखता है और उसी acc की
// बाकी सभी categories में भी push हो जाता है — कहीं से भी डाला कमेंट अब हर जगह दिखेगा, और कई अलग
// categories से आए हों तो openRmkModal का 📁 टैग बताएगा हर एक असल में कहां से आया (देखें वहां)
function propagateRemark(acc,srcCat,entry){
  if(!acc||!entry) return;
  for(var i=0;i<CATS_DEFAULT.length;i++){
    var cat=isCatEditable(i)?getCatName(activeHQ,i):CATS_DEFAULT[i];
    if(cat===srcCat) continue;
    var d=cGet(activeHQ,cat);
    if(!d||!d.length) continue;
    var prevSnap=JSON.parse(JSON.stringify(d));
    var changed=false;
    d.forEach(function(x){
      if(x&&x.acc&&String(x.acc).trim()===String(acc).trim()){
        if(!x.remarksArr) x.remarksArr=[];
        x.remarksArr.push(entry);
        x.remarks=entry.text; // backward-compat field — saveRmk जैसा ही
        changed=true;
      }
    });
    if(changed){ cSet(activeHQ,cat,d); fbSet(activeHQ,cat,d,prevSnap,null); }
  }
}


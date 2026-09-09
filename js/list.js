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

function setFilter(btn){
  activeFilter=btn.dataset.f;
  _renderLimit=100;
  document.querySelectorAll(".filter-btn").forEach(function(b){b.className="filter-btn";});
  btn.className="filter-btn active-"+activeFilter;
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
function renderList(){var d=cGet(activeHQ,activeCat);renderListWith(d);}
var _renderLimit=100;
function renderListWith(data){
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
    return matchQ&&(activeFilter==="all"||x.status===activeFilter);
  });
  if(!filtered.length){
    var emptyMsg;
    if(activeFilter==="paid") emptyMsg="अभी कोई वसूली दर्ज नहीं";
    else if(activeFilter==="pending") emptyMsg="सभी वसूली हो चुकी है!";
    else if(q) emptyMsg="कोई परिणाम नहीं";
    else emptyMsg="सूची खाली है";
    var emptyIco=activeFilter==="paid"?"✅":activeFilter==="pending"?"⏳":(q?"🔍":"📋");
    var emptySub=(!q&&activeFilter==="all")?"📤 अपलोड बटन से लिस्ट डालें":"🔍 खोज या फ़िल्टर बदलें";
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
    var remarksArr=x.remarksArr||[];
    var rmkHtml="";
    if(remarksArr.length){
      rmkHtml="<div class='cc-rmk-list'>";
      remarksArr.slice().reverse().forEach(function(r){
        rmkHtml+="<div class='cc-rmk-item'><span>💬 "+escHtml(r.text)+"</span><span class='cc-rmk-by'>— "+escHtml(r.by)+(r.at?" • "+r.at:"")+"</span></div>";
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
    return "<div class='con-card "+(isPaid?"paid":"pending")+"'>"+
      "<div class='cc-top'><div class='cc-name'>"+escHtml(x.name)+(x.father?" / "+escHtml(x.father):"")+"</div><div class='cc-rank'>#"+(oi+1)+"</div></div>"+
      "<div class='cc-amt'>₹"+Number(x.amount).toLocaleString("hi-IN")+" <span>बकाया</span></div>"+
      "<div class='cc-chips'>"+
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

// ── पुराने mismatch ठीक करें: किसी भी tab में paid → हर tab में paid ──
function reconcileHQ(hq){
  var cats=[];
  for(var i=0;i<CATS_DEFAULT.length;i++) cats.push(isCatEditable(i)?getCatName(hq,i):CATS_DEFAULT[i]);
  var paidMap={};
  cats.forEach(function(cat){
    cGet(hq,cat).forEach(function(x){
      if(x&&x.acc&&x.status==="paid"){
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
// ── वसूली दर्ज होने पर छोटा जश्न ──────────────────────────────────────────────
// यह पूरी तरह device के अंदर की चीज़ है — कोई image/font/library/network call नहीं, इसलिए
// Firebase की bandwidth या billing पर एक बाइट का भी असर नहीं (JE की शर्त: कॉस्ट न बढ़े)।
// जान-बूझकर pointer-events:none और अपने आप हट जाना — लाइनमैन एक के बाद एक कई वसूली दर्ज
// करता है, जश्न उसका काम एक पल के लिए भी रोके नहीं
// 1700ms रखा था, पर JE ने बताया कि उतने में जश्न "समझ ही नहीं आ पाता" — पलक झपकते ही चला
// जाता था। अब इतना कि ताली, अंगूठा और नाम तीनों ठीक से दिख जाएँ, फिर भी काम रुके नहीं
// (pointer-events:none है, यानी नीचे की लिस्ट पूरे समय दबाई जा सकती है)
var CELEB_MS=3900;
// आज इस कर्मचारी ने अब तक कितनी वसूली की — सिर्फ़ device के अपने cache से गिनती, कोई fetch नहीं।
// एक ही उपभोक्ता कई श्रेणियों में होता है (propagateStatus हर जगह status copy कर देता है),
// इसलिए acc से dedup ज़रूरी — वरना एक वसूली 8 गिनी जाती
function _celebTodayCount(hq){
  var today=new Date().toLocaleDateString("hi-IN");
  var me=_dvNameKeySafe(CU&&CU.name);
  var seen={},n=0;
  for(var i=0;i<CATS_DEFAULT.length;i++){
    var cat=isCatEditable(i)?getCatName(hq,i):CATS_DEFAULT[i];
    var d=cGet(hq,cat);
    if(!d||!d.length) continue;
    for(var j=0;j<d.length;j++){
      var x=d[j];
      if(!x||x.status!=="paid"||!x.acc) continue;
      if(x.paydate!==today) continue;
      if(me&&_dvNameKeySafe(x.updatedBy)!==me) continue;
      var k=String(x.acc).trim();
      if(seen[k]) continue;
      seen[k]=1; n++;
    }
  }
  return n;
}
// logger.js का _dvNameKey यहां भी चाहिए, पर वह फ़ाइल cache न हुई हो (weak network) तो
// पूरा markPaid न टूटे — इसलिए सुरक्षित wrapper
function _dvNameKeySafe(n){
  try{ return _dvNameKey(n); }
  catch(e){ return String(n==null?"":n).trim().toLowerCase(); }
}
// ── जश्न की आवाज़ ────────────────────────────────────────────────────────────────────────────
// पहले सब कुछ फ़ोन के अंदर ही बनाया जाता था (Web Audio), ताकि एक बाइट भी डाउनलोड न हो। पर JE ने
// सुनकर बताया कि बनाई हुई तालियाँ असली नहीं लगतीं ("तालियां सही नहीं आ रही हैं") — और वह सही था:
// असली तालियों की बनावट (हर व्यक्ति की अलग ताली, कमरे की गूँज, भीड़ का घनत्व) संश्लेषण से नहीं आती।
// इसलिए अब तीन असली रिकॉर्डिंग इस्तेमाल होती हैं। JE ने जो फ़ाइलें दीं वे कुल 1.88 MB की थीं
// (तालियाँ अकेले 54 सेकंड / 1.7 MB) — उन्हें काटकर, mono करके, आवाज़ बराबर करके 63 KB कर दिया गया:
//   sounds/clap.mp3  4.0s  28 KB   (54s में से सबसे तेज़ 4 सेकंड, दोनों सिरों पर fade)
//   sounds/wow1.mp3  1.9s  13 KB   (पुरुष स्वर)
//   sounds/wow2.mp3  3.0s  21 KB   (महिला स्वर)
// खर्च का हिसाब: ये Netlify से आती हैं, Firebase से नहीं — यानी रोज़ाना 360 MB वाले download
// quota पर इनका कोई असर नहीं। हर device इन्हें ज़िंदगी में एक बार उतारता है और service worker
// उन्हें रख लेता है; आवाज़ बंद हो तो उतरती ही नहीं (नीचे _sndWarm देखें)।
// ध्यान: मोबाइल ब्राउज़र बिना उपयोगकर्ता के छूए आवाज़ नहीं चलने देते — यहां दिक़्क़त नहीं, क्योंकि
// "✓ वसूल" दबाना खुद एक tap है। फ़ोन silent पर हो तो (ख़ासकर iPhone) आवाज़ नहीं आएगी — यह
// ब्राउज़र की सीमा है, इसमें कुछ किया नहीं जा सकता
var _ac=null;
function _celebAudioCtx(){
  if(_ac) return _ac;
  try{
    var C=window.AudioContext||window.webkitAudioContext;
    if(!C) return null;
    _ac=new C();
  }catch(e){ return null; }
  return _ac;
}
// ── असली रिकॉर्डिंग: एक बार उतरे, फिर हमेशा memory से बजे ────────────────────────────────────
// हर फ़ाइल ज़्यादा से ज़्यादा एक बार माँगी जाती है (चाहे नाकाम ही क्यों न हो) — कमज़ोर नेट पर
// बार-बार कोशिश करके डेटा बर्बाद न हो। decode किया हुआ AudioBuffer memory में रहता है
var SND_SRC={clap:"sounds/clap.mp3",wow1:"sounds/wow1.mp3",wow2:"sounds/wow2.mp3"};
var _sndBuf={}, _sndTried={};
function _sndLoad(key){
  if(_sndTried[key]) return;          // एक ही कोशिश — नाकाम रही तो बनी हुई आवाज़ चल जाएगी
  _sndTried[key]=true;
  var ctx=_celebAudioCtx(); if(!ctx||!SND_SRC[key]) return;
  fetch(SND_SRC[key]).then(function(r){
    if(!r.ok) throw new Error("HTTP "+r.status);
    return r.arrayBuffer();
  }).then(function(ab){
    return new Promise(function(res,rej){
      // पुराने Safari का decodeAudioData Promise नहीं लौटाता — दोनों तरीक़े संभाले
      var p=ctx.decodeAudioData(ab,function(b){res(b);},function(e){rej(e);});
      if(p&&p.then) p.then(res,rej);
    });
  }).then(function(b){ _sndBuf[key]=b; }).catch(function(){});
}
// आवाज़ चालू हो तभी उतारें — बंद रखने वाले device पर एक बाइट भी खर्च न हो
function _sndWarm(){
  try{ if(!celebSoundOn()) return; }catch(e){ return; }
  Object.keys(SND_SRC).forEach(_sndLoad);
}
function _sndPlay(key,t,gain,dur){
  var ctx=_celebAudioCtx(); if(!ctx) return false;
  var b=_sndBuf[key];
  if(!b){ _sndLoad(key); return false; } // अभी तैयार नहीं — caller बनी हुई आवाज़ पर लौट जाए
  var src=ctx.createBufferSource(); src.buffer=b;
  var g=ctx.createGain(); g.gain.value=gain;
  // तय समय पर धीरे-धीरे बंद, ताकि जश्न ख़त्म होने के बाद आवाज़ लटकी न रह जाए
  var end=t+Math.min(dur,b.duration);
  g.gain.setValueAtTime(gain,Math.max(t,end-0.5));
  g.gain.exponentialRampToValueAtTime(0.0001,end);
  src.connect(g); g.connect(ctx.destination);
  src.start(t); src.stop(end+0.02);
  return true;
}
// एक ताली = बहुत छोटा शोर का झटका, जो तुरंत बुझ जाए।
// फ़िल्टर पहले bandpass (1400Hz, Q 0.8) था — वह ताली की ज़्यादातर ऊर्जा छान देता था, इसलिए
// दबी-सी "टिक" सुनाई देती थी। असली ताली चौड़े बैंड की होती है, इसलिए अब highpass:
// नीचे की गड़गड़ न रहे, पर ऊपर का पूरा कड़कपन बचा रहे
function _clapAt(ctx,t,gain){
  var len=Math.floor(ctx.sampleRate*0.055);
  var buf=ctx.createBuffer(1,len,ctx.sampleRate);
  var ch=buf.getChannelData(0);
  for(var i=0;i<len;i++){
    var d=1-(i/len);
    ch[i]=(Math.random()*2-1)*d*d*d; // तेज़ी से बुझता शोर — यही ताली जैसा सुनाई देता है
  }
  var src=ctx.createBufferSource(); src.buffer=buf;
  var hp=ctx.createBiquadFilter(); hp.type="highpass"; hp.frequency.value=900;
  var g=ctx.createGain(); g.gain.value=gain;
  src.connect(hp); hp.connect(g); g.connect(ctx.destination);
  src.start(t);
}
// भीड़ की गड़गड़ाहट — दर्जनों तालियाँ आपस में गुंथी हुईं। हर ताली के लिए अलग BufferSource बनाना
// सस्ते फ़ोन पर भारी पड़ता, इसलिए पूरी गड़गड़ाहट *एक ही* buffer में सीधे लिख दी जाती है:
// यादृच्छिक समय पर सैकड़ों छोटे-छोटे झटके, ऊपर से चढ़ता-उतरता लिफ़ाफ़ा (पहले भीड़ जुड़ती है,
// फिर धीमी पड़ती है)। एक buffer + एक source = एक ही आवाज़, पर खर्च नाम-मात्र
function _applauseBed(ctx,t,dur,gain){
  var sr=ctx.sampleRate, len=Math.floor(sr*dur);
  var buf=ctx.createBuffer(1,len,sr);
  var ch=buf.getChannelData(0);
  var hits=Math.floor(dur*150);           // ~150 ताली प्रति सेकंड (कई लोग एक साथ)
  var burst=Math.floor(sr*0.028);
  for(var h=0;h<hits;h++){
    var at=Math.floor(Math.random()*(len-burst));
    // लिफ़ाफ़ा: शुरू में तेज़ी से चढ़े, अंत तक धीरे-धीरे उतरे
    var pos=at/len;
    var env=pos<0.18?(pos/0.18):(1-(pos-0.18)/0.82*0.85);
    var amp=(0.35+Math.random()*0.65)*env;
    for(var i=0;i<burst;i++){
      var d=1-(i/burst);
      ch[at+i]+=(Math.random()*2-1)*d*d*amp*0.06;
    }
  }
  var src=ctx.createBufferSource(); src.buffer=buf;
  var hp=ctx.createBiquadFilter(); hp.type="highpass"; hp.frequency.value=700;
  var lp=ctx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=9000;
  var g=ctx.createGain(); g.gain.value=gain;
  src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(ctx.destination);
  src.start(t);
}
// "वाह!" — भीड़ की चीयर। असली इंसानी आवाज़ के लिए कोई audio फ़ाइल डाउनलोड करनी पड़ती, इसलिए
// यहाँ स्वर-ध्वनि बनाई गई है: शोर को दो formant फ़िल्टरों से गुज़ारा जाता है जिनकी आवृत्ति
// "ऊ → आ → ऊ" की तरह घूमती है — कान इसे भीड़ के "वाआआओ" जैसा सुनता है। पूरी तरह मुफ़्त
function _cheerAt(ctx,t,dur,gain){
  var sr=ctx.sampleRate, len=Math.floor(sr*dur);
  var buf=ctx.createBuffer(1,len,sr);
  var ch=buf.getChannelData(0);
  for(var i=0;i<len;i++) ch[i]=Math.random()*2-1;
  var src=ctx.createBufferSource(); src.buffer=buf;
  // F1/F2 — स्वर बनाने वाले दो अनुनाद; इन्हीं के चलने से "वाओ" जैसा लगता है
  var f1=ctx.createBiquadFilter(); f1.type="bandpass"; f1.Q.value=7;
  var f2=ctx.createBiquadFilter(); f2.type="bandpass"; f2.Q.value=9;
  f1.frequency.setValueAtTime(360,t);
  f1.frequency.linearRampToValueAtTime(760,t+dur*0.42);
  f1.frequency.linearRampToValueAtTime(430,t+dur);
  f2.frequency.setValueAtTime(820,t);
  f2.frequency.linearRampToValueAtTime(1350,t+dur*0.42);
  f2.frequency.linearRampToValueAtTime(950,t+dur);
  var g=ctx.createGain();
  g.gain.setValueAtTime(0,t);
  g.gain.linearRampToValueAtTime(gain,t+dur*0.22);     // भीड़ का स्वर चढ़ता है
  g.gain.setValueAtTime(gain,t+dur*0.55);
  g.gain.exponentialRampToValueAtTime(0.0001,t+dur);   // फिर धीरे-धीरे बैठ जाता है
  src.connect(f1); f1.connect(f2); f2.connect(g); g.connect(ctx.destination);
  src.start(t); src.stop(t+dur+0.02);
}
function _dingAt(ctx,t,freq,dur,gain){
  var o=ctx.createOscillator(); o.type="sine"; o.frequency.value=freq;
  var g=ctx.createGain();
  g.gain.setValueAtTime(0,t);
  g.gain.linearRampToValueAtTime(gain,t+0.015);
  g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
  o.connect(g); g.connect(ctx.destination);
  o.start(t); o.stop(t+dur+0.02);
}
function _celebSound(big){
  if(!celebSoundOn()) return;
  var ctx=_celebAudioCtx();
  if(!ctx) return;
  try{ if(ctx.state==="suspended") ctx.resume(); }catch(e){}
  var t=ctx.currentTime+0.01;
  var dur=big?3.4:3.0;
  // 1) तालियाँ — असली रिकॉर्डिंग; न उतरी हो तो बनी हुई गड़गड़ाहट पर लौट जाओ
  if(!_sndPlay("clap",t,big?1:0.85,dur)){
    _applauseBed(ctx,t,dur,big?0.85:0.7);
    var claps=big?14:10;
    for(var i=0;i<claps;i++) _clapAt(ctx,t+0.02+i*0.115+Math.random()*0.035,(big?0.5:0.42)*(1-i/(claps*1.6)));
  }
  // 2) "वाओ" — दो असली आवाज़ें (पुरुष/महिला), हर बार यादृच्छिक, ताकि रोज़ सुनकर मन न भरे।
  // दोनों में से जो तैयार हो वही; कोई न हो तो बनी हुई चीयर
  var pick=Math.random()<0.5?"wow1":"wow2", other=pick==="wow1"?"wow2":"wow1";
  if(!_sndPlay(pick,t+0.18,0.95,dur-0.18) && !_sndPlay(other,t+0.18,0.95,dur-0.18)){
    _cheerAt(ctx,t+0.12,dur*0.72,big?0.5:0.42);
  }
  // 3) चढ़ती घंटी — हर 10वीं वसूली पर एक सुर ज़्यादा
  _dingAt(ctx,t+0.14,784,0.30,0.10);    // G5
  _dingAt(ctx,t+0.30,1046.5,0.36,0.09); // C6
  if(big){ _dingAt(ctx,t+0.46,1318.5,0.48,0.09); _dingAt(ctx,t+0.66,1568,0.6,0.08); } // E6, G6
}

// ── एक उपभोक्ता पर दिन में एक ही बार जश्न ─────────────────────────────────────
// जश्न खुद एक बाइट नेटवर्क खर्च नहीं करता, पर वह बार-बार "✓ वसूल ↔ ↩ वापस बाकी" दबाने का
// लालच पैदा करता है — और *वह* महंगा है: हर मार्क Firebase पर लिखा जाता है, propagateStatus
// उसे हर उस श्रेणी में भी लिखता है जिसमें वही उपभोक्ता है, और हर लिखाई बाक़ी जुड़े फ़ोनों पर
// push होती है (यही download quota में गिनती है)। इसलिए दोबारा मार्क करने पर जश्न नहीं दिखता —
// लालच ही न रहे। सिर्फ़ आज का हिसाब रखा जाता है, ताकि यह सूची बढ़ती न जाए
var CELEB_DONE_KEY="dc_celebdone";
function _celebDoneToday(){
  var today=new Date().toLocaleDateString("hi-IN");
  var o=null;
  try{ o=JSON.parse(localStorage.getItem(CELEB_DONE_KEY)); }catch(e){}
  if(!o||typeof o!=="object"||o.d!==today) o={d:today,a:{}}; // दिन बदला — कल का हिसाब भूल जाओ
  if(!o.a||typeof o.a!=="object") o.a={};
  return o;
}
// आज इस उपभोक्ता को कितनी बार "वसूल" मार्क किया जा चुका है — गिनती बढ़ाकर नई संख्या लौटाता है।
// यही एक गिनती दो काम करती है: (1) जश्न सिर्फ़ पहली बार, (2) हद से ज़्यादा टॉगल होने पर चेतावनी
function _paidMarkCountToday(acc){
  var key=String(acc==null?"":acc).trim();
  if(!key) return 0; // acc ही नहीं — गिनने का कोई ज़रिया नहीं
  var o=_celebDoneToday();
  var n=(Number(o.a[key])||0)+1;
  o.a[key]=n;
  try{ localStorage.setItem(CELEB_DONE_KEY,JSON.stringify(o)); }catch(e){}
  return n;
}
// पहली बार हो तो true; उसी उपभोक्ता पर दोबारा हो तो false
function _celebFirstTimeToday(acc){
  var key=String(acc==null?"":acc).trim();
  if(!key) return true; // acc नहीं है तो रोकने का कोई आधार नहीं — जश्न दिखा दो
  return _paidMarkCountToday(key)===1;
}

// ── हद से ज़्यादा टॉगल पर JE को पता चले ────────────────────────────────────────
// एक ही उपभोक्ता को दिन में इतनी बार "वसूल" मार्क करना सामान्य काम में नहीं होता — असली सुधार
// एक-दो बार में हो जाता है। इससे ज़्यादा का मतलब है या तो कोई गड़बड़ी है या कोई जान-बूझकर
// बार-बार दबा रहा है। यह रोकता नहीं (हो सकता है कोई असली वजह हो), सिर्फ़ एक बार लॉग करता है
// ताकि JE को "एरर लॉग" में दिख जाए कि कौन, किस उपभोक्ता पर, कितनी बार।
// हर मार्क Firebase पर लिखा जाता है और बाक़ी जुड़े फ़ोनों पर push होता है — इसीलिए यह
// bandwidth का सवाल भी है, सिर्फ़ अनुशासन का नहीं
var TOGGLE_WARN_AT=4;
function _warnIfTooManyMarks(n,rec){
  if(n!==TOGGLE_WARN_AT) return; // ठीक इसी गिनती पर, यानी दिन में एक ही बार लॉग हो
  try{
    logErr("repeat-mark",
      "एक ही उपभोक्ता को आज "+n+" बार 'वसूल' मार्क किया गया — "+
      ((rec&&rec.name)||"(नाम नहीं)")+" (क्र. "+((rec&&rec.acc)||"?")+")। "+
      "हर बार Firebase पर लिखा जाता है और बाक़ी फ़ोनों पर भेजा जाता है, इसलिए बेवजह दोहराने से "+
      "डेटा-खर्च बढ़ता है। ज़रूरी हो तो संबंधित कर्मचारी से पूछ लें।",
      activeHQ+"/"+activeCat);
  }catch(e){}
}

function _celebPaid(rec){
  if(typeof document==="undefined") return;
  var old=document.getElementById("celeb");
  if(old) old.parentNode.removeChild(old); // पिछला जश्न अभी चल रहा हो तो उसे हटाकर नया
  var wrap=document.createElement("div");
  wrap.className="celeb"; wrap.id="celeb";
  var n=_celebTodayCount(activeHQ);
  var amt=Number(rec&&rec.amount)||0; // असली field "amount" है (देखें renderListWith का cc-amt)
  var name=(CU&&CU.name)||"";
  // हर 10वीं वसूली पर थोड़ा बड़ा जश्न — दिन भर एक ही चीज़ देखकर मन न भरे
  var big=(n>0&&n%10===0);
  var card=document.createElement("div");
  card.className="celeb-card";
  // मैस्कॉट — icons/mascot.webp सिर्फ़ 8.5 KB है और service worker से एक बार cache हो जाती है
  // (Netlify से आती है, Firebase से नहीं — रोज़ाना download quota पर इसका कोई असर नहीं)।
  // किसी पुराने फ़ोन पर WebP न चले तो चुपचाप छुप जाती है — जश्न फिर भी पूरा दिखता है
  var mrow=document.createElement("div"); mrow.className="celeb-mrow";
  var hL=document.createElement("span"); hL.className="celeb-clap l"; hL.textContent="👏";
  var img=document.createElement("img");
  img.className="celeb-mascot"; img.src="icons/mascot.webp"; img.alt=""; img.width=76; img.height=76;
  img.onerror=function(){ this.style.display="none"; };
  var hR=document.createElement("span"); hR.className="celeb-clap r"; hR.textContent="👏";
  mrow.appendChild(hL); mrow.appendChild(img); mrow.appendChild(hR);
  card.appendChild(mrow);
  // अंगूठा + मुख्य इमोजी एक ही पंक्ति में — JE ने कहा "अंगूठा भी दिखना चाहिए"।
  // दोनों फ़ोन के अपने font से आते हैं, यानी शून्य डाउनलोड
  var e=document.createElement("div"); e.className="celeb-emoji";
  var thumb=document.createElement("span"); thumb.className="celeb-thumb"; thumb.textContent="👍";
  var mainE=document.createElement("span"); mainE.textContent=big?"🏆":"🎉";
  e.appendChild(thumb); e.appendChild(mainE);
  var nm=document.createElement("div"); nm.className="celeb-name";
  nm.textContent=(big?"शाबाश ":"शानदार ")+name+"!";
  var sub=document.createElement("div"); sub.className="celeb-sub";
  sub.textContent=(amt?("₹"+amt.toLocaleString("hi-IN")+" वसूल"):"वसूली दर्ज")+(n?(" • आज की "+n+"वीं"):"");
  // textContent इस्तेमाल किया गया है, innerHTML नहीं — नाम/रकम कहीं भी HTML बनकर नहीं जाते
  card.appendChild(e); card.appendChild(nm); card.appendChild(sub);
  wrap.appendChild(card);
  var colors=["#00c896","#ffb300","#42a5f5","#ec407a","#ab47bc"];
  var bits=big?22:14; // गिनती जान-बूझकर कम — सस्ते फ़ोन पर भी अटके नहीं
  for(var i=0;i<bits;i++){
    var b=document.createElement("div");
    b.className="celeb-bit";
    b.style.left=(Math.random()*100)+"%";
    b.style.background=colors[i%colors.length];
    b.style.animationDelay=(Math.random()*0.35)+"s";
    wrap.appendChild(b);
  }
  document.body.appendChild(wrap);
  try{_celebSound(big);}catch(e){} // आवाज़ न चल पाए तो भी दिखने वाला जश्न न रुके
  setTimeout(function(){ if(wrap.parentNode) wrap.parentNode.removeChild(wrap); },CELEB_MS+400);
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

// सभी 6 HQ में घरेलू/व्यवसाय/कृषि/गवर्नमेंट का पुराना unused data एक साथ मिटाना — नाम से मिलान
// (index से नहीं), ताकि किसी HQ में यह slot rename होकर असल में इस्तेमाल हो रहा हो (जैसे किसी को
// "3 MONTH NON PAYEE" कर दिया गया हो) तो वह गलती से न मिटे। मक़सद: login-prefetch और हर रिफ्रेश
// (आज की वसूली/ग्राम-वार वसूली/स्कोरकार्ड) हल्का करना — यह सभी categories का data पढ़ते हैं
var CLEAR_OLD_CATS=["घरेलू","व्यवसाय","कृषि","गवर्नमेंट"];
function clearOldCategoriesData(){
  if(!CU||CU.role!=="supervisor"){toast("सिर्फ JE यह कर सकते हैं","err");return;}
  var jobs=[];
  HQS.forEach(function(hq){
    for(var i=0;i<CATS_DEFAULT.length;i++){
      var cat=isCatEditable(i)?getCatName(hq,i):CATS_DEFAULT[i];
      if(CLEAR_OLD_CATS.indexOf(cat)>-1) jobs.push({hq:hq,cat:cat});
    }
  });
  if(!jobs.length){toast("मिटाने लायक कोई category नहीं मिली (शायद पहले से rename/खाली हैं)","inf");return;}
  var list=jobs.map(function(j){return j.hq+" › "+j.cat;}).join("\n");
  if(!confirm("⚠️ यह सभी मुख्यालयों में ये categories हमेशा के लिए मिटा देगा:\n\n"+list+"\n\nयह वापस नहीं हो सकता (पहले backup ज़रूर ले लें)। जारी रखें?"))return;
  var done=0;
  jobs.forEach(function(j){
    if(j.hq===activeHQ&&j.cat===activeCat){ cSet(j.hq,j.cat,[]); renderSummaryWith([]); renderListWith([]); }
    fbDel(j.hq,j.cat,function(){
      done++;
      if(done===jobs.length) toast("🗑️ "+jobs.length+" categories मिटा दी गईं","ok");
    });
  });
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
  // Show previous remarks
  var arr=x.remarksArr||[];
  var sec=document.getElementById("prev-rmk-section");
  var lst=document.getElementById("prev-rmk-list");
  var cnt=document.getElementById("prev-rmk-count");
  if(arr.length){
    cnt.textContent=arr.length;
    var html=arr.slice().reverse().map(function(r){
      return "<div class='prev-rmk-item'>"+
        "<div class='prev-rmk-text'>💬 "+escHtml(r.text)+"</div>"+
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
  if(newText){
    if(!d[idx].remarksArr) d[idx].remarksArr=[];
    d[idx].remarksArr.push({text:newText,by:CU.name,at:dtStr});
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
  toast("✅ रिमार्क सेव! (कुल "+total+")","ok");
  fbSet(activeHQ,activeCat,d,prevSnap,null);
  propagateStatus(d[idx].acc,activeCat,rmkStatus,d[idx].paydate||"",dtStr,d[idx].ts);
}


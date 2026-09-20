// ── सभी स्कोरकार्ड variants — reports.js से अलग किया गया (structure सुधार, reports.js में
// फ़ोन-एक्शन/Consumer-No/backup जैसे अलग-अलग concerns के साथ मिलकर यह बहुत बड़ी हो चुकी थी) ──

// ─── SCORECARD ───────────────────────────────────────────────
var scActiveHQ = "";

function openScorecard(){
  if(!CU||CU.role!=="supervisor"){toast("सिर्फ JE स्कोरकार्ड देख सकते हैं","err");return;}
  scActiveHQ = activeHQ;
  document.getElementById("sc-overlay").classList.add("open");
  buildScorecard();
}
function closeScModal(){document.getElementById("sc-overlay").classList.remove("open");}
function closeScOutside(e){if(e.target===document.getElementById("sc-overlay"))closeScModal();}

function buildScorecard(){
  // Build HQ tabs
  var tabsEl=document.getElementById("sc-hq-tabs");
  tabsEl.innerHTML="";
  var hqs=CU.role==="supervisor"?HQS:[CU.hq];
  hqs.forEach(function(hq){
    var b=document.createElement("button");
    b.className="sc-tab"+(hq===scActiveHQ?" active":"");
    b.textContent=hq;
    b.onclick=function(){
      scActiveHQ=hq;
      document.querySelectorAll(".sc-tab").forEach(function(x){x.classList.remove("active");});
      b.classList.add("active");
      renderScBody();
    };
    tabsEl.appendChild(b);
  });
  // Build overview (all HQs summary from cache)
  buildScOverview([scActiveHQ]);
  renderScBody();
}

function buildScOverview(hqs){
  var el=document.getElementById("sc-overview");
  var totAmt=0,totCons=0;
  var allPaidAccs={}; // hq+acc → true (unique paid consumer)
  var allAccs={};     // hq+acc → true (unique total consumer from CATS[0])
  hqs.forEach(function(hq){
    // कुल उपभोक्ता — सिर्फ CATS[0] से unique acc count
    var consData=cGet(hq,CATS[0]);
    consData.forEach(function(x){ if(x.acc) allAccs[hq+"||"+x.acc]=true; else totCons++; });
    // paid — सभी categories से unique acc, पर सिर्फ वही जो "कुल उपभोक्ता" (मास्टर) सूची में भी हों
    // (वरना ग्राम-वार वसूली/स्कोरकार्ड डिस्प्ले से संख्या मेल नहीं खाती — देखें _waScRow का वही सुधार)
    CATS.forEach(function(cat){
      var d=cGet(hq,cat);
      d.forEach(function(x){
        if(x.status==="paid"){
          var key=hq+"||"+(x.acc||Math.random());
          if(x.acc&&!allAccs[key])return;
          // कुछ उपभोक्ताओं का "बकाया" ऋणात्मक होता है (advance/credit balance — ज़्यादा जमा कर चुके,
          // बकायादार नहीं) — असली फ़ाइल में यह value वैसे ही रहनी चाहिए, पर "वसूल राशि" के जोड़ में
          // उसे घटाव के तौर पर शामिल करना ग़लत है ("negative पैसा वसूलना" बेमानी है, और वह दूसरे सही
          // उपभोक्ताओं की वसूली छुपा देता है — 11/9 को पिंडरई में ठीक यही हुआ, कुल राशि ही negative
          // दिख गई)। गिनती (count) में ऐसे उपभोक्ता फिर भी शामिल हैं — असल में उनका कुछ बकाया नहीं,
          // इसलिए "वसूल"/निपटा हुआ मानना ही सही है, सिर्फ़ राशि के जोड़ में उनका योगदान 0 माना जाता है
          if(!allPaidAccs[key]){ allPaidAccs[key]=true; totAmt+=Math.max(0,Number(x.amount)||0); }
        }
      });
    });
  });
  totCons+=Object.keys(allAccs).length;
  var totPaid=Object.keys(allPaidAccs).length;
  var totPend=totCons-totPaid;
  // पहले negative a पर सीधे "₹"+a जुड़ जाता — चूंकि >=100000/>=1000 दोनों जांच negative पर हमेशा
  // झूठी निकलती हैं, raw floating-point number दिख जाता था (जैसे "₹-60996.990000000005") — असली
  // production में यही दिखा (11/9 वाला advance/credit balance मामला)। अब |a| पर तय होता है L/K/सादा
  // दिखे, चिह्न (-) अलग से आगे जुड़ता है — negative पर भी उतनी ही साफ़ formatting मिलती है
  var fmt=function(a){
    var neg=a<0,v=Math.abs(a);
    var s=v>=100000?(v/100000).toFixed(1)+"L":v>=1000?(v/1000).toFixed(1)+"K":v.toFixed(0);
    return (neg?"-":"")+"₹"+s;
  };
  // audit-verified: totCons/totPaid/totPend/fmt(totAmt) सब संख्या हैं, कोई free-text field नहीं
  // eslint-disable-next-line no-unsanitized/property
  el.innerHTML=
    "<div class='sc-ov-box'><div class='sc-ov-num'>"+totCons+"</div><div class='sc-ov-lbl'>कुल उपभोक्ता</div></div>"+
    "<div class='sc-ov-box'><div class='sc-ov-num' style='color:var(--green)'>"+totPaid+"</div><div class='sc-ov-lbl'>✅ वसूल</div></div>"+
    "<div class='sc-ov-box'><div class='sc-ov-num' style='color:var(--red)'>"+totPend+"</div><div class='sc-ov-lbl'>⏳ बाकी</div></div>"+
    "<div class='sc-ov-box'><div class='sc-ov-num' style='color:var(--gold)'>"+fmt(totAmt)+"</div><div class='sc-ov-lbl'>वसूल राशि</div></div>";
}

// सबसे पहले cache से तुरंत दिखाएं (पुराना तरीका — हर category पर बिना cooldown के fbGet() — खोलने
// और मॉडल के अंदर हर HQ-tab बदलने पर 8 categories बार-बार डाउनलोड करता था, कोई रोक-टोक नहीं थी;
// असली bandwidth bug यही था, header/bottom-nav का सबसे प्रमुख बटन होने से सबसे ज़्यादा असर यहीं से)।
// अब background refresh भी _cashRefreshAll() से होता है, जो 5-मिनट cooldown पहले से देता है —
// तो बार-बार खोलने/tab बदलने पर भी असल network call ज़्यादा से ज़्यादा हर 5 मिनट में एक बार ही हो
function _scBodyFromCache(){
  var combined=[];
  for(var i=0;i<CATS_DEFAULT.length;i++){
    var cat=isCatEditable(i)?getCatName(scActiveHQ,i):CATS_DEFAULT[i];
    combined=combined.concat(cGet(scActiveHQ,cat));
  }
  renderScDateTable(combined);
}
function renderScBody(){
  var hdr=document.getElementById("sc-date-hdr");
  hdr.textContent="📅 "+scActiveHQ+" — दिनांक-वार वसूली (चालू चक्र: "+_scCycleWindow().label+")";
  _scBodyFromCache();
  if(!navigator.onLine) return;
  _cashRefreshAll([scActiveHQ],function(){
    var fx=reconcileHQ(scActiveHQ);
    if(fx) toast("🔁 "+fx+" record का status हर tab में मिलाया","inf");
    _scBodyFromCache();
    buildScOverview([scActiveHQ]);
  });
}

// ── "दिनांक-वार वसूली" चालू बिलिंग-चक्र खिड़की ────────────────────────────────────────────────
// JE का बग रिपोर्ट: यह तालिका पुराने महीनों (जुलाई/अगस्त) की वसूली भी गिन लेती थी, जिससे चालू
// चक्र की प्रगति भ्रामक दिखती। वजह असली मीटर-रीडिंग चक्र है: रीडिंग महीने की 24 तारीख़ से शुरू
// होकर अगले महीने की 8-9 तारीख़ तक चलती है, नया लेजर 10 तारीख़ को आता है — तब तक पुराना लेजर ही
// चलता रहता है। इस बीच (25 से महीने के आख़िर तक) जो उपभोक्ता बिल भर देते हैं, वे असल में अगले
// (नए) चक्र के भुगतान हैं, भले ही अभी पुराने लेजर में दर्ज हों — इसलिए खिड़की 27 तारीख़ से रखी गई
// है (उन्हें भी शामिल करने के लिए), 1 तारीख़ से नहीं। यह हमेशा "पिछले महीने की 27 से आज तक" रहती
// है — महीना बदलते ही अपने-आप एक महीना आगे खिसक जाती है (buildScOverview का समग्र/all-time
// आँकड़ा इससे अप्रभावित रहता है — वह जान-बूझकर अलग, संचयी हिसाब है)
function _scCycleWindow(){
  var t=new Date();
  var s=new Date(t.getFullYear(),t.getMonth()-1,27);
  return {
    startVal:s.getFullYear()*10000+(s.getMonth()+1)*100+s.getDate(),
    label:s.getDate()+"/"+(s.getMonth()+1)+"/"+s.getFullYear()+" – "+t.getDate()+"/"+(t.getMonth()+1)+"/"+t.getFullYear()
  };
}
function normPayDate(v){
  // हर format (yyyy-mm-dd / d/m/yyyy / dd-mm-yyyy) को d/m/yyyy बनाएँ; future date → आज
  var d=null,m;
  if((m=v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) d=new Date(+m[1],+m[2]-1,+m[3]);
  else if((m=v.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/))) d=new Date(+m[3],+m[2]-1,+m[1]);
  if(!d||isNaN(d.getTime())) return v; // पहचान न पाएँ तो जैसा है वैसा
  var tdy=new Date(); tdy.setHours(0,0,0,0);
  if(d>tdy) d=tdy;
  return d.getDate()+"/"+(d.getMonth()+1)+"/"+d.getFullYear();
}
function payDateVal(v){
  var m=v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m?(+m[3])*10000+(+m[2])*100+(+m[1]):0;
}
function renderScDateTable(data){
  var el=document.getElementById("sc-body");
  // Group paid records by paydate — unique acc only
  var byDate={};
  var seenAcc={}; // track unique acc across all dates
  // सिर्फ वही acc गिनें जो "कुल उपभोक्ता" (मास्टर) सूची में भी हों — ग्राम-वार वसूली से मेल के लिए
  var masterAcc={};
  (cGet(scActiveHQ,CATS[0])||[]).forEach(function(m){ if(m&&m.acc) masterAcc[String(m.acc)]=1; });
  var cycleStartVal=_scCycleWindow().startVal;
  data.forEach(function(x){
    if(x.status==="paid"&&x.paydate){
      if(x.acc&&!masterAcc[String(x.acc)]) return;
      var dt=normPayDate(x.paydate.trim());
      if(payDateVal(dt)<cycleStartVal) return; // चालू बिलिंग-चक्र से पुराना भुगतान — इस तालिका में न गिनें
      var accKey=x.acc||("__noAcc__"+x.name);
      if(seenAcc[accKey]) return; // duplicate acc — skip
      seenAcc[accKey]=true;
      if(!byDate[dt]) byDate[dt]={count:0,amount:0,names:[],accs:[],items:[]};
      byDate[dt].count++;
      // negative बकाया (advance/credit) वाले उपभोक्ता का योगदान वसूल-राशि के जोड़ में 0 माना जाता है —
      // देखें buildScOverview का fmt() वाला comment, वही वजह
      byDate[dt].amount+=Math.max(0,Number(x.amount)||0);
      byDate[dt].names.push(x.name||"");
      if(x.acc) byDate[dt].accs.push(x.acc);
      // नाम+नंबर जोड़ी में — तालिका में सिर्फ़ पहले 3 दिखते हैं (और वो भी चौड़ाई से कट जाते हैं),
      // इसलिए पूरी सूची अलग स्क्रीन पर दिखाने के लिए यहीं जमा कर लेते हैं। names/accs अलग-अलग
      // arrays हैं और accs में सिर्फ़ acc वाले जाते हैं, इसलिए उनके index आपस में मेल नहीं खाते —
      // जोड़ी बनाने के लिए यह तीसरी सूची ज़रूरी है
      byDate[dt].items.push({n:x.name||"",a:x.acc||"",amt:Number(x.amount)||0});
    }
  });
  var dates=Object.keys(byDate).sort(function(a,b){
    return payDateVal(b)-payDateVal(a); // असली date से desc sort
  });
  if(!dates.length){
    el.innerHTML="<div class='empty'><div class='empty-ico'>📊</div><div class='empty-t'>कोई वसूली नहीं</div><div class='empty-s'>चालू बिलिंग-चक्र में अभी तक कोई भुगतान दर्ज नहीं</div></div>";
    return;
  }
  // पूरी सूची वाली स्क्रीन के लिए संभालकर रखें (कोई network call नहीं — यही data पहले से हाथ में है)
  SC_DAY_DATES=dates; SC_DAY_MAP=byDate; SC_DAY_HQ=scActiveHQ;
  var totCount=0,totAmt=0;
  var rows=dates.map(function(dt,di){
    var d=byDate[dt];
    totCount+=d.count; totAmt+=d.amount;
    // पूरी पंक्ति दबाने लायक — index भेजते हैं, तारीख़ का text नहीं: normPayDate() कोई अनजान
    // format पहचान न पाए तो वह उपभोक्ता का टाइप किया हुआ text ज्यों का त्यों लौटा देता है, जो
    // onclick में डालने लायक नहीं (index हमेशा संख्या है)
    return "<tr class='sc-day-row' onclick='openScDayModal("+di+")'>"+
      "<td style='font-weight:600;'>"+escHtml(dt)+"</td>"+
      "<td style='text-align:center;color:var(--green);font-weight:700;'>"+d.count+"</td>"+
      "<td style='text-align:right;color:var(--gold);font-weight:700;'>₹"+d.amount.toLocaleString("hi-IN")+"</td>"+
      "<td style='color:var(--muted);font-size:10px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'>"+escHtml(d.names.slice(0,3).join(", "))+(d.names.length>3?" +"+(d.names.length-3):"")+"</td>"+
      "<td style='color:#64b5f6;font-size:10px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'>"+escHtml(d.accs.slice(0,3).join(", "))+(d.accs.length>3?" <b>+"+(d.accs.length-3)+"</b>":"")+"</td>"+
    "</tr>";
  }).join("");
  // कुल उपभोक्ता CATS[0] से
  var hqTotal=cGet(scActiveHQ,CATS[0]).length||0;
  var pct=hqTotal?((totCount/hqTotal)*100).toFixed(1):"0.0";
  // audit-verified: rows ऊपर .map().join() से बना (हर dt/name/acc escHtml() से गुज़रा है),
  // hqTotal/totCount/pct संख्या
  // eslint-disable-next-line no-unsanitized/property
  el.innerHTML=
    "<div style='font-size:11px;color:var(--muted);margin-bottom:6px;'>📊 कुल उपभोक्ता: <b style=\'color:var(--fg)\'>"+(hqTotal||"-")+"</b> &nbsp;|&nbsp; वसूल: <b style=\'color:var(--green)\'>"+(totCount)+"</b> &nbsp;|&nbsp; बाकी: <b style=\'color:var(--red)\'>"+(hqTotal-totCount)+"</b> &nbsp;|&nbsp; प्रतिशत: <b style=\'color:var(--gold)\'>"+(pct)+"%</b></div>"+
    "<div class='sc-tap-hint'>👆 किसी तारीख़ पर टैप करें — उस दिन के सारे उपभोक्ता और पूरे Consumer No दिखेंगे</div>"+
    "<table class='sc-date-table'>"+
      "<thead><tr><th>दिनांक</th><th style='text-align:center;'>संख्या</th><th style='text-align:right;'>राशि</th><th>उपभोक्ता</th><th>Consumer No</th></tr></thead>"+
      "<tbody>"+rows+
        "<tr class='sc-total-row'>"+
          "<td>🏆 कुल ("+pct+"%)</td>"+
          "<td style='text-align:center;'>"+totCount+" / "+hqTotal+"</td>"+
          "<td style='text-align:right;'>₹"+totAmt.toLocaleString("hi-IN")+"</td>"+
          "<td></td>"+
          "<td></td>"+
        "</tr>"+
      "</tbody>"+
    "</table>";
}

// ── एक दिन की पूरी सूची ───────────────────────────────────────────────────────────────────
// तालिका में "उपभोक्ता" और "Consumer No" दोनों खाने दो बार कटते थे: पहले सिर्फ़ 3 नाम/नंबर लिए
// जाते हैं (बाक़ी "+83"), और फिर max-width+ellipsis से वो 3 भी अधूरे दिखते हैं। असली रिपोर्ट में
// एक दिन (31/8) में 86 उपभोक्ता थे — JE उनमें से 3 भी पूरे नहीं देख पाते थे। सिर्फ़ खाना चौड़ा
// करने से बात नहीं बनती (86 नंबर एक पंक्ति में समाएँगे ही नहीं), इसलिए पूरी सूची अलग स्क्रीन पर।
// सारा data पहले से device के cache में है — इस स्क्रीन पर एक भी network call नहीं लगती।
var SC_DAY_DATES=[], SC_DAY_MAP=null, SC_DAY_HQ="";
function openScDayModal(i){
  var dt=SC_DAY_DATES[i], d=SC_DAY_MAP&&SC_DAY_MAP[dt];
  if(!d) return;
  document.getElementById("scday-title").textContent="📅 "+dt+" — "+SC_DAY_HQ;
  document.getElementById("scday-sub").textContent=d.count+" उपभोक्ता • ₹"+d.amount.toLocaleString("hi-IN")+" वसूल";
  var accs=d.items.filter(function(x){return x.a;}).map(function(x){return x.a;});
  var h="";
  if(accs.length){
    h+="<button class='btn-save' style='width:100%;margin-bottom:10px;' onclick='copyScDayAccs("+i+")'>📋 सारे Consumer No कॉपी करें ("+accs.length+")</button>";
  }
  h+="<table class='wasc-table'><thead><tr><th style='width:34px;'>क्र.</th><th class='wasc-th-left'>उपभोक्ता</th><th>Consumer No</th></tr></thead><tbody>"+
    d.items.map(function(x,n){
      // नंबर पर टैप → वही पुराना बिल-वाला popup (कॉपी / MPEZ साइट)
      var accCell=x.a
        ? "<span class='chip chip-acc' onclick=\"event.stopPropagation();openAccModal('"+escJsAttr(x.a)+"')\">📄 "+escHtml(x.a)+"</span>"
        : "<span style='color:var(--muted);'>—</span>";
      return "<tr><td style='color:var(--muted);'>"+(n+1)+"</td><td class='wasc-hq'>"+escHtml(x.n||"(नाम नहीं)")+"</td><td>"+accCell+"</td></tr>";
    }).join("")+
    "</tbody></table>";
  // audit-verified: सिर्फ़ hardcoded markup + संख्याएं; उपभोक्ता का नाम escHtml() से और
  // onclick में गया acc escJsAttr() से गुज़रा है (वही तरीक़ा जो list.js की acc-chip में है)
  // eslint-disable-next-line no-unsanitized/property
  document.getElementById("scday-content").innerHTML=h;
  document.getElementById("scday-overlay").classList.add("open");
}
function closeScDayModal(){document.getElementById("scday-overlay").classList.remove("open");}
function copyScDayAccs(i){
  var dt=SC_DAY_DATES[i], d=SC_DAY_MAP&&SC_DAY_MAP[dt];
  if(!d) return;
  // हर नंबर अलग पंक्ति में — Excel में paste करने पर सीधे एक-एक खाने में बैठ जाते हैं,
  // और WhatsApp में भी पढ़ने लायक रहते हैं
  var txt=d.items.filter(function(x){return x.a;}).map(function(x){return x.a;}).join("\n");
  if(!txt){toast("इस दिन किसी का Consumer No दर्ज नहीं है","err");return;}
  var n=txt.split("\n").length;
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(function(){toast("✅ "+n+" Consumer No कॉपी हो गए","ok");})
      .catch(function(){_scDayFallbackCopy(txt,n);});
  } else { _scDayFallbackCopy(txt,n); }
}
function _scDayFallbackCopy(txt,n){
  var ta=document.createElement("textarea");
  ta.value=txt; ta.style.position="fixed"; ta.style.opacity="0";
  document.body.appendChild(ta); ta.select();
  try{document.execCommand("copy");toast("✅ "+n+" Consumer No कॉपी हो गए","ok");}
  catch(e){toast("कॉपी नहीं हो सका","err");}
  document.body.removeChild(ta);
}

function downloadScPDF(){
  // Gather all HQ data for scorecard PDF
  var hqs=CU.role==="supervisor"?HQS:[CU.hq];
  var cw=_scCycleWindow();
  var rows="";
  hqs.forEach(function(hq){
    var combined=[];
    CATS.forEach(function(cat){combined=combined.concat(cGet(hq,cat));});
    var hqTotal=cGet(hq,CATS[0]).length||0;
    var byDate={};
    var seenAccPDF={};
    var masterAccPDF={};
    (cGet(hq,CATS[0])||[]).forEach(function(m){ if(m&&m.acc) masterAccPDF[String(m.acc)]=1; });
    combined.forEach(function(x){
      if(x.status==="paid"&&x.paydate){
        if(x.acc&&!masterAccPDF[String(x.acc)]) return;
        if(payDateVal(normPayDate(x.paydate.trim()))<cw.startVal) return; // चालू बिलिंग-चक्र से पुराना भुगतान — इसमें न गिनें (देखें _scCycleWindow)
        var accKey=x.acc||("__noAcc__"+x.name);
        if(seenAccPDF[accKey]) return;
        seenAccPDF[accKey]=true;
        var dt=x.paydate.trim();
        if(!byDate[dt]) byDate[dt]={count:0,amount:0,names:[],accs:[]};
        byDate[dt].count++; byDate[dt].amount+=Math.max(0,Number(x.amount)||0);
        byDate[dt].names.push(x.name||'');
        if(x.acc) byDate[dt].accs.push(x.acc);
      }
    });
    var dates=Object.keys(byDate).sort(function(a,b){return b.localeCompare(a);});
    if(!dates.length) return;
    var totC=0,totA=0;
    var hqRows=dates.map(function(dt){
      var d=byDate[dt]; totC+=d.count; totA+=d.amount;
      return "<tr><td>"+escHtml(dt)+"</td><td style='text-align:center;'>"+d.count+"</td><td style='text-align:right;font-weight:700;'>₹"+d.amount.toLocaleString("hi-IN")+"</td><td style='font-size:9px;color:#555;'>"+escHtml(d.names.slice(0,3).join(", "))+(d.names.length>3?" +"+(d.names.length-3):"")+"</td><td style='font-size:9px;color:#1a237e;'>"+escHtml(d.accs.slice(0,3).join(", "))+(d.accs.length>3?" +"+(d.accs.length-3):"")+"</td></tr>";
    }).join("");
    var pdfPct=hqTotal?((totC/hqTotal)*100).toFixed(1):"0.0";
    hqRows+="<tr style='background:#e8f5e9;font-weight:700;'><td>कुल ("+pdfPct+"%)</td><td style='text-align:center;'>"+totC+" / "+hqTotal+"</td><td style='text-align:right;'>₹"+totA.toLocaleString("hi-IN")+"</td><td></td><td></td></tr>";
    rows+="<h3 style='color:#4a148c;margin-top:18px;'>📍 "+escHtml(hq)+"</h3>"+
      "<table style='width:100%;border-collapse:collapse;font-size:11px;margin-bottom:10px;'>"+
      "<thead><tr style='background:#4a148c;color:#fff;'><th style='padding:5px;text-align:left;'>दिनांक</th><th style='padding:5px;text-align:center;'>संख्या</th><th style='padding:5px;text-align:right;'>राशि</th><th style='padding:5px;'>उपभोक्ता</th><th style='padding:5px;'>Consumer No</th></tr></thead>"+
      "<tbody>"+hqRows+"</tbody></table>";
  });
  var html="<!DOCTYPE html><html><head><meta charset='UTF-8'>"+
    "<style>body{font-family:Arial,sans-serif;font-size:11px;margin:15px;}h2{color:#4a148c;}td{padding:5px;border-bottom:1px solid #ddd;}"+
    "@media print{.np{display:none}}</style></head><body>"+
    "<h2>&#127942; DC स्कोरकार्ड — दिनांक-वार वसूली</h2>"+
    "<p>दिनांक: <b>"+new Date().toLocaleDateString("hi-IN")+"</b> | चालू चक्र: <b>"+escHtml(cw.label)+"</b> | "+escHtml(CU.name)+"</p>"+
    "<button class='np' onclick='window.print()' style='margin-bottom:8px;padding:6px 14px;background:#4a148c;color:#fff;border:none;border-radius:5px;cursor:pointer;'>Print / PDF Save</button>"+
    rows+"</body></html>";
  var w=window.open("","_blank");
  // audit-verified: html के अंदर hq/CU.name escHtml() से गुज़रे, rows भी .map().join() से escHtml()
  // सहित बना (ऊपर देखें)
  // eslint-disable-next-line no-unsanitized/method
  if(w){w.document.write(html);w.document.close();setTimeout(function(){w.print();},600);}
  else toast("Popup block है, allow करें","inf");
}

// ─── स्कोरकार्ड डिस्प्ले (JE only) — सभी HQ की सारांश तालिका, WhatsApp पर screenshot शेयर के लिए ───
// खोलते ही सीधे cache से दिखाएं (आज की वसूली/ग्राम-वार वसूली जैसा ही तरीका) — network refresh नहीं,
// वरना हर बार खोलने पर सभी 6 HQ की सभी 8 categories दोबारा डाउनलोड होतीं (वही असली bandwidth bug,
// तीसरी जगह भी मिला) — ताज़ा चाहिए तो "रिफ्रेश करें" बटन है (देखें loadWaScorecard)
function openWaScorecard(){
  if(!CU||CU.role!=="supervisor"){toast("सिर्फ JE यह देख सकते हैं","err");return;}
  var mn=document.getElementById("logout-menu"); if(mn) mn.classList.remove("open");
  document.getElementById("wasc-overlay").classList.add("open");
  _waScRender();
}
function closeWaScorecard(){document.getElementById("wasc-overlay").classList.remove("open");}

// एक HQ का सारांश — "कुल उपभोक्ता" श्रेणी को मास्टर सूची मानकर कुल/बकाया, बाकी सभी श्रेणियों से unique वसूल (जैसा मौजूदा स्कोरकार्ड करता है)
// वसूल सिर्फ उन्हीं acc के लिए गिनें जो "कुल उपभोक्ता" (मास्टर) सूची में भी मौजूद हों — वरना ग्राम-वार वसूली
// (जो सिर्फ मास्टर records पर आधारित है) से संख्या मेल नहीं खाती
function _waScRow(hq){
  var master=cGet(hq,CATS_DEFAULT[0])||[];
  var seenTot={},tot=0,bakaya=0,masterAcc={};
  master.forEach(function(x){
    if(!x)return;
    var key=x.acc?String(x.acc):("_t"+tot+Math.random());
    if(seenTot[key])return; seenTot[key]=1;
    if(x.acc) masterAcc[String(x.acc)]=1;
    tot++;
    if(x.status!=="paid") bakaya+=Number(x.amount)||0;
  });
  var seenPaid={},paid=0,paidAmt=0;
  for(var i=0;i<CATS_DEFAULT.length;i++){
    var cat=isCatEditable(i)?getCatName(hq,i):CATS_DEFAULT[i];
    var d=cGet(hq,cat)||[];
    d.forEach(function(x){
      if(!x||x.status!=="paid")return;
      if(x.acc&&!masterAcc[String(x.acc)])return; // "कुल उपभोक्ता" में न हो तो न गिनें
      var key=x.acc?String(x.acc):("_p"+paid+Math.random());
      if(seenPaid[key])return; seenPaid[key]=1;
      paid++; paidAmt+=Math.max(0,Number(x.amount)||0); // negative बकाया (advance) का योगदान 0 माना जाता है
    });
  }
  return {hq:hq,tot:tot,bakaya:bakaya,paid:paid,paidAmt:paidAmt,pct:tot?(paid/tot*100):0};
}

function _waScRender(){
  var el=document.getElementById("wasc-content");
  var rows=HQS.map(_waScRow);
  var gTot=0,gBak=0,gPaid=0,gPaidAmt=0;
  rows.forEach(function(r){gTot+=r.tot;gBak+=r.bakaya;gPaid+=r.paid;gPaidAmt+=r.paidAmt;});
  var gPct=gTot?(gPaid/gTot*100):0;
  var fmt=function(n){return Number(n||0).toLocaleString("hi-IN");};
  var now=new Date();
  var html="<div class='wasc-hdr'><div class='wasc-hdr-t'>&#9889; वसूली ट्रैकर — आदेगांव DC</div>"+
    "<div class='wasc-hdr-s'>अद्यतन: "+now.toLocaleDateString("hi-IN")+" "+now.toLocaleTimeString("hi-IN",{hour:"2-digit",minute:"2-digit"})+"</div></div>";
  html+="<table class='wasc-table'><thead><tr><th>क्र.</th><th class='wasc-th-left'>मुख्यालय</th>"+
    "<th>कुल उपभोक्ता<br><span class='wasc-sub'>बकाया राशि</span></th>"+
    "<th class='wasc-col-paid'>वसूल उपभोक्ता<br><span class='wasc-sub'>वसूल राशि</span></th>"+
    "<th>Paid Count %</th></tr></thead><tbody>";
  rows.forEach(function(r,i){
    html+="<tr><td>"+(i+1)+"</td><td class='wasc-hq'>"+escHtml(r.hq)+"</td>"+
      "<td>"+fmt(r.tot)+"<br><span class='wasc-sub'>&#8377;"+fmt(r.bakaya)+"</span></td>"+
      "<td class='wasc-col-paid'><span class='wasc-paid-num'>"+fmt(r.paid)+"</span><br><span class='wasc-sub'>&#8377;"+fmt(r.paidAmt)+"</span></td>"+
      "<td>"+r.pct.toFixed(1)+"%</td></tr>";
  });
  html+="</tbody><tfoot><tr><td colspan='2'>योग</td>"+
    "<td>"+fmt(gTot)+"<br><span class='wasc-sub'>&#8377;"+fmt(gBak)+"</span></td>"+
    "<td class='wasc-col-paid'><span class='wasc-paid-num'>"+fmt(gPaid)+"</span><br><span class='wasc-sub'>&#8377;"+fmt(gPaidAmt)+"</span></td>"+
    "<td>"+gPct.toFixed(1)+"%</td></tr></tfoot></table>";
  // audit-verified: r.hq escHtml() से गुज़रता है (ऊपर देखें), बाक़ी सब संख्या
  // eslint-disable-next-line no-unsanitized/property
  el.innerHTML=html;
}

// सिर्फ़ "रिफ्रेश करें" बटन से बुलाया जाता है — force=true देकर cooldown नज़रअंदाज़ करके हमेशा असली ताज़ा data
function loadWaScorecard(){
  var el=document.getElementById("wasc-content");
  el.innerHTML="<div class='sc-loading'>⏳ ताज़ा data लाया जा रहा है...</div>";
  if(navigator.onLine){
    _cashRefreshAll(HQS,function(){_waScRender();},true);
  } else {
    _waScRender();
  }
}

// ── आज की वसूली — वर्तमान दिनांक का मुख्यालय-वार भुगतान संख्या स्कोरकार्ड (JE only) ──
// खोलते ही सीधे cache से दिखाएं (WhatsApp स्कोरकार्ड — buildScorecard() — जैसा ही तरीका), network
// refresh नहीं — वरना हर बार खोलने पर _cashRefreshAll() सभी 6 HQ के सभी 8 categories की पूरी लिस्ट
// (कुल उपभोक्ता में 3500 तक records) दोबारा डाउनलोड करता, और यह फ़ीचर बार-बार खोला जाना स्वाभाविक है
// (रोज़ का हिसाब चेक करने के लिए) — असली bandwidth bug यही था, ताज़ा चाहिए तो "रिफ्रेश करें" बटन है
function openTodayScorecard(){
  if(!CU||CU.role!=="supervisor"){toast("सिर्फ JE यह देख सकते हैं","err");return;}
  var mn=document.getElementById("logout-menu"); if(mn) mn.classList.remove("open");
  document.getElementById("todaysc-overlay").classList.add("open");
  _todayScRender();
}
function closeTodayScorecard(){document.getElementById("todaysc-overlay").classList.remove("open");}

function _todayDateStr(){
  var d=new Date();
  return d.getDate()+"/"+(d.getMonth()+1)+"/"+d.getFullYear(); // normPayDate() जैसा ही d/m/yyyy फॉर्मेट, तुलना के लिए
}

// एक HQ का आज का वसूल count/amount — "कुल उपभोक्ता" को मास्टर मानकर, बाकी categories से unique acc गिनना
// (_waScRow जैसा ही dedup तरीका, सिर्फ आज की तारीख़ का filter जोड़ा)
function _todayScRow(hq){
  var todayStr=_todayDateStr();
  var master=cGet(hq,CATS_DEFAULT[0])||[];
  var masterAcc={};
  master.forEach(function(x){ if(x&&x.acc) masterAcc[String(x.acc)]=1; });
  var seen={},count=0,amt=0;
  for(var i=0;i<CATS_DEFAULT.length;i++){
    var cat=isCatEditable(i)?getCatName(hq,i):CATS_DEFAULT[i];
    var d=cGet(hq,cat)||[];
    d.forEach(function(x){
      if(!x||x.status!=="paid"||!x.paydate)return;
      if(x.acc&&!masterAcc[String(x.acc)])return; // "कुल उपभोक्ता" में न हो तो न गिनें
      if(normPayDate(String(x.paydate).trim())!==todayStr)return;
      var key=x.acc?String(x.acc):("_"+count+Math.random());
      if(seen[key])return; seen[key]=1;
      count++; amt+=Math.max(0,Number(x.amount)||0); // negative बकाया (advance) का योगदान 0 माना जाता है
    });
  }
  return {hq:hq,count:count,amt:amt};
}

function _todayScRender(){
  var el=document.getElementById("todaysc-content");
  var rows=HQS.map(_todayScRow);
  var gCount=0,gAmt=0;
  rows.forEach(function(r){gCount+=r.count;gAmt+=r.amt;});
  var fmt=function(n){return Number(n||0).toLocaleString("hi-IN");};
  var html="<div class='wasc-hdr'><div class='wasc-hdr-t'>&#128979;&#65039; आज की वसूली — "+escHtml(_todayDateStr())+"</div></div>";
  if(!gCount){
    html+="<div class='empty'><div class='empty-ico'>📅</div><div class='empty-t'>आज तक कोई वसूली नहीं</div><div class='empty-s'>अभी तक किसी भी HQ में आज का कोई भुगतान दर्ज नहीं</div></div>";
    // audit-verified: html में सिर्फ़ escHtml(_todayDateStr()) और hardcoded literals हैं
    // eslint-disable-next-line no-unsanitized/property
    el.innerHTML=html;
    return;
  }
  html+="<table class='wasc-table'><thead><tr><th>क्र.</th><th class='wasc-th-left'>मुख्यालय</th><th class='wasc-col-paid'>बिल भुगतान संख्या</th><th>आज राशि</th></tr></thead><tbody>";
  rows.forEach(function(r,i){
    html+="<tr><td>"+(i+1)+"</td><td class='wasc-hq'>"+escHtml(r.hq)+"</td>"+
      "<td class='wasc-col-paid'><span class='wasc-paid-num'>"+fmt(r.count)+"</span></td>"+
      "<td>&#8377;"+fmt(r.amt)+"</td></tr>";
  });
  html+="</tbody><tfoot><tr><td colspan='2'>योग</td>"+
    "<td class='wasc-col-paid'><span class='wasc-paid-num'>"+fmt(gCount)+"</span></td>"+
    "<td>&#8377;"+fmt(gAmt)+"</td></tr></tfoot></table>";
  // audit-verified: r.hq escHtml() से गुज़रता है (ऊपर देखें), बाक़ी संख्या
  // eslint-disable-next-line no-unsanitized/property
  el.innerHTML=html;
}

// सिर्फ़ "रिफ्रेश करें" बटन से बुलाया जाता है (JE ने खुद मांगा है) — इसलिए force=true देकर
// 5-मिनट वाली cooldown नज़रअंदाज़ करके हमेशा असली ताज़ा data लाया जाए
function loadTodayScorecard(){
  var el=document.getElementById("todaysc-content");
  el.innerHTML="<div class='sc-loading'>⏳ ताज़ा data लाया जा रहा है...</div>";
  if(navigator.onLine){
    _cashRefreshAll(HQS,function(){_todayScRender();},true);
  } else {
    _todayScRender();
  }
}

// ── मुख्यालय व टैरिफ रिपोर्ट: मुख्यालय-वार, टैरिफ-श्रेणी-वार (LV1/LV3/...) कनेक्शन/बकाया/वसूल ──
// JE का सवाल: "बिना कोई नेटवर्क कॉल किए या डेटा कास्ट बढ़ाए क्या ऐसा बटन बन सकता है"। जवाब: हां —
// _voiceHQBreakdown() सिर्फ़ cGet() (device पर पहले से मौजूद cache) पढ़ता है, कोई fetch() यहां
// कहीं नहीं है। (v9.132 में यह बोलकर भी सुनाता था — Web Speech API से — पर JE ने कहा "सिर्फ़
// लिस्ट चाहिए, बोलने वाला बटन नहीं", इसलिए v9.133 में वह हिस्सा हटा दिया, बाक़ी यथावत)
// तय क्रम नहीं, tot के घटते क्रम में — जिस टैरिफ में सबसे ज़्यादा कनेक्शन वह पहले दिखाया जाए
function _voiceHQBreakdown(hq){
  var master=cGet(hq,CATS_DEFAULT[0])||[];
  var seen={},masterTariff={},rows={};
  master.forEach(function(x){
    if(!x)return;
    var key=x.acc?String(x.acc):("_t"+Math.random());
    if(seen[key])return; seen[key]=1;
    var tf=(x.tariff||"").toString().trim()||"अन्य";
    if(!rows[tf]) rows[tf]={tariff:tf,tot:0,due:0,paid:0,paidAmt:0};
    rows[tf].tot++;
    if(x.status!=="paid") rows[tf].due+=Number(x.amount)||0;
    if(x.acc) masterTariff[String(x.acc)]=tf;
  });
  var seenPaid={};
  for(var i=0;i<CATS_DEFAULT.length;i++){
    var cat=isCatEditable(i)?getCatName(hq,i):CATS_DEFAULT[i];
    cGet(hq,cat).forEach(function(x){
      if(!x||x.status!=="paid"||!x.acc)return;
      var tf=masterTariff[String(x.acc)];
      if(!tf)return; // "कुल उपभोक्ता" (master) में न हो तो न गिनें — _waScRow जैसा dedup
      var key=String(x.acc);
      if(seenPaid[key])return; seenPaid[key]=1;
      rows[tf].paid++; rows[tf].paidAmt+=Math.max(0,Number(x.amount)||0); // negative बकाया (advance) का योगदान 0 माना जाता है
    });
  }
  return Object.keys(rows).map(function(k){return rows[k];}).sort(function(a,b){return b.tot-a.tot;});
}

function _voiceScRender(){
  var el=document.getElementById("voicesc-content");
  var html="";
  HQS.forEach(function(hq){
    var rows=_voiceHQBreakdown(hq);
    if(!rows.length)return; // इस HQ का "कुल उपभोक्ता" cache में नहीं है — खाली न दिखाएं
    html+="<div class='wasc-hdr' style='margin-top:10px;'><div class='wasc-hdr-t'>"+escHtml(hq)+"</div></div>";
    html+="<table class='wasc-table'><thead><tr><th class='wasc-th-left'>Tariff</th><th>कुल</th><th>बकाया राशि</th><th class='wasc-col-paid'>वसूल</th><th class='wasc-col-paid'>वसूल राशि</th></tr></thead><tbody>";
    rows.forEach(function(r){
      html+="<tr><td class='wasc-hq'>"+escHtml(r.tariff)+"</td><td>"+r.tot.toLocaleString("hi-IN")+"</td><td>&#8377;"+Math.round(r.due).toLocaleString("hi-IN")+"</td>"+
        "<td class='wasc-col-paid'>"+r.paid.toLocaleString("hi-IN")+"</td><td class='wasc-col-paid'>&#8377;"+Math.round(r.paidAmt).toLocaleString("hi-IN")+"</td></tr>";
    });
    html+="</tbody></table>";
  });
  // audit-verified: hq और r.tariff दोनों escHtml() से गुज़रते हैं (ऊपर देखें), बाक़ी सब संख्या
  // eslint-disable-next-line no-unsanitized/property
  el.innerHTML=html||"<div class='empty'><div class='empty-ico'>📴</div><div class='empty-t'>कोई cache data नहीं</div><div class='empty-s'>पहले किसी HQ/श्रेणी की सूची खोलें ताकि device पर data आ जाए</div></div>";
}

function openVoiceScorecard(){
  if(!CU||CU.role!=="supervisor"){toast("सिर्फ JE यह देख सकते हैं","err");return;}
  var mn=document.getElementById("logout-menu"); if(mn) mn.classList.remove("open");
  document.getElementById("voicesc-overlay").classList.add("open");
  _voiceScRender();
}
function closeVoiceScorecard(){
  document.getElementById("voicesc-overlay").classList.remove("open");
}

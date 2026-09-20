// ─── PHONE ACTION MODAL ───────────────────────────────────────────────────────
// दो तरह के संदेश टेम्पलेट — "सामान्य रिमाइंडर" (पुराना) और "विच्छेदन सूचना धारा 56" (नया, कानूनी
// भाषा वाला)। जो टाइप आख़िरी बार चुना गया वह localStorage में याद रहता है — अगली बार सीधे वही चुना
// हुआ दिखता/भेजा जाता है, पर दूसरा विकल्प भी हमेशा वहीं मौजूद रहता है बदलने के लिए
var _phCtx=null;
function _phBuildMsg(type,ctx){
  if(type==="disconnect"){
    return "⚠️ वैधानिक सूचना\n"+ctx.name+" जी, आपके विद्युत संयोजन"+
      (ctx.acc?" क्रमांक "+ctx.acc:"")+" पर"+
      (ctx.amtN?" ₹"+ctx.amtN.toLocaleString("hi-IN"):"")+
      " बकाया है। विद्युत अधिनियम, 2003 की धारा 56 के अंतर्गत यह विच्छेदन सूचना है। 15 दिवस के भीतर भुगतान न होने पर नियमानुसार विद्युत आपूर्ति विच्छेदित की जा सकती है।"+
      " कृपया आज ही भुगतान करें ताकि बिजली विच्छेदन, विलंब शुल्क और असुविधा से बचा जा सके।"+
      "\n– आदेगांव बिजली वितरण केंद्र सिवनी"+
      "\n(नोट: यदि भुगतान कर दिया है तो कृपया इस संदेश को अनदेखा करें)";
  }
  return "नमस्ते "+ctx.name+" जी, आपका बिजली संयोजन"+
    (ctx.acc?" क्रमांक "+ctx.acc:"")+
    " पर वर्तमान माह तक"+
    (ctx.amtN?" "+ctx.amtN.toLocaleString("hi-IN")+"/- रूपए":"")+
    " बिजली बिल बकाया है। कृपया बिजली ऑफिस, लाइन मैन, अथवा ऑनलाइन माध्यम से शीघ्र भुगतान करें।"+
    "\nधन्यवाद,\nआदेगांव बिजली वितरण केंद्र"+
    "\n(नोट: यदि भुगतान कर दिया है तो कृपया इस संदेश को अनदेखा करें)";
}
function _phApplyMsgType(type){
  if(!_phCtx) return;
  try{localStorage.setItem("dc_ph_msgtype",type);}catch(e){}
  document.querySelectorAll(".ph-mt-btn").forEach(function(b){
    b.classList.toggle("active",b.getAttribute("data-type")===type);
  });
  var msg=_phBuildMsg(type,_phCtx);
  document.getElementById("ph-sms-btn").href="sms:"+_phCtx.clean+"?body="+encodeURIComponent(msg);
  document.getElementById("ph-wa-btn").href="https://wa.me/91"+_phCtx.clean+"?text="+encodeURIComponent(msg);
}
function _phSelectMsgType(type){ _phApplyMsgType(type); }
function openPhModal(name, phone, acc, amt){
  var clean=phone.replace(/\D/g,"");
  _phCtx={name:name,acc:acc,amtN:Number(amt)||0,clean:clean};
  document.getElementById("ph-name").textContent=name;
  document.getElementById("ph-num").textContent="📞 "+phone;
  document.getElementById("ph-call-btn").href="tel:"+clean;
  var savedType="reminder";
  try{savedType=localStorage.getItem("dc_ph_msgtype")||"reminder";}catch(e){}
  if(savedType!=="disconnect") savedType="reminder";
  _phApplyMsgType(savedType);
  document.getElementById("ph-overlay").classList.add("open");
}
function closePhModal(){document.getElementById("ph-overlay").classList.remove("open");}
function closePhOutside(e){if(e.target===document.getElementById("ph-overlay"))closePhModal();}


function dlTemplate(){
  var s="Consumer No,Consumer Name,Father Name,Net Bill,Mobile No,Address,Remark,Tariff,Load,Unit,Last Payment Date,Last Paid Amt\n";
  s+="1234567890,राम लाल,श्याम लाल,5400,9876543210,आदेगांव,,घरेलू,1KW,1.00KW,15/03/2025,2500\n";
  s+="// नोट: Last Payment Date = पिछली भुगतान तिथि, Last Paid Amt = पिछला भुगतान राशि\n";
  var a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([s],{type:"text/csv;charset=utf-8;"}));
  a.download="vasuli_template.csv"; a.click();
  toast("Template डाउनलोड...","inf");
}


// ─── CONSUMER NO MODAL ───────────────────────────────────────────────────────
var _currentAcc = "";
function openAccModal(acc){
  _currentAcc = acc;
  document.getElementById("acc-popup-no").textContent = acc;
  document.getElementById("acc-overlay").classList.add("open");
}
function closeAccModal(){document.getElementById("acc-overlay").classList.remove("open");}
function closeAccOutside(e){if(e.target===document.getElementById("acc-overlay"))closeAccModal();}

function copyAccNo(){
  if(!_currentAcc)return;
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(_currentAcc).then(function(){
      toast("✅ Consumer No. कॉपी हो गया!","ok");
      closeAccModal();
    }).catch(function(){fallbackCopy(_currentAcc);});
  } else { fallbackCopy(_currentAcc); }
}

function copyAndOpenBill(){
  if(!_currentAcc)return;
  var doCopy=function(){
    if(navigator.clipboard&&navigator.clipboard.writeText){
      return navigator.clipboard.writeText(_currentAcc);
    } else {
      try{
        var ta=document.createElement("textarea");
        ta.value=_currentAcc; ta.style.position="fixed"; ta.style.opacity="0";
        document.body.appendChild(ta); ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }catch(e){}
      return Promise.resolve();
    }
  };
  doCopy().then(function(){
    closeAccModal();
    toast("📋 No. कॉपी हुआ — site पर Paste करें!","inf");
    setTimeout(function(){window.open("https://billing.mpez.co.in/","_blank");},400);
  }).catch(function(){
    closeAccModal();
    window.open("https://billing.mpez.co.in/","_blank");
  });
}

function fallbackCopy(txt){
  var ta=document.createElement("textarea");
  ta.value=txt; ta.style.position="fixed"; ta.style.opacity="0";
  document.body.appendChild(ta); ta.select();
  try{document.execCommand("copy");toast("✅ Consumer No. कॉपी हो गया!","ok");}
  catch(e){toast("कॉपी नहीं हो सका","err");}
  document.body.removeChild(ta); closeAccModal();
}

// PWA: GitHub Pages link offline भी खुले (file:// में अपने आप skip)
// ── नया version आते ही चेतावनी: device लंबे समय खुला पड़ा रहे तो पुराना JS memory में ही रह जाता है
// (sw.js खुद नए worker को activate/claim कर लेता है, पर पहले से खुले tab का चल रहा कोड नहीं बदलता) —
// इसलिए यूज़र को साफ़ दिखाओ कि नया version आ गया है, रीलोड करने पर ताज़ा कोड मिलेगा
// ब्राउज़र खुद कभी-कभी घंटों बाद ही नया sw.js जांचता है (tab लंबे समय खुला/background में पड़ा रहे
// तो) — इसलिए खुद भी बार-बार जांचते रहें, ताकि नया version deploy होते ही (browser के अपने-आप
// जांचने का इंतज़ार किए बिना) कुछ ही मिनट में "नया version आ गया है" बैनर दिख जाए
var _pendingUpdate=false; // नया SW version आया — अगली बार focus मिलते ही reload करना है
function _reloadPage(){ location.reload(); } // tests में override हो सके
function _swSetupAutoUpdate(reg){
  if(!reg) return;
  setInterval(function(){reg.update().catch(function(){});},5*60*1000);
  document.addEventListener("visibilitychange",function(){
    if(document.visibilityState==="visible"){
      // background में था और update आ चुका था — user के वापस आते ही silently reload (interrupt नहीं)
      if(_pendingUpdate){_reloadPage();return;}
      reg.update().catch(function(){});
    }
  });
}
if("serviceWorker" in navigator && location.protocol.indexOf("http")===0){
  navigator.serviceWorker.register("sw.js").then(_swSetupAutoUpdate).catch(function(){});
  navigator.serviceWorker.addEventListener("controllerchange",function(){
    // page hidden हो (user दूसरे app में) तो silently reload — कोई interrupt नहीं, पर पुराना bandwidth-भारी
    // code अपने आप बदल जाएगा (v9.92 वाले device जो banner click नहीं करते उनके लिए ज़रूरी)
    if(document.hidden){_reloadPage();}else{_showUpdateBanner();}
  });
}
function _showUpdateBanner(){
  _pendingUpdate=true; // visible होने पर visibilitychange handler reload करेगा
  if(document.getElementById("update-banner")) return;
  var b=document.createElement("div");
  b.id="update-banner";
  b.innerHTML="<span>🔄 ऐप का नया version आ गया है</span>"+
    "<button id='update-banner-btn'>रीलोड करें</button>";
  document.body.appendChild(b);
  document.getElementById("update-banner-btn").onclick=function(){ _reloadPage(); };
}


// ─── पूरा बैकअप: सभी HQ × श्रेणी + डिस्प्ले बोर्ड + logs एक Excel में (सिर्फ JE) ───
function _bkSheetName(s){
  return String(s).replace(/[\[\]:*?\/\\]/g,"_").slice(0,31);
}
function downloadFullBackup(){
  if(!CU||CU.role!=="supervisor"){toast("सिर्फ JE बैकअप ले सकते हैं","err");return;}
  var mn=document.getElementById("logout-menu"); if(mn) mn.classList.remove("open");
  ensureXLSX(function(ok){
    if(!ok){toast("📴 बैकअप के लिए इन्टरनेट चाहिए (Excel library)","err");return;}
    showLoader("बैकअप बन रहा है — सभी लिस्ट ताज़ा हो रही हैं...");
    // online हो तो पहले सभी लिस्ट server से ताज़ा लाओ (pending वाले tabs छोड़कर) — वही helper जो कैश लिस्ट use करती है
    _cashRefreshAll(HQS,function(){
      try{
        var wb=XLSX.utils.book_new();
        var head=["क्र.","नाम","पिता/पति","Consumer No","बकाया","Tariff","Load","Unit","Mobile","पता","स्थिति","भुगतान तिथि","पिछला भुगतान","पिछला तिथि","रिमार्क (सभी)","अपडेट by","अपडेट समय"];
        var sum=[["HQ","श्रेणी","कुल","वसूल","बाकी","बाकी राशि"]];
        var totalRecs=0;
        HQS.forEach(function(hq){
          for(var i=0;i<CATS_DEFAULT.length;i++){
            var cat=isCatEditable(i)?getCatName(hq,i):CATS_DEFAULT[i];
            var d=cGet(hq,cat);
            if(!d||!d.length)continue;
            var paid=0,pendAmt=0;
            var rows=[head];
            d.forEach(function(x,n){
              if(!x)return;
              if(x.status==="paid")paid++;else pendAmt+=Number(x.amount)||0;
              var allRmk=(x.remarksArr||[]).map(function(r){return r.text+" ("+r.by+")";}).join(" | ");
              rows.push([n+1,x.name||"",x.father||"",x.acc||"",Number(x.amount)||0,x.tariff||"",x.load||"",x.unit||"",x.phone||"",x.addr||"",x.status==="paid"?"वसूल":"बाकी",x.paydate||"",x.lastPaidAmt||"",x.lastPayDate||"",allRmk,x.updatedBy||"",x.updatedAt||""]);
            });
            totalRecs+=d.length;
            sum.push([hq,cat,d.length,paid,d.length-paid,pendAmt]);
            var ws=XLSX.utils.aoa_to_sheet(rows);
            ws["!cols"]=[{wch:4},{wch:20},{wch:18},{wch:14},{wch:10},{wch:8},{wch:8},{wch:6},{wch:13},{wch:18},{wch:8},{wch:13},{wch:12},{wch:13},{wch:35},{wch:14},{wch:18}];
            XLSX.utils.book_append_sheet(wb,ws,_bkSheetName(hq+"_"+cat));
          }
        });
        if(totalRecs===0){hideLoader();toast("कोई data नहीं मिला — पहले लिस्ट खुलने दें","err");return;}
        // Summary sheet सबसे आगे
        var now=new Date();
        sum.push([]);sum.push(["बैकअप समय",now.toLocaleString("hi-IN")]);sum.push(["App Version",APP_VER]);sum.push(["कुल records",totalRecs]);
        var wsSum=XLSX.utils.aoa_to_sheet(sum);
        wsSum["!cols"]=[{wch:12},{wch:16},{wch:8},{wch:8},{wch:8},{wch:12}];
        XLSX.utils.book_append_sheet(wb,wsSum,"सारांश");
        wb.SheetNames.unshift(wb.SheetNames.pop()); // सारांश को पहली sheet बनाओ
        // डिस्प्ले बोर्ड
        if(HSC){
          var hb=[["Field","Value"]];
          Object.keys(HSC).forEach(function(k){hb.push([k,String(HSC[k])]);});
          XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(hb),"डिस्प्ले बोर्ड");
        }
        // इस device के error logs
        var lg=getLogs();
        if(lg.length){
          var lr=[["समय","context","message","extra","user","version","device"]];
          lg.forEach(function(e){if(e)lr.push([e.t||"",e.c||"",e.m||"",e.x||"",e.u||"",e.v||"",e.d||""]);});
          XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(lr),"एरर लॉग");
        }
        var fn="ADEGAON_backup_"+now.toLocaleDateString("en-IN").replace(/\//g,"-")+"_"+String(now.getHours()).padStart(2,"0")+"-"+String(now.getMinutes()).padStart(2,"0")+".xlsx";
        XLSX.writeFile(wb,fn);
        hideLoader();
        toast("💾 पूरा बैकअप download हो गया ("+totalRecs+" records)","ok");
      }catch(err){
        hideLoader();
        logErr("backup",err);
        toast("बैकअप त्रुटि: "+err.message,"err");
      }
    });
  });
}


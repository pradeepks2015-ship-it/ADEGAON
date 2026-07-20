// ─── PHONE ACTION MODAL ───────────────────────────────────────────────────────
function openPhModal(name, phone, acc, amt){
  var clean=phone.replace(/\D/g,"");
  var amtN=Number(amt)||0;
  var msg="नमस्ते "+name+" जी, आपका बिजली संयोजन"+
    (acc?" क्रमांक "+acc:"")+
    " पर वर्तमान माह तक"+
    (amtN?" "+amtN.toLocaleString("hi-IN")+"/- रूपए":"")+
    " बिजली बिल बकाया है। कृपया बिजली ऑफिस, लाइन मैन, अथवा ऑनलाइन माध्यम से शीघ्र भुगतान करें।";
  var sign="\nधन्यवाद,\nआदेगांव बिजली वितरण केंद्र\n(नोट: यदि भुगतान कर दिया है तो कृपया इस संदेश को अनदेखा करें)";
  var waMsg=encodeURIComponent(msg+sign);
  document.getElementById("ph-name").textContent=name;
  document.getElementById("ph-num").textContent="📞 "+phone;
  document.getElementById("ph-call-btn").href="tel:"+clean;
  document.getElementById("ph-sms-btn").href="sms:"+clean+"?body="+encodeURIComponent(msg+sign);
  document.getElementById("ph-wa-btn").href="https://wa.me/91"+clean+"?text="+waMsg;
  document.getElementById("ph-overlay").classList.add("open");
}
function closePhModal(){document.getElementById("ph-overlay").classList.remove("open");}
function closePhOutside(e){if(e.target===document.getElementById("ph-overlay"))closePhModal();}

// ─── SCORECARD ───────────────────────────────────────────────
var scActiveHQ = "";

function openScorecard(){
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
    // paid — सभी categories से unique acc
    CATS.forEach(function(cat){
      var d=cGet(hq,cat);
      d.forEach(function(x){
        if(x.status==="paid"){
          var key=hq+"||"+(x.acc||Math.random());
          if(!allPaidAccs[key]){ allPaidAccs[key]=true; totAmt+=Number(x.amount)||0; }
        }
      });
    });
  });
  totCons+=Object.keys(allAccs).length;
  var totPaid=Object.keys(allPaidAccs).length;
  var totPend=totCons-totPaid;
  var fmt=function(a){return a>=100000?"₹"+(a/100000).toFixed(1)+"L":a>=1000?"₹"+(a/1000).toFixed(1)+"K":"₹"+a;};
  el.innerHTML=
    "<div class='sc-ov-box'><div class='sc-ov-num'>"+totCons+"</div><div class='sc-ov-lbl'>कुल उपभोक्ता</div></div>"+
    "<div class='sc-ov-box'><div class='sc-ov-num' style='color:var(--green)'>"+totPaid+"</div><div class='sc-ov-lbl'>✅ वसूल</div></div>"+
    "<div class='sc-ov-box'><div class='sc-ov-num' style='color:var(--red)'>"+totPend+"</div><div class='sc-ov-lbl'>⏳ बाकी</div></div>"+
    "<div class='sc-ov-box'><div class='sc-ov-num' style='color:var(--gold)'>"+fmt(totAmt)+"</div><div class='sc-ov-lbl'>वसूल राशि</div></div>";
}

function renderScBody(){
  var el=document.getElementById("sc-body");
  var hdr=document.getElementById("sc-date-hdr");
  hdr.textContent="📅 "+scActiveHQ+" — दिनांक-वार वसूली";
  el.innerHTML="<div class='sc-loading'>⏳ लोड हो रहा है...</div>";
  // Fetch all cats for this HQ and aggregate date-wise
  var allLoaded=0;
  var combined=[];
  CATS.forEach(function(cat){
    fbGet(scActiveHQ,cat,function(d){
      combined=combined.concat(d);
      allLoaded++;
      if(allLoaded===CATS.length){
        var fx=reconcileHQ(scActiveHQ);
        if(fx){
          combined=[];
          CATS.forEach(function(c2){combined=combined.concat(cGet(scActiveHQ,c2));});
          toast("🔁 "+fx+" record का status हर tab में मिलाया","inf");
        }
        renderScDateTable(combined);
        buildScOverview([scActiveHQ]);
      }
    });
  });
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
  data.forEach(function(x){
    if(x.status==="paid"&&x.paydate){
      var dt=normPayDate(x.paydate.trim());
      var accKey=x.acc||("__noAcc__"+x.name);
      if(seenAcc[accKey]) return; // duplicate acc — skip
      seenAcc[accKey]=true;
      if(!byDate[dt]) byDate[dt]={count:0,amount:0,names:[],accs:[]};
      byDate[dt].count++;
      byDate[dt].amount+=Number(x.amount)||0;
      byDate[dt].names.push(x.name||"");
      if(x.acc) byDate[dt].accs.push(x.acc);
    }
  });
  var dates=Object.keys(byDate).sort(function(a,b){
    return payDateVal(b)-payDateVal(a); // असली date से desc sort
  });
  if(!dates.length){
    el.innerHTML="<div class='empty'><div class='empty-ico'>📊</div><div class='empty-t'>कोई वसूली नहीं</div><div class='empty-s'>अभी तक कोई भुगतान दर्ज नहीं</div></div>";
    return;
  }
  var totCount=0,totAmt=0;
  var rows=dates.map(function(dt){
    var d=byDate[dt];
    totCount+=d.count; totAmt+=d.amount;
    return "<tr>"+
      "<td style='font-weight:600;'>"+escHtml(dt)+"</td>"+
      "<td style='text-align:center;color:var(--green);font-weight:700;'>"+d.count+"</td>"+
      "<td style='text-align:right;color:var(--gold);font-weight:700;'>₹"+d.amount.toLocaleString("hi-IN")+"</td>"+
      "<td style='color:var(--muted);font-size:10px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'>"+d.names.slice(0,3).join(", ")+(d.names.length>3?" +"+(d.names.length-3):"")+"</td>"+
      "<td style='color:#64b5f6;font-size:10px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'>"+d.accs.slice(0,3).join(", ")+(d.accs.length>3?" +"+(d.accs.length-3):"")+"</td>"+
    "</tr>";
  }).join("");
  // कुल उपभोक्ता CATS[0] से
  var hqTotal=cGet(scActiveHQ,CATS[0]).length||0;
  var pct=hqTotal?((totCount/hqTotal)*100).toFixed(1):"0.0";
  el.innerHTML=
    "<div style='font-size:11px;color:var(--muted);margin-bottom:6px;'>📊 कुल उपभोक्ता: <b style=\'color:var(--fg)\'>"+(hqTotal||"-")+"</b> &nbsp;|&nbsp; वसूल: <b style=\'color:var(--green)\'>"+(totCount)+"</b> &nbsp;|&nbsp; बाकी: <b style=\'color:var(--red)\'>"+(hqTotal-totCount)+"</b> &nbsp;|&nbsp; प्रतिशत: <b style=\'color:var(--gold)\'>"+(pct)+"%</b></div>"+
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

function downloadScPDF(){
  // Gather all HQ data for scorecard PDF
  var hqs=CU.role==="supervisor"?HQS:[CU.hq];
  var rows="";
  hqs.forEach(function(hq){
    var combined=[];
    CATS.forEach(function(cat){combined=combined.concat(cGet(hq,cat));});
    var hqTotal=cGet(hq,CATS[0]).length||0;
    var byDate={};
    var seenAccPDF={};
    combined.forEach(function(x){
      if(x.status==="paid"&&x.paydate){
        var accKey=x.acc||("__noAcc__"+x.name);
        if(seenAccPDF[accKey]) return;
        seenAccPDF[accKey]=true;
        var dt=x.paydate.trim();
        if(!byDate[dt]) byDate[dt]={count:0,amount:0,names:[],accs:[]};
        byDate[dt].count++; byDate[dt].amount+=Number(x.amount)||0;
        byDate[dt].names.push(x.name||'');
        if(x.acc) byDate[dt].accs.push(x.acc);
      }
    });
    var dates=Object.keys(byDate).sort(function(a,b){return b.localeCompare(a);});
    if(!dates.length) return;
    var totC=0,totA=0;
    var hqRows=dates.map(function(dt){
      var d=byDate[dt]; totC+=d.count; totA+=d.amount;
      return "<tr><td>"+escHtml(dt)+"</td><td style='text-align:center;'>"+d.count+"</td><td style='text-align:right;font-weight:700;'>₹"+d.amount.toLocaleString("hi-IN")+"</td><td style='font-size:9px;color:#555;'>"+d.names.slice(0,3).join(", ")+(d.names.length>3?" +"+(d.names.length-3):"")+"</td><td style='font-size:9px;color:#1a237e;'>"+d.accs.slice(0,3).join(", ")+(d.accs.length>3?" +"+(d.accs.length-3):"")+"</td></tr>";
    }).join("");
    var pdfPct=hqTotal?((totC/hqTotal)*100).toFixed(1):"0.0";
    hqRows+="<tr style='background:#e8f5e9;font-weight:700;'><td>कुल ("+pdfPct+"%)</td><td style='text-align:center;'>"+totC+" / "+hqTotal+"</td><td style='text-align:right;'>₹"+totA.toLocaleString("hi-IN")+"</td><td></td><td></td></tr>";
    rows+="<h3 style='color:#4a148c;margin-top:18px;'>📍 "+hq+"</h3>"+
      "<table style='width:100%;border-collapse:collapse;font-size:11px;margin-bottom:10px;'>"+
      "<thead><tr style='background:#4a148c;color:#fff;'><th style='padding:5px;text-align:left;'>दिनांक</th><th style='padding:5px;text-align:center;'>संख्या</th><th style='padding:5px;text-align:right;'>राशि</th><th style='padding:5px;'>उपभोक्ता</th><th style='padding:5px;'>Consumer No</th></tr></thead>"+
      "<tbody>"+hqRows+"</tbody></table>";
  });
  var html="<!DOCTYPE html><html><head><meta charset='UTF-8'>"+
    "<style>body{font-family:Arial,sans-serif;font-size:11px;margin:15px;}h2{color:#4a148c;}td{padding:5px;border-bottom:1px solid #ddd;}"+
    "@media print{.np{display:none}}</style></head><body>"+
    "<h2>&#127942; DC स्कोरकार्ड — दिनांक-वार वसूली</h2>"+
    "<p>दिनांक: <b>"+new Date().toLocaleDateString("hi-IN")+"</b> | "+CU.name+"</p>"+
    "<button class='np' onclick='window.print()' style='margin-bottom:8px;padding:6px 14px;background:#4a148c;color:#fff;border:none;border-radius:5px;cursor:pointer;'>Print / PDF Save</button>"+
    rows+"</body></html>";
  var w=window.open("","_blank");
  if(w){w.document.write(html);w.document.close();setTimeout(function(){w.print();},600);}
  else toast("Popup block है, allow करें","inf");
}


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
if("serviceWorker" in navigator && location.protocol.indexOf("http")===0){
  navigator.serviceWorker.register("sw.js").catch(function(){});
}


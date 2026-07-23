// ─── ग्राम-वार वसूली: गांव खोजें, कनेक्शन/वसूल/Paid Count % देखें (screenshot-friendly तालिका) ───
// डेटा स्रोत: "कुल उपभोक्ता" (मास्टर) श्रेणी का 'addr' field — यही व्यवहार में गांव का नाम रखता है
// JE: सभी HQ के बीच स्विच कर सकते हैं | Lineman: सिर्फ अपने HQ के गांव दिखेंगे
var vgActiveHQ="";
var vgRows=[];

// मिलते-जुलते गांव-नाम (केस/स्पेस भिन्नता तो अपने-आप मर्ज होती है — नीचे सिर्फ अलग-टोकन वाले जोड़े, जो सिर्फ केस बदलने से मर्ज नहीं होते)
var VILLAGE_ALIASES={
  "जोबा":{"PIPARIYA JOBA":"PIPARIYA","KOSAMAGHT":"KOMSAGHAT"},
  "पिंडरई":{"ORAPANI TOLA":"ORAPANI"},
  "पाटन":{
    "KHAKHARIYA TOLA62":"KHAKHARIYA TOLA",
    "JUWAN TOLA":"JUBAN TOLA",
    "JUWANTOLA":"JUBAN TOLA",
    "JOGNI TOLA":"JOGANI TOLA"
  },
  "बीबी":{
    "MOHGAON KACHHI AUR":"MOHGAON KACHHI",
    "MOHGAON KACCHI":"MOHGAON KACHHI",
    "MOHGAON KACHI":"MOHGAON KACHHI",
    "DEVRI":"DEORI",
    "KHAMARIYA KACCHI":"KHAMARIYA KACHHI",
    "KHAMARIYA KACHHI TOLA":"KHAMARIYA KACHHI",
    "KHMRIYA KACHHI":"KHAMARIYA KACHHI",
    "NAVAL GAON":"NAVALGAON",
    "NAWALGAON":"NAVALGAON"
  },
  "मढ़ी":{
    "JUMUA":"JAMUA",
    "REHLI":"RAHLI",
    "KHAMARIYA GUJAR":"KHAMARIYA MADHI"
  }
};
// गांव नाम की तुलना-कुंजी — trim + uppercase से केस/स्पेस भिन्नता अपने-आप मर्ज; ऊपर की सूची से बाकी बचे जोड़े भी मर्ज
function _vgNormKey(hq,name){
  var k=(name||"").trim().toUpperCase().replace(/\s+/g," ");
  var al=VILLAGE_ALIASES[hq];
  if(al&&al[k]) k=al[k];
  return k;
}

function openVillageModal(){
  vgActiveHQ=(CU.role==="supervisor")?activeHQ:CU.hq;
  document.getElementById("vg-search").value="";
  var mn=document.getElementById("logout-menu"); if(mn) mn.classList.remove("open");
  document.getElementById("village-overlay").classList.add("open");
  _vgBuildHQTabs();
  _vgLoadAndRender();
}
function closeVillageModal(){document.getElementById("village-overlay").classList.remove("open");}

function _vgBuildHQTabs(){
  var el=document.getElementById("vg-hq-tabs");
  el.innerHTML="";
  var hqs=CU.role==="supervisor"?HQS:[CU.hq];
  hqs.forEach(function(hq){
    var b=document.createElement("button");
    b.className="hq-tab"+(hq===vgActiveHQ?" active":"");
    b.textContent=hq;
    b.onclick=function(){
      if(hq===vgActiveHQ)return;
      vgActiveHQ=hq;
      document.getElementById("vg-search").value="";
      document.querySelectorAll("#vg-hq-tabs .hq-tab").forEach(function(x){x.classList.remove("active");});
      b.classList.add("active");
      _vgLoadAndRender();
    };
    el.appendChild(b);
  });
}

// एक HQ की "कुल उपभोक्ता" सूची को गांव से समूहित करना — मिलते-जुलते नाम मर्ज (_vgNormKey), unique acc, वर्तमान status + राशि
// प्रदर्शन के लिए हर समूह में जो spelling सबसे ज़्यादा बार आई हो वही दिखेगी
function _vgComputeRows(hq){
  var master=cGet(hq,CATS_DEFAULT[0])||[];
  var byV={};
  master.forEach(function(x){
    if(!x)return;
    var raw=(x.addr||"").trim()||"(गांव दर्ज नहीं)";
    var k=_vgNormKey(hq,raw);
    var key=x.acc?String(x.acc):("_r"+Math.random());
    if(!byV[k]) byV[k]={tot:0,paid:0,bakaya:0,paidAmt:0,seen:{},names:{}};
    byV[k].names[raw]=(byV[k].names[raw]||0)+1;
    if(byV[k].seen[key])return;
    byV[k].seen[key]=1;
    byV[k].tot++;
    if(x.status==="paid"){ byV[k].paid++; byV[k].paidAmt+=Number(x.amount)||0; }
    else byV[k].bakaya+=Number(x.amount)||0;
  });
  var rows=Object.keys(byV).map(function(k){
    var d=byV[k];
    var best=k,bc=-1;
    Object.keys(d.names).forEach(function(n){ if(d.names[n]>bc){bc=d.names[n];best=n;} });
    return {village:best,tot:d.tot,paid:d.paid,bakaya:d.bakaya,paidAmt:d.paidAmt,pct:d.tot?(d.paid/d.tot*100):0};
  });
  rows.sort(function(a,b){return a.village.localeCompare(b.village,"hi");});
  return rows;
}

function _vgFiltered(){
  var q=(document.getElementById("vg-search").value||"").trim().toLowerCase();
  return q?vgRows.filter(function(r){return r.village.toLowerCase().indexOf(q)>-1;}):vgRows;
}

// पूरी HQ की सभी गांव — एक साथ screenshot लेने लायक तालिका (स्कोरकार्ड डिस्प्ले जैसी styling, राशि सहित)
function _vgRenderTable(el,filtered){
  var gTot=0,gPaid=0,gBak=0,gPaidAmt=0;
  filtered.forEach(function(r){gTot+=r.tot;gPaid+=r.paid;gBak+=r.bakaya;gPaidAmt+=r.paidAmt;});
  var gPct=gTot?(gPaid/gTot*100):0;
  var fmt=function(n){return Number(n||0).toLocaleString("hi-IN");};
  var now=new Date();
  var html="<div class='wasc-hdr'><div class='wasc-hdr-t'>&#127961; "+escHtml(vgActiveHQ)+" — ग्राम-वार वसूली स्थिति</div>"+
    "<div class='wasc-hdr-s'>अद्यतन: "+now.toLocaleDateString("hi-IN")+" "+now.toLocaleTimeString("hi-IN",{hour:"2-digit",minute:"2-digit"})+"</div></div>";
  html+="<table class='wasc-table'><thead><tr><th>क्र.</th><th>गांव</th>"+
    "<th>कुल कनेक्शन<br><span class='wasc-sub'>बकाया राशि</span></th>"+
    "<th class='wasc-col-paid'>वसूल<br><span class='wasc-sub'>वसूल राशि</span></th>"+
    "<th>Paid Count %</th></tr></thead><tbody>";
  filtered.forEach(function(r,i){
    html+="<tr><td>"+(i+1)+"</td><td class='wasc-hq'>"+escHtml(r.village)+"</td>"+
      "<td>"+r.tot+"<br><span class='wasc-sub'>&#8377;"+fmt(r.bakaya)+"</span></td>"+
      "<td class='wasc-col-paid'><span class='wasc-paid-num'>"+r.paid+"</span><br><span class='wasc-sub'>&#8377;"+fmt(r.paidAmt)+"</span></td>"+
      "<td>"+r.pct.toFixed(1)+"%</td></tr>";
  });
  html+="</tbody><tfoot><tr><td colspan='2'>योग ("+filtered.length+" गांव)</td>"+
    "<td>"+gTot+"<br><span class='wasc-sub'>&#8377;"+fmt(gBak)+"</span></td>"+
    "<td class='wasc-col-paid'><span class='wasc-paid-num'>"+gPaid+"</span><br><span class='wasc-sub'>&#8377;"+fmt(gPaidAmt)+"</span></td>"+
    "<td>"+gPct.toFixed(1)+"%</td></tr></tfoot></table>";
  el.innerHTML=html;
}

function _vgRenderList(){
  var el=document.getElementById("vg-list");
  var filtered=_vgFiltered();
  if(!filtered.length){el.innerHTML="<div class='log-empty'>कोई गांव नहीं मिला</div>";return;}
  _vgRenderTable(el,filtered);
}

function _vgLoadAndRender(){
  var el=document.getElementById("vg-list");
  el.innerHTML="<div class='log-empty'>⏳ लोड हो रहा है...</div>";
  fbGet(vgActiveHQ,CATS_DEFAULT[0],function(){
    vgRows=_vgComputeRows(vgActiveHQ);
    _vgRenderList();
  });
}

function _vgRefresh(){
  toast("🔄 ताज़ा data लाया जा रहा है...","inf");
  _vgLoadAndRender();
}

// गांव-वार सुधरी Excel — JE: सभी HQ | Lineman: सिर्फ अपना HQ (report जैसी ही scoping)
// मिलते-जुलते गांव-नाम VILLAGE_ALIASES से मर्ज होकर दिखेंगे (असली data नहीं बदलती)
function downloadVillageExcel(){
  if(!CU){toast("पहले login करें","err");return;}
  var hqs=CU.role==="supervisor"?HQS:[CU.hq];
  ensureXLSX(function(ok){
    if(!ok){toast("📴 Excel के लिए इन्टरनेट चाहिए","err");return;}
    toast("⏳ ताज़ा हो रहा है...","inf");
    _cashRefreshAll(hqs,function(){
      var wb=XLSX.utils.book_new();
      var sumRows=[["HQ","गांव","कुल कनेक्शन","बकाया राशि","वसूल","वसूल राशि","Paid Count %"]];
      var grandTot=0;
      hqs.forEach(function(hq){
        var rows=_vgComputeRows(hq);
        var dispByCanon={};
        rows.forEach(function(r){
          sumRows.push([hq,r.village,r.tot,r.bakaya,r.paid,r.paidAmt,r.pct.toFixed(1)+"%"]);
          grandTot+=r.tot;
          dispByCanon[_vgNormKey(hq,r.village)]=r.village;
        });
        var master=cGet(hq,CATS_DEFAULT[0])||[];
        var enriched=master.filter(Boolean).map(function(x){
          return {rec:x,canon:_vgNormKey(hq,(x.addr||"").trim())};
        });
        enriched.sort(function(a,b){
          var va=dispByCanon[a.canon]||"",vb=dispByCanon[b.canon]||"";
          return va.localeCompare(vb,"hi");
        });
        var detRows=[["क्र.","गांव","नाम","पिता/पति","Consumer No","बकाया","Mobile","स्थिति"]];
        enriched.forEach(function(e,i){
          var x=e.rec;
          detRows.push([i+1,dispByCanon[e.canon]||x.addr||"",x.name||"",x.father||"",x.acc||"",Number(x.amount)||0,x.phone||"",x.status==="paid"?"वसूल":"बाकी"]);
        });
        var ws=XLSX.utils.aoa_to_sheet(detRows);
        ws["!cols"]=[{wch:4},{wch:16},{wch:20},{wch:18},{wch:14},{wch:10},{wch:13},{wch:8}];
        XLSX.utils.book_append_sheet(wb,ws,_bkSheetName(hq));
      });
      var wsSum=XLSX.utils.aoa_to_sheet(sumRows);
      wsSum["!cols"]=[{wch:12},{wch:16},{wch:10},{wch:10},{wch:8},{wch:10},{wch:10}];
      XLSX.utils.book_append_sheet(wb,wsSum,"सारांश");
      wb.SheetNames.unshift(wb.SheetNames.pop()); // सारांश पहली sheet
      var now=new Date();
      var fn="ADEGAON_गांव_वार_"+now.toLocaleDateString("en-IN").replace(/\//g,"-")+".xlsx";
      XLSX.writeFile(wb,fn);
      toast("📥 सुधरी Excel download हो गई ("+grandTot+" records)","ok");
    });
  });
}

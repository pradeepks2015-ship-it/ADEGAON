// ─── ग्राम-वार वसूली: गांव खोजें, कई गांव एक साथ चुनें, कनेक्शन/वसूल/Paid Count % देखें ───
// डेटा स्रोत: "कुल उपभोक्ता" (मास्टर) श्रेणी का 'addr' field — यही व्यवहार में गांव का नाम रखता है
// JE: सभी HQ के बीच स्विच कर सकते हैं | Lineman: सिर्फ अपने HQ के गांव दिखेंगे
var vgActiveHQ="";
var vgRows=[];
var vgSelected={}; // village name -> true

function openVillageModal(){
  vgActiveHQ=(CU.role==="supervisor")?activeHQ:CU.hq;
  vgSelected={};
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
      vgActiveHQ=hq; vgSelected={};
      document.getElementById("vg-search").value="";
      document.querySelectorAll("#vg-hq-tabs .hq-tab").forEach(function(x){x.classList.remove("active");});
      b.classList.add("active");
      _vgLoadAndRender();
    };
    el.appendChild(b);
  });
}

// एक HQ की "कुल उपभोक्ता" सूची को गांव (addr) से समूहित करना — unique acc, वर्तमान status
function _vgComputeRows(hq){
  var master=cGet(hq,CATS_DEFAULT[0])||[];
  var byV={};
  master.forEach(function(x){
    if(!x)return;
    var v=(x.addr||"").trim()||"(गांव दर्ज नहीं)";
    var key=x.acc?String(x.acc):("_r"+Math.random());
    if(!byV[v]) byV[v]={tot:0,paid:0,seen:{}};
    if(byV[v].seen[key])return;
    byV[v].seen[key]=1;
    byV[v].tot++;
    if(x.status==="paid") byV[v].paid++;
  });
  var rows=Object.keys(byV).map(function(v){
    var d=byV[v];
    return {village:v,tot:d.tot,paid:d.paid,pct:d.tot?(d.paid/d.tot*100):0};
  });
  rows.sort(function(a,b){return a.village.localeCompare(b.village,"hi");});
  return rows;
}

function _vgFiltered(){
  var q=(document.getElementById("vg-search").value||"").trim().toLowerCase();
  return q?vgRows.filter(function(r){return r.village.toLowerCase().indexOf(q)>-1;}):vgRows;
}

function _vgRenderList(){
  var el=document.getElementById("vg-list");
  el.innerHTML="";
  var filtered=_vgFiltered();
  if(!filtered.length){
    el.innerHTML="<div class='log-empty'>कोई गांव नहीं मिला</div>";
    _vgUpdateSummary();
    return;
  }
  filtered.forEach(function(r){
    var row=document.createElement("label");
    row.className="vg-row";
    var cb=document.createElement("input");
    cb.type="checkbox";
    cb.checked=!!vgSelected[r.village];
    cb.onchange=function(){
      if(cb.checked) vgSelected[r.village]=1; else delete vgSelected[r.village];
      _vgUpdateSummary();
    };
    var name=document.createElement("span"); name.className="vg-name"; name.textContent=r.village;
    var tot=document.createElement("span"); tot.className="vg-tot"; tot.textContent=r.tot+" कनेक्शन";
    var paid=document.createElement("span"); paid.className="vg-paid"; paid.textContent=r.paid+" वसूल";
    var pct=document.createElement("span"); pct.className="vg-pct"; pct.textContent=r.pct.toFixed(1)+"%";
    row.appendChild(cb); row.appendChild(name); row.appendChild(tot); row.appendChild(paid); row.appendChild(pct);
    el.appendChild(row);
  });
  _vgUpdateSummary();
}

function _vgSelectAll(state){
  _vgFiltered().forEach(function(r){
    if(state) vgSelected[r.village]=1; else delete vgSelected[r.village];
  });
  _vgRenderList();
}

function _vgUpdateSummary(){
  var el=document.getElementById("vg-summary");
  var sel=Object.keys(vgSelected);
  if(!sel.length){el.innerHTML="";return;}
  var tot=0,paid=0;
  sel.forEach(function(v){
    var r=vgRows.filter(function(x){return x.village===v;})[0];
    if(r){tot+=r.tot;paid+=r.paid;}
  });
  var pct=tot?(paid/tot*100):0;
  el.innerHTML="<div class='vg-sum-box'><div class='vg-sum-t'>चुने गए "+sel.length+" गांव — जोड़</div>"+
    "<div class='vg-sum-nums'><span>"+tot+" कनेक्शन</span><span class='vg-sum-paid'>"+paid+" वसूल</span><span>"+pct.toFixed(1)+"% Paid Count</span></div></div>";
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

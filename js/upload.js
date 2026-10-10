// ─── UPLOAD MODAL ────────────────────────────────────────────
function updateUpCounter(){
  var hq=document.getElementById("up-hq").value;
  var cat=document.getElementById("up-cat").value;
  var exist=0;
  if(hq&&cat) exist=cGet(hq,cat).length;
  var maxR=getMaxRecords(cat||activeCat);
  var avail=Math.max(0,maxR-exist);
  document.getElementById("cnt-exist").textContent=String(exist);
  document.getElementById("cnt-avail").textContent=String(avail);
  document.getElementById("cnt-avail").title="Limit: "+maxR;
  // file count if already parsed
  var fileWrap=document.getElementById("cnt-file-wrap");
  if(parsedRows.length){
    fileWrap.style.display="block";
    document.getElementById("cnt-file").textContent=String(parsedRows.length);
  } else {
    fileWrap.style.display="none";
  }
  // limit warning
  var lw=document.getElementById("cnt-limit-warn");
  lw.style.display=(exist>=maxR)?"block":"none";
  // disable upload if limit full and merge mode
  if(exist>=maxR && upMode==="merge"){
    document.getElementById("btn-up-ok").disabled=true;
    document.getElementById("btn-up-ok").style.opacity=".5";
  }
}

// अपलोड वाली श्रेणी-सूची हमेशा *चुने हुए* मुख्यालय के मौजूदा नामों से बनाओ।
// पहले ये विकल्प index.html में hardcoded थे और सिर्फ़ slots 4-7 सिंक होते थे — दो नतीजे:
//   (क) v9.124 से घरेलू/व्यवसाय/कृषि भी बदले जा सकते हैं, पर यहाँ पुराने नाम ही दिखते रहते,
//       इसलिए JE बदली हुई श्रेणी में लिस्ट अपलोड ही नहीं कर पाते थे;
//   (ख) modal के अपने HQ-चयन से दूसरा मुख्यालय चुनने पर भी नाम पिछले HQ के ही रहते — यानी
//       "मढ़ी" चुनकर आदेगांव के नाम पर अपलोड हो जाता, यानी ग़लत पते पर (यह ज़्यादा ख़तरनाक था)
function _buildUpCatOptions(){
  var hqSel=document.getElementById("up-hq");
  var hq=(hqSel&&hqSel.value)||activeHQ;
  var sel=document.getElementById("up-cat");
  if(!sel) return;
  var prev=sel.value;
  sel.innerHTML="";
  var o0=document.createElement("option"); o0.value=""; o0.textContent="-- चुनें --";
  sel.appendChild(o0);
  CATS_DEFAULT.forEach(function(_,i){
    var name=isCatEditable(i)?getCatName(hq,i):CATS_DEFAULT[i];
    var o=document.createElement("option");
    // textContent/value — नाम JE का टाइप किया हुआ है, कभी HTML बनकर न जाए
    o.value=name; o.textContent=name;
    sel.appendChild(o);
  });
  // HQ बदलने पर पुराना चुनाव तभी बचाओ जब नए मुख्यालय में भी वही नाम मौजूद हो
  sel.value=prev;
  if(sel.value!==prev) sel.value="";
}
function onUpHqChange(){
  _buildUpCatOptions();
  onCatChange();
  updateUpCounter();
}
function openUpModal(){
  if(!CU||CU.role!=="supervisor"){toast("सिर्फ JE लिस्ट अपलोड कर सकते हैं","err");return;}
  var sel=document.getElementById("up-hq"); sel.innerHTML="";
  var hqs=CU.role==="supervisor"?HQS:[CU.hq];
  hqs.forEach(function(hq){var o=document.createElement("option");o.value=hq;o.textContent=hq;sel.appendChild(o);});
  sel.value=activeHQ;
  _buildUpCatOptions(); // HQ तय होने के *बाद* — तभी सही मुख्यालय के नाम बनेंगे
  document.getElementById("up-cat").value=activeCat;
  var hint=document.getElementById("cat-hint");
  if(hint) hint.style.display="none";
  onCatChange();
  parsedRows=[];
  document.getElementById("uz-ico").textContent="📂";
  document.getElementById("uz-t").textContent="CSV या Excel फ़ाइल चुनें";
  document.getElementById("file-input").value="";
  document.getElementById("up-preview").style.display="none";
  document.getElementById("btn-up-ok").disabled=true;
  document.getElementById("btn-up-ok").style.opacity=".5";
  setUpMode("merge"); // DEFAULT: merge
  // डिफ़ॉल्ट कट-ऑफ़ = चालू महीने की 1 तारीख़ — नया लेजर आने पर पिछले माह की वसूली आगे न जाए,
  // पर 1-10 की खिड़की में इसी माह दर्ज हुई वसूली बनी रहे (देखें confirmUpload)
  var kf=document.getElementById("up-keepfrom");
  if(kf){ var n=new Date(); kf.value=n.getFullYear()+"-"+("0"+(n.getMonth()+1)).slice(-2)+"-01"; }
  _upKeepToggle();
  updateUpCounter();
  document.getElementById("up-overlay").classList.add("open");
}

// checkbox बंद हो तो तारीख़ वाला हिस्सा भी छुप जाए
function _upKeepToggle(){
  var el=document.getElementById("up-keepfrom-wrap");
  var cb=document.getElementById("up-keeppaid");
  if(el) el.style.display=(cb&&cb.checked)?"block":"none";
  _upKeepPreview();
}

// चुनी तारीख़ से कितने उपभोक्ताओं की वसूली आगे जाएगी — अपलोड से पहले ही साफ़ दिखे
// (सिर्फ़ पहले से मौजूद local list पर गिनती — कोई network call नहीं)
function _upKeepPreview(){
  var note=document.getElementById("up-keepnote");
  if(!note) return;
  var cb=document.getElementById("up-keeppaid");
  if(!cb||!cb.checked){ note.textContent=""; return; }
  var hq=document.getElementById("up-hq")?document.getElementById("up-hq").value:activeHQ;
  var cat=document.getElementById("up-cat")?document.getElementById("up-cat").value:activeCat;
  var cut=_upKeepCutoff();
  var ex=cGet(hq,cat)||[];
  var keep=0,drop=0;
  ex.forEach(function(e){
    if(!e||!e.acc||e.status!=="paid") return;
    if(latestPayVal(e)>=cut) keep++; else drop++;
  });
  note.textContent="🛡 "+keep+" उपभोक्ता की वसूली बनी रहेगी"+(drop?"  •  🧹 "+drop+" पुरानी (पिछले लेजर की) हट जाएगी":"");
}

// इस मुख्यालय के सभी बटनों में कितने अलग-अलग उपभोक्ता "वसूल" हैं — checkbox हटाकर अपलोड करने
// पर चेतावनी में यही संख्या दिखती है। एक ही acc कई categories में होता है, इसलिए unique गिनती
function _upCountPaid(hq){
  var seen={};
  for(var i=0;i<CATS_DEFAULT.length;i++){
    var cat=isCatEditable(i)?getCatName(hq,i):CATS_DEFAULT[i];
    (cGet(hq,cat)||[]).forEach(function(x){
      if(x&&x.status==="paid"&&x.acc) seen[String(x.acc).trim()]=1;
    });
  }
  return Object.keys(seen).length;
}
// sweepStalePaid() को "सब कुछ हटाओ" कहने का तरीक़ा — कोई असली भुगतान तारीख़ इससे बड़ी नहीं हो
// सकती (payDateVal yyyymmdd देता है), इसलिए हर "वसूल" पुरानी मानी जाती है
var SWEEP_ALL_CUT=99999999;
// चुनी हुई तारीख़ को payDateVal जैसे तुलना-योग्य अंक (yyyymmdd) में बदलें
function _upKeepCutoff(){
  var kf=document.getElementById("up-keepfrom");
  var v=kf&&kf.value?kf.value:""; // yyyy-mm-dd
  var m=v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return 0; // तारीख़ न हो तो पुराना व्यवहार (सब रखो)
  return (+m[1])*10000+(+m[2])*100+(+m[3]);
}
function onCatChange(){
  var cat=document.getElementById("up-cat").value;
  var hint=document.getElementById("cat-hint");
  // कौन-सा slot चुना गया — नाम से नहीं, *चुने हुए मुख्यालय* के नामों में ढूंढकर। पहले यहाँ
  // CATS[6]/CATS[7] से तुलना होती थी, जो हमेशा मौजूदा HQ के नाम होते हैं; modal में दूसरा
  // मुख्यालय चुना हो तो वह तुलना ग़लत slot बताती
  var hqSel=document.getElementById("up-hq");
  var hq=(hqSel&&hqSel.value)||activeHQ;
  var slot=-1;
  for(var i=0;i<CATS_DEFAULT.length;i++){
    if((isCatEditable(i)?getCatName(hq,i):CATS_DEFAULT[i])===cat){ slot=i; break; }
  }
  // कुल उपभोक्ता के लिए auto Replace mode
  if(slot===0){
    setUpMode("replace");
  }
  if(!hint) return;
  if(slot===0){
    hint.style.display="block";
    hint.innerHTML="👥 <b>कुल उपभोक्ता</b> — अधिकतम <b>3500</b> records | <b>Net Bill/Amount optional</b> है<br>"+
      "जरूरी columns: <b>Consumer No</b> और <b>Consumer Name</b> बस काफी है";
  } else if(slot===6){
    hint.style.display="block";
    hint.innerHTML="📋 <b>"+escHtml(cat)+"</b> — अधिकतम <b>1000</b> records | Consumer No, Name और Net Bill जरूरी";
  } else if(slot===7){
    hint.style.display="block";
    hint.innerHTML="📌 <b>"+escHtml(cat)+"</b> — अधिकतम <b>1000</b> records | Consumer No, Name और Net Bill जरूरी";
  } else if(cat){
    hint.style.display="block";
    hint.innerHTML="📂 <b>"+escHtml(cat)+"</b> — अधिकतम <b>1000</b> records | Consumer No, Name और Net Bill जरूरी";
  } else {
    hint.style.display="none";
  }
}
function closeUpModal(){document.getElementById("up-overlay").classList.remove("open");}
function closeUpOutside(e){if(e.target===document.getElementById("up-overlay"))closeUpModal();}
function setUpMode(m){
  upMode=m;
  document.getElementById("mode-rep").className="topt"+(m==="replace"?" sel-pending":"");
  document.getElementById("mode-mrg").className="topt"+(m==="merge"?" sel-blue":"");
  updateUpCounter();
}
function dOver(e){e.preventDefault();document.getElementById("up-zone").classList.add("drag");}
function dLeave(){document.getElementById("up-zone").classList.remove("drag");}
function dDrop(e){e.preventDefault();dLeave();handleFile(e.dataTransfer.files[0]);}

// हर नई फ़ाइल-selection का अपना token — बड़ी फ़ाइल (जैसे 3500 records वाली) पढ़ने में समय लगता है,
// उस बीच कोई दूसरी फ़ाइल चुन ली जाए तो पुराना (धीमा) पढ़ना बाद में पूरा होकर नए वाले को overwrite कर
// सकता था (जैसे Adegaon की फ़ाइल का data देर से आकर Pindrai के ऊपर चढ़ जाना) — असली bug यही था
var _handleFileToken=0;
function handleFile(f){
  if(!f)return;
  var myToken=++_handleFileToken;
  document.getElementById("uz-ico").textContent="⏳";
  document.getElementById("uz-t").textContent=f.name;
  var n=f.name.toLowerCase();
  var isXl=n.endsWith(".xlsx")||n.endsWith(".xls");
  // पहले यहां "typeof XLSX==='undefined' तो हार मान लो" था — वह सिर्फ़ इसलिए चल जाता था कि
  // index.html दोनों lib पहले ही (पेज रोककर) उतार चुका होता था। अब lib ज़रूरत पड़ने पर उतरती है,
  // इसलिए उसके उतरने का इंतज़ार करना पड़ता है (देखें storage.js: ensureXLSX/ensurePapa)।
  // सच में नेट न हो या lib न उतर पाए, तभी वही पुराना संदेश दिखता है
  function _libFail(what){
    toast("📴 "+what+" पढ़ने के लिए इन्टरनेट चाहिए — नेट आने पर दोबारा try करें","err");
    document.getElementById("uz-ico").textContent="📂";
  }
  if(isXl){
    ensureXLSX(function(ok){
      if(myToken!==_handleFileToken)return; // इस बीच कोई नई फ़ाइल चुन ली गई
      if(!ok){_libFail("Excel");return;}
      var rd=new FileReader();
      rd.onload=function(e){
        if(myToken!==_handleFileToken)return; // यह पुराना (stale) परिणाम है
        try{
          var wb=XLSX.read(e.target.result,{type:"array"});
          processRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:"",raw:false}));
        }catch(ex){logErr("excel-parse",ex,f.name);toast("Excel त्रुटि: "+ex.message,"err");}
      };
      rd.readAsArrayBuffer(f);
    });
  } else {
    ensurePapa(function(ok){
      if(myToken!==_handleFileToken)return;
      if(!ok){_libFail("CSV");return;}
      var rd2=new FileReader();
      rd2.onload=function(e){
        if(myToken!==_handleFileToken)return;
        var result=Papa.parse(e.target.result,{header:true,skipEmptyLines:true});
        if(result.data&&result.data.length) processRows(result.data);
        else toast("CSV में data नहीं मिला","err");
      };
      rd2.readAsText(f,"UTF-8");
    });
  }
}

// Fuzzy column finder — case-insensitive, ignores spaces/symbols, partial match fallback
function fuzzyFind(k, patterns){
  // k = {normalized_header: value} where normalized = lowercase trimmed
  // First pass: exact alphanumeric match
  for(var pi=0;pi<patterns.length;pi++){
    var pNorm=patterns[pi].toLowerCase().replace(/[^a-z0-9\u0900-\u097f]/g,"");
    for(var ki in k){
      var kNorm=ki.replace(/[^a-z0-9\u0900-\u097f]/g,"");
      if(kNorm===pNorm) return k[ki]||"";
    }
  }
  // Second pass: partial match
  for(var pi2=0;pi2<patterns.length;pi2++){
    var pNorm2=patterns[pi2].toLowerCase().replace(/[^a-z0-9\u0900-\u097f]/g,"");
    for(var ki2 in k){
      var kNorm2=ki2.replace(/[^a-z0-9\u0900-\u097f]/g,"");
      if(kNorm2.length>2&&(kNorm2.indexOf(pNorm2)!==-1||pNorm2.indexOf(kNorm2)!==-1)) return k[ki2]||"";
    }
  }
  return "";
}

function processRows(rows){
  var valid=[],errors=[];
  var now=new Date();
  var dtStr=now.toLocaleString("hi-IN");
  rows.forEach(function(r,i){
    var k={};
    Object.keys(r).forEach(function(h){
      // normalize: lowercase, trim, collapse spaces — keep all chars for fuzzyFind
      var clean=h.toString().trim().toLowerCase();
      k[clean]=String(r[h]).trim();
    });
    var name=fuzzyFind(k,["consumername","consumer name","cname","name","naam","नाम"]).trim();
    var acc=fuzzyFind(k,["consumernumber","consumer number","consumerno","consumer no","accountno","account no","ivrs","ivrs no","ivrsno","consumerid","consumer id","acc","conno","con no"]).trim();
    var rawAmt=fuzzyFind(k,["netbill","net bill","netamt","net amt","netamount","net amount","amount","dues","arrear","arrears","balance","bill","बकाया","देय राशि"]).replace(/,/g,"").replace(/[₹\s]/g,"").trim();
    var phone=fuzzyFind(k,["mobileno","mobile no","mobile","mobilenumber","mobile number","phone","mob","contact","contactno","contact no","phoneno","phone no"]).trim();
    var addr=fuzzyFind(k,["address","addr","adress","add","village","gram","location","स्थान","पता","ग्राम"]).trim();
    var rem=fuzzyFind(k,["remark","remarks","note","notes","comment","comments","टिप्पणी"]).trim();
    var tariff=fuzzyFind(k,["tariff","tariffcode","tarrif","tarrifcode","tarifftype","tarifcode","टैरिफ"]).trim();
    var load=fuzzyFind(k,["load","sanctionedload","sanctioned load","connectedload","connected load","loadkw","लोड"]).trim();
    var unit=fuzzyFind(k,["unit","units","consumption","unitsconsumed","units consumed","यूनिट"]).trim();
    var lastPayDate=fuzzyFind(k,["lastpaiddate","last paid date","lastpaymentdate","last payment date","lastpaydate","last pay date","lastdate","last date","prevpaydate","prev pay date","previouspaymentdate","previous payment date","prevdate","prev date","paymentdate","payment date","piclatithe","पिछली तिथि","पिछला दिनांक"]).trim();
    var father=fuzzyFind(k,["fathername","father name","fname","pitaname","pita","fathernamme","fathrname","father","pitaji","f name","fathernam","पिता","पिता का नाम","पिताजी","guardian","guardianname","guardian name","husbandname","husband name","husband","fathersname","father's name","fath","pitanaam","pita naam","dadaname","dada name","fathername1","f_name","s/o","s.o","w/o","w.o","d/o","d.o","sonof","son of","wifeof","wife of","daughterof","daughter of","relation","relativename","relative name","paternalnm","fathernm","pitatype","पति","पिता/पति","पिताजी का नाम","अभिभावक","गार्जियन"]).trim();
    var lastPaidAmt=fuzzyFind(k,["lastpaidamt","last paid amt","lastpaid","last paid","lastamt","last amt","lastpaidamount","last paid amount","lastpaymentamt","last payment amt","lastpaymentamount","last payment amount","prevamt","prev amt","previousamt","previous amt","previouspaidamt","previous paid amt","prevpaid","prev paid","lastbill","last bill","previousbill","previous bill","पिछला भुगतान","पिछली राशि"]).replace(/,/g,"").replace(/[₹\s]/g,"").trim();
    // "कुल उपभोक्ता" में amount optional है
    var _upCat=document.getElementById("up-cat")?document.getElementById("up-cat").value:"";
    var amtOptional=(_upCat==="कुल उपभोक्ता"||_upCat===CATS[0]);

    var cleanAmt=rawAmt;
    // amount साफ करें — कॉमा, रुपया चिह्न, spaces हटाएं
    if(cleanAmt) cleanAmt=cleanAmt.replace(/,/g,"").replace(/[₹\s]/g,"").replace(/[^0-9.-]/g,"").trim();

    var rowOk=name&&acc&&(amtOptional||(cleanAmt&&!isNaN(cleanAmt)));
    if(!rowOk){
      errors.push({row:i+2, reason:!name?"नाम नहीं":!acc?"Consumer No नहीं":(!amtOptional&&!cleanAmt)?"राशि नहीं":"राशि गलत"});
    } else {
      var finalAmt=cleanAmt||"0";
      var entry={name:name,acc:acc,amount:finalAmt,phone:phone,addr:addr,father:father,remarks:rem,
        tariff:tariff,load:load,unit:unit,lastPayDate:lastPayDate,lastPaidAmt:lastPaidAmt,
        status:"pending",uploadedBy:CU.name,uploadedAt:dtStr,ts:serverNow(),remarksArr:[]};
      // बकाया 0 या minus हो तो अपने आप वसूल
      if(cleanAmt!=="" && !isNaN(cleanAmt) && Number(cleanAmt)<=0){
        entry.status="paid";
        entry.paydate=new Date().toLocaleDateString("hi-IN");
        entry.updatedBy=CU.name+" (बकाया ≤0 auto)";
        entry.updatedAt=dtStr;
      }
      if(rem) entry.remarksArr.push({text:rem,by:CU.name,at:dtStr});
      valid.push(entry);
    }
  });
  var _cat=document.getElementById("up-cat")?document.getElementById("up-cat").value:activeCat;
  parsedRows=valid.slice(0,getMaxRecords(_cat));
  document.getElementById("up-preview").style.display="block";
  var wb2=document.getElementById("up-warn");
  if(errors.length){
    wb2.style.display="block";
    var errMsg="⚠️ "+errors.length+" rows skip — ";
    var details=errors.slice(0,3).map(function(e){return "Row "+e.row+": "+e.reason;}).join(" | ");
    wb2.textContent=errMsg+details+(errors.length>3?" ...और "+(errors.length-3)+" rows":"");
  } else {
    wb2.style.display="none";
    wb2.textContent="";
  }
  document.getElementById("prev-title").textContent="पूर्वावलोकन ("+parsedRows.length+" records)";
  // audit-verified: नीचे हर r.name/r.father/r.acc escHtml() से गुज़रता है
  // eslint-disable-next-line no-unsanitized/property
  document.getElementById("prev-rows").innerHTML=parsedRows.slice(0,5).map(function(r,i){
    return "<div class='prev-row'><span class='pr-name'>"+(i+1)+". "+escHtml(r.name)+(r.father?" / "+escHtml(r.father):"")+"</span><span class='pr-acc'>"+escHtml(r.acc)+"</span><span class='pr-amt'>₹"+Number(r.amount).toLocaleString("hi-IN")+"</span></div>";
  }).join("");
  document.getElementById("uz-ico").textContent=parsedRows.length?"✅":"❌";
  document.getElementById("uz-t").textContent=parsedRows.length+" valid records";
  // Update counter with file info
  document.getElementById("cnt-file-wrap").style.display="block";
  document.getElementById("cnt-file").textContent=String(parsedRows.length);
  updateUpCounter();
  // Enable button if any valid records found
  var canUpload=parsedRows.length>0;
  document.getElementById("btn-up-ok").disabled=!canUpload;
  document.getElementById("btn-up-ok").style.opacity=canUpload?"1":".5";
}

// ── अपलोड में पुराने रिमार्क सुरक्षित — JE की शिकायत (बीबी): कल डाले रिमार्क आज गायब ──
// Replace/"हटाएं → अपलोड" में पहले सिर्फ़ "वसूल" उपभोक्ताओं के रिमार्क नई सूची में जाते थे, बाकी
// (अवसूल) उपभोक्ताओं के सब मिट जाते थे। और नई सूची (जैसे JE की कोई खास सूची) में आया उपभोक्ता
// बाकी categories में पहले से पड़े अपने रिमार्क के बिना आता था। अब इस HQ की हर category (इसी समेत)
// की device-कॉपी + "हटाएं" के समय बना backup (7 दिन, देखें fbDel) — सबसे उसी Consumer No के
// रिमार्क इकट्ठा करके नई सूची के record में जोड़े जाते हैं (text|by|at से dedup — दोहराव नहीं)
var RMK_BK_MAX_AGE_MS=7*24*60*60*1000;
function _upCollectOldRemarks(hq,cat){
  var byAcc={};
  function add(acc,arr,srcCat){
    if(!acc||!arr||!arr.length) return;
    var k=String(acc).trim();
    var list=byAcc[k]||(byAcc[k]=[]);
    arr.forEach(function(r){
      if(!r||!r.text) return;
      var e=JSON.parse(JSON.stringify(r));
      // दूसरी category से आया और मूल-category टैग नहीं है — 📁 टैग के लिए जोड़ दें (openRmkModal)
      if(!e.cat&&srcCat&&srcCat!==cat) e.cat=srcCat;
      list.push(e);
    });
  }
  for(var i=0;i<CATS_DEFAULT.length;i++){
    var c=isCatEditable(i)?getCatName(hq,i):CATS_DEFAULT[i];
    (cGet(hq,c)||[]).forEach(function(x){ if(x) add(x.acc,x.remarksArr,c); });
  }
  ["vt_rmkbk_","vt_paidbk_"].forEach(function(pre){
    try{
      var raw=localStorage.getItem(pre+cKey(hq,cat));
      if(!raw) return;
      var o=JSON.parse(raw);
      if(Date.now()-(o.t||0)>=RMK_BK_MAX_AGE_MS) return;
      Object.keys(o.m||{}).forEach(function(acc){
        var v=o.m[acc];
        add(acc,Array.isArray(v)?v:(v&&v.remarksArr),cat);
      });
    }catch(e){}
  });
  return byAcc;
}
// पुराने रिमार्क पहले, फ़ाइल में आया रिमार्क (अगर हो) आखिर में — दोहराव हटाकर। लौटाता है कितने
// records में कुछ जुड़ा
function _upApplyOldRemarks(recs,byAcc){
  var n=0;
  (recs||[]).forEach(function(r){
    if(!r||!r.acc) return;
    var old=byAcc[String(r.acc).trim()];
    if(!old||!old.length) return;
    var seen={},out=[];
    old.concat(r.remarksArr||[]).forEach(function(x){
      var k=rmkKeyOf(x);
      if(!seen[k]){ seen[k]=1; out.push(x); }
    });
    if(out.length===(r.remarksArr||[]).length) return;
    r.remarksArr=out;
    r.remarks=out[out.length-1].text; // backward-compat field — saveRmk जैसा ही
    n++;
  });
  return n;
}

function confirmUpload(){
  try{
    var hq=document.getElementById("up-hq").value;
    var cat=document.getElementById("up-cat").value;
    if(!hq){toast("HQ चुनें","err");return;}
    if(!cat){toast("Category चुनें","err");return;}
    if(!parsedRows||!parsedRows.length){toast("कोई valid डेटा नहीं — पहले file select करें","err");return;}
    
    var arr=parsedRows.slice(); // always use all parsed rows
    
    if(upMode==="merge"){
      var ex=cGet(hq,cat)||[];
      var _maxR=getMaxRecords(cat);
      if(ex.length>0){
        var merged=ex.slice();
        var added=0,dupes=0,newRecs=[];
        arr.forEach(function(r){
          if(merged.find(function(e){return e.acc===r.acc;})){dupes++;}
          else if(merged.length<_maxR){merged.push(r);newRecs.push(r);added++;}
        });
        // नए जुड़े उपभोक्ता बाकी categories में पहले से हों तो उनके रिमार्क साथ आएं (पुराने records अछूते)
        var rmkKeptM=_upApplyOldRemarks(newRecs,_upCollectOldRemarks(hq,cat));
        arr=merged;
        var msg="✅ "+added+" नए जोड़े";
        if(rmkKeptM) msg+=" | 💬 "+rmkKeptM+" के रिमार्क साथ आए";
        if(dupes>0) msg+=" | "+dupes+" duplicate skip";
        msg+=" | कुल: "+arr.length+"/"+_maxR;
        _doSave(hq,cat,arr);
        // इस HQ की किसी और category में वसूल हो चुके acc (या इसी अपलोड से नए वसूल हुए) दोनों
        // तरफ़ मिल जाएं — देखें नीचे reconcileHQ वाला मुख्य comment
        var _rec1=reconcileHQ(hq);
        if(_rec1) msg+=" | 🔁 "+_rec1+" अन्य categories में मिलाया";
        toast(msg,"ok"); return;
      }
    }

    // Replace mode (या merge मोड में खाली category — ऊपर वाला block तभी चलता है जब ex.length>0) —
    // फ़ाइल में ही duplicate Consumer No हो सकता है (जैसे मीटर बदलने पर वही उपभोक्ता दो बार चढ़ आना)।
    // Merge mode के उलट यहां पहले कोई जांच नहीं थी — असली production bug (JE की रिपोर्ट, मढ़ी):
    // एक ही Consumer No के दो अलग card एक साथ दिखते, और migrated (per-record) श्रेणी में दोनों की
    // Firebase-key वही acc होती, तो एक को "वसूल" मार्क करने पर patch उसी key पर टकराता — array में
    // जो record बाद में आए वही जीतता, दूसरे की वसूली चुपचाप overwrite हो सकती थी।
    // अब पहला occurrence रखें, बाकी skip — ठीक Merge mode जैसा ही नियम
    var dupSkip=0;
    (function(){
      var seenAcc={};
      arr=arr.filter(function(r){
        if(!r.acc) return true; // acc-रहित record अपनी अलग समस्या है (चरण 3 पकड़ता है), यहां न छेड़ें
        var k=String(r.acc).trim();
        if(seenAcc[k]){dupSkip++;return false;}
        seenAcc[k]=1;
        return true;
      });
    })();

    // Replace mode या पहली बार — पुरानी वसूली सुरक्षित रखें (checkbox on हो तो)
    var kept=0,dropped=0;
    // इस category की जो वसूली नई सूची में नहीं जा रही (कट-ऑफ़ से पुरानी, या checkbox हटा दिया
    // गया) उसका backup — नीचे _doSave से ठीक पहले लिखा जाता है। sweepStalePaid दूसरी categories
    // का backup ख़ुद रखता है, पर इस category की पुरानी वसूली तो उससे पहले ही हट चुकी होती है
    // (नई सूची सेव हो जाती है), इसलिए उसे यहीं पकड़ना पड़ता है — वरना ग़लती से checkbox हटाने पर
    // ठीक उसी सूची की वसूली लौटाने का कोई रास्ता नहीं बचता जिसमें अपलोड हुआ
    var _lostPaid={};
    var keepEl=document.getElementById("up-keeppaid");
    // कट-ऑफ़ तारीख़ अब if-block के बाहर निकाली है — नीचे sweepStalePaid() को भी यही चाहिए,
    // और वह checkbox की स्थिति से बंधा नहीं (पुरानी वसूली दूसरे बटनों से हटाना दोनों हाल में सही है)
    var _cut=_upKeepCutoff();
    // JE ने checkbox हटा दिया = "कोई पुरानी वसूली मत रखो"। पहले यह अधूरा चलता था: इस category की
    // वसूली तो नहीं जाती थी, पर अपलोड के बाद reconcileHQ() दूसरे बटनों से वही वसूल वापस खींच लाता
    // ("किसी एक में वसूल = सब में वसूल")। यानी ऐप वह करता ही नहीं था जो JE ने कहा — और चुपचाप।
    // अब checkbox हटाने का मतलब पूरे मुख्यालय से पुरानी वसूली हटाना है, इसलिए पहले साफ़ चेतावनी
    // देकर पूछते हैं — "हां" पर ही आगे बढ़ते हैं, वरना अपलोड शुरू ही नहीं होता (कुछ नहीं बदलता)
    if(keepEl&&!keepEl.checked){
      var _willLose=_upCountPaid(hq);
      if(_willLose&&!confirm("⚠️ "+hq+" के सभी बटनों से "+_willLose+" उपभोक्ताओं की वसूली मिट जाएगी।\n\nसिर्फ़ इस सूची की वसूली रखनी हो तो ऊपर \"पुरानी वसूली सुरक्षित रखें\" पर सही का निशान लगाएं।\n\n(ग़लती हो जाए तो 7 दिन के अंदर वही लेजर checkbox लगाकर दोबारा अपलोड करने पर वसूली लौट आएगी।)\n\nक्या वाकई आगे बढ़ें?")){
        toast("अपलोड रोक दिया — कुछ नहीं बदला","inf");
        return;
      }
      // checkbox हटा है — इस category की सारी पुरानी वसूली जा रही है, सबका backup रखो
      (cGet(hq,cat)||[]).forEach(function(e){
        if(e&&e.acc&&e.status==="paid") _lostPaid[String(e.acc).trim()]=paidBkEntry(e);
      });
    }
    if(!keepEl||keepEl.checked){
      // सिर्फ़ चुनी तारीख़ (डिफ़ॉल्ट: चालू माह की 1) से दर्ज वसूली ही नए लेजर में जाए।
      // पहले यहां कोई तारीख़-जांच नहीं थी — पिछले लेजर का हर "वसूल" नए लेजर में भी चिपक जाता था,
      // इसलिए जिसने नया बिल जमा नहीं किया वो भी "वसूल" दिखता, लाइनमैन उस तक जाता ही नहीं और
      // वसूली चुपचाप छूट जाती — असली bug यही था। अब पिछले माह वाले हट जाते हैं, पर 1-10 तारीख़ की
      // खिड़की में (जब पुराना लेजर ही ऐप में होता है) दर्ज हुई वसूली बनी रहती है
      var exOld=cGet(hq,cat)||[];
      var paidByAcc={};
      exOld.forEach(function(e){
        if(e&&e.acc&&e.status==="paid"){
          if(_cut&&latestPayVal(e)<_cut){ dropped++; _lostPaid[String(e.acc).trim()]=paidBkEntry(e); return; } // पिछले लेजर की — आगे न ले जाएं
          paidByAcc[String(e.acc).trim()]={paydate:e.paydate||"",by:e.updatedBy||"",at:e.updatedAt||"",ts:e.ts||0,remarksArr:e.remarksArr||[]};
        }
      });
      // "हटाएं" के बाद upload हो रहा हो तो backup से भी वसूली वापस लें (7 दिन)
      try{
        var bkRaw=localStorage.getItem("vt_paidbk_"+cKey(hq,cat));
        if(bkRaw){
          var bkO=JSON.parse(bkRaw);
          if(Date.now()-(bkO.t||0)<604800000){
            // backup से वापस लेते समय भी वही तारीख़-कट-ऑफ़ लगे, वरना पिछले लेजर की वसूली
            // पिछले दरवाज़े से नए लेजर में लौट आती
            Object.keys(bkO.m||{}).forEach(function(k){
              if(paidByAcc[k]) return;
              var bm=bkO.m[k];
              if(_cut&&latestPayVal({status:"paid",paydate:bm&&bm.paydate})<_cut){ dropped++; return; }
              paidByAcc[k]=bm;
            });
          }
        }
      }catch(e){}
      arr.forEach(function(r){
        var pm=paidByAcc[String(r.acc).trim()];
        if(pm&&r.status!=="paid"){
          r.status="paid";r.paydate=pm.paydate;
          if(pm.by){r.updatedBy=pm.by;r.updatedAt=pm.at;}
          r.ts=pm.ts||r.ts;kept++;
        }
      });
    }
    // रिमार्क "वसूली सुरक्षित रखें" checkbox से बंधे नहीं — वसूल हो या बाकी, हर उपभोक्ता के पुराने
    // रिमार्क नई सूची में जाएं (पहले सिर्फ़ ऊपर वाले paid-restore में जाते थे)
    var rmkKept=_upApplyOldRemarks(arr,_upCollectOldRemarks(hq,cat));
    // backup अब लिखें — पहले नहीं, क्योंकि ऊपर वाला restore ख़ुद पुराना vt_paidbk_ पढ़ता है
    // (पहले लिख देते तो वही backup मिट जाता जिससे वसूली लौटनी थी)
    savePaidBackup(hq,cat,_lostPaid);
    _doSave(hq,cat,arr);
    // reconcileHQ से पहले: बाक़ी categories में पड़ी पिछले लेजर की वसूली हटाएं, वरना वही
    // "किसी एक में वसूल = सब में वसूल" नियम से नए लेजर में लौट आती (देखें list.js: sweepStalePaid)।
    // checkbox हटाया गया हो तो कट-ऑफ़ नहीं, सारी वसूली हटती है — JE ऊपर पुष्टि दे चुके हैं
    var _swept=sweepStalePaid(hq,(keepEl&&!keepEl.checked)?SWEEP_ALL_CUT:_cut);
    // असली bug (JE की रिपोर्ट): एक category में लेजर अपलोड होने से उसकी "वसूल" स्थिति बहाल होती है
    // (ऊपर वाला backup-restore), पर वह सिर्फ़ उसी category तक सीमित थी — किसी और category के अपने
    // लेजर में (जैसे "कुल उपभोक्ता") वही उपभोक्ता अब भी पुराना (बाकी) दिखता रहता, भले ही असल में
    // वसूल हो चुका हो। कैश-लिस्ट अपलोड में reconcileHQ() पहले से यही ठीक करता था — अब सामान्य
    // लेजर अपलोड के बाद भी यही चले, ताकि "किसी भी category में वसूल = हर category में वसूल" हमेशा सच रहे
    var _rec2=reconcileHQ(hq);
    toast("✅ "+arr.length+" records अपलोड!"+(kept?" 🛡 "+kept+" वसूली सुरक्षित":"")+(dropped?" 🧹 "+dropped+" पुरानी हटाई":"")+(_swept?" 🧹 "+_swept+" पुरानी अन्य बटनों से हटाई":"")+(rmkKept?" 💬 "+rmkKept+" के रिमार्क सुरक्षित":"")+(dupSkip?" | "+dupSkip+" duplicate Consumer No skip":"")+(_rec2?" 🔁 "+_rec2+" अन्य categories में मिलाया":"")+" 🔥","ok");

  }catch(err){
    logErr("upload-confirm",err,activeHQ+"/"+(document.getElementById("up-cat")?document.getElementById("up-cat").value:""));
    toast("Error: "+err.message,"err");
    console.error("confirmUpload error:",err);
  }
}

function _doSave(hq,cat,arr){
  // fbSet को असली पुराना data चाहिए (patch-diff के लिए) — नीचे cSet से पहले ही निकाल लें
  var prevSnap=JSON.parse(JSON.stringify(cGet(hq,cat)||[]));
  // 1. Cache में save करें
  cSet(hq,cat,arr);
  // 2. Active HQ/Cat set करें
  activeHQ=hq;
  activeCat=cat;
  // 3. Modal पहले बंद करें
  document.getElementById("up-overlay").classList.remove("open");
  // 4. UI rebuild
  buildHQTabs();
  buildCatTabs();
  buildActionBtns();
  // 5. List और summary दिखाएं
  renderSummaryWith(arr);
  renderListWith(arr);
  // 6. Polling start
  startListen(activeHQ,activeCat);
  // 7. Firebase background save
  setTimeout(function(){
    fbSet(hq,cat,arr,prevSnap,function(ok){
      if(!ok) toast("⚠️ Firebase sync pending","inf");
    });
  },300);
}

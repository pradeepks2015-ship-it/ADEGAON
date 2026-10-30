// ── उपभोक्ता card WhatsApp (या कहीं भी) पर शेयर — फ़ोटो + टेक्स्ट ────────────────────────────────
// JE का अनुरोध: card सीधे लाइनमैन/JE को भेजा जा सके। JE का फ़ैसला: सिर्फ़ card की फ़ोटो जाए (नीचे
// टेक्स्ट नहीं) — तस्वीर में मोबाइल नंबर और सारे रिमार्क समेत पूरा card रहता है। टेक्स्ट सिर्फ़ उन
// फ़ोन के लिए बचा है जहां फ़ोटो शेयर होती ही नहीं, और वह जान-बूझकर छोटा है (हिंदी SMS में 70 अक्षर
// प्रति संदेश — पूरा ब्योरा 6-7 SMS ले लेता)।
// Firebase का कोई खर्च नहीं: card का सारा data पहले से device पर (cGet) है, कुछ भी fetch नहीं होता।
// तस्वीर यहीं canvas पर बनती है — कोई बाहरी library नहीं (ऐप भारी न हो, offline भी चले)।
// फ़ोन फ़ाइल-शेयर (Web Share API level 2) सपोर्ट करे तो फ़ोटो + टेक्स्ट, वरना सिर्फ़ टेक्स्ट wa.me से

function _shareStatusLine(x){
  if(x.status==="paid") return "✅ वसूल"+(x.paydate?" ("+x.paydate+")":"");
  return "⏳ बाकी";
}

// WhatsApp का टेक्स्ट — *...* WhatsApp में bold दिखता है
function _shareText(x){
  var L=[];
  L.push("⚡ "+(activeHQ||"")+(activeCat?" • "+activeCat:""));
  L.push((x.name||"")+(x.father?" / "+x.father:""));
  if(x.acc) L.push("Consumer No: "+x.acc);
  L.push("बकाया: ₹"+(Number(x.amount)||0).toLocaleString("hi-IN")+" • "+_shareStatusLine(x));
  return L.join("\n");
}

// canvas पर शब्दों के हिसाब से line तोड़ना (width पार न हो)
function _shareWrap(ctx,text,maxW){
  var words=String(text||"").split(/\s+/),lines=[],cur="";
  words.forEach(function(w){
    var t=cur?cur+" "+w:w;
    if(ctx.measureText(t).width<=maxW||!cur){ cur=t; }
    else { lines.push(cur); cur=w; }
  });
  if(cur) lines.push(cur);
  return lines.length?lines:[""];
}

var SHARE_FONT='"Noto Sans Devanagari","Baloo 2",sans-serif';

// card की तस्वीर — 720px चौड़ी (फ़ोन पर साफ़ दिखे), ऊंचाई सामग्री के हिसाब से
function _shareCanvas(x){
  var W=720,P=36,IW=W-2*P;
  var c=document.createElement("canvas"),ctx=c.getContext("2d");
  var isPaid=x.status==="paid";
  // पहले "सूखा" हिसाब लगाकर ऊंचाई निकालो, फिर असली ड्रॉइंग — दोनों एक ही क्रम से चलते हैं
  function layout(draw){
    var y=0;
    function text(str,size,weight,color,lh,x0){
      ctx.font=(weight||"400")+" "+size+"px "+SHARE_FONT;
      var ls=_shareWrap(ctx,str,IW-((x0||P)-P));
      ls.forEach(function(l){
        if(draw){ ctx.fillStyle=color; ctx.fillText(l,x0||P,y+size); }
        y+=lh||Math.round(size*1.45);
      });
    }
    // ऊपर की पट्टी
    if(draw){
      var g=ctx.createLinearGradient(0,0,W,0); g.addColorStop(0,"#124971"); g.addColorStop(1,"#1e6fa8");
      ctx.fillStyle=g; ctx.fillRect(0,0,W,96);
    }
    y=22;
    text("⚡ आदेगांव बिजली वितरण केंद्र",28,"700","#ffffff",40);
    text((activeHQ||"")+(activeCat?" • "+activeCat:""),20,"500","#cfe6f7",30);
    y=96+28;
    // नाम + बकाया
    text((x.name||"")+(x.father?" / "+x.father:""),30,"700","#1b2a3a",42);
    y+=4;
    text("₹"+(Number(x.amount)||0).toLocaleString("hi-IN")+" बकाया",40,"800",isPaid?"#0a8c68":"#1565c0",54);
    // स्थिति बैज
    ctx.font="700 22px "+SHARE_FONT;
    var st=_shareStatusLine(x),bw=ctx.measureText(st).width+36;
    if(draw){
      ctx.fillStyle=isPaid?"#e3f6ee":"#fdecef";
      ctx.fillRect(P,y,bw,40);
      ctx.fillStyle=isPaid?"#0a8c68":"#c62845";
      ctx.fillText(st,P+18,y+28);
    }
    y+=56;
    // विवरण
    var rows=[];
    if(x.acc) rows.push("📄 Consumer No: "+x.acc);
    if(x.phone) rows.push("📞 मोबाइल: "+x.phone);
    if(x.addr) rows.push("📍 पता: "+x.addr);
    var tech=[];
    if(x.tariff) tech.push("टैरिफ "+x.tariff);
    if(x.load) tech.push("लोड "+x.load);
    if(x.unit) tech.push(x.unit);
    if(tech.length) rows.push("⚙️ "+tech.join(" • "));
    if(x.lastPaidAmt&&String(x.lastPaidAmt).trim()!==""){
      var n=Number(x.lastPaidAmt);
      rows.push("📅 पिछला भुगतान: ₹"+(isNaN(n)?x.lastPaidAmt:n.toLocaleString("hi-IN"))+(x.lastPayDate?" ("+x.lastPayDate+")":""));
    }
    if(x.updatedBy&&x.updatedAt) rows.push("🔄 अपडेट: "+x.updatedBy+" • "+x.updatedAt);
    rows.forEach(function(r){ text(r,24,"500","#34495e",38); });
    // रिमार्क — सारे, पुराने से नए क्रम में
    var rs=remarksAll(x,activeHQ).filter(function(r){ return r&&r.text; });
    if(rs.length){
      y+=10;
      if(draw){ ctx.fillStyle="#e3e9ef"; ctx.fillRect(P,y,IW,2); }
      y+=18;
      text("💬 रिमार्क ("+rs.length+")",24,"700","#c2650a",38);
      rs.forEach(function(r){
        text("• "+r.text,23,"500","#1b2a3a",34);
        text("— "+(r.by||"")+(r.at?" • "+r.at:""),19,"400","#7a8a9a",30,P+22);
        y+=6;
      });
    }
    // नीचे
    y+=14;
    if(draw){ ctx.fillStyle="#e3e9ef"; ctx.fillRect(P,y,IW,2); }
    y+=12;
    text("वसूली ट्रैकर • "+new Date().toLocaleString("hi-IN")+(CU&&CU.name?" • "+CU.name:""),18,"400","#8a99a8",30);
    return y+P/2;
  }
  c.width=W; c.height=layout(false);
  ctx.fillStyle="#ffffff"; ctx.fillRect(0,0,W,c.height);
  // बाईं ओर स्थिति वाली पतली पट्टी — ऐप के card जैसी
  layout(true);
  ctx.fillStyle=isPaid?"#0a8c68":"#c62845"; ctx.fillRect(0,96,8,c.height-96);
  return c;
}

// ── ऐप में दिखने वाले card की हूबहू तस्वीर (JE का फ़ैसला: "ऐप में जैसा card दिखता है वही शेयर हो") ──
// card के DOM की कॉपी + ऐप का पूरा CSS एक SVG <foreignObject> में रखकर browser से ही उसे चित्र
// बनवाते हैं — वही रंग, वही font, वही layout, (dark/light) theme समेत। सिर्फ़ नीचे के बटन (📤/रिमार्क/
// वसूल) हटा देते हैं — तस्वीर में उनका कोई काम नहीं। 2x पर बनती है ताकि WhatsApp पर धुंधली न लगे।
// कोई browser इसे न बना पाए (पुराना/Safari — canvas "tainted") तो cb(null) — caller ऊपर वाली
// _shareCanvas (सादा बनाया हुआ card) पर लौट जाता है
function _shareCssText(){
  var out=[];
  for(var i=0;i<document.styleSheets.length;i++){
    try{
      var rs=document.styleSheets[i].cssRules;
      for(var j=0;j<rs.length;j++) out.push(rs[j].cssText);
    }catch(e){} // दूसरे domain की stylesheet (Google Fonts) पढ़ी नहीं जा सकती — छोड़ दो
  }
  return out.join("\n");
}
// JE की शिकायत: शेयर की तस्वीर में नाम/राशि/Consumer No के अक्षर तिरछे बनते हैं। वजह: ऐप का
// "Baloo 2" (और chip-acc का monospace) Google के सर्वर से आता है, पर तस्वीर के अंदर वह पहुंचता
// नहीं — फ़ोन CSS में लिखा विकल्प `cursive` (हस्तलेख जैसा) लगा देता है, इसलिए तिरछा दिखता है।
// JE का फ़ैसला (विकल्प क): तस्वीर में सादा font — हिंदी वैसी ही दिखेगी (Noto Sans Devanagari
// लगभग हर फ़ोन में है), अंग्रेज़ी/अंक सजावटी की जगह सादे पर साफ़। कोई font डाउनलोड नहीं।
// साथ ही अक्षरों का आकार ~10% घटाया — सादा font "Baloo 2" से ज़्यादा भरा-भरा (बड़ी x-height)
// दिखता है, इसलिए वही px आकार तस्वीर में बड़ा लगता था (JE: "फ़ॉन्ट का साइज बहुत बड़ा सा दिख रहा है")
var SHARE_FONT_FIX=[
  "",
  ".con-card,.con-card *{font-family:'Noto Sans Devanagari',system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif !important;font-style:normal !important;}",
  ".con-card .chip-acc{font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif !important;font-size:11.5px !important;letter-spacing:.4px !important;}",
  ".con-card .cc-name{font-size:12.2px !important;}",
  ".con-card .cc-amt{font-size:17px !important;}",
  ".con-card .chip{font-size:8.2px !important;}",
  ".con-card .sbadge,.con-card .cc-info,.con-card .cc-paydate,.con-card .cc-upload-info,.con-card .cc-rmk-item{font-size:9.2px !important;}",
  ".con-card .cc-rmk-by,.con-card .cc-updby,.con-card .cc-rank{font-size:8.2px !important;}",
  ""
].join("\n");
function _shareCardImage(el,cb){
  try{
    var W=Math.ceil(el.getBoundingClientRect().width), S=2;
    var clone=el.cloneNode(true);
    var btns=clone.querySelectorAll(".act-btns,.cc-share"); // तस्वीर में न बटन, न शेयर का तीर
    for(var i=0;i<btns.length;i++) btns[i].parentNode.removeChild(btns[i]);
    clone.style.margin="0"; clone.style.animation="none"; clone.style.transform="none";
    // बटन हटने के बाद असली ऊंचाई नापने के लिए — उसी list के अंदर, स्क्रीन से बाहर
    var probe=document.createElement("div");
    probe.style.cssText="position:fixed;left:-10000px;top:0;width:"+W+"px;";
    probe.appendChild(clone);
    (el.parentNode||document.body).appendChild(probe);
    var H=Math.ceil(clone.getBoundingClientRect().height);
    probe.parentNode.removeChild(probe);
    var bg=getComputedStyle(document.body).backgroundColor||"#ffffff";
    var wrap=document.createElement("div");
    wrap.setAttribute("xmlns","http://www.w3.org/1999/xhtml");
    // body से आने वाली (inherit होने वाली) चीज़ें — तस्वीर में body नहीं होता, वरना dark theme में नाम काला दिखता
    var bs=getComputedStyle(document.body);
    wrap.style.cssText="width:"+W+"px;font-family:"+bs.fontFamily+";color:"+bs.color+";font-size:"+bs.fontSize+";line-height:"+bs.lineHeight+";";
    wrap.appendChild(clone);
    var theme=document.documentElement.getAttribute("data-theme");
    var svg='<svg xmlns="http://www.w3.org/2000/svg"'+(theme?' data-theme="'+theme+'"':'')+' width="'+(W*S)+'" height="'+(H*S)+'" viewBox="0 0 '+W+' '+H+'">'+
      '<style><![CDATA['+_shareCssText().replace(/\]\]>/g,"")+SHARE_FONT_FIX+']]></style>'+
      '<foreignObject x="0" y="0" width="'+W+'" height="'+H+'">'+new XMLSerializer().serializeToString(wrap)+'</foreignObject></svg>';
    var img=new Image();
    img.onload=function(){
      try{
        var c=document.createElement("canvas");
        c.width=W*S; c.height=H*S;
        var ctx=c.getContext("2d");
        ctx.fillStyle=bg; ctx.fillRect(0,0,c.width,c.height);
        ctx.drawImage(img,0,0,c.width,c.height);
        c.toDataURL(); // "tainted" हो तो यहीं SecurityError — तब सादे card पर लौटो
        cb(c);
      }catch(e){ cb(null); }
    };
    img.onerror=function(){ cb(null); };
    img.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svg);
  }catch(e){ cb(null); }
}

function _shareTextOnly(text){
  window.open("https://wa.me/?text="+encodeURIComponent(text),"_blank");
}

function shareCard(idx,acc,btn){
  var d=cGet(activeHQ,activeCat);
  idx=_findRecordIdx(d,idx,acc);
  if(idx<0){ toast("यह रिकॉर्ड अब सूची में नहीं मिला — सूची ताज़ा हो गई होगी, दोबारा कोशिश करें","err"); return; }
  var x=d[idx];
  var text=_shareText(x);
  var canFiles=false;
  try{ canFiles=!!(navigator.share&&navigator.canShare&&window.File&&navigator.canShare({files:[new File([""],"t.png",{type:"image/png"})]})); }catch(e){}
  if(!canFiles){ _shareTextOnly(text); return; }
  function send(cv){
    if(!cv){ try{ cv=_shareCanvas(x); }catch(e){ _shareTextOnly(text); return; } }
    cv.toBlob(function(blob){
      if(!blob){ _shareTextOnly(text); return; }
      var file=new File([blob],"card-"+(x.acc||"upbhokta")+".png",{type:"image/png"});
      navigator.share({files:[file]}).catch(function(e){ // JE का फ़ैसला: सिर्फ़ card की फ़ोटो, नीचे टेक्स्ट नहीं
        if(e&&e.name==="AbortError") return; // लाइनमैन ने खुद रद्द किया — कुछ न करें
        _shareTextOnly(text);
      });
    },"image/png");
  }
  var card=btn&&btn.closest?btn.closest(".con-card"):null;
  if(card) _shareCardImage(card,send); else send(null);
}

// ── v9.266 (JE 30/10): कई cards चुनकर एक साथ WhatsApp ──
// card को थोड़ी देर दबाकर रखें (long-press) → चुनने का मोड; फिर छूकर जोड़ें/हटाएं (हरी बॉर्डर + ✓)। चुने हुए किसी भी
// card का शेयर-तीर (↱) → सबकी फ़ोटो एक साथ (JE का फ़ैसला: फ़ोटो)। फ़ोटो-शेयर न चले वाले फ़ोन पर सबका छोटा टेक्स्ट wa.me से।
// अधिकतम 10 (सस्ते फ़ोन पर फ़ोटो बनाना भारी)। सब फ़ोन पर — Firebase कुछ नहीं
var SEL_MAX=10, SEL_PRESS_MS=550, SEL_MOVE_PX=10;
var _sel=null;            // {hq,cat,accs:{acc:1}} — चुनने का मोड चालू हो तब
var _selPressT=0, _selPressAt=null, _selSwallow=false, _selBusy=false;
function _selCardAcc(card){ var b=card&&card.querySelector("[data-acc]"); return b?String(b.getAttribute("data-acc")||"").trim():""; }
function _selCount(){ return _sel?Object.keys(_sel.accs).length:0; }
function _selValid(){ if(_sel&&(_sel.hq!==activeHQ||_sel.cat!==activeCat)) _selClear(); return !!_sel; }
function _selClear(){ _sel=null; _selApply(); }
function _selApply(){
  if(_sel&&(_sel.hq!==activeHQ||_sel.cat!==activeCat)) _sel=null;
  var cards=document.querySelectorAll("#con-list .con-card");
  for(var i=0;i<cards.length;i++){
    var on=!!(_sel&&_sel.accs[_selCardAcc(cards[i])]);
    cards[i].classList.toggle("cc-sel",on);
  }
  var bar=document.getElementById("sel-bar");
  if(!_sel){ if(bar) bar.style.display="none"; return; }
  if(!bar){
    bar=document.createElement("div"); bar.id="sel-bar"; bar.className="sel-bar";
    var t=document.createElement("span"); t.className="sel-txt"; bar.appendChild(t);
    var x=document.createElement("button"); x.className="sel-x"; x.setAttribute("data-act","selCancel"); x.setAttribute("aria-label","चुनना रद्द करें"); x.textContent="✕ रद्द";
    bar.appendChild(x);
    document.body.appendChild(bar);
  }
  bar.querySelector(".sel-txt").textContent="✓ "+_selCount()+" चुने • किसी चुने card का ↱ दबाएं — WhatsApp";
  bar.style.display="";
}
function _selToggle(card){
  var acc=_selCardAcc(card); if(!acc||!_sel) return;
  if(_sel.accs[acc]) delete _sel.accs[acc];
  else if(_selCount()>=SEL_MAX){ toast("एक साथ अधिकतम "+SEL_MAX+" card","inf"); return; }
  else _sel.accs[acc]=1;
  if(!_selCount()) _sel=null;
  _selApply();
}
function _selStart(card){
  var acc=_selCardAcc(card); if(!acc) return;
  _sel={hq:activeHQ,cat:activeCat,accs:{}}; _sel.accs[acc]=1;
  _selApply();
  try{ if(navigator.vibrate) navigator.vibrate(30); }catch(e){}
}
function shareSelected(){
  if(!_selValid()||_selBusy) return;
  var d=cGet(activeHQ,activeCat)||[], accs=Object.keys(_sel.accs);
  var recs=accs.map(function(a){ for(var i=0;i<d.length;i++){ if(accKeyOf(d[i])===a) return d[i]; } return null; }).filter(Boolean);
  if(!recs.length){ _selClear(); return; }
  var allText=recs.map(_shareText).join("\n\n");
  var canFiles=false;
  try{ canFiles=!!(navigator.share&&navigator.canShare&&window.File&&navigator.canShare({files:[new File([""],"t.png",{type:"image/png"})]})); }catch(e){}
  if(!canFiles){ _shareTextOnly(allText); _selClear(); return; }
  _selBusy=true;
  toast("📷 "+recs.length+" फ़ोटो बन रही हैं…","inf");
  var files=[], i=0;
  function cardFor(acc){
    var cards=document.querySelectorAll("#con-list .con-card");
    for(var k=0;k<cards.length;k++){ if(_selCardAcc(cards[k])===acc) return cards[k]; }
    return null;
  }
  function next(){
    if(i>=recs.length){ done(); return; }
    var x=recs[i++], el=cardFor(accKeyOf(x));
    var push=function(cv){
      if(!cv){ try{ cv=_shareCanvas(x); }catch(e){ cv=null; } }
      if(!cv){ next(); return; }
      cv.toBlob(function(blob){
        if(blob) files.push(new File([blob],"card-"+(x.acc||"upbhokta")+".png",{type:"image/png"}));
        next();
      },"image/png");
    };
    if(el) _shareCardImage(el,push); else push(null);
  }
  function done(){
    _selBusy=false;
    if(!files.length){ _shareTextOnly(allText); _selClear(); return; }
    navigator.share({files:files}).then(function(){ _selClear(); },function(e){
      if(e&&e.name==="AbortError") return; // लाइनमैन ने ख़ुद रद्द किया — चुने cards बने रहें
      _shareTextOnly(allText); _selClear();
    });
  }
  next();
}
// long-press पहचानना — card पर उंगली टिकी रहे (हिले नहीं) तो चुनने का मोड
document.addEventListener("pointerdown",function(ev){
  var tg=/** @type {any} */(ev.target);
  var card=tg&&tg.closest?tg.closest("#con-list .con-card"):null;
  if(!card||_sel) return;
  _selPressAt={x:ev.clientX,y:ev.clientY};
  clearTimeout(_selPressT);
  _selPressT=setTimeout(function(){ _selPressT=0; _selSwallow=true; _selStart(card); },SEL_PRESS_MS);
});
document.addEventListener("pointermove",function(ev){
  if(!_selPressT||!_selPressAt) return;
  if(Math.abs(ev.clientX-_selPressAt.x)>SEL_MOVE_PX||Math.abs(ev.clientY-_selPressAt.y)>SEL_MOVE_PX){ clearTimeout(_selPressT); _selPressT=0; }
});
["pointerup","pointercancel"].forEach(function(n){ document.addEventListener(n,function(){ if(_selPressT){ clearTimeout(_selPressT); _selPressT=0; } }); });
document.addEventListener("contextmenu",function(ev){ // long-press पर फ़ोन का अपना मेनू न खुले
  var tg=/** @type {any} */(ev.target);
  if(tg&&tg.closest&&tg.closest("#con-list .con-card")) ev.preventDefault();
});
// चुनने के मोड में card पर छूना = चुनना/हटाना (वसूल/रिमार्क जैसे बटन नहीं चलते); तीर = सब भेजो
document.addEventListener("click",function(ev){
  var tg=/** @type {any} */(ev.target);
  var card=tg&&tg.closest?tg.closest("#con-list .con-card"):null;
  if(_selSwallow){ _selSwallow=false; if(card){ ev.preventDefault(); ev.stopPropagation(); return; } }
  if(!card||!_selValid()) return;
  ev.preventDefault(); ev.stopPropagation();
  if(tg.closest(".cc-share")){ shareSelected(); return; }
  _selToggle(card);
},true);

// ── उपभोक्ता card WhatsApp (या कहीं भी) पर शेयर — फ़ोटो + टेक्स्ट ────────────────────────────────
// JE का अनुरोध: card सीधे लाइनमैन/JE को भेजा जा सके। JE का फ़ैसला: पूरा card जाए — फ़ोटो + टेक्स्ट,
// मोबाइल नंबर और सारे रिमार्क समेत (यह स्टाफ़ के आपसी इस्तेमाल के लिए है), बटन सबको दिखे।
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
  L.push("⚡ *आदेगांव बिजली वितरण केंद्र*");
  L.push("🏢 "+(activeHQ||"")+(activeCat?" • "+activeCat:""));
  L.push("👤 *"+(x.name||"")+(x.father?" / "+x.father:"")+"*");
  if(x.acc) L.push("📄 Consumer No: "+x.acc);
  L.push("💰 बकाया: ₹"+(Number(x.amount)||0).toLocaleString("hi-IN")+" • "+_shareStatusLine(x));
  if(x.phone) L.push("📞 मोबाइल: "+x.phone);
  if(x.addr) L.push("📍 पता: "+x.addr);
  var tech=[];
  if(x.tariff) tech.push("टैरिफ "+x.tariff);
  if(x.load) tech.push("लोड "+x.load);
  if(x.unit) tech.push(x.unit);
  if(tech.length) L.push("⚙️ "+tech.join(" • "));
  if(x.lastPaidAmt&&String(x.lastPaidAmt).trim()!==""){
    var n=Number(x.lastPaidAmt);
    L.push("📅 पिछला भुगतान: ₹"+(isNaN(n)?x.lastPaidAmt:n.toLocaleString("hi-IN"))+(x.lastPayDate?" ("+x.lastPayDate+")":""));
  } else if(x.lastPayDate&&String(x.lastPayDate).trim()){
    L.push("📅 पिछला भुगतान तिथि: "+x.lastPayDate);
  }
  var rs=(x.remarksArr||[]).filter(function(r){ return r&&r.text; });
  if(rs.length){
    L.push("");
    L.push("💬 *रिमार्क ("+rs.length+"):*");
    rs.forEach(function(r){ L.push("• "+r.text+" — "+(r.by||"")+(r.at?" ("+r.at+")":"")); });
  }
  L.push("");
  L.push("_वसूली ट्रैकर • "+(CU&&CU.name?CU.name:"")+"_");
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
    var rs=(x.remarksArr||[]).filter(function(r){ return r&&r.text; });
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
function _shareCardImage(el,cb){
  try{
    var W=Math.ceil(el.getBoundingClientRect().width), S=2;
    var clone=el.cloneNode(true);
    var btns=clone.querySelectorAll(".act-btns");
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
      '<style><![CDATA['+_shareCssText().replace(/\]\]>/g,"")+']]></style>'+
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
      navigator.share({files:[file],text:text}).catch(function(e){
        if(e&&e.name==="AbortError") return; // लाइनमैन ने खुद रद्द किया — कुछ न करें
        _shareTextOnly(text);
      });
    },"image/png");
  }
  var card=btn&&btn.closest?btn.closest(".con-card"):null;
  if(card) _shareCardImage(card,send); else send(null);
}

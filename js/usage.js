// ── DATA USAGE TRACKING: Firebase Blaze plan पर इस्तेमाल के हिसाब से बिल आता है, कोई hard limit
// नहीं जो पहले से रोक दे — इसलिए ऐप के अंदर पढ़े गए डेटा के अनुमानित आकार को track करके महीने-दर-महीने
// ट्रेंड दिखाया जाता है, ताकि कोई असामान्य बढ़ोतरी (जैसे कोई bug जो बार-बार पूरा डेटा खींच रहा हो)
// अचानक बड़े bill के तौर पर सामने आने से पहले ही पकड़ में आ जाए। यह सटीक billing नहीं — सिर्फ़ अनुमान।
var _usageBytes=0;
function trackUsageBytes(n){ if(n>0) _usageBytes+=n; }
// जो कुछ भी Firebase से उतरा उसे नापने का इकलौता ज़रिया — जहां जवाब पहले ही हाथ में है वहीं
// बुलाया जाता है, इसलिए इसका अपना कोई network खर्च नहीं (न एक call, न एक byte)।
// पहले यह सिर्फ़ fbGet की दो जगह लगा था, यानी मीटर सिर्फ़ "लिस्ट खोलना" गिनता था और असली सबसे
// बड़ा खर्च — SSE, जो जुड़ते ही पूरी list भेजता है — बिल्कुल नहीं गिनता था। नतीजा: ऐप 15.3 MB
// दिखाता था जबकि Firebase Console पर उसी वक़्त 105 MB था (~7 गुना), और JE मीटर के भरोसे
// यह तय ही नहीं कर पाते थे कि खर्च कहां जा रहा है
// असली बाइट गिनो, अक्षर नहीं। JS की .length UTF-16 इकाइयाँ गिनती है, पर तार पर डेटा UTF-8 में
// जाता है जहाँ देवनागरी का हर अक्षर 3 बाइट लेता है। हमारे records में नाम, पता, रिमार्क, श्रेणी —
// सब हिंदी में हैं, इसलिए .length असली आकार का लगभग 60% ही दिखाती थी (एक असली record पर नापा:
// 278 बनाम 466 बाइट = 1.68 गुना)। यही मीटर के कम दिखने की सबसे बड़ी वजह थी।
function _utf8Len(s){
  try{ if(typeof TextEncoder!=="undefined") return new TextEncoder().encode(s).length; }catch(e){}
  try{ return new Blob([s]).size; }catch(e2){}
  // बहुत पुराना browser — हाथ से गिनो (धीमा, पर सही)
  var n=0;
  for(var i=0;i<s.length;i++){
    var c=s.charCodeAt(i);
    if(c<0x80) n+=1;
    else if(c<0x800) n+=2;
    else if(c>=0xD800&&c<0xDC00){ n+=4; i++; } // surrogate pair (जैसे इमोजी) = 4 बाइट
    else n+=3;
  }
  return n;
}
function trackUsageOf(v){
  if(v==null) return;
  try{ trackUsageBytes(_utf8Len(typeof v==="string"?v:JSON.stringify(v))); }catch(e){}
}
// Firebase का दैनिक download quota US-Pacific आधी रात को रीसेट होता है (भारत में दोपहर ~12:30) —
// UTC या device की स्थानीय आधी रात को नहीं। पहले यहां toISOString() यानी UTC दिन इस्तेमाल होता था,
// इसलिए ऐप की "आज का फ्री-कोटा %" वाली पट्टी और Firebase Console का % कभी मेल खा ही नहीं सकते थे —
// दोनों अलग-अलग खिड़कियां नाप रहे थे। अब वही खिड़की, ताकि दोनों संख्याएं एक ही चीज़ बताएं।
function _usageQuotaDay(offset){
  var d=new Date();
  if(offset) d.setDate(d.getDate()-offset);
  try{
    return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Los_Angeles",year:"numeric",month:"2-digit",day:"2-digit"}).format(d);
  }catch(e){
    return d.toISOString().slice(0,10); // बहुत पुराना browser — पुराने तरीक़े पर लौट जाओ
  }
}
function _usageFlush(){
  if(_usageBytes<=0||!navigator.onLine||typeof FB==="undefined")return;
  var bytes=_usageBytes; _usageBytes=0;
  var day=_usageQuotaDay(0);
  fetch(FB+"/USAGE/"+day+".json",{
    method:"POST",headers:{"Content-Type":"application/json"},
    // n = कौन (role|HQ|नाम) — DEV_ID अकेला JE को कुछ नहीं बताता; इसी से device-वार टूट-फूट बनती है
    body:JSON.stringify({d:(typeof DEV_ID!=="undefined"?DEV_ID:"?"),n:((typeof CU!=="undefined"&&CU)?(CU.role+"|"+CU.hq+"|"+CU.name):""),b:bytes,t:Date.now()})
  }).catch(function(){});
}
setInterval(_usageFlush,5*60*1000); // हर 5 मिनट में जमा हुआ इस्तेमाल भेज दें
window.addEventListener("beforeunload",_usageFlush);
document.addEventListener("visibilitychange",function(){ if(document.visibilityState==="hidden") _usageFlush(); });
// डेटा-उपयोग की JE-स्क्रीन: js/usage-view.js (ज़रूरत पड़ने पर ही उतरती है)

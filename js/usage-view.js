// ── यह फ़ाइल ज़रूरत पड़ने पर ही उतरती है (v9.195, देखें js/lazy.js) ──
// डेटा-उपयोग की JE-स्क्रीन। गिनती (trackUsageOf, _usageFlush) हर फ़ोन पर js/usage.js में चलती है

// ── DATA USAGE VIEWER (सिर्फ JE) ──
function openUsageModal(){
  if(!CU||CU.role!=="supervisor"){toast("सिर्फ JE डेटा उपयोग देख सकते हैं","err");return;}
  var mn=document.getElementById("logout-menu"); if(mn) mn.classList.remove("open");
  document.getElementById("usage-overlay").classList.add("open");
  document.getElementById("usage-content").innerHTML="<div class='log-empty'>लोड हो रहा है...</div>";
  _usageFlush(); // अभी तक जमा हुआ इस्तेमाल भी हिसाब में शामिल करें
  _usageRender();
  _usageCleanupOld();
}
function closeUsageModal(){document.getElementById("usage-overlay").classList.remove("open");}
function closeUsageOutside(e){if(e.target===document.getElementById("usage-overlay"))closeUsageModal();}

function _usageDayKey(offset){ return _usageQuotaDay(offset); }
// कुल जोड़ के साथ device-वार टूट-फूट भी — एक ही पढ़ाई से दोनों निकल आते हैं, कोई अतिरिक्त call नहीं
function _usageSumDay(day,cb){
  fetch(FB+"/USAGE/"+day+".json?t="+Date.now())
    .then(_fbJson)
    .then(function(d){
      var tot=0,byDev={};
      if(d&&typeof d==="object") Object.keys(d).forEach(function(k){
        var e=d[k]; if(!e||!e.b) return;
        var b=Number(e.b)||0; if(!b) return;
        tot+=b;
        var id=e.d||"?";
        if(!byDev[id]) byDev[id]={b:0,n:""};
        byDev[id].b+=b;
        if(e.n) byDev[id].n=String(e.n); // सबसे नया मिला नाम रख लो
      });
      cb(tot,byDev);
    }).catch(function(){cb(null,null);});
}
// "lineman|बीबी|suneel Jhariya" → "suneel Jhariya (बीबी)" — JE को नाम से पहचान हो, id से नहीं
function _usageWho(n,id){
  if(!n) return "अनजान device ("+String(id).slice(0,6)+")";
  var p=String(n).split("|");
  var name=p[2]||"", hq=p[1]||"";
  if(!name) return String(id).slice(0,6);
  return name+(hq?" ("+hq+")":"");
}
function _usageFmt(b){
  if(b==null) return "?";
  var mb=b/1024/1024;
  return mb>=1?mb.toFixed(1)+" MB":(b/1024).toFixed(0)+" KB";
}
// Realtime Database का no-cost download quota रोज़ 360MB है, हर दिन रीसेट होता है (Firebase Console
// → Usage and billing में यही "360 MB /day" के तौर पर दिखता है) — महीने में pool नहीं होता, इसलिए
// आज के कोटा का % दिखाना ज़्यादा काम का है बनिस्बत महीने-भर के कुल जोड़ के
var USAGE_DAY_QUOTA_MB=360;
function _usageRender(){
  var el=document.getElementById("usage-content");
  var curD=_usageDayKey(0), prevD=_usageDayKey(1);
  _usageSumDay(curD,function(curBytes,curDev){
    _usageSumDay(prevD,function(prevBytes){
      var warnHtml="";
      if(curBytes!=null&&prevBytes){
        var growth=((curBytes-prevBytes)/prevBytes)*100;
        if(growth>50){
          warnHtml="<div style='background:rgba(240,80,80,.08);border:1px solid rgba(240,80,80,.3);border-radius:10px;padding:9px 11px;margin-bottom:8px;font-size:12px;color:var(--red);font-weight:700;'>⚠️ आज पिछले दिन से "+growth.toFixed(0)+"% ज़्यादा डेटा इस्तेमाल हुआ — असामान्य बढ़ोतरी, कारण जांचें</div>";
        }
      }
      var curMB=(curBytes||0)/1024/1024;
      var pct=Math.min(100,(curMB/USAGE_DAY_QUOTA_MB)*100);
      var barColor=pct>=90?"var(--red)":(pct>=60?"var(--orange)":"var(--green)");
      var quotaHtml="<div style='margin-bottom:10px;'>"+
        "<div style='display:flex;justify-content:space-between;font-size:11px;font-weight:700;margin-bottom:4px;color:var(--muted);'><span>आज का फ्री-कोटा</span><span>"+curMB.toFixed(1)+" MB / "+USAGE_DAY_QUOTA_MB+" MB ("+pct.toFixed(0)+"%)</span></div>"+
        "<div style='background:var(--border);border-radius:6px;height:8px;overflow:hidden;'><div style='width:"+pct.toFixed(1)+"%;height:100%;background:"+barColor+";'></div></div>"+
        "</div>";
      // device-वार टूट-फूट — सबसे ज़्यादा खाने वाला सबसे ऊपर, ताकि एक नज़र में पकड़ में आ जाए
      var devHtml="";
      var ids=curDev?Object.keys(curDev):[];
      if(ids.length){
        ids.sort(function(a,b){return curDev[b].b-curDev[a].b;});
        devHtml="<table class='wasc-table' style='margin-top:12px;'><thead><tr><th class='wasc-th-left'>आज किस device से</th><th>अनुमानित डेटा</th></tr></thead><tbody>"+
          ids.map(function(id){
            var share=curBytes?Math.round((curDev[id].b/curBytes)*100):0;
            return "<tr><td class='wasc-hq'>"+escHtml(_usageWho(curDev[id].n,id))+"</td><td>"+_usageFmt(curDev[id].b)+" <span style='color:var(--muted);font-size:10px;'>("+share+"%)</span></td></tr>";
          }).join("")+
          "</tbody></table>";
      }
      // audit-verified: warnHtml/quotaHtml/curD/prevD/curBytes/prevBytes सब संख्या या
      // program-generated date-key strings हैं (_usageDayKey से); devHtml में इकलौता free-text
      // (device का नाम, लाइनमैन का टाइप किया) escHtml() से गुज़रकर आता है
      // eslint-disable-next-line no-unsanitized/property
      el.innerHTML=warnHtml+quotaHtml+
        "<table class='wasc-table'><thead><tr><th class='wasc-th-left'>तारीख़</th><th>अनुमानित डेटा (सभी devices)</th></tr></thead><tbody>"+
        "<tr><td class='wasc-hq'>"+curD+" (आज)</td><td>"+_usageFmt(curBytes)+"</td></tr>"+
        "<tr><td class='wasc-hq'>"+prevD+" (कल)</td><td>"+_usageFmt(prevBytes)+"</td></tr>"+
        "</tbody></table>"+devHtml+
        "<div style='font-size:10px;color:var(--muted);margin-top:8px;'>दिन की गिनती Firebase की अपनी खिड़की से मिलाई गई है — वह रोज़ US-Pacific आधी रात (भारत में दोपहर ~12:30) पर रीसेट होती है, इसलिए यहां का % Firebase Console के % के बराबर होना चाहिए। फिर भी यह ऐप के पढ़े डेटा से बना अनुमान है, असली bill नहीं — सटीक राशि के लिए Firebase Console → Usage and billing देखें।</div>";
    });
  });
}
// 30 दिन से पुराने usage records अपने आप हटें — free plan की जगह न भरे (जैसे LOGS में होता है)
function _usageCleanupOld(){
  fetch(FB+"/USAGE.json?shallow=true&t="+Date.now())
    .then(_fbJson)
    .then(function(d){
      if(!d)return;
      var cutoff=_usageDayKey(30);
      Object.keys(d).forEach(function(day){
        if(day<cutoff) fetch(FB+"/USAGE/"+day+".json",{method:"DELETE"}).catch(function(){});
      });
    }).catch(function(){});
}

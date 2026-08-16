// ── DATA USAGE TRACKING: Firebase Blaze plan पर इस्तेमाल के हिसाब से बिल आता है, कोई hard limit
// नहीं जो पहले से रोक दे — इसलिए ऐप के अंदर पढ़े गए डेटा के अनुमानित आकार को track करके महीने-दर-महीने
// ट्रेंड दिखाया जाता है, ताकि कोई असामान्य बढ़ोतरी (जैसे कोई bug जो बार-बार पूरा डेटा खींच रहा हो)
// अचानक बड़े bill के तौर पर सामने आने से पहले ही पकड़ में आ जाए। यह सटीक billing नहीं — सिर्फ़ अनुमान।
var _usageBytes=0;
function trackUsageBytes(n){ if(n>0) _usageBytes+=n; }
function _usageFlush(){
  if(_usageBytes<=0||!navigator.onLine||typeof FB==="undefined")return;
  var bytes=_usageBytes; _usageBytes=0;
  var day=new Date().toISOString().slice(0,10); // YYYY-MM-DD — Firebase का no-cost download quota रोज़ रीसेट होता है (360MB/day, महीने में pool नहीं होता), इसलिए यहीं granularity भी दिन की रखी
  fetch(FB+"/USAGE/"+day+".json",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({d:(typeof DEV_ID!=="undefined"?DEV_ID:"?"),b:bytes,t:Date.now()})
  }).catch(function(){});
}
setInterval(_usageFlush,5*60*1000); // हर 5 मिनट में जमा हुआ इस्तेमाल भेज दें
window.addEventListener("beforeunload",_usageFlush);
document.addEventListener("visibilitychange",function(){ if(document.visibilityState==="hidden") _usageFlush(); });

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

function _usageDayKey(offset){
  var d=new Date(); d.setDate(d.getDate()-offset);
  return d.toISOString().slice(0,10);
}
function _usageSumDay(day,cb){
  fetch(FB+"/USAGE/"+day+".json?t="+Date.now())
    .then(_fbJson)
    .then(function(d){
      var tot=0;
      if(d&&typeof d==="object") Object.keys(d).forEach(function(k){ if(d[k]&&d[k].b) tot+=Number(d[k].b)||0; });
      cb(tot);
    }).catch(function(){cb(null);});
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
  _usageSumDay(curD,function(curBytes){
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
      el.innerHTML=warnHtml+quotaHtml+
        "<table class='wasc-table'><thead><tr><th class='wasc-th-left'>तारीख़</th><th>अनुमानित डेटा (सभी devices)</th></tr></thead><tbody>"+
        "<tr><td class='wasc-hq'>"+curD+" (आज)</td><td>"+_usageFmt(curBytes)+"</td></tr>"+
        "<tr><td class='wasc-hq'>"+prevD+" (कल)</td><td>"+_usageFmt(prevBytes)+"</td></tr>"+
        "</tbody></table>"+
        "<div style='font-size:10px;color:var(--muted);margin-top:8px;'>यह सिर्फ़ ऐप के अंदर पढ़े गए डेटा के आकार से बना अनुमान है, असली Firebase bill नहीं — सटीक राशि के लिए Firebase Console → Usage and billing देखें।</div>";
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

// ─── चरण 3 (per-record migration) — हर फ़ोन पर चलने वाला हिस्सा ───
// JE की dry-run/माइग्रेशन स्क्रीन अलग फ़ाइल js/migration-tool.js में है — ज़रूरत पड़ने पर ही उतरती है


// एक HQ/श्रेणी की raw list (array या पहले से object) का विश्लेषण — कुछ भी नहीं लिखता
// missingAccSamples: acc खाली होने पर कोई और पहचान (नंबर) नहीं होती, इसलिए नाम/पता/मोबाइल से पहचान दी जाती है —
// ताकि JE आसानी से ढूंढ सके कि ठीक किसे करना है (देखें _migRender — "समस्या वाले records" सूची)
function _migAnalyzeList(raw){
  // खाली श्रेणी को "ठीक" मानें, "पलटा हुआ" नहीं — यहां convert करने को कुछ है ही नहीं।
  // पहले यह alreadyObj:false लौटाता था, और _migRunDryRun का
  //   a.reverted = isMigrated(hq,cat) && !a.alreadyObj
  // उसे उल्टा करके हर उस खाली श्रेणी को लाल "(पलटा हुआ)" दिखा देता था जिस पर कभी MIGRATED flag
  // लगा था — असली production रिपोर्ट में 10+ ऐसी झूठी लाल पंक्तियां थीं (सबमें 0 records), और
  // ऊपर की "migration पलट दिया गया" चेतावनी हमेशा जलती रहती थी, जिससे असली समस्या आने पर उस पर
  // ध्यान ही न जाता — असली bug यही था
  if(!raw) return {tot:0,missingAcc:0,missingAccSamples:[],dupAcc:0,dupSamples:[],illegalAcc:0,illegalSamples:[],alreadyObj:true};
  var isArr=Array.isArray(raw);
  var arr=(isArr?raw:Object.keys(raw).map(function(k){return raw[k];})).filter(Boolean);
  var seen={},dupSamples=[],illegalSamples=[],missingAccSamples=[],missingAcc=0,dupAcc=0,illegalAcc=0;
  arr.forEach(function(x){
    var acc=(x&&x.acc!=null)?String(x.acc).trim():"";
    if(!acc){
      missingAcc++;
      if(missingAccSamples.length<5) missingAccSamples.push({name:(x&&x.name)||"",addr:(x&&x.addr)||"",phone:(x&&x.phone)||""});
      return;
    }
    if(/[.#$\[\]\/]/.test(acc)){illegalAcc++; if(illegalSamples.length<5)illegalSamples.push(acc);}
    if(seen[acc]){dupAcc++; if(dupSamples.length<5)dupSamples.push(acc);}
    else seen[acc]=1;
  });
  return {tot:arr.length,missingAcc:missingAcc,missingAccSamples:missingAccSamples,dupAcc:dupAcc,dupSamples:dupSamples,illegalAcc:illegalAcc,illegalSamples:illegalSamples,alreadyObj:!_isBadShape(raw)}; // मिली-जुली object list भी "पलटी" गिनी जाए (देखें _isBadShape)
}


// ─── माइग्रेशन-स्थिति ट्रैकिंग (कौन सा HQ/श्रेणी पहले से per-record फॉर्मेट में है) ───
// Firebase path: /MIGRATED/{hqKey}/{catKey} = true — write-path (database.js: fbSet) यही देखकर
// तय करता है कि पूरा array भेजे (पुराना तरीका) या सिर्फ बदले record PATCH करे (नया, migrated तरीका)
// यह flag localStorage में भी रखा जाता है (जैसे CAT_NAMES का dc_catnames3, HQ_PINS का dc_hqpins) —
// पहले सिर्फ़ memory में था और हर बार ऐप खुलने पर खाली ({}) से शुरू होकर सिर्फ़ network से भरता था।
// कमज़ोर नेटवर्क (गांव में आम) में वह fetch नाकाम हो जाता तो isMigrated() झूठा "नहीं" कहता, fbSet()
// पुराने रास्ते _fbPut() पर चला जाता, और _fbPut() का सुरक्षा-guard भी उसी खाली flag को देखकर धोखा
// खा जाता — नतीजा पूरा array लिख जाता और माइग्रेशन पलट जाता। असली bug यही था: production लॉग में
// चार अलग-अलग HQ से "migration-reverted" आ रहे थे, सब नए version वाले devices से (किसी पुराने
// version की वजह से नहीं), और सबसे ज़्यादा उसी device से जिसके "Failed to fetch" सबसे ज़्यादा थे।
// अब fetch नाकाम हो तो पिछली जानी-मानी स्थिति काम आती है, "कुछ भी migrated नहीं" नहीं मान लिया जाता।
var MIG_FLAG_KEY="dc_migrated3";
var MIGRATED = {};
try{var _mf=localStorage.getItem(MIG_FLAG_KEY);if(_mf)MIGRATED=JSON.parse(_mf)||{};}catch(e){}
function isMigrated(hq,cat){
  var hk=hqKey(hq), ck=catKey(cat);
  return !!(MIGRATED[hk]&&MIGRATED[hk][ck]);
}
// v9.167: पढ़ाई नाकाम हो (असली production — ऐप खुलते वक़्त login पूरा होने से पहले पढ़ा गया,
// "Permission denied") तो पहले चुपचाप छोड़ देते थे और flags अगले 12 घंटे तक खाली रहते — उसी बीच
// कोई भी सेव migrated list को array में पलट सकता था। अब नाकाम हो तो कुछ बार, थोड़ा रुककर दोबारा
var MIG_FLAG_RETRY_MS=15000, MIG_FLAG_RETRY_MAX=4;
function loadMigratedFlags(_try){
  _try=_try||0;
  fetch(FB+"/MIGRATED.json?t="+Date.now())
    .then(_fbJson)
    .then(function(d){
      trackUsageOf(d);
      if(d&&typeof d==="object"){
        MIGRATED=d;
        try{localStorage.setItem(MIG_FLAG_KEY,JSON.stringify(d));}catch(e){}
      }
    })
    .catch(function(){
      if(_try<MIG_FLAG_RETRY_MAX) setTimeout(function(){ loadMigratedFlags(_try+1); },MIG_FLAG_RETRY_MS);
    });
}

// ── ऑटो-पहचान + ऑटो-सुधार: कोई पुराने version वाला device migrated list को बचाते समय
// वापस array में न बदल दे — जो भी device वह list खोले/देखे (fbGet या real-time listener से),
// अगर MIGRATED flag "true" है पर data अब भी array दिखे, तो समझो पलट गया — तुरंत ठीक करो
var _revertFixing={};
var _revertUnsafe={}; // इस ऐप-खुलने में "unsafe" निकली list — हर पढ़ाई पर दोबारा कोशिश/लॉग न हो
// ── "मिली-जुली" list — असली bug (JE, मढ़ी/कुल उपभोक्ता, 1134019486 के पहले 2 फिर 3 card) ──
// list पुराने array format में पलटी (keys 0,1,2…), फिर नए devices ने अपने बदलाव per-record PATCH
// (key = Consumer No) से भेजे। Firebase में वह PATCH array के *साथ* एक नई key जोड़ देता है — अब node
// में "0…1504" भी और "1134019486" भी, और Firebase उसे array नहीं, object बताता है। नतीजा: उस
// उपभोक्ता के दो card (पुराना क्रमांक-key वाला + नया Consumer No-key वाला), और क्योंकि data अब array
// नहीं दिखता था, ऊपर वाली "पलट गई" पहचान चुप रहती — हर नए बदलाव पर duplicate बढ़ते जाते।
// अब सही रूप = object जिसकी हर key ठीक उसी record का Consumer No हो; बाक़ी सब (array, या कोई key
// अपने record के acc से अलग) "बिगड़ा रूप" है और वही ऑटो-सुधार चलता है
function _isBadShape(raw){
  if(!raw||typeof raw!=="object") return false;
  if(Array.isArray(raw)) return true;
  return Object.keys(raw).some(function(k){
    var v=raw[k];
    return v&&typeof v==="object"&&accKeyOf(v)!==k;
  });
}
function _checkMigrationRevert(hq,cat,raw){
  if(!isMigrated(hq,cat)) return; // यह HQ/श्रेणी migrated ही नहीं — कुछ जांचने को नहीं
  if(!_isBadShape(raw)) return; // सही (per-record) रूप है — ठीक है
  var key=hqKey(hq)+"/"+catKey(cat);
  if(_revertFixing[key]||_revertUnsafe[key]) return; // सुधार चल रहा है / इस बार पहले ही असुरक्षित निकली
  _revertFixing[key]=true;
  // पहले यह संदेश सीधे "पुराने version वाले device" को दोष देता था — production लॉग से पता चला कि
  // असली वजह अक्सर वो नहीं, बल्कि MIGRATED flag का किसी device पर लोड न हो पाना थी (देखें ऊपर
  // MIG_FLAG_KEY वाला नोट)। संदेश अब असली संभावित कारण बताता है, ताकि जांच ग़लत दिशा में न जाए
  if(Array.isArray(raw)) logErr("migration-reverted","list वापस पुराने array format में मिली — किसी device पर MIGRATED flag लोड न हो पाया होगा (कमज़ोर नेट), या वो बहुत पुराने version पर है। अपने आप ठीक किया जा रहा है",hq+"/"+cat);
  else logErr("migration-mixed","list में पुराने (क्रमांक-key) और नए (Consumer No-key) records मिले-जुले मिले — पलटी list पर नए बदलाव जुड़ने से एक ही उपभोक्ता के कई card बन रहे थे। अपने आप ठीक किया जा रहा है",hq+"/"+cat);
  // नतीजा हमेशा लॉग करें — पहले सिर्फ़ "unsafe" लॉग होता था, "ok"/"already"/"empty" चुपचाप निकल
  // जाते थे (सिर्फ़ एक toast, जो अक्सर किसी ने देखा ही नहीं)। इससे लॉग देखकर यह पता ही नहीं चलता
  // था कि सुधार हुआ या नहीं — असली production में इसी वजह से "migration-reverted" बार-बार दिखता
  // रहा और घंटों यह तय नहीं हो पाया कि समस्या बची है या हल हो चुकी है
  _migrateOne(hq,cat,function(r){
    _revertFixing[key]=false;
    var st=(r&&r.status)||"error";
    if(st==="ok"){
      toast("🛠 "+hq+"/"+cat+" — पुराना format मिला, अपने आप ठीक कर दिया गया","inf");
      logErr("migration-revert-fixed","अपने आप ठीक कर दिया गया — "+((r&&r.count)||0)+" records अब per-record फॉर्मेट में",hq+"/"+cat);
    } else if(st==="unsafe"){
      _revertUnsafe[key]=true;
      logErr("migration-revert-unsafe","ऑटो-सुधार असुरक्षित लगा (acc missing/duplicate) — चरण 3 जांच → \"समस्या वाले records\" देखकर Consumer No भरें",hq+"/"+cat);
    } else if(st==="already"){
      // दोबारा पढ़ने पर list ठीक मिली — किसी और device ने बीच में ठीक कर दिया, या यह झूठा alarm था
      logErr("migration-revert-already","दोबारा जांचने पर list पहले से ठीक (per-record) मिली — किसी और device ने ठीक कर दिया होगा, कुछ करने की ज़रूरत नहीं",hq+"/"+cat);
    } else if(st==="empty"){
      logErr("migration-revert-empty","list खाली मिली — ठीक करने को कुछ नहीं",hq+"/"+cat);
    }
    // "error" पर _migrateOne खुद ही migrate-fail लॉग कर चुका होता है — दोबारा न लिखें
  });
}

// एक ही (trimmed) Consumer No के कई records को एक में मिलाना — पहली वाली जगह (क्रम) पर रहे;
// mergeRecord (storage.js): जिसका ts नया उसके fields, रिमार्क दोनों के (text|by|at से dedup)।
// acc-रहित records जैसे हैं वैसे (वो पहले ही "unsafe" में रुक जाते हैं)
function _migMergeDupes(arr){
  var out=[],at={},merged=0;
  (arr||[]).forEach(function(x){
    if(!x) return;
    var k=accKeyOf(x);
    if(!k){ out.push(x); return; }
    if(at.hasOwnProperty(k)){ out[at[k]]=mergeRecord(x,out[at[k]]); merged++; return; } // पहले वाले के रिमार्क पहले
    at[k]=out.length;
    out.push(x);
  });
  return {arr:out,merged:merged};
}

// array → per-record object — हर record की key उसका acc, क्रम बनाए रखने के लिए 'o' field जोड़ें
// (सिर्फ वही record शामिल जिनका acc हो — dry-run पहले ही पुष्टि कर चुका होता है कि सब ठीक हैं)
function _migConvertToObject(arr){
  var obj={};
  (arr||[]).forEach(function(x,i){
    if(!x||x.acc==null||String(x.acc).trim()==="")return;
    var k=String(x.acc).trim();
    var rec=JSON.parse(JSON.stringify(x));
    rec.o=i;
    rec.acc=k; // key जैसा ही — आगे-पीछे की खाली जगह record में भी न रहे
    obj[k]=rec;
  });
  return obj;
}

// एक HQ/श्रेणी को migrate करना — ताज़ा data दोबारा जांचकर (dry-run के बाद कोई नया गड़बड़ record न आया हो),
// array को object में बदलकर PUT करना, फिर MIGRATED flag सेट करना
function _migrateOne(hq,cat,cb){
  fetch(FB+"/"+fbPath(hq,cat)+".json?t="+Date.now())
    .then(_fbJson)
    .then(function(raw){
      trackUsageOf(raw);
      _noteShape(hq,cat,raw);
      if(!raw){ cb({hq:hq,cat:cat,status:"empty"}); return; }
      if(!_isBadShape(raw)){ cb({hq:hq,cat:cat,status:"already"}); return; }
      // मिली-जुली (object) list — सारे records एक सूची में, पुराने क्रम (o) से; फिर वही रास्ता
      if(!Array.isArray(raw)) raw=normList(raw);
      var a=_migAnalyzeList(raw);
      if(a.missingAcc||a.illegalAcc){ cb({hq:hq,cat:cat,status:"unsafe",a:a}); return; }
      // duplicate Consumer No अब रुकावट नहीं — JE की मंज़ूरी (मढ़ी/कुल उपभोक्ता, 1134019486 के दो card):
      // per-record फॉर्मेट में एक acc की एक ही जगह होती है, और एक ही सूची में एक Consumer No = एक ही
      // उपभोक्ता। इसलिए दोनों को मिलाकर एक कर दो (_migMergeDupes) — नया बदलाव जीते, रिमार्क सबके बचें।
      // पहले यहां "unsafe" पर रुक जाते थे, और सूची पुराने format में ही अटकी रहती
      var merged=0;
      if(a.dupAcc){ var md=_migMergeDupes(raw); raw=md.arr; merged=md.merged; }
      var obj=_migConvertToObject(raw);
      fetch(FB+"/"+fbPath(hq,cat)+".json",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(obj)})
        .then(function(r){
          if(!r.ok) throw new Error("HTTP "+r.status);
          _noteShape(hq,cat,obj); // अब सर्वर पर per-record है — याद रख लो, भले MIGRATED flag न लिख पाएं
          // असली data convert हो चुका (सबसे ज़रूरी हिस्सा) — MIGRATED flag अक्सर पहले से ही "true"
          // होता है (जैसे _checkMigrationRevert के self-heal में, जो isMigrated()===true होने पर
          // ही चलता है) और अब सिर्फ़ JE लिख सकता है (database.rules.json) — तो लाइनमैन के लिए यह
          // दोबारा-लिखाई 401 दे सकती है, पर इससे असली सफल data-conversion को "असफल" मानना ग़लत
          // होगा; इसलिए यहां fail हो तो चुपचाप अनदेखा करो (flag का मान वैसे भी नहीं बदलता)
          return fetch(FB+"/MIGRATED/"+hqKey(hq)+"/"+catKey(cat)+".json",{method:"PUT",headers:{"Content-Type":"application/json"},body:"true"}).catch(function(){});
        })
        .then(function(){
          if(merged) logErr("migration-dup-merged",merged+" duplicate Consumer No वाले card एक में मिलाए गए (नया बदलाव रखा, सबके रिमार्क जोड़े)",hq+"/"+cat);
          cb({hq:hq,cat:cat,status:"ok",count:Object.keys(obj).length,merged:merged});
        })
        .catch(function(e){ logErr("migrate-fail",e,hq+"/"+cat); cb({hq:hq,cat:cat,status:"error",err:String(e&&e.message||e)}); });
    })
    .catch(function(e){ logErr("migrate-fail",e,hq+"/"+cat); cb({hq:hq,cat:cat,status:"error",err:String(e&&e.message||e)}); });
}

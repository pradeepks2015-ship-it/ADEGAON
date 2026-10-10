// ── कुछ फ़ाइलें ज़रूरत पड़ने पर ही उतरें (v9.195) ──
// पहले हर फ़ोन (लाइनमैन का भी) ऐप खुलते ही सारी JS उतारकर पढ़ता था, जिसमें JE के काम वाली
// स्क्रीनें भी थीं — लेजर अपलोड, श्रेणी का नाम बदलना, चरण 3 माइग्रेशन, डेटा-उपयोग। लाइनमैन इन्हें
// कभी खोलता ही नहीं। (PDF/Excel डाउनलोड लाइनमैन भी करता है और PDF बिना नेट भी बनता है — इसलिए वह
// upload.js से निकालकर js/reports.js में रखा है, हमेशा उतरता है।) अब ये फ़ाइलें तभी उतरती हैं जब
// पहली बार कोई इनका बटन दबाए; JE के फ़ोन पर login के कुछ
// सेकंड बाद अपने-आप पहले से उतर जाती हैं, ताकि गांव में बिना नेट के भी चलें।
//
// तरीक़ा: नीचे LAZY_ENTRY में हर वह function है जिसे बाक़ी ऐप (index.html के onclick या दूसरी
// js फ़ाइल) बुलाता है। उसकी जगह पहले एक "खड़ा" function (stub) बैठता है — दबाते ही वह फ़ाइल उतारता
// है, फिर असली function को वही arguments देकर चलाता है। फ़ाइल उतरते ही उसका असली `function X`
// इस stub को अपने-आप हटा देता है (global function declaration)।
// नई lazy फ़ाइल में कोई नया function बाहर से बुलाया जाए तो उसे यहां जोड़ना ज़रूरी है — वरना वह
// बटन "X is not defined" पर टूटेगा। यह जांच tests/smoke.spec.js ("lazy फ़ाइलें") अपने-आप करता है।
// उतरना नाकाम हो (नेट नहीं, फ़ाइल cache में नहीं) तो बटन चुपचाप नहीं बैठता — साफ़ संदेश + error log।
var LAZY_ENTRY = {
  "js/upload.js": ["openUpModal","closeUpModal","closeUpOutside","updateUpCounter","onUpHqChange",
    "_upKeepToggle","_upKeepPreview","onCatChange","setUpMode","dOver","dLeave","dDrop","handleFile",
    "confirmUpload"],
  "js/cat-admin.js": ["openEditCat"],
  "js/migration-tool.js": ["openMigModal","closeMigModal","_migRunDryRun","downloadMigReport"],
  "js/usage-view.js": ["openUsageModal","closeUsageModal","closeUsageOutside"]
};
var LAZY_TIMEOUT_MS = 20000; // बहुत धीमे नेट पर भी इतनी देर बाद साफ़ बता दें कि नहीं खुला
var LAZY_SLOW_MS = 500;      // इससे ज़्यादा लगे तो "खुल रहा है" दिखाएं, ताकि दोबारा-दोबारा न दबाएं
var _lazyJobs = {};

function lazyLoad(file){
  if(_lazyJobs[file]) return _lazyJobs[file];
  _lazyJobs[file]=new Promise(function(res,rej){
    var s=document.createElement("script"), done=false;
    function fin(ok,why){
      if(done) return; done=true; clearTimeout(t);
      if(ok){ res(); return; }
      delete _lazyJobs[file]; // अगली बार दबाने पर फिर कोशिश हो
      try{ s.remove(); }catch(x){}
      rej(new Error(why+" • "+file));
    }
    var t=setTimeout(function(){ fin(false,"समय ख़त्म"); },LAZY_TIMEOUT_MS);
    s.src=file+"?v="+(typeof APP_VER!=="undefined"?APP_VER:"");
    s.onload=function(){ fin(true); };
    s.onerror=function(){ fin(false,"उतर नहीं पाई"); };
    document.body.appendChild(s);
  });
  return _lazyJobs[file];
}

function _lazyStub(name,file){
  var stub=function(){
    var self=this, args=arguments, ev=args[0];
    // खींचकर-छोड़ना (drag/drop) — browser को फ़ाइल ख़ुद खोलने से अभी रोकना ज़रूरी, बाद में नहीं
    if(ev&&ev.preventDefault&&/^(drag|drop)/.test(ev.type||"")) ev.preventDefault();
    var slowT=setTimeout(function(){ if(typeof toast==="function") toast("⏳ खुल रहा है…","inf"); },LAZY_SLOW_MS);
    return lazyLoad(file).then(function(){
      clearTimeout(slowT);
      var real=window[name];
      if(typeof real!=="function"||real===stub) throw new Error(name+" फ़ाइल में नहीं मिला • "+file);
      return real.apply(self,args);
    }).catch(function(e){
      clearTimeout(slowT);
      if(typeof toast==="function") toast("⚠️ यह सुविधा अभी खुल नहीं पाई — नेट चालू करके दोबारा दबाएं","err");
      if(typeof logErr==="function") logErr("lazy-load-fail",e,name);
    });
  };
  stub._lazyStub=true;
  return stub;
}

(function(){
  Object.keys(LAZY_ENTRY).forEach(function(file){
    LAZY_ENTRY[file].forEach(function(name){
      if(typeof window[name]!=="function") window[name]=_lazyStub(name,file);
    });
  });
})();

// JE के फ़ोन पर: login के बाद चुपचाप सब पहले से उतार लो (Service Worker इन्हें cache कर लेता है),
// ताकि नेट न हो तब भी अपलोड/माइग्रेशन खुलें। नाकाम हो तो कोई बात नहीं — बटन दबाने पर फिर कोशिश होगी
function lazyPreloadAll(){
  Object.keys(LAZY_ENTRY).forEach(function(file){ lazyLoad(file).catch(function(){}); });
}

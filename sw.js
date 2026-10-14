var CACHE_NAME="adegaon-dc-v242";
// ध्यान दें: ./vendor/papaparse.min.js (20KB) और ./vendor/xlsx.full.min.js (862KB) जान-बूझकर
// यहां शामिल नहीं हैं — ये सिर्फ़ Excel/CSV वाले features (backup/upload) इस्तेमाल होने पर
// js/storage.js की ensureLibs() से lazy-load होती हैं। पहले हर version-update पर हर device
// (lineman समेत, जिन्हें अब Excel/upload दिखता भी नहीं) यह 862KB फ़ाइल फिर से डाउनलोड करता था,
// चाहे कभी इस्तेमाल हो या न हो — असली bug यही था (मोबाइल डेटा की बर्बादी)। अब यह सिर्फ़ पहली बार
// असल में इस्तेमाल होने पर ही डाउनलोड होगी (fetch handler खुद-ब-खुद उसे तभी cache कर लेता है)।
// इन फ़ाइलों में से कोई भी weak network पर cache होने में नाकाम रहे तो पूरा install नाकाम माना जाए
// (skipWaiting न हो, पुराना/कोई SW नहीं तो browser अपने-आप अगली बार register() पर दोबारा कोशिश
// करेगा) — वरना पहले जैसे partial install होता था: कुछ js file cache हो जातीं, कुछ नहीं, और
// कोई भी बाद में offline पड़े तो जो cache नहीं हुई वो script सिरे से लोड ही नहीं होती जबकि जो हुई
// वो चलती रहती — असली bug यही था ("escHtml is not defined [home-scorecard.js]" जैसी errors,
// क्योंकि list.js cache नहीं हुई थी पर उसका function इस्तेमाल करने वाली home-scorecard.js हो गई थी)
// v9.195: js/upload.js, js/cat-admin.js, js/migration-tool.js, js/usage-view.js जान-बूझकर यहां नहीं —
// ये ज़रूरत पड़ने पर ही उतरती हैं (js/lazy.js), और तब नीचे वाला fetch handler इन्हें cache कर लेता है
var CORE=[
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check-compat.js",
  "./css/style.css",
  "./js/config.js",
  "./js/logger.js",
  "./js/lazy.js",
  "./js/firebase.js",
  "./js/storage.js",
  "./js/database.js",
  "./js/database-write.js",
  "./js/database-live.js",
  "./js/usage.js",
  "./js/ui-core.js",
  "./js/auth.js",
  "./js/list.js",
  "./js/share.js",
  "./js/celebration.js",
  "./js/reports.js",
  "./js/scorecards.js",
  "./js/village.js",
  "./js/migration.js",
  "./js/home-scorecard.js",
  "./js/profile.js",
  "./js/main.js",
  "./"
];
// सिर्फ़ visual/PWA-install-prompt के लिए — इनके बिना भी ऐप का JS ठीक चलता है, इसलिए इनकी
// नाकामी पूरे install को न रोके (पुराना तरीक़ा — चुपचाप स्किप)
var OPTIONAL=[
  "./manifest.json",
  "./icons/icon-192.png",
  // icon-512.png (327 KB) और icon-maskable-512.png (183 KB) अब यहां नहीं — ये सिर्फ़ manifest.json में
  // ऐप install होते वक़्त browser ख़ुद नेट से लेता है; offline चलने के लिए इनकी ज़रूरत नहीं थी, फिर
  // भी हर नए फ़ोन पर ~510 KB उतरते थे। login पन्ने का logo अब यह छोटी फ़ाइल है (~14 KB)
  "./icons/login-logo.webp",
  // v9.211: शीर्षक वाला font (Baloo 2) — अब Google से नहीं, यहीं से; offline में भी वही अक्षर
  "./fonts/baloo2-devanagari.woff2",
  "./fonts/baloo2-latin.woff2",
  "./icons/apple-touch-icon.png",
  "./icons/tower-decoration.svg",
  "./icons/scorecard-icon.svg",
  "./icons/mascot.webp",
  // जश्न की असली आवाज़ें — कुल 63 KB (JE की दी हुई 1.88 MB फ़ाइलों को काटकर/mono करके)।
  // OPTIONAL में हैं ताकि गाँव में offline रहते हुए भी बजें, पर इनके न मिलने से पूरा install
  // न रुके — तब ऐप बनी हुई (synthesized) आवाज़ पर लौट जाता है
  "./sounds/clap.mp3",
  "./sounds/wow1.mp3",
  "./sounds/wow2.mp3"
];
// v9.211: install हमेशा सर्वर से ताज़ा पूछे (no-cache = ETag से जांच; बदली नहीं तो छोटा 304)। अब ऐप
// की फ़ाइलें पहले फ़ोन की कॉपी से चलती हैं (नीचे fetch), इसलिए नए version की cache में browser की
// पुरानी (GitHub Pages ~10 मिनट तक रखता है) प्रति आ गई तो वह अगले version तक अटकी रहती
function _fresh(u){ return new Request(u,{cache:"no-cache"}); }
self.addEventListener("install",function(e){
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(c){
      return Promise.all(CORE.map(function(u){return c.add(_fresh(u));}))
        .then(function(){
          return Promise.all(OPTIONAL.map(function(u){return c.add(_fresh(u)).catch(function(){});}));
        });
    }).then(function(){return self.skipWaiting();})
  );
});
self.addEventListener("activate",function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){return k!==CACHE_NAME;}).map(function(k){return caches.delete(k);}));
    }).then(function(){return self.clients.claim();})
  );
});
// ── v9.211: ऐप की अपनी फ़ाइलें पहले फ़ोन की कॉपी से ──
// पहले हर फ़ाइल पहले नेट से मांगी जाती थी, और फ़ोन वाली कॉपी तभी मिलती जब नेट पूरी तरह टूटा हो।
// गांव में अक्सर नेट "है पर बहुत धीमा" होता है — तब ऐप हर फ़ाइल के लिए नेट का इंतज़ार करता (कोई
// समय-सीमा नहीं), जबकि वही फ़ाइल फ़ोन में रखी थी। अब इसी साइट की फ़ाइलें (और मुख्य पन्ना) पहले cache
// से — ऐप तुरंत खुलता है। नया version पहले की तरह आता है: नया sw.js (CACHE_NAME बदला) install होकर
// सारी फ़ाइलें ताज़ा उतारता है, फिर "नया version आ गया" (js/reports.js)। एक version की सारी फ़ाइलें
// एक साथ बदलती हैं, इसलिए पुरानी-नई फ़ाइलों का मेल ("X is not defined") भी नहीं होता।
// दूसरी साइटों (Google/Firebase) की चीज़ें पहले जैसी नेट-पहले; Firebase डेटा SW छूता ही नहीं
function _isOwnFile(url){
  try{ return !!(self.location&&url.indexOf(self.location.origin+"/")===0); }catch(x){ return false; }
}
function _fromCache(req){
  // मुख्य पन्ना WhatsApp लिंक (?…) या index.html से भी खुलता है — सबके लिए वही रखी हुई कॉपी
  return caches.match(req,{ignoreSearch:req.mode==="navigate"}).then(function(m){
    if(m||req.mode!=="navigate") return m;
    try{ if(/\/(index\.html)?$/.test(new URL(req.url).pathname)) return caches.match("./"); }catch(x){}
  });
}
self.addEventListener("fetch",function(e){
  var url=e.request.url;
  if(e.request.method!=="GET") return;
  if(url.indexOf("firebaseio.com")!==-1) return; /* data hamesha network se — app khud offline handle karta hai */
  if(_isOwnFile(url)){
    e.respondWith(_fromCache(e.request).then(function(m){ return m||_networkFirst(e); }));
    return;
  }
  e.respondWith(_networkFirst(e));
});
// नेट पहले, नाकाम हो तो cache — दूसरी साइटों के लिए, और अपनी उन फ़ाइलों के लिए जो अभी cache में नहीं
function _networkFirst(e){
  return (
    fetch(e.request).then(function(res){
      if(res && res.ok){
        var copy=res.clone();
        caches.open(CACHE_NAME).then(function(c){c.put(e.request,copy);});
        return res;
      }
      // सर्वर ने जवाब तो दिया, पर ग़लत (404/5xx) — पहले यह जवाब ज्यों का त्यों लौटा दिया जाता था,
      // यानी वह error-पन्ना ही script बनकर चलता। नतीजा: उस फ़ाइल का कोई function बनता ही नहीं और
      // बाक़ी ऐप "X is not defined" पर टूट जाती (असली production: v9.127 के deploy के दौरान
      // "setSyncStatus is not defined")। नीचे वाला catch सिर्फ़ network *टूटने* पर चलता है, ग़लत
      // status पर नहीं — यही छेद था। अब cache में जो सही प्रति पड़ी है वही दे देते हैं
      return caches.match(e.request).then(function(m){
        if(m) return m;
        if(e.request.mode==="navigate") return caches.match("./").then(function(h){ return h||res; });
        return res; // cache में भी कुछ नहीं — तब असली जवाब ही लौटाना पड़ेगा
      });
    }).catch(function(){
      return caches.match(e.request).then(function(m){
        if(m) return m;
        if(e.request.mode==="navigate") return caches.match("./");
      });
    })
  );
}

var CACHE_NAME="adegaon-dc-v115";
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
var CORE=[
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check-compat.js",
  "./css/style.css",
  "./js/config.js",
  "./js/logger.js",
  "./js/firebase.js",
  "./js/storage.js",
  "./js/database.js",
  "./js/usage.js",
  "./js/ui-core.js",
  "./js/list.js",
  "./js/upload.js",
  "./js/reports.js",
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
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/tower-decoration.svg",
  "./icons/scorecard-icon.svg"
];
self.addEventListener("install",function(e){
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(c){
      return Promise.all(CORE.map(function(u){return c.add(u);}))
        .then(function(){
          return Promise.all(OPTIONAL.map(function(u){return c.add(u).catch(function(){});}));
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
self.addEventListener("fetch",function(e){
  var url=e.request.url;
  if(e.request.method!=="GET") return;
  if(url.indexOf("firebaseio.com")!==-1) return; /* data hamesha network se — app khud offline handle karta hai */
  e.respondWith(
    fetch(e.request).then(function(res){
      if(res && res.ok){
        var copy=res.clone();
        caches.open(CACHE_NAME).then(function(c){c.put(e.request,copy);});
      }
      return res;
    }).catch(function(){
      return caches.match(e.request).then(function(m){
        if(m) return m;
        if(e.request.mode==="navigate") return caches.match("./");
      });
    })
  );
});

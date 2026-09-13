var CACHE_NAME="adegaon-dc-v157";
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
  "./icons/scorecard-icon.svg",
  "./icons/mascot.webp",
  // जश्न की असली आवाज़ें — कुल 63 KB (JE की दी हुई 1.88 MB फ़ाइलों को काटकर/mono करके)।
  // OPTIONAL में हैं ताकि गाँव में offline रहते हुए भी बजें, पर इनके न मिलने से पूरा install
  // न रुके — तब ऐप बनी हुई (synthesized) आवाज़ पर लौट जाता है
  "./sounds/clap.mp3",
  "./sounds/wow1.mp3",
  "./sounds/wow2.mp3"
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
});

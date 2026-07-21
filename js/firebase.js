var FB = "https://adegaon-dc-top-50-default-rtdb.firebaseio.com";
var CACHE = {};

// ── FIREBASE AUTH: गुमनाम (anonymous) sign-in — बिना इसके अब DB access नहीं मिलेगा ──
// (config secret नहीं है — असली सुरक्षा Firebase Security Rules से आती है, इसे छुपाने की ज़रूरत नहीं)
var firebaseConfig = {
  apiKey: "AIzaSyAPFZ2wqPYVMyvU4WqYrKUinVERBkVqdmY",
  authDomain: "adegaon-dc-top-50.firebaseapp.com",
  databaseURL: "https://adegaon-dc-top-50-default-rtdb.firebaseio.com",
  projectId: "adegaon-dc-top-50",
  storageBucket: "adegaon-dc-top-50.firebasestorage.app",
  messagingSenderId: "265994697235",
  appId: "1:265994697235:web:6158cdf1200bd86c201de6"
};
var ID_TOKEN = null;
var _tokenWaiters = []; // app खुलते ही token बनने से पहले निकली DB-calls यहां इंतज़ार करती हैं
try{
  firebase.initializeApp(firebaseConfig);
  firebase.auth().onIdTokenChanged(function(u){
    if(u){
      u.getIdToken().then(function(t){
        ID_TOKEN=t;
        _tokenWaiters.splice(0).forEach(function(f){try{f();}catch(e){}});
      });
    }
    else { firebase.auth().signInAnonymously().catch(function(){setSyncStatus(false);}); }
  });
}catch(e){}

// FB (Realtime Database) की हर fetch call में auth token अपने आप जुड़ जाए — कहीं और कोड बदलने की ज़रूरत नहीं
// token अभी न बना हो तो 4 sec तक इंतज़ार — वरना app खुलते ही निकली save बिना token के 401 खा जाती है
var _rawFetch = window.fetch.bind(window);
function _withToken(url){
  return url + (url.indexOf("?")>-1?"&":"?") + "auth=" + encodeURIComponent(ID_TOKEN);
}
window.fetch = function(url, opts){
  if(typeof url==="string" && url.indexOf(FB)===0){
    if(ID_TOKEN) return _rawFetch(_withToken(url), opts);
    if(!navigator.onLine) return _rawFetch(url, opts); // offline — तुरंत fail होकर offline-queue संभाले
    return new Promise(function(resolve){
      var done=false;
      var tm=setTimeout(function(){ if(done)return; done=true; resolve(_rawFetch(url, opts)); },4000);
      _tokenWaiters.push(function(){
        if(done)return; done=true; clearTimeout(tm);
        resolve(_rawFetch(_withToken(url), opts));
      });
    });
  }
  return _rawFetch(url, opts);
};


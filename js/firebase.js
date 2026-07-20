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
try{
  firebase.initializeApp(firebaseConfig);
  firebase.auth().onIdTokenChanged(function(u){
    if(u){ u.getIdToken().then(function(t){ID_TOKEN=t;}); }
    else { firebase.auth().signInAnonymously().catch(function(){setSyncStatus(false);}); }
  });
}catch(e){}

// FB (Realtime Database) की हर fetch call में auth token अपने आप जुड़ जाए — कहीं और कोड बदलने की ज़रूरत नहीं
var _rawFetch = window.fetch.bind(window);
window.fetch = function(url, opts){
  if(typeof url==="string" && url.indexOf(FB)===0 && ID_TOKEN){
    url += (url.indexOf("?")>-1?"&":"?") + "auth=" + encodeURIComponent(ID_TOKEN);
  }
  return _rawFetch(url, opts);
};


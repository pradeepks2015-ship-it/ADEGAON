// INIT — बिना इन्टरनेट भी app तुरंत खुले
var _appStarted=false;
function startApp(){
  if(_appStarted)return; _appStarted=true;
  loadCatNames();
  loadMigratedFlags();
  loadHQPins();
  rebuildCatsForHQ(HQS[0]);
  hideLoader();
  setSyncStatus(navigator.onLine);
  hscLoadLocal(); renderHomeSc();
  if(navigator.onLine){ensureLibs();flushPending();hscFetch();}
  // Pull-to-refresh जैसा असली page reload, और मोबाइल पर ऐप minimize होने के बाद OS का tab मार
  // देना — दोनों CU (JS memory) मिटा देते हैं। सेव किया हुआ session मिले तो login screen दिखाए
  // बिना चुपचाप वापस अंदर ले जाएं (Firebase का अपना auth session वैसे भी बना रहता है — यह सिर्फ़
  // app की अपनी UI उसी के साथ मिला रहा है)। _finishLogin() अंदर saveSession() से समय ताज़ा कर
  // देता है, यानी रोज़ इस्तेमाल करने वाले को कभी दोबारा login नहीं करना पड़ता
  var savedCU=loadSession();
  if(savedCU){
    CU=savedCU;
    _finishLogin(CU.name,true);
  } else {
    document.getElementById("login-screen").classList.add("active");
  }
}
setTimeout(startApp,2000); // network धीमा/बंद हो तो भी app खुल जाए
fetch(FB+"/.json?shallow=true&t="+Date.now())
  .then(function(){setSyncStatus(true);startApp();})
  .catch(function(){setSyncStatus(false);startApp();});

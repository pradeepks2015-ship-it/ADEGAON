// ── वसूली दर्ज होने पर जश्न (आवाज़ + एनिमेशन) — list.js से अलग किया गया (structure सुधार,
// यह पूरा हिस्सा list-rendering से स्वतंत्र concern है, सिर्फ़ markPaid() इसे बुलाता है) ──────
// यह पूरी तरह device के अंदर की चीज़ है — कोई image/font/library/network call नहीं, इसलिए
// Firebase की bandwidth या billing पर एक बाइट का भी असर नहीं (JE की शर्त: कॉस्ट न बढ़े)।
// जान-बूझकर pointer-events:none और अपने आप हट जाना — लाइनमैन एक के बाद एक कई वसूली दर्ज
// करता है, जश्न उसका काम एक पल के लिए भी रोके नहीं
// 1700ms रखा था, पर JE ने बताया कि उतने में जश्न "समझ ही नहीं आ पाता" — पलक झपकते ही चला
// जाता था। अब इतना कि ताली, अंगूठा और नाम तीनों ठीक से दिख जाएँ, फिर भी काम रुके नहीं
// (pointer-events:none है, यानी नीचे की लिस्ट पूरे समय दबाई जा सकती है)
var CELEB_MS=3900;
// आज इस कर्मचारी ने अब तक कितनी वसूली की — सिर्फ़ device के अपने cache से गिनती, कोई fetch नहीं।
// एक ही उपभोक्ता कई श्रेणियों में होता है (propagateStatus हर जगह status copy कर देता है),
// इसलिए acc से dedup ज़रूरी — वरना एक वसूली 8 गिनी जाती
function _celebTodayCount(hq){
  var today=new Date().toLocaleDateString("hi-IN");
  var me=_dvNameKeySafe(CU&&CU.name);
  var seen={},n=0;
  for(var i=0;i<CATS_DEFAULT.length;i++){
    var cat=isCatEditable(i)?getCatName(hq,i):CATS_DEFAULT[i];
    var d=cGet(hq,cat);
    if(!d||!d.length) continue;
    for(var j=0;j<d.length;j++){
      var x=d[j];
      if(!x||x.status!=="paid"||!x.acc) continue;
      if(x.paydate!==today) continue;
      if(me&&_dvNameKeySafe(x.updatedBy)!==me) continue;
      var k=String(x.acc).trim();
      if(seen[k]) continue;
      seen[k]=1; n++;
    }
  }
  return n;
}
// logger.js का _dvNameKey यहां भी चाहिए, पर वह फ़ाइल cache न हुई हो (weak network) तो
// पूरा markPaid न टूटे — इसलिए सुरक्षित wrapper
function _dvNameKeySafe(n){
  try{ return _dvNameKey(n); }
  catch(e){ return String(n==null?"":n).trim().toLowerCase(); }
}
// ── जश्न की आवाज़ ────────────────────────────────────────────────────────────────────────────
// पहले सब कुछ फ़ोन के अंदर ही बनाया जाता था (Web Audio), ताकि एक बाइट भी डाउनलोड न हो। पर JE ने
// सुनकर बताया कि बनाई हुई तालियाँ असली नहीं लगतीं ("तालियां सही नहीं आ रही हैं") — और वह सही था:
// असली तालियों की बनावट (हर व्यक्ति की अलग ताली, कमरे की गूँज, भीड़ का घनत्व) संश्लेषण से नहीं आती।
// इसलिए अब तीन असली रिकॉर्डिंग इस्तेमाल होती हैं। JE ने जो फ़ाइलें दीं वे कुल 1.88 MB की थीं
// (तालियाँ अकेले 54 सेकंड / 1.7 MB) — उन्हें काटकर, mono करके, आवाज़ बराबर करके 63 KB कर दिया गया:
//   sounds/clap.mp3  4.0s  28 KB   (54s में से सबसे तेज़ 4 सेकंड, दोनों सिरों पर fade)
//   sounds/wow1.mp3  1.9s  13 KB   (पुरुष स्वर)
//   sounds/wow2.mp3  3.0s  21 KB   (महिला स्वर)
// खर्च का हिसाब: ये Netlify से आती हैं, Firebase से नहीं — यानी रोज़ाना 360 MB वाले download
// quota पर इनका कोई असर नहीं। हर device इन्हें ज़िंदगी में एक बार उतारता है और service worker
// उन्हें रख लेता है; आवाज़ बंद हो तो उतरती ही नहीं (नीचे _sndWarm देखें)।
// ध्यान: मोबाइल ब्राउज़र बिना उपयोगकर्ता के छूए आवाज़ नहीं चलने देते — यहां दिक़्क़त नहीं, क्योंकि
// "✓ वसूल" दबाना खुद एक tap है। फ़ोन silent पर हो तो (ख़ासकर iPhone) आवाज़ नहीं आएगी — यह
// ब्राउज़र की सीमा है, इसमें कुछ किया नहीं जा सकता
var _ac=null;
function _celebAudioCtx(){
  if(_ac) return _ac;
  try{
    var C=window.AudioContext||window.webkitAudioContext;
    if(!C) return null;
    _ac=new C();
  }catch(e){ return null; }
  return _ac;
}
// ── असली रिकॉर्डिंग: एक बार उतरे, फिर हमेशा memory से बजे ────────────────────────────────────
// हर फ़ाइल ज़्यादा से ज़्यादा एक बार माँगी जाती है (चाहे नाकाम ही क्यों न हो) — कमज़ोर नेट पर
// बार-बार कोशिश करके डेटा बर्बाद न हो। decode किया हुआ AudioBuffer memory में रहता है
var SND_SRC={clap:"sounds/clap.mp3",wow1:"sounds/wow1.mp3",wow2:"sounds/wow2.mp3"};
var _sndBuf={}, _sndTried={};
function _sndLoad(key){
  if(_sndTried[key]) return;          // एक ही कोशिश — नाकाम रही तो बनी हुई आवाज़ चल जाएगी
  _sndTried[key]=true;
  var ctx=_celebAudioCtx(); if(!ctx||!SND_SRC[key]) return;
  fetch(SND_SRC[key]).then(function(r){
    if(!r.ok) throw new Error("HTTP "+r.status);
    return r.arrayBuffer();
  }).then(function(ab){
    return new Promise(function(res,rej){
      // पुराने Safari का decodeAudioData Promise नहीं लौटाता — दोनों तरीक़े संभाले
      var p=ctx.decodeAudioData(ab,function(b){res(b);},function(e){rej(e);});
      if(p&&p.then) p.then(res,rej);
    });
  }).then(function(b){ _sndBuf[key]=b; }).catch(function(){});
}
// आवाज़ चालू हो तभी उतारें — बंद रखने वाले device पर एक बाइट भी खर्च न हो
function _sndWarm(){
  try{ if(!celebSoundOn()) return; }catch(e){ return; }
  Object.keys(SND_SRC).forEach(_sndLoad);
}
function _sndPlay(key,t,gain,dur){
  var ctx=_celebAudioCtx(); if(!ctx) return false;
  var b=_sndBuf[key];
  if(!b){ _sndLoad(key); return false; } // अभी तैयार नहीं — caller बनी हुई आवाज़ पर लौट जाए
  var src=ctx.createBufferSource(); src.buffer=b;
  var g=ctx.createGain(); g.gain.value=gain;
  // तय समय पर धीरे-धीरे बंद, ताकि जश्न ख़त्म होने के बाद आवाज़ लटकी न रह जाए
  var end=t+Math.min(dur,b.duration);
  g.gain.setValueAtTime(gain,Math.max(t,end-0.5));
  g.gain.exponentialRampToValueAtTime(0.0001,end);
  src.connect(g); g.connect(ctx.destination);
  src.start(t); src.stop(end+0.02);
  return true;
}
// एक ताली = बहुत छोटा शोर का झटका, जो तुरंत बुझ जाए।
// फ़िल्टर पहले bandpass (1400Hz, Q 0.8) था — वह ताली की ज़्यादातर ऊर्जा छान देता था, इसलिए
// दबी-सी "टिक" सुनाई देती थी। असली ताली चौड़े बैंड की होती है, इसलिए अब highpass:
// नीचे की गड़गड़ न रहे, पर ऊपर का पूरा कड़कपन बचा रहे
function _clapAt(ctx,t,gain){
  var len=Math.floor(ctx.sampleRate*0.055);
  var buf=ctx.createBuffer(1,len,ctx.sampleRate);
  var ch=buf.getChannelData(0);
  for(var i=0;i<len;i++){
    var d=1-(i/len);
    ch[i]=(Math.random()*2-1)*d*d*d; // तेज़ी से बुझता शोर — यही ताली जैसा सुनाई देता है
  }
  var src=ctx.createBufferSource(); src.buffer=buf;
  var hp=ctx.createBiquadFilter(); hp.type="highpass"; hp.frequency.value=900;
  var g=ctx.createGain(); g.gain.value=gain;
  src.connect(hp); hp.connect(g); g.connect(ctx.destination);
  src.start(t);
}
// भीड़ की गड़गड़ाहट — दर्जनों तालियाँ आपस में गुंथी हुईं। हर ताली के लिए अलग BufferSource बनाना
// सस्ते फ़ोन पर भारी पड़ता, इसलिए पूरी गड़गड़ाहट *एक ही* buffer में सीधे लिख दी जाती है:
// यादृच्छिक समय पर सैकड़ों छोटे-छोटे झटके, ऊपर से चढ़ता-उतरता लिफ़ाफ़ा (पहले भीड़ जुड़ती है,
// फिर धीमी पड़ती है)। एक buffer + एक source = एक ही आवाज़, पर खर्च नाम-मात्र
function _applauseBed(ctx,t,dur,gain){
  var sr=ctx.sampleRate, len=Math.floor(sr*dur);
  var buf=ctx.createBuffer(1,len,sr);
  var ch=buf.getChannelData(0);
  var hits=Math.floor(dur*150);           // ~150 ताली प्रति सेकंड (कई लोग एक साथ)
  var burst=Math.floor(sr*0.028);
  for(var h=0;h<hits;h++){
    var at=Math.floor(Math.random()*(len-burst));
    // लिफ़ाफ़ा: शुरू में तेज़ी से चढ़े, अंत तक धीरे-धीरे उतरे
    var pos=at/len;
    var env=pos<0.18?(pos/0.18):(1-(pos-0.18)/0.82*0.85);
    var amp=(0.35+Math.random()*0.65)*env;
    for(var i=0;i<burst;i++){
      var d=1-(i/burst);
      ch[at+i]+=(Math.random()*2-1)*d*d*amp*0.06;
    }
  }
  var src=ctx.createBufferSource(); src.buffer=buf;
  var hp=ctx.createBiquadFilter(); hp.type="highpass"; hp.frequency.value=700;
  var lp=ctx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=9000;
  var g=ctx.createGain(); g.gain.value=gain;
  src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(ctx.destination);
  src.start(t);
}
// "वाह!" — भीड़ की चीयर। असली इंसानी आवाज़ के लिए कोई audio फ़ाइल डाउनलोड करनी पड़ती, इसलिए
// यहाँ स्वर-ध्वनि बनाई गई है: शोर को दो formant फ़िल्टरों से गुज़ारा जाता है जिनकी आवृत्ति
// "ऊ → आ → ऊ" की तरह घूमती है — कान इसे भीड़ के "वाआआओ" जैसा सुनता है। पूरी तरह मुफ़्त
function _cheerAt(ctx,t,dur,gain){
  var sr=ctx.sampleRate, len=Math.floor(sr*dur);
  var buf=ctx.createBuffer(1,len,sr);
  var ch=buf.getChannelData(0);
  for(var i=0;i<len;i++) ch[i]=Math.random()*2-1;
  var src=ctx.createBufferSource(); src.buffer=buf;
  // F1/F2 — स्वर बनाने वाले दो अनुनाद; इन्हीं के चलने से "वाओ" जैसा लगता है
  var f1=ctx.createBiquadFilter(); f1.type="bandpass"; f1.Q.value=7;
  var f2=ctx.createBiquadFilter(); f2.type="bandpass"; f2.Q.value=9;
  f1.frequency.setValueAtTime(360,t);
  f1.frequency.linearRampToValueAtTime(760,t+dur*0.42);
  f1.frequency.linearRampToValueAtTime(430,t+dur);
  f2.frequency.setValueAtTime(820,t);
  f2.frequency.linearRampToValueAtTime(1350,t+dur*0.42);
  f2.frequency.linearRampToValueAtTime(950,t+dur);
  var g=ctx.createGain();
  g.gain.setValueAtTime(0,t);
  g.gain.linearRampToValueAtTime(gain,t+dur*0.22);     // भीड़ का स्वर चढ़ता है
  g.gain.setValueAtTime(gain,t+dur*0.55);
  g.gain.exponentialRampToValueAtTime(0.0001,t+dur);   // फिर धीरे-धीरे बैठ जाता है
  src.connect(f1); f1.connect(f2); f2.connect(g); g.connect(ctx.destination);
  src.start(t); src.stop(t+dur+0.02);
}
function _dingAt(ctx,t,freq,dur,gain){
  var o=ctx.createOscillator(); o.type="sine"; o.frequency.value=freq;
  var g=ctx.createGain();
  g.gain.setValueAtTime(0,t);
  g.gain.linearRampToValueAtTime(gain,t+0.015);
  g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
  o.connect(g); g.connect(ctx.destination);
  o.start(t); o.stop(t+dur+0.02);
}
function _celebSound(big){
  if(!celebSoundOn()) return;
  var ctx=_celebAudioCtx();
  if(!ctx) return;
  try{ if(ctx.state==="suspended") ctx.resume(); }catch(e){}
  var t=ctx.currentTime+0.01;
  var dur=big?3.4:3.0;
  // 1) तालियाँ — असली रिकॉर्डिंग; न उतरी हो तो बनी हुई गड़गड़ाहट पर लौट जाओ
  if(!_sndPlay("clap",t,big?1:0.85,dur)){
    _applauseBed(ctx,t,dur,big?0.85:0.7);
    var claps=big?14:10;
    for(var i=0;i<claps;i++) _clapAt(ctx,t+0.02+i*0.115+Math.random()*0.035,(big?0.5:0.42)*(1-i/(claps*1.6)));
  }
  // 2) "वाओ" — दो असली आवाज़ें (पुरुष/महिला), हर बार यादृच्छिक, ताकि रोज़ सुनकर मन न भरे।
  // दोनों में से जो तैयार हो वही; कोई न हो तो बनी हुई चीयर
  var pick=Math.random()<0.5?"wow1":"wow2", other=pick==="wow1"?"wow2":"wow1";
  if(!_sndPlay(pick,t+0.18,0.95,dur-0.18) && !_sndPlay(other,t+0.18,0.95,dur-0.18)){
    _cheerAt(ctx,t+0.12,dur*0.72,big?0.5:0.42);
  }
  // 3) चढ़ती घंटी — हर 10वीं वसूली पर एक सुर ज़्यादा
  _dingAt(ctx,t+0.14,784,0.30,0.10);    // G5
  _dingAt(ctx,t+0.30,1046.5,0.36,0.09); // C6
  if(big){ _dingAt(ctx,t+0.46,1318.5,0.48,0.09); _dingAt(ctx,t+0.66,1568,0.6,0.08); } // E6, G6
}

// ── एक उपभोक्ता पर दिन में एक ही बार जश्न ─────────────────────────────────────
// जश्न खुद एक बाइट नेटवर्क खर्च नहीं करता, पर वह बार-बार "✓ वसूल ↔ ↩ वापस बाकी" दबाने का
// लालच पैदा करता है — और *वह* महंगा है: हर मार्क Firebase पर लिखा जाता है, propagateStatus
// उसे हर उस श्रेणी में भी लिखता है जिसमें वही उपभोक्ता है, और हर लिखाई बाक़ी जुड़े फ़ोनों पर
// push होती है (यही download quota में गिनती है)। इसलिए दोबारा मार्क करने पर जश्न नहीं दिखता —
// लालच ही न रहे। सिर्फ़ आज का हिसाब रखा जाता है, ताकि यह सूची बढ़ती न जाए
var CELEB_DONE_KEY="dc_celebdone";
function _celebDoneToday(){
  var today=new Date().toLocaleDateString("hi-IN");
  var o=null;
  try{ o=JSON.parse(localStorage.getItem(CELEB_DONE_KEY)); }catch(e){}
  if(!o||typeof o!=="object"||o.d!==today) o={d:today,a:{}}; // दिन बदला — कल का हिसाब भूल जाओ
  if(!o.a||typeof o.a!=="object") o.a={};
  return o;
}
// आज इस उपभोक्ता को कितनी बार "वसूल" मार्क किया जा चुका है — गिनती बढ़ाकर नई संख्या लौटाता है।
// यही एक गिनती दो काम करती है: (1) जश्न सिर्फ़ पहली बार, (2) हद से ज़्यादा टॉगल होने पर चेतावनी
function _paidMarkCountToday(acc){
  var key=String(acc==null?"":acc).trim();
  if(!key) return 0; // acc ही नहीं — गिनने का कोई ज़रिया नहीं
  var o=_celebDoneToday();
  var n=(Number(o.a[key])||0)+1;
  o.a[key]=n;
  try{ localStorage.setItem(CELEB_DONE_KEY,JSON.stringify(o)); }catch(e){}
  return n;
}
// पहली बार हो तो true; उसी उपभोक्ता पर दोबारा हो तो false
function _celebFirstTimeToday(acc){
  var key=String(acc==null?"":acc).trim();
  if(!key) return true; // acc नहीं है तो रोकने का कोई आधार नहीं — जश्न दिखा दो
  return _paidMarkCountToday(key)===1;
}

// ── हद से ज़्यादा टॉगल पर JE को पता चले ────────────────────────────────────────
// एक ही उपभोक्ता को दिन में इतनी बार "वसूल" मार्क करना सामान्य काम में नहीं होता — असली सुधार
// एक-दो बार में हो जाता है। इससे ज़्यादा का मतलब है या तो कोई गड़बड़ी है या कोई जान-बूझकर
// बार-बार दबा रहा है। यह रोकता नहीं (हो सकता है कोई असली वजह हो), सिर्फ़ एक बार लॉग करता है
// ताकि JE को "एरर लॉग" में दिख जाए कि कौन, किस उपभोक्ता पर, कितनी बार।
// हर मार्क Firebase पर लिखा जाता है और बाक़ी जुड़े फ़ोनों पर push होता है — इसीलिए यह
// bandwidth का सवाल भी है, सिर्फ़ अनुशासन का नहीं
var TOGGLE_WARN_AT=4;
function _warnIfTooManyMarks(n,rec){
  if(n!==TOGGLE_WARN_AT) return; // ठीक इसी गिनती पर, यानी दिन में एक ही बार लॉग हो
  try{
    logErr("repeat-mark",
      "एक ही उपभोक्ता को आज "+n+" बार 'वसूल' मार्क किया गया — "+
      ((rec&&rec.name)||"(नाम नहीं)")+" (क्र. "+((rec&&rec.acc)||"?")+")। "+
      "हर बार Firebase पर लिखा जाता है और बाक़ी फ़ोनों पर भेजा जाता है, इसलिए बेवजह दोहराने से "+
      "डेटा-खर्च बढ़ता है। ज़रूरी हो तो संबंधित कर्मचारी से पूछ लें।",
      activeHQ+"/"+activeCat);
  }catch(e){}
}

function _celebPaid(rec){
  if(typeof document==="undefined") return;
  var old=document.getElementById("celeb");
  if(old) old.parentNode.removeChild(old); // पिछला जश्न अभी चल रहा हो तो उसे हटाकर नया
  var wrap=document.createElement("div");
  wrap.className="celeb"; wrap.id="celeb";
  var n=_celebTodayCount(activeHQ);
  var amt=Number(rec&&rec.amount)||0; // असली field "amount" है (देखें renderListWith का cc-amt)
  var name=(CU&&CU.name)||"";
  // हर 10वीं वसूली पर थोड़ा बड़ा जश्न — दिन भर एक ही चीज़ देखकर मन न भरे
  var big=(n>0&&n%10===0);
  var card=document.createElement("div");
  card.className="celeb-card";
  // मैस्कॉट — icons/mascot.webp सिर्फ़ 8.5 KB है और service worker से एक बार cache हो जाती है
  // (Netlify से आती है, Firebase से नहीं — रोज़ाना download quota पर इसका कोई असर नहीं)।
  // किसी पुराने फ़ोन पर WebP न चले तो चुपचाप छुप जाती है — जश्न फिर भी पूरा दिखता है
  var mrow=document.createElement("div"); mrow.className="celeb-mrow";
  var hL=document.createElement("span"); hL.className="celeb-clap l"; hL.textContent="👏";
  var img=document.createElement("img");
  img.className="celeb-mascot"; img.src="icons/mascot.webp"; img.alt=""; img.width=76; img.height=76;
  img.onerror=function(){ this.style.display="none"; };
  var hR=document.createElement("span"); hR.className="celeb-clap r"; hR.textContent="👏";
  mrow.appendChild(hL); mrow.appendChild(img); mrow.appendChild(hR);
  card.appendChild(mrow);
  // अंगूठा + मुख्य इमोजी एक ही पंक्ति में — JE ने कहा "अंगूठा भी दिखना चाहिए"।
  // दोनों फ़ोन के अपने font से आते हैं, यानी शून्य डाउनलोड
  var e=document.createElement("div"); e.className="celeb-emoji";
  var thumb=document.createElement("span"); thumb.className="celeb-thumb"; thumb.textContent="👍";
  var mainE=document.createElement("span"); mainE.textContent=big?"🏆":"🎉";
  e.appendChild(thumb); e.appendChild(mainE);
  var nm=document.createElement("div"); nm.className="celeb-name";
  nm.textContent=(big?"शाबाश ":"शानदार ")+name+"!";
  var sub=document.createElement("div"); sub.className="celeb-sub";
  sub.textContent=(amt?("₹"+amt.toLocaleString("hi-IN")+" वसूल"):"वसूली दर्ज")+(n?(" • आज की "+n+"वीं"):"");
  // textContent इस्तेमाल किया गया है, innerHTML नहीं — नाम/रकम कहीं भी HTML बनकर नहीं जाते
  card.appendChild(e); card.appendChild(nm); card.appendChild(sub);
  wrap.appendChild(card);
  var colors=["#00c896","#ffb300","#42a5f5","#ec407a","#ab47bc"];
  var bits=big?22:14; // गिनती जान-बूझकर कम — सस्ते फ़ोन पर भी अटके नहीं
  for(var i=0;i<bits;i++){
    var b=document.createElement("div");
    b.className="celeb-bit";
    b.style.left=(Math.random()*100)+"%";
    b.style.background=colors[i%colors.length];
    b.style.animationDelay=(Math.random()*0.35)+"s";
    wrap.appendChild(b);
  }
  document.body.appendChild(wrap);
  try{_celebSound(big);}catch(e){} // आवाज़ न चल पाए तो भी दिखने वाला जश्न न रुके
  setTimeout(function(){ if(wrap.parentNode) wrap.parentNode.removeChild(wrap); },CELEB_MS+400);
}

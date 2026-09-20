// ── श्रेणी का नाम बदलना (JE only) — ui-core.js से अलग किया गया (structure सुधार, यह
// अपने-आप में एक पूरा, स्वतंत्र feature है — buildCatTabs से सिर्फ़ बटन के onclick से जुड़ा है) ──

function openEditCat(i, slotKey){
  if(!CU||CU.role!=="supervisor"){toast("सिर्फ JE नाम बदल सकते हैं","err");return;}
  if(!isCatEditable(i)){toast("यह श्रेणी बदली नहीं जा सकती","err");return;}
  // नाम बदलना = Firebase पर डेटा का पता बदलना, और वह सिर्फ़ नेट रहते ही सुरक्षित हो सकता है।
  // ऑफ़लाइन नाम बदलने देना सबसे ख़तरनाक है: नाम बदल जाता पर डेटा पुराने पते पर रह जाता, और
  // अगली पढ़ाई में खाली सूची cache पर लिख जाती — इसलिए यहीं रोक देते हैं
  if(!navigator.onLine){toast("📴 नाम बदलने के लिए नेट ज़रूरी है — डेटा भी नए नाम पर ले जाना पड़ता है","err");return;}
  var cur=CATS[i];
  var newName=prompt(activeHQ+" — श्रेणी का नया नाम डालें:",cur);
  if(!newName||!newName.trim()||newName.trim()===cur) return;
  newName=newName.trim();
  // "/" (या .#$[]) नाम में हो तो Firebase पर गलत जगह (नेस्टेड path) सेव होकर हमेशा के लिए
  // permission-denied (401) देने लगता है — असली bug यही मिला था ("vig/O&m Cases" जैसा नाम)
  if(/[.#$\[\]\/]/.test(newName)){
    toast("⚠️ नाम में ये चिह्न न लिखें: . # $ [ ] /","err");
    return;
  }
  if(CATS.indexOf(newName)>-1){
    toast("⚠️ इसी नाम की श्रेणी पहले से है — दोनों का डेटा एक ही जगह मिल जाएगा","err");
    return;
  }
  // नाम हर मुख्यालय का अपना है (/CAT_NAMES/{HQ}/{index}), इसलिए यह पूछना ज़रूरी है — JE अक्सर
  // सभी छह में एक जैसा नाम चाहते हैं, पर कभी किसी एक HQ में अलग नाम भी रखना पड़ सकता है
  var allHQ=confirm("\""+newName+"\" नाम कहाँ लगाना है?\n\n[OK] = सभी "+HQS.length+" मुख्यालयों में\n[Cancel] = सिर्फ़ "+activeHQ+" में");
  var targets=allHQ?HQS.slice():[activeHQ];
  // हर HQ में इस slot का अपना मौजूदा नाम अलग हो सकता है — इसलिए हर एक का oldCat अलग निकालो,
  // और जिनका नाम पहले से यही है उन्हें छोड़ दो (उनका डेटा बेवजह हिलाने की ज़रूरत नहीं)
  var jobs=[],clash=null;
  targets.forEach(function(hq){
    var oc=isCatEditable(i)?getCatName(hq,i):CATS_DEFAULT[i];
    // उसी HQ की *किसी और* श्रेणी का नाम पहले से यही हो तो रुक जाओ — वरना दोनों का डेटा एक ही
    // पते पर जाकर मिल जाता (हर HQ के नाम अलग हो सकते हैं, इसलिए हर एक को अलग जाँचना पड़ता है)
    for(var k=0;k<CATS_DEFAULT.length;k++){
      if(k===i) continue;
      var other=isCatEditable(k)?getCatName(hq,k):CATS_DEFAULT[k];
      if(other===newName){ clash=hq+" › "+other; return; }
    }
    if(oc!==newName) jobs.push({hq:hq,oldCat:oc});
  });
  if(clash){toast("⚠️ "+clash+" में इसी नाम की श्रेणी पहले से है — दोनों का डेटा एक जगह मिल जाता","err");return;}
  if(!jobs.length){toast("सभी चुने हुए मुख्यालयों में यह नाम पहले से है","inf");return;}
  // पहले हर HQ की गिनती दिखाकर पक्का पूछो — JE को पता रहे कि कुल कितना डेटा हिलने वाला है
  showLoader("गिनती देख रहे हैं...");
  var pending=jobs.length;
  jobs.forEach(function(j){
    catRecordCount(j.hq,j.oldCat,function(n){
      j.n=n;
      if(--pending>0) return;
      hideLoader();
      var tot=0,unknown=false;
      jobs.forEach(function(x){ if(x.n==null) unknown=true; else tot+=x.n; });
      var msg="\""+newName+"\" नाम "+(jobs.length===1?jobs[0].hq+" में":jobs.length+" मुख्यालयों में")+" लगाएँ?\n\n";
      jobs.forEach(function(x){ msg+="• "+x.hq+" › "+x.oldCat+" — "+(x.n==null?"गिनती नहीं मिली":(x.n+" records"))+"\n"; });
      msg+="\nकुल "+tot+" records नए नाम पर ले जाए जाएँगे"+(unknown?" (कुछ की गिनती नहीं मिली)":"")+"।";
      msg+="\n\nहर मुख्यालय का डेटा एक बार पढ़ा और एक बार लिखा जाएगा, और सभी फ़ोनों पर नई सूची जाएगी — इसलिए यह काम कम-ट्रैफ़िक समय पर करें (दोपहर 12:30 के बाद)।";
      if(!confirm(msg)) return;
      _runCatRenames(i,newName,jobs);
    });
  });
}
// एक-एक करके (एक साथ नहीं) — छह HQ का डेटा एक साथ खींचना कमज़ोर नेट पर टूट जाता है, और
// टूटने पर यह बताना मुश्किल हो जाता कि कौन-सा पूरा हुआ कौन-सा नहीं। क्रम से चलने पर हर HQ
// या तो पूरा बदलता है या बिलकुल नहीं
function _runCatRenames(i,newName,jobs){
  var idx=0,okCount=0,movedTot=0,failed=[];
  function next(){
    if(idx>=jobs.length){
      hideLoader();
      if(okCount) _finishCatRename(i,newName,jobs,okCount,movedTot);
      if(failed.length){
        logErr("catrename-partial",new Error(failed.join(", ")+" में नाम नहीं बदला"),newName);
        toast("⚠️ "+failed.join(", ")+" में नाम नहीं बदला — वहाँ का डेटा जस का तस है, दोबारा कोशिश करें","err");
      }
      return;
    }
    var j=jobs[idx++];
    showLoader(j.hq+" का डेटा नए नाम पर ले जाया जा रहा है ("+idx+"/"+jobs.length+")...");
    renameCatData(j.hq,j.oldCat,newName,function(res){
      if(res.ok){ okCount++; movedTot+=(res.moved||0); j.done=true; }
      else failed.push(j.hq);
      next();
    });
  }
  next();
}
// डेटा नए पते पर पहुँच जाने के बाद ही नाम की अदला-बदली — तभी कोई भी device नए नाम पर
// जाकर खाली सूची नहीं पाएगा। सिर्फ़ उन्हीं HQ के नाम बदलते हैं जिनका डेटा सचमुच पहुँच गया
// (j.done) — जो HQ बीच में नाकाम रहा उसका पुराना नाम बना रहता है, यानी उसका डेटा दिखता रहता है
function _finishCatRename(i,newName,jobs,okCount,movedTot){
  jobs.forEach(function(j){
    if(!j.done) return;
    // 1. Cache rename
    var d=cGet(j.hq,j.oldCat);
    if(d&&d.length) cSet(j.hq,newName,d);
    cSet(j.hq,j.oldCat,[]);
    // 2. Local CAT_NAMES update
    if(!CAT_NAMES[j.hq]) CAT_NAMES[j.hq]={};
    CAT_NAMES[j.hq][i]=newName;
  });
  saveCatNames();
  // 3. CATS rebuild + UI update immediately
  rebuildCatsForHQ(activeHQ);
  var mine=null;
  jobs.forEach(function(j){ if(j.done&&j.hq===activeHQ) mine=j; });
  if(mine&&activeCat===mine.oldCat){
    activeCat=newName;
    stopListen(); startListen(activeHQ,activeCat); // पुराने पते की live-लाइन बंद, नए की चालू
  }
  buildCatTabs();
  // 4. Firebase save — हर बदले हुए HQ के नाम, एक HQ का एक PUT
  var done=0,bad=0;
  var changed=jobs.filter(function(j){return j.done;});
  changed.forEach(function(j){
    var hqData={};
    CATS_DEFAULT.forEach(function(_,idx){
      if(isCatEditable(idx)&&CAT_NAMES[j.hq]&&CAT_NAMES[j.hq][idx]!=null){
        hqData[idx]=CAT_NAMES[j.hq][idx];
      }
    });
    fetch(FB+"/CAT_NAMES/"+hqKey(j.hq)+".json",{
      method:"PUT",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(hqData)
    }).then(function(r){
      if(!r.ok){
        bad++;
        logErr("catname-save",new Error("HTTP "+r.status),j.hq);
        if(r.status===401||r.status===403) toast("🔐 नाम server पर नहीं गया — JE नेट चालू रखकर logout करके दोबारा login करें","err");
      }
      fin();
    }).catch(function(){
      bad++;
      try{localStorage.setItem("dc_catpending3","1");}catch(e){}
      fin();
    });
  });
  function fin(){
    if(++done<changed.length) return;
    if(bad){ toast("⚠️ नाम बदला पर "+bad+" मुख्यालय का sync बाक़ी — नेट आने पर अपने आप जाएगा","err"); return; }
    toast("✅ नाम बदला: "+newName+" • "+okCount+" मुख्यालय"+(movedTot?(" • "+movedTot+" records साथ गए"):"")+" (सभी को दिखेगा)","ok");
  }
}

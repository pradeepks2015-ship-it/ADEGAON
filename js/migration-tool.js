// ── यह फ़ाइल ज़रूरत पड़ने पर ही उतरती है (v9.195, देखें js/lazy.js) ──
// चरण 3 की JE-स्क्रीन (dry-run, असली माइग्रेशन, रिपोर्ट)। हर फ़ोन पर चलने वाला माइग्रेशन-कोड
// (MIGRATED, isMigrated, _checkMigrationRevert, _migrateOne…) js/migration.js में ही है

// ─── चरण 3 (per-record migration) — Dry-run जांच (सिर्फ JE) ───
// यह सिर्फ पढ़ता है, कुछ भी Firebase में नहीं लिखता। मकसद: असली माइग्रेशन से पहले पक्का करना
// कि हर HQ/श्रेणी में हर record का 'acc' मौजूद है, अलग-अलग है, और Firebase key बनने लायक है
// (Firebase key में . # $ [ ] / नहीं चल सकते) — तभी array→per-record बदलाव सुरक्षित होगा।
var MIG_REPORT = null;

function openMigModal(){
  if(!CU||CU.role!=="supervisor"){toast("सिर्फ JE यह देख सकते हैं","err");return;}
  var mn=document.getElementById("logout-menu"); if(mn) mn.classList.remove("open");
  document.getElementById("mig-overlay").classList.add("open");
  document.getElementById("mig-content").innerHTML="<div class='log-empty'>ऊपर 'दोबारा जांचें' दबाकर dry-run शुरू करें</div>";
  document.getElementById("mig-dl").style.display="none";
  // कर्मचारी सक्रियता अब यहां नहीं — उसकी अपनी स्क्रीन है (मेनू → 👥 कर्मचारी सक्रियता)।
  // इससे चरण 3 खोलने पर DEVICE_VERSIONS की बेवजह fetch भी नहीं होती
}
function closeMigModal(){document.getElementById("mig-overlay").classList.remove("open");}

function _migRunDryRun(){
  var el=document.getElementById("mig-content");
  el.innerHTML="<div class='log-empty'>⏳ सभी HQ/श्रेणी जांची जा रही हैं...</div>";
  document.getElementById("mig-dl").style.display="none";
  var jobs=[];
  HQS.forEach(function(hq){
    for(var i=0;i<CATS_DEFAULT.length;i++){
      var cat=isCatEditable(i)?getCatName(hq,i):CATS_DEFAULT[i];
      jobs.push({hq:hq,cat:cat});
    }
  });
  var rows=[],done=0;
  // यहाँ ETag जान-बूझकर नहीं लगाया — और यह छूट नहीं, फ़ैसला है।
  // 304 का मतलब है "सर्वर वही है जो तुम्हारे पास था", यानी जांच cache से करनी पड़ती। पर cache
  // normList() से गुज़री हुई सादी array होती है — उसमें से (क) सर्वर पर रूप array था या object,
  // और (ख) एक ही acc वाले दो records थे या नहीं — दोनों बातें पक्की नहीं की जा सकतीं। object को
  // acc से दोबारा बनाने पर तो duplicate acc आपस में मिलकर ग़ायब ही हो जाते, यानी चरण 3 ठीक वही
  // गड़बड़ी छिपा देता जिसे पकड़ने के लिए वह बना है। माइग्रेशन का फ़ैसला इसी जांच पर टिका है,
  // इसलिए यह हमेशा सर्वर का कच्चा सच ही पढ़ेगी। यह स्क्रीन कभी-कभार खुलती है, और अब इसका पूरा
  // खर्च मीटर में गिना भी जाता है — इसलिए भारी होकर भी छिपा हुआ नहीं है
  jobs.forEach(function(j){
    fetch(FB+"/"+fbPath(j.hq,j.cat)+".json?t="+Date.now())
      .then(_fbJson)
      .then(function(d){
        trackUsageOf(d); // चरण-3 की जाँच पूरा डेटाबेस (सभी 48 सूचियां) उतारती है — सबसे भारी एक क्रिया
        _noteShape(j.hq,j.cat,d); // जाँच में जो रूप दिखा, वही याद रहे — मुफ़्त है, data पहले से हाथ में
        var a=_migAnalyzeList(d);
        // MIGRATED flag "हां" कहता है पर data अब भी array है — किसी पुराने device ने migration पलट दिया
        a.reverted=isMigrated(j.hq,j.cat)&&!a.alreadyObj;
        // सही-सलामत migrated — flag भी "हां" और data भी per-record (object) है
        a.migrated=isMigrated(j.hq,j.cat)&&a.alreadyObj;
        rows.push({hq:j.hq,cat:j.cat,a:a});
        fin();
      })
      .catch(function(){
        rows.push({hq:j.hq,cat:j.cat,a:{tot:0,missingAcc:0,missingAccSamples:[],dupAcc:0,dupSamples:[],illegalAcc:0,illegalSamples:[],alreadyObj:false,fetchErr:true}});
        fin();
      });
  });
  function fin(){
    done++;
    // audit-verified: done/jobs.length संख्या हैं
    // eslint-disable-next-line no-unsanitized/property
    if(done<jobs.length){el.innerHTML="<div class='log-empty'>⏳ जांच जारी — "+done+"/"+jobs.length+"...</div>";return;}
    // HQ/श्रेणी क्रम में सजाएं (जैसा jobs में था)
    var order={};jobs.forEach(function(j,i){order[j.hq+"|"+j.cat]=i;});
    rows.sort(function(a,b){return order[a.hq+"|"+a.cat]-order[b.hq+"|"+b.cat];});
    MIG_REPORT=rows;
    _migRender(rows);
  }
}

function _migRender(rows){
  var el=document.getElementById("mig-content");
  var gTot=0,gMiss=0,gDup=0,gIll=0,anyErr=false,anyReverted=false,gMigrated=0,gEmpty=0;
  rows.forEach(function(r){
    gTot+=r.a.tot;gMiss+=r.a.missingAcc;gDup+=r.a.dupAcc;gIll+=r.a.illegalAcc;
    if(r.a.fetchErr)anyErr=true;
    if(r.a.reverted)anyReverted=true;
    if(r.a.migrated)gMigrated++;
    else if(r.a.tot===0&&!r.a.fetchErr)gEmpty++; // खाली श्रेणी — migrate करने को कुछ नहीं, गिनती में अड़चन नहीं
  });
  // acc की दृष्टि से सुरक्षित — भले ही कुछ श्रेणियां 'पलटी हुई' हों, माइग्रेट बटन दबाना तब भी सुरक्षित है
  // (दोबारा चलाने पर सिर्फ पलटी/बाकी श्रेणियां convert होती हैं, पहले से ठीक वालों को कुछ नहीं होता)
  var safe=(gMiss===0&&gDup===0&&gIll===0&&!anyErr);
  var allMigrated=safe&&!anyReverted&&rows.length>0&&(gMigrated+gEmpty)===rows.length;
  var html="";
  if(anyReverted){
    html+="<div style='background:rgba(240,80,80,.1);border:1px solid rgba(240,80,80,.4);border-radius:10px;padding:10px 12px;margin-bottom:10px;font-size:12px;color:var(--red);font-weight:700;'>🛠 कुछ HQ/श्रेणी में migration किसी पुराने device ने पलट दिया था — नीचे 'पलटा हुआ' दिख रहीं वो अपने आप ठीक होने की कोशिश करती हैं, पर पक्का करने के लिए नीचे 'माइग्रेट करें' दबाकर मैन्युअल भी ठीक कर सकते हैं।</div>";
  }
  if(anyErr){
    html+="<div class='box-danger' style='background:#fdf0f1;border:1px solid #ecc8cc;border-radius:10px;padding:10px 12px;margin-bottom:10px;font-size:12px;'>⚠️ कुछ HQ/श्रेणी लोड नहीं हो पाईं (नेट/network) — दोबारा जांचें दबाएं।</div>";
  } else if(allMigrated){
    html+="<div style='background:rgba(0,200,150,.08);border:1px solid rgba(0,200,150,.3);border-radius:10px;padding:10px 12px;margin-bottom:10px;font-size:12px;color:var(--green);font-weight:700;'>✅ यह ऐप पूरी तरह माइग्रेट हो चुका है — सभी "+gMigrated+" HQ/श्रेणी अब per-record फॉर्मेट में हैं। कुछ और करने की ज़रूरत नहीं।</div>";
  } else if(safe){
    var doneNote=gMigrated?(" ("+gMigrated+" पहले से माइग्रेट, बाकी बची हुई)"):"";
    html+="<div style='background:rgba(0,200,150,.08);border:1px solid rgba(0,200,150,.3);border-radius:10px;padding:10px 12px;margin-bottom:10px;font-size:12px;color:var(--green);font-weight:700;'>✅ सभी "+gTot+" records ठीक हैं — कोई acc missing/duplicate/illegal नहीं। माइग्रेशन के लिए तैयार।"+doneNote+
      "<div style='margin-top:8px;'><button class='btn-save' style='width:100%;background:#c0392b;' onclick='confirmAndRunMigration()'>🚀 अभी माइग्रेट करें (कम-ट्रैफिक समय पर)</button></div></div>";
  } else {
    html+="<div style='background:rgba(240,165,0,.08);border:1px solid rgba(240,165,0,.3);border-radius:10px;padding:10px 12px;margin-bottom:10px;font-size:12px;color:var(--gold2);font-weight:700;'>⚠️ पहले इन समस्याओं को ठीक करें — Missing acc: "+gMiss+", Duplicate acc: "+gDup+", अवैध acc: "+gIll+"</div>";
  }
  html+="<table class='wasc-table'><thead><tr><th>HQ</th><th>श्रेणी</th><th>कुल</th><th>Missing<br>acc</th><th>Duplicate<br>acc</th><th>अवैध<br>acc</th></tr></thead><tbody>";
  rows.forEach(function(r){
    var bad=r.a.missingAcc||r.a.dupAcc||r.a.illegalAcc||r.a.fetchErr||r.a.reverted;
    var tag=r.a.reverted?" <span style='color:var(--red);'>(पलटा हुआ)</span>":(r.a.migrated?" <span style='color:var(--green);'>&#10003; migrated</span>":"");
    html+="<tr"+(bad?" style='background:rgba(240,80,80,.06);'":"")+"><td class='wasc-hq'>"+escHtml(r.hq)+"</td><td>"+escHtml(r.cat)+tag+"</td>"+
      "<td>"+r.a.tot+"</td><td>"+(r.a.fetchErr?"—":r.a.missingAcc)+"</td><td>"+(r.a.fetchErr?"—":r.a.dupAcc)+"</td><td>"+(r.a.fetchErr?"—":r.a.illegalAcc)+"</td></tr>";
  });
  html+="</tbody><tfoot><tr><td colspan='2'>योग</td><td>"+gTot+"</td><td>"+gMiss+"</td><td>"+gDup+"</td><td>"+gIll+"</td></tr></tfoot></table>";
  // Missing/duplicate/illegal acc वाले असल records — नाम/पता/मोबाइल से पहचान (acc खुद तो missing है,
  // इसलिए कोई और तरीका ही ठीक करने के लिए ढूंढने का ज़रिया है) — ताकि JE बिना Excel डाउनलोड किए भी
  // सीधे यहीं देख सके कि किसे ठीक करना है
  var probRows=[];
  rows.forEach(function(r){
    (r.a.missingAccSamples||[]).forEach(function(s){
      probRows.push({hq:r.hq,cat:r.cat,issue:"Consumer No खाली",detail:(s.name||"(नाम नहीं)")+(s.addr?" — "+s.addr:"")+(s.phone?" — "+s.phone:"")});
    });
    (r.a.dupSamples||[]).forEach(function(acc){
      probRows.push({hq:r.hq,cat:r.cat,issue:"Duplicate Consumer No",detail:acc});
    });
    (r.a.illegalSamples||[]).forEach(function(acc){
      probRows.push({hq:r.hq,cat:r.cat,issue:"अवैध Consumer No (. # $ [ ] / नहीं चलेगा)",detail:acc});
    });
  });
  if(probRows.length){
    var moreNote=(gMiss+gDup+gIll)>probRows.length?" (हर HQ/श्रेणी के पहले 5 नमूने ही)":"";
    html+="<div style='margin-top:14px;font-size:12px;font-weight:700;color:var(--gold2);'>🔍 समस्या वाले records (ठीक करने के लिए)"+moreNote+"</div>";
    html+="<table class='wasc-table' style='margin-top:6px;'><thead><tr><th>HQ</th><th>श्रेणी</th><th>समस्या</th><th>पहचान</th></tr></thead><tbody>";
    probRows.forEach(function(pr){
      html+="<tr><td class='wasc-hq'>"+escHtml(pr.hq)+"</td><td>"+escHtml(pr.cat)+"</td><td>"+escHtml(pr.issue)+"</td><td>"+escHtml(pr.detail)+"</td></tr>";
    });
    html+="</tbody></table>";
  }
  // audit-verified: html में हर जगह r.hq/r.cat/pr.hq/pr.cat/pr.issue/pr.detail escHtml() से गुज़रे
  // हैं (ऊपर देखें), बाक़ी संख्या/hardcoded — plugin बड़े multi-branch html+= pattern में हर टुकड़ा
  // ट्रेस नहीं कर पाता
  // eslint-disable-next-line no-unsanitized/property
  el.innerHTML=html;
  document.getElementById("mig-dl").style.display=rows.length?"":"none";
}

function confirmAndRunMigration(){
  if(!MIG_REPORT||!MIG_REPORT.length){toast("पहले जांच चलाएं","err");return;}
  var ok=confirm(
    "⚠️ यह असली production data बदल देगा (array → per-record फॉर्मेट)।\n\n"+
    "सिर्फ कम-ट्रैफिक समय पर करें, और पक्का करें कि सभी सक्रिय devices नया app version ले चुके हैं "+
    "(वरना पुराना version किसी record को बचाते समय पूरी लिस्ट फिर से array में लिख सकता है)।\n\n"+
    "क्या अभी माइग्रेट करना शुरू करें?"
  );
  if(!ok)return;
  runMigration();
}

function runMigration(){
  var el=document.getElementById("mig-content");
  var jobs=MIG_REPORT.map(function(r){return {hq:r.hq,cat:r.cat};});
  var results=[],idx=0;
  function next(){
    if(idx>=jobs.length){ _migRenderResult(results); loadMigratedFlags(); return; }
    var j=jobs[idx++];
    // audit-verified: j.hq/j.cat escHtml() से गुज़रते हैं, idx/jobs.length संख्या
    // eslint-disable-next-line no-unsanitized/property
    el.innerHTML="<div class='log-empty'>⏳ माइग्रेट हो रहा है — "+idx+"/"+jobs.length+" ("+escHtml(j.hq)+" / "+escHtml(j.cat)+")...</div>";
    _migrateOne(j.hq,j.cat,function(r){ results.push(r); next(); });
  }
  next();
}

function _migRenderResult(results){
  var el=document.getElementById("mig-content");
  var ok=0,already=0,empty=0,unsafe=0,error=0;
  results.forEach(function(r){
    if(r.status==="ok")ok++; else if(r.status==="already")already++;
    else if(r.status==="empty")empty++; else if(r.status==="unsafe")unsafe++; else error++;
  });
  var html="<div style='background:rgba(0,200,150,.08);border:1px solid rgba(0,200,150,.3);border-radius:10px;padding:10px 12px;margin-bottom:10px;font-size:12px;'>"+
    "✅ माइग्रेट: <b>"+ok+"</b> &nbsp; ℹ️ पहले से: <b>"+already+"</b> &nbsp; ⬜ खाली: <b>"+empty+"</b>"+
    (unsafe?" &nbsp; ⚠️ असुरक्षित (छोड़ा गया): <b>"+unsafe+"</b>":"")+
    (error?" &nbsp; ❌ त्रुटि: <b>"+error+"</b>":"")+
    "</div>";
  html+="<table class='wasc-table'><thead><tr><th>HQ</th><th>श्रेणी</th><th>स्थिति</th></tr></thead><tbody>";
  results.forEach(function(r){
    var lbl={ok:"✅ माइग्रेट हो गया",already:"ℹ️ पहले से migrated",empty:"⬜ खाली",unsafe:"⚠️ असुरक्षित — छोड़ा गया",error:"❌ त्रुटि: "+(r.err||"")}[r.status]||r.status;
    html+="<tr><td class='wasc-hq'>"+escHtml(r.hq)+"</td><td>"+escHtml(r.cat)+"</td><td>"+lbl+"</td></tr>";
  });
  html+="</tbody></table>";
  // audit-verified: r.hq/r.cat escHtml() से गुज़रते हैं; lbl में r.err सिर्फ़ JS Error.message है
  // (_migrateOne में String(e&&e.message||e) से बनता है — fetch/HTTP-status त्रुटि, कभी लाइनमैन का
  // free-typed टेक्स्ट नहीं), बाक़ी hardcoded labels
  // eslint-disable-next-line no-unsanitized/property
  el.innerHTML=html;
}

function downloadMigReport(){
  if(!MIG_REPORT||!MIG_REPORT.length){toast("पहले जांच चलाएं","err");return;}
  ensureXLSX(function(ok){
    if(!ok){toast("📴 Excel के लिए इन्टरनेट चाहिए","err");return;}
    var rows=[["HQ","श्रेणी","कुल","Missing acc","Missing acc नमूने (नाम — पता — मोबाइल)","Duplicate acc","Duplicate नमूने","अवैध acc","अवैध नमूने"]];
    MIG_REPORT.forEach(function(r){
      var missSamp=(r.a.missingAccSamples||[]).map(function(s){return (s.name||"(नाम नहीं)")+(s.addr?" — "+s.addr:"")+(s.phone?" — "+s.phone:"");}).join(" | ");
      rows.push([r.hq,r.cat,r.a.tot,r.a.missingAcc,missSamp,r.a.dupAcc,(r.a.dupSamples||[]).join(", "),r.a.illegalAcc,(r.a.illegalSamples||[]).join(", ")]);
    });
    var ws=XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"]=[{wch:12},{wch:16},{wch:8},{wch:10},{wch:34},{wch:12},{wch:24},{wch:10},{wch:24}];
    var wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,"चरण3 Dry-run");
    XLSX.writeFile(wb,"ADEGAON_charan3_dryrun_"+new Date().toLocaleDateString("en-IN").replace(/\//g,"-")+".xlsx");
  });
}

"use strict";
/* ══════════════════════════════════════════
   THEMODS.JS
══════════════════════════════════════════ */

/* ── État ── */
const LS_THEMODS = () => "THEMODS_STATE_" + (currentUser?.pseudo||"guest");
let tmState = null;
let tmKb = null;
let tmInited = false;

function tmDefault(){ return {updatedAt:0, themes:{}}; }
function tmLoadLocal(){ try{ return JSON.parse(localStorage.getItem(LS_THEMODS())||"null")||tmDefault(); }catch{ return tmDefault(); } }
function tmSaveLocal(){ try{ localStorage.setItem(LS_THEMODS(), JSON.stringify(tmState)); }catch{} }

async function loadThemodsState(){
  tmState = tmLoadLocal();
  if(!currentUser) return;
  const r = await fbGet("themods", currentUser.pseudo.toLowerCase());
  if(r.ok && r.data && (r.data.updatedAt||0) > (tmState.updatedAt||0)) tmState = r.data;
  tmSaveLocal();
}
async function persistThemods(){
  if(!currentUser) return;
  tmState.updatedAt = Date.now();
  tmSaveLocal();
  await fbSet("themods", currentUser.pseudo.toLowerCase(), tmState);
}

function getSt(theme, label){
  if(!tmState.themes[theme]) tmState.themes[theme]={};
  if(!tmState.themes[theme][label]) tmState.themes[theme][label]={seen:false,validated:false,lastResult:"",lastSeen:"",interval:1,due:todayStr()};
  const s=tmState.themes[theme][label];
  if(!s.due) s.due=todayStr();
  if(!s.interval) s.interval=1;
  return s;
}

/* ── Droits éditeur ── */
function isEditor(){ return currentUser?.pseudo?.toLowerCase()==="stof2"; }

/* ── Dict ODS ── */
let TM_DICT = null;
function getTmDict(){
  if(!TM_DICT){ const d=window.SEQODS_DATA?.d; TM_DICT=d?new Set(d):new Set(); }
  return TM_DICT;
}

/* ── Formes fléchies (normalisé → e[] de data.js) ── */
let _normToE = null;
function getNormToE(){
  if(!_normToE){
    _normToE = {};
    const d = window.SEQODS_DATA;
    if(d?.c) d.c.forEach((c,i) => { _normToE[c] = d.e[i]; });
  }
  return _normToE;
}
function getInflected(normWord){
  const e = getNormToE()[normWord];
  return (e && e !== normWord) ? e : null;
}

/* ── Définitions (normalisé → f[] de data.js) ── */
let _normToF = null;
function getNormToF(){
  if(!_normToF){
    _normToF = {};
    const d = window.SEQODS_DATA;
    if(d?.c) d.c.forEach((c,i) => { _normToF[c] = d.f?.[i] || ""; });
  }
  return _normToF;
}
// Vrai si le mot fait >9 lettres ET sa définition contient "(p.p. inv.)"
function isLongPpInv(n){
  return n.length > 9 && getNormToF()[n].includes("(p.p. inv.)");
}

/* ── État jeu ── */
let tmTheme=null, tmSession=null;
let tmFound=new Set(), tmSolutions=false, tmNoHelp=true;
let gmEntryIdx=0, gmFound=new Set();
let odsEntryIdx=0, odsFnd=new Set();
let tmBrowse=false, tmBrowseIdx=0;

/* ── Navigation sous-vues ── */
function showTmView(id){
  document.querySelectorAll("#v-themods .tmv").forEach(v=>{
    v.classList.toggle("active", v.id===id);
  });
  // Clavier mobile : visible seulement en jeu
  const kb = document.getElementById("tm-kb");
  if(kb) kb.style.display = (id==="tv-game") ? "" : "none";
}

/* ── Accueil ── */
function renderTmHome(){
  showTmView("tv-home");
  updateTmStats();
  setDictBtnVisible(true);
}

function renderTmVerbes(){
  showTmView("tv-verbes");
  updateVerbesStats();
  setDictBtnVisible(true);
}

function updateVerbesStats(){
  const viData=window.THEMODS_DATA?.vi||[];
  let viVal=0; viData.forEach(({label})=>{ if(getSt("vi",label).validated) viVal++; });
  const viEl=document.getElementById("vi-desc2");
  if(viEl) viEl.textContent="575 verbes · 193 sessions"+fmtPct(viVal,viData.length);

  const vtData=window.THEMODS_DATA?.vt||[];
  let vtVal=0; vtData.forEach(({label})=>{ if(getSt("vt",label).validated) vtVal++; });
  const vtEl=document.getElementById("vt-desc");
  if(vtEl) vtEl.textContent="4 968 verbes · 1 580 sessions"+fmtPct(vtVal,vtData.length);

  const vdData=window.THEMODS_DATA?.vd||[];
  let vdVal=0; vdData.forEach(({label})=>{ if(getSt("vd",label).validated) vdVal++; });
  const vdEl=document.getElementById("vd-desc");
  if(vdEl) vdEl.textContent="66 verbes · 42 sessions"+fmtPct(vdVal,vdData.length);
}

function renderTmFinales(){
  showTmView("tv-finales");
  updateFinalesStats();
  setDictBtnVisible(true);
}

function fmtPct(val, total){
  if(!total || !val) return "";
  return " · "+Math.round(val/total*100)+"%";
}

function updateTmStats(){
  if(!tmState) return;
  // GM
  const prog=getGMProgress();
  const gmTotal=getAllGMEntries().length;
  const gmEl=document.getElementById("gm-desc");
  if(gmEl) gmEl.textContent="1 808 groupes"+fmtPct(prog.done,gmTotal);

  // Double Nature
  const dnProg=getDNProgress();
  const dnTotal=getAllDNEntries().length;
  const dnEl=document.getElementById("dn-desc");
  if(dnEl) dnEl.textContent=dnTotal+" mots"+fmtPct(dnProg.done,dnTotal);

  // Finales
  const finales=["able","age","ique","oir","ure","ard","ant","if","in","ais","ois","erie","et","ette","ide","ite","eau","ot","um","eux","ail","al","ase","ose","eur","ier","ien","isme","iste"];
  let totalSess=0, totalVal=0;
  finales.forEach(th=>{
    const d=window.THEMODS_DATA?.[th]; if(!d) return;
    totalSess+=d.length;
    d.forEach(({label})=>{ if(getSt(th,label).validated) totalVal++; });
  });
  const fEl=document.getElementById("finales-desc");
  if(fEl) fEl.textContent="29 finales"+fmtPct(totalVal,totalSess);

  // Verbes
  const verbesThemes=["vi","vt","vd"];
  let vTotal=0, vVal=0;
  verbesThemes.forEach(th=>{ const d=window.THEMODS_DATA?.[th]; if(!d) return; vTotal+=d.length; d.forEach(({label})=>{ if(getSt(th,label).validated) vVal++; }); });
  const viEl=document.getElementById("verbes-desc");
  if(viEl) viEl.textContent="3 thèmes · 5 230 verbes"+fmtPct(vVal,vTotal);

  // ODS 1-9 (home summary)
  const odsEl=document.getElementById("ods-desc");
  if(odsEl){
    let totalDone=0, totalEntries=0;
    for(let v=1;v<=9;v++){
      const th="ods"+v;
      const all=getAllOdsEntries(th);
      totalEntries+=all.length;
      totalDone+=(getOdsProgress(th).done||0);
    }
    odsEl.textContent="9 éditions"+fmtPct(totalDone,totalEntries);
  }
}

function renderTmOds(){
  showTmView("tv-ods");
  updateOdsStats();
}

function updateOdsStats(){
  for(let v=1;v<=9;v++){
    const th="ods"+v;
    const all=getAllOdsEntries(th);
    const done=getOdsProgress(th).done||0;
    const el=document.getElementById(th+"-desc");
    if(el) el.textContent=all.length+" entrées"+fmtPct(done,all.length);
  }
}

function updateFinalesStats(){
  const bases={
    able:"293 mots · 136 sessions",age:"1 311 mots · 360 sessions",ique:"629 mots · 177 sessions",oir:"253 mots · 99 sessions",
    ure:"455 mots · 152 sessions",ard:"233 mots · 79 sessions",ant:"767 mots · 226 sessions",
    if:"293 mots · 130 sessions",in:"657 mots · 218 sessions",ais:"147 mots · 87 sessions",
    ois:"180 mots · 89 sessions",erie:"278 mots · 100 sessions",et:"544 mots · 169 sessions",
    ette:"436 mots · 148 sessions",ide:"446 mots · 142 sessions",ite:"803 mots · 246 sessions",
    eau:"242 mots · 92 sessions",ot:"261 mots · 101 sessions",um:"267 mots · 117 sessions",
    eux:"414 mots · 136 sessions",ail:"44 mots · 34 sessions",al:"665 mots · 199 sessions",
    ase:"81 mots · 47 sessions",ose:"134 mots · 83 sessions",eur:"601 mots · 189 sessions",
    ier:"495 mots · 142 sessions",ien:"601 mots · 223 sessions",isme:"356 mots · 142 sessions",iste:"218 mots · 115 sessions"
  };
  Object.keys(bases).forEach(th=>{
    const d=window.THEMODS_DATA?.[th]; if(!d) return;
    let val=0; d.forEach(({label})=>{ if(getSt(th,label).validated) val++; });
    const el=document.getElementById(th+"-desc");
    if(el) el.textContent=bases[th]+fmtPct(val,d.length);
  });
}

/* ── Lancement session ── */
function showSrsPrompt(theme, srsPool){
  const prompt=document.getElementById("tm-srs-prompt"); if(!prompt) return;
  const n=srsPool.length;
  const countEl=document.getElementById("tm-srs-count");
  if(countEl) countEl.textContent=n+" liste"+(n>1?"s":"");
  // Clone buttons to clear stale listeners
  ["tm-srs-ok","tm-srs-skip"].forEach(id=>{
    const old=document.getElementById(id); if(!old) return;
    const fresh=old.cloneNode(true); old.parentNode.replaceChild(fresh,old);
  });
  document.getElementById("tm-srs-ok")?.addEventListener("click",()=>{
    prompt.style.display="none";
    startSession(theme, srsPool[Math.floor(Math.random()*srsPool.length)]);
  });
  document.getElementById("tm-srs-skip")?.addEventListener("click",()=>{
    prompt.style.display="none";
  });
  prompt.style.display="";
}

function playTheme(theme){
  tmTheme=theme;
  if(theme==="gm"){ startGM(); return; }
  if(theme==="dn"){ startDN(); return; }
  if(isOds(theme)){ startOds(theme); return; }
  const data=window.THEMODS_DATA?.[theme]; if(!data) return;
  const today=todayStr();
  const msg=document.getElementById("tm-home-msg"); if(msg){msg.textContent="";msg.className="tm-msg";}

  const unseenPool=data.filter(({label})=>!getSt(theme,label).seen);
  const srsPool=data.filter(({label})=>{ const s=getSt(theme,label); return s.seen&&!s.validated&&s.due<=today; });
  const lockedPool=data.filter(({label})=>{ const s=getSt(theme,label); return s.seen&&!s.validated&&s.due>today; });

  const playPool = unseenPool.length ? unseenPool : srsPool.length ? srsPool : lockedPool;
  if(playPool.length){ startSession(theme, playPool[Math.floor(Math.random()*playPool.length)]); return; }
  if(msg){
    const total=data.length, val=data.filter(({label})=>getSt(theme,label).validated).length;
    msg.textContent= val===total ? "100%" : "Aucune session disponible.";
    msg.className="tm-msg ok";
    showTmView("");
  }
}

function startSession(theme, session){
  tmSession=session; tmFound=new Set(); tmSolutions=false; tmNoHelp=true; tmBrowse=false;
  const edBtn=document.getElementById("gm-ed-btn"); if(edBtn) edBtn.style.display="none";
  getSt(theme, session.label).seen=true;
  getSt(theme, session.label).lastSeen=todayStr();
  persistThemods().catch(()=>{});
  setDictBtnVisible(false);
  showTmView("tv-game");
  renderTmGame();
  updateTmBtn();
  setTmMsg("");
  if(tmKb) tmKb.clear();
  setTimeout(()=>{ if(window.matchMedia("(pointer:fine)").matches) document.getElementById("tm-saisie")?.focus(); },80);
}

/* ── Rendu jeu ── */
const THEME_NAMES={age:"Finale -AGE",vi:"Intransitifs",oir:"Finale -OIR",able:"Finale -ABLE",ique:"Finale -IQUE",gm:"Graphies multiples",
  ods1:"Nouveautés ODS1",ods2:"Nouveautés ODS2",ods3:"Nouveautés ODS3",ods4:"Nouveautés ODS4",ods5:"Nouveautés ODS5",
  ods6:"Nouveautés ODS6",ods7:"Nouveautés ODS7",ods8:"Nouveautés ODS8",ods9:"Nouveautés ODS9",
  ure:"Finale -URE",ard:"Finale -ARD",ant:"Finale -ANT",if:"Finale -IF",in:"Finale -IN",
  ais:"Finale -AIS",ois:"Finale -OIS",erie:"Finale -ERIE",et:"Finale -ET",ette:"Finale -ETTE",
  ide:"Finale -IDE",ite:"Finale -ITE",eau:"Finale -EAU",ot:"Finale -OT",um:"Finale -UM",
  eux:"Finale -EUX",ail:"Finale -AIL",al:"Finale -AL",ase:"Finale -ASE",ose:"Finale -OSE",
  eur:"Finale -EUR",ier:"Finale -IER",ien:"Finale -IEN",isme:"Finale -ISME",iste:"Finale -ISTE",
  vt:"Transitifs",vd:"Défectifs"};
const THEME_SFX={age:"AGE",vi:"",oir:"OIR",able:"ABLE",ique:"IQUE",gm:"",
  ods1:"",ods2:"",ods3:"",ods4:"",ods5:"",ods6:"",ods7:"",ods8:"",ods9:"",
  ure:"URE",ard:"ARD",ant:"ANT",if:"IF",in:"IN",ais:"AIS",ois:"OIS",erie:"ERIE",
  et:"ET",ette:"ETTE",ide:"IDE",ite:"ITE",eau:"EAU",ot:"OT",um:"UM",eux:"EUX",
  ail:"AIL",al:"AL",ase:"ASE",ose:"OSE",eur:"EUR",ier:"IER",ien:"IEN",isme:"ISME",iste:"ISTE",
  vt:"",vd:""};
function isOds(th){ return /^ods\d$/.test(th); }

/* ── ODS helper functions ── */
function getAllOdsEntries(theme){
  const all=[];
  (window.THEMODS_DATA?.[theme]||[]).forEach(s=>{
    (s.entries||[]).forEach(e=>{
      if(!(e.def||"").includes("Nouveau participe")) all.push(e);
    });
  });
  return all;
}
function getOdsProgress(theme){
  if(!tmState.themes) tmState.themes={};
  if(!tmState.themes[theme]) tmState.themes[theme]={};
  if(!tmState.themes[theme]._p) tmState.themes[theme]._p={idx:0,done:0,order:null};
  return tmState.themes[theme]._p;
}
function currentOdsEntry(theme){
  const all=getAllOdsEntries(theme), prog=getOdsProgress(theme);
  const realIdx=prog.order?.[odsEntryIdx];
  return realIdx!==undefined ? all[realIdx] : null;
}
function startOds(theme){
  const all=getAllOdsEntries(theme), prog=getOdsProgress(theme);
  if(!prog.order||prog.order.length!==all.length){
    prog.order=shuffleArray(all.map((_,i)=>i));
    prog.idx=0; prog.done=0;
  }
  if(prog.idx>=all.length){ prog.order=shuffleArray(all.map((_,i)=>i)); prog.idx=0; }
  odsEntryIdx=prog.idx; odsFnd=new Set(); tmSolutions=false; tmNoHelp=true;
  showTmView("tv-game");
  const edBtn=document.getElementById("gm-ed-btn"); if(edBtn) edBtn.style.display=isEditor()?"":"none";
  document.getElementById("tm-gtitle").textContent=THEME_NAMES[theme]||theme;
  const lbl=document.getElementById("tm-session-label"); if(lbl) lbl.textContent="";
  updateTmBtn(); setTmMsg(""); renderOdsGame();
  if(tmKb) tmKb.clear();
  setTimeout(()=>{ if(window.matchMedia("(pointer:fine)").matches) document.getElementById("tm-saisie")?.focus(); },80);
}
function isOdsResolved(){
  const entry=currentOdsEntry(tmTheme); if(!entry) return false;
  return tmSolutions||entry.forms.every(f=>odsFnd.has(norm(f)));
}
function validateOdsWord(n){
  const entry=currentOdsEntry(tmTheme); if(!entry) return;
  if(!entry.forms.find(f=>norm(f)===n)){
    setTmMsg(getTmDict().has(n)?"Hors-jeu — mot valide mais pas dans cette liste.":"Mot non valide.",
             getTmDict().has(n)?"warn":"err");
    return;
  }
  odsFnd.add(n); setTmMsg("");
  const allFound=entry.forms.every(f=>odsFnd.has(norm(f)));
  if(allFound){
    const prog=getOdsProgress(tmTheme);
    prog.done=(prog.done||0)+1; prog.idx=odsEntryIdx+1;
    const msg=entry.forms.length>1?"✓ Toutes les graphies trouvées !":"✓";
    setTmMsg(msg,"ok");
    persistThemods().catch(()=>{});
  }
  renderOdsGame();
  updateTmBtn();
}

function renderOdsGame(){
  const entry=currentOdsEntry(tmTheme);
  const list=document.getElementById("tm-wlist"); if(!list) return;
  list.innerHTML="";
  const lbl=document.getElementById("tm-session-label"); if(lbl) lbl.textContent="";
  if(!entry){ setTmMsg("Toutes les entrées terminées !","ok"); return; }

  const sortedForms=[...entry.forms].sort((a,b)=>letterCount(a)-letterCount(b));
  const allFormsFound=sortedForms.every(f=>odsFnd.has(norm(f)));
  const custom=getEntryCustom(entry);

  const defDiv=document.createElement("div");
  defDiv.className="gm-def";
  if(custom.img){
    const img=document.createElement("img"); img.src=custom.img; img.alt="";
    img.style.cssText="max-width:100%;max-height:180px;border-radius:8px;display:block;margin:0 auto 10px;object-fit:contain;";
    defDiv.appendChild(img);
  }
  const defText=document.createElement("span");
  defText.textContent=(custom.def!==undefined?custom.def:cleanDef(entry.def))||"…";
  if(custom.def!==undefined||custom.img){
    const mark=document.createElement("span"); mark.textContent=" ✎"; mark.style.cssText="font-size:10px;opacity:.45;";
    defText.appendChild(mark);
  }
  defDiv.appendChild(defText);
  list.appendChild(defDiv);

  const tilesDiv=document.createElement("div"); tilesDiv.className="gm-tiles";
  sortedForms.forEach(form=>{
    const isFound=odsFnd.has(norm(form))||allFormsFound;
    const revealed=isFound||tmSolutions;
    const letters=form.replace(/[Œœ]/g,"OE").replace(/[Ææ]/g,"AE").replace(/[^A-Za-zÀ-ÿ]/g,"").toUpperCase();
    const row=document.createElement("div"); row.className="gm-row";
    for(let i=0;i<letters.length;i++){
      const t=document.createElement("span");
      if(revealed){ t.className="gt "+(isFound?"ok":"miss"); t.textContent=letters[i]; }
      else if(i===0){ t.className="gt init"; t.textContent=letters[0]; }
      else { t.className="gt empty"; }
      row.appendChild(t);
    }
    if(revealed){
      row.style.cursor="pointer";
      row.addEventListener("click",()=>openDef(norm(form),form));
    }
    tilesDiv.appendChild(row);
  });
  // Graphies existantes (also) — affichées après résolution
  if((allFormsFound||tmSolutions)&&entry.also?.length){
    const alsoLabel=document.createElement("div");
    alsoLabel.className="gm-also-label";
    alsoLabel.textContent=(entry.also.length>1?"Autres graphies existantes :":"Autre graphie existante :");
    tilesDiv.appendChild(alsoLabel);
    entry.also.forEach(form=>{
      const letters=form.replace(/[Œœ]/g,"OE").replace(/[Ææ]/g,"AE").replace(/[^A-Za-zÀ-ÿ]/g,"").toUpperCase();
      const row=document.createElement("div"); row.className="gm-row";
      for(let i=0;i<letters.length;i++){
        const t=document.createElement("span"); t.className="gt also"; t.textContent=letters[i];
        row.appendChild(t);
      }
      row.style.cursor="pointer";
      row.addEventListener("click",()=>openDef(norm(form),form));
      tilesDiv.appendChild(row);
    });
  }
  list.appendChild(tilesDiv);
}

function renderTmGame(){
  if(tmTheme==="gm"){ renderGMGame(); return; }
  if(isOds(tmTheme)){ renderOdsGame(); return; }
  const sess=tmSession; if(!sess) return;

  const el=id=>document.getElementById(id);
  const sfx=THEME_SFX[tmTheme];
  if(el("tm-gtitle")) el("tm-gtitle").textContent=THEME_NAMES[tmTheme]||tmTheme;
  if(el("tm-session-label")) el("tm-session-label").textContent=sess.label+(sfx?"…"+sfx:"…");

  const list=el("tm-wlist"); if(!list) return;
  list.innerHTML="";
  sess.words.forEach((word,i)=>{
    const li=document.createElement("li");
    li.dataset.idx=i; li.className="slot";
    const canon=norm(word);
    const display=getNormToE()[canon]||word;
    const cousin=sess.cousins?.[canon];
    const fullDisplay=cousin?display+" (→ "+cousin+")":display;
    if(tmFound.has(i)){
      li.classList.add("found","clickable");
      li.textContent=fullDisplay;
      li.addEventListener("click",()=>openDef(canon,display));
    } else if(tmSolutions){
      li.classList.add("revealed","clickable");
      li.textContent=fullDisplay;
      li.addEventListener("click",()=>openDef(canon,display));
    }
    list.appendChild(li);
  });
}

function validateTmWord(raw){
  const n=norm(raw); if(!n) return;
  if(tmSolutions){
    setTmMsg(getTmDict().has(n)?n+" : mot valide ✓":"Mot inconnu.","ok");
    return;
  }
  if(tmTheme==="gm"){ validateGMWord(n); return; }
  if(tmTheme==="dn"){ validateDNWord(n); return; }
  if(isOds(tmTheme)){ validateOdsWord(n); return; }
  const sess=tmSession; if(!sess) return;
  const matched=[];
  sess.words.forEach((w,i)=>{ if(!tmFound.has(i)&&norm(w)===n) matched.push(i); });
  if(!matched.length){
    const inDict=getTmDict().has(n);
    if(!inDict){
      setTmMsg("Mot inconnu — la partie s'arrête.","err");
      setTimeout(()=>showTmSolutions(),800);
    } else if(tmTheme==="vi" && !isLongPpInv(n)){
      setTmMsg("Mot valide — fin de session.","warn");
      setTimeout(()=>showTmSolutions(),800);
    } else {
      setTmMsg("Hors-jeu — mot valide mais pas dans cette liste.","warn");
    }
    return;
  }
  matched.forEach(i=>{
    tmFound.add(i);
    const li=document.querySelector("#tm-wlist li[data-idx='"+i+"']");
    if(li){
      const w=sess.words[i];
      const wc=norm(w);
      const display=getNormToE()[wc]||w;
      const cousin=sess.cousins?.[wc];
      li.className="slot found clickable";
      li.textContent=cousin?display+" (→ "+cousin+")":display;
      li.addEventListener("click",()=>openDef(wc,display));
      li.scrollIntoView({behavior:"smooth",block:"nearest"});
    }
  });
  setTmMsg("");
  const ctr=document.getElementById("tm-counter");
  if(ctr) ctr.textContent=tmFound.size+" / "+sess.words.length;
  if(tmFound.size===sess.words.length) finalizeTm(tmNoHelp);
  else persistThemods().catch(()=>{});
}

function showTmSolutions(){
  tmNoHelp=false;
  if(tmTheme==="gm"){ tmSolutions=true; renderGMGame(); updateTmBtn(); return; }
  if(tmTheme==="dn"){ tmSolutions=true; renderDNGame(); updateTmBtn(); return; }
  if(isOds(tmTheme)){ tmSolutions=true; renderOdsGame(); updateTmBtn(); return; }
  const sess=tmSession; if(!sess) return;
  sess.words.forEach((w,i)=>{
    if(!tmFound.has(i)){
      tmFound.add(i);
      const li=document.querySelector("#tm-wlist li[data-idx='"+i+"']");
      if(li){
        const wc=norm(w);
        const display=getNormToE()[wc]||w;
        const cousin=sess.cousins?.[wc];
        li.className="slot revealed clickable";
        li.textContent=cousin?display+" (→ "+cousin+")":display;
        li.addEventListener("click",()=>openDef(wc,display));
      }
    }
  });
  const ctr=document.getElementById("tm-counter");
  if(ctr) ctr.textContent=tmFound.size+" / "+sess.words.length;
  finalizeTm(false);
}

function finalizeTm(ok){
  tmSolutions=true;
  setDictBtnVisible(true);
  updateTmBtn();
  const s=getSt(tmTheme, tmSession?.label||"");
  s.seen=true; s.lastSeen=todayStr();
  if(ok){
    s.validated=true; s.lastResult="ok";
    s.interval=nextInterval(s.interval||1); s.due=addDays(todayStr(),s.interval);
    setTmMsg("Validée sans aide ✓","ok");
  } else {
    s.validated=false; s.lastResult="help";
    s.interval=3; s.due=addDays(todayStr(),3);
    setTmMsg("Session terminée.","warn");
  }
  persistThemods().catch(()=>{});
}

function isGMResolved(){
  const entry=currentGMEntry(); if(!entry) return false;
  return tmSolutions||entry.forms.every(f=>gmFound.has(norm(f)));
}

/* ── Feuilletage (stof2 uniquement) ── */
function stopBrowse(){
  tmBrowse=false;
  tmSolutions=false; tmFound=new Set();
  if(tmTheme==="gm"){ gmFound=new Set(); renderGMGame(); }
  else if(isOds(tmTheme)){ odsFnd=new Set(); renderOdsGame(); }
  else renderTmGame();
  updateTmBtn(); setTmMsg("");
}
function toggleBrowse(){ tmBrowse ? stopBrowse() : startBrowse(); }
function startBrowse(){
  if(!isEditor()) return;
  tmBrowse=true;
  if(tmTheme==="gm" || isOds(tmTheme)){
    // position déjà gérée par gmEntryIdx / odsEntryIdx
  } else {
    const data=window.THEMODS_DATA?.[tmTheme]; if(!data) return;
    const idx=data.findIndex(s=>s.label===tmSession?.label);
    tmBrowseIdx=idx>=0?idx:0;
  }
  tmNoHelp=false;
  browseShowCurrent();
}
function browseShowCurrent(){
  tmSolutions=true;
  if(tmTheme==="gm"){ gmFound=new Set(); renderGMGame(); }
  else if(isOds(tmTheme)){ odsFnd=new Set(); renderOdsGame(); }
  else {
    const data=window.THEMODS_DATA?.[tmTheme]; if(!data) return;
    tmSession=data[tmBrowseIdx%data.length];
    tmFound=new Set(); renderTmGame();
  }
  setTmMsg(""); updateTmBtn();
}
function browseNext(){
  if(!tmBrowse) return;
  if(tmTheme==="gm"){
    const all=getAllGMEntries();
    gmEntryIdx=(gmEntryIdx+1)%all.length; gmFound=new Set();
  } else if(isOds(tmTheme)){
    const all=getAllOdsEntries(tmTheme);
    odsEntryIdx=(odsEntryIdx+1)%all.length; odsFnd=new Set();
  } else {
    const data=window.THEMODS_DATA?.[tmTheme]; if(!data) return;
    tmBrowseIdx=(tmBrowseIdx+1)%data.length;
  }
  browseShowCurrent();
}

function updateTmBtn(){
  const sol=document.getElementById("tm-btn-sol");
  const solKb=document.getElementById("tm-btn-sol-kb");
  const browseBtn=document.getElementById("tm-btn-browse");
  const nextBtn=document.getElementById("tm-btn-next");
  if(browseBtn){
    browseBtn.style.display=isEditor()?"":"none";
    browseBtn.textContent=tmBrowse?"⏹ Arrêter":"Feuilleter";
    browseBtn.classList.toggle("btn-danger", tmBrowse);
  }
  if(nextBtn) nextBtn.style.display=tmBrowse?"":"none";
  const gmLike=tmTheme==="gm"||tmTheme==="dn"||isOds(tmTheme);

  [sol,solKb].forEach(b=>{
    if(!b) return;
    b.style.display=tmBrowse?"none":"";
    if(gmLike){
      const resolved=tmTheme==="gm"?isGMResolved():tmTheme==="dn"?isDNResolved():isOdsResolved();
      if(resolved){
        b.textContent="Jouer"; b.classList.remove("btn-danger"); b.classList.add("btn-primary");
      } else {
        b.textContent="Solutions"; b.classList.add("btn-danger"); b.classList.remove("btn-primary");
      }
      return;
    }
    if(tmSolutions){
      b.textContent="Jouer"; b.classList.remove("btn-danger"); b.classList.add("btn-primary");
    } else {
      b.textContent="Solutions"; b.classList.add("btn-danger"); b.classList.remove("btn-primary");
    }
  });
}

function setTmMsg(t,c){
  const m=document.getElementById("tm-msg");
  if(m){m.textContent=t;m.className="msg"+(c?" "+c:"");}
  if(tmKb) tmKb.setMsg(t,c);
}

function tmReplay(){
  if(tmTheme) playTheme(tmTheme);
  else renderTmHome();
}

/* ── Éditeur (GM + ODS) ── */
let gmEdPendingImg = undefined; // undefined=inchangé, null=effacé, string=nouvelle image

function gmEntryKey(entry){
  return entry.forms.slice().map(f=>norm(f)).sort().join("|");
}
function getEntryCustom(entry){
  const th=tmTheme||"gm";
  return tmState.themes?.[th]?._custom?.[gmEntryKey(entry)] || {};
}
function setEntryCustom(entry, data){
  const th=tmTheme||"gm";
  if(!tmState.themes) tmState.themes={};
  if(!tmState.themes[th]) tmState.themes[th]={};
  if(!tmState.themes[th]._custom) tmState.themes[th]._custom={};
  const k=gmEntryKey(entry);
  const prev=tmState.themes[th]._custom[k]||{};
  tmState.themes[th]._custom[k]={...prev,...data};
  persistThemods().catch(()=>{});
}
function gmGetCustom(entry){ return getEntryCustom(entry); }
function gmSetCustom(entry, data){ setEntryCustom(entry, data); }
function currentEntry(){
  if(tmTheme==="gm") return currentGMEntry();
  if(isOds(tmTheme)) return currentOdsEntry(tmTheme);
  return null;
}

function openGMEditor(){
  const entry=currentEntry(); if(!entry) return;
  const custom=getEntryCustom(entry);
  gmEdPendingImg=undefined;
  const defEl=document.getElementById("gm-ed-def");
  const imgEl=document.getElementById("gm-ed-img");
  const imgWrap=document.getElementById("gm-ed-img-wrap");
  const delBtn=document.getElementById("gm-ed-del-img");
  if(defEl) defEl.value=custom.def!==undefined?custom.def:(cleanDef(entry.def)||"");
  if(imgEl) imgEl.src=custom.img||"";
  if(imgWrap) imgWrap.style.display=custom.img?"":"none";
  if(delBtn) delBtn.style.display=custom.img?"":"none";
  const wiktEl=document.getElementById("gm-ed-wikt");
  if(wiktEl) wiktEl.href="https://fr.wiktionary.org/wiki/"+encodeURIComponent(entry.forms[0].toLowerCase());
  document.getElementById("gm-editor").style.display="";
  setTimeout(()=>defEl?.focus(),80);
}
function closeGMEditor(){
  document.getElementById("gm-editor").style.display="none";
  gmEdPendingImg=undefined;
}
function saveGMEditor(){
  const entry=currentEntry(); if(!entry) return;
  const defEl=document.getElementById("gm-ed-def");
  const data={};
  if(defEl) data.def=defEl.value.trim();
  if(gmEdPendingImg!==undefined){
    const prev=getEntryCustom(entry).img;
    if(prev&&prev.includes("firebasestorage")){
      const pathMatch=prev.match(/\/o\/([^?]+)/);
      if(pathMatch) fbStorageDelete(decodeURIComponent(pathMatch[1])).catch(()=>{});
    }
    data.img=gmEdPendingImg;
  }
  setEntryCustom(entry, data);
  closeGMEditor();
  if(tmTheme==="gm") renderGMGame(); else renderOdsGame();
}
async function pasteGMImage(){
  try{
    const items=await navigator.clipboard.read();
    for(const item of items){
      const imgType=item.types.find(t=>t.startsWith("image/"));
      if(imgType){
        const blob=await item.getType(imgType);
        const jpegBlob=await resizeGMImage(blob,500);
        // Aperçu immédiat
        const previewUrl=URL.createObjectURL(jpegBlob);
        const imgEl=document.getElementById("gm-ed-img");
        const imgWrap=document.getElementById("gm-ed-img-wrap");
        const delBtn=document.getElementById("gm-ed-del-img");
        if(imgEl) imgEl.src=previewUrl;
        if(imgWrap) imgWrap.style.display="";
        if(delBtn) delBtn.style.display="";
        // Upload Firebase Storage
        setTmMsg("Envoi…","warn");
        const entry=currentEntry(); if(!entry) return;
        const folder=isOds(tmTheme)?"odsimages/"+tmTheme:"gmimages";
        const path=`${folder}/${currentUser?.pseudo||"guest"}/${gmEntryKey(entry)}.jpg`;
        try{
          const storageUrl=await fbStorageUpload(path, jpegBlob);
          gmEdPendingImg=storageUrl;
          URL.revokeObjectURL(previewUrl);
          if(imgEl) imgEl.src=storageUrl;
          setTmMsg("Image ajoutée.","ok");
        }catch(e){
          setTmMsg("Erreur upload : "+e.message,"err");
          gmEdPendingImg=null; // annule
          if(imgWrap) imgWrap.style.display="none";
        }
        return;
      }
    }
    setTmMsg("Aucune image dans le presse-papier.","warn");
  }catch(e){
    setTmMsg("Accès presse-papier refusé.","err");
  }
}
function resizeGMImage(blob, maxW){
  return new Promise(resolve=>{
    const img=new Image(), url=URL.createObjectURL(blob);
    img.onload=()=>{
      URL.revokeObjectURL(url);
      const scale=Math.min(1,maxW/img.width);
      const c=document.createElement("canvas");
      c.width=Math.round(img.width*scale); c.height=Math.round(img.height*scale);
      c.getContext("2d").drawImage(img,0,0,c.width,c.height);
      c.toBlob(b=>resolve(b),"image/jpeg",0.75);
    };
    img.src=url;
  });
}

/* ── Graphies multiples ── */
function getAllGMEntries(){
  const all=[];
  (window.THEMODS_DATA?.gm||[]).forEach(s=>{ (s.entries||[]).forEach(e=>all.push(e)); });
  return all;
}
function shuffleArray(arr){
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
function getGMProgress(){
  if(!tmState.themes) tmState.themes={};
  if(!tmState.themes.gm) tmState.themes.gm={};
  if(!tmState.themes.gm._p) tmState.themes.gm._p={idx:0,done:0,order:null};
  return tmState.themes.gm._p;
}
function currentGMEntry(){
  const all=getAllGMEntries(), prog=getGMProgress();
  const realIdx=prog.order?.[gmEntryIdx];
  return realIdx!==undefined ? all[realIdx] : null;
}
function cleanDef(d){
  if(!d) return "";
  d=d.replace(/^(?:ou\s+)?\[[^\]]*\]\s*/i,"").replace(/^\([^)]*\)\s*/,"");
  return d.startsWith("->") ? "" : d.trim();
}
function letterCount(w){ return w.replace(/[Œœ]/g,"OE").replace(/[Ææ]/g,"AE").replace(/[^A-Za-zÀ-ÿ]/g,"").length; }

function startGM(){
  const all=getAllGMEntries(), prog=getGMProgress();
  if(!prog.order||prog.order.length!==all.length){
    prog.order=shuffleArray(all.map((_,i)=>i));
    prog.idx=0; prog.done=0;
  }
  if(prog.idx>=all.length){ prog.order=shuffleArray(all.map((_,i)=>i)); prog.idx=0; }
  gmEntryIdx=prog.idx; gmFound=new Set(); tmSolutions=false; tmNoHelp=true;
  setDictBtnVisible(false);
  showTmView("tv-game");
  const edBtn=document.getElementById("gm-ed-btn"); if(edBtn) edBtn.style.display=isEditor()?"":"none";
  document.getElementById("tm-gtitle").textContent="Graphies multiples";
  const lbl=document.getElementById("tm-session-label"); if(lbl) lbl.textContent="";
  updateTmBtn(); setTmMsg(""); renderGMGame();
  if(tmKb) tmKb.clear();
  setTimeout(()=>{ if(window.matchMedia("(pointer:fine)").matches) document.getElementById("tm-saisie")?.focus(); },80);
}

function renderGMGame(){
  const all=getAllGMEntries(), prog=getGMProgress();
  const entry=currentGMEntry();
  const list=document.getElementById("tm-wlist"); if(!list) return;
  list.innerHTML="";
  const lbl=document.getElementById("tm-session-label");
  if(lbl) lbl.textContent="";
  if(!entry){ setTmMsg("Toutes les entrées terminées !","ok"); return; }

  const sortedForms=[...entry.forms].sort((a,b)=>letterCount(a)-letterCount(b));
  const allFormsFound=sortedForms.every(f=>gmFound.has(norm(f)));

  const custom=gmGetCustom(entry);
  const defDiv=document.createElement("div");
  defDiv.className="gm-def";
  if(custom.img){
    const img=document.createElement("img");
    img.src=custom.img; img.alt="";
    img.style.cssText="max-width:100%;max-height:180px;border-radius:8px;display:block;margin:0 auto 10px;object-fit:contain;";
    defDiv.appendChild(img);
  }
  const defText=document.createElement("span");
  defText.textContent=(custom.def!==undefined?custom.def:cleanDef(entry.def))||"…";
  if(custom.def!==undefined||custom.img){
    const mark=document.createElement("span");
    mark.textContent=" ✎"; mark.style.cssText="font-size:10px;opacity:.45;";
    defText.appendChild(mark);
  }
  defDiv.appendChild(defText);
  list.appendChild(defDiv);

  const tilesDiv=document.createElement("div");
  tilesDiv.className="gm-tiles";
  sortedForms.forEach(form=>{
    const isFound=gmFound.has(norm(form))||allFormsFound;
    const revealed=isFound||tmSolutions;
    const letters=form.replace(/[Œœ]/g,"OE").replace(/[Ææ]/g,"AE").replace(/[^A-Za-zÀ-ÿ]/g,"").toUpperCase();
    const wrap=document.createElement("div"); wrap.className="gm-row-wrap";
    const row=document.createElement("div"); row.className="gm-row";
    for(let i=0;i<letters.length;i++){
      const t=document.createElement("span");
      if(revealed){ t.className="gt "+(isFound?"ok":"miss"); t.textContent=letters[i].toUpperCase(); }
      else if(i===0){ t.className="gt init"; t.textContent=letters[0].toUpperCase(); }
      else { t.className="gt empty"; }
      row.appendChild(t);
    }
    if(revealed){
      row.style.cursor="pointer";
      row.addEventListener("click",()=>openDef(norm(form),form));
    }
    wrap.appendChild(row);
    tilesDiv.appendChild(wrap);
  });
  list.appendChild(tilesDiv);

  if(allFormsFound||tmSolutions){
    const nav=document.createElement("div"); nav.className="gm-nav";
    const pos=document.createElement("span"); pos.className="gm-pos";
    pos.textContent=(gmEntryIdx+1)+" / "+all.length;
    nav.appendChild(pos);
    list.appendChild(nav);
  }
}

function validateGMWord(n){
  const entry=currentGMEntry(); if(!entry) return;
  if(!entry.forms.find(f=>norm(f)===n)){
    setTmMsg(getTmDict().has(n)?"Hors-jeu — mot valide mais pas dans cette liste.":"Mot non valide.",
             getTmDict().has(n)?"warn":"err");
    return;
  }
  gmFound.add(n); setTmMsg("");
  const allFound=entry.forms.every(f=>gmFound.has(norm(f)));
  if(allFound){
    const prog=getGMProgress();
    prog.done=(prog.done||0)+1; prog.idx=gmEntryIdx+1;
    setTmMsg("✓ Toutes les graphies trouvées !","ok");
    setDictBtnVisible(true);
    persistThemods().catch(()=>{});
  }
  renderGMGame();
  updateTmBtn();
}

/* ── Double Nature ── */
let dnEntryIdx=0, dnFound=false;

function getDNProgress(){
  if(!tmState.themes) tmState.themes={};
  if(!tmState.themes.dn) tmState.themes.dn={};
  if(!tmState.themes.dn._p) tmState.themes.dn._p={idx:0,done:0,order:null};
  return tmState.themes.dn._p;
}
function getAllDNEntries(){ return window.THEMODS_DATA?.dn||[]; }
function currentDNEntry(){
  const all=getAllDNEntries(), prog=getDNProgress();
  const realIdx=prog.order?.[dnEntryIdx];
  return realIdx!==undefined ? all[realIdx] : null;
}
function isDNResolved(){ return dnFound||tmSolutions; }

function startDN(){
  const all=getAllDNEntries(), prog=getDNProgress();
  if(!prog.order||prog.order.length!==all.length){
    prog.order=shuffleArray(all.map((_,i)=>i)); prog.idx=0; prog.done=0;
  }
  if(prog.idx>=all.length){ prog.order=shuffleArray(all.map((_,i)=>i)); prog.idx=0; }
  dnEntryIdx=prog.idx; dnFound=false; tmSolutions=false; tmNoHelp=true; tmBrowse=false;
  setDictBtnVisible(false);
  showTmView("tv-game");
  const edBtn=document.getElementById("gm-ed-btn");
  if(edBtn) edBtn.style.display=isEditor()?"":"none";
  document.getElementById("tm-gtitle").textContent="Double nature";
  const lbl=document.getElementById("tm-session-label"); if(lbl) lbl.textContent="";
  updateTmBtn(); setTmMsg(""); renderDNGame();
  if(tmKb) tmKb.clear();
  setTimeout(()=>{ if(window.matchMedia("(pointer:fine)").matches) document.getElementById("tm-saisie")?.focus(); },80);
}

function renderDNGame(){
  const all=getAllDNEntries();
  const entry=currentDNEntry();
  const list=document.getElementById("tm-wlist"); if(!list) return;
  list.innerHTML="";
  if(!entry){ setTmMsg("Toutes les entrées terminées !","ok"); return; }
  const canon=entry.canon;
  const revealed=isDNResolved();

  // Defs effectives (custom override or default)
  const custom=getDNCustom(entry);
  const defs=entry.defs.map((d,i)=>({
    d: d.d,
    f: custom.defs?.[i]!==undefined ? custom.defs[i] : d.f
  }));

  // Blocs de définitions AU-DESSUS des tuiles
  defs.forEach((def,i)=>{
    const block=document.createElement("div");
    block.className="gm-def"+(revealed?" clickable":"");
    const text=(def.f||"").replace(/^(?:ou\s+)?\[[^\]]*\]\s*/i,"").trim()||"(définition absente)";
    block.textContent=text;
    if(revealed) block.addEventListener("click",()=>openDef(canon, def.d, def.f));
    list.appendChild(block);
  });

  // Tuiles (initiale + cases vides) EN DESSOUS
  const tilesDiv=document.createElement("div"); tilesDiv.className="gm-tiles";
  const row=document.createElement("div"); row.className="gm-row";
  for(let i=0;i<canon.length;i++){
    const t=document.createElement("span");
    if(revealed){ t.className="gt "+(dnFound?"ok":"miss"); t.textContent=canon[i]; }
    else if(i===0){ t.className="gt init"; t.textContent=canon[0]; }
    else { t.className="gt empty"; }
    row.appendChild(t);
  }
  if(revealed){
    row.style.cursor="pointer";
    row.addEventListener("click",()=>openDef(canon, defs[0].d, defs[0].f));
  }
  tilesDiv.appendChild(row);
  list.appendChild(tilesDiv);

  // Compteur
  if(revealed){
    const nav=document.createElement("div"); nav.className="gm-nav";
    const pos=document.createElement("span"); pos.className="gm-pos";
    pos.textContent=(dnEntryIdx+1)+" / "+all.length;
    nav.appendChild(pos); list.appendChild(nav);
  }
}

function validateDNWord(n){
  const entry=currentDNEntry(); if(!entry) return;
  if(norm(entry.canon)!==n){
    setTmMsg(getTmDict().has(n)?"Hors-jeu — mot valide mais pas dans cette liste.":"Mot non valide.",
             getTmDict().has(n)?"warn":"err");
    return;
  }
  dnFound=true;
  const prog=getDNProgress();
  prog.done=(prog.done||0)+1; prog.idx=dnEntryIdx+1;
  setTmMsg("✓ Trouvé !","ok");
  setDictBtnVisible(true);
  renderDNGame(); updateTmBtn();
  persistThemods().catch(()=>{});
}

/* ── Éditeur Double Nature ── */
function getDNCustom(entry){
  return tmState.themes?.dn?._custom?.[entry.canon] || {};
}
function setDNCustom(entry, data){
  if(!tmState.themes) tmState.themes={};
  if(!tmState.themes.dn) tmState.themes.dn={};
  if(!tmState.themes.dn._custom) tmState.themes.dn._custom={};
  const prev=tmState.themes.dn._custom[entry.canon]||{};
  tmState.themes.dn._custom[entry.canon]={...prev,...data};
  persistThemods().catch(()=>{});
}

function openDNEditor(){
  const entry=currentDNEntry(); if(!entry) return;
  const custom=getDNCustom(entry);
  const container=document.getElementById("dn-ed-defs"); if(!container) return;
  container.innerHTML="";
  entry.defs.forEach((def,i)=>{
    const label=document.createElement("label");
    label.style.cssText="display:block;font-size:12px;font-weight:700;margin-bottom:4px;color:var(--accent);";
    label.textContent="Définition "+(i+1)+" ("+def.d+")";
    const ta=document.createElement("textarea");
    ta.className="gm-ed-textarea"; ta.rows=3; ta.dataset.defIdx=i;
    ta.value=custom.defs?.[i]!==undefined ? custom.defs[i] : (def.f||"");
    container.appendChild(label);
    container.appendChild(ta);
  });
  const res=document.getElementById("dn-ed-wikt-res"); if(res) res.innerHTML="";
  document.getElementById("dn-editor").style.display="";
  container.querySelector("textarea")?.focus();
}
function closeDNEditor(){
  document.getElementById("dn-editor").style.display="none";
  const res=document.getElementById("dn-ed-wikt-res"); if(res) res.innerHTML="";
}
function saveDNEditor(){
  const entry=currentDNEntry(); if(!entry) return;
  const container=document.getElementById("dn-ed-defs"); if(!container) return;
  const defs=[];
  container.querySelectorAll("textarea").forEach((ta,i)=>{ defs[i]=ta.value.trim(); });
  setDNCustom(entry,{defs});
  closeDNEditor();
  renderDNGame();
}
async function fetchWiktForDN(){
  const entry=currentDNEntry(); if(!entry) return;
  const res=document.getElementById("dn-ed-wikt-res"); if(!res) return;
  res.innerHTML="<span style='color:var(--muted);font-size:12px;'>Chargement…</span>";
  const word=entry.canon.toLowerCase().replace(/[Œœ]/g,"oe").replace(/[Ææ]/g,"ae");
  try{
    const resp=await fetch("https://fr.wiktionary.org/api/rest_v1/page/definition/"+encodeURIComponent(word));
    if(!resp.ok) throw new Error("HTTP "+resp.status);
    const data=await resp.json();
    const frSections=data.fr||[];
    if(!frSections.length){ res.innerHTML="<span style='color:var(--muted);font-size:12px;'>Aucune définition trouvée.</span>"; return; }
    res.innerHTML="";
    frSections.forEach(section=>{
      const h=document.createElement("div");
      h.style.cssText="font-size:11px;font-weight:900;color:var(--accent);margin:8px 0 4px;text-transform:uppercase;";
      h.textContent=section.partOfSpeech||"";
      res.appendChild(h);
      (section.definitions||[]).slice(0,3).forEach((defObj,di)=>{
        const defText=(typeof defObj==="string"?defObj:(defObj.definition||"")).replace(/<[^>]*>/g,"").trim();
        if(!defText) return;
        const row=document.createElement("div");
        row.style.cssText="display:flex;align-items:flex-start;gap:6px;margin-bottom:6px;";
        const txt=document.createElement("span");
        txt.style.cssText="font-size:12px;flex:1;line-height:1.4;color:var(--txt);";
        txt.textContent=(di+1)+". "+defText;
        row.appendChild(txt);
        const container=document.getElementById("dn-ed-defs");
        (container?container.querySelectorAll("textarea"):[]).forEach((ta,si)=>{
          const btn=document.createElement("button");
          btn.className="btn"; btn.style.cssText="font-size:11px;padding:2px 6px;flex-shrink:0;";
          btn.textContent="→"+(si+1);
          btn.addEventListener("click",()=>{
            const pos=(section.partOfSpeech||"").toLowerCase();
            let posLabel="";
            if(/verbe/i.test(pos)) posLabel="v.";
            else if(/nom/i.test(pos)) posLabel=/féminin/i.test(pos)?"n.f.":"n.m.";
            else if(/adjectif/i.test(pos)) posLabel="adj.";
            else if(/adverbe/i.test(pos)) posLabel="adv.";
            ta.value=(posLabel?posLabel+" ":"")+defText;
          });
          row.appendChild(btn);
        });
        res.appendChild(row);
      });
    });
  }catch(e){
    res.innerHTML="<span style='color:var(--err);font-size:12px;'>Erreur : "+e.message+"</span>";
  }
}

/* ── Init (une seule fois) ── */
function initThemods(){
  if(!tmInited){
    tmInited=true;

    tmKb = wireKeyboard("tm-kb","tm-kb-disp","tm-kb-msg", w=>validateTmWord(w));

    document.getElementById("tm-saisie")?.addEventListener("keydown",e=>{
      if(e.key==="Enter"&&!e.isComposing){
        e.preventDefault(); validateTmWord(e.target.value); e.target.value="";
      }
    });

    const onSolBtn=()=>{
      if(tmTheme==="gm"){
        if(isGMResolved()){
          const prog=getGMProgress();
          gmEntryIdx++; prog.idx=gmEntryIdx;
          gmFound=new Set(); tmSolutions=false;
          updateTmBtn(); setTmMsg(""); renderGMGame();
          if(tmKb) tmKb.clear();
          persistThemods().catch(()=>{});
        } else { showTmSolutions(); }
      } else if(tmTheme==="dn"){
        if(isDNResolved()){
          const prog=getDNProgress();
          dnEntryIdx++; prog.idx=dnEntryIdx; dnFound=false; tmSolutions=false;
          updateTmBtn(); setTmMsg(""); renderDNGame();
          if(tmKb) tmKb.clear();
          persistThemods().catch(()=>{});
        } else { showTmSolutions(); }
      } else if(isOds(tmTheme)){
        if(isOdsResolved()){
          const prog=getOdsProgress(tmTheme);
          odsEntryIdx++; prog.idx=odsEntryIdx;
          odsFnd=new Set(); tmSolutions=false;
          updateTmBtn(); setTmMsg(""); renderOdsGame();
          if(tmKb) tmKb.clear();
          persistThemods().catch(()=>{});
        } else { showTmSolutions(); }
      } else {
        tmSolutions ? playTheme(tmTheme) : showTmSolutions();
      }
    };
    document.getElementById("tm-btn-sol")?.addEventListener("click", onSolBtn);
    document.getElementById("tm-btn-sol-kb")?.addEventListener("click", onSolBtn);

    document.getElementById("btn-back-game")?.addEventListener("click",()=>{
      tmBrowse=false;
      if(isOds(tmTheme)) renderTmOds();
      else if(window.THEMODS_DATA?.[tmTheme]&&!["gm","dn","vi","vt","vd"].includes(tmTheme)) renderTmFinales();
      else if(["vi","vt","vd"].includes(tmTheme)) renderTmVerbes();
      else renderTmHome();
    });

    // GM / DN éditeur
    document.getElementById("gm-ed-btn")?.addEventListener("click",()=>{
      if(tmTheme==="dn") openDNEditor(); else openGMEditor();
    });
    document.getElementById("gm-ed-close")?.addEventListener("click",()=>closeGMEditor());
    document.getElementById("gm-ed-cancel")?.addEventListener("click",()=>closeGMEditor());
    document.getElementById("gm-ed-save")?.addEventListener("click",()=>saveGMEditor());
    // DN éditeur
    document.getElementById("dn-ed-close")?.addEventListener("click",()=>closeDNEditor());
    document.getElementById("dn-ed-cancel")?.addEventListener("click",()=>closeDNEditor());
    document.getElementById("dn-ed-save")?.addEventListener("click",()=>saveDNEditor());
    document.getElementById("dn-ed-wikt")?.addEventListener("click",()=>fetchWiktForDN());
    document.getElementById("dn-editor")?.addEventListener("click",e=>{
      if(e.target===document.getElementById("dn-editor")) closeDNEditor();
    });
    document.getElementById("gm-ed-del-img")?.addEventListener("click",()=>{
      gmEdPendingImg=null;
      const imgWrap=document.getElementById("gm-ed-img-wrap");
      const delBtn=document.getElementById("gm-ed-del-img");
      if(imgWrap) imgWrap.style.display="none";
      if(delBtn) delBtn.style.display="none";
    });
    document.getElementById("gm-ed-search")?.addEventListener("click",()=>{
      const entry=currentEntry(); if(!entry) return;
      const word=entry.forms[0].replace(/[Œœ]/g,"oe").replace(/[Ææ]/g,"ae");
      window.open("https://www.google.com/search?q="+encodeURIComponent(word)+"&tbm=isch","_blank","noopener");
    });
    // Fermer en cliquant sur l'overlay (hors panneau)
    document.getElementById("gm-editor")?.addEventListener("click",e=>{
      if(e.target===document.getElementById("gm-editor")) closeGMEditor();
    });
    document.getElementById("btn-finales")?.addEventListener("click",()=>renderTmFinales());
    document.getElementById("btn-back-finales")?.addEventListener("click",()=>renderTmHome());
    document.getElementById("btn-ods")?.addEventListener("click",()=>renderTmOds());
    document.getElementById("btn-back-ods")?.addEventListener("click",()=>renderTmHome());
    document.getElementById("btn-verbes")?.addEventListener("click",()=>renderTmVerbes());
    document.getElementById("btn-back-verbes")?.addEventListener("click",()=>renderTmHome());
    document.getElementById("tm-btn-browse")?.addEventListener("click",()=>toggleBrowse());
    document.getElementById("tm-btn-next")?.addEventListener("click",()=>browseNext());

    document.querySelectorAll("#v-themods .tc[data-theme]").forEach(card=>{
      card.addEventListener("click",()=>playTheme(card.dataset.theme));
    });
  }

  // Toujours afficher l'accueil quand on entre dans THEMODS
  renderTmHome();
}

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
  return tmState.themes[theme][label];
}

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

function renderTmFinales(){
  showTmView("tv-finales");
  updateFinalesStats();
  setDictBtnVisible(true);
}

function updateTmStats(){
  if(!tmState) return;
  // GM
  const prog=getGMProgress();
  const gmTotal=getAllGMEntries().length;
  const gmEl=document.getElementById("gm-desc");
  if(gmEl) gmEl.textContent="1 808 groupes · "+prog.done+"/"+gmTotal+" résolus";

  // Finales
  const finales=["able","age","ique","oir"];
  let totalSess=0, totalVal=0;
  finales.forEach(th=>{
    const d=window.THEMODS_DATA?.[th]; if(!d) return;
    totalSess+=d.length;
    d.forEach(({label})=>{ if(getSt(th,label).validated) totalVal++; });
  });
  const fEl=document.getElementById("finales-desc");
  if(fEl) fEl.textContent="4 finales · 2 488 mots"+(totalVal>0?" · "+totalVal+"/"+totalSess+" validées":"");

  // VI
  const viData=window.THEMODS_DATA?.vi||[];
  let viVal=0;
  viData.forEach(({label})=>{ if(getSt("vi",label).validated) viVal++; });
  const viEl=document.getElementById("vi-desc");
  if(viEl) viEl.textContent="575 verbes · 193 sessions"+(viVal>0?" · "+viVal+"/"+viData.length+" val.":"");
}

function updateFinalesStats(){
  const bases={able:"293 mots · 136 sessions",age:"1 311 mots · 360 sessions",ique:"629 mots · 177 sessions",oir:"253 mots · 99 sessions"};
  ["able","age","ique","oir"].forEach(th=>{
    const d=window.THEMODS_DATA?.[th]; if(!d) return;
    let val=0; d.forEach(({label})=>{ if(getSt(th,label).validated) val++; });
    const el=document.getElementById(th+"-desc");
    if(el) el.textContent=bases[th]+(val>0?" · "+val+"/"+d.length+" val.":"");
  });
}

/* ── Lancement session ── */
function playTheme(theme){
  tmTheme=theme;
  if(theme==="gm"){ startGM(); return; }
  const data=window.THEMODS_DATA?.[theme]; if(!data) return;
  const today=todayStr();
  let pool=data.filter(({label})=>{ const s=getSt(theme,label); return s.seen&&!s.validated&&s.due<=today; });
  if(!pool.length) pool=data.filter(({label})=>!getSt(theme,label).seen);
  if(!pool.length){
    const msg=document.getElementById("tm-home-msg");
    if(msg){msg.textContent="Toutes les sessions sont validées !";msg.className="tm-msg ok";}
    showTmView("tv-home");
    return;
  }
  startSession(theme, pool[Math.floor(Math.random()*pool.length)]);
}

function startSession(theme, session){
  tmSession=session; tmFound=new Set(); tmSolutions=false; tmNoHelp=true;
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
const THEME_NAMES={age:"Finale -AGE",vi:"Intransitifs",oir:"Finale -OIR",able:"Finale -ABLE",ique:"Finale -IQUE",gm:"Graphies multiples"};
const THEME_SFX={age:"AGE",vi:"",oir:"OIR",able:"ABLE",ique:"IQUE",gm:""};

function renderTmGame(){
  if(tmTheme==="gm"){ renderGMGame(); return; }
  const sess=tmSession; if(!sess) return;

  const el=id=>document.getElementById(id);
  const sfx=THEME_SFX[tmTheme];
  if(el("tm-gtitle")) el("tm-gtitle").textContent=sess.label+(sfx?"…"+sfx:"");
  if(el("tm-gtheme")) el("tm-gtheme").textContent=THEME_NAMES[tmTheme]||tmTheme;
  if(el("tm-gtotal")) el("tm-gtotal").textContent=sess.words.length+" mot"+(sess.words.length>1?"s":"")+" à trouver";
  if(el("tm-counter")) el("tm-counter").textContent=tmFound.size+" / "+sess.words.length;

  const list=el("tm-wlist"); if(!list) return;
  list.innerHTML="";
  sess.words.forEach((word,i)=>{
    const li=document.createElement("li");
    li.dataset.idx=i; li.className="slot";
    if(tmFound.has(i)){
      li.classList.add("found","clickable");
      li.textContent=word;
      li.addEventListener("click",()=>openDef(norm(word),word));
    } else if(tmSolutions){
      li.classList.add("revealed","clickable");
      li.textContent=word;
      li.addEventListener("click",()=>openDef(norm(word),word));
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
      li.className="slot found clickable";
      li.textContent=sess.words[i];
      li.addEventListener("click",()=>openDef(norm(sess.words[i]),sess.words[i]));
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
  const sess=tmSession; if(!sess) return;
  sess.words.forEach((w,i)=>{
    if(!tmFound.has(i)){
      tmFound.add(i);
      const li=document.querySelector("#tm-wlist li[data-idx='"+i+"']");
      if(li){
        li.className="slot revealed clickable";
        li.textContent=w;
        li.addEventListener("click",()=>openDef(norm(w),w));
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

function updateTmBtn(){
  const sol=document.getElementById("tm-btn-sol");
  const solKb=document.getElementById("tm-btn-sol-kb");
  const isGM=tmTheme==="gm";

  [sol,solKb].forEach(b=>{
    if(!b) return;
    if(isGM){
      // GM : Solutions visible avant résolution, masqué après
      if(tmSolutions){ b.style.display="none"; return; }
      b.style.display="";
      b.textContent="Solutions"; b.classList.add("btn-danger"); b.classList.remove("btn-primary");
      return;
    }
    b.style.display="";
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
function letterCount(w){ return w.replace(/[^A-Za-zÀ-ÿ]/g,"").length; }

function startGM(){
  const all=getAllGMEntries(), prog=getGMProgress();
  if(!prog.order||prog.order.length!==all.length){
    prog.order=shuffleArray(all.map((_,i)=>i));
    prog.idx=0; prog.done=0;
  }
  gmEntryIdx=prog.idx; gmFound=new Set(); tmSolutions=false; tmNoHelp=true;
  setDictBtnVisible(false);
  showTmView("tv-game");
  document.getElementById("tm-gtitle").textContent="";
  document.getElementById("tm-gtheme").textContent="Graphies multiples";
  document.getElementById("tm-gtotal").textContent="";
  document.getElementById("tm-counter").textContent="";
  updateTmBtn(); setTmMsg(""); renderGMGame();
  if(tmKb) tmKb.clear();
  setTimeout(()=>{ if(window.matchMedia("(pointer:fine)").matches) document.getElementById("tm-saisie")?.focus(); },80);
}

function renderGMGame(){
  const all=getAllGMEntries(), prog=getGMProgress();
  const entry=currentGMEntry();
  const list=document.getElementById("tm-wlist"); if(!list) return;
  list.innerHTML="";
  if(!entry){ setTmMsg("Toutes les entrées terminées !","ok"); return; }

  const sortedForms=[...entry.forms].sort((a,b)=>letterCount(a)-letterCount(b));
  const allFormsFound=sortedForms.every(f=>gmFound.has(norm(f)));

  const defDiv=document.createElement("div");
  defDiv.className="gm-def";
  defDiv.textContent=cleanDef(entry.def)||"…";
  list.appendChild(defDiv);

  const tilesDiv=document.createElement("div");
  tilesDiv.className="gm-tiles";
  sortedForms.forEach(form=>{
    const isFound=gmFound.has(norm(form))||allFormsFound;
    const revealed=isFound||tmSolutions;
    const letters=form.replace(/[^A-Za-zÀ-ÿ]/g,"");
    const wrap=document.createElement("div"); wrap.className="gm-row-wrap";
    const row=document.createElement("div"); row.className="gm-row";
    for(let i=0;i<letters.length;i++){
      const t=document.createElement("span");
      if(revealed){ t.className="gt "+(isFound?"ok":"miss"); t.textContent=letters[i].toUpperCase(); }
      else if(i===0){ t.className="gt init"; t.textContent=letters[0].toUpperCase(); }
      else { t.className="gt empty"; }
      row.appendChild(t);
    }
    wrap.appendChild(row);
    if(revealed){
      const inflected=getInflected(norm(form));
      if(inflected){
        const lbl=document.createElement("div");
        lbl.className="gm-inflected";
        lbl.textContent=inflected;
        wrap.appendChild(lbl);
      }
    }
    tilesDiv.appendChild(wrap);
  });
  list.appendChild(tilesDiv);

  if(allFormsFound||tmSolutions){
    const nav=document.createElement("div"); nav.className="gm-nav";
    const pos=document.createElement("span"); pos.className="gm-pos";
    pos.textContent=(gmEntryIdx+1)+" / "+all.length;
    nav.appendChild(pos);
    const nextBtn=document.createElement("button"); nextBtn.className="btn btn-primary";
    nextBtn.textContent="Entrée suivante →";
    nextBtn.addEventListener("click",()=>{
      gmEntryIdx++; prog.idx=gmEntryIdx;
      gmFound=new Set(); tmSolutions=false;
      setDictBtnVisible(false);
      updateTmBtn(); setTmMsg(""); renderGMGame();
      persistThemods().catch(()=>{});
    });
    nav.appendChild(nextBtn);
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

    document.getElementById("tm-btn-sol")?.addEventListener("click",()=>{
      tmSolutions ? playTheme(tmTheme) : showTmSolutions();
    });
    document.getElementById("tm-btn-sol-kb")?.addEventListener("click",()=>{
      tmSolutions ? playTheme(tmTheme) : showTmSolutions();
    });

    document.getElementById("btn-back-game")?.addEventListener("click",()=>renderTmHome());
    document.getElementById("btn-back-game-kb")?.addEventListener("click",()=>renderTmHome());
    document.getElementById("btn-finales")?.addEventListener("click",()=>renderTmFinales());
    document.getElementById("btn-back-finales")?.addEventListener("click",()=>renderTmHome());

    document.querySelectorAll("#v-themods .tc[data-theme]").forEach(card=>{
      card.addEventListener("click",()=>playTheme(card.dataset.theme));
    });
  }

  // Toujours afficher l'accueil quand on entre dans THEMODS
  renderTmHome();
}

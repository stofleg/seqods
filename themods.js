(function(){
"use strict";
const $ = s => document.querySelector(s);

const FB_BASE = "https://firestore.googleapis.com/v1/projects/methods-8e4b1/databases/(default)/documents";
function toFs(obj){
  function cv(v){
    if(v===null||v===undefined) return {nullValue:null};
    if(typeof v==="boolean") return {booleanValue:v};
    if(typeof v==="number") return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};
    if(typeof v==="string") return {stringValue:v};
    if(Array.isArray(v)) return {arrayValue:{values:v.map(cv)}};
    if(typeof v==="object") return {mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,w])=>[k,cv(w)]))}};
    return {stringValue:String(v)};
  }
  return {fields:Object.fromEntries(Object.entries(obj).map(([k,v])=>[k,cv(v)]))};
}
function fromFs(doc){
  if(!doc||!doc.fields) return null;
  function cv(v){
    if(v.nullValue!==undefined) return null;
    if(v.booleanValue!==undefined) return v.booleanValue;
    if(v.integerValue!==undefined) return parseInt(v.integerValue);
    if(v.doubleValue!==undefined) return v.doubleValue;
    if(v.stringValue!==undefined) return v.stringValue;
    if(v.arrayValue) return (v.arrayValue.values||[]).map(cv);
    if(v.mapValue) return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,w])=>[k,cv(w)]));
    return null;
  }
  return Object.fromEntries(Object.entries(doc.fields).map(([k,v])=>[k,cv(v)]));
}
async function fbGet(col,id){
  try{
    const r=await fetch(`${FB_BASE}/${col}/${id}`);
    if(r.status===404) return {ok:false,err:"not_found"};
    if(!r.ok) return {ok:false};
    return {ok:true,data:fromFs(await r.json())};
  }catch{return {ok:false};}
}
async function fbSet(col,id,obj){
  try{
    const r=await fetch(`${FB_BASE}/${col}/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(toFs(obj))});
    return r.ok?{ok:true}:{ok:false};
  }catch{return {ok:false};}
}

/* SESSION */
const LS_SESSION="METHODS_SESSION_V1";
let currentUser=null;
function loadSession(){try{return JSON.parse(localStorage.getItem(LS_SESSION)||"null");}catch{return null;}}

/* STATE */
const lsKey=()=>"THEMODS_STATE_"+(currentUser?.pseudo||"guest");
function defaultState(){return {updatedAt:0,themes:{}};}
function loadLocal(){try{return JSON.parse(localStorage.getItem(lsKey())||"null")||defaultState();}catch{return defaultState();}}
function saveLocal(st){try{localStorage.setItem(lsKey(),JSON.stringify(st));}catch{}}
async function loadFirebase(){
  if(!currentUser) return;
  const res=await fbGet("themods",currentUser.pseudo.toLowerCase());
  if(res.ok&&res.data){
    const r=res.data, l=loadLocal();
    state=(r.updatedAt||0)>=(l.updatedAt||0)?r:l;
  }else{state=defaultState();}
  saveLocal(state);
}
async function persist(){
  if(!currentUser) return;
  state.updatedAt=Date.now();
  saveLocal(state);
  await fbSet("themods",currentUser.pseudo.toLowerCase(),state);
}

let state=defaultState();

/* SRS */
const INTERVALS=[1,3,7,14,30,60,120];
function todayStr(){return new Date().toISOString().slice(0,10);}
function addDays(ymd,n){const d=new Date(ymd);d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);}
function nextInterval(cur){const i=INTERVALS.indexOf(cur);return INTERVALS[Math.min(INTERVALS.length-1,i<0?0:i+1)];}
function getSt(theme,label){
  if(!state.themes[theme]) state.themes[theme]={};
  if(!state.themes[theme][label]) state.themes[theme][label]={seen:false,validated:false,lastResult:"",lastSeen:"",interval:1,due:todayStr()};
  return state.themes[theme][label];
}

/* DICT ODS */
let D_SET = null;
function getDSet(){
  if(!D_SET){
    const d = window.SEQODS_DATA?.d;
    D_SET = d ? new Set(d) : new Set();
  }
  return D_SET;
}

/* GAME STATE */
let currentTheme=null, currentSession=null;
let found=new Set(), solutionsShown=false, noHelpRun=true, kbBuffer="";
let currentEntryIdx=0, entryFound=new Set(); // pour graphies multiples

function norm(w){
  if(!w) return "";
  return w.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^A-Z]/g,"");
}

/* UI */
function setMsg(txt,cls=""){
  const m=$("#tm-msg");if(m){m.textContent=txt;m.className="msg"+(cls?" "+cls:"");}
  const k=$("#tm-kbMsg");if(k){k.textContent=txt;k.className="kbMsg"+(cls?" "+cls:"");}
}
function updateCounter(){
  const el=$("#tm-counter");
  if(!el) return;
  if(currentTheme==="gm"){
    const total=(currentSession?.entries||[]).length;
    el.textContent=found.size+" / "+total;
  } else {
    el.textContent=found.size+" / "+(currentSession?.words?.length||0);
  }
}
function showScreen(id){
  ["tm-screen-home","tm-screen-game"].forEach(s=>{
    const el=$("#"+s);
    if(el) el.style.display=(s===id)?"":"none";
  });
}

/* HOME */

function updateHomeStats(){
  const today=todayStr();
  // Pour chaque thème, calculer seen/total/validated
  const themes=["age","vi","oir","able","ique"];
  themes.forEach(theme=>{
    const data=window.THEMODS_DATA?.[theme];
    if(!data) return;
    const total=data.length;
    let seen=0,validated=0;
    data.forEach(({label})=>{
      const s=getSt(theme,label);
      if(s.seen) seen++;
      if(s.validated) validated++;
    });
    const card=document.querySelector(`.tm-theme-card[data-theme="${theme}"]`);
    if(!card) return;
    const desc=card.querySelector(".tm-theme-desc");
    if(desc){
      const base=desc.dataset.base||desc.textContent;
      desc.dataset.base=base;
      const pct=total?Math.round(validated/total*100):0;
      desc.textContent=base.split("·")[0].trim()+" · "+seen+"/"+total+" vues · "+validated+"/"+total+" validées";
    }
  });
}

function renderHome(){
  showScreen("tm-screen-home");
  setTimeout(()=>{
    updateHomeStats();
    // Compteur GM
    const prog=getGMProgress();
    const total=getAllGMEntries().length;
    const el=document.getElementById("gm-home-desc");
    if(el) el.textContent="1 808 groupes · "+prog.done+" / "+total+" résolus";
  },50);
}

/* THEME SCREEN */
function playNext(theme){
  if(theme==="gm"){ startGM(); return; }
  const data=window.THEMODS_DATA?.[theme];
  if(!data) return;
  const today=todayStr();
  let candidates=data.filter(({label})=>{const st=getSt(theme,label);return !st.validated&&st.due<=today&&st.seen;});
  if(!candidates.length) candidates=data.filter(({label})=>!getSt(theme,label).seen);
  if(!candidates.length){
    renderHome();
    setTimeout(()=>{
      const msg=document.querySelector(".tm-home-msg");
      if(msg){msg.textContent="Toutes les sessions sont validées !";msg.className="tm-home-msg ok";}
    },100);
    return;
  }
  playSession(theme,candidates[Math.floor(Math.random()*candidates.length)]);
}

/* GAME */
function playSession(theme,session){
  currentSession=session;
  found=new Set();
  solutionsShown=false;
  noHelpRun=true;
  kbBuffer="";
  // Pour gm : currentEntryIdx = index dans entries, currentEntryFound = formes trouvées
  currentEntryIdx=0;
  entryFound=new Set();
  const st=getSt(theme,session.label);
  st.seen=true; st.lastSeen=todayStr();
  persist().catch(()=>{});
  renderGame();
  showScreen("tm-screen-game");
  updateCounter();
  kbUpdate();
  setMsg("");
  updateGameBtn();
}

function renderGame(){
  console.log("[THEMODS v1.1] renderGame theme=",currentTheme,"session=",currentSession?.label);
  // Titres communs
  const _sfx={age:"AGE",vi:"",oir:"OIR",able:"ABLE",ique:"IQUE",gm:""};
  const _names={age:"Finale -AGE",vi:"Intransitifs",oir:"Finale -OIR",able:"Finale -ABLE",ique:"Finale -IQUE",gm:"Graphies multiples"};
  const title=$("#tm-game-title");
  if(title){
    if(currentTheme==="gm") title.textContent="";
    else if(_sfx[currentTheme]) title.textContent=currentSession.label+"…"+_sfx[currentTheme];
    else title.textContent=currentSession.label;
  }
  const themeName=document.getElementById("tm-theme-name");
  if(themeName) themeName.textContent=_names[currentTheme]||currentTheme;

  const ctr=document.getElementById("tm-counter");
  if(ctr) ctr.style.display=(currentTheme==="gm")?"none":"";
  if(currentTheme==="gm"){ renderGMGame(); return; }

  const counter=$("#tm-total");
  if(counter) counter.textContent=currentSession.words.length+" mot"+(currentSession.words.length>1?"s":"")+" à trouver";
  const list=$("#tm-word-list");
  if(!list) return;
  list.innerHTML="";
  currentSession.words.forEach((word,i)=>{
    const li=document.createElement("li");
    li.dataset.idx=i;
    li.className="tm-slot";
    if(found.has(i)){
      li.classList.add("tm-found");
      li.textContent=word;
      li.style.cursor="pointer";
      li.addEventListener("mousedown",e=>e.preventDefault());
      li.addEventListener("click",()=>openDefForWord(word));
    }
    list.appendChild(li);
  });
}

function validateWord(raw){
  const n=norm(raw);
  if(!n) return;

  if(currentTheme==="gm"){
    validateWordGM(n);
    return;
  }

  const matched=[];
  currentSession.words.forEach((w,i)=>{if(!found.has(i)&&norm(w)===n) matched.push(i);});
  if(!matched.length){
    if(getDSet().has(n)){
      setMsg("Hors-jeu — mot valide mais pas dans cette liste.","warn");
    } else {
      setMsg("Mot inconnu — la partie s'arrête.","err");
      setTimeout(()=>showSolutions(), 800);
    }
    return;
  }
  matched.forEach(i=>{
    found.add(i);
    const li=document.querySelector("#tm-word-list li[data-idx='"+i+"']");
    if(li){
      const word=currentSession.words[i];
      li.classList.add("tm-found");
      li.textContent=word;
      li.style.cursor="pointer";
      li.addEventListener("mousedown",e=>e.preventDefault());
      li.addEventListener("click",()=>openDefForWord(word));
      li.scrollIntoView({behavior:"smooth",block:"nearest"});
    }
  });
  setMsg("");
  updateCounter();
  if(found.size===currentSession.words.length) finalizeSession(noHelpRun);
}

function validateWordGM(n){
  const entries=currentSession.entries||[];
  const entry=entries[currentEntryIdx];
  if(!entry) return;

  // Le mot correspond-il à une forme de l'entrée courante ?
  const matchedForm = entry.forms.find(f=>norm(f)===n);
  if(!matchedForm){
    if(getDSet().has(n)){
      setMsg("Hors-jeu — mot valide mais pas dans cette liste.","warn");
    } else {
      setMsg("Mot non valide.","err");
    }
    return;
  }

  // Marquer cette forme comme trouvée
  entryFound.add(n);
  setMsg("","");

  // Toutes les formes de cette entrée trouvées ?
  const allFound = entry.forms.every(f=>entryFound.has(norm(f)));
  if(allFound){
    found.add(currentEntryIdx);
    // Passer à l'entrée suivante automatiquement
    if(currentEntryIdx < entries.length-1){
      currentEntryIdx++;
      entryFound=new Set();
      setMsg("✓ Groupe complet — entrée suivante","ok");
    } else {
      setMsg("Toutes les entrées trouvées !","ok");
    }
  }

  renderGameGM();
  if(found.size===entries.length) finalize(noHelpRun);
}


function showSolutions(){
  chronoStop();
  noHelpRun=false;
  if(currentTheme==="gm"){
    noHelpRun=false;
    solutionsShown=true;
    updateGameBtn();
    renderGMGame();
    return;
  }
  currentSession.words.forEach((w,i)=>{
    if(!found.has(i)){
      found.add(i);
      const li=document.querySelector("#tm-word-list li[data-idx='"+i+"']");
      if(li){
      li.classList.add("tm-revealed");
      li.textContent=w;
      li.style.cursor="pointer";
      li.addEventListener("click",()=>openDefForWord(w));
    }
    }
  });
  solutionsShown=true;
  updateCounter();
  updateGameBtn();
  finalizeSession(false);
}

function finalizeSession(ok){
  const st=getSt(currentTheme,currentSession.label);
  if(ok){
    st.validated=true; st.lastResult="ok";
    st.interval=nextInterval(st.interval||1);
    st.due=addDays(todayStr(),st.interval);
    setMsg("Validée sans aide ✓","ok");
  }else{
    st.validated=false; st.lastResult="help";
    st.interval=3; st.due=addDays(todayStr(),3);
    setMsg("Session terminée.","warn");
  }
  solutionsShown=true;
  updateGameBtn();
  persist().catch(()=>{});
}

function updateGameBtn(){
  const btn=$("#tm-game-btn");
  if(!btn) return;
  if(solutionsShown){btn.textContent="Suivant";btn.dataset.mode="next";btn.classList.remove("btnDanger");}
  else{btn.textContent="Solutions";btn.dataset.mode="solutions";btn.classList.add("btnDanger");}
}

/* KEYBOARD */
function kbUpdate(){const d=$("#tm-kbDisplay");if(d) d.textContent=kbBuffer;}
function wireKeyboard(){
  const kb=$("#tm-keyboard");
  if(!kb) return;
  kb.addEventListener("mousedown",e=>{
    const key=e.target.closest(".kbKey");
    if(!key) return;
    e.preventDefault();
    const k=key.dataset.key;
    if(!k) return;
    if(k==="CLEAR"){kbBuffer="";kbUpdate();}
    else if(k==="SUPPR"){kbBuffer=kbBuffer.slice(0,-1);kbUpdate();}
    else if(k==="ENTER"){if(kbBuffer.trim()){validateWord(kbBuffer);kbBuffer="";kbUpdate();}}
    else{kbBuffer+=k;kbUpdate();}
  });
  kb.addEventListener("touchstart",e=>{
    const key=e.target.closest(".kbKey");
    if(!key) return;
    e.preventDefault();
    key.dispatchEvent(new MouseEvent("mousedown",{bubbles:true}));
  },{passive:false});
  kb.addEventListener("click",e=>{if(e.target.closest(".kbKey")) e.preventDefault();});
}


/* ===========================
   MODALE DÉFINITION
=========================== */
function normalizeForLookup(w){
  return w.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^A-Z]/g,"");
}

function openDefForWord(word){
  const data=window.SEQODS_DATA;
  if(!data) return;
  const C=data.c,E=data.e,F=data.f,A=data.a,R=data.r;
  const canon=normalizeForLookup(word);
  const idx=C.indexOf(canon);
  const tEl=document.getElementById("defTitle");
  const bEl=document.getElementById("defBody");
  const mEl=document.getElementById("defModal");
  if(!tEl||!bEl||!mEl) return;
  const displayWord=idx>=0?(E[idx].split(",")[0].trim()):word;
  tEl.textContent=displayWord;
  bEl.textContent=idx>=0?(F[idx]||"(définition absente)"):"(définition absente)";
  const rawWord=displayWord.split(",")[0].trim().toLowerCase();
  const wiktEl=document.getElementById("btnWiktionary");
  const imgEl=document.getElementById("btnGoogleImg");
  const linksDiv=document.getElementById("defLinks");
  if(linksDiv) linksDiv.style.display="flex";
  if(wiktEl) wiktEl.href="https://fr.wiktionary.org/wiki/"+encodeURIComponent(rawWord);
  if(imgEl) imgEl.href="https://www.google.com/search?tbm=isch&q="+encodeURIComponent(rawWord);
  const anaWrap=document.getElementById("anaWrap");
  const ana=document.getElementById("defAna");
  if(anaWrap&&ana&&A){
    const tir=canon.split("").sort((a,b)=>a.localeCompare(b,"fr")).join("");
    const lst=(tir&&A[tir])?A[tir].filter(x=>normalizeForLookup(x)!==canon).slice(0,60):[];
    if(lst.length){anaWrap.style.display="block";ana.textContent=lst.join(" • ");}
    else anaWrap.style.display="none";
  }
  const rallWrap=document.getElementById("rallWrap");
  const rallEl=document.getElementById("defRall");
  if(rallWrap&&rallEl&&R){
    const lst=R[canon]||[];
    if(lst.length){rallWrap.style.display="block";rallEl.textContent=lst.join(" • ");}
    else rallWrap.style.display="none";
  }
  mEl.classList.add("open");
}

function closeDef(){
  document.getElementById("defModal")?.classList.remove("open");
}

function wireDefModal(){
  document.getElementById("defClose")?.addEventListener("click",closeDef);
  document.getElementById("defBackdrop")?.addEventListener("click",closeDef);
  document.addEventListener("keydown",e=>{
    if(e.key==="Escape") closeDef();
    if(e.key==="F1"){
      e.preventDefault();
      if(currentTheme==="gm") startGM();
      else if(currentSession) playNext(currentTheme);
    }
  });
}


/* ===========================
   CHRONO
=========================== */
let chronoInterval=null, chronoRem=0;
let settings={chronoOn:true,dur:10};

function loadSettings(){
  try{ const s=JSON.parse(localStorage.getItem("METHODS_SETTINGS_V1")||"null"); if(s) settings=Object.assign(settings,s); }catch{}
}
function chronoFmt(s){ return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0"); }
function chronoStop(){ if(chronoInterval){clearInterval(chronoInterval);chronoInterval=null;} }
function chronoUpdate(){
  const el=$("#tm-chrono"); if(!el) return;
  if(!settings.chronoOn){el.textContent="";return;}
  el.textContent=chronoFmt(chronoRem);
  el.classList.toggle("expired",chronoRem===0);
}
function chronoStart(){
  chronoStop();
  const el=$("#tm-chrono");
  if(!settings.chronoOn){if(el)el.textContent="";return;}
  chronoRem=settings.dur*60;
  chronoUpdate();
  chronoInterval=setInterval(()=>{
    if(chronoRem>0){chronoRem--;chronoUpdate();}
    if(chronoRem===0&&!solutionsShown) showSolutions();
  },1000);
}

function letterCount(w){
  return w.replace(/[^A-Za-zÀ-ÿ]/g,"").length;
}

function scrabbleTiles(word, revealed){
  // Retourne le HTML des tuiles : initiale colorée + carrés vides
  const letters = word.replace(/[^A-Za-zÀ-ÿ]/g,"");
  const n = letters.length;
  let html = '<span class="gm-tiles">';
  if(revealed){
    for(let i=0;i<n;i++){
      html += `<span class="gm-tile gm-tile-rev">${letters[i].toUpperCase()}</span>`;
    }
  } else {
    html += `<span class="gm-tile gm-tile-init">${letters[0].toUpperCase()}</span>`;
    for(let i=1;i<n;i++){
      html += '<span class="gm-tile gm-tile-empty"></span>';
    }
  }
  html += '</span>';
  return html;
}

function renderGameGM(){
  const entries = currentSession.entries||[];
  const list = $("#tm-word-list");
  if(!list) return;
  list.innerHTML = "";

  // Afficher UNE définition à la fois (currentEntryIdx)
  // Trouver la première entrée non trouvée
  let idx = currentEntryIdx;
  if(idx >= entries.length) idx = entries.length - 1;
  const entry = entries[idx];
  if(!entry) return;

  // Trier les formes par longueur croissante
  const sortedForms = [...entry.forms].sort((a,b)=>letterCount(a)-letterCount(b));

  // ── Bloc définition ──
  const defBlock = document.createElement("div");
  defBlock.className = "gm-def-block";
  defBlock.innerHTML = `<div class="gm-def-text">${entry.def||"…"}</div>`;
  list.appendChild(defBlock);

  // ── Tuiles pour chaque forme ──
  const tilesBlock = document.createElement("div");
  tilesBlock.className = "gm-forms-block";

  sortedForms.forEach(form=>{
    const normForm = norm(form);
    const isFound = entryFound.has(normForm);
    const row = document.createElement("div");
    row.className = "gm-form-row";
    row.innerHTML = scrabbleTiles(form, isFound || solutionsShown);
    if((isFound || solutionsShown) && solutionsShown && !isFound){
      row.querySelector(".gm-tiles").classList.add("gm-tiles-revealed");
    }
    tilesBlock.appendChild(row);
  });
  list.appendChild(tilesBlock);

  // ── Navigation entre entrées (si validée ou solutions) ──
  if(found.has(idx) || solutionsShown){
    const navBlock = document.createElement("div");
    navBlock.className = "gm-nav-block";
    if(idx > 0){
      const prevBtn = document.createElement("button");
      prevBtn.className = "btn gm-nav-btn";
      prevBtn.textContent = "‹ Préc.";
      prevBtn.addEventListener("click",()=>{ currentEntryIdx=idx-1; renderGameGM(); });
      navBlock.appendChild(prevBtn);
    }
    const posEl = document.createElement("span");
    posEl.className = "gm-pos";
    posEl.textContent = (idx+1)+" / "+entries.length;
    navBlock.appendChild(posEl);
    if(idx < entries.length-1){
      const nextBtn = document.createElement("button");
      nextBtn.className = "btn gm-nav-btn";
      nextBtn.textContent = "Suiv. ›";
      nextBtn.addEventListener("click",()=>{ currentEntryIdx=idx+1; renderGameGM(); });
      navBlock.appendChild(nextBtn);
    }
    list.appendChild(navBlock);
  }

  const counter = $("#tm-counter");
  if(counter) counter.textContent = found.size+" / "+entries.length;
}




/* ===========================
   GRAPHIES MULTIPLES — mode continu aléatoire
=========================== */
function cleanDef(def){
  if(!def) return def;
  // Supprimer les parties entre crochets en début : [xxx] ou [xxx-]
  return def.replace(/^\[[^\]]*\]\s*/,"").trim();
}

function getAllGMEntries(){
  const data = window.THEMODS_DATA?.gm || [];
  const all = [];
  data.forEach(session=>{ (session.entries||[]).forEach(e=>all.push(e)); });
  return all;
}

function shuffleArray(arr){
  const a = [...arr];
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

function getGMProgress(){
  if(!state.themes) state.themes={};
  if(!state.themes.gm) state.themes.gm={};
  if(!state.themes.gm._p) state.themes.gm._p={idx:0,done:0,order:null};
  return state.themes.gm._p;
}

function startGM(){
  currentTheme="gm";
  const all=getAllGMEntries();
  const prog=getGMProgress();
  // Créer un ordre aléatoire si pas encore fait ou terminé
  if(!prog.order || prog.order.length!==all.length){
    prog.order = shuffleArray(all.map((_,i)=>i));
    prog.idx=0; prog.done=0;
  }
  currentEntryIdx=prog.idx;
  entryFound=new Set();
  solutionsShown=false;
  noHelpRun=true;
  kbBuffer="";
  showScreen("tm-screen-game");
  renderGMGame();
  kbUpdate();
  setMsg("");
  updateGameBtn();
}

function currentGMEntry(){
  const all=getAllGMEntries();
  const prog=getGMProgress();
  const realIdx=prog.order?.[currentEntryIdx];
  return realIdx!==undefined ? all[realIdx] : null;
}

function renderGMGame(){
  const all=getAllGMEntries();
  const prog=getGMProgress();
  const entry=currentGMEntry();
  if(!entry){ setMsg("Toutes les entrées terminées !","ok"); return; }

  const title=document.getElementById("tm-game-title");
  if(title) title.textContent="";
  const themeName=document.getElementById("tm-theme-name");
  if(themeName) themeName.textContent="Graphies multiples";
  const counter=document.getElementById("tm-counter");
  if(counter) counter.textContent=(prog.done)+" / "+all.length;

  const list=document.getElementById("tm-word-list");
  if(!list) return;
  list.innerHTML="";

  const sortedForms=[...entry.forms].sort((a,b)=>letterCount(a)-letterCount(b));
  const allFormsFound=sortedForms.every(f=>entryFound.has(norm(f)));

  // Construire en HTML direct pour être sûr du rendu
  let html = "";

  // ── Définition ─────────────────────────────────────────────────
  html += `<div style="
    text-align:center;padding:20px 16px 16px;
    font-size:16px;font-weight:800;line-height:1.5;color:var(--txt);
    border-bottom:1px solid var(--stroke);
  ">${cleanDef(entry.def)||"…"}</div>`;

  // ── Formes (tuiles) ────────────────────────────────────────────
  html += `<div style="padding:20px 16px;display:flex;flex-direction:column;gap:16px;">`;

  sortedForms.forEach(form=>{
    const normForm=norm(form);
    const isFound=entryFound.has(normForm)||allFormsFound;
    const revealed=isFound||solutionsShown;
    const letters=form.replace(/[^A-Za-zÀ-ÿ]/g,"");

    html += `<div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:center;">`;
    for(let i=0;i<letters.length;i++){
      const letter=letters[i].toUpperCase();
      if(revealed){
        const bg=isFound?"#2dd4d4":"#ff6b6b";
        const op=isFound?"1":"0.7";
        html += `<span style="
          width:36px;height:40px;border-radius:7px;
          background:${bg};opacity:${op};
          display:inline-flex;align-items:center;justify-content:center;
          font-size:18px;font-weight:900;color:#fff;
          box-shadow:0 3px 0 rgba(0,0,0,.3);flex-shrink:0;
        ">${letter}</span>`;
      } else if(i===0){
        html += `<span style="
          width:36px;height:40px;border-radius:7px;
          background:var(--accent);
          display:inline-flex;align-items:center;justify-content:center;
          font-size:18px;font-weight:900;color:#fff;
          box-shadow:0 3px 0 rgba(0,0,0,.3);flex-shrink:0;
        ">${letter}</span>`;
      } else {
        html += `<span style="
          width:36px;height:40px;border-radius:7px;
          background:rgba(255,255,255,.06);
          border:2px dashed rgba(255,255,255,.3);
          display:inline-flex;align-items:center;justify-content:center;
          flex-shrink:0;
        "></span>`;
      }
    }
    html += `</div>`;
  });

  html += `</div>`;

  // ── Navigation ─────────────────────────────────────────────────
  if(allFormsFound||solutionsShown){
    html += `<div style="
      padding:12px 16px;border-top:1px solid var(--stroke);
      display:flex;align-items:center;justify-content:space-between;
    ">
      <span style="font-size:12px;color:var(--muted);font-weight:700;">${currentEntryIdx+1} / ${all.length}</span>
      <button id="gm-next-btn" style="
        border:1px solid var(--stroke);border-radius:11px;
        background:rgba(105,167,255,.15);border-color:rgba(105,167,255,.4);
        color:var(--accent);cursor:pointer;font-weight:800;font-size:13px;
        padding:7px 16px;font-family:inherit;
      ">Entrée suivante →</button>
    </div>`;
  }

  list.innerHTML = html;

  // Wirer le bouton suivant
  document.getElementById("gm-next-btn")?.addEventListener("click",()=>{
    currentEntryIdx++;
    prog.idx=currentEntryIdx;
    entryFound=new Set();
    solutionsShown=false;
    updateGameBtn();
    setMsg("");
    renderGMGame();
    persist().catch(()=>{});
  });
}

function validateWordGM(n){
  const entry=currentGMEntry();
  if(!entry) return;

  const matchedForm=entry.forms.find(f=>norm(f)===n);
  if(!matchedForm){
    if(getDSet().has(n)){
      setMsg("Hors-jeu — mot valide mais pas dans cette liste.","warn");
    } else {
      setMsg("Mot non valide.","err");
    }
    return;
  }

  entryFound.add(n);
  noHelpRun=false; // trouver une forme = aide partielle
  setMsg("","");

  const allFound=entry.forms.every(f=>entryFound.has(norm(f)));
  if(allFound){
    const prog=getGMProgress();
    prog.done=(prog.done||0)+1;
    prog.idx=currentEntryIdx+1;
    setMsg("✓ Toutes les graphies trouvées !","ok");
    // Marquer comme résolue dans l'état
    if(!state.themes.gm._found) state.themes.gm._found=[];
    state.themes.gm._found.push(currentEntryIdx);
    persist().catch(()=>{});
  }

  renderGMGame();
}

/* WIRE */
function wire(){
  wireDefModal();
  $("#tm-back-home")?.addEventListener("click",renderHome);
  $("#tm-back-theme")?.addEventListener("click",renderHome);
  // Thèmes
  const THEME_LABELS = {
    age:  {name:"Finale -AGE",        hint:"Trouve tous les mots en <strong>-AGE</strong> qui commencent par le préfixe proposé."},
    vi:   {name:"Intransitifs",        hint:"Trouve tous les <strong>verbes intransitifs</strong> (p.p. inv.) qui commencent par le préfixe proposé."},
    oir:  {name:"Finale -OIR",        hint:"Trouve tous les mots en <strong>-OIR</strong> qui commencent par le préfixe proposé."},
    able: {name:"Finale -ABLE",       hint:"Trouve tous les mots en <strong>-ABLE</strong> qui commencent par le préfixe proposé."},
    ique: {name:"Finale -IQUE",       hint:"Trouve tous les mots en <strong>-IQUE</strong> qui commencent par le préfixe proposé."},
    gm:   {name:"Graphies multiples", hint:"Trouve toutes les <strong>graphies alternatives</strong> du mot défini."},
  };
  document.querySelectorAll(".tm-theme-card[data-theme]").forEach(card=>{
    card.addEventListener("click",()=>{ currentTheme=card.dataset.theme; playNext(currentTheme); });
  });
  $("#tm-game-btn")?.addEventListener("click",()=>{
    if(solutionsShown) playNext(currentTheme);
    else showSolutions();
  });
  const inp=$("#tm-saisie");
  if(inp){
    inp.addEventListener("keydown",e=>{
      if(e.key==="Enter"&&!e.isComposing){e.preventDefault();validateWord(inp.value);inp.value="";}
    });
  }
  wireKeyboard();
}

/* START */
async function start(){
  const saved=loadSession();
  if(saved?.pseudo) currentUser=saved;
  await loadFirebase();
  wire();
  renderHome();
}
document.addEventListener("DOMContentLoaded",start);
})();

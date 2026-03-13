(function(){
"use strict";
const $ = s => document.querySelector(s);

/* ===========================
   FIREBASE CONFIG + REST API
=========================== */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyA7rJeKcdHc6By15EBhOmYhFB_pA5J3aq4",
  projectId: "methods-8e4b1"
};
const FB_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;

async function sha256(str){
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
function randomToken(){
  return Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b=>b.toString(16).padStart(2,"0")).join("");
}

function toFs(obj){
  function cv(val){
    if(val===null||val===undefined) return {nullValue:null};
    if(typeof val==="boolean") return {booleanValue:val};
    if(typeof val==="number") return Number.isInteger(val)?{integerValue:String(val)}:{doubleValue:val};
    if(typeof val==="string") return {stringValue:val};
    if(Array.isArray(val)) return {arrayValue:{values:val.map(cv)}};
    if(typeof val==="object") return {mapValue:{fields:Object.fromEntries(Object.entries(val).map(([k,v])=>[k,cv(v)]))}};
    return {stringValue:String(val)};
  }
  return {fields:Object.fromEntries(Object.entries(obj).map(([k,v])=>[k,cv(v)]))};
}
function fromFs(doc){
  if(!doc||!doc.fields) return null;
  function cv(val){
    if(val.nullValue!==undefined) return null;
    if(val.booleanValue!==undefined) return val.booleanValue;
    if(val.integerValue!==undefined) return parseInt(val.integerValue);
    if(val.doubleValue!==undefined) return val.doubleValue;
    if(val.stringValue!==undefined) return val.stringValue;
    if(val.arrayValue) return (val.arrayValue.values||[]).map(cv);
    if(val.mapValue) return Object.fromEntries(Object.entries(val.mapValue.fields||{}).map(([k,v])=>[k,cv(v)]));
    return null;
  }
  return Object.fromEntries(Object.entries(doc.fields).map(([k,v])=>[k,cv(v)]));
}
async function fbGet(col,id){
  try{
    const r=await fetch(`${FB_BASE}/${col}/${id}`);
    if(r.status===404) return {ok:false,err:"not_found"};
    if(!r.ok) return {ok:false,err:"error"};
    const d=await r.json();
    return {ok:true,data:fromFs(d)};
  }catch{return {ok:false,err:"network"};}
}
async function fbSet(col,id,obj){
  try{
    const r=await fetch(`${FB_BASE}/${col}/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(toFs(obj))});
    return r.ok?{ok:true}:{ok:false,err:"error"};
  }catch{return {ok:false,err:"network"};}
}

/* ===========================
   UTIL
=========================== */
function normalizeWord(s){
  return (s||"").toString().trim().toUpperCase()
    .replace(/\s+/g,"")
    .replace(/[’'`´]/g,"'");
}
function todayStr(){
  return new Intl.DateTimeFormat("fr-CA",{year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}
function addDays(ymd, days){
  const [y,m,d]=ymd.split("-").map(Number);
  const dt=new Date(y,m-1,d);
  dt.setDate(dt.getDate()+days);
  return new Intl.DateTimeFormat("fr-CA",{year:"numeric",month:"2-digit",day:"2-digit"}).format(dt);
}
function cmpDate(a,b){ return a.localeCompare(b); }
function tirageFromC(c){
  const n = normalizeWord(c);
  return n.split("").sort((a,b)=>a.localeCompare(b,"fr")).join("");
}
function setMessage(t,cls){
  const el=$("#msg");
  if(!el) return;
  if(cls==="err"){
    el.textContent = t || "";
    el.className = "msg err";
  }else{
    el.textContent = "";
    el.className = "msg";
  }
}
function currentRedirectUri(){
  const u = new URL(window.location.href);
  u.search = "";
  u.hash = "";
  return u.toString();
}
function pad4(n){ return String(n).padStart(4, "0"); }


/* ===========================
   LOCAL STATE
=========================== */
function defaultState(){
  return { updatedAt:0, lists:{}, currentRun:null };
}
function mergeDefaults(obj){
  const base=defaultState();
  if(!obj||typeof obj!=="object") return base;
  const out=Object.assign(base,obj);
  out.lists=Object.assign({},base.lists,obj.lists||{});
  if(!out.currentRun||typeof out.currentRun!=="object") out.currentRun=null;
  return out;
}
function loadLocal(){ try{ return mergeDefaults(JSON.parse(localStorage.getItem(localStateKey())||"null")); }catch{ return defaultState(); } }
function saveLocal(st){ try{ localStorage.setItem(localStateKey(),JSON.stringify(st)); }catch{} }


/* ===========================
   SRS
=========================== */
const INTERVALS=[1,3,7,14,30,60,120];
function nextInterval(cur){
  const i=INTERVALS.indexOf(cur);
  if(i<0) return 3;
  return INTERVALS[Math.min(INTERVALS.length-1,i+1)];
}

function ensureListState(st,seqIndex){
  const k=String(seqIndex);
  if(!st.lists[k]) st.lists[k]={seen:false,validated:false,lastResult:"",lastSeen:""};
  return st.lists[k];
}


/* ===========================
   DATA
=========================== */
const DATA = window.SEQODS_DATA;
const C = DATA?.c || [];
const E = DATA?.e || [];
const F = DATA?.f || [];
const A = DATA?.a || {};
const D = DATA?.d || [];   // dictionnaire ODS9 complet (toutes formes)
const R = DATA?.r || {};   // rallonges par mot canonique

const sequences = [];
for(let start=0; start+11<C.length; start+=12){
  sequences.push({ startIdx:start, endIdx:start+11 });
}
const TOTAL = sequences.length;

function isInDictionary(norm){
  return DICT.has(norm);
}
let state = loadLocal();
let currentSeqIndex = -1;
let seq = null;
let targets = [];
let found = new Set();
let hintMode = Array(10).fill("none");
let noHelpRun = true;
let syncTimer = null;
let DICT = new Set();  // sera rempli avec D (ODS9 complet) au démarrage


/* ===========================
   HELPERS UI / SYNC
=========================== */
function scheduleSync(delay = 250){
  if(syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    persistState().catch(() => {});
  }, delay);
}

function moveNewButtonForMobile(){ /* bouton Nouveau supprimé */ }


/* ===========================
   DEFINITIONS / ANAGRAMMES
=========================== */
function openDef(defText, titleWord, canonForAnagrams, showAnagrams){
  const tEl=$("#defTitle"), bEl=$("#defBody"), mEl=$("#defModal");
  if(!tEl || !bEl || !mEl) return;

  tEl.textContent = titleWord || "";
  bEl.textContent = defText || "(definition absente)";

  const base=normalizeWord(canonForAnagrams || titleWord || "");

  // Anagrammes (seulement quand showAnagrams=true)
  const anaWrap=$("#anaWrap"), ana=$("#defAna");
  if(anaWrap && ana){
    if(!showAnagrams || !base){
      anaWrap.style.display="none";
      ana.textContent="";
    }else{
      const tir = base.split("").sort((a,b)=>a.localeCompare(b,"fr")).join("");
      const lst = (tir && A[tir]) ? A[tir].slice() : [];
      const filtered = lst.filter(x=>normalizeWord(x)!==base);

      if(filtered.length===0){
        anaWrap.style.display="none";
        ana.textContent="";
      }else{
        anaWrap.style.display="block";
        const shown = filtered.slice(0,60);
        ana.textContent = shown.join(" \u2022 ") + (filtered.length>60 ? ` \u2026 (+${filtered.length-60})` : "");
      }
    }
  }

  // Rallonges (seulement quand showAnagrams=true, comme les anagrammes)
  const rallWrap=$("#rallWrap"), rallEl=$("#defRall");
  if(rallWrap && rallEl){
    if(!showAnagrams || !base){
      rallWrap.style.display="none";
      rallEl.textContent="";
    }else{
      const lst = R[base] || [];
      if(lst.length===0){
        rallWrap.style.display="none";
        rallEl.textContent="";
      }else{
        rallWrap.style.display="block";
        rallEl.textContent = lst.join(" \u2022 ");
      }
    }
  }

  mEl.classList.add("open");
}
function closeDef(){
  const mEl=$("#defModal");
  if(mEl) mEl.classList.remove("open");
  if(window.matchMedia("(pointer:fine)").matches) setTimeout(()=>$("#saisie")?.focus(),0);
}


/* ===========================
   PROGRESSION UI
=========================== */
function computeStats(){
  const seenBar=$("#seenBar"), valBar=$("#valBar"), seenCount=$("#seenCount"), valCount=$("#valCount");
  if(!seenBar || !valBar || !seenCount || !valCount) return;

  let seen=0, validated=0;
  for(const k in state.lists){
    if(state.lists[k]?.seen) seen++;
    if(state.lists[k]?.validated) validated++;
  }

  seenCount.textContent = `${seen}/${TOTAL}`;
  valCount.textContent  = `${validated}/${TOTAL}`;
  seenBar.style.width = `${Math.round((seen/TOTAL)*100)}%`;
  valBar.style.width  = `${Math.round((validated/TOTAL)*100)}%`;
}


/* ===========================
   CURRENT RUN SAVE/RESTORE
=========================== */
function saveCurrentRun(){
  if(currentSeqIndex < 0) return;
  state.currentRun = {
    seqIndex: currentSeqIndex,
    found: Array.from(found.values()),
    hintMode: Array.isArray(hintMode) ? hintMode.slice() : Array(10).fill("none"),
    noHelpRun: !!noHelpRun
  };
  state.updatedAt = Date.now();
  saveLocal(state);
}

function clearCurrentRun(){
  state.currentRun = null;
  state.updatedAt = Date.now();
  saveLocal(state);
}

function buildTargetsForSeq(seqIndex){
  const s = sequences[seqIndex];
  if(!s) return null;

  const arr = [];
  for(let i=s.startIdx+1;i<=s.startIdx+10;i++){
    const c=C[i];
    arr.push({
      c,
      e:E[i],
      f:F[i] || "",
      len: normalizeWord(c).length,
      t: tirageFromC(c)
    });
  }
  return arr;
}

function restoreCurrentRunIfAny(){
  const cr = state.currentRun;
  if(!cr || typeof cr.seqIndex !== "number") return false;
  if(cr.seqIndex < 0 || cr.seqIndex >= TOTAL) return false;

  currentSeqIndex = cr.seqIndex;
  seq = sequences[currentSeqIndex];
  targets = buildTargetsForSeq(currentSeqIndex) || [];
  found = new Set(Array.isArray(cr.found) ? cr.found : []);
  hintMode = Array.isArray(cr.hintMode) ? cr.hintMode.slice(0,10) : Array(10).fill("none");
  while(hintMode.length < 10) hintMode.push("none");
  noHelpRun = !!cr.noHelpRun;

  return true;
}


/* ===========================
   PICK / REVIEW POLICY
=========================== */
function getDueReviewIndexes(){
  const today = todayStr();
  const out = [];
  for(let i=0;i<TOTAL;i++){
    const ls = ensureListState(state, i);
    if(ls.seen && cmpDate(ls.due || today, today) <= 0){
      out.push(i);
    }
  }
  return out;
}

function getNewIndexes(){
  const out = [];
  for(let i=0;i<TOTAL;i++){
    const ls = ensureListState(state, i);
    if(!ls.seen){
      out.push(i);
    }
  }
  return out;
}

function pickSpecificSequence(seqIndex){
  currentSeqIndex = seqIndex;
  seq = sequences[currentSeqIndex];
  targets = buildTargetsForSeq(currentSeqIndex) || [];
  found = new Set();
  hintMode = Array(10).fill("none");
  noHelpRun = true;
  saveCurrentRun();
  scheduleSync();
  return true;
}

function pickAccordingPolicy(forcePlainNew=false){
  const today = todayStr();
  const dueReviews = getDueReviewIndexes();
  const newOnes = getNewIndexes();

  let pool = [];

  if(!forcePlainNew && dueReviews.length && state.revisionSnoozeDate !== today){
    const replay = window.confirm("Des listes sont à réviser. Voulez-vous les rejouer ?");
    if(replay){
      pool = dueReviews;
    }else{
      state.revisionSnoozeDate = today;
      state.updatedAt = Date.now();
      saveLocal(state);
      persistState().catch(()=>{});
      pool = newOnes.length ? newOnes : dueReviews;
    }
  }else{
    pool = newOnes.length ? newOnes : dueReviews;
  }

  if(!pool.length){
    setMessage("Aucune liste disponible.", "warn");
    return false;
  }

  const seqIndex = pool[Math.floor(Math.random()*pool.length)];
  return pickSpecificSequence(seqIndex);
}


/* ===========================
   RENDER
=========================== */
function renderBounds(){
  const a=$("#borneA"), b=$("#borneB");
  if(!a || !b || !seq) return;

  const aE=E[seq.startIdx] || "";
  const bE=E[seq.endIdx] || "";
  const aF=F[seq.startIdx] || "";
  const bF=F[seq.endIdx] || "";

  a.textContent = aE;
  b.textContent = bE;

  a.onclick = ()=>openDef(aF, aE, C[seq.startIdx], true);
  b.onclick = ()=>openDef(bF, bE, C[seq.endIdx], true);
}

function renderSlots(){
  const list=$("#liste");
  if(!list) return;

  list.innerHTML="";
  for(let i=0;i<10;i++){
    const t = targets[i];
    const red = !!(t && t.len >= 10);

    const li=document.createElement("li");
    li.className="slot";
    li.dataset.slot=String(i);
    li.innerHTML=`
      <div class="slotMain${red ? ' redFlag' : ''}">
        <button type="button" class="slotWordBtn">
          <span class="slotText"></span>
          <span class="slotHint"></span>
        </button>
      </div>
      <div class="slotTools">
        <button class="toolBtn" data-tool="tirage" title="Tirage">ABC</button>
        <button class="toolBtn" data-tool="def" title="Définition">📖</button>
        <button class="toolBtn" data-tool="len" title="Nombre de lettres">123</button>
      </div>`;
    list.appendChild(li);

    if(found.has(i)){
      revealSlot(i);
    }else{
      applyHint(i);
    }
  }
}

function applyHint(i){
  const li=$("#liste")?.querySelector(`li[data-slot="${i}"]`);
  if(!li) return;

  const hint=li.querySelector(".slotHint");
  if(!hint) return;

  if(found.has(i)){
    hint.style.display="none";
    li.querySelectorAll(".toolBtn").forEach(b=>b.disabled=true);
    return;
  }

  li.querySelectorAll(".toolBtn").forEach(b=>b.disabled=false);

  if(hintMode[i]==="tirage"){
    hint.textContent = targets[i].t;
    hint.style.display="flex";
  }else if(hintMode[i]==="len"){
    const w = targets[i].c || targets[i].e || "";
    hint.textContent = w.replace(/[^A-Za-zÀ-ÿ]/g,"").length;
    hint.style.display="flex";
  }else{
    hint.style.display="none";
  }
}
function applyHintsAll(){ for(let i=0;i<10;i++) applyHint(i); }

function revealSlot(i, failed=false){
  const li=$("#liste")?.querySelector(`li[data-slot="${i}"]`);
  if(!li) return;

  const btn=li.querySelector(".slotWordBtn");
  const txt=li.querySelector(".slotText");
  if(txt) txt.textContent = targets[i].e;

  if(btn){
    btn.dataset.def = targets[i].f || "";
    btn.dataset.word = targets[i].e || "";
    btn.dataset.canon = targets[i].c || "";
  }

  const main=li.querySelector(".slotMain");
  if(main){
    if(failed){
      main.classList.add("slotFailed");
    }else{
      main.classList.add("slotValidated");
    }
  }

  hintMode[i]="none";
  applyHint(i);
}

function markAidUsed(){
  noHelpRun = false;
  saveCurrentRun();
  scheduleSync();
}

function finalizeList(wasSolvedWithHelp){
  const ls = ensureListState(state, currentSeqIndex);
  ls.seen = true;
  ls.lastSeen = todayStr();

  if(wasSolvedWithHelp){
    ls.validated = false;
    ls.lastResult = "help";
    ls.interval = 3;
    ls.due = addDays(todayStr(), 3);
    setMessage("Liste terminée, mais avec aide.", "warn");
  }else{
    ls.validated = true;
    ls.lastResult = "ok";
    ls.interval = nextInterval(ls.interval || 1);
    ls.due = addDays(todayStr(), ls.interval);
    setMessage("Validée sans aide.", "ok");
  }

  chronoStop();
  state.updatedAt = Date.now();
  clearCurrentRun();
  computeStats();
  persistState().catch(()=>{});
}

function updateCounter(){
  const c=$("#compteur");
  if(c) c.textContent = `${found.size}/10`;

  if(found.size !== 10) return;
  finalizeList(!noHelpRun);
  switchToRejouer();
}

function validateWord(raw){
  const norm=normalizeWord(raw);
  if(!norm){ setMessage("Saisie vide.", "warn"); return; }

  const matched=[];
  for(let i=0;i<targets.length;i++){
    if(normalizeWord(targets[i].c)===norm) matched.push(i);
  }

  if(matched.length===0){
    const el=$("#msg");
    if(el){
      if(isInDictionary(norm)){
        el.innerHTML = `Mot hors-jeu : <strong>${norm}</strong>`;
        el.className = "msg horsjeu";
      }else{
        el.innerHTML = `Mot non valide : <strong>${norm}</strong>`;
        el.className = "msg err";
      }
    }
    return;
  }

  let newly=0;
  for(const i of matched){
    if(!found.has(i)){
      found.add(i);
      revealSlot(i);
      newly++;
    }
  }

  // mot valide trouvé : effacer le message d'erreur
  const el=$("#msg");
  if(el){ el.textContent=""; el.className="msg"; }

  saveCurrentRun();
  scheduleSync();
  updateCounter();
}

let solutionsShown = false;

function showSolutions(){
  chronoStop();
  markAidUsed();
  for(let i=0;i<10;i++){
    if(!found.has(i)){
      found.add(i);
      revealSlot(i, true);
    }
  }
  solutionsShown = true;
  saveCurrentRun();
  scheduleSync();
  updateCounter();
  updateSolutionsBtn();
}

function updateSolutionsBtn(){
  const btnS=$("#btnSolutions");
  if(!btnS) return;
  if(solutionsShown){
    btnS.textContent="Jouer";
    btnS.dataset.mode="rejouer";
    btnS.classList.remove("btnDanger");
  }else{
    btnS.textContent="Solutions";
    btnS.dataset.mode="solutions";
    btnS.classList.add("btnDanger");
  }
  const btnSet=$("#btnSettings");
  if(btnSet) btnSet.style.display=solutionsShown?"":"none";
}

function switchToRejouer(){ chronoStop(); solutionsShown=true; updateSolutionsBtn(); }
function resetSolutionsBtn(){ solutionsShown=false; updateSolutionsBtn(); }


/* ===========================
   SESSION
=========================== */
const LS_SESSION = "METHODS_SESSION_V1";
let currentUser = null;

function loadSession(){ try{ return JSON.parse(localStorage.getItem(LS_SESSION)||"null"); }catch{ return null; } }
function saveSession(s){ try{ localStorage.setItem(LS_SESSION,JSON.stringify(s)); }catch{} }
function clearSession(){ try{ localStorage.removeItem(LS_SESSION); }catch{} currentUser=null; }
function localStateKey(){ return "METHODS_STATE_"+(currentUser?currentUser.pseudo:"guest"); }

/* ===========================
   SETTINGS
=========================== */
const LS_SETTINGS = "METHODS_SETTINGS_V1";
let settings = { chronoEnabled:true, chronoDuration:10, hintAbc:true, hintDef:true, hintLen:true };
function loadSettings(){ try{ const s=JSON.parse(localStorage.getItem(LS_SETTINGS)||"null"); if(s) settings=Object.assign(settings,s); }catch{} }
function saveSettings(){ try{ localStorage.setItem(LS_SETTINGS,JSON.stringify(settings)); }catch{} }

/* ===========================
   PERSISTENCE FIREBASE
=========================== */
async function authLogin(pseudo,password){
  const res=await fbGet("users",pseudo.toLowerCase());
  if(res.err==="not_found") return {ok:false,err:"Utilisateur inconnu."};
  if(!res.ok) return {ok:false,err:"Impossible de contacter la base de données."};
  const hash=await sha256(password);
  if(res.data.passwordHash!==hash) return {ok:false,err:"Mot de passe incorrect."};
  const token=randomToken();
  await fbSet("users",pseudo.toLowerCase(),{...res.data,sessionToken:token});
  return {ok:true,token,pseudo:res.data.pseudo||pseudo};
}
async function authRegister(pseudo,password,question,answer){
  if(!pseudo||pseudo.length<2) return {ok:false,err:"Pseudo trop court (min 2 caractères)."};
  if(!password||password.length<4) return {ok:false,err:"Mot de passe trop court (min 4 caractères)."};
  const key=pseudo.toLowerCase();
  const exists=await fbGet("users",key);
  if(exists.ok) return {ok:false,err:"Ce pseudo est déjà pris."};
  const hash=await sha256(password);
  const ansHash=await sha256(answer.toLowerCase().trim());
  const token=randomToken();
  const res=await fbSet("users",key,{pseudo,passwordHash:hash,question,answerHash:ansHash,sessionToken:token});
  if(!res.ok) return {ok:false,err:"Erreur lors de la création du compte."};
  return {ok:true,token};
}
async function authRecover(pseudo,answer,newPassword){
  if(!newPassword||newPassword.length<4) return {ok:false,err:"Nouveau mot de passe trop court."};
  const res=await fbGet("users",pseudo.toLowerCase());
  if(res.err==="not_found") return {ok:false,err:"Utilisateur inconnu."};
  if(!res.ok) return {ok:false,err:"Impossible de contacter la base de données."};
  const ansHash=await sha256(answer.toLowerCase().trim());
  if(res.data.answerHash!==ansHash) return {ok:false,err:"Réponse incorrecte."};
  await fbSet("users",pseudo.toLowerCase(),{...res.data,passwordHash:await sha256(newPassword),sessionToken:randomToken()});
  return {ok:true};
}
async function verifySessionToken(pseudo,token){
  const res=await fbGet("users",pseudo.toLowerCase());
  if(!res.ok) return false;
  return res.data.sessionToken===token;
}
function loadLocal(){ try{ return mergeDefaults(JSON.parse(localStorage.getItem(localStateKey())||"null")); }catch{ return defaultState(); } }
function saveLocal(st){ try{ localStorage.setItem(localStateKey(),JSON.stringify(st)); }catch{} }
async function loadStateFromFirebase(){
  if(!currentUser) return;
  const res=await fbGet("states",currentUser.pseudo.toLowerCase());
  if(res.ok&&res.data){
    const remote=mergeDefaults(res.data);
    const local=loadLocal();
    state=(remote.updatedAt||0)>=(local.updatedAt||0)?remote:local;
  }else{
    state=defaultState();
  }
  saveLocal(state);
}
async function persistState(){
  if(!currentUser) return;
  state.updatedAt=Date.now();
  saveLocal(state);
  await fbSet("states",currentUser.pseudo.toLowerCase(),state);
}


/* ===========================
   AUTH UI
=========================== */
function showAuthScreen(){
  const g=$("#gameScreen"),a=$("#authScreen");
  if(g) g.style.display="none";
  if(a) a.style.display="flex";
  setAuthView("login");
}
function showGameScreen(){
  const g=$("#gameScreen"),a=$("#authScreen");
  if(a) a.style.display="none";
  if(g) g.style.display="";
}
function setAuthView(v){
  ["login","register","recover"].forEach(n=>{
    const el=$("#auth_"+n); if(el) el.style.display=(n===v)?"block":"none";
  });
  const e=$("#authErr"); if(e){e.textContent="";e.className="msg";}
}
function showAuthErr(msg,isOk=false){
  const e=$("#authErr"); if(e){e.textContent=msg;e.className=isOk?"msg ok":"msg err";}
}
function authSetLoading(on){
  ["btnLogin","btnRegister","btnDoRecover"].forEach(id=>{const e=$("#"+id);if(e)e.disabled=on;});
}
function updateUserChip(){
  const e=$("#userChip"); if(e&&currentUser) e.textContent=currentUser.pseudo;
}
function showWaitScreen(){
  chronoStop();
  seq=null; targets=[]; found=new Set(); hintMode=Array(10).fill("none"); solutionsShown=true;
  const borneA=$("#borneA"),borneB=$("#borneB");
  if(borneA){borneA.textContent="—";borneA.onclick=null;}
  if(borneB){borneB.textContent="—";borneB.onclick=null;}
  const list=$("#liste"); if(list) list.innerHTML="";
  const msg=$("#msg"); if(msg){msg.textContent="";msg.className="msg";}
  // Chrono : afficher 00:00 en blanc
  const cd=$("#chronoDisplay");
  if(cd){
    cd.textContent=settings.chronoEnabled?"00:00":"";
    cd.classList.remove("running","chronoExpired");
  }
  updateSolutionsBtn();
}
function wireAuth(){
  const toLogin=()=>setAuthView("login");
  const go=async(pseudo,token)=>{
    currentUser={pseudo,token}; saveSession(currentUser);
    showGameScreen(); state=defaultState();
    await loadStateFromFirebase(); updateUserChip();
    showWaitScreen();
    setInterval(()=>persistState().catch(()=>{}),60000);
  };
  $("#btnLogin")?.addEventListener("click",async()=>{
    const p=($("#authPseudo")?.value||"").trim(), pw=$("#authPass")?.value||"";
    if(!p||!pw){showAuthErr("Remplis tous les champs.");return;}
    authSetLoading(true);
    const r=await authLogin(p,pw); authSetLoading(false);
    if(!r.ok){showAuthErr(r.err);return;}
    go(r.pseudo||p,r.token);
  });
  // Vérification pseudo en temps réel
  let pseudoCheckTimer=null;
  $("#regPseudo")?.addEventListener("input", e=>{
    const hint=$("#regPseudoHint"); if(!hint) return;
    const val=e.target.value.trim();
    clearTimeout(pseudoCheckTimer);
    if(val.length<2){ hint.textContent=""; hint.className="pseudoHint"; return; }
    hint.textContent="⏳ Vérification…"; hint.className="pseudoHint checking";
    pseudoCheckTimer=setTimeout(async()=>{
      const res=await fbGet("users",val.toLowerCase());
      if(res.ok){ hint.textContent="✗ Ce pseudo est déjà pris"; hint.className="pseudoHint taken"; }
      else{ hint.textContent="✓ Disponible"; hint.className="pseudoHint available"; }
    },600);
  });

  $("#btnRegister")?.addEventListener("click",async()=>{
    const p=($("#regPseudo")?.value||"").trim(),pw=$("#regPass")?.value||"",
          q=($("#regQuestion")?.value||"").trim(),a=($("#regAnswer")?.value||"").trim();
    if(!p||!pw||!q||!a){showAuthErr("Remplis tous les champs.");return;}
    authSetLoading(true);
    const r=await authRegister(p,pw,q,a); authSetLoading(false);
    if(!r.ok){showAuthErr(r.err);return;}
    go(p,r.token);
  });
  $("#btnDoRecover")?.addEventListener("click",async()=>{
    const p=($("#recPseudo")?.value||"").trim(),a=($("#recAnswer")?.value||"").trim(),np=$("#recNewPass")?.value||"";
    if(!p||!a||!np){showAuthErr("Remplis tous les champs.");return;}
    authSetLoading(true);
    const r=await authRecover(p,a,np); authSetLoading(false);
    if(!r.ok){showAuthErr(r.err);return;}
    showAuthErr("Mot de passe modifié !",true); setAuthView("login");
  });
  $("#toRegister")?.addEventListener("click",()=>setAuthView("register"));
  $("#toLogin")?.addEventListener("click",toLogin);
  $("#toRecover")?.addEventListener("click",()=>setAuthView("recover"));
  $("#toLogin2")?.addEventListener("click",toLogin);
  ["authPass","regAnswer","recNewPass"].forEach(id=>{
    $("#"+id)?.addEventListener("keydown",e=>{
      if(e.key!=="Enter") return;
      if(id==="authPass") $("#btnLogin")?.click();
      else if(id==="regAnswer") $("#btnRegister")?.click();
      else if(id==="recNewPass") $("#btnDoRecover")?.click();
    });
  });
}

/* ===========================
   CHRONO
=========================== */
let chronoInterval=null, chronoRemaining=0;
function chronoFormat(s){return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");}
function chronoUpdate(){
  const el=$("#chronoDisplay"); if(!el) return;
  if(!settings.chronoEnabled){el.textContent="";return;}
  el.textContent=chronoFormat(chronoRemaining);
  el.classList.toggle("chronoExpired",chronoRemaining===0);
}
function chronoStart(){
  chronoStop();
  const cd=$("#chronoDisplay");
  if(!settings.chronoEnabled){if(cd){cd.textContent="";cd.classList.remove("running");}return;}
  chronoRemaining=settings.chronoDuration*60;
  if(cd) cd.classList.add("running");
  chronoUpdate();
  chronoInterval=setInterval(()=>{
    if(chronoRemaining>0){ chronoRemaining--; chronoUpdate(); }
    if(chronoRemaining===0 && !solutionsShown){ showSolutions(); }
  },1000);
}
function chronoStop(){if(chronoInterval){clearInterval(chronoInterval);chronoInterval=null;}}

/* ===========================
   SETTINGS UI
=========================== */
function applyHintSettings(){
  document.querySelectorAll('[data-tool="tirage"]').forEach(b=>b.style.display=settings.hintAbc?"":"none");
  document.querySelectorAll('[data-tool="def"]').forEach(b=>b.style.display=settings.hintDef?"":"none");
  document.querySelectorAll('[data-tool="len"]').forEach(b=>b.style.display=settings.hintLen?"":"none");
}
function updateSettingsUI(){
  // Chrono toggle
  const tc=$("#toggleChrono"),th=$("#toggleThumb"),dr=$("#settingsDurationRow");
  if(tc){tc.style.background=settings.chronoEnabled?"var(--accent)":"var(--muted)";tc.setAttribute("aria-pressed",settings.chronoEnabled);}
  if(th) th.style.transform=settings.chronoEnabled?"translateX(24px)":"translateX(0)";
  if(dr) dr.style.display=settings.chronoEnabled?"block":"none";
  // Hint toggles
  [["settingsHintAbc","hintAbc"],["settingsHintDef","hintDef"],["settingsHintLen","hintLen"]].forEach(([id,key])=>{
    const chk=$("#"+id); if(!chk) return;
    chk.checked=settings[key];
    const par=chk.parentElement;
    const tr=par?.querySelector(".toggleTrackS"),tm=par?.querySelector(".toggleThumbS");
    if(tr) tr.style.background=settings[key]?"var(--accent)":"var(--muted)";
    if(tm) tm.style.transform=settings[key]?"translateX(20px)":"translateX(0)";
  });
  // Slider
  const sl=$("#settingsDuration"),lb=$("#settingsDurationLabel");
  if(sl) sl.value=settings.chronoDuration;
  if(lb) lb.textContent=settings.chronoDuration+" min";
}
function openSettings(){
  const m=$("#settingsModal"); if(!m) return;
  updateSettingsUI(); m.classList.add("open");
}
function closeSettings(){$("#settingsModal")?.classList.remove("open");}
function wireSettings(){
  $("#btnSettings")?.addEventListener("click",openSettings);
  $("#closeSettings")?.addEventListener("click",closeSettings);
  $("#settingsBackdrop")?.addEventListener("click",closeSettings);
  // Chrono toggle
  $("#toggleChrono")?.addEventListener("click",()=>{
    settings.chronoEnabled=!settings.chronoEnabled;
    updateSettingsUI(); saveSettings(); chronoUpdate();
  });
  // Slider durée
  $("#settingsDuration")?.addEventListener("input",e=>{
    settings.chronoDuration=parseInt(e.target.value);
    const lb=$("#settingsDurationLabel"); if(lb) lb.textContent=settings.chronoDuration+" min";
    saveSettings();
  });
  // Hint toggles — wirés via délégation sur la modale (toujours disponible)
  $("#settingsModal")?.addEventListener("click",e=>{
    const track=e.target.closest(".toggleTrackS,.toggleThumbS");
    if(!track) return;
    const par=track.parentElement;
    const chk=par?.querySelector("input[type=checkbox]");
    if(!chk) return;
    const id=chk.id;
    const keyMap={settingsHintAbc:"hintAbc",settingsHintDef:"hintDef",settingsHintLen:"hintLen"};
    const key=keyMap[id]; if(!key) return;
    settings[key]=!settings[key];
    updateSettingsUI(); saveSettings(); applyHintSettings();
  });
}

/* ===========================
   WIRE
=========================== */
function wire(){
  wireAuth();
  wireSettings();
  const inp=$("#saisie");
  if(inp){
    inp.addEventListener("keydown",(e)=>{
      if(e.key==="Enter" && !e.isComposing){
        e.preventDefault();
        const val = inp.value;
        inp.value="";
        validateWord(val);
      }
    });
  }

  const btnS=$("#btnSolutions");
  if(btnS) btnS.addEventListener("click", ()=>{
    if(btnS.dataset.mode === "rejouer"){
      if(pickAccordingPolicy(false)) renderAll();
    }else{
      showSolutions();
    }
  });

  const list=$("#liste");
  const refocusInput=()=>{ if(window.matchMedia("(pointer:fine)").matches) $("#saisie")?.focus(); };
  // Sur desktop : empêcher le vol de focus au mousedown sur tous les boutons de la liste
  if(list) list.addEventListener("mousedown",(e)=>{
    if(!window.matchMedia("(pointer:fine)").matches) return;
    if(e.target.closest(".toolBtn,.slotWordBtn")) e.preventDefault();
  });
  if(list) list.addEventListener("click",(e)=>{
    const tool = e.target.closest(".toolBtn");
    if(tool){
      const li=tool.closest(".slot");
      const i=Number(li?.dataset?.slot ?? -1);
      if(i<0 || i>9) return;

      const which=tool.dataset.tool;
      if(which==="def"){
        markAidUsed();
        openDef(targets[i].f || "", "", targets[i].c, false);
        refocusInput();
        return;
      }
      if(which==="len"){
        markAidUsed();
        if(found.has(i)) return;
        hintMode[i]=(hintMode[i]==="len")?"none":"len";
        applyHint(i); saveCurrentRun(); scheduleSync(); refocusInput();
        return;
      }

      if(which==="tirage"){
        markAidUsed();
        if(found.has(i)) return;
        hintMode[i] = (hintMode[i]==="tirage") ? "none" : "tirage";
        applyHint(i);
        saveCurrentRun();
        scheduleSync(); refocusInput();
        return;
      }
    }

    const w = e.target.closest(".slotWordBtn");
    if(w){
      const li=w.closest(".slot");
      const i=Number(li?.dataset?.slot ?? -1);
      if(i<0 || i>9) return;
      if(!found.has(i)) return;
      openDef(w.dataset.def||"", w.dataset.word||"", w.dataset.canon||"", true);
    }
  });

  const defClose=$("#defClose");
  if(defClose){
    defClose.addEventListener("mousedown",(e)=>{ if(window.matchMedia("(pointer:fine)").matches) e.preventDefault(); });
    defClose.addEventListener("click", closeDef);
  }
  const defBackdrop=$("#defBackdrop");
  if(defBackdrop) defBackdrop.addEventListener("click", closeDef);
  document.addEventListener("keydown",(e)=>{ if(e.key==="Escape") closeDef(); });
  $("#btnLogout")?.addEventListener("click",()=>{clearSession();showAuthScreen();});

  moveNewButtonForMobile();
  window.addEventListener("resize", moveNewButtonForMobile);
  window.addEventListener("orientationchange", moveNewButtonForMobile);

  window.addEventListener("beforeunload", ()=>{ saveLocal(state); });
}

function renderAll(){
  renderBounds();
  renderSlots();
  const c=$("#compteur");
  if(c) c.textContent = `${found.size}/10`;
  computeStats();
  resetSolutionsBtn();
  chronoStart();
  applyHintSettings();
}


/* ===========================
   START
=========================== */
async function start(){
  loadSettings();
  initKeyboardDetection();
  DICT=D.length>0?new Set(D.map(w=>normalizeWord(w))):new Set(C.map(w=>normalizeWord(w)));
  wire();
  moveNewButtonForMobile();
  const saved=loadSession();
  if(saved&&saved.pseudo){
    currentUser=saved;
    showGameScreen();
    state=defaultState();
    await loadStateFromFirebase();
    updateUserChip();
    showWaitScreen();
    setInterval(()=>persistState().catch(()=>{}),60000);
    return;
  }
  showAuthScreen();
}


/* ===========================
   KEYBOARD DETECTION (iOS)
=========================== */
function initKeyboardDetection(){
  if(!window.visualViewport) return;
  let lastHeight = window.visualViewport.height;
  window.visualViewport.addEventListener("resize", ()=>{
    const h = window.visualViewport.height;
    const diff = lastHeight - h;
    // Si la hauteur diminue de plus de 100px → clavier ouvert
    if(diff > 100){
      document.body.classList.add("keyboard-open");
    } else if(diff < -100 || h > lastHeight - 50){
      document.body.classList.remove("keyboard-open");
    }
    lastHeight = h;
  });
  // Aussi sur focus/blur du champ de saisie
  document.addEventListener("focusin", e=>{
    if(e.target.id==="saisie") setTimeout(()=>{
      if(window.visualViewport.height < window.screen.height * 0.75)
        document.body.classList.add("keyboard-open");
    }, 300);
  });
  document.addEventListener("focusout", e=>{
    if(e.target.id==="saisie") setTimeout(()=>{
      document.body.classList.remove("keyboard-open");
    }, 100);
  });
}

document.addEventListener("DOMContentLoaded", start);
})();

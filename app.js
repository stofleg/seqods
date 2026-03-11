(function(){
"use strict";
const $ = (s)=>document.querySelector(s);

/* ===========================
/* ===========================
   FIREBASE CONFIG
=========================== */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyA7rJeKcdHc6By15EBhOmYhFB_pA5J3aq4",
  authDomain: "methods-8e4b1.firebaseapp.com",
  projectId: "methods-8e4b1",
  storageBucket: "methods-8e4b1.firebasestorage.app",
  messagingSenderId: "622786673295",
  appId: "1:622786673295:web:c276ef2ec2608b74e58efa"
};

const FB_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;

/* ===========================
/* ===========================
   CRYPTO UTILS
=========================== */
async function sha256(str){
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
function randomToken(){
  return Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b=>b.toString(16).padStart(2,"0")).join("");
}

/* ===========================
/* ===========================
   FIRESTORE REST API
=========================== */
// Convertit un objet JS en document Firestore
function toFirestore(obj){
  function convert(val){
    if(val === null || val === undefined) return {nullValue: null};
    if(typeof val === "boolean") return {booleanValue: val};
    if(typeof val === "number") return Number.isInteger(val) ? {integerValue: String(val)} : {doubleValue: val};
    if(typeof val === "string") return {stringValue: val};
    if(Array.isArray(val)) return {arrayValue: {values: val.map(convert)}};
    if(typeof val === "object") return {mapValue: {fields: Object.fromEntries(Object.entries(val).map(([k,v])=>[k,convert(v)]))}};
    return {stringValue: String(val)};
  }
  return {fields: Object.fromEntries(Object.entries(obj).map(([k,v])=>[k,convert(v)]))};
}

// Convertit un document Firestore en objet JS
function fromFirestore(doc){
  if(!doc || !doc.fields) return null;
  function convert(val){
    if(val.nullValue !== undefined) return null;
    if(val.booleanValue !== undefined) return val.booleanValue;
    if(val.integerValue !== undefined) return parseInt(val.integerValue);
    if(val.doubleValue !== undefined) return val.doubleValue;
    if(val.stringValue !== undefined) return val.stringValue;
    if(val.arrayValue) return (val.arrayValue.values||[]).map(convert);
    if(val.mapValue) return Object.fromEntries(Object.entries(val.mapValue.fields||{}).map(([k,v])=>[k,convert(v)]));
    return null;
  }
  return Object.fromEntries(Object.entries(doc.fields).map(([k,v])=>[k,convert(v)]));
}

async function fbGet(collection, docId){
  try{
    const res = await fetch(`${FB_BASE}/${collection}/${docId}`);
    if(res.status === 404) return {ok:false, err:"not_found"};
    if(!res.ok) return {ok:false, err:"error"};
    const data = await res.json();
    return {ok:true, data: fromFirestore(data), name: data.name};
  }catch(e){ return {ok:false, err:"network"}; }
}

async function fbSet(collection, docId, obj){
  try{
    const url = `${FB_BASE}/${collection}/${docId}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(toFirestore(obj))
    });
    if(!res.ok) return {ok:false, err:"error"};
    return {ok:true};
  }catch(e){ return {ok:false, err:"network"}; }
}

/* ===========================
/* ===========================
   SESSION LOCALE
=========================== */
const LS_SESSION = "ODYSSEE_SESSION_V1";
let currentUser = null; // {pseudo, token}

function loadSession(){
  try{ return JSON.parse(localStorage.getItem(LS_SESSION)||"null"); }
  catch{ return null; }
}
function saveSession(s){
  try{ localStorage.setItem(LS_SESSION, JSON.stringify(s)); }catch{}
}
function clearSession(){
  try{ localStorage.removeItem(LS_SESSION); }catch{}
  currentUser = null;
}
function localStateKey(){
  return "ODYSSEE_STATE_" + (currentUser ? currentUser.pseudo : "guest");
}

/* ===========================
/* ===========================
   STATE LOCAL
=========================== */
const STORE_LOCAL = "ODYSSEE_STATE_V1";
function defaultState(){
  return { updatedAt:0, lists:{}, currentRun:null };
}
function mergeDefaults(obj){
  const base = defaultState();
  if(!obj || typeof obj !== "object") return base;
  const out = Object.assign(base, obj);
  out.lists = Object.assign({}, base.lists, obj.lists||{});
  if(!out.currentRun || typeof out.currentRun !== "object") out.currentRun = null;
  return out;
}
function loadLocal(){
  try{ return mergeDefaults(JSON.parse(localStorage.getItem(localStateKey())||"null")); }
  catch{ return defaultState(); }
}
function saveLocal(st){
  try{ localStorage.setItem(localStateKey(), JSON.stringify(st)); }catch{}
}

/* ===========================
/* ===========================
   AUTH FIREBASE
=========================== */
async function authLogin(pseudo, password){
  const res = await fbGet("users", pseudo);
  if(res.err==="not_found") return {ok:false, err:"Utilisateur inconnu."};
  if(!res.ok) return {ok:false, err:"Impossible de contacter la base de données."};
  const hash = await sha256(password);
  if(res.data.passwordHash !== hash) return {ok:false, err:"Mot de passe incorrect."};
  const token = randomToken();
  await fbSet("users", pseudo.toLowerCase(), {...res.data, sessionToken: token});
  return {ok:true, token, pseudo: res.data.pseudo || pseudo};
}

async function authRegister(pseudo, password, question, answer){
  if(!pseudo || pseudo.length < 2) return {ok:false, err:"Pseudo trop court (min 2 caractères)."};
  if(!password || password.length < 4) return {ok:false, err:"Mot de passe trop court (min 4 caractères)."};
  const key = pseudo;
  const exists = await fbGet("users", key);
  if(exists.ok) return {ok:false, err:"Ce pseudo est déjà pris."};
  const hash = await sha256(password);
  const ansHash = await sha256(answer.toLowerCase().trim());
  const token = randomToken();
  const resSet = await fbSet("users", key, {
    pseudo, passwordHash:hash, question, answerHash:ansHash, sessionToken:token
  });
  if(!resSet.ok) return {ok:false, err:"Erreur lors de la création du compte."};
  return {ok:true, token};
}

async function authRecover(pseudo, answer, newPassword){
  if(!newPassword || newPassword.length < 4) return {ok:false, err:"Nouveau mot de passe trop court."};
  const res = await fbGet("users", pseudo);
  if(res.err==="not_found") return {ok:false, err:"Utilisateur inconnu."};
  if(!res.ok) return {ok:false, err:"Impossible de contacter la base de données."};
  const ansHash = await sha256(answer.toLowerCase().trim());
  if(res.data.answerHash !== ansHash) return {ok:false, err:"Réponse incorrecte."};
  const newHash = await sha256(newPassword);
  await fbSet("users", pseudo, {...res.data, passwordHash:newHash, sessionToken:randomToken()});
  return {ok:true};
}

async function verifySessionToken(pseudo, token){
  const res = await fbGet("users", pseudo);
  if(!res.ok) return false;
  return res.data.sessionToken === token;
}

/* ===========================
/* ===========================
   PERSISTENCE STATE FIREBASE
=========================== */
async function loadStateFromFirebase(){
  if(!currentUser) return;
  const res = await fbGet("states", currentUser.pseudo);
  if(res.ok && res.data){
    const remote = mergeDefaults(res.data);
    const local = loadLocal();
    const useRemote = (remote.updatedAt||0) >= (local.updatedAt||0);
    state = useRemote ? remote : local;
  } else {
    state = defaultState();
  }
  saveLocal(state);
}

async function persistState(){
  if(!currentUser) return;
  saveLocal(state);
  state.updatedAt = Date.now();
  await fbSet("states", currentUser.pseudo, state);
  saveLocal(state);
}

/* ===========================
/* ===========================
   AUTH UI
=========================== */
function showAuthScreen(){
  const game=$("#gameScreen"), auth=$("#authScreen");
  if(game) game.style.display="none";
  if(auth) auth.style.display="flex";
  setAuthView("login");
}
function showGameScreen(){
  const game=$("#gameScreen"), auth=$("#authScreen");
  if(auth) auth.style.display="none";
  if(game) game.style.display="";
}
function setAuthView(view){
  ["login","register","recover"].forEach(v=>{
    const el=$("#auth_"+v); if(el) el.style.display=(v===view)?"block":"none";
  });
  const err=$("#authErr"); if(err){ err.textContent=""; err.className="msg"; }
}
function showAuthErr(msg, isOk=false){
  const el=$("#authErr");
  if(el){ el.textContent=msg; el.className=isOk?"msg ok":"msg err"; }
}
function authSetLoading(loading){
  ["btnLogin","btnRegister","btnDoRecover"].forEach(id=>{
    const el=$("#"+id); if(el) el.disabled=loading;
  });
}
function updateUserChip(){
  const el=$("#userChip");
  if(el && currentUser) el.textContent=currentUser.pseudo;
  // Mettre à jour le titre de l'écran auth aussi
  const authTitle=document.querySelector("#auth_login h2");
  if(authTitle) authTitle.textContent="METHODS";
}

function showWaitScreen(){
  chronoStop();
  seq=null; targets=[]; found=new Set(); hintMode=Array(10).fill("none"); solutionsShown=true;
  const c=$("#compteur"); if(c) c.textContent="0/10";
  const borneA=$("#borneA"), borneB=$("#borneB");
  if(borneA){ borneA.textContent="—"; borneA.onclick=null; }
  if(borneB){ borneB.textContent="—"; borneB.onclick=null; }
  const list=$("#liste"); if(list) list.innerHTML="";
  const msg=$("#msg"); if(msg){ msg.textContent=""; msg.className="msg"; }
  updateSolutionsBtn();
}

function wireAuth(){
  const btnLogin=$("#btnLogin");
  if(btnLogin) btnLogin.addEventListener("click", async ()=>{
    const pseudo=($("#authPseudo")?.value||"").trim();
    const pass=$("#authPass")?.value||"";
    if(!pseudo||!pass){ showAuthErr("Remplis tous les champs."); return; }
    authSetLoading(true);
    const res = await authLogin(pseudo, pass);
    authSetLoading(false);
    if(!res.ok){ showAuthErr(res.err); return; }
    currentUser={pseudo: res.pseudo||pseudo, token:res.token};
    saveSession(currentUser);
    showGameScreen();
    state=defaultState();
    await loadStateFromFirebase();
    updateUserChip();
    showWaitScreen();
    setInterval(()=>{ persistState().catch(()=>{}); }, 60000);
  });

  const btnRegister=$("#btnRegister");
  if(btnRegister) btnRegister.addEventListener("click", async ()=>{
    const pseudo=($("#regPseudo")?.value||"").trim();
    const pass=$("#regPass")?.value||"";
    const q=($("#regQuestion")?.value||"").trim();
    const a=($("#regAnswer")?.value||"").trim();
    if(!pseudo||!pass||!q||!a){ showAuthErr("Remplis tous les champs."); return; }
    authSetLoading(true);
    const res = await authRegister(pseudo, pass, q, a);
    authSetLoading(false);
    if(!res.ok){ showAuthErr(res.err); return; }
    currentUser={pseudo, token:res.token};
    saveSession(currentUser);
    showGameScreen();
    state=defaultState();
    await loadStateFromFirebase();
    updateUserChip();
    showWaitScreen();
    setInterval(()=>{ persistState().catch(()=>{}); }, 60000);
  });

  const btnDoRecover=$("#btnDoRecover");
  if(btnDoRecover) btnDoRecover.addEventListener("click", async ()=>{
    const pseudo=($("#recPseudo")?.value||"").trim();
    const answer=($("#recAnswer")?.value||"").trim();
    const newPass=$("#recNewPass")?.value||"";
    if(!pseudo||!answer||!newPass){ showAuthErr("Remplis tous les champs."); return; }
    authSetLoading(true);
    const res = await authRecover(pseudo, answer, newPass);
    authSetLoading(false);
    if(!res.ok){ showAuthErr(res.err); return; }
    showAuthErr("Mot de passe modifié ! Tu peux te connecter.", true);
    setAuthView("login");
  });

  const toReg=$("#toRegister"); if(toReg) toReg.addEventListener("click",()=>setAuthView("register"));
  const toLog=$("#toLogin"); if(toLog) toLog.addEventListener("click",()=>setAuthView("login"));
  const toRec=$("#toRecover"); if(toRec) toRec.addEventListener("click",()=>setAuthView("recover"));
  const toLog2=$("#toLogin2"); if(toLog2) toLog2.addEventListener("click",()=>setAuthView("login"));

  ["authPass","regAnswer","recNewPass"].forEach(id=>{
    const el=$("#"+id);
    if(el) el.addEventListener("keydown",(e)=>{
      if(e.key==="Enter"){
        if(id==="authPass") $("#btnLogin")?.click();
        else if(id==="regAnswer") $("#btnRegister")?.click();
        else if(id==="recNewPass") $("#btnDoRecover")?.click();
      }
    });
  });
}

/* ===========================
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

/* ===========================
/* ===========================
   LOCAL STATE
=========================== */


/* ===========================

/* ===========================
/* ===========================
   SRS
=========================== */
const INTERVALS=[1,3,7,14,30,60,120];
function nextInterval(cur){
  const i=INTERVALS.indexOf(cur);
  if(i<0) return 3;
  return INTERVALS[Math.min(INTERVALS.length-1,i+1)];
}
function ensureListState(st, seqIndex){
  const k=String(seqIndex);
  if(!st.lists[k]){
    st.lists[k] = {
      due: todayStr(),
      interval: 1,
      seen: false,
      validated: false,
      lastResult: "",
      lastSeen: ""
    };
  }
  return st.lists[k];
}

/* ===========================

/* ===========================
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

/* ===========================
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

/* ===========================
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
}

/* ===========================

/* ===========================
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

/* ===========================
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

/* ===========================
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

/* ===========================
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
        <button class="toolBtn" data-tool="tirage" title="Lettres alphabétiques">ABC</button>
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
    hint.textContent = w.replace(/[^A-Za-zÀ-ÿ]/g,"").length + " lettres";
    hint.style.display="flex";
  }else{
    hint.style.display="none";
  }
}
function applyHintsAll(){ for(let i=0;i<10;i++) applyHint(i); applyHintVisibility(); }

function applyHintVisibility(){
  const list=$("#liste"); if(!list) return;
  list.querySelectorAll(".toolBtn[data-tool='tirage']").forEach(b=>{
    b.style.display = settings.hintAbc ? "" : "none";
  });
  list.querySelectorAll(".toolBtn[data-tool='def']").forEach(b=>{
    b.style.display = settings.hintDef ? "" : "none";
  });
  list.querySelectorAll(".toolBtn[data-tool='len']").forEach(b=>{
    b.style.display = settings.hintLen ? "" : "none";
  });
}


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

  state.updatedAt = Date.now();
  clearCurrentRun();
  computeStats();
  persistState().catch(()=>{});
  chronoStop();
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

let solutionsShown = true; // démarre en mode "Jouer"

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
}

function switchToRejouer(){ solutionsShown=true; updateSolutionsBtn(); }
function resetSolutionsBtn(){ solutionsShown=false; updateSolutionsBtn(); }

/* ===========================

/* ===========================
   SETTINGS
=========================== */
const LS_SETTINGS = "METHODS_SETTINGS_V1";
let settings = { chronoEnabled: true, chronoDuration: 10, hintAbc: true, hintDef: true, hintLen: true };

function loadSettings(){
  try{ const s=JSON.parse(localStorage.getItem(LS_SETTINGS)||"null"); if(s) settings=Object.assign(settings,s); }catch{}
}
function saveSettings(){
  try{ localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); }catch{}
}

/* ===========================
   CHRONO
=========================== */
let chronoInterval=null, chronoRemaining=0;
function chronoFormat(s){
  const m=Math.floor(s/60), sec=s%60;
  return String(m).padStart(2,"0")+":"+String(sec).padStart(2,"0");
}
function chronoUpdate(){
  const el=$("#chronoDisplay");
  if(!el) return;
  if(!settings.chronoEnabled){ el.textContent=""; return; }
  el.textContent=chronoFormat(chronoRemaining);
  el.classList.toggle("chronoExpired", chronoRemaining<=0);
}
function chronoStart(){
  chronoStop();
  if(!settings.chronoEnabled){ chronoUpdate(); return; }
  chronoRemaining = settings.chronoDuration * 60;
  chronoUpdate();
  chronoInterval=setInterval(()=>{
    if(chronoRemaining>0){ chronoRemaining--; chronoUpdate(); }
  },1000);
}
function chronoStop(){
  if(chronoInterval){ clearInterval(chronoInterval); chronoInterval=null; }
}

/* ===========================
   SETTINGS UI
=========================== */
function updateToggleUI(){
  const btn=$("#toggleChrono"), thumb=$("#toggleThumb"), row=$("#settingsDurationRow");
  if(!btn) return;
  const on=settings.chronoEnabled;
  btn.style.background = on ? "var(--accent)" : "var(--muted)";
  btn.setAttribute("aria-pressed", on);
  if(thumb) thumb.style.transform = on ? "translateX(24px)" : "translateX(0)";
  if(row) row.style.display = on ? "block" : "none";
}

function openSettings(){
  const modal=$("#settingsModal"); if(!modal) return;
  const slider=$("#settingsDuration"), lbl=$("#settingsDurationLabel");
  if(slider) slider.value=settings.chronoDuration;
  if(lbl) lbl.textContent=settings.chronoDuration+" min";
  updateToggleUI();
  modal.classList.add("open");
}
function closeSettings(){
  const modal=$("#settingsModal"); if(modal) modal.classList.remove("open");
}
function wireSettings(){
  const btn=$("#btnSettings"); if(btn) btn.addEventListener("click", openSettings);
  const cls=$("#closeSettings"); if(cls) cls.addEventListener("click", closeSettings);

  const toggle=$("#toggleChrono");
  if(toggle) toggle.addEventListener("click",()=>{
    settings.chronoEnabled=!settings.chronoEnabled;
    updateToggleUI();
    saveSettings();
    chronoUpdate();
  });

  const slider=$("#settingsDuration"), lbl=$("#settingsDurationLabel");
  if(slider) slider.addEventListener("input",()=>{
    settings.chronoDuration=parseInt(slider.value);
    if(lbl) lbl.textContent=settings.chronoDuration+" min";
    saveSettings();
  });

  const backdrop=$("#settingsBackdrop");
  if(backdrop) backdrop.addEventListener("click", closeSettings);
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

  const btnD=$("#btnDropbox");
  if(btnD) btnD.addEventListener("click", async ()=>{
    const t = loadTokens();
    if(t && (t.refresh_token || hasValidAccessToken(t))){
      setMessage("Synchronisation…", "");
      await persistState();
      setMessage("Synchronisation terminée.", "ok");
      return;
    }
    oauthStart();
  });

  const list=$("#liste");
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
        return;
      }

      if(which==="tirage"){
        markAidUsed();
        if(found.has(i)) return;
        hintMode[i] = (hintMode[i]==="tirage") ? "none" : "tirage";
        applyHint(i);
        saveCurrentRun();
        scheduleSync();
        return;
      }
      if(which==="len"){
        markAidUsed();
        if(found.has(i)) return;
        hintMode[i] = (hintMode[i]==="len") ? "none" : "len";
        applyHint(i);
        saveCurrentRun();
        scheduleSync();
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
  if(defClose) defClose.addEventListener("click", closeDef);
  const defBackdrop=$("#defBackdrop");
  if(defBackdrop) defBackdrop.addEventListener("click", closeDef);
  document.addEventListener("keydown",(e)=>{ if(e.key==="Escape") closeDef(); });

  const btnLogout=$("#btnLogout");
  if(btnLogout) btnLogout.addEventListener("click",()=>{ clearSession(); showAuthScreen(); });

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
}

/* ===========================

/* ===========================
/* ===========================
   START
=========================== */
async function start(){
  loadSettings();
  DICT = D.length>0 ? new Set(D.map(w=>normalizeWord(w))) : new Set(C.map(w=>normalizeWord(w)));
  wire();
  moveNewButtonForMobile();

  // Vérifier session sauvegardée
  const saved = loadSession();
  if(saved && saved.pseudo && saved.token){
    const valid = await verifySessionToken(saved.pseudo, saved.token);
    if(valid){
      currentUser = saved;
      showGameScreen();
      state = defaultState();
      await loadStateFromFirebase();
      updateUserChip();
      if(restoreCurrentRunIfAny()){ renderAll(); }
      else{ showWaitScreen(); }
      setInterval(()=>{ persistState().catch(()=>{}); }, 60000);
      return;
    }
  }
  showAuthScreen();
}

document.addEventListener("DOMContentLoaded", start);
})();

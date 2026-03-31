"use strict";
/* ══════════════════════════════════════════
   METHODS.JS
══════════════════════════════════════════ */

const DATA = window.SEQODS_DATA || {};
const C = DATA.c || [];
const E = DATA.e || [];
const F = DATA.f || [];
const D = DATA.d || [];

let DICT = new Set();

const sequences = [];
for(let i=0; i+11<C.length; i+=12){
  sequences.push({startIdx:i, endIdx:i+11});
}
const TOTAL_SEQ = sequences.length;

/* ── État ── */
const LS_METHODS = () => "METHODS_STATE_" + (currentUser?.pseudo||"guest");
let mState = null;
let seq = null;
let targets = [];
let mFound = new Set();
let hintMode = Array(10).fill("none");
let hintUsed = Array(10).fill(false);
let mNoHelp = true;
let mSolutionsShown = true;
let mKb = null;
let mInited = false;

function mDefaultState(){ return {updatedAt:0, lists:{}}; }
function mLoadLocal(){ try{ return JSON.parse(localStorage.getItem(LS_METHODS())||"null")||mDefaultState(); }catch{ return mDefaultState(); } }
function mSaveLocal(){ try{ localStorage.setItem(LS_METHODS(), JSON.stringify(mState)); }catch{} }

async function loadMethodsState(){
  mState = mLoadLocal();
  if(!currentUser) return;
  const r = await fbGet("states", currentUser.pseudo.toLowerCase());
  if(r.ok && r.data && (r.data.updatedAt||0) > (mState.updatedAt||0)) mState = r.data;
  mSaveLocal();
}
async function persistMethodsState(){
  if(!currentUser) return;
  mState.updatedAt = Date.now();
  mSaveLocal();
  await fbSet("states", currentUser.pseudo.toLowerCase(), mState);
}

function ensureListState(idx){
  const k = String(idx);
  if(!mState.lists[k]) mState.lists[k]={seen:false,validated:false,lastResult:"",lastSeen:"",interval:1,due:todayStr()};
  return mState.lists[k];
}

/* ── SRS ── */
function pickNext(){
  const today = todayStr();
  let pool = [];
  for(let i=0;i<TOTAL_SEQ;i++){
    const s=mState.lists[String(i)];
    if(s?.seen && !s.validated && s.due<=today) pool.push(i);
  }
  if(!pool.length){
    for(let i=0;i<TOTAL_SEQ;i++){ if(!mState.lists[String(i)]?.seen) pool.push(i); }
  }
  if(!pool.length) return null;
  return pool[Math.floor(Math.random()*pool.length)];
}

/* ── Chrono ── */
let chronoInterval = null;
let chronoRem = 0;

function chronoStop(){
  if(chronoInterval){ clearInterval(chronoInterval); chronoInterval=null; }
  const el=$("#chrono"); if(el) el.className="chrono";
}
function chronoStart(){
  chronoStop();
  const el = $("#chrono"); if(!el) return;
  if(!settings.chronoEnabled){ el.textContent=""; return; }
  chronoRem = settings.chronoDur*60;
  el.textContent = chronoFmt(chronoRem);
  el.className = "chrono running";
  chronoInterval = setInterval(()=>{
    chronoRem = Math.max(0, chronoRem-1);
    el.textContent = chronoFmt(chronoRem);
    if(chronoRem===0){
      el.className="chrono expired";
      chronoStop();
      if(!mSolutionsShown) mShowSolutions();
    }
  },1000);
}
function chronoFmt(s){ return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0"); }

/* ── Stats ── */
function computeStats(){
  if(!mState) return;
  let seen=0, val=0;
  for(let i=0;i<TOTAL_SEQ;i++){
    const s=mState.lists[String(i)];
    if(s?.seen) seen++;
    if(s?.validated) val++;
  }
  const row = $("#m-prog-row"); if(!row) return;
  const sp=Math.round(seen/TOTAL_SEQ*100), vp=Math.round(val/TOTAL_SEQ*100);
  row.innerHTML=`
    <div class="prog"><label><span>Listes vues</span><span>${seen}/${TOTAL_SEQ}</span></label><div class="prog-bar"><div class="prog-fill" style="width:${sp}%"></div></div></div>
    <div class="prog"><label><span>Listes validées</span><span>${val}/${TOTAL_SEQ}</span></label><div class="prog-bar"><div class="prog-fill" style="width:${vp}%"></div></div></div>`;
}

/* ── Rendu ── */
function renderBounds(){
  if(!seq) return;
  const ea=E[seq.startIdx]?.split(",")[0]||C[seq.startIdx];
  const eb=E[seq.endIdx]?.split(",")[0]||C[seq.endIdx];
  const ba=$("#borne-a"), bb=$("#borne-b");
  if(ba){ ba.textContent=ea; ba.onclick=()=>openDef(C[seq.startIdx],ea); }
  if(bb){ bb.textContent=eb; bb.onclick=()=>openDef(C[seq.endIdx],eb); }
}

function renderSlots(){
  const list=$("#word-list"); if(!list) return;
  list.innerHTML="";
  for(let i=0;i<10;i++){
    const t=targets[i];
    const li=document.createElement("li");
    li.dataset.slot=i;
    li.className="slot";

    if(mFound.has(i)){
      li.classList.add(hintUsed[i]?"found-helped":"found","clickable");
      const word=E[t.eIdx]?.split(",")[0]||t.c;
      const btn=document.createElement("button");
      btn.style.cssText="background:none;border:none;font:inherit;color:inherit;font-weight:900;letter-spacing:.07em;cursor:pointer;padding:0;flex:1;text-align:left;";
      btn.textContent=word;
      btn.addEventListener("click",e=>{e.preventDefault();openDef(t.c,word);});
      li.appendChild(btn);
    } else if(mSolutionsShown){
      li.classList.add("revealed","clickable");
      const word=E[t.eIdx]?.split(",")[0]||t.c;
      li.textContent=word;
      li.addEventListener("click",()=>openDef(t.c,word));
    } else {
      // Indices
      if(hintMode[i]==="tirage"){
        li.textContent=t.c.split("").sort((a,b)=>a.localeCompare(b,"fr")).join("");
        li.style.cssText="font-style:italic;color:var(--muted);";
      } else if(hintMode[i]==="len"){
        li.textContent="·".repeat(t.c.length);
        li.style.cssText="color:var(--muted);letter-spacing:4px;";
      }
      // Boutons outils
      const tools=document.createElement("div");
      tools.className="slot-tools";
      if(settings.showAbc){
        const b=document.createElement("button"); b.className="tool-btn"; b.textContent="ABC";
        b.addEventListener("mousedown",e=>e.preventDefault());
        b.addEventListener("click",()=>{ mNoHelp=false; hintUsed[i]=true; hintMode[i]=(hintMode[i]==="tirage")?"none":"tirage"; renderSlots(); persistMethodsState().catch(()=>{}); });
        tools.appendChild(b);
      }
      if(settings.showDef){
        const b=document.createElement("button"); b.className="tool-btn"; b.textContent="📖";
        b.addEventListener("mousedown",e=>e.preventDefault());
        b.addEventListener("click",()=>{ mNoHelp=false; hintUsed[i]=true; openDef(t.c,""); });
        tools.appendChild(b);
      }
      if(settings.showLen){
        const b=document.createElement("button"); b.className="tool-btn"; b.textContent="123";
        b.addEventListener("mousedown",e=>e.preventDefault());
        b.addEventListener("click",()=>{ mNoHelp=false; hintUsed[i]=true; hintMode[i]=(hintMode[i]==="len")?"none":"len"; renderSlots(); persistMethodsState().catch(()=>{}); });
        tools.appendChild(b);
      }
      if(tools.children.length) li.appendChild(tools);
    }
    list.appendChild(li);
  }
}

function setMethodsMsg(t,c){
  const m=$("#m-msg"); if(m){m.textContent=t;m.className="msg"+(c?" "+c:"");}
  if(mKb) mKb.setMsg(t,c);
}

function updateSolutionsBtn(){
  const s=mSolutionsShown;
  [$("#btn-solutions"),$("#btn-solutions-kb")].forEach(b=>{
    if(!b) return;
    b.textContent=s?"Jouer":"Solutions";
    b.classList.toggle("btn-danger",!s);
    b.classList.toggle("btn-primary",s);
  });
}

/* ── Jeu ── */
function buildTargets(s){
  targets=[];
  for(let i=1;i<=10;i++){
    const eIdx=s.startIdx+i;
    targets.push({c:C[eIdx], eIdx, f:F[eIdx]||""});
  }
}

function mValidateWord(raw){
  if(mSolutionsShown) return;
  const n=norm(raw); if(!n) return;
  const matched=[];
  targets.forEach((t,i)=>{ if(!mFound.has(i)&&norm(t.c)===n) matched.push(i); });
  if(!matched.length){
    setMethodsMsg(DICT.has(n)?"Hors-jeu.":"Mot inconnu.", DICT.has(n)?"warn":"err");
    return;
  }
  matched.forEach(i=>mFound.add(i));
  setMethodsMsg("");
  const c=$("#compteur"); if(c) c.textContent=mFound.size+"/10";
  renderSlots();
  if(mFound.size===10) mFinalizeList(mNoHelp);
  else persistMethodsState().catch(()=>{});
}

function mShowSolutions(){
  chronoStop();
  mSolutionsShown=true;
  targets.forEach((_,i)=>{ if(!mFound.has(i)) mFound.add(i); });
  renderSlots();
  const c=$("#compteur"); if(c) c.textContent="10/10";
  mFinalizeList(false);
}

function mFinalizeList(ok){
  chronoStop();
  mSolutionsShown=true;
  updateSolutionsBtn();
  const s=ensureListState(seq.seqIndex);
  s.seen=true; s.lastSeen=todayStr();
  if(ok){
    s.validated=true; s.lastResult="ok";
    s.interval=nextInterval(s.interval||1); s.due=addDays(todayStr(),s.interval);
    setMethodsMsg("Validée sans aide ✓","ok");
  } else {
    s.validated=false; s.lastResult="help";
    s.interval=3; s.due=addDays(todayStr(),3);
    setMethodsMsg("Session terminée.","warn");
  }
  computeStats();
  persistMethodsState().catch(()=>{});
}

function methodsReplay(){
  const idx=pickNext();
  if(idx===null){ setMethodsMsg("Toutes les listes sont à jour !","ok"); return; }
  startMethodsGame(idx);
}

function startMethodsGame(idx){
  seq={...sequences[idx], seqIndex:idx};
  mFound=new Set(); hintMode=Array(10).fill("none"); hintUsed=Array(10).fill(false);
  mNoHelp=true; mSolutionsShown=false;
  buildTargets(seq);
  renderBounds(); renderSlots();
  const c=$("#compteur"); if(c) c.textContent="0/10";
  updateSolutionsBtn(); computeStats(); chronoStart();
  setMethodsMsg("");
  setTimeout(()=>{ if(window.matchMedia("(pointer:fine)").matches) $("#saisie")?.focus(); },80);
}

/* ── Init (une seule fois) ── */
function initMethods(){
  if(mInited){ computeStats(); methodsReplay(); return; }
  mInited=true;

  if(DICT.size===0) DICT = D.length>0 ? new Set(D) : new Set(C.map(w=>norm(w)));

  mKb = wireKeyboard("m-kb","m-kb-disp","m-kb-msg", w=>{ mValidateWord(w); });

  $("#saisie")?.addEventListener("keydown", e=>{
    if(e.key==="Enter"&&!e.isComposing){
      e.preventDefault();
      mValidateWord(e.target.value);
      e.target.value="";
    }
  });

  const onSol=()=>{ mSolutionsShown ? methodsReplay() : mShowSolutions(); };
  $("#btn-solutions")?.addEventListener("click", onSol);
  $("#btn-solutions-kb")?.addEventListener("click", onSol);

  computeStats();
  methodsReplay();
}

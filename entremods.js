"use strict";
/* ══════════════════════════════════════════
   ENTREMODS.JS
   Trouver les mots d'une longueur donnée entre deux bornes.
   Listes créées par l'utilisateur (critères: longueur + cluster max).
══════════════════════════════════════════ */

/* ── Données ── */
function emC(){ return window.SEQODS_DATA?.c||[]; }
function emE(){ return window.SEQODS_DATA?.e||[]; }
function emF(){ return window.SEQODS_DATA?.f||[]; }
function emDict(){
  const d=window.SEQODS_DATA?.d;
  return d ? new Set(d) : new Set(emC().map(w=>norm(w)));
}

/* ── Génération de sessions ── */
function emGenerateSessions(minLen, maxLen, maxCluster){
  const C=emC();
  const sessions=[];
  let i=0;
  while(i<C.length){
    if(C[i].length>=minLen && C[i].length<=maxLen){
      let j=i;
      while(j+1<C.length && C[j+1].length>=minLen && C[j+1].length<=maxLen) j++;
      let k=i;
      while(k<=j){
        const end=Math.min(k+maxCluster-1,j);
        const lowerIdx=k-1, upperIdx=end+1;
        if(lowerIdx>=0 && upperIdx<C.length){
          const targetIdxs=[];
          for(let t=k;t<=end;t++) targetIdxs.push(t);
          sessions.push({lowerIdx,targetIdxs,upperIdx});
        }
        k=end+1;
      }
      i=j+1;
    } else { i++; }
  }
  return sessions;
}

/* ── State ── */
const LS_EM=()=>"ENTREMODS_STATE_"+(currentUser?.pseudo||"guest");
let emState=null;

function emDefaultState(){ return {updatedAt:0,lists:{}}; }
function emLoadLocal(){ try{ return JSON.parse(localStorage.getItem(LS_EM())||"null")||emDefaultState(); }catch{ return emDefaultState(); } }
function emSaveLocal(){ try{ localStorage.setItem(LS_EM(),JSON.stringify(emState)); }catch{} }

async function loadEntreModsState(){
  emState=emLoadLocal();
  if(!currentUser) return;
  const r=await fbGet("emstates",currentUser.pseudo.toLowerCase());
  if(r.ok&&r.data&&(r.data.updatedAt||0)>(emState.updatedAt||0)) emState=r.data;
  emSaveLocal();
}
async function persistEntreModsState(){
  if(!currentUser) return;
  emState.updatedAt=Date.now();
  emSaveLocal();
  await fbSet("emstates",currentUser.pseudo.toLowerCase(),emState);
}

/* ── Gestion des listes ── */
function emGetLists(){
  return Object.values(emState?.lists||{}).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
}
function emListName(minLen,maxLen,maxCluster){
  const l=minLen===maxLen?minLen+" L":minLen+"-"+maxLen+" L";
  return l+" · max "+maxCluster;
}
function emCreateList(minLen,maxLen,maxCluster){
  const id="em_"+Date.now();
  const list={id,name:emListName(minLen,maxLen,maxCluster),minLen,maxLen,maxCluster,createdAt:Date.now(),sessions:{}};
  emState.lists[id]=list;
  persistEntreModsState().catch(()=>{});
  return list;
}
function emDeleteList(id){
  delete emState.lists[id];
  persistEntreModsState().catch(()=>{});
}

/* ── SRS par session ── */
function emSessionState(listId,idx){
  const list=emState.lists[listId]; if(!list) return null;
  const k=String(idx);
  if(!list.sessions[k]) list.sessions[k]={seen:false,validated:false,lastResult:"",lastSeen:"",interval:1,due:todayStr()};
  const s=list.sessions[k];
  if(!s.due) s.due=todayStr();
  if(!s.interval) s.interval=1;
  return s;
}
function emPickNext(listId){
  const list=emState.lists[listId]; if(!list) return null;
  const sessions=emGenerateSessions(list.minLen,list.maxLen,list.maxCluster);
  const today=todayStr();
  let pool=[];
  for(let i=0;i<sessions.length;i++){ if(!list.sessions[String(i)]?.seen) pool.push(i); }
  if(!pool.length){
    for(let i=0;i<sessions.length;i++){
      const s=list.sessions[String(i)];
      if(s?.seen&&!s.validated&&s.due<=today) pool.push(i);
    }
  }
  if(!pool.length){
    for(let i=0;i<sessions.length;i++){
      const s=list.sessions[String(i)];
      if(s?.seen&&!s.validated) pool.push(i);
    }
  }
  if(!pool.length) return null;
  return pool[Math.floor(Math.random()*pool.length)];
}

/* ── État du jeu courant ── */
let emCurrentListId=null;
let emCurrentSessions=[];
let emSessionIdx=0;
let emFound=new Set();
let emHintMode=[];
let emHintUsed=[];
let emNoHelp=true;
let emPhase="DONE";
let emKb=null;
let emInited=false;

function emCurrentSession(){ return emCurrentSessions[emSessionIdx]||null; }

/* ── Chrono ── */
let emChronoInterval=null;
let emChronoRem=0;

function emChronoStop(){
  if(emChronoInterval){ clearInterval(emChronoInterval); emChronoInterval=null; }
}
function emChronoStart(){
  emChronoStop();
  const el=document.getElementById("em-chrono"); if(!el) return;
  if(!settings.chronoEnabled){ el.textContent=""; el.className="chrono"; return; }
  emChronoRem=settings.chronoDur*60;
  el.textContent=chronoFmt(emChronoRem);
  el.className="chrono running";
  emChronoInterval=setInterval(()=>{
    emChronoRem=Math.max(0,emChronoRem-1);
    el.textContent=chronoFmt(emChronoRem);
    if(emChronoRem===0){
      el.className="chrono expired";
      emChronoStop();
      if(emPhase==="PLAYING") emShowSolutions();
    }
  },1000);
}
function emChronoReset(){
  emChronoStop();
  const el=document.getElementById("em-chrono"); if(!el) return;
  if(settings.chronoEnabled){ el.textContent=chronoFmt(settings.chronoDur*60); el.className="chrono"; }
  else { el.textContent=""; el.className="chrono"; }
}

/* ── Rendu ── */
function emRenderBounds(){
  const ba=document.getElementById("em-borne-a"), bb=document.getElementById("em-borne-b");
  const sess=emCurrentSession();
  if(!sess||emPhase==="WAITING"){
    if(ba){ ba.textContent="—"; ba.onclick=null; }
    if(bb){ bb.textContent="—"; bb.onclick=null; }
    return;
  }
  const C=emC(), E=emE();
  const ea=E[sess.lowerIdx]||C[sess.lowerIdx];
  const eb=E[sess.upperIdx]||C[sess.upperIdx];
  if(ba){ ba.textContent=ea; ba.onclick=()=>openDef(C[sess.lowerIdx],ea); }
  if(bb){ bb.textContent=eb; bb.onclick=()=>openDef(C[sess.upperIdx],eb); }
}

function emRenderSlots(){
  const list=document.getElementById("em-word-list"); if(!list) return;
  const sess=emCurrentSession();
  list.innerHTML="";
  if(!sess) return;
  const C=emC(), E=emE(), F=emF();
  const n=sess.targetIdxs.length;
  for(let i=0;i<n;i++){
    const tIdx=sess.targetIdxs[i];
    const canon=C[tIdx];
    const word=E[tIdx]||canon;
    const li=document.createElement("li");
    li.dataset.slot=i;
    li.className="slot"+(canon.length<10?" slot-short":"");
    if(emFound.has(i)){
      li.classList.add(emHintUsed[i]?"found-helped":"found","clickable");
      const btn=document.createElement("button");
      btn.style.cssText="background:none;border:none;font:inherit;color:inherit;font-weight:900;letter-spacing:.07em;cursor:pointer;padding:0;flex:1;text-align:left;";
      btn.textContent=word;
      btn.addEventListener("click",e=>{ e.preventDefault(); openDef(canon,word); });
      li.appendChild(btn);
    } else if(emPhase==="DONE"){
      li.classList.add("revealed","clickable");
      li.textContent=word;
      li.addEventListener("click",()=>openDef(canon,word));
    } else {
      if(emHintMode[i]==="tirage"){
        li.textContent=canon.split("").sort((a,b)=>a.localeCompare(b,"fr")).join("");
        li.style.cssText="font-style:italic;color:var(--muted);";
      } else if(emHintMode[i]==="len"){
        li.textContent=canon.length+" lettres";
        li.style.cssText="color:var(--muted);font-style:italic;";
      }
      if(emPhase==="PLAYING"){
        const tools=document.createElement("div"); tools.className="slot-tools";
        if(settings.showAbc){
          const b=document.createElement("button"); b.className="tool-btn"; b.textContent="ABC";
          b.addEventListener("mousedown",e=>e.preventDefault());
          b.addEventListener("click",()=>{ emNoHelp=false; emHintUsed[i]=true; emHintMode[i]=(emHintMode[i]==="tirage")?"none":"tirage"; emRenderSlots(); emRefocus(); });
          tools.appendChild(b);
        }
        if(settings.showDef){
          const b=document.createElement("button"); b.className="tool-btn"; b.textContent="📖";
          b.addEventListener("mousedown",e=>e.preventDefault());
          b.addEventListener("click",()=>{ emNoHelp=false; emHintUsed[i]=true; const raw=(F[tIdx]||"").replace(/^(?:ou\s+)?\[[^\]]*\]\s*/i,"").trim(); openDefSimple(raw||canon); emRefocus(); });
          tools.appendChild(b);
        }
        if(settings.showLen){
          const b=document.createElement("button"); b.className="tool-btn"; b.textContent="123";
          b.addEventListener("mousedown",e=>e.preventDefault());
          b.addEventListener("click",()=>{ emNoHelp=false; emHintUsed[i]=true; emHintMode[i]=(emHintMode[i]==="len")?"none":"len"; emRenderSlots(); emRefocus(); });
          tools.appendChild(b);
        }
        if(tools.children.length) li.appendChild(tools);
      }
    }
    list.appendChild(li);
  }
}

function emRefocus(){
  if(window.matchMedia("(pointer:fine)").matches) setTimeout(()=>document.getElementById("em-saisie")?.focus(),50);
}
function emSetMsg(t,c){
  const m=document.getElementById("em-msg"); if(m){ m.textContent=t; m.className="msg"+(c?" "+c:""); }
  if(emKb) emKb.setMsg(t,c);
}
function emUpdateBtn(){
  const isDone=emPhase==="DONE", isWaiting=emPhase==="WAITING";
  [document.getElementById("em-btn-solutions"),document.getElementById("em-btn-solutions-kb")].forEach(b=>{
    if(!b) return;
    if(isDone||isWaiting){ b.textContent="Jouer"; b.classList.remove("btn-danger"); b.classList.add("btn-primary"); }
    else { b.textContent="Solutions"; b.classList.add("btn-danger"); b.classList.remove("btn-primary"); }
  });
}
function emUpdateCounter(){
  const c=document.getElementById("em-compteur"), sess=emCurrentSession();
  if(c&&sess) c.textContent=emFound.size+"/"+sess.targetIdxs.length;
}

/* ── Flux de jeu ── */
function emPrepareGame(listId,sessionIdx){
  emCurrentListId=listId; emSessionIdx=sessionIdx;
  emFound=new Set();
  const n=emCurrentSession()?.targetIdxs.length||0;
  emHintMode=Array(n).fill("none"); emHintUsed=Array(n).fill(false);
  emNoHelp=true; emPhase="WAITING";
  emRenderBounds(); emRenderSlots(); emUpdateCounter(); emChronoReset(); emUpdateBtn();
  emSetMsg("Prêt — appuie sur Jouer pour commencer.","");
  setDictBtnVisible(true);
  const s=emSessionState(listId,sessionIdx);
  if(s){ s.seen=true; s.lastSeen=todayStr(); }
  persistEntreModsState().catch(()=>{});
}
function emLaunchGame(){
  emPhase="PLAYING"; emUpdateBtn(); emSetMsg("");
  emRenderBounds(); emChronoStart(); setDictBtnVisible(false);
  setTimeout(()=>{ if(window.matchMedia("(pointer:fine)").matches) document.getElementById("em-saisie")?.focus(); },80);
}
function emValidateWord(raw){
  const n=norm(raw); if(!n) return;
  if(emPhase==="WAITING") emLaunchGame();
  const sess=emCurrentSession();
  if(emPhase==="DONE"){
    emSetMsg(emDict().has(n)?n+" : mot valide ✓":"« "+raw+" » — mot inconnu.","ok");
    return;
  }
  if(!sess) return;
  const C=emC();
  const matched=[];
  sess.targetIdxs.forEach((tIdx,i)=>{ if(!emFound.has(i)&&norm(C[tIdx])===n) matched.push(i); });
  if(!matched.length){
    emSetMsg(emDict().has(n)?"Hors-jeu.":"« "+raw+" » — mot inconnu.",emDict().has(n)?"warn":"err");
    return;
  }
  matched.forEach(i=>emFound.add(i));
  emSetMsg(""); emUpdateCounter(); emRenderSlots();
  if(emFound.size===sess.targetIdxs.length) emFinalizeSession(emNoHelp);
  else persistEntreModsState().catch(()=>{});
}
function emShowSolutions(){
  emChronoStop(); emPhase="DONE";
  emRenderSlots(); emUpdateCounter(); emFinalizeSession(false);
}
function emFinalizeSession(ok){
  emChronoStop(); emPhase="DONE"; emUpdateBtn(); setDictBtnVisible(true);
  const s=emSessionState(emCurrentListId,emSessionIdx);
  if(s){
    s.seen=true; s.lastSeen=todayStr();
    if(ok){ s.validated=true; s.lastResult="ok"; s.interval=nextInterval(s.interval||1); s.due=addDays(todayStr(),s.interval); emSetMsg("Validée sans aide ✓","ok"); }
    else { s.validated=false; s.lastResult="help"; s.interval=3; s.due=addDays(todayStr(),3); emSetMsg("Session terminée.","warn"); }
  }
  persistEntreModsState().catch(()=>{});
}
function emReplay(){
  const idx=emPickNext(emCurrentListId);
  if(idx===null){ emSetMsg("100%","ok"); emUpdateBtn(); return; }
  emPrepareGame(emCurrentListId,idx);
}

/* ── Stats ── */
function emListProgress(listId){
  const list=emState?.lists[listId]; if(!list) return {seen:0,validated:0,total:0};
  const sessions=emGenerateSessions(list.minLen,list.maxLen,list.maxCluster);
  const total=sessions.length; let seen=0, validated=0;
  for(let i=0;i<total;i++){
    const s=list.sessions[String(i)];
    if(s?.seen) seen++;
    if(s?.validated) validated++;
  }
  return {seen,validated,total};
}

/* ── Navigation sous-vues ── */
function emShowView(id){
  ["ev-home","ev-create","ev-game"].forEach(v=>{
    const el=document.getElementById(v); if(el) el.classList.toggle("active",v===id);
  });
}

/* ── Accueil ── */
function emRenderHome(){
  emShowView("ev-home");
  const container=document.getElementById("em-lists"); if(!container) return;
  container.innerHTML="";
  const lists=emGetLists();
  if(!lists.length){
    const p=document.createElement("p");
    p.style.cssText="text-align:center;color:var(--muted);font-size:14px;padding:32px 16px;";
    p.textContent="Aucune liste. Crée ta première liste !";
    container.appendChild(p); return;
  }
  lists.forEach(list=>{
    const prog=emListProgress(list.id);
    const pct=prog.total?Math.round(prog.validated/prog.total*100):0;
    const card=document.createElement("div"); card.className="em-list-card";
    card.innerHTML=`<div class="em-list-info"><div class="em-list-name">${list.name}</div><div class="em-list-sub">${prog.total} sessions &middot; ${prog.validated}/${prog.total} valid&eacute;es &middot; ${pct}%</div><div class="em-prog-bar"><div class="em-prog-fill" style="width:${pct}%"></div></div></div><div class="em-list-actions"><button class="btn em-del-btn" data-id="${list.id}" title="Supprimer">🗑️</button><span class="tc-arr">&rsaquo;</span></div>`;
    card.querySelector(".em-del-btn").addEventListener("click",e=>{
      e.stopPropagation();
      if(confirm("Supprimer la liste « "+list.name+" » ?")){
        emDeleteList(list.id); emRenderHome();
      }
    });
    card.addEventListener("click",e=>{ if(e.target.closest(".em-del-btn")) return; emOpenList(list.id); });
    container.appendChild(card);
  });
}

function emOpenList(listId){
  emCurrentListId=listId;
  const list=emState.lists[listId];
  emCurrentSessions=emGenerateSessions(list.minLen,list.maxLen,list.maxCluster);
  const titleEl=document.getElementById("em-game-title");
  if(titleEl) titleEl.textContent=list.name;
  emShowView("ev-game");
  if(emKb) emKb.clear();
  emReplay();
}

/* ── Création ── */
function emShowCreate(){
  emShowView("ev-create");
  emUpdateCreatePreview();
}
function emGetCreateParams(){
  const minLen=Math.max(2,parseInt(document.getElementById("em-min-len")?.value)||7);
  const maxLen=Math.max(2,parseInt(document.getElementById("em-max-len")?.value)||7);
  const maxCluster=Math.min(5,Math.max(1,parseInt(document.getElementById("em-max-cluster")?.value)||2));
  return {minLen:Math.min(minLen,maxLen),maxLen:Math.max(minLen,maxLen),maxCluster};
}
function emUpdateCreatePreview(){
  const {minLen,maxLen,maxCluster}=emGetCreateParams();
  const count=emGenerateSessions(minLen,maxLen,maxCluster).length;
  const p=document.getElementById("em-create-preview");
  if(p) p.textContent=count?count+" sessions générées":"Aucune session pour ces critères.";
}

/* ── Init ── */
function ensureEntreModsInit(){
  if(!emInited) initEntremods();
  else emRenderHome();
}

function initEntremods(){
  if(emInited){ emRenderHome(); return; }
  emInited=true;

  emKb=wireKeyboard("em-kb","em-kb-disp","em-kb-msg",w=>emValidateWord(w));

  document.getElementById("em-saisie")?.addEventListener("keydown",e=>{
    if(e.key==="Enter"&&!e.isComposing){ e.preventDefault(); emValidateWord(e.target.value); e.target.value=""; }
  });

  const onSolBtn=()=>{
    if(emPhase==="PLAYING"){ emShowSolutions(); return; }
    if(emPhase==="DONE") emReplay();
    emLaunchGame();
  };
  document.getElementById("em-btn-solutions")?.addEventListener("click",onSolBtn);
  document.getElementById("em-btn-solutions-kb")?.addEventListener("click",onSolBtn);

  document.getElementById("em-btn-new")?.addEventListener("click",()=>emShowCreate());
  document.getElementById("em-btn-back-create")?.addEventListener("click",()=>emRenderHome());
  document.getElementById("em-btn-back-game")?.addEventListener("click",()=>{
    emChronoStop(); emRenderHome();
  });

  ["em-min-len","em-max-len","em-max-cluster"].forEach(id=>{
    document.getElementById(id)?.addEventListener("input",emUpdateCreatePreview);
  });

  document.getElementById("em-btn-create")?.addEventListener("click",()=>{
    const {minLen,maxLen,maxCluster}=emGetCreateParams();
    const count=emGenerateSessions(minLen,maxLen,maxCluster).length;
    if(!count){ alert("Aucune session possible avec ces critères."); return; }
    const list=emCreateList(minLen,maxLen,maxCluster);
    emOpenList(list.id);
  });

  emRenderHome();
}

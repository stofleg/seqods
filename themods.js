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
  const themes=["age","vi","oir","able","ique","gm"];
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

function renderHome(){showScreen("tm-screen-home");setTimeout(updateHomeStats,50);}

/* THEME SCREEN */
function playNext(theme){
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
  const title=$("#tm-game-title");
  const _sfx={age:"· · · AGE",vi:"",oir:"· · · OIR",able:"· · · ABLE",ique:"· · · IQUE",gm:""};
  if(title) title.textContent=currentSession.label+"— "+(_sfx[currentTheme]||"");
  // Nom de la thématique dans le sous-titre
  const _names={age:"Finale -AGE",vi:"Intransitifs",oir:"Finale -OIR",able:"Finale -ABLE",ique:"Finale -IQUE",gm:"Graphies multiples"};
  const themeName=document.getElementById("tm-theme-name");
  if(themeName) themeName.textContent=_names[currentTheme]||currentTheme;
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
      li.addEventListener("mousedown", e=>e.preventDefault());
      li.addEventListener("click", ()=>openDefForWord(word));
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
    if(li){li.classList.add("tm-found");li.textContent=currentSession.words[i];li.scrollIntoView({behavior:"smooth",block:"nearest"});}
  });
  setMsg("");
  updateCounter();
  if(found.size===currentSession.words.length) finalizeSession(noHelpRun);
}

function validateWordGM(n){
  const entries=currentSession.entries||[];
  // Chercher dans quel groupe ce mot apparaît
  let matchedGroup=-1;
  entries.forEach((entry,i)=>{
    if(!found.has(i) && entry.forms.some(f=>norm(f)===n)){
      matchedGroup=i;
    }
  });
  if(matchedGroup===-1){
    if(getDSet().has(n)){
      setMsg("Hors-jeu — mot valide mais pas dans cette liste.","warn");
    } else {
      setMsg("Mot inconnu — la partie s'arrête.","err");
      setTimeout(()=>showSolutions(), 800);
    }
    return;
  }
  // Ajouter à entryFound, vérifier si toutes les formes sont trouvées
  if(!entryFound.has(matchedGroup)){
    entryFound.add(n); // suivi des formes trouvées dans ce groupe
  }
  const entry=entries[matchedGroup];
  const allFound=entry.forms.every(f=>entryFound.has(norm(f)));
  if(allFound){
    found.add(matchedGroup);
    setMsg("Groupe complet ✓","ok");
  } else {
    const remaining=entry.forms.filter(f=>!entryFound.has(norm(f)));
    setMsg("Encore "+remaining.length+" forme"+(remaining.length>1?"s":"")+" à trouver pour ce groupe.","");
  }
  renderGameGM();
  const counter=$("#tm-total");
  if(counter) counter.textContent=found.size+" / "+entries.length+" groupe"+(entries.length>1?"s":"")+" trouvé"+(found.size>1?"s":"");
  if(found.size===entries.length) finalize(noHelpRun);
}


function showSolutions(){
  noHelpRun=false;
  currentSession.words.forEach((w,i)=>{
    if(!found.has(i)){
      found.add(i);
      const li=document.querySelector("#tm-word-list li[data-idx='"+i+"']");
      if(li){li.classList.add("tm-revealed");li.textContent=w;}
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

"use strict";
/* ══════════════════════════════════════════
   COMMON.JS — Code partagé entre METHODS et THEMODS
══════════════════════════════════════════ */

/* ── Sélecteur ── */
const $ = s => document.querySelector(s);

/* ── Firebase ── */
const FB_BASE    = "https://firestore.googleapis.com/v1/projects/methods-8e4b1/databases/(default)/documents";
const FB_STORAGE = "https://firebasestorage.googleapis.com/v0/b/methods-8e4b1.appspot.com/o";

async function fbStorageUpload(path, blob){
  const r = await fetch(`${FB_STORAGE}?uploadType=media&name=${encodeURIComponent(path)}`,
    {method:"POST", headers:{"Content-Type":"image/jpeg"}, body:blob});
  if(!r.ok) throw new Error("Storage " + r.status);
  const {downloadTokens} = await r.json();
  return `${FB_STORAGE}/${encodeURIComponent(path)}?alt=media&token=${downloadTokens}`;
}
async function fbStorageDelete(path){
  await fetch(`${FB_STORAGE}/${encodeURIComponent(path)}`, {method:"DELETE"}).catch(()=>{});
}

function _cv_to(val){
  if(val===null||val===undefined) return {nullValue:null};
  if(typeof val==="boolean") return {booleanValue:val};
  if(typeof val==="number") return Number.isInteger(val)?{integerValue:String(val)}:{doubleValue:val};
  if(typeof val==="string") return {stringValue:val};
  if(Array.isArray(val)) return {arrayValue:{values:val.map(_cv_to)}};
  if(typeof val==="object") return {mapValue:{fields:Object.fromEntries(Object.entries(val).map(([k,v])=>[k,_cv_to(v)]))}};
  return {stringValue:String(val)};
}
function _cv_from(val){
  if(val.nullValue!==undefined) return null;
  if(val.booleanValue!==undefined) return val.booleanValue;
  if(val.integerValue!==undefined) return parseInt(val.integerValue);
  if(val.doubleValue!==undefined) return val.doubleValue;
  if(val.stringValue!==undefined) return val.stringValue;
  if(val.arrayValue) return (val.arrayValue.values||[]).map(_cv_from);
  if(val.mapValue) return Object.fromEntries(Object.entries(val.mapValue.fields||{}).map(([k,v])=>[k,_cv_from(v)]));
  return null;
}
function toFs(obj){ return {fields:Object.fromEntries(Object.entries(obj).map(([k,v])=>[k,_cv_to(v)]))}; }
function fromFs(doc){ if(!doc?.fields) return null; return Object.fromEntries(Object.entries(doc.fields).map(([k,v])=>[k,_cv_from(v)])); }

async function fbGet(col, id){
  try{
    const r = await fetch(`${FB_BASE}/${col}/${id}`);
    if(r.status===404) return {ok:false, err:"not_found"};
    if(!r.ok) return {ok:false, err:"error"};
    return {ok:true, data:fromFs(await r.json())};
  }catch{ return {ok:false, err:"network"}; }
}
async function fbSet(col, id, obj){
  try{
    const r = await fetch(`${FB_BASE}/${col}/${id}`, {
      method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify(toFs(obj))
    });
    return r.ok ? {ok:true} : {ok:false, err:"error"};
  }catch{ return {ok:false, err:"network"}; }
}

/* ── Session utilisateur ── */
const LS_SESSION = "METHODS_SESSION_V1";
let currentUser = null;

function loadSession(){ try{ return JSON.parse(localStorage.getItem(LS_SESSION)||"null"); }catch{ return null; } }
function saveSession(u){ try{ localStorage.setItem(LS_SESSION, JSON.stringify(u)); }catch{} }
function clearSession(){ try{ localStorage.removeItem(LS_SESSION); }catch{} currentUser=null; }

/* ── Auth ── */
async function sha256(str){
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
function randomToken(){
  return Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function authLogin(pseudo, pass){
  const p = pseudo.trim().toLowerCase();
  if(!p || !pass) return {ok:false, err:"Remplis tous les champs."};
  const r = await fbGet("users", p);
  if(!r.ok) return {ok:false, err:"Pseudo introuvable."};
  const hash = await sha256(pass + (r.data.salt||""));
  if(hash !== r.data.hash) return {ok:false, err:"Mot de passe incorrect."};
  const token = randomToken();
  await fbSet("users", p, {...r.data, token, lastLogin:new Date().toISOString()});
  return {ok:true, pseudo:p, token};
}
async function authRegister(pseudo, pass, pass2, secretQ, secretA){
  const p = pseudo.trim().toLowerCase();
  if(!p||!pass) return {ok:false, err:"Remplis tous les champs."};
  if(pass !== pass2) return {ok:false, err:"Les mots de passe ne correspondent pas."};
  if(!secretQ||!secretA?.trim()) return {ok:false, err:"Choisis une question secrète et saisis ta réponse."};
  if(p.length < 3) return {ok:false, err:"Pseudo trop court (3 caractères min)."};
  const exists = await fbGet("users", p);
  if(exists.ok) return {ok:false, err:"Pseudo déjà utilisé."};
  const salt = randomToken();
  const hash = await sha256(pass + salt);
  const secretASalt = randomToken();
  const secretAHash = await sha256(secretA.trim().toLowerCase() + secretASalt);
  const token = randomToken();
  await fbSet("users", p, {hash, salt, token, secretQ, secretAHash, secretASalt, createdAt:new Date().toISOString()});
  return {ok:true, pseudo:p, token};
}
async function authGetQuestion(pseudo){
  const p = pseudo.trim().toLowerCase();
  if(!p) return {ok:false, err:"Saisis ton pseudo."};
  const r = await fbGet("users", p);
  if(!r.ok) return {ok:false, err:"Pseudo introuvable."};
  if(!r.data.secretQ) return {ok:false, err:"Pas de question secrète enregistrée pour ce compte."};
  return {ok:true, question:r.data.secretQ};
}
async function authRecover(pseudo, answer, newPass){
  const p = pseudo.trim().toLowerCase();
  if(!p||!answer||!newPass) return {ok:false, err:"Remplis tous les champs."};
  const r = await fbGet("users", p);
  if(!r.ok) return {ok:false, err:"Pseudo introuvable."};
  if(!r.data.secretQ) return {ok:false, err:"Pas de question secrète. Contacte l'admin."};
  const ansHash = await sha256(answer.trim().toLowerCase() + (r.data.secretASalt||""));
  if(ansHash !== r.data.secretAHash) return {ok:false, err:"Réponse incorrecte."};
  const newHash = await sha256(newPass + (r.data.salt||""));
  const token = randomToken();
  await fbSet("users", p, {...r.data, hash:newHash, token});
  return {ok:true, pseudo:p, token};
}

/* ── Utilitaires ── */
function todayStr(){
  return new Intl.DateTimeFormat("fr-CA",{year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}
function addDays(ymd, n){
  const [y,m,d] = ymd.split("-").map(Number);
  const dt = new Date(y, m-1, d);
  dt.setDate(dt.getDate() + n);
  return new Intl.DateTimeFormat("fr-CA",{year:"numeric",month:"2-digit",day:"2-digit"}).format(dt);
}

function norm(w){
  if(!w) return "";
  return w.toUpperCase()
    .replace(/Œ/g,"OE").replace(/Æ/g,"AE")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^A-Z]/g,"");
}

/* ── SRS ── */
const SRS_INTERVALS = [1,3,7,14,30,60,120];
function nextInterval(cur){
  const i = SRS_INTERVALS.indexOf(cur);
  return SRS_INTERVALS[Math.min(SRS_INTERVALS.length-1, i<0?0:i+1)];
}

/* ── Vue système ── */
// Une seule fonction pour afficher une vue — garantit qu'il n'y en a qu'une active
function showView(id){
  document.querySelectorAll(".view").forEach(v=>{
    v.classList.toggle("active", v.id===id);
  });
}

/* ── Modale définition ── */

/* ── Modale définition simple (indice 📖) ── */
function openDefSimple(defText){
  // Nettoyer la prononciation [xxx] en début
  let d = (defText||"").replace(/^(?:ou\s+)?\[[^\]]*\]\s*/i,"").trim();
  const tEl=$("#def-title"), bEl=$("#def-body"), mEl=$("#def-modal");
  if(!tEl||!bEl||!mEl) return;
  tEl.textContent="Définition";
  bEl.textContent=d||"(définition absente)";
  // Masquer les liens et sections extra
  const linksDiv=$("#def-links"); if(linksDiv) linksDiv.style.display="none";
  const anaEl=$("#def-ana"); if(anaEl) anaEl.innerHTML="";
  const rallEl=$("#def-rall"); if(rallEl) rallEl.innerHTML="";
  mEl.classList.add("open");
}

function openDef(canon, displayWord){
  const DATA = window.SEQODS_DATA;
  if(!DATA) return;
  const C=DATA.c, E=DATA.e, F=DATA.f, A=DATA.a, R=DATA.r;

  const idx = C.indexOf(canon);
  const title = (displayWord || (idx>=0 ? E[idx].split(",")[0].trim() : canon)).replace(/\*/g,"");
  const def = idx>=0 ? (F[idx]||"") : "";

  $("#def-title").textContent = title;
  $("#def-body").textContent = def || "(définition absente)";

  const raw = title.split(",")[0].trim().toLowerCase();
  $("#def-wikt").href = "https://fr.wiktionary.org/wiki/" + encodeURIComponent(raw);
  $("#def-img").href = "https://www.google.com/search?tbm=isch&q=" + encodeURIComponent(raw);
  $("#def-links").style.display = "flex";

  // Anagrammes
  const anaEl = $("#def-ana");
  if(A && anaEl){
    const tir = canon.split("").sort((a,b)=>a.localeCompare(b,"fr")).join("");
    const lst = (A[tir]||[]).filter(x=>norm(x)!==canon).slice(0,60);
    if(lst.length){ anaEl.innerHTML=`<strong>Anagrammes</strong><span>${lst.join(" • ")}</span>`; }
    else anaEl.innerHTML="";
  }

  // Rallonges
  const rallEl = $("#def-rall");
  if(R && rallEl){
    const lst = R[canon]||[];
    if(lst.length){ rallEl.innerHTML=`<strong>Rallonges</strong><span>${lst.join(" • ")}</span>`; }
    else rallEl.innerHTML="";
  }

  $("#def-modal").classList.add("open");
}

function closeDef(){
  $("#def-modal")?.classList.remove("open");
}

function wireDefModal(){
  $("#def-close")?.addEventListener("click", closeDef);
  $("#def-bd")?.addEventListener("click", closeDef);
  document.addEventListener("keydown", e=>{ if(e.key==="Escape") closeDef(); });
}

/* ── Clavier mobile générique ── */
function wireKeyboard(kbId, dispId, msgId, onKey){
  const kb = document.getElementById(kbId);
  if(!kb) return;
  let buf = "";
  const upd = () => { const d=document.getElementById(dispId); if(d) d.textContent=buf; };
  const setKbMsg = (t,c) => { const m=document.getElementById(msgId); if(m){m.textContent=t;m.className="kb-msg"+(c?" "+c:"");} };

  const press = k => {
    if(k==="CLR"){ buf=""; upd(); }
    else if(k==="DEL"){ buf=buf.slice(0,-1); upd(); }
    else if(k==="OK"){
      if(buf.trim()){ onKey(buf.trim()); buf=""; upd(); }
    } else { buf+=k; upd(); }
  };

  kb.addEventListener("mousedown", e=>{
    const key=e.target.closest(".kk"); if(!key) return;
    e.preventDefault(); press(key.dataset.k);
  });
  kb.addEventListener("touchstart", e=>{
    const key=e.target.closest(".kk"); if(!key) return;
    e.preventDefault(); press(key.dataset.k);
  }, {passive:false});
  kb.addEventListener("click", e=>{ if(e.target.closest(".kk")) e.preventDefault(); });

  return { setMsg: setKbMsg, clear: ()=>{ buf=""; upd(); } };
}

/* ── Dictionnaire modal ── */

function setDictBtnVisible(v){
  document.getElementById("btn-dict")?.classList.toggle("hidden", !v);
}

// Binary search: first index in sorted array C where C[i] >= prefix
function _dictBisect(C, prefix){
  let lo=0, hi=C.length;
  while(lo<hi){ const mid=(lo+hi)>>1; if(C[mid]<prefix) lo=mid+1; else hi=mid; }
  return lo;
}

function dictFindSuggestions(prefix, limit=12){
  const DATA=window.SEQODS_DATA; if(!DATA?.c) return [];
  const C=DATA.c;
  const start=_dictBisect(C, prefix);
  const results=[];
  for(let i=start; i<C.length && results.length<limit; i++){
    if(!C[i].startsWith(prefix)) break;
    results.push(i);
  }
  return results;
}

function dictUpdateLinks(displayWord){
  const raw=(displayWord||"").split(",")[0].trim().toLowerCase().replace(/\s+.*/,"");
  const w=document.getElementById("dict-wikt");
  const img=document.getElementById("dict-img");
  if(w) w.href = raw ? "https://fr.wiktionary.org/wiki/"+encodeURIComponent(raw) : "#";
  if(img) img.href = raw ? "https://www.google.com/search?tbm=isch&q="+encodeURIComponent(raw) : "#";
}

let _dictCurrentIdx = null;

function dictSelectIdx(idx){
  const DATA=window.SEQODS_DATA; if(!DATA) return;
  const C=DATA.c, E=DATA.e, F=DATA.f, R=DATA.r;
  _dictCurrentIdx = idx;
  // Update input to show the normalized canonical (so further typing refines)
  const inp=document.getElementById("dict-input");
  if(inp){ inp.value=C[idx]; inp.selectionStart=inp.selectionEnd=C[idx].length; }
  // Clear suggestions
  document.getElementById("dict-sugg").innerHTML="";
  // Show result
  const display=E[idx]||C[idx];
  document.getElementById("dict-word").textContent=display;
  document.getElementById("dict-def").textContent=(F[idx]||"").replace(/^(?:ou\s+)?\[[^\]]*\]\s*/i,"").trim()||"(définition absente)";
  const lst=R?.[C[idx]]||[];
  const rallEl=document.getElementById("dict-rall");
  rallEl.innerHTML=lst.length?`<strong>Rallonges</strong><span>${lst.join(" • ")}</span>`:"";
  document.getElementById("dict-result").style.display="";
  dictUpdateLinks(display);
}

function _dictRenderSugg(prefix){
  const sugg=document.getElementById("dict-sugg"); if(!sugg) return;
  sugg.innerHTML="";
  if(!prefix){ return; }
  const DATA=window.SEQODS_DATA; if(!DATA?.c) return;
  const idxs=dictFindSuggestions(prefix);
  if(!idxs.length){
    const li=document.createElement("li"); li.className="dict-no-result";
    li.textContent="Mot inconnu."; sugg.appendChild(li); return;
  }
  idxs.forEach(i=>{
    const li=document.createElement("li");
    li.textContent=DATA.e[i]||DATA.c[i];
    li.addEventListener("click",()=>dictSelectIdx(i));
    sugg.appendChild(li);
  });
}

function openDictModal(){
  const m=document.getElementById("dict-modal"); if(!m) return;
  m.classList.add("open");
  _dictCurrentIdx=null;
  const inp=document.getElementById("dict-input");
  if(inp){ inp.value=""; }
  document.getElementById("dict-sugg").innerHTML="";
  document.getElementById("dict-result").style.display="none";
  dictUpdateLinks("");
  // Focus input after transition (slight delay for iOS)
  setTimeout(()=>inp?.focus(), 80);
}

function closeDictModal(){
  document.getElementById("dict-modal")?.classList.remove("open");
}

function wireDictModal(){
  document.getElementById("btn-dict")?.addEventListener("click", openDictModal);
  document.getElementById("dict-close")?.addEventListener("click", closeDictModal);
  document.getElementById("dict-bd")?.addEventListener("click", closeDictModal);

  const inp=document.getElementById("dict-input");
  if(inp){
    inp.addEventListener("input", e=>{
      const v=norm(e.target.value);
      _dictCurrentIdx=null;
      document.getElementById("dict-result").style.display="none";
      dictUpdateLinks(e.target.value);
      _dictRenderSugg(v);
    });
    inp.addEventListener("keydown", e=>{
      if(e.key==="Escape"){ closeDictModal(); return; }
      if(e.key==="Enter"){
        const v=norm(inp.value); if(!v) return;
        const DATA=window.SEQODS_DATA; if(!DATA?.c) return;
        // Exact match first
        const exact=DATA.c.indexOf(v);
        if(exact>=0){ dictSelectIdx(exact); return; }
        // First suggestion
        const first=document.querySelector("#dict-sugg li:not(.dict-no-result)");
        if(first) first.click();
      }
    });
  }
  // Escape anywhere
  document.addEventListener("keydown", e=>{
    if(e.key==="Escape") closeDictModal();
  });
}

/* ── Auth UI ── */
function wireAuthUI(onSuccess){
  // Onglets
  document.querySelectorAll(".auth-tab").forEach(tab=>{
    tab.addEventListener("click", ()=>{
      document.querySelectorAll(".auth-tab").forEach(t=>t.classList.remove("active"));
      tab.classList.add("active");
      ["login","register","recover"].forEach(name=>{
        const f=document.getElementById("f-"+name);
        if(f) f.style.display = (name===tab.dataset.tab) ? "flex" : "none";
      });
      $("#auth-err").textContent="";
    });
  });

  const setErr = (msg, ok=false) => {
    const el=$("#auth-err"); if(el){el.textContent=msg; el.className="msg"+(ok?" ok":" err");}
  };
  const setLoading = on => {
    ["btn-login","btn-register","btn-recover"].forEach(id=>{
      const b=document.getElementById(id); if(b) b.disabled=on;
    });
  };

  $("#btn-login")?.addEventListener("click", async()=>{
    const p=$("#login-pseudo")?.value||"", pw=$("#login-pass")?.value||"";
    setLoading(true); setErr("");
    const r = await authLogin(p, pw);
    setLoading(false);
    if(!r.ok){ setErr(r.err); return; }
    onSuccess(r.pseudo, r.token);
  });

  $("#btn-register")?.addEventListener("click", async()=>{
    const p=$("#reg-pseudo")?.value||"";
    const pw=$("#reg-pass")?.value||"", pw2=$("#reg-pass2")?.value||"";
    const secretQ=$("#reg-question")?.value||"", secretA=$("#reg-answer")?.value||"";
    setLoading(true); setErr("");
    const r = await authRegister(p, pw, pw2, secretQ, secretA);
    setLoading(false);
    if(!r.ok){ setErr(r.err); return; }
    onSuccess(r.pseudo, r.token);
  });

  $("#btn-find-question")?.addEventListener("click", async()=>{
    const p=$("#rec-pseudo")?.value||"";
    setLoading(true); setErr("");
    const r = await authGetQuestion(p);
    setLoading(false);
    if(!r.ok){ setErr(r.err); return; }
    const qDiv=$("#rec-question-display");
    if(qDiv){qDiv.textContent=r.question;qDiv.style.display="";}
    ["rec-answer","rec-new","btn-recover"].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display=""; });
  });

  $("#btn-recover")?.addEventListener("click", async()=>{
    const p=$("#rec-pseudo")?.value||"";
    const ans=$("#rec-answer")?.value||"", np=$("#rec-new")?.value||"";
    setLoading(true); setErr("");
    const r = await authRecover(p, ans, np);
    setLoading(false);
    if(!r.ok){ setErr(r.err); return; }
    setErr("Mot de passe changé. Reconnecte-toi.", true);
  });

  // Enter pour valider
  [["login-pass","btn-login"],["reg-answer","btn-register"],["rec-new","btn-recover"]].forEach(([inp,btn])=>{
    document.getElementById(inp)?.addEventListener("keydown", e=>{
      if(e.key==="Enter") document.getElementById(btn)?.click();
    });
  });
}

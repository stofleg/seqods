(function(){
"use strict";
const $ = (s)=>document.querySelector(s);

/* ===========================
   CONFIG DROPBOX
=========================== */
const DROPBOX_APP_KEY = "5r5cxyemzt778me";
const DROPBOX_STATE_PATH = "/state.json";
const DROPBOX_ARCHIVE_DIR = "/cartes_vues";

const LS_TOKENS = "SEQODS_DBX_TOKENS_V7";
const LS_PKCE   = "SEQODS_DBX_PKCE_V6";
const STORE_LOCAL = "SEQODS_LOCAL_STATE_V7";

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
  el.textContent = t || "";
  el.className = cls ? "msg " + cls : "msg";
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
  return {
    updatedAt: 0,
    dbxRev: null,
    lists: {},
    archiveNext: 1,
    archiveBySeq: {},
    currentRun: null
  };
}
function mergeDefaults(obj){
  const base = defaultState();
  if(!obj || typeof obj !== "object") return base;

  const out = Object.assign(base, obj);
  out.lists = Object.assign({}, base.lists, obj.lists || {});
  out.archiveBySeq = Object.assign({}, base.archiveBySeq, obj.archiveBySeq || {});
  if(typeof out.archiveNext !== "number" || !Number.isFinite(out.archiveNext) || out.archiveNext < 1){
    out.archiveNext = 1;
  }
  if(!out.currentRun || typeof out.currentRun !== "object"){
    out.currentRun = null;
  }
  return out;
}
function loadLocal(){
  try{
    return mergeDefaults(JSON.parse(localStorage.getItem(STORE_LOCAL)||"null"));
  }catch{
    return defaultState();
  }
}
function saveLocal(st){
  try{ localStorage.setItem(STORE_LOCAL, JSON.stringify(st)); }catch{}
}

/* ===========================
   SETTINGS
=========================== */
const SETTINGS_KEY = "SEQODS_SETTINGS_V1";
const SETTINGS_DEFAULT = {
  quotaNew: 3,
  quotaReview: 3,
  chronoEnabled: false,
  chronoMode: "up",
  chronoSeconds: 180
};
function loadSettings(){
  try{ return Object.assign({}, SETTINGS_DEFAULT, JSON.parse(localStorage.getItem(SETTINGS_KEY)||"null")); }
  catch{ return Object.assign({}, SETTINGS_DEFAULT); }
}
function saveSettings(s){
  try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }catch{}
}
let settings = loadSettings();

/* ===========================
   LISTE STATE
=========================== */
function ensureListState(st, seqIndex){
  const k=String(seqIndex);
  if(!st.lists[k]){
    st.lists[k] = {
      seen: false,
      validated: false,
      lastResult: "",
      lastSeen: ""
    };
  }
  return st.lists[k];
}

/* ===========================
   SESSION QUOTA
=========================== */
let sessionProgress = { newDone: 0, reviewDone: 0, beyondQuota: false };

function resetSessionProgress(){
  sessionProgress = { newDone: 0, reviewDone: 0, beyondQuota: false };
  updateSessionChip();
}

function updateSessionChip(){
  const el = $("#sessionChip");
  if(!el) return;
  if(sessionProgress.beyondQuota){
    el.textContent = "Session libre";
    return;
  }
  const qN = settings.quotaNew;
  const qR = settings.quotaReview;
  const dN = Math.min(sessionProgress.newDone, qN);
  const dR = Math.min(sessionProgress.reviewDone, qR);
  el.textContent = `Nouv. ${dN}/${qN} \u00b7 Rev. ${dR}/${qR}`;
}

/* ===========================
   CHRONO
=========================== */
let chronoInterval = null;
let chronoElapsed = 0;   // secondes ecoulees (mode up) ou restantes (mode down)
let chronoExpired = false;

function chronoFormat(s){
  const m = Math.floor(Math.abs(s) / 60);
  const sec = Math.abs(s) % 60;
  const sign = s < 0 ? "-" : "";
  return sign + String(m).padStart(2,"0") + ":" + String(sec).padStart(2,"0");
}

function chronoUpdate(){
  const el = $("#chronoDisplay");
  if(!el) return;
  if(settings.chronoMode === "down"){
    const remaining = settings.chronoSeconds - chronoElapsed;
    el.textContent = chronoFormat(Math.max(remaining, 0));
    if(remaining <= 0 && !chronoExpired){
      chronoExpired = true;
      el.classList.add("chronoExpired");
    }
  } else {
    el.textContent = chronoFormat(chronoElapsed);
  }
}

function chronoStart(){
  chronoStop();
  chronoElapsed = 0;
  chronoExpired = false;
  const el = $("#chronoDisplay");
  if(el) el.classList.remove("chronoExpired");
  chronoUpdate();
  if(!settings.chronoEnabled) return;
  chronoInterval = setInterval(()=>{
    chronoElapsed++;
    chronoUpdate();
  }, 1000);
}

function chronoStop(){
  if(chronoInterval){ clearInterval(chronoInterval); chronoInterval = null; }
}

function chronoRender(){
  const wrap = $("#chronoWrap");
  if(!wrap) return;
  if(settings.chronoEnabled){
    wrap.style.display = "flex";
  } else {
    wrap.style.display = "none";
    chronoStop();
  }
}


/* ===========================
   DROPBOX TOKENS
=========================== */
function saveTokens(t){ try{ localStorage.setItem(LS_TOKENS, JSON.stringify(t)); }catch{} }
function loadTokens(){ try{ return JSON.parse(localStorage.getItem(LS_TOKENS)||"null"); }catch{ return null; } }
function hasValidAccessToken(t){
  return t && t.access_token && t.expires_at && Date.now() < (t.expires_at - 30000);
}

/* ===========================
   PKCE
=========================== */
function base64urlFromBytes(bytes){
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function randomVerifier(len=64){
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return base64urlFromBytes(arr);
}
function sha256Sync(ascii){
  function rightRotate(v, a){ return (v>>>a) | (v<<(32-a)); }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);

  const words = [];
  const bitLen = ascii.length * 8;

  const hash = sha256Sync.h = sha256Sync.h || [];
  const k = sha256Sync.k = sha256Sync.k || [];
  let pc = k.length;

  const isComp = {};
  for (let c = 2; pc < 64; c++) {
    if (!isComp[c]) {
      for (let i = 0; i < 313; i += c) isComp[i] = c;
      hash[pc] = (mathPow(c, .5) * maxWord) | 0;
      k[pc++]  = (mathPow(c, 1/3) * maxWord) | 0;
    }
  }

  ascii += "\x80";
  while (ascii.length % 64 - 56) ascii += "\x00";
  for (let i = 0; i < ascii.length; i++) {
    const j = ascii.charCodeAt(i);
    words[i>>2] |= j << ((3 - i) % 4) * 8;
  }
  words[words.length] = (bitLen / maxWord) | 0;
  words[words.length] = (bitLen) | 0;

  for (let j = 0; j < words.length; ) {
    const w = words.slice(j, j += 16);
    const old = hash.slice(0);

    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15], w2 = w[i - 2];
      const a = hash[0], e = hash[4];

      const t1 = (hash[7]
        + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
        + ((e & hash[5]) ^ ((~e) & hash[6]))
        + k[i]
        + (w[i] = (i < 16) ? w[i] : (
            w[i - 16]
            + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
            + w[i - 7]
            + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
          ) | 0)
      ) | 0;

      const t2 = ((rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
        + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]))
      ) | 0;

      hash.unshift((t1 + t2) | 0);
      hash[4] = (hash[4] + t1) | 0;
      hash.pop();
    }

    for (let i = 0; i < 8; i++) hash[i] = (hash[i] + old[i]) | 0;
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++){
    out[i*4+0] = (hash[i] >>> 24) & 0xff;
    out[i*4+1] = (hash[i] >>> 16) & 0xff;
    out[i*4+2] = (hash[i] >>> 8) & 0xff;
    out[i*4+3] = (hash[i] >>> 0) & 0xff;
  }
  return out;
}
function codeChallengeFromVerifier(verifier){
  return base64urlFromBytes(sha256Sync(verifier));
}

/* ===========================
   PKCE STORE
=========================== */
function pkceSave(payload){
  try{ window.name = "SEQODS_PKCE::" + JSON.stringify(payload); }catch{}
  try{ localStorage.setItem(LS_PKCE, JSON.stringify(payload)); }catch{}
}
function pkceLoad(){
  try{
    if(typeof window.name === "string" && window.name.startsWith("SEQODS_PKCE::")){
      return JSON.parse(window.name.slice("SEQODS_PKCE::".length));
    }
  }catch{}
  try{ return JSON.parse(localStorage.getItem(LS_PKCE)||"null"); }catch{ return null; }
}
function pkceClear(){
  try{ if(typeof window.name==="string" && window.name.startsWith("SEQODS_PKCE::")) window.name=""; }catch{}
  try{ localStorage.removeItem(LS_PKCE); }catch{}
}

/* ===========================
   OAUTH
=========================== */
function oauthStart(){
  const redirectUri = currentRedirectUri();
  const verifier = randomVerifier(64);
  const challenge = codeChallengeFromVerifier(verifier);

  pkceSave({ verifier, redirectUri, ts: Date.now() });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: DROPBOX_APP_KEY,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    token_access_type: "offline",
    scope: "files.content.read files.content.write"
  });

  window.location.href = "https://www.dropbox.com/oauth2/authorize?" + params.toString();
}

async function oauthHandleRedirectIfNeeded(){
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  if(!code) return false;

  const pk = pkceLoad();
  pkceClear();

  if(!pk || !pk.verifier || !pk.redirectUri){
    setMessage("Erreur OAuth Dropbox : PKCE introuvable après retour.", "err");
    return false;
  }

  const body = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    client_id: DROPBOX_APP_KEY,
    redirect_uri: pk.redirectUri,
    code_verifier: pk.verifier
  });

  const r = await fetch("https://api.dropboxapi.com/oauth2/token",{
    method:"POST",
    headers:{ "Content-Type":"application/x-www-form-urlencoded" },
    body: body.toString()
  });

  if(!r.ok){
    let details="";
    try{ details = await r.text(); }catch{}
    console.error("Dropbox /token error", r.status, details);
    setMessage("Erreur OAuth Dropbox : " + (details || ("HTTP "+r.status)), "err");
    return false;
  }

  const tok = await r.json();
  const expiresAt = Date.now() + (tok.expires_in ? tok.expires_in*1000 : 3600000);

  saveTokens({
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: expiresAt
  });

  url.searchParams.delete("code");
  url.searchParams.delete("state");
  window.history.replaceState({}, "", url.toString());

  setMessage("Dropbox connecté.", "ok");
  return true;
}

async function refreshAccessTokenIfNeeded(){
  const t = loadTokens();
  if(hasValidAccessToken(t)) return t;
  if(!t || !t.refresh_token) return null;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: t.refresh_token,
    client_id: DROPBOX_APP_KEY
  });

  const r = await fetch("https://api.dropboxapi.com/oauth2/token",{
    method:"POST",
    headers:{ "Content-Type":"application/x-www-form-urlencoded" },
    body: body.toString()
  });

  if(!r.ok) return null;

  const tok = await r.json();
  const expiresAt = Date.now() + (tok.expires_in ? tok.expires_in*1000 : 3600000);

  const merged = {
    access_token: tok.access_token,
    refresh_token: t.refresh_token,
    expires_at: expiresAt
  };
  saveTokens(merged);
  return merged;
}

/* ===========================
   DROPBOX FILES API
=========================== */
async function dbxDownloadJson(path){
  const t = await refreshAccessTokenIfNeeded();
  if(!t) return { ok:false, err:"not_connected" };

  const r = await fetch("https://content.dropboxapi.com/2/files/download",{
    method:"POST",
    headers:{
      "Authorization": "Bearer " + t.access_token,
      "Dropbox-API-Arg": JSON.stringify({ path })
    }
  });

  if(r.status === 409) return { ok:false, err:"not_found" };
  if(!r.ok) return { ok:false, err:"download_failed" };

  let rev=null;
  try{
    const meta = JSON.parse(r.headers.get("Dropbox-API-Result") || "null");
    rev = meta && meta.rev ? meta.rev : null;
  }catch{}

  const text = await r.text();
  try{
    return { ok:true, data: JSON.parse(text), rev };
  }catch{
    return { ok:false, err:"bad_json" };
  }
}

async function dbxUploadJson(path, obj, rev){
  const t = await refreshAccessTokenIfNeeded();
  if(!t) return { ok:false, err:"not_connected" };

  const mode = rev ? { ".tag":"update", "update": rev } : { ".tag":"overwrite" };
  const content = JSON.stringify(obj);

  const r = await fetch("https://content.dropboxapi.com/2/files/upload",{
    method:"POST",
    headers:{
      "Authorization":"Bearer " + t.access_token,
      "Content-Type":"application/octet-stream",
      "Dropbox-API-Arg": JSON.stringify({
        path,
        mode,
        autorename:false,
        mute:true,
        strict_conflict:true
      })
    },
    body: content
  });

  if(!r.ok) return { ok:false, err: r.status===409 ? "conflict" : "upload_failed" };

  let meta=null;
  try{ meta = await r.json(); }catch{}
  return { ok:true, rev: meta && meta.rev ? meta.rev : null };
}

async function dbxCreateFolder(path){
  const t = await refreshAccessTokenIfNeeded();
  if(!t) return { ok:false, err:"not_connected" };

  const r = await fetch("https://api.dropboxapi.com/2/files/create_folder_v2",{
    method:"POST",
    headers:{
      "Authorization":"Bearer " + t.access_token,
      "Content-Type":"application/json"
    },
    body: JSON.stringify({ path, autorename: false })
  });

  if(r.ok) return { ok:true };
  if(r.status === 409) return { ok:true };
  return { ok:false, err:"create_folder_failed" };
}

async function dbxUploadText(path, text){
  const t = await refreshAccessTokenIfNeeded();
  if(!t) return { ok:false, err:"not_connected" };

  const r = await fetch("https://content.dropboxapi.com/2/files/upload",{
    method:"POST",
    headers:{
      "Authorization":"Bearer " + t.access_token,
      "Content-Type":"application/octet-stream",
      "Dropbox-API-Arg": JSON.stringify({
        path,
        mode: { ".tag":"add" },
        autorename: false,
        mute: true,
        strict_conflict: true
      })
    },
    body: text
  });

  if(r.ok) return { ok:true };
  if(r.status === 409) return { ok:true };
  return { ok:false, err:"upload_text_failed" };
}

/* ===========================
   DATA
=========================== */
const DATA = window.SEQODS_DATA;
const C = DATA?.c || [];
const E = DATA?.e || [];
const F = DATA?.f || [];
const A = DATA?.a || {};

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
let DICT = new Set();

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

  const base = normalizeWord(canonForAnagrams || titleWord || "");

  // Anagrammes
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
        ana.textContent = shown.join(" • ") + (filtered.length>60 ? ` … (+${filtered.length-60})` : "");
      }
    }
  }

  // Rallonges
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
        rallEl.textContent = lst.join(" • ");
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
   ARCHIVAGE DROPBOX
=========================== */
function buildArchiveText(seqIndex, num){
  const s = sequences[seqIndex];
  if(!s) return "";

  const borneA = E[s.startIdx] || "";
  const borneB = E[s.endIdx] || "";
  const date = todayStr();

  const lines = [];
  lines.push(`Fiche ${pad4(num)}`);
  lines.push(`Date : ${date}`);
  lines.push("");
  lines.push(`Borne A : ${borneA}`);
  lines.push(`Borne B : ${borneB}`);
  lines.push("");
  lines.push("Solutions :");
  for(let i=s.startIdx+1, k=1; i<=s.startIdx+10; i++, k++){
    lines.push(`${k}. ${E[i] || ""}`);
  }
  lines.push("");
  lines.push("—");
  return lines.join("\n");
}

async function ensureArchiveForSeq(seqIndex){
  const key = String(seqIndex);
  if(!state.archiveBySeq) state.archiveBySeq = {};

  let entry = state.archiveBySeq[key];
  if(!entry){
    entry = { num: state.archiveNext || 1, uploaded: false };
    state.archiveNext = (entry.num || 1) + 1;
    state.archiveBySeq[key] = entry;
    state.updatedAt = Date.now();
    saveLocal(state);
  }

  if(entry.uploaded) return true;

  const folder = await dbxCreateFolder(DROPBOX_ARCHIVE_DIR);
  if(!folder.ok) return false;

  const text = buildArchiveText(seqIndex, entry.num);
  const filePath = `${DROPBOX_ARCHIVE_DIR}/${pad4(entry.num)}.txt`;
  const up = await dbxUploadText(filePath, text);

  if(up.ok){
    entry.uploaded = true;
    state.archiveBySeq[key] = entry;
    state.updatedAt = Date.now();
    saveLocal(state);
    return true;
  }
  return false;
}

async function syncPendingArchives(){
  const t = await refreshAccessTokenIfNeeded();
  if(!t) return;

  for(let i=0;i<TOTAL;i++){
    const ls = ensureListState(state, i);
    if(ls.seen){
      await ensureArchiveForSeq(i);
    }
  }
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
function getSeenIndexes(){
  const out = [];
  for(let i=0;i<TOTAL;i++){
    const ls = ensureListState(state, i);
    if(ls.seen) out.push(i);
  }
  return out;
}

function getNewIndexes(){
  const out = [];
  for(let i=0;i<TOTAL;i++){
    const ls = ensureListState(state, i);
    if(!ls.seen) out.push(i);
  }
  return out;
}

// Poids d'une liste pour la revision par interleaving.
// Plus elle a ete vue il y a longtemps, plus son poids est fort.
// Une liste jouee avec aide a un poids 1.5x superieur.
function reviewWeight(ls){
  if(!ls.seen) return 0;
  const today = todayStr();
  const last = ls.lastSeen || today;
  const [y1,m1,d1] = today.split("-").map(Number);
  const [y2,m2,d2] = last.split("-").map(Number);
  const msDay = 864e5;
  const days = Math.round((new Date(y1,m1-1,d1) - new Date(y2,m2-1,d2)) / msDay);
  const ageFactor = Math.max(1, days);
  const helpFactor = (ls.lastResult === "help") ? 1.5 : 1;
  return ageFactor * helpFactor;
}

// Tirage aleatoire pondere dans un tableau d'indexes
function weightedPick(indexes){
  const weights = indexes.map(i => reviewWeight(ensureListState(state, i)));
  const total = weights.reduce((a,b) => a+b, 0);
  if(total <= 0) return indexes[Math.floor(Math.random()*indexes.length)];
  let r = Math.random() * total;
  for(let k=0; k<indexes.length; k++){
    r -= weights[k];
    if(r <= 0) return indexes[k];
  }
  return indexes[indexes.length-1];
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

// Determine si on est encore dans le quota ou en mode libre
function quotaDone(){
  return sessionProgress.newDone >= settings.quotaNew &&
         sessionProgress.reviewDone >= settings.quotaReview;
}

function pickAccordingPolicy(isFirstOfSession=false){
  if(isFirstOfSession) resetSessionProgress();

  const newOnes = getNewIndexes();
  const seenOnes = getSeenIndexes();

  // Au-dela du quota : on continue librement (mix nouveau/revisions)
  if(sessionProgress.beyondQuota){
    const pool = newOnes.length ? newOnes : seenOnes;
    if(!pool.length){ setMessage("Toutes les listes ont ete jouees.", "warn"); return false; }
    const idx = pool === seenOnes ? weightedPick(pool) : pool[Math.floor(Math.random()*pool.length)];
    return pickSpecificSequence(idx);
  }

  // Dans le quota : on equilibre nouvelles et revisions
  const needNew    = sessionProgress.newDone    < settings.quotaNew;
  const needReview = sessionProgress.reviewDone < settings.quotaReview;

  let pool = [];
  let mode = "";

  if(needNew && needReview){
    // On alterne : si plus de nouvelles que de revisions jouees, on fait une revision
    if(sessionProgress.newDone > sessionProgress.reviewDone && seenOnes.length){
      mode = "review"; pool = seenOnes;
    } else if(newOnes.length){
      mode = "new"; pool = newOnes;
    } else {
      mode = "review"; pool = seenOnes;
    }
  } else if(needNew && newOnes.length){
    mode = "new"; pool = newOnes;
  } else if(needReview && seenOnes.length){
    mode = "review"; pool = seenOnes;
  } else {
    // Quota atteint : on passe en mode libre
    sessionProgress.beyondQuota = true;
    updateSessionChip();
    const all = newOnes.length ? newOnes : seenOnes;
    if(!all.length){ setMessage("Toutes les listes ont ete jouees.", "warn"); return false; }
    const idx = newOnes.length ? newOnes[Math.floor(Math.random()*newOnes.length)] : weightedPick(seenOnes);
    return pickSpecificSequence(idx);
  }

  if(!pool.length){ setMessage("Aucune liste disponible.", "warn"); return false; }

  const seqIndex = mode === "review" ? weightedPick(pool) : pool[Math.floor(Math.random()*pool.length)];
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
  const wasNew = !ls.seen;
  ls.seen = true;
  ls.lastSeen = todayStr();

  if(wasSolvedWithHelp){
    ls.validated = false;
    ls.lastResult = "help";
    setMessage("Liste terminee, mais avec aide.", "warn");
  }else{
    ls.validated = true;
    ls.lastResult = "ok";
    setMessage("Validee sans aide !", "ok");
  }

  // Mise a jour du quota session
  if(!sessionProgress.beyondQuota){
    if(wasNew) sessionProgress.newDone++;
    else       sessionProgress.reviewDone++;

    // Si le quota vient d'etre atteint, signaler le mode libre
    if(quotaDone()){
      sessionProgress.beyondQuota = true;
    }
  }
  updateSessionChip();

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
    btnS.textContent="Rejouer";
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
   PERSISTENCE
=========================== */
async function persistState(){
  saveLocal(state);

  const t = await refreshAccessTokenIfNeeded();
  const btn=$("#btnDropbox");
  if(!t){
    if(btn) btn.textContent = "Connexion Dropbox";
    return;
  }
  if(btn) btn.textContent = "Dropbox OK";

  await syncPendingArchives();

  // Si on n'a pas de rev locale, on télécharge d'abord pour éviter d'écraser
  // un state existant sur Dropbox (ex: nouvel appareil / PWA fraîche)
  if(!state.dbxRev){
    const remote = await dbxDownloadJson(DROPBOX_STATE_PATH);
    if(remote.ok){
      const remoteState = mergeDefaults(remote.data);
      const chooseRemote = (remoteState.updatedAt||0) >= (state.updatedAt||0);
      state = chooseRemote ? remoteState : state;
      state.dbxRev = remote.rev || null;
      saveLocal(state);
      computeStats();
      if(chooseRemote) return; // on a récupéré le bon state, pas besoin d'uploader
    }
  }

  const res = await dbxUploadJson(DROPBOX_STATE_PATH, state, state.dbxRev);

  if(res.ok){
    state.dbxRev = res.rev || state.dbxRev;
    state.updatedAt = Date.now();
    saveLocal(state);
    return;
  }

  if(res.err==="conflict"){
    const remote = await dbxDownloadJson(DROPBOX_STATE_PATH);
    if(remote.ok){
      const remoteState = mergeDefaults(remote.data);
      const chooseRemote = (remoteState.updatedAt||0) >= (state.updatedAt||0);
      state = chooseRemote ? remoteState : state;
      state.dbxRev = remote.rev || state.dbxRev || null;

      const res2 = await dbxUploadJson(DROPBOX_STATE_PATH, state, state.dbxRev);
      if(res2.ok){
        state.dbxRev = res2.rev || state.dbxRev;
        saveLocal(state);
        return;
      }
    }
    setMessage("Conflit Dropbox : réessaie.", "warn");
    return;
  }

  setMessage("Synchro Dropbox : échec.", "warn");
}

async function loadStatePreferDropbox(){
  state = loadLocal();
  computeStats();

  const t = await refreshAccessTokenIfNeeded();
  const btn=$("#btnDropbox");
  if(!t){
    if(btn) btn.textContent = "Connexion Dropbox";
    return;
  }
  if(btn) btn.textContent = "Dropbox OK";

  const remote = await dbxDownloadJson(DROPBOX_STATE_PATH);
  if(remote.ok){
    const remoteState = mergeDefaults(remote.data);
    const chooseRemote = (remoteState.updatedAt||0) >= (state.updatedAt||0);
    state = chooseRemote ? remoteState : state;
    state.dbxRev = remote.rev || state.dbxRev || null;
    saveLocal(state);
    computeStats();
    return;
  }

  if(remote.err==="not_found"){
    await persistState();
  }
}

/* ===========================
   WIRE
=========================== */
function wire(){
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
      setMessage("Synchronisation...", "");
      await persistState();
      setMessage("Synchronisation terminee.", "ok");
      return;
    }
    oauthStart();
  });

  // Settings — toutes les references DOM resolues au moment du clic
  function openSettings(){
    const m = $("#settingsModal"); if(!m) return;
    const qN = $("#setQuotaNew"); if(qN) qN.value = settings.quotaNew;
    const qR = $("#setQuotaReview"); if(qR) qR.value = settings.quotaReview;
    const cE = $("#setChronoEnabled"); if(cE) cE.checked = settings.chronoEnabled;
    const cM = $("#setChronoMode"); if(cM) cM.value = settings.chronoMode;
    const cS = $("#setChronoSeconds"); if(cS) cS.value = settings.chronoSeconds;
    const modeRow = $("#chronoModeRow");
    const downRow = $("#chronoDownRow");
    if(modeRow) modeRow.style.display = (cE && cE.checked) ? "flex" : "none";
    if(downRow) downRow.style.display = (cE && cE.checked && cM && cM.value==="down") ? "flex" : "none";
    m.classList.add("open");
  }
  function closeSettings(){
    const m = $("#settingsModal"); if(m) m.classList.remove("open");
  }
  function applySettings(){
    const qN = parseInt($("#setQuotaNew")?.value) || 3;
    const qR = parseInt($("#setQuotaReview")?.value) || 3;
    const cE = $("#setChronoEnabled")?.checked || false;
    const cM = $("#setChronoMode")?.value || "up";
    const cS = Math.max(10, parseInt($("#setChronoSeconds")?.value) || 180);
    settings = { quotaNew: Math.max(1,qN), quotaReview: Math.max(0,qR), chronoEnabled: cE, chronoMode: cM, chronoSeconds: cS };
    saveSettings(settings);
    chronoRender();
    updateSessionChip();
    closeSettings();
  }
  function onChronoSettingsChange(){
    const cE = $("#setChronoEnabled");
    const cM = $("#setChronoMode");
    const modeRow = $("#chronoModeRow");
    const downRow = $("#chronoDownRow");
    if(modeRow) modeRow.style.display = (cE && cE.checked) ? "flex" : "none";
    if(downRow) downRow.style.display = (cE && cE.checked && cM && cM.value==="down") ? "flex" : "none";
  }

  document.addEventListener("click", (e)=>{
    if(e.target.closest("#btnSettings"))      { openSettings(); return; }
    if(e.target.closest("#settingsClose"))    { applySettings(); return; }
    if(e.target.closest("#settingsBackdrop")) { applySettings(); return; }
  });
  document.addEventListener("change", (e)=>{
    if(e.target.id==="setChronoEnabled" || e.target.id==="setChronoMode") onChronoSettingsChange();
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
  document.addEventListener("keydown",(e)=>{ if(e.key==="Escape"){ closeDef(); closeSettings(); } });

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
  updateSessionChip();
  chronoStart();
}

/* ===========================
   START
=========================== */
async function start(){
  DICT = D.length > 0
    ? new Set(D.map(w => normalizeWord(w)))
    : new Set(C.map(w => normalizeWord(w)));
  wire();
  moveNewButtonForMobile();
  chronoRender();
  updateSessionChip();

  await oauthHandleRedirectIfNeeded();
  await loadStatePreferDropbox();

  if(restoreCurrentRunIfAny()){
    renderAll();
  }else{
    if(pickAccordingPolicy(true)) renderAll();
  }

  setInterval(()=>{ persistState().catch(()=>{}); }, 60000);
}

document.addEventListener("DOMContentLoaded", start);
})();

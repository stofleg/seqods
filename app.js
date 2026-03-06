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
  el.className = cls ? `msg ${cls}` : "msg";
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
    updatedAt: Date.now(),
    dbxRev: null,
    lists: {},
    archiveNext: 1,
    archiveBySeq: {},
    revisionSnoozeDate: "",
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

/* ===========================
   GAME STATE
=========================== */
let state = loadLocal();
let currentSeqIndex = -1;
let seq = null;
let targets = [];
let found = new Set();
let hintMode = Array(10).fill("none");
let noHelpRun = true;

/* ===========================
   DEFINITIONS / ANAGRAMMES
=========================== */
function openDef(defText, titleWord, canonForAnagrams, showAnagrams){
  const tEl=$("#defTitle"), bEl=$("#defBody"), mEl=$("#defModal");
  if(!tEl || !bEl || !mEl) return;

  tEl.textContent = titleWord || "";
  bEl.textContent = defText || "(définition absente)";

  const anaWrap=$("#anaWrap"), ana=$("#defAna");
  if(anaWrap && ana){
    if(!showAnagrams){
      anaWrap.style.display="none";
      ana.textContent="";
    }else{
      const base=normalizeWord(c

(function(){
"use strict";

const $ = (s)=>document.querySelector(s);

/* ===========================
   CONFIG DROPBOX
=========================== */

const DROPBOX_APP_KEY = "5r5cxyemzt778me";
const DROPBOX_STATE_PATH = "/state.json";

const LS_TOKENS = "SEQODS_DBX_TOKENS_V3";
const LS_PKCE  = "SEQODS_DBX_PKCE_V2";
const STORE_LOCAL = "SEQODS_LOCAL_STATE_V3";

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

/* ===========================
   LOCAL STATE
=========================== */

function defaultState(){ return { updatedAt: Date.now(), lists:{} }; }

function loadLocal(){
  try{ return JSON.parse(localStorage.getItem(STORE_LOCAL)||"null") || defaultState(); }
  catch{ return defaultState(); }
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

/* ===========================
   DROPBOX TOKENS
=========================== */

function saveTokens(t){ try{ localStorage.setItem(LS_TOKENS, JSON.stringify(t)); }catch{} }
function loadTokens(){
  try{ return JSON.parse(localStorage.getItem(LS_TOKENS)||"null"); }
  catch{ return null; }
}

/* ===========================
   PKCE (SYNC)
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
   PKCE STORE (window.name + localStorage secours)
=========================== */

function pkceSave(payload){
  // 1) window.name : survit aux redirects cross-domain (iOS-safe)
  try{
    window.name = "SEQODS_PKCE::" + JSON.stringify(payload);
  }catch{}

  // 2) localStorage : secours
  try{
    localStorage.setItem(LS_PKCE, JSON.stringify(payload));
  }catch{}
}

function pkceLoad(){
  // 1) window.name
  try{
    if(typeof window.name === "string" && window.name.startsWith("SEQODS_PKCE::")){
      const raw = window.name.slice("SEQODS_PKCE::".length);
      const obj = JSON.parse(raw);
      return obj;
    }
  }catch{}

  // 2) localStorage secours
  try{
    const obj = JSON.parse(localStorage.getItem(LS_PKCE)||"null");
    return obj;
  }catch{
    return null;
  }
}

function pkceClear(){
  try{
    if(typeof window.name === "string" && window.name.startsWith("SEQODS_PKCE::")){
      window.name = "";
    }
  }catch{}
  try{ localStorage.removeItem(LS_PKCE); }catch{}
}

/* ===========================
   OAUTH DROPBOX (PKCE)
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

async function handleOAuth(){
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
    // affiche la vraie erreur
    let text = "";
    let json = null;
    try{
      const ct = r.headers.get("content-type") || "";
      if(ct.includes("application/json")) json = await r.json();
      else text = await r.text();
    }catch{}

    const details =
      (json && (json.error_description || json.error || JSON.stringify(json))) ||
      text ||
      ("HTTP " + r.status);

    console.error("Dropbox /token error:", r.status, details);
    setMessage("Erreur OAuth Dropbox : " + details, "err");
    return false;
  }

  const tok = await r.json();
  saveTokens(tok);

  url.searchParams.delete("code");
  url.searchParams.delete("state");
  window.history.replaceState({}, "", url.toString());

  setMessage("Dropbox connecté.", "ok");
  return true;
}

/* ===========================
   DROPBOX FILES API
=========================== */

async function dbxUpload(obj){
  const tok = loadTokens();
  if(!tok || !tok.access_token) return;

  await fetch("https://content.dropboxapi.com/2/files/upload",{
    method:"POST",
    headers:{
      "Authorization":"Bearer "+tok.access_token,
      "Content-Type":"application/octet-stream",
      "Dropbox-API-Arg": JSON.stringify({ path: DROPBOX_STATE_PATH, mode: "overwrite" })
    },
    body: JSON.stringify(obj)
  });
}

async function dbxDownload(){
  const tok = loadTokens();
  if(!tok || !tok.access_token) return null;

  const r = await fetch("https://content.dropboxapi.com/2/files/download",{
    method:"POST",
    headers:{
      "Authorization":"Bearer "+tok.access_token,
      "Dropbox-API-Arg": JSON.stringify({ path: DROPBOX_STATE_PATH })
    }
  });

  if(!r.ok) return null;
  return JSON.parse(await r.text());
}

/* ===========================
   GAME (minimal stable)
=========================== */

const DATA = window.SEQODS_DATA;
const C = DATA.c, E = DATA.e;

const sequences = [];
for(let i=0;i+11<C.length;i+=12) sequences.push({start:i});
const TOTAL = sequences.length;

let state = loadLocal();
let current = -1;
let targets = [];
let found = new Set();
let noHelp = true;

function pick(){
  current = Math.floor(Math.random()*TOTAL);
  const seq = sequences[current];
  targets = [];
  for(let i=seq.start+1;i<=seq.start+10;i++){
    targets.push({ c:C[i], e:E[i] });
  }
  found = new Set();
  noHelp = true;
}

function render(){
  const a=$("#borneA"), b=$("#borneB"), list=$("#liste");
  if(!a||!b||!list) return;

  const seq=sequences[current];
  a.textContent = E[seq.start];
  b.textContent = E[seq.start+11];

  list.innerHTML="";
  targets.forEach((t,i)=>{
    const li=document.createElement("li");
    li.textContent = found.has(i) ? t.e : "";
    list.appendChild(li);
  });

  const c=$("#compteur");
  if(c) c.textContent = `${found.size}/10`;
}

function validate(){
  const input=$("#saisie");
  if(!input) return;

  const val = normalizeWord(input.value);
  if(!val) return;

  targets.forEach((t,i)=>{
    if(normalizeWord(t.c)===val) found.add(i);
  });

  input.value="";
  render();

  if(found.size===10){
    const s = state.lists[current] || { interval: 1 };
    if(noHelp) s.interval = nextInterval(s.interval || 1);
    else s.interval = 1;
    s.due = addDays(todayStr(), s.interval);

    state.lists[current] = s;
    state.updatedAt = Date.now();
    saveLocal(state);
    dbxUpload(state);
  }
}

/* ===========================
   WIRE
=========================== */

function wire(){
  const n=$("#btnNouveau");
  if(n) n.addEventListener("click", ()=>{ pick(); render(); });

  const v=$("#btnValider");
  if(v) v.addEventListener("click", validate);

  const s=$("#saisie");
  if(s) s.addEventListener("keydown",(e)=>{ if(e.key==="Enter"){ e.preventDefault(); validate(); } });

  const d=$("#btnDropbox");
  if(d) d.addEventListener("click", oauthStart);
}

/* ===========================
   START
=========================== */

async function start(){
  wire();
  await handleOAuth();

  const remote = await dbxDownload();
  if(remote){
    state = remote;
    saveLocal(state);
  }

  pick();
  render();
}

document.addEventListener("DOMContentLoaded", start);

})();

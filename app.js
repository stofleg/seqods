(function(){
  "use strict";
  const $ = (s)=>document.querySelector(s);

  // ====== CONFIG DROPBOX ======
  const DROPBOX_APP_KEY = "5r5cxyemzt778me";
  const DROPBOX_REDIRECT_URI = "https://stofleg.github.io/seqods/";
  const DROPBOX_STATE_PATH = "/state.json"; // dans le dossier App Folder de Dropbox

  const LS_TOKENS = "SEQODS_DBX_TOKENS_V1";
  const SS_CODE_VERIFIER = "SEQODS_DBX_CODE_VERIFIER_V1";
  const STORE_LOCAL = "SEQODS_LOCAL_STATE_V2";

  // ====== UTIL ======
  function normalizeWord(s){
    return (s||"").toString().trim().toUpperCase().replace(/\s+/g,"").replace(/[’'`´]/g,"'");
  }
  function tirageFromC(c){
    const n = normalizeWord(c);
    return n.split("").sort((a,b)=>a.localeCompare(b,"fr")).join("");
  }
  function setMessage(t,k){
    const el=$("#msg");
    if(!el) return;
    el.textContent=t||"";
    el.className=k?`msg ${k}`:"msg";
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
  function cmpDate(a,b){ return a.localeCompare(b); } // <= 0 => a <= b

  // ====== LOCAL STATE ======
  function loadLocalState(){
    try{ return JSON.parse(localStorage.getItem(STORE_LOCAL)||"null"); }catch{ return null; }
  }
  function saveLocalState(st){
    localStorage.setItem(STORE_LOCAL, JSON.stringify(st));
  }
  function defaultState(){
    return {
      updatedAt: Date.now(),
      dbxRev: null,
      lists: {} // par seqIndex : { due, interval, seen, validated, lastResult, lastSeen }
    };
  }

  // ====== SRS ======
  const INTERVALS = [1,3,7,14,30,60,120];
  function nextInterval(cur){
    const idx = INTERVALS.indexOf(cur);
    if(idx === -1) return 3;
    return INTERVALS[Math.min(INTERVALS.length-1, idx+1)];
  }
  function ensureListState(st, seqIndex){
    const k = String(seqIndex);
    if(!st.lists[k]){
      st.lists[k] = { due: todayStr(), interval: 1, seen:false, validated:false, lastResult:"", lastSeen:"" };
    }
    return st.lists[k];
  }

  // ====== DROPBOX TOKENS ======
  function loadTokens(){
    try{ return JSON.parse(localStorage.getItem(LS_TOKENS)||"null"); }catch{ return null; }
  }
  function saveTokens(t){
    localStorage.setItem(LS_TOKENS, JSON.stringify(t));
  }
  function hasValidAccessToken(tokens){
    return tokens && tokens.access_token && tokens.expires_at && Date.now() < (tokens.expires_at - 30_000);
  }

  // ====== PKCE (SYNC) — fiable au clic ======
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
    function rightRotate(value, amount){ return (value>>>amount) | (value<<(32-amount)); }
    const mathPow = Math.pow;
    const maxWord = mathPow(2, 32);

    const words = [];
    const asciiBitLength = ascii.length * 8;

    const hash = sha256Sync.h = sha256Sync.h || [];
    const k = sha256Sync.k = sha256Sync.k || [];
    let primeCounter = k.length;

    const isComposite = {};
    for (let candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (mathPow(candidate, .5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1/3) * maxWord) | 0;
      }
    }

    ascii += "\x80";
    while (ascii.length % 64 - 56) ascii += "\x00";
    for (let i = 0; i < ascii.length; i++) {
      const j = ascii.charCodeAt(i);
      words[i>>2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = (asciiBitLength / maxWord) | 0;
    words[words.length] = (asciiBitLength) | 0;

    for (let j = 0; j < words.length; ) {
      const w = words.slice(j, j += 16);
      const oldHash = hash.slice(0);

      for (let i = 0; i < 64; i++) {
        const w15 = w[i - 15], w2 = w[i - 2];
        const a = hash[0], e = hash[4];
        const temp1 = (hash[7]
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

        const temp2 = ((rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
          + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]))
        ) | 0;

        hash.unshift((temp1 + temp2) | 0);
        hash[4] = (hash[4] + temp1) | 0;
        hash.pop();
      }

      for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
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
    const bytes = sha256Sync(verifier);
    return base64urlFromBytes(bytes);
  }

  function oauthStart(){
    const verifier = randomVerifier(64);
    const challenge = codeChallengeFromVerifier(verifier);
    sessionStorage.setItem(SS_CODE_VERIFIER, verifier);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: DROPBOX_APP_KEY,
      redirect_uri: DROPBOX_REDIRECT_URI,
      code_challenge: challenge,
      code_challenge_method: "S256",
      token_access_type: "offline",
      scope: "files.content.read files.content.write"
    });

    window.location.href = `https://www.dropbox.com/oauth2/authorize?${params.toString()}`;
  }

  async function oauthHandleRedirectIfNeeded(){
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    if(!code) return false;

    const verifier = sessionStorage.getItem(SS_CODE_VERIFIER);
    sessionStorage.removeItem(SS_CODE_VERIFIER);

    if(!verifier){
      setMessage("Connexion Dropbox : code_verifier manquant.", "err");
      return false;
    }

    const body = new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: DROPBOX_APP_KEY,
      redirect_uri: DROPBOX_REDIRECT_URI,
      code_verifier: verifier
    });

    const resp = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });

    if(!resp.ok){
      setMessage("Connexion Dropbox : échec d’échange du code.", "err");
      return false;
    }

    const tok = await resp.json();
    const expiresAt = Date.now() + (tok.expires_in ? tok.expires_in*1000 : 3_600_000);

    saveTokens({
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expires_at: expiresAt
    });

    // Nettoie l’URL
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

    const resp = await fetch("https://api.dropboxapi.com/oauth2/token",{
      method:"POST",
      headers:{ "Content-Type":"application/x-www-form-urlencoded" },
      body: body.toString()
    });

    if(!resp.ok) return null;

    const tok = await resp.json();
    const expiresAt = Date.now() + (tok.expires_in ? tok.expires_in*1000 : 3_600_000);

    const merged = {
      access_token: tok.access_token,
      refresh_token: t.refresh_token,
      expires_at: expiresAt
    };
    saveTokens(merged);
    return merged;
  }

  // ====== DROPBOX FILES API ======
  async function dbxDownloadJson(path){
    const tokens = await refreshAccessTokenIfNeeded();
    if(!tokens) return { ok:false, err:"not_connected" };

    const resp = await fetch("https://content.dropboxapi.com/2/files/download",{
      method:"POST",
      headers:{
        "Authorization": `Bearer ${tokens.access_token}`,
        "Dropbox-API-Arg": JSON.stringify({ path })
      }
    });

    if(resp.status === 409){
      return { ok:false, err:"not_found" };
    }
    if(!resp.ok){
      return { ok:false, err:"download_failed" };
    }

    let rev = null;
    try{
      const meta = JSON.parse(resp.headers.get("Dropbox-API-Result") || "null");
      rev = meta && meta.rev ? meta.rev : null;
    }catch{}

    const text = await resp.text();
    try{
      const obj = JSON.parse(text);
      return { ok:true, data:obj, rev };
    }catch{
      return { ok:false, err:"bad_json" };
    }
  }

  async function dbxUploadJson(path, obj, rev){
    const tokens = await refreshAccessTokenIfNeeded();
    if(!tokens) return { ok:false, err:"not_connected" };

    const content = JSON.stringify(obj);
    const mode = rev ? { ".tag":"update", "update": rev } : { ".tag":"overwrite" };

    const resp = await fetch("https://content.dropboxapi.com/2/files/upload",{
      method:"POST",
      headers:{
        "Authorization": `Bearer ${tokens.access_token}`,
        "Content-Type":"application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify({
          path,
          mode,
          autorename: false,
          mute: true,
          strict_conflict: true
        })
      },
      body: content
    });

    if(!resp.ok){
      return { ok:false, err: resp.status === 409 ? "conflict" : "upload_failed" };
    }

    let meta = null;
    try{ meta = await resp.json(); }catch{}
    const newRev = meta && meta.rev ? meta.rev : null;
    return { ok:true, rev:newRev };
  }

  // ====== DATA (data.js) ======
  const DATA = window.SEQODS_DATA;
  const C = DATA.c, E = DATA.e, F = DATA.f, G = DATA.g, A = DATA.a || {};

  const sequences = [];
  for(let start=0; start+11<C.length; start+=12){
    sequences.push({ startIdx:start, endIdx:start+11 });
  }
  const TOTAL = sequences.length;

  // ====== GAME STATE ======
  let state = defaultState();
  let currentSeqIndex = -1;
  let seq = null;
  let targets = [];
  let found = new Set();
  let hintMode = Array(10).fill("none");
  let noHelpRun = true;

  // ====== DEF MODAL ======
  function openDef(defText, titleWord, canonForAnagrams){
    $("#defTitle").textContent = titleWord || "";
    $("#defBody").textContent = defText || "(définition absente)";

    const anaWrap=$("#anaWrap"), ana=$("#defAna");
    let base=normalizeWord(canonForAnagrams || titleWord || "");
    const t = base ? base.split("").sort((a,b)=>a.localeCompare(b,"fr")).join("") : "";
    const lst = (t && A[t]) ? A[t].slice() : [];
    const filtered = base ? lst.filter(x=>normalizeWord(x)!==base) : lst;

    if(!t || filtered.length===0){
      anaWrap.style.display="none";
      ana.textContent="";
    }else{
      anaWrap.style.display="block";
      const MAX=60;
      const shown=filtered.slice(0,MAX);
      ana.textContent = shown.join(" • ") + (filtered.length>MAX ? ` … (+${filtered.length-MAX})` : "");
    }

    $("#defModal").classList.add("open");
  }
  function closeDef(){ $("#defModal").classList.remove("open"); }

  // ====== PROGRESSION UI ======
  function computeStats(){
    let seen=0, validated=0;
    for(const k in state.lists){
      const st = state.lists[k];
      if(st.seen) seen++;
      if(st.validated) validated++;
    }
    const seenPct=Math.round((seen/TOTAL)*100);
    const valPct=Math.round((validated/TOTAL)*100);
    $("#seenCount").textContent=`${seen}/${TOTAL}`;
    $("#valCount").textContent=`${validated}/${TOTAL}`;
    $("#seenBar").style.width=`${seenPct}%`;
    $("#valBar").style.width=`${valPct}%`;
    return {seen, validated};
  }

  // ====== SRS SELECT ======
  function eligibleDueSeqIndexes(){
    const today = todayStr();
    const due = [];
    let soonest = null;

    for(let i=0;i<TOTAL;i++){
      const st = ensureListState(state, i);
      if(st.validated) continue;

      const d = st.due || today;
      if(cmpDate(d, today) <= 0){
        due.push(i);
      }else{
        if(!soonest || cmpDate(d, soonest.date) < 0){
          soonest = { index:i, date:d };
        }
      }
    }
    return { due, soonest };
  }

  function pickSequence(){
    const { due, soonest } = eligibleDueSeqIndexes();

    if(due.length > 0){
      currentSeqIndex = due[Math.floor(Math.random()*due.length)];
    }else if(soonest){
      currentSeqIndex = soonest.index;
      setMessage(`Aucune liste due aujourd’hui. Prochaine échéance : ${soonest.date}.`, "warn");
    }else{
      setMessage("Jeu terminé : toutes les listes sont validées.", "ok");
      return false;
    }

    seq = sequences[currentSeqIndex];

    targets=[];
    for(let i=seq.startIdx+1;i<=seq.startIdx+10;i++){
      const c=C[i];
      targets.push({
        c,
        e:E[i],
        f:F[i],
        g:G[i],
        len: normalizeWord(c).length,
        t: tirageFromC(c)
      });
    }

    found=new Set();
    hintMode=Array(10).fill("none");
    noHelpRun=true;

    const st = ensureListState(state, currentSeqIndex);
    st.seen = true;
    st.lastSeen = todayStr();
    state.updatedAt = Date.now();
    return true;
  }

  // ====== RENDER ======
  function renderBounds(){
    const a=$("#borneA"), b=$("#borneB");
    const aE=E[seq.startIdx], bE=E[seq.endIdx];
    const aF=F[seq.startIdx]||"", bF=F[seq.endIdx]||"";
    a.textContent=aE;
    b.textContent=bE;
    a.onclick=()=>openDef(aF, aE, C[seq.startIdx]);
    b.onclick=()=>openDef(bF, bE, C[seq.endIdx]);
  }

  function renderSlots(){
    const list=$("#liste");
    list.innerHTML="";
    for(let i=0;i<10;i++){
      const li=document.createElement("li");
      li.className="slot";
      li.dataset.slot=i;
      li.innerHTML=`
        <div class="slotMain">
          <button type="button" class="slotWordBtn">
            <span class="slotText"></span>
            <span class="slotHint"></span>
          </button>
        </div>
        <div class="slotTools">
          <button class="toolBtn" data-tool="len">123</button>
          <button class="toolBtn" data-tool="tirage">ABC</button>
          <button class="toolBtn" data-tool="def">📖</button>
        </div>`;
      list.appendChild(li);
    }
    applyHintsAll();
  }

  function applyHint(i){
    const li=$("#liste").querySelector(`li[data-slot="${i}"]`);
    const hint=li.querySelector(".slotHint");
    if(found.has(i)){
      hint.style.display="none";
      li.querySelectorAll(".toolBtn").forEach(b=>b.disabled=true);
      return;
    }
    li.querySelectorAll(".toolBtn").forEach(b=>b.disabled=false);

    if(hintMode[i]==="len"){
      hint.textContent=targets[i].len;
      hint.style.display="flex";
    }else if(hintMode[i]==="tirage"){
      hint.textContent=targets[i].t;
      hint.style.display="flex";
    }else{
      hint.style.display="none";
    }
  }
  function applyHintsAll(){ for(let i=0;i<10;i++) applyHint(i); }

  function revealSlot(i){
    const li=$("#liste").querySelector(`li[data-slot="${i}"]`);
    const btn=li.querySelector(".slotWordBtn");
    const txt=li.querySelector(".slotText");
    txt.textContent = targets[i].e; // affichage colonne E
    btn.dataset.def = targets[i].f || "";
    btn.dataset.word = targets[i].e || "";
    btn.dataset.canon = targets[i].c || "";
    hintMode[i]="none";
    applyHint(i);
  }

  function markAidUsed(){ noHelpRun=false; }

  function updateCounter(){
    $("#compteur").textContent=`${found.size}/10`;
    if(found.size !== 10) return;

    const ls = ensureListState(state, currentSeqIndex);

    if(noHelpRun){
      ls.validated = true;
      ls.lastResult = "ok";
      ls.interval = nextInterval(ls.interval || 1);
      ls.due = addDays(todayStr(), ls.interval);
      setMessage("Validée sans aide.", "ok");
    }else{
      ls.validated = false;
      ls.lastResult = "help";
      ls.interval = 1;
      ls.due = addDays(todayStr(), 1);
      setMessage("Liste terminée, mais avec aide.", "warn");
    }

    state.updatedAt = Date.now();
    computeStats();
    persistState().catch(()=>{});
  }

  function validateWord(raw){
    const norm=normalizeWord(raw);
    if(!norm){ setMessage("Saisis un mot.", "warn"); return; }

    const matched=[];
    for(let i=0;i<targets.length;i++){
      if(normalizeWord(targets[i].c)===norm) matched.push(i);
    }
    if(matched.length===0){
      setMessage("Ce mot ne fait pas partie des 10 entrées à trouver.", "warn");
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
    if(newly===0) setMessage("Ce mot est déjà validé.", "warn");
    else setMessage(matched.length>1 ? "Validé (doublon)." : "Validé.", "ok");

    updateCounter();
  }

  function showSolutions(){
    markAidUsed();
    for(let i=0;i<10;i++){
      if(!found.has(i)){
        found.add(i);
        revealSlot(i);
      }
    }
    updateCounter();
    setMessage("Solutions affichées.", "warn");
  }

  // ====== PERSISTENCE ======
  async function persistState(){
    saveLocalState(state);

    const tokens = await refreshAccessTokenIfNeeded();
    if(!tokens){
      const b=$("#btnDropbox");
      if(b) b.textContent = "Connexion Dropbox";
      return;
    }
    const b=$("#btnDropbox");
    if(b) b.textContent = "Dropbox OK";

    const res = await dbxUploadJson(DROPBOX_STATE_PATH, state, state.dbxRev);

    if(res.ok){
      state.dbxRev = res.rev || state.dbxRev;
      state.updatedAt = Date.now();
      saveLocalState(state);
      return;
    }

    if(res.err === "conflict"){
      const remote = await dbxDownloadJson(DROPBOX_STATE_PATH);
      if(remote.ok){
        const remoteState = remote.data;
        const chooseRemote = (remoteState.updatedAt || 0) >= (state.updatedAt || 0);
        const merged = chooseRemote ? remoteState : state;
        merged.dbxRev = remote.rev || merged.dbxRev || null;
        state = merged;

        const res2 = await dbxUploadJson(DROPBOX_STATE_PATH, state, state.dbxRev);
        if(res2.ok){
          state.dbxRev = res2.rev || state.dbxRev;
          saveLocalState(state);
          return;
        }
      }
      setMessage("Conflit Dropbox : réessaie plus tard.", "warn");
      return;
    }

    setMessage("Synchro Dropbox : échec d’enregistrement.", "warn");
  }

  async function loadStatePreferDropbox(){
    const local = loadLocalState();
    if(local && typeof local === "object"){
      state = Object.assign(defaultState(), local);
    }else{
      state = defaultState();
    }
    computeStats();

    const tokens = await refreshAccessTokenIfNeeded();
    if(!tokens){
      const b=$("#btnDropbox");
      if(b) b.textContent = "Connexion Dropbox";
      return;
    }
    const b=$("#btnDropbox");
    if(b) b.textContent = "Dropbox OK";

    const remote = await dbxDownloadJson(DROPBOX_STATE_PATH);
    if(remote.ok){
      const remoteState = remote.data || defaultState();
      const chooseRemote = (remoteState.updatedAt || 0) >= (state.updatedAt || 0);
      state = chooseRemote ? remoteState : state;
      state.dbxRev = remote.rev || state.dbxRev || null;
      saveLocalState(state);
      computeStats();
      setMessage("Synchro Dropbox : OK.", "ok");
      return;
    }

    if(remote.err === "not_found"){
      await persistState();
      return;
    }
  }

  // ====== WIRE ======
  function wire(){
    $("#btnNouveau").addEventListener("click", ()=>{
      const ok=pickSequence();
      if(ok) renderAll();
    });

    $("#btnValider").addEventListener("click", ()=>{
      validateWord($("#saisie").value);
      $("#saisie").value="";
      $("#saisie").focus();
    });
    $("#saisie").addEventListener("keydown",(e)=>{
      if(e.key==="Enter"){ e.preventDefault(); $("#btnValider").click(); }
    });

    $("#btnSolutions").addEventListener("click", showSolutions);

    $("#btnDropbox").addEventListener("click", async ()=>{
      try{
        const tokens = loadTokens();
        if(tokens && (tokens.refresh_token || hasValidAccessToken(tokens))){
          setMessage("Synchronisation…", "");
          await persistState();
          setMessage("Synchronisation terminée.", "ok");
          return;
        }
        oauthStart();
      }catch(err){
        console.error(err);
        setMessage("Connexion Dropbox : erreur.", "err");
      }
    });

    $("#liste").addEventListener("click",(e)=>{
      const tool=e.target.closest(".toolBtn");
      if(tool){
        const li=tool.closest(".slot");
        const i=Number(li.dataset.slot);
        const which=tool.dataset.tool;
        if(which==="def"){
          markAidUsed();
          openDef(targets[i].f || "", "", targets[i].c);
          return;
        }
        markAidUsed();
        if(found.has(i)) return;
        hintMode[i]=(hintMode[i]===which)?"none":which;
        applyHint(i);
        return;
      }
      const w=e.target.closest(".slotWordBtn");
      if(w){
        const li=w.closest(".slot");
        const i=Number(li.dataset.slot);
        if(!found.has(i)) return;
        openDef(w.dataset.def||"", w.dataset.word||"", w.dataset.canon||"");
      }
    });

    $("#defClose").addEventListener("click", closeDef);
    $("#defBackdrop").addEventListener("click", closeDef);

    document.addEventListener("keydown",(e)=>{
      if(e.key==="Escape") closeDef();
    });

    window.addEventListener("beforeunload", ()=>{
      saveLocalState(state);
    });
  }

  function renderAll(){
    renderBounds();
    renderSlots();
    $("#compteur").textContent="0/10";
    setMessage("");
    computeStats();
    $("#saisie").value="";
  }

  async function start(){
    // 1) wiring UI
    wire();

    // 2) OAuth redirect
    try{
      const connectedNow = await oauthHandleRedirectIfNeeded();
      if(connectedNow){
        const b=$("#btnDropbox");
        if(b) b.textContent = "Dropbox OK";
      }
    }catch(err){
      console.error(err);
      setMessage("Connexion Dropbox : erreur.", "err");
    }

    // 3) load state (local then Dropbox)
    await loadStatePreferDropbox();

    // 4) start a sequence
    const ok=pickSequence();
    if(ok) renderAll();

    // 5) autosync periodically
    setInterval(()=>{ persistState().catch(()=>{}); }, 60_000);
  }

  window.addEventListener("DOMContentLoaded", start);
})();

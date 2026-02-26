(function(){
  "use strict";
  const $ = (s)=>document.querySelector(s);

  function normalizeWord(s){
    return (s||"").toString().trim().toUpperCase().replace(/\s+/g,"").replace(/[’'`´]/g,"'");
  }
  function tirageFromC(c){
    const n = normalizeWord(c);
    return n.split("").sort((a,b)=>a.localeCompare(b,"fr")).join("");
  }
  function setMessage(t,k){
    const el=$("#msg");
    el.textContent=t||"";
    el.className=k?`msg ${k}`:"msg";
  }

  const STORE_KEY="SEQODS_STATE_V1";

  function loadState(){
    try{
      const raw=localStorage.getItem(STORE_KEY);
      if(!raw) return null;
      const o=JSON.parse(raw);
      if(!o || typeof o!=="object") return null;
      if(!o.sequences) o.sequences={};
      return o;
    }catch{ return null; }
  }
  function saveState(st){ localStorage.setItem(STORE_KEY, JSON.stringify(st)); }
  function ensureState(){
    let st=loadState();
    if(!st){ st={ sequences:{} }; saveState(st); }
    return st;
  }

  const DATA=window.SEQODS_DATA;
  const C=DATA.c, E=DATA.e, F=DATA.f, G=DATA.g, A=DATA.a||{};

  // séquences de 12 lignes : borneA + 10 réponses + borneB
  const sequences=[];
  for(let start=0; start+11<C.length; start+=12){
    sequences.push({ startIdx:start, endIdx:start+11 });
  }
  const TOTAL=sequences.length;

  let state=ensureState();
  let currentSeqIndex=-1;
  let seq=null;
  let targets=[]; // 10 items
  let found=new Set();
  let hintMode=Array(10).fill("none");
  let noHelpRun=true;

  function todayStr(){
    return new Intl.DateTimeFormat("fr-CA",{year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  }
  function parseDateLocal(s){
    const [y,m,d]=s.split("-").map(Number);
    return new Date(y,m-1,d);
  }
  function daysBetween(aStr,bStr){
    return Math.floor((parseDateLocal(bStr).getTime()-parseDateLocal(aStr).getTime())/86400000);
  }

  function computeStats(){
    const seqStates=state.sequences||{};
    let seen=0, validated=0;
    for(const k in seqStates){
      const st=seqStates[k];
      if(st && st.seen) seen++;
      if(st && st.validated) validated++;
    }
    const seenPct=Math.round((seen/TOTAL)*100);
    const valPct=Math.round((validated/TOTAL)*100);
    $("#seenCount").textContent=`${seen}/${TOTAL}`;
    $("#valCount").textContent=`${validated}/${TOTAL}`;
    $("#seenBar").style.width=`${seenPct}%`;
    $("#valBar").style.width=`${valPct}%`;
    return {seen, validated};
  }
  function allValidated(){ return computeStats().validated>=TOTAL; }

  function openEnd(){ $("#endModal").classList.add("open"); }
  function closeEnd(){ $("#endModal").classList.remove("open"); }

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

  function markAidUsed(){
    noHelpRun=false;
    const st = state.sequences[String(currentSeqIndex)] || {};
    st.noHelp=false;
    state.sequences[String(currentSeqIndex)]=st;
    saveState(state);
  }

  function eligibleIndexes(){
    const today=todayStr();
    const seqStates=state.sequences||{};
    const elig=[];
    for(let i=0;i<TOTAL;i++){
      const st=seqStates[String(i)];
      if(st && st.validated) continue;
      if(!st || !st.seen){ elig.push(i); continue; }
      const last=st.lastSeen;
      if(!last){ elig.push(i); continue; }
      if(daysBetween(last, today) >= 3) elig.push(i);
    }
    return elig;
  }

  function pickSequence(){
    if(allValidated()){ openEnd(); return false; }
    const elig=eligibleIndexes();
    if(elig.length===0){
      setMessage("Aucune liste disponible pour le moment.", "warn");
      return false;
    }
    currentSeqIndex = elig[Math.floor(Math.random()*elig.length)];
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

    const st=state.sequences[String(currentSeqIndex)] || {};
    st.seen=true;
    st.lastSeen=todayStr();
    if(typeof st.validated!=="boolean") st.validated=false;
    if(typeof st.noHelp!=="boolean") st.noHelp=true;
    state.sequences[String(currentSeqIndex)]=st;
    saveState(state);
    return true;
  }

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
    li.classList.add("filled");
    const btn=li.querySelector(".slotWordBtn");
    const txt=li.querySelector(".slotText");
    txt.textContent = targets[i].e; // affichage colonne E
    btn.dataset.def = targets[i].f || "";
    btn.dataset.word = targets[i].e || "";
    btn.dataset.canon = targets[i].c || "";
    hintMode[i]="none";
    applyHint(i);
  }

  function updateCounter(){
    $("#compteur").textContent=`${found.size}/10`;
    if(found.size===10){
      const st=state.sequences[String(currentSeqIndex)] || {};
      if(noHelpRun){
        st.validated=true;
        st.noHelp=true;
        state.sequences[String(currentSeqIndex)]=st;
        saveState(state);
        setMessage("Validée sans aide.", "ok");
        computeStats();
        if(allValidated()) openEnd();
      }else{
        st.validated=false;
        st.noHelp=false;
        state.sequences[String(currentSeqIndex)]=st;
        saveState(state);
        setMessage("Liste terminée, mais avec aide.", "warn");
      }
    }
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

  function initMobileKeyboard(){
    const isMobile = window.matchMedia && window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 900;
    const composeWrap=$("#mobileCompose");
    if(!composeWrap) return;
    composeWrap.style.display = isMobile ? "block" : "none";

    if(!isMobile) return;

    const kb=$("#kb"), box=$("#composeBox");
    const btnBack=$("#btnBack"), btnClear=$("#btnClear"), btnVal=$("#btnValiderMobile");
    const btnSol=$("#btnSolutionsMobile");

    let buffer="";

    function render(){ box.textContent = buffer || "—"; }
    function add(ch){ buffer+=ch; render(); }
    function back(){ buffer=buffer.slice(0,-1); render(); }
    function clear(){ buffer=""; render(); }
    function validate(){
      if(!buffer){ setMessage("Compose un mot.", "warn"); return; }
      validateWord(buffer);
      buffer=""; render();
    }

    // Build keyboard rows
    const rows=[
      {letters:"AZERTYUIOP", cls:"row1"},
      {letters:"QSDFGHJKLM", cls:"row2"},
      {letters:"WXCVBN", cls:"row3"},
    ];
    kb.innerHTML="";
    for(const row of rows){
      const div=document.createElement("div");
      div.className="kbRow "+row.cls;
      for(const ch of row.letters){
        const b=document.createElement("button");
        b.type="button";
        b.className="kbBtn";
        b.textContent=ch;
        b.addEventListener("click", ()=>add(ch));
        div.appendChild(b);
      }
      kb.appendChild(div);
    }

    btnBack.onclick=back;
    btnClear.onclick=clear;
    btnVal.onclick=validate;
    btnSol.onclick=showSolutions;
    render();
  }

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
    $("#endBackdrop").addEventListener("click", closeEnd);
    $("#btnCloseEnd").addEventListener("click", closeEnd);

    document.addEventListener("keydown",(e)=>{
      if(e.key==="Escape"){ closeDef(); closeEnd(); }
    });

    window.addEventListener("resize", initMobileKeyboard);
    window.addEventListener("orientationchange", initMobileKeyboard);
  }

  function renderAll(){
    renderBounds();
    renderSlots();
    $("#compteur").textContent="0/10";
    setMessage("");
    computeStats();
    $("#saisie").value="";
  }

  function start(){
    state=ensureState();
    wire();
    const ok=pickSequence();
    if(ok) renderAll();
    initMobileKeyboard();
  }

  window.addEventListener("DOMContentLoaded", start);
})();
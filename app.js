"use strict";
/* ══════════════════════════════════════════
   APP.JS — Orchestrateur
══════════════════════════════════════════ */

/* ── Settings ── */
const LS_SETTINGS = "METHODS_SETTINGS_V1";
let settings = {showAbc:true,showDef:true,showLen:true,chronoEnabled:true,chronoDur:10};

function loadSettings(){
  try{ Object.assign(settings, JSON.parse(localStorage.getItem(LS_SETTINGS)||"{}")); }catch{}
}
function saveSettings(){
  try{ localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); }catch{}
}

/* ── Détection clavier iOS ── */
function initKeyboardDetection(){
  if(!window.visualViewport) return;
  let lastH = window.visualViewport.height;
  window.visualViewport.addEventListener("resize", ()=>{
    const h = window.visualViewport.height;
    if(lastH - h > 100) document.body.classList.add("kb-open");
    else if(h - lastH > 50) document.body.classList.remove("kb-open");
    lastH = h;
  });
  document.addEventListener("focusin", e=>{
    if(e.target.tagName==="INPUT") setTimeout(()=>{
      if(window.visualViewport.height < window.screen.height*0.75)
        document.body.classList.add("kb-open");
    },300);
  });
  document.addEventListener("focusout", e=>{
    if(e.target.tagName==="INPUT") setTimeout(()=>document.body.classList.remove("kb-open"),100);
  });
}

/* ── Navigation entre vues ── */
function showView(id){
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active", v.id===id));
}

/* ── Auth ── */
function initAuth(){
  // Onglets
  document.querySelectorAll(".auth-tab").forEach(tab=>{
    tab.addEventListener("click", ()=>{
      document.querySelectorAll(".auth-tab").forEach(t=>t.classList.remove("active"));
      tab.classList.add("active");
      ["login","register","recover"].forEach(n=>{
        const f=document.getElementById("f-"+n);
        if(f) f.style.display=(n===tab.dataset.tab)?"flex":"none";
      });
      document.getElementById("auth-err").textContent="";
    });
  });

  const setErr=(t,ok=false)=>{
    const e=document.getElementById("auth-err");
    if(e){e.textContent=t;e.className="msg"+(ok?" ok":" err");}
  };
  const setLoad=on=>{
    ["btn-login","btn-register","btn-recover"].forEach(id=>{
      const b=document.getElementById(id); if(b) b.disabled=on;
    });
  };

  document.getElementById("btn-login")?.addEventListener("click", async()=>{
    const p=document.getElementById("login-pseudo")?.value||"";
    const pw=document.getElementById("login-pass")?.value||"";
    setLoad(true); setErr("");
    const r=await authLogin(p,pw);
    setLoad(false);
    if(!r.ok){setErr(r.err);return;}
    currentUser={pseudo:r.pseudo,token:r.token};
    saveSession(currentUser);
    await afterLogin();
  });

  document.getElementById("btn-register")?.addEventListener("click", async()=>{
    const p=document.getElementById("reg-pseudo")?.value||"";
    const pw=document.getElementById("reg-pass")?.value||"";
    const pw2=document.getElementById("reg-pass2")?.value||"";
    const secretQ=document.getElementById("reg-question")?.value||"";
    const secretA=document.getElementById("reg-answer")?.value||"";
    setLoad(true); setErr("");
    const r=await authRegister(p,pw,pw2,secretQ,secretA);
    setLoad(false);
    if(!r.ok){setErr(r.err);return;}
    currentUser={pseudo:r.pseudo,token:r.token};
    saveSession(currentUser);
    await afterLogin();
  });

  document.getElementById("btn-find-question")?.addEventListener("click", async()=>{
    const p=document.getElementById("rec-pseudo")?.value||"";
    setLoad(true); setErr("");
    const r=await authGetQuestion(p);
    setLoad(false);
    if(!r.ok){setErr(r.err);return;}
    const qDiv=document.getElementById("rec-question-display");
    if(qDiv){qDiv.textContent=r.question;qDiv.style.display="";}
    ["rec-answer","rec-new","btn-recover"].forEach(id=>{
      const el=document.getElementById(id); if(el) el.style.display="";
    });
  });

  document.getElementById("btn-recover")?.addEventListener("click", async()=>{
    const p=document.getElementById("rec-pseudo")?.value||"";
    const ans=document.getElementById("rec-answer")?.value||"";
    const np=document.getElementById("rec-new")?.value||"";
    setLoad(true); setErr("");
    const r=await authRecover(p,ans,np);
    setLoad(false);
    if(!r.ok){setErr(r.err);return;}
    setErr("Mot de passe changé. Reconnecte-toi.",true);
  });

  // Enter pour valider
  [["login-pass","btn-login"],["reg-answer","btn-register"],["rec-new","btn-recover"]].forEach(([inp,btn])=>{
    document.getElementById(inp)?.addEventListener("keydown",e=>{
      if(e.key==="Enter") document.getElementById(btn)?.click();
    });
  });
}

/* ── Après login ── */
async function afterLogin(){
  await Promise.all([loadMethodsState(), loadThemodsState(), loadEntreModsState()]);
  ["user-chip","tm-user-chip","em-user-chip"].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.textContent=currentUser.pseudo;
  });
  showView("v-select");
  setDictBtnVisible(true);
  // interval auto-persist
  setInterval(()=>{ persistMethodsState().catch(()=>{}); persistThemods().catch(()=>{}); persistEntreModsState().catch(()=>{}); }, 60000);
}

/* ── Select ── */
function initSelect(){
  document.getElementById("btn-go-entremods")?.addEventListener("click", ()=>{
    showView("v-entremods");
    ensureEntreModsInit();
  });
  document.getElementById("btn-go-themods")?.addEventListener("click", ()=>{
    showView("v-themods");
    initThemods();
  });
}

/* ── Navigation globale ── */
function initNav(){
  // METHODS → THEMODS
  document.getElementById("btn-to-themods")?.addEventListener("click", ()=>{
    chronoStop();
    showView("v-themods");
    setDictBtnVisible(true);
    initThemods();
  });
  // THEMODS → ENTREMODS
  document.getElementById("btn-tm-back")?.addEventListener("click", ()=>{
    showView("v-entremods");
    ensureEntreModsInit();
  });
  // ENTREMODS → THEMODS
  document.getElementById("em-btn-to-themods")?.addEventListener("click", ()=>{
    emChronoStop();
    showView("v-themods");
    setDictBtnVisible(true);
    initThemods();
  });
  // Déconnexion (METHODS + THEMODS + ENTREMODS)
  const doLogout=()=>{ chronoStop(); emChronoStop(); clearSession(); currentUser=null; setDictBtnVisible(false); showView("v-auth"); };
  document.getElementById("btn-logout")?.addEventListener("click", doLogout);
  document.getElementById("btn-tm-logout")?.addEventListener("click", doLogout);
  document.getElementById("em-btn-logout")?.addEventListener("click", doLogout);
  // Settings — shared panel
  document.getElementById("btn-tm-settings")?.addEventListener("click", ()=>openSettingsPanel());
  document.getElementById("em-btn-settings")?.addEventListener("click", ()=>openSettingsPanel());
  // F1
  document.addEventListener("keydown", e=>{
    if(e.key==="F1"){
      e.preventDefault();
      const v=document.querySelector(".view.active")?.id;
      if(v==="v-methods" && mSolutionsShown) methodsReplay();
      if(v==="v-themods") tmReplay();
      if(v==="v-entremods") emReplay();
    }
    if(e.key==="Escape") closeDef();
  });
}

/* ── Settings UI ── */
function openSettingsPanel(){
  document.getElementById("set-abc").checked=settings.showAbc;
  document.getElementById("set-def").checked=settings.showDef;
  document.getElementById("set-len").checked=settings.showLen;
  document.getElementById("set-chrono").checked=settings.chronoEnabled;
  document.getElementById("set-dur").value=settings.chronoDur;
  document.getElementById("chrono-lbl").textContent=settings.chronoDur+" min";
  document.getElementById("row-dur").style.display=settings.chronoEnabled?"":"none";
  document.getElementById("settings")?.classList.add("open");
}
function initSettingsUI(){
  document.getElementById("btn-settings")?.addEventListener("click", ()=>openSettingsPanel());
  const close=()=>document.getElementById("settings")?.classList.remove("open");
  document.getElementById("btn-close-settings")?.addEventListener("click",close);
  document.getElementById("settings-bd")?.addEventListener("click",close);

  document.getElementById("set-abc")?.addEventListener("change",e=>{settings.showAbc=e.target.checked;saveSettings();renderSlots();});
  document.getElementById("set-def")?.addEventListener("change",e=>{settings.showDef=e.target.checked;saveSettings();renderSlots();});
  document.getElementById("set-len")?.addEventListener("change",e=>{settings.showLen=e.target.checked;saveSettings();renderSlots();});
  document.getElementById("set-chrono")?.addEventListener("change",e=>{
    settings.chronoEnabled=e.target.checked;
    document.getElementById("row-dur").style.display=e.target.checked?"":"none";
    saveSettings();
    if(!e.target.checked) chronoStop();
  });
  document.getElementById("set-dur")?.addEventListener("input",e=>{
    settings.chronoDur=parseInt(e.target.value);
    document.getElementById("chrono-lbl").textContent=settings.chronoDur+" min";
    saveSettings();
  });
}

/* ── START ── */
async function start(){
  loadSettings();
  initKeyboardDetection();
  wireDefModal();
  wireDictModal();
  initAuth();
  initSelect();
  initNav();
  initSettingsUI();

  const saved=loadSession();
  if(saved?.pseudo){
    currentUser=saved;
    await afterLogin();
    return;
  }
  showView("v-auth");
}

document.addEventListener("DOMContentLoaded", start);

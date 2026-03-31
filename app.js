"use strict";
/* ══════════════════════════════════════════
   APP_NEW.JS — Orchestrateur principal
   Gère : auth, navigation entre vues, select
══════════════════════════════════════════ */


/* ── Détection clavier iOS ── */
function initKeyboardDetection(){
  if(!window.visualViewport) return;
  let lastH = window.visualViewport.height;
  window.visualViewport.addEventListener("resize", ()=>{
    const h = window.visualViewport.height;
    const diff = lastH - h;
    if(diff > 100) document.body.classList.add("kb-open");
    else if(diff < -50) document.body.classList.remove("kb-open");
    lastH = h;
  });
  document.addEventListener("focusin", e=>{
    if(e.target.tagName==="INPUT") setTimeout(()=>{
      if(window.visualViewport.height < window.screen.height * 0.75)
        document.body.classList.add("kb-open");
    }, 300);
  });
  document.addEventListener("focusout", e=>{
    if(e.target.tagName==="INPUT") setTimeout(()=>{
      document.body.classList.remove("kb-open");
    }, 100);
  });
}

async function start(){
  // Charger paramètres
  loadSettings();
  initKeyboardDetection();

  // Wirer la modale définition et les settings
  wireDefModal();
  wireSettingsUI();

  // Auth : session existante ?
  const saved = loadSession();
  if(saved?.pseudo && saved?.token){
    currentUser = saved;
    await onLogin();
    return;
  }
  // Sinon afficher l'auth
  showView("v-auth");
  wireAuthUI(async (pseudo, token)=>{
    currentUser = {pseudo, token};
    saveSession(currentUser);
    await onLogin();
  });
}

// Appelé après connexion réussie
async function onLogin(){
  // Charger les états METHODS et THEMODS depuis Firebase
  await Promise.all([
    loadMethodsState(),
    loadThemodsState(),
  ]);
  // Mettre à jour le chip utilisateur
  const chip = $("#user-chip");
  if(chip) chip.textContent = currentUser.pseudo;
  // Afficher la sélection
  showView("v-select");
  wireSelectUI();
}

function wireSelectUI(){
  $("#btn-go-methods")?.addEventListener("click", ()=>{
    showView("v-methods");
    initMethods();
  }, {once:true});
  $("#btn-go-themods")?.addEventListener("click", ()=>{
    showView("v-themods");
    initThemods();
  }, {once:true});
}

// Retour depuis METHODS ou THEMODS → select
function goToSelect(){
  showView("v-select");
  // Re-wirer les boutons select (once les a consommés)
  wireSelectUI();
}

/* ── Settings ── */
const LS_SETTINGS = "METHODS_SETTINGS_V1";
let settings = {
  showAbc:true, showDef:true, showLen:true,
  chronoEnabled:true, chronoDur:10
};

function loadSettings(){
  try{ Object.assign(settings, JSON.parse(localStorage.getItem(LS_SETTINGS)||"{}")); }catch{}
}
function saveSettings(){
  try{ localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); }catch{}
}

function wireSettingsUI(){
  const overlay = $("#settings");
  $("#btn-settings")?.addEventListener("click", ()=>{
    // Sync UI avec état courant
    $("#set-abc").checked = settings.showAbc;
    $("#set-def").checked = settings.showDef;
    $("#set-len").checked = settings.showLen;
    $("#set-chrono").checked = settings.chronoEnabled;
    $("#set-dur").value = settings.chronoDur;
    $("#chrono-lbl").textContent = settings.chronoDur + " min";
    $("#row-dur").style.display = settings.chronoEnabled ? "" : "none";
    overlay.classList.add("open");
  });
  const close = () => overlay.classList.remove("open");
  $("#btn-close-settings")?.addEventListener("click", close);
  $("#settings-bd")?.addEventListener("click", close);
  ["abc","def","len","chrono"].forEach(k=>{
    const el = document.getElementById("set-"+k);
    if(!el) return;
    el.addEventListener("change", ()=>{
      if(k==="abc") settings.showAbc=el.checked;
      if(k==="def") settings.showDef=el.checked;
      if(k==="len") settings.showLen=el.checked;
      if(k==="chrono"){
        settings.chronoEnabled=el.checked;
        $("#row-dur").style.display=el.checked?"":"none";
      }
      saveSettings();
      applyHintSettings(); // rafraîchir METHODS si actif
    });
  });
  $("#set-dur")?.addEventListener("input", e=>{
    settings.chronoDur = parseInt(e.target.value);
    $("#chrono-lbl").textContent = settings.chronoDur + " min";
    saveSettings();
  });

  // Déconnexion
  $("#btn-logout")?.addEventListener("click", ()=>{
    clearSession();
    chronoStop();
    showView("v-auth");
  });

  // Navigation METHODS → THEMODS et vice versa
  $("#btn-to-themods")?.addEventListener("click", ()=>{
    chronoStop();
    showView("v-themods");
    renderTmHome();
  });
  $("#btn-tm-back")?.addEventListener("click", ()=>{
    showView("v-methods");
  });

  // F1 : relancer
  document.addEventListener("keydown", e=>{
    if(e.key==="F1"){
      e.preventDefault();
      const v = document.querySelector(".view.active");
      if(v?.id==="v-methods") methodsReplay();
      if(v?.id==="v-themods") tmReplay();
    }
    if(e.key==="Escape") closeDef();
  });
}

document.addEventListener("DOMContentLoaded", start);

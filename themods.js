"use strict";
/* ══════════════════════════════════════════
   THEMODS.JS
══════════════════════════════════════════ */

/* ── État ── */
const LS_THEMODS = () => "THEMODS_STATE_" + (currentUser?.pseudo||"guest");
let tmState = null;
let tmKb = null;
let tmInited = false;

function tmDefault(){ return {updatedAt:0, themes:{}}; }
function tmLoadLocal(){ try{ return JSON.parse(localStorage.getItem(LS_THEMODS())||"null")||tmDefault(); }catch{ return tmDefault(); } }
function tmSaveLocal(){ try{ localStorage.setItem(LS_THEMODS(), JSON.stringify(tmState)); }catch{} }

async function loadThemodsState(){
  tmState = tmLoadLocal();
  if(!currentUser) return;
  const r = await fbGet("themods", currentUser.pseudo.toLowerCase());
  if(r.ok && r.data && (r.data.updatedAt||0) > (tmState.updatedAt||0)) tmState = r.data;
  tmSaveLocal();
}
async function persistThemods(){
  if(!currentUser) return;
  tmState.updatedAt = Date.now();
  tmSaveLocal();
  await fbSet("themods", currentUser.pseudo.toLowerCase(), tmState);
}

function getSt(theme, label){
  if(!tmState.themes[theme]) tmState.themes[theme]={};
  if(!tmState.themes[theme][label]) tmState.themes[theme][label]={seen:false,validated:false,lastResult:"",lastSeen:"",interval:1,due:todayStr()};
  return tmState.themes[theme][label];
}

/* ── Dict ODS ── */
let TM_DICT = null;
function getTmDict(){
  if(!TM_DICT){ const d=window.SEQODS_DATA?.d; TM_DICT=d?new Set(d):new Set(); }
  return TM_DICT;
}

/* ── État jeu ── */
let tmTheme=null, tmSession=null;
let tmFound=new Set(), tmSolutions=false, tmNoHelp=true;
let gmEntryIdx=0, gmFound=new Set();

/* ── Navigation sous-vues ── */
function showTmView(id){
  document.querySelectorAll("#v-themods .tmv").forEach(v=>{
    v.classList.toggle("active", v.id===id);
  });
  // Clavier mobile : visible seulement en jeu
  const kb = document.getElementById("tm-kb");
  if(kb) kb.style.display = (id==="tv-game") ? "" : "none";
}

/* ── Accueil ── */
function renderTmHome(){
  showTmView("tv-home");
  updateTmStats();
}

function renderTmFinales(){
  showTmView("tv-finales");
  updateFinalesStats();
}

function updateTmStats(){
  if(!tmState) return;
  // GM
  const prog=getGMProgress();
  const gmTotal=getAllGMEntries().length;
  const gmEl=document.getElementById("gm-desc");
  if(gmEl) gmEl.textContent="1 808 groupes · "+prog.done+"/"+gmTotal+" résolus";

  // Finales
  const finales=["able","age","ique","oir"];
  let totalSess=0, totalVal=0;
  finales.forEach(th=>{
    const d=window.THEMODS_DATA?.[th]; if(!d) return;
    totalSess+=d.length;
    d.forEach(({label})=>{ if(getSt(th,label).validated) totalVal++; });
  });
  const fEl=document.getElementById("finales-desc");
  if(fEl) fEl.textContent="4 finales · 2 488 mots"+(totalVal>0?" · "+totalVal+"/"+totalSess+" validées":"");

  // VI
  const viData=window.THEMODS_DATA?.vi||[];
  let viVal=0;
  viData.forEach(({label})=>{ if(getSt("vi",label).validated) viVal++; });
  const viEl=document.getElementById("vi-desc");
  if(viEl) viEl.textContent="575 verbes · 193 sessions"+(viVal>0?" · "+viVal+"/"+viData.length+" val.":"");
}

function updateFinalesStats(){
  const bases={able:"293 mots · 136 sessions",age:"1 311 mots · 360 sessions",ique:"629 mots · 177 sessions",oir:"253 mots · 99 sessions"};
  ["able","age","ique","oir"].forEach(th=>{
    const d=window.THEMODS_DATA?.[th]; if(!d) return;
    let val=0; d.forEach(({label})=>{ if(getSt(th,label).validated) val++; });
    const el=document.getElementById(th+"-desc");
    if(el) el.textContent=bases[th]+(val>0?" · "+val+"/"+d.length+" val.":"");
  });
}

/* ── Lancement session ── */
function showSrsPrompt(theme, srsPool){
  const prompt=document.getElementById("tm-srs-prompt"); if(!prompt) return;
  const n=srsPool.length;
  const countEl=document.getElementById("tm-srs-count");
  if(countEl) countEl.textContent=n+" liste"+(n>1?"s":"");
  // Clone buttons to clear stale listeners
  ["tm-srs-ok","tm-srs-skip"].forEach(id=>{
    const old=document.getElementById(id); if(!old) return;
    const fresh=old.cloneNode(true); old.parentNode.replaceChild(fresh,old);
  });
  document.getElementById("tm-srs-ok")?.addEventListener("click",()=>{
    prompt.style.display="none";
    startSession(theme, srsPool[Math.floor(Math.random()*srsPool.length)]);
  });
  document.getElementById("tm-srs-skip")?.addEventListener("click",()=>{
    prompt.style.display="none";
  });
  prompt.style.display="";
}

function playTheme(theme){
  tmTheme=theme;
  if(theme==="gm"){ startGM(); return; }
  const data=window.THEMODS_DATA?.[theme]; if(!data) return;
  const today=todayStr();
  const prompt=document.getElementById("tm-srs-prompt"); if(prompt) prompt.style.display="none";
  const msg=document.getElementById("tm-home-msg"); if(msg){msg.textContent="";msg.className="tm-msg";}

  const unseenPool=data.filter(({label})=>!getSt(theme,label).seen);
  const srsPool=data.filter(({label})=>{ const s=getSt(theme,label); return s.seen&&!s.validated&&s.due<=today; });

  if(unseenPool.length){ startSession(theme, unseenPool[Math.floor(Math.random()*unseenPool.length)]); return; }
  if(srsPool.length){ showSrsPrompt(theme, srsPool); return; }
  if(msg){msg.textContent="Toutes les sessions sont validées !";msg.className="tm-msg ok";}
}

function startSession(theme, session){
  tmSession=session; tmFound=new Set(); tmSolutions=false; tmNoHelp=true;
  const edBtn=document.getElementById("gm-ed-btn"); if(edBtn) edBtn.style.display="none";
  showTmView("tv-game");
  renderTmGame();
  updateTmBtn();
  setTmMsg("");
  if(tmKb) tmKb.clear();
  setTimeout(()=>{ if(window.matchMedia("(pointer:fine)").matches) document.getElementById("tm-saisie")?.focus(); },80);
}

/* ── Rendu jeu ── */
const THEME_NAMES={age:"Finale -AGE",vi:"Intransitifs",oir:"Finale -OIR",able:"Finale -ABLE",ique:"Finale -IQUE",gm:"Graphies multiples"};
const THEME_SFX={age:"AGE",vi:"",oir:"OIR",able:"ABLE",ique:"IQUE",gm:""};

function renderTmGame(){
  if(tmTheme==="gm"){ renderGMGame(); return; }
  const sess=tmSession; if(!sess) return;

  const el=id=>document.getElementById(id);
  const sfx=THEME_SFX[tmTheme];
  if(el("tm-gtitle")) el("tm-gtitle").textContent=THEME_NAMES[tmTheme]||tmTheme;
  if(el("tm-session-label")) el("tm-session-label").textContent=sess.label+(sfx?"…"+sfx:"…");

  const list=el("tm-wlist"); if(!list) return;
  list.innerHTML="";
  sess.words.forEach((word,i)=>{
    const li=document.createElement("li");
    li.dataset.idx=i; li.className="slot";
    if(tmFound.has(i)){
      li.classList.add("found","clickable");
      li.textContent=word;
      li.addEventListener("click",()=>openDef(norm(word),word));
    } else if(tmSolutions){
      li.classList.add("revealed","clickable");
      li.textContent=word;
      li.addEventListener("click",()=>openDef(norm(word),word));
    }
    list.appendChild(li);
  });
}

function validateTmWord(raw){
  if(tmTheme==="gm"){ validateGMWord(norm(raw)); return; }
  if(tmSolutions) return;
  const n=norm(raw); if(!n) return;
  const sess=tmSession; if(!sess) return;
  const matched=[];
  sess.words.forEach((w,i)=>{ if(!tmFound.has(i)&&norm(w)===n) matched.push(i); });
  if(!matched.length){
    setTmMsg(getTmDict().has(n)?"Hors-jeu — mot valide mais pas dans cette liste.":"Mot inconnu — la partie s'arrête.",
             getTmDict().has(n)?"warn":"err");
    if(!getTmDict().has(n)) setTimeout(()=>showTmSolutions(),800);
    return;
  }
  matched.forEach(i=>{
    tmFound.add(i);
    const li=document.querySelector("#tm-wlist li[data-idx='"+i+"']");
    if(li){
      li.className="slot found clickable";
      li.textContent=sess.words[i];
      li.addEventListener("click",()=>openDef(norm(sess.words[i]),sess.words[i]));
      li.scrollIntoView({behavior:"smooth",block:"nearest"});
    }
  });
  setTmMsg("");
  const ctr=document.getElementById("tm-counter");
  if(ctr) ctr.textContent=tmFound.size+" / "+sess.words.length;
  if(tmFound.size===sess.words.length) finalizeTm(tmNoHelp);
  else persistThemods().catch(()=>{});
}

function showTmSolutions(){
  tmNoHelp=false;
  if(tmTheme==="gm"){ tmSolutions=true; renderGMGame(); updateTmBtn(); return; }
  const sess=tmSession; if(!sess) return;
  sess.words.forEach((w,i)=>{
    if(!tmFound.has(i)){
      tmFound.add(i);
      const li=document.querySelector("#tm-wlist li[data-idx='"+i+"']");
      if(li){
        li.className="slot revealed clickable";
        li.textContent=w;
        li.addEventListener("click",()=>openDef(norm(w),w));
      }
    }
  });
  const ctr=document.getElementById("tm-counter");
  if(ctr) ctr.textContent=tmFound.size+" / "+sess.words.length;
  finalizeTm(false);
}

function finalizeTm(ok){
  tmSolutions=true;
  updateTmBtn();
  const s=getSt(tmTheme, tmSession?.label||"");
  s.seen=true; s.lastSeen=todayStr();
  if(ok){
    s.validated=true; s.lastResult="ok";
    s.interval=nextInterval(s.interval||1); s.due=addDays(todayStr(),s.interval);
    setTmMsg("Validée sans aide ✓","ok");
  } else {
    s.validated=false; s.lastResult="help";
    s.interval=3; s.due=addDays(todayStr(),3);
    setTmMsg("Session terminée.","warn");
  }
  persistThemods().catch(()=>{});
}

function isGMResolved(){
  const entry=currentGMEntry(); if(!entry) return false;
  return tmSolutions||entry.forms.every(f=>gmFound.has(norm(f)));
}

function updateTmBtn(){
  const sol=document.getElementById("tm-btn-sol");
  const solKb=document.getElementById("tm-btn-sol-kb");
  const isGM=tmTheme==="gm";

  [sol,solKb].forEach(b=>{
    if(!b) return;
    if(isGM){
      b.style.display="";
      if(isGMResolved()){
        b.textContent="Jouer"; b.classList.remove("btn-danger"); b.classList.add("btn-primary");
      } else {
        b.textContent="Solutions"; b.classList.add("btn-danger"); b.classList.remove("btn-primary");
      }
      return;
    }
    b.style.display="";
    if(tmSolutions){
      b.textContent="Jouer"; b.classList.remove("btn-danger"); b.classList.add("btn-primary");
    } else {
      b.textContent="Solutions"; b.classList.add("btn-danger"); b.classList.remove("btn-primary");
    }
  });
}

function setTmMsg(t,c){
  const m=document.getElementById("tm-msg");
  if(m){m.textContent=t;m.className="msg"+(c?" "+c:"");}
  if(tmKb) tmKb.setMsg(t,c);
}

function tmReplay(){
  if(tmTheme) playTheme(tmTheme);
  else renderTmHome();
}

/* ── GM éditeur ── */
let gmEdPendingImg = undefined; // undefined=inchangé, null=effacé, string=nouvelle image

function gmEntryKey(entry){
  return entry.forms.slice().map(f=>norm(f)).sort().join("|");
}
function gmGetCustom(entry){
  return tmState.themes?.gm?._custom?.[gmEntryKey(entry)] || {};
}
function gmSetCustom(entry, data){
  if(!tmState.themes) tmState.themes={};
  if(!tmState.themes.gm) tmState.themes.gm={};
  if(!tmState.themes.gm._custom) tmState.themes.gm._custom={};
  const k=gmEntryKey(entry);
  const prev=tmState.themes.gm._custom[k]||{};
  tmState.themes.gm._custom[k]={...prev,...data};
  persistThemods().catch(()=>{});
}

function openGMEditor(){
  const entry=currentGMEntry(); if(!entry) return;
  const custom=gmGetCustom(entry);
  gmEdPendingImg=undefined;
  const defEl=document.getElementById("gm-ed-def");
  const imgEl=document.getElementById("gm-ed-img");
  const imgWrap=document.getElementById("gm-ed-img-wrap");
  const delBtn=document.getElementById("gm-ed-del-img");
  if(defEl) defEl.value=custom.def!==undefined?custom.def:(cleanDef(entry.def)||"");
  if(imgEl) imgEl.src=custom.img||"";
  if(imgWrap) imgWrap.style.display=custom.img?"":"none";
  if(delBtn) delBtn.style.display=custom.img?"":"none";
  document.getElementById("gm-editor").style.display="";
  setTimeout(()=>defEl?.focus(),80);
}
function closeGMEditor(){
  document.getElementById("gm-editor").style.display="none";
  gmEdPendingImg=undefined;
}
function saveGMEditor(){
  const entry=currentGMEntry(); if(!entry) return;
  const defEl=document.getElementById("gm-ed-def");
  const data={};
  if(defEl) data.def=defEl.value.trim();
  if(gmEdPendingImg!==undefined){
    // Supprimer l'ancienne image Storage si elle est remplacée/effacée
    const prev=gmGetCustom(entry).img;
    if(prev&&prev.includes("firebasestorage")){
      const pathMatch=prev.match(/\/o\/([^?]+)/);
      if(pathMatch) fbStorageDelete(decodeURIComponent(pathMatch[1])).catch(()=>{});
    }
    data.img=gmEdPendingImg; // null=effacé, string=URL Storage
  }
  gmSetCustom(entry, data);
  closeGMEditor();
  renderGMGame();
}
async function pasteGMImage(){
  try{
    const items=await navigator.clipboard.read();
    for(const item of items){
      const imgType=item.types.find(t=>t.startsWith("image/"));
      if(imgType){
        const blob=await item.getType(imgType);
        const jpegBlob=await resizeGMImage(blob,500);
        // Aperçu immédiat
        const previewUrl=URL.createObjectURL(jpegBlob);
        const imgEl=document.getElementById("gm-ed-img");
        const imgWrap=document.getElementById("gm-ed-img-wrap");
        const delBtn=document.getElementById("gm-ed-del-img");
        if(imgEl) imgEl.src=previewUrl;
        if(imgWrap) imgWrap.style.display="";
        if(delBtn) delBtn.style.display="";
        // Upload Firebase Storage
        setTmMsg("Envoi…","warn");
        const entry=currentGMEntry(); if(!entry) return;
        const path=`gmimages/${currentUser?.pseudo||"guest"}/${gmEntryKey(entry)}.jpg`;
        try{
          const storageUrl=await fbStorageUpload(path, jpegBlob);
          gmEdPendingImg=storageUrl;
          URL.revokeObjectURL(previewUrl);
          if(imgEl) imgEl.src=storageUrl;
          setTmMsg("Image ajoutée.","ok");
        }catch(e){
          setTmMsg("Erreur upload : "+e.message,"err");
          gmEdPendingImg=null; // annule
          if(imgWrap) imgWrap.style.display="none";
        }
        return;
      }
    }
    setTmMsg("Aucune image dans le presse-papier.","warn");
  }catch(e){
    setTmMsg("Accès presse-papier refusé.","err");
  }
}
function resizeGMImage(blob, maxW){
  return new Promise(resolve=>{
    const img=new Image(), url=URL.createObjectURL(blob);
    img.onload=()=>{
      URL.revokeObjectURL(url);
      const scale=Math.min(1,maxW/img.width);
      const c=document.createElement("canvas");
      c.width=Math.round(img.width*scale); c.height=Math.round(img.height*scale);
      c.getContext("2d").drawImage(img,0,0,c.width,c.height);
      c.toBlob(b=>resolve(b),"image/jpeg",0.75);
    };
    img.src=url;
  });
}

/* ── Graphies multiples ── */
function getAllGMEntries(){
  const all=[];
  (window.THEMODS_DATA?.gm||[]).forEach(s=>{ (s.entries||[]).forEach(e=>all.push(e)); });
  return all;
}
function shuffleArray(arr){
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
function getGMProgress(){
  if(!tmState.themes) tmState.themes={};
  if(!tmState.themes.gm) tmState.themes.gm={};
  if(!tmState.themes.gm._p) tmState.themes.gm._p={idx:0,done:0,order:null};
  return tmState.themes.gm._p;
}
function currentGMEntry(){
  const all=getAllGMEntries(), prog=getGMProgress();
  const realIdx=prog.order?.[gmEntryIdx];
  return realIdx!==undefined ? all[realIdx] : null;
}
function cleanDef(d){
  if(!d) return "";
  d=d.replace(/^(?:ou\s+)?\[[^\]]*\]\s*/i,"").replace(/^\([^)]*\)\s*/,"");
  return d.startsWith("->") ? "" : d.trim();
}
function letterCount(w){ return w.replace(/[Œœ]/g,"OE").replace(/[Ææ]/g,"AE").replace(/[^A-Za-zÀ-ÿ]/g,"").length; }

function startGM(){
  const all=getAllGMEntries(), prog=getGMProgress();
  if(!prog.order||prog.order.length!==all.length){
    prog.order=shuffleArray(all.map((_,i)=>i));
    prog.idx=0; prog.done=0;
  }
  gmEntryIdx=prog.idx; gmFound=new Set(); tmSolutions=false; tmNoHelp=true;
  showTmView("tv-game");
  const edBtn=document.getElementById("gm-ed-btn"); if(edBtn) edBtn.style.display="";
  document.getElementById("tm-gtitle").textContent="Graphies multiples";
  const lbl=document.getElementById("tm-session-label"); if(lbl) lbl.textContent="";
  updateTmBtn(); setTmMsg(""); renderGMGame();
  if(tmKb) tmKb.clear();
  setTimeout(()=>{ if(window.matchMedia("(pointer:fine)").matches) document.getElementById("tm-saisie")?.focus(); },80);
}

function renderGMGame(){
  const all=getAllGMEntries(), prog=getGMProgress();
  const entry=currentGMEntry();
  const list=document.getElementById("tm-wlist"); if(!list) return;
  list.innerHTML="";
  const lbl=document.getElementById("tm-session-label");
  if(lbl) lbl.textContent="";
  if(!entry){ setTmMsg("Toutes les entrées terminées !","ok"); return; }

  const sortedForms=[...entry.forms].sort((a,b)=>letterCount(a)-letterCount(b));
  const allFormsFound=sortedForms.every(f=>gmFound.has(norm(f)));

  const custom=gmGetCustom(entry);
  const defDiv=document.createElement("div");
  defDiv.className="gm-def";
  if(custom.img){
    const img=document.createElement("img");
    img.src=custom.img; img.alt="";
    img.style.cssText="max-width:100%;max-height:180px;border-radius:8px;display:block;margin:0 auto 10px;object-fit:contain;";
    defDiv.appendChild(img);
  }
  const defText=document.createElement("span");
  defText.textContent=(custom.def!==undefined?custom.def:cleanDef(entry.def))||"…";
  if(custom.def!==undefined||custom.img){
    const mark=document.createElement("span");
    mark.textContent=" ✎"; mark.style.cssText="font-size:10px;opacity:.45;";
    defText.appendChild(mark);
  }
  defDiv.appendChild(defText);
  list.appendChild(defDiv);

  const tilesDiv=document.createElement("div");
  tilesDiv.className="gm-tiles";
  sortedForms.forEach(form=>{
    const isFound=gmFound.has(norm(form))||allFormsFound;
    const revealed=isFound||tmSolutions;
    const letters=form.replace(/[Œœ]/g,"OE").replace(/[Ææ]/g,"AE").replace(/[^A-Za-zÀ-ÿ]/g,"").toUpperCase();
    const row=document.createElement("div"); row.className="gm-row";
    for(let i=0;i<letters.length;i++){
      const t=document.createElement("span");
      if(revealed){ t.className="gt "+(isFound?"ok":"miss"); t.textContent=letters[i].toUpperCase(); }
      else if(i===0){ t.className="gt init"; t.textContent=letters[0].toUpperCase(); }
      else { t.className="gt empty"; }
      row.appendChild(t);
    }
    tilesDiv.appendChild(row);
  });
  list.appendChild(tilesDiv);
}

function validateGMWord(n){
  const entry=currentGMEntry(); if(!entry) return;
  if(!entry.forms.find(f=>norm(f)===n)){
    setTmMsg(getTmDict().has(n)?"Hors-jeu — mot valide mais pas dans cette liste.":"Mot non valide.",
             getTmDict().has(n)?"warn":"err");
    return;
  }
  gmFound.add(n); setTmMsg("");
  const allFound=entry.forms.every(f=>gmFound.has(norm(f)));
  if(allFound){
    const prog=getGMProgress();
    prog.done=(prog.done||0)+1; prog.idx=gmEntryIdx+1;
    setTmMsg("✓ Toutes les graphies trouvées !","ok");
    persistThemods().catch(()=>{});
  }
  renderGMGame();
  updateTmBtn();
}

/* ── Init (une seule fois) ── */
function initThemods(){
  if(!tmInited){
    tmInited=true;

    tmKb = wireKeyboard("tm-kb","tm-kb-disp","tm-kb-msg", w=>validateTmWord(w));

    document.getElementById("tm-saisie")?.addEventListener("keydown",e=>{
      if(e.key==="Enter"&&!e.isComposing){
        e.preventDefault(); validateTmWord(e.target.value); e.target.value="";
      }
    });

    const onSolBtn=()=>{
      if(tmTheme==="gm"){
        if(isGMResolved()){
          const prog=getGMProgress();
          gmEntryIdx++; prog.idx=gmEntryIdx;
          gmFound=new Set(); tmSolutions=false;
          updateTmBtn(); setTmMsg(""); renderGMGame();
          if(tmKb) tmKb.clear();
          persistThemods().catch(()=>{});
        } else { showTmSolutions(); }
      } else {
        tmSolutions ? playTheme(tmTheme) : showTmSolutions();
      }
    };
    document.getElementById("tm-btn-sol")?.addEventListener("click", onSolBtn);
    document.getElementById("tm-btn-sol-kb")?.addEventListener("click", onSolBtn);

    document.getElementById("btn-back-game")?.addEventListener("click",()=>renderTmHome());

    // GM éditeur
    document.getElementById("gm-ed-btn")?.addEventListener("click",()=>openGMEditor());
    document.getElementById("gm-ed-close")?.addEventListener("click",()=>closeGMEditor());
    document.getElementById("gm-ed-cancel")?.addEventListener("click",()=>closeGMEditor());
    document.getElementById("gm-ed-save")?.addEventListener("click",()=>saveGMEditor());
    document.getElementById("gm-ed-paste")?.addEventListener("click",()=>pasteGMImage());
    document.getElementById("gm-ed-del-img")?.addEventListener("click",()=>{
      gmEdPendingImg=null;
      const imgWrap=document.getElementById("gm-ed-img-wrap");
      const delBtn=document.getElementById("gm-ed-del-img");
      if(imgWrap) imgWrap.style.display="none";
      if(delBtn) delBtn.style.display="none";
    });
    document.getElementById("gm-ed-search")?.addEventListener("click",()=>{
      const entry=currentGMEntry(); if(!entry) return;
      const word=entry.forms[0].replace(/[Œœ]/g,"oe").replace(/[Ææ]/g,"ae");
      window.open("https://www.google.com/search?q="+encodeURIComponent(word)+"&tbm=isch","_blank","noopener");
    });
    // Fermer en cliquant sur l'overlay (hors panneau)
    document.getElementById("gm-editor")?.addEventListener("click",e=>{
      if(e.target===document.getElementById("gm-editor")) closeGMEditor();
    });
    document.getElementById("btn-finales")?.addEventListener("click",()=>renderTmFinales());
    document.getElementById("btn-back-finales")?.addEventListener("click",()=>renderTmHome());

    document.querySelectorAll("#v-themods .tc[data-theme]").forEach(card=>{
      card.addEventListener("click",()=>playTheme(card.dataset.theme));
    });
  }

  // Toujours afficher l'accueil quand on entre dans THEMODS
  renderTmHome();
}

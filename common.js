"use strict";
/* ══════════════════════════════════════════
   COMMON.JS — Code partagé entre METHODS et THEMODS
══════════════════════════════════════════ */

/* ── Correctif ordre ODS : formes fléchies après formes de base ── */
(function fixOdsOrder(){
  const D = window.SEQODS_DATA; if(!D) return;
  const C=D.c, E=D.e||[], F=D.f||[];
  for(let i=0; i<C.length-1; i++){
    if(C[i]!==C[i+1]) continue;
    const ei=(E[i]||C[i]), ej=(E[i+1]||C[i+1]);
    if(ei.includes(',') && !ej.includes(',')){
      // swap i et i+1
      if(E.length){ const t=E[i]; E[i]=E[i+1]; E[i+1]=t; }
    }
  }
})();

/* ── Dictionnaire complet (toutes formes fléchies) ── */
function getDictArr(){ return window.SEQODS_DATA?.d || window.SEQODS_DATA?.c || []; }

/* ── Index anagrammes ── */
let _anaIdx = null;
function getAnagramCount(canon){
  if(!canon) return 0;
  if(!_anaIdx){
    _anaIdx = new Map();
    for(const w of getDictArr()){
      const key = w.split("").sort().join("");
      _anaIdx.set(key, (_anaIdx.get(key)||0)+1);
    }
  }
  const key = canon.split("").sort().join("");
  return (_anaIdx.get(key)||1)-1;
}

/* ── Rallonges — données précalculées dans DATA.r ── */
function hasHook(canon){
  return (window.SEQODS_DATA?.r?.[canon]?.length || 0) > 0;
}

/* ── Résolution forme fléchie : canon + suffixe affiché → canonique fléchi ── */
let _dSet = null;
function _getDSet(){ if(!_dSet) _dSet = new Set(getDictArr()); return _dSet; }

const _dSufCache = new Map();
function resolveInflectedCanon(canon, rawSuffix){
  const suf = norm(rawSuffix.trim());
  if(!suf) return null;
  const simple = canon + suf;
  if(_getDSet().has(simple)) return simple;
  if(!_dSufCache.has(suf)){
    _dSufCache.set(suf, getDictArr().filter(w => w.endsWith(suf)));
  }
  const candidates = _dSufCache.get(suf);
  let best=null, bestLen=0;
  for(const w of candidates){
    let j=0; while(j<canon.length && j<w.length && canon[j]===w[j]) j++;
    if(j>bestLen && j>=Math.ceil(canon.length*0.5)){ bestLen=j; best=w; }
  }
  return best;
}

/* ── Carte inverse formes fléchies → lemme (entrées à virgule de c[]) ── */
let _inflMap = null;
function _getInflMap(){
  if(!_inflMap){
    _inflMap = new Map();
    const {c,e}=window.SEQODS_DATA||{};
    if(c&&e) for(let i=0;i<c.length;i++){
      if(!e[i]?.includes(',')) continue;
      const ic = resolveInflectedCanon(c[i], e[i].split(',')[1]);
      if(ic && !_inflMap.has(ic)) _inflMap.set(ic, c[i]);
    }
  }
  return _inflMap;
}

/* ── Table des formes irrégulières → infinitif ── */
let _irregMap = null;
function _getIrregMap(){
  if(_irregMap) return _irregMap;
  _irregMap = new Map();
  const add = (inf, forms) => { for(const f of forms) _irregMap.set(f, inf); };

  add('ETRE',['SUIS','SOMMES','ETES','SONT',
    'ETAIS','ETAIT','ETIONS','ETIEZ','ETAIENT',
    'FUS','FUT','FUMES','FUTES','FURENT',
    'SERAI','SERAS','SERA','SERONS','SEREZ','SERONT',
    'SERAIS','SERAIT','SERIONS','SERIEZ','SERAIENT',
    'SOIS','SOIT','SOYONS','SOYEZ','SOIENT',
    'FUSSE','FUSSES','FUSSIONS','FUSSIEZ','FUSSENT','ETANT']);

  add('AVOIR',['AVONS','AVEZ','ONT',
    'AVAIS','AVAIT','AVIONS','AVIEZ','AVAIENT',
    'EUS','EUT','EUMES','EUTES','EURENT',
    'AURAI','AURAS','AURA','AURONS','AUREZ','AURONT',
    'AURAIS','AURAIT','AURIONS','AURIEZ','AURAIENT',
    'AIE','AIES','AIT','AYONS','AYEZ','AIENT',
    'EUSSE','EUSSES','EUSSIONS','EUSSIEZ','EUSSENT','AYANT']);

  add('ALLER',['VAIS','VAS','ALLONS','ALLEZ','VONT',
    'ALLAIS','ALLAIT','ALLIONS','ALLIEZ','ALLAIENT',
    'ALLAI','ALLAS','ALLA','ALLAMES','ALLATES','ALLERENT',
    'IRAI','IRAS','IRA','IRONS','IREZ','IRONT',
    'IRAIS','IRAIT','IRIONS','IRIEZ','IRAIENT',
    'AILLE','AILLES','AILLENT',
    'ALLASSE','ALLASSES','ALLAT','ALLASSIONS','ALLASSIEZ','ALLASSENT',
    'ALLANT','ALLE']);

  add('FAIRE',['FAIS','FAIT','FAISONS','FAITES','FONT',
    'FAISAIS','FAISAIT','FAISIONS','FAISIEZ','FAISAIENT',
    'FIS','FIT','FIMES','FITES','FIRENT',
    'FERAI','FERAS','FERA','FERONS','FEREZ','FERONT',
    'FERAIS','FERAIT','FERIONS','FERIEZ','FERAIENT',
    'FASSE','FASSES','FASSIONS','FASSIEZ','FASSENT',
    'FISSE','FISSES','FISSIONS','FISSIEZ','FISSENT','FAISANT']);

  add('VOULOIR',['VEUX','VEUT','VEULENT',
    'VOULAIS','VOULAIT','VOULIONS','VOULIEZ','VOULAIENT',
    'VOULUS','VOULUT','VOULUMES','VOULUTES','VOULURENT',
    'VOUDRAI','VOUDRAS','VOUDRA','VOUDRONS','VOUDREZ','VOUDRONT',
    'VOUDRAIS','VOUDRAIT','VOUDRIONS','VOUDRIEZ','VOUDRAIENT',
    'VEUILLE','VEUILLES','VEUILLONS','VEUILLEZ','VEUILLENT',
    'VOULUSSE','VOULU','VOULANT']);

  add('POUVOIR',['PEUX','PEUT','PEUVENT',
    'POUVAIS','POUVAIT','POUVIONS','POUVIEZ','POUVAIENT',
    'PUS','PUT','PUMES','PUTES','PURENT',
    'POURRAI','POURRAS','POURRA','POURRONS','POURREZ','POURRONT',
    'POURRAIS','POURRAIT','POURRIONS','POURRIEZ','POURRAIENT',
    'PUISSE','PUISSES','PUISSIONS','PUISSIEZ','PUISSENT',
    'PUSSE','PU','POUVANT']);

  add('SAVOIR',['SAIS','SAIT','SAVONS','SAVEZ','SAVENT',
    'SAVAIS','SAVAIT','SAVIONS','SAVIEZ','SAVAIENT',
    'SUS','SUT','SUMES','SUTES','SURENT',
    'SAURAI','SAURAS','SAURA','SAURONS','SAUREZ','SAURONT',
    'SAURAIS','SAURAIT','SAURIONS','SAURIEZ','SAURAIENT',
    'SACHE','SACHES','SACHONS','SACHEZ','SACHENT',
    'SUSSE','SU','SACHANT']);

  add('VOIR',['VOIS','VOIT','VOYONS','VOYEZ','VOIENT',
    'VOYAIS','VOYAIT','VOYIONS','VOYIEZ','VOYAIENT',
    'VIMES','VITES','VIRENT',
    'VERRAI','VERRAS','VERRA','VERRONS','VERREZ','VERRONT',
    'VERRAIS','VERRAIT','VERRIONS','VERRIEZ','VERRAIENT',
    'VOIE','VOIES','VOIENT',
    'VISSE','VU','VOYANT']);

  add('DEVOIR',['DOIS','DOIT','DEVONS','DEVEZ','DOIVENT',
    'DEVAIS','DEVAIT','DEVIONS','DEVIEZ','DEVAIENT',
    'DUS','DUT','DUMES','DUTES','DURENT',
    'DEVRAI','DEVRAS','DEVRA','DEVRONS','DEVREZ','DEVRONT',
    'DEVRAIS','DEVRAIT','DEVRIONS','DEVRIEZ','DEVRAIENT',
    'DOIVE','DOIVES','DOIVENT',
    'DUSSE','DU','DEVANT']);

  add('VENIR',['VIENS','VIENT','VENONS','VENEZ','VIENNENT',
    'VENAIS','VENAIT','VENIONS','VENIEZ','VENAIENT',
    'VINS','VINT','VINMES','VINTES','VINRENT',
    'VIENDRAI','VIENDRAS','VIENDRA','VIENDRONS','VIENDREZ','VIENDRONT',
    'VIENDRAIS','VIENDRAIT','VIENDRIONS','VIENDRIEZ','VIENDRAIENT',
    'VIENNE','VIENNES','VIENNENT',
    'VINSSE','VENU','VENANT']);

  add('TENIR',['TIENS','TIENT','TENONS','TENEZ','TIENNENT',
    'TENAIS','TENAIT','TENIONS','TENIEZ','TENAIENT',
    'TINS','TINT','TINMES','TINTES','TINRENT',
    'TIENDRAI','TIENDRAS','TIENDRA','TIENDRONS','TIENDREZ','TIENDRONT',
    'TIENDRAIS','TIENDRAIT','TIENDRIONS','TIENDRIEZ','TIENDRAIENT',
    'TIENNE','TIENNES','TIENNENT',
    'TINSSE','TENU','TENANT']);

  add('PRENDRE',['PRENDS','PREND','PRENONS','PRENEZ','PRENNENT',
    'PRENAIS','PRENAIT','PRENIONS','PRENIEZ','PRENAIENT',
    'PRIT','PRIMES','PRITES','PRIRENT',
    'PRENDRAI','PRENDRAS','PRENDRA','PRENDRONS','PRENDREZ','PRENDRONT',
    'PRENDRAIS','PRENDRAIT','PRENDRIONS','PRENDRIEZ','PRENDRAIENT',
    'PRENNE','PRENNES','PRENNENT',
    'PRISSE','PRENANT']);

  add('METTRE',['METS','MET','METTONS','METTEZ','METTENT',
    'METTAIS','METTAIT','METTIONS','METTIEZ','METTAIENT',
    'MIS','MIT','MIMES','MITES','MIRENT',
    'METTRAI','METTRAS','METTRA','METTRONS','METTREZ','METTRONT',
    'METTRAIS','METTRAIT','METTRIONS','METTRIEZ','METTRAIENT',
    'METTE','METTES','METTENT',
    'MISSE','METTANT']);

  add('DIRE',['DISONS','DITES','DISENT',
    'DISAIS','DISAIT','DISIONS','DISIEZ','DISAIENT',
    'DIRAI','DIRAS','DIRA','DIRONS','DIREZ','DIRONT',
    'DIRAIS','DIRAIT','DIRIONS','DIRIEZ','DIRAIENT',
    'DISE','DISES','DISENT',
    'DISSE','DISANT']);

  add('LIRE',['LISONS','LISEZ','LISENT',
    'LISAIS','LISAIT','LISIONS','LISIEZ','LISAIENT',
    'LUS','LUT','LUMES','LUTES','LURENT',
    'LIRAI','LIRAS','LIRA','LIRONS','LIREZ','LIRONT',
    'LIRAIS','LIRAIT','LIRIONS','LIRIEZ','LIRAIENT',
    'LISE','LISES','LISENT',
    'LUSSE','LU','LISANT']);

  add('ECRIRE',['ECRIS','ECRIT','ECRIVONS','ECRIVEZ','ECRIVENT',
    'ECRIVAIS','ECRIVAIT','ECRIVIONS','ECRIVIEZ','ECRIVAIENT',
    'ECRIVIS','ECRIVIT','ECRIVIMES','ECRIVITES','ECRIVIRENT',
    'ECRIRAI','ECRIRAS','ECRIRA','ECRIRONS','ECRIREZ','ECRIRONT',
    'ECRIRAIS','ECRIRAIT','ECRIRIONS','ECRIRIEZ','ECRIRAIENT',
    'ECRIVE','ECRIVES','ECRIVENT',
    'ECRIVISSE','ECRIVANT']);

  add('BOIRE',['BOIS','BOIT','BUVONS','BUVEZ','BOIVENT',
    'BUVAIS','BUVAIT','BUVIONS','BUVIEZ','BUVAIENT',
    'BUS','BUT','BUMES','BUTES','BURENT',
    'BOIRAI','BOIRAS','BOIRA','BOIRONS','BOIREZ','BOIRONT',
    'BOIRAIS','BOIRAIT','BOIRIONS','BOIRIEZ','BOIRAIENT',
    'BOIVE','BOIVES','BOIVENT',
    'BUSSE','BU','BUVANT']);

  add('CROIRE',['CROIS','CROIT','CROYONS','CROYEZ','CROIENT',
    'CROYAIS','CROYAIT','CROYIONS','CROYIEZ','CROYAIENT',
    'CRUS','CRUT','CRUMES','CRUTES','CRURENT',
    'CROIRAI','CROIRAS','CROIRA','CROIRONS','CROIREZ','CROIRONT',
    'CROIRAIS','CROIRAIT','CROIRIONS','CROIRIEZ','CROIRAIENT',
    'CROIE','CROIES','CROIENT',
    'CRUSSE','CRU','CROYANT']);

  add('MOURIR',['MEURS','MEURT','MOURONS','MOUREZ','MEURENT',
    'MOURAIS','MOURAIT','MOURIONS','MOURIEZ','MOURAIENT',
    'MOURUS','MOURUT','MOURUMES','MOURUTES','MOURURENT',
    'MOURRAI','MOURRAS','MOURRA','MOURRONS','MOURREZ','MOURRONT',
    'MOURRAIS','MOURRAIT','MOURRIONS','MOURRIEZ','MOURRAIENT',
    'MEURE','MEURES','MEURENT',
    'MOURUSSE','MOURANT']);

  add('COURIR',['COURS','COURT','COURONS','COUREZ','COURENT',
    'COURAIS','COURAIT','COURIONS','COURIEZ','COURAIENT',
    'COURUS','COURUT','COURUMES','COURUTES','COURURENT',
    'COURRAI','COURRAS','COURRA','COURRONS','COURREZ','COURRONT',
    'COURRAIS','COURRAIT','COURRIONS','COURRIEZ','COURRAIENT',
    'COURE','COURES','COURENT',
    'COURUSSE','COURU','COURANT']);

  add('RECEVOIR',['RECOIS','RECOIT','RECEVONS','RECEVEZ','RECOIVENT',
    'RECEVAIS','RECEVAIT','RECEVIONS','RECEVIEZ','RECEVAIENT',
    'RECUS','RECUT','RECUMES','RECUTES','RECURENT',
    'RECEVRAI','RECEVRAS','RECEVRA','RECEVRONS','RECEVREZ','RECEVRONT',
    'RECEVRAIS','RECEVRAIT','RECEVRIONS','RECEVRIEZ','RECEVRAIENT',
    'RECOIVE','RECOIVES','RECOIVENT',
    'RECUSSE','RECU','RECEVANT']);

  add('VALOIR',['VAUX','VAUT','VALONS','VALEZ','VALENT',
    'VALAIS','VALAIT','VALIONS','VALIEZ','VALAIENT',
    'VALUS','VALUT','VALUMES','VALUTES','VALURENT',
    'VAUDRAI','VAUDRAS','VAUDRA','VAUDRONS','VAUDREZ','VAUDRONT',
    'VAUDRAIS','VAUDRAIT','VAUDRIONS','VAUDRIEZ','VAUDRAIENT',
    'VAILLE','VAILLES','VAILLENT',
    'VALUSSE','VALU','VALANT']);

  add('FALLOIR',['FAUT','FALLAIT','FALLUT','FAUDRA','FAUDRAIT','FAILLE','FALLU']);

  add('PLEUVOIR',['PLEUT','PLEUVAIT','PLEUVAIENT','PLUT','PLUSSENT','PLEUVRA','PLEUVRAIT','PLEUVRAIENT','PLEUVRONT','PLEUVE','PLEUVENT','PLEUVANT','PLU']);

  add('GESIR',['GIT','GISAIT','GISAIENT','GISONS','GISEZ','GISIEZ','GISIONS']);

  add('SEOIR',['SIEE','SIEENT','SIERAIT','SIERAIENT','SIERONT','SEYAIT']);

  add('MESSEOIR',['MESSIEENT','MESSIERAIT','MESSIERAIENT','MESSIERONT','MESSEYAIT']);

  add('SOURDRE',['SOURDAIT','SOURDAIENT','SOURDENT']);

  add('SAILLIR',['SAILLE','SAILLI','SAILLIRONT']);

  add('TRAIRE',['TRAYAIT','TRAYAIENT','TRAYANT','TRAYONS','TRAYIEZ','TRAYIONS','TRAIENT']);

  add('PAITRE',['PAISSAIT','PAISSAIENT','PAISSAIS','PAISSONS','PAISSEZ','PAISSENT','PAISSIONS','PAISSIEZ']);

  add('ABSOUDRE',['ABSOLVAIT','ABSOLVAIENT','ABSOLVAIS','ABSOLVANT','ABSOLVE','ABSOLVENT',
    'ABSOLVES','ABSOLVEZ','ABSOLVIEZ','ABSOLVIONS','ABSOLVONS','ABSOUTES','ABSOUTS']);

  add('RESOUDRE',['RESOLVAIT','RESOLVAIENT','RESOLVAIS','RESOLVANT','RESOLVE','RESOLVENT',
    'RESOLVES','RESOLVEZ','RESOLVIEZ','RESOLVIONS','RESOLVONS','RESOUTE','RESOUTES']);

  add('ECHOIR',['ECHOIE','ECHOIENT','ECHOYAIT','ECHOYAIENT','ECHOYANT']);

  add('BRAIRE',['BRAIENT']);

  add('FOUTRE',['FOUT']);

  add('VIVRE',['VIVONS','VIVEZ','VIVENT',
    'VIVAIS','VIVAIT','VIVIONS','VIVIEZ','VIVAIENT',
    'VECUS','VECUT','VECUMES','VECUTES','VECURENT',
    'VIVRAI','VIVRAS','VIVRA','VIVRONS','VIVREZ','VIVRONT',
    'VIVRAIS','VIVRAIT','VIVRIONS','VIVRIEZ','VIVRAIENT',
    'VIVE','VIVES','VIVENT',
    'VECUSSE','VECU','VIVANT']);

  add('SUIVRE',['SUIT','SUIVONS','SUIVEZ','SUIVENT',
    'SUIVAIS','SUIVAIT','SUIVIONS','SUIVIEZ','SUIVAIENT',
    'SUIVIS','SUIVIT','SUIVIMES','SUIVITES','SUIVIRENT',
    'SUIVRAI','SUIVRAS','SUIVRA','SUIVRONS','SUIVREZ','SUIVRONT',
    'SUIVRAIS','SUIVRAIT','SUIVRIONS','SUIVRIEZ','SUIVRAIENT',
    'SUIVE','SUIVES','SUIVENT',
    'SUIVISSE','SUIVI','SUIVANT']);

  add('CONNAITRE',['CONNAIS','CONNAIT',
    'CONNUS','CONNUT','CONNUMES','CONNUTES','CONNURENT',
    'CONNAITRAI','CONNAITRAS','CONNAITRA','CONNAITRONS','CONNAITREZ','CONNAITRONT',
    'CONNAITRAIS','CONNAITRAIT','CONNAITRIONS','CONNAITRIEZ','CONNAITRAIENT',
    'CONNU','CONNAISSANT']);

  add('NAITRE',['NAIS','NAIT',
    'NAQUIS','NAQUIT','NAQUIMES','NAQUITES','NAQUIRENT',
    'NAITRAI','NAITRAS','NAITRA','NAITRONS','NAITREZ','NAITRONT',
    'NAITRAIS','NAITRAIT','NAITRIONS','NAITRIEZ','NAITRAIENT',
    'NAISSE','NAISSES','NAISSENT','NE','NAISSANT']);

  return _irregMap;
}

/* ── Préfixes de verbes composés ── */
const _VERB_PREFIXES = ['ENTRE','CONTRE','INTER','TRANS','SOUS','TRES','SATIS','PAR','SUR','CON','COM','PRE','PRO','DIS','MES','RE','DE','EN','AD','AB'];

/* ── Lemme parent pour une forme fléchie ou conjuguée ── */
function findLemma(w){
  if(!w) return null;
  const cm = _getCMap();
  if(cm.has(w)) return w;
  const im = _getInflMap();
  if(im.has(w)) return im.get(w);

  // Table des irréguliers (base + composés via préfixe)
  const irr = _getIrregMap();
  if(irr.has(w)){
    const inf = irr.get(w); if(cm.has(inf)) return inf;
  }
  // Verbes composés : essayer de détacher un préfixe et chercher le reste
  for(const pfx of _VERB_PREFIXES){
    if(!w.startsWith(pfx) || w.length <= pfx.length+3) continue;
    const rest = w.slice(pfx.length);
    if(irr.has(rest)){
      const baseInf = irr.get(rest);
      const compound = pfx + baseInf;
      if(cm.has(compound)) return compound;
    }
  }

  // Participes passés féminins : -EES/-EE (verbes -ER), -IES/-IE (verbes -IR)
  for(const [sfx,vs] of [['EES',['ER']],['EE',['ER']],['IES',['IR','ER']],['IE',['IR','ER']]]){
    if(w.endsWith(sfx) && w.length > sfx.length+2){
      const st = w.slice(0,-sfx.length);
      for(const v of vs){ if(cm.has(st+v)) return st+v; }
    }
  }

  // Strips
  const ER_FUTURE = new Set(['ERAI','ERAS','ERA','ERONT','EREZ','ERONS','ERAIT','ERAIS','ERENT']);
  const strips = [
    // Subjonctif imparfait
    'ASSENT','ASSIEZ','ASSIONS','ASSES','ASSE',
    'USSENT','USSIEZ','USSIONS','USSES','USSE',
    // Imparfait/formes en -ISS
    'ISSAIENT','ISSAIT','ISSANT','ISSONS','ISSEZ','ISSENT','ISSIEZ','ISSIONS','ISSES','ISSE',
    // Conditionnel / futur
    'AIENT','ANT','ERENT','ERONT','EREZ','ERONS','ERAIT','ERAIS','ERAI',
    // Passé simple manquants + subj. imp. 3s
    'ATES','AMES','AT',
    // Présent / imparfait courant
    'AIT','AIS','IONS','IEZ','ONS','ONT','ENT','EZ','AI',
    'IT','EAUX','AUX',
    'AS','A','ERA','ERAS','ES','S','X'];
  for(const s of strips){
    if(!w.endsWith(s)) continue;
    const stem = w.slice(0,-s.length);
    if(stem.length<2) continue;
    if(ER_FUTURE.has(s)){
      if(cm.has(stem+'ER')) return stem+'ER';
      if(cm.has(stem+'IR')) return stem+'IR';
      if(cm.has(stem+'RE')) return stem+'RE';
      if(cm.has(stem+'E'))  return stem+'E';
    }
    if(cm.has(stem)) return stem;
    if(im.has(stem)) return im.get(stem);
    if(s==='AUX' && cm.has(stem+'AL')) return stem+'AL';
    if(s==='EAUX' && cm.has(stem+'EAU')) return stem+'EAU';
    if(cm.has(stem+'ER')) return stem+'ER';
    if(cm.has(stem+'IR')) return stem+'IR';
    if(cm.has(stem+'RE')) return stem+'RE';
    if(cm.has(stem+'E'))  return stem+'E';
  }

  // Présent 1s/3s -ER et futurs -RE (CHANTE→CHANTER, COMMETTRA→COMMETTRE)
  if(w.endsWith('E') && w.length > 3){
    const st = w.slice(0,-1);
    if(cm.has(st))        return st;
    if(cm.has(st+'ER'))   return st+'ER';
    if(cm.has(st+'RE'))   return st+'RE';
  }

  // Participes passés masc. en -U (ABSTENU→ABSTENIR, VAINCU→VAINCRE, VENDU→VENDRE)
  if(w.endsWith('U') && w.length > 3){
    const st = w.slice(0,-1);
    if(cm.has(st+'IR')) return st+'IR';
    if(cm.has(st+'RE')) return st+'RE';
    if(cm.has(st+'ER')) return st+'ER';
  }

  // Participes passés masc. en -I (ABOLI→ABOLIR, ADOUCI→ADOUCIR)
  if(w.endsWith('I') && w.length > 3){
    const st = w.slice(0,-1);
    if(cm.has(st+'IR')) return st+'IR';
  }

  return null;
}

/* ── Affichage mot + puce + exposant ── */
function _mkHook(ch){ const d=document.createElement("span"); d.className="hook"; d.textContent=ch; return d; }
function _mkSup(n){ const s=document.createElement("sup"); s.className="ana"; s.textContent=n; return s; }
function _mkWt(t){ const s=document.createElement("span"); s.className="wt"; s.textContent=t; return s; }

function setElWord(el, display, canon, suffix=""){
  el.textContent = "";
  if(!display || !canon) return;
  const w = document.createElement("span");
  w.style.letterSpacing = "0";
  const commaIdx = display.indexOf(',');
  if(commaIdx === -1){
    if(hasHook(canon)) w.appendChild(_mkHook("•"));
    w.appendChild(_mkWt(display));
    const n = getAnagramCount(canon);
    if(n>0) w.appendChild(_mkSup(n));
  } else {
    const mainDisp = display.substring(0, commaIdx).trim();
    const inflDisp = display.substring(commaIdx+1).trim();
    const inflCanon = resolveInflectedCanon(canon, inflDisp);
    const mainHook = hasHook(canon);
    const inflHook = inflCanon ? hasHook(inflCanon) : false;
    if(mainHook && inflHook)       w.appendChild(_mkHook("•"));
    else if(mainHook)              w.appendChild(_mkHook("◦"));
    w.appendChild(_mkWt(mainDisp));
    const n = getAnagramCount(canon);
    if(n>0) w.appendChild(_mkSup(n));
    w.appendChild(document.createTextNode(", "));
    if(!mainHook && inflHook)      w.appendChild(_mkHook("◦"));
    w.appendChild(_mkWt(inflDisp));
    if(inflCanon){ const ni=getAnagramCount(inflCanon); if(ni>0) w.appendChild(_mkSup(ni)); }
  }
  el.appendChild(w);
  if(suffix) el.appendChild(document.createTextNode(suffix));
}

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
function _renderWordLinks(container, list, label){
  if(!list || !list.length) return;
  const lbl = document.createElement("strong"); lbl.textContent = label;
  container.appendChild(lbl);
  const sp = document.createElement("span");
  list.forEach((w,i)=>{
    if(i) sp.appendChild(document.createTextNode(" • "));
    const a = document.createElement("a"); a.href="#"; a.className="def-link";
    a.textContent = w;
    a.addEventListener("click", e=>{ e.preventDefault(); openDef(norm(w), w); });
    sp.appendChild(a);
  });
  container.appendChild(sp);
}

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

function openDef(canon, displayWord, defText, flechie){
  const DATA = window.SEQODS_DATA;
  if(!DATA) return;
  const C=DATA.c, E=DATA.e, F=DATA.f, A=DATA.a, R=DATA.r;

  const idx = C.indexOf(canon);
  if(idx < 0 && defText === undefined){
    const lemma = findLemma(canon);
    if(lemma && lemma !== canon){ openDef(lemma, null, undefined, canon); return; }
  }
  const title = (displayWord || (idx>=0 ? E[idx].split(",")[0].trim() : canon)).replace(/\*/g,"");
  const def = (defText !== undefined) ? defText : (idx>=0 ? (F[idx]||"") : "");

  $("#def-title").textContent = title;
  $("#def-body").textContent = def || "(définition absente)";

  const raw = title.split(",")[0].trim().toLowerCase();
  $("#def-wikt").href = "https://fr.wiktionary.org/wiki/" + encodeURIComponent(raw);
  $("#def-img").href = "https://www.google.com/search?tbm=isch&q=" + encodeURIComponent(raw);
  $("#def-links").style.display = "flex";

  // Anagrammes du lemme
  const anaEl = $("#def-ana"); if(anaEl) anaEl.innerHTML="";
  if(A && anaEl){
    const tir = canon.split("").sort((a,b)=>a.localeCompare(b,"fr")).join("");
    const lst = (A[tir]||[]).filter(x=>norm(x)!==canon).slice(0,60);
    if(lst.length){ _renderWordLinks(anaEl, lst, "Anagrammes"); }
  }

  // Rallonges du lemme
  const rallEl = $("#def-rall"); if(rallEl) rallEl.innerHTML="";
  if(R && rallEl){
    const lst = R[canon]||[];
    if(lst.length){ _renderWordLinks(rallEl, lst, "Rallonges"); }
  }

  // Section forme fléchie : soit redirect depuis conjugaison, soit entrée avec virgule (ex: PERLANT, E)
  let flechieToShow = flechie || null;
  if(!flechieToShow && idx >= 0 && E[idx]?.includes(',')){
    const resolved = resolveInflectedCanon(canon, E[idx].split(',')[1]);
    if(resolved && resolved !== canon) flechieToShow = resolved;
  }
  const flechieEl = $("#def-flechie"); if(flechieEl) flechieEl.innerHTML="";
  if(flechieToShow && flechieToShow !== canon && A && flechieEl){
    const ftir = flechieToShow.split("").sort((a,b)=>a.localeCompare(b,"fr")).join("");
    const fAna = (A[ftir]||[]).filter(x=>norm(x)!==flechieToShow).slice(0,60);
    const fRal = R ? (R[flechieToShow]||[]) : [];
    if(fAna.length || fRal.length){
      const sep = document.createElement("hr");
      sep.style.cssText = "border:none;border-top:1px solid var(--stroke);margin:12px 0 4px";
      flechieEl.appendChild(sep);
      const sub = document.createElement("p");
      sub.style.cssText = "font-size:11px;color:var(--muted);margin:0 0 2px";
      sub.textContent = "Forme : " + flechieToShow;
      flechieEl.appendChild(sub);
      if(fAna.length){
        const sec = document.createElement("div"); sec.className="modal-sec";
        _renderWordLinks(sec, fAna, "Anagrammes"); flechieEl.appendChild(sec);
      }
      if(fRal.length){
        const sec = document.createElement("div"); sec.className="modal-sec";
        _renderWordLinks(sec, fRal, "Rallonges"); flechieEl.appendChild(sec);
      }
    }
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
  document.querySelectorAll(".btn-dict-kb").forEach(b=>b.classList.toggle("hidden",!v));
}

// Extrait la nature grammaticale depuis le début d'une définition ("v.", "n.m.", "adj.", etc.)
function _posLabel(def){
  const d=(def||"").replace(/^(?:ou\s+)?\[[^\]]*\]\s*/i,"").trim();
  const parts=[];
  for(const t of d.split(/\s+/)){
    if(parts.length>=2||!t.endsWith(".")||t.length>6) break;
    parts.push(t);
  }
  return parts.join(" ");
}

// Binary search: premier index i dans le tableau trié A tel que A[i] >= prefix
function _dictBisect(A, prefix){
  let lo=0, hi=A.length;
  while(lo<hi){ const mid=(lo+hi)>>1; if(A[mid]<prefix) lo=mid+1; else hi=mid; }
  return lo;
}

// Map lazy : mot canonique → index dans c[] (pour retrouver def/display)
let _cMap=null;
function _getCMap(){
  if(!_cMap){
    _cMap=new Map();
    const c=window.SEQODS_DATA?.c;
    if(c) c.forEach((w,i)=>_cMap.set(w,i));
  }
  return _cMap;
}

function dictUpdateLinks(displayWord){
  const raw=(displayWord||"").split(",")[0].trim().toLowerCase().replace(/\s+.*/,"");
  const w=document.getElementById("dict-wikt");
  const img=document.getElementById("dict-img");
  if(w) w.href = raw ? "https://fr.wiktionary.org/wiki/"+encodeURIComponent(raw) : "#";
  if(img) img.href = raw ? "https://www.google.com/search?tbm=isch&q="+encodeURIComponent(raw) : "#";
}

// Afficher le résultat pour un mot canonique normalisé (présent dans d[])
function dictSelectWord(w, idx){
  const DATA=window.SEQODS_DATA; if(!DATA) return;
  const inp=document.getElementById("dict-input");
  if(inp){ inp.value=w; }
  document.getElementById("dict-sugg").innerHTML="";

  const cIdx=(idx!==undefined)?idx:_getCMap().get(w);
  if(cIdx!==undefined){
    // Entrée complète : forme fléchie, définition, rallonges
    const display=DATA.e[cIdx]||w;
    document.getElementById("dict-word").textContent=display;
    document.getElementById("dict-def").textContent=
      (DATA.f[cIdx]||"").replace(/^(?:ou\s+)?\[[^\]]*\]\s*/i,"").trim()||"(définition absente)";
    // Anagrammes
    const anaEl=document.getElementById("dict-ana");
    if(anaEl && DATA.a){
      anaEl.innerHTML="";
      const tir=w.split("").sort((a,b)=>a.localeCompare(b,"fr")).join("");
      const anaLst=(DATA.a[tir]||[]).filter(x=>norm(x)!==w).slice(0,60);
      if(anaLst.length){
        const lbl=document.createElement("strong"); lbl.textContent="Anagrammes"; anaEl.appendChild(lbl);
        const sp=document.createElement("span");
        anaLst.forEach((aw,i)=>{
          if(i) sp.appendChild(document.createTextNode(" • "));
          const a=document.createElement("a"); a.href="#"; a.className="def-link";
          a.textContent=aw;
          a.addEventListener("click",e=>{ e.preventDefault(); dictSelectWord(norm(aw)); });
          sp.appendChild(a);
        });
        anaEl.appendChild(sp);
      }
    } else if(anaEl) anaEl.innerHTML="";
    // Rallonges
    const lst=DATA.r?.[w]||[];
    const rallEl=document.getElementById("dict-rall");
    if(rallEl){
      rallEl.innerHTML="";
      if(lst.length){
        const lbl=document.createElement("strong"); lbl.textContent="Rallonges"; rallEl.appendChild(lbl);
        const sp=document.createElement("span");
        lst.forEach((rw,i)=>{
          if(i) sp.appendChild(document.createTextNode(" • "));
          const a=document.createElement("a"); a.href="#"; a.className="def-link";
          a.textContent=rw;
          a.addEventListener("click",e=>{ e.preventDefault(); dictSelectWord(norm(rw)); });
          sp.appendChild(a);
        });
        rallEl.appendChild(sp);
      }
    }
    dictUpdateLinks(display);
  } else {
    // Forme variable : tenter de naviguer vers le lemme
    const lemma = findLemma(w);
    if(lemma && lemma !== w){ dictSelectWord(lemma); return; }
    document.getElementById("dict-word").textContent=w;
    document.getElementById("dict-def").textContent="Forme variable · Mot valide ODS9";
    document.getElementById("dict-rall").innerHTML="";
    dictUpdateLinks(w);
  }
  document.getElementById("dict-result").style.display="";
}

function _dictRenderSugg(prefix){
  const sugg=document.getElementById("dict-sugg"); if(!sugg) return;
  sugg.innerHTML="";
  if(!prefix) return;
  const DATA=window.SEQODS_DATA; if(!DATA?.c) return;
  const C=DATA.c, E=DATA.e||[], F=DATA.f||[];
  const start=_dictBisect(C, prefix);
  // Collecter les candidats avec leur index
  const candidates=[];
  for(let i=start; i<C.length && candidates.length<14; i++){
    if(!C[i].startsWith(prefix)) break;
    candidates.push(i);
  }
  // Détecter les formes canoniques en double pour afficher la nature
  const canon2count=new Map();
  candidates.forEach(i=>canon2count.set(C[i],(canon2count.get(C[i])||0)+1));
  const frag=document.createDocumentFragment();
  candidates.forEach(i=>{
    const li=document.createElement("li");
    let label=E[i]||C[i];
    if(canon2count.get(C[i])>1){
      const pos=_posLabel(F[i]);
      if(pos) label+=" "+pos;
    }
    li.textContent=label;
    li.addEventListener("click",()=>dictSelectWord(C[i],i));
    frag.appendChild(li);
  });
  if(!candidates.length){
    const li=document.createElement("li"); li.className="dict-no-result";
    li.textContent="Mot inconnu."; frag.appendChild(li);
  }
  sugg.appendChild(frag);
}

function _dictBdResize(){
  const bd=document.getElementById("dict-bd"); if(!bd) return;
  const vv=window.visualViewport;
  const kbH=vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  bd.style.bottom=kbH+"px";
}

function openDictModal(){
  const m=document.getElementById("dict-modal"); if(!m) return;
  m.classList.add("open");
  const inp=document.getElementById("dict-input");
  if(inp){ inp.value=""; }
  document.getElementById("dict-sugg").innerHTML="";
  document.getElementById("dict-result").style.display="none";
  dictUpdateLinks("");
  _dictBdResize();
  window.visualViewport?.addEventListener("resize", _dictBdResize);
  // Force reflow so the modal is rendered before focus() — required on iOS PWA
  // eslint-disable-next-line no-unused-expressions
  inp && (inp.offsetHeight, inp.focus());
}

function closeDictModal(){
  document.getElementById("dict-modal")?.classList.remove("open");
  window.visualViewport?.removeEventListener("resize", _dictBdResize);
  const bd=document.getElementById("dict-bd"); if(bd) bd.style.bottom="";
}

function _wireDictBtn(el){
  if(!el) return;
  el.addEventListener("touchend", e=>{ e.preventDefault(); openDictModal(); });
  el.addEventListener("click", openDictModal);
}
function wireDictModal(){
  _wireDictBtn(document.getElementById("btn-dict"));
  document.querySelectorAll(".btn-dict-kb").forEach(b=>_wireDictBtn(b));
  document.getElementById("dict-close")?.addEventListener("click", closeDictModal);

  const inp=document.getElementById("dict-input");
  if(inp){
    inp.addEventListener("input", e=>{
      document.getElementById("dict-result").style.display="none";
      dictUpdateLinks(e.target.value);
      _dictRenderSugg(norm(e.target.value));
    });
    inp.addEventListener("keydown", e=>{
      if(e.key==="Escape"){ closeDictModal(); return; }
      if(e.key==="Enter"){
        const v=norm(inp.value); if(!v) return;
        const C=window.SEQODS_DATA?.c; if(!C) return;
        // Correspondance exacte dans c[]
        const start=_dictBisect(C,v);
        if(start<C.length && C[start]===v){ dictSelectWord(v); return; }
        // Première suggestion
        const first=document.querySelector("#dict-sugg li:not(.dict-no-result)");
        if(first) first.click();
      }
    });
  }
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

// Présence (« X en ligne »), « écrit… » et liste des membres.
// Conçu pour consommer très peu de données (Firestore + mode ultra léger) :
//  - un seul document « presence/etat » : chaque téléphone y écrit sa ligne toutes les 2 min 30 s
//    et le relit au même rythme (pas d'écoute en continu) ;
//  - un document « presence/frappe » écouté en direct, mais seulement quand l'appli est ouverte
//    et écrit uniquement pendant que quelqu'un tape.
import {
  doc, getDoc, setDoc, getDocs, collection, onSnapshot, serverTimestamp, deleteField
} from 'firebase/firestore';

const FENETRE_LIGNE = 6 * 60 * 1000;   // « en ligne » = signe de vie il y a moins de 6 min
const BATTEMENT = 150 * 1000;          // rythme d'écriture / lecture de la présence
const FENETRE_FRAPPE = 7000;           // « écrit… » disparaît 7 s après la dernière frappe
const PAS_FRAPPE = 4000;               // on n'écrit « je tape » qu'une fois toutes les 4 s

let ctx = null;                        // { db, uid, nom, role, onChange }
let etat = {};                         // uid -> { n, t (ms) }
let ecartHorloge = 0;                  // décalage entre l'horloge du téléphone et celle du serveur
let dispo = false;                     // la lecture de la présence a-t-elle déjà fonctionné ?
let ecritA = 0;                        // heure locale de ma dernière écriture de présence
let timerBat = null, timerExp = null, unFrappe = null;
let frappe = {};                       // uid -> { n, recu }
let vus = {};                          // uid -> dernière valeur « t » vue dans le document frappe
let premiere = true;
let dernierFrappe = 0;

const ms = t => (t && typeof t.toMillis === 'function') ? t.toMillis() : (typeof t === 'number' ? t : 0);
const prevenir = () => { try { ctx && ctx.onChange && ctx.onChange(); } catch (e) { console.error(e); } };
const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

/* ---------- Présence « en ligne » ---------- */
function ecrireEtat() {
  if (!ctx) return;
  ecritA = Date.now();
  setDoc(doc(ctx.db, 'presence', 'etat'), { [ctx.uid]: { n: ctx.nom, t: serverTimestamp() } }, { merge: true }).catch(() => {});
}

async function lireEtat() {
  if (!ctx) return;
  try {
    const snap = await getDoc(doc(ctx.db, 'presence', 'etat'));
    const d = snap.exists() ? snap.data() : {};
    etat = {};
    Object.keys(d).forEach(uid => { const v = d[uid]; if (v && ms(v.t)) etat[uid] = { n: v.n || '', t: ms(v.t) }; });
    const moi = etat[ctx.uid];
    if (moi && ecritA && Date.now() - ecritA < 30000) ecartHorloge = moi.t - ecritA; // recale l'horloge sur le serveur
    dispo = true;
    prevenir();
  } catch (e) { /* hors ligne ou règles pas encore publiées : on réessaiera */ }
}

function cycle() {
  if (!ctx || !visible()) return;
  ecrireEtat();
  setTimeout(lireEtat, 900);
}

function marquerUtilisateur() {
  if (!ctx) return;
  setDoc(doc(ctx.db, 'users', ctx.uid), { name: ctx.nom, role: ctx.role || 'member', vu: serverTimestamp() }, { merge: true }).catch(() => {});
}

/* ---------- « écrit… » ---------- */
function ecouterFrappe() {
  if (!ctx || unFrappe) return;
  premiere = true;
  unFrappe = onSnapshot(doc(ctx.db, 'presence', 'frappe'), snap => {
    const d = snap.exists() ? snap.data({ serverTimestamps: 'estimate' }) : {};
    let change = false;
    Object.keys(d).forEach(uid => {
      if (uid === ctx.uid) return;
      const v = d[uid]; const cle = v ? ms(v.t) : 0;
      if (!v) return;
      if (premiere) { vus[uid] = cle; return; }       // contenu déjà là à l'ouverture : on l'ignore
      if (vus[uid] !== cle) { vus[uid] = cle; frappe[uid] = { n: v.n || 'Quelqu\u2019un', recu: Date.now() }; change = true; }
    });
    Object.keys(frappe).forEach(uid => { if (!d[uid]) { delete frappe[uid]; change = true; } });
    Object.keys(vus).forEach(uid => { if (!d[uid]) delete vus[uid]; });
    premiere = false;
    if (change) prevenir();
  }, () => {});
}
function stopperFrappe() { if (unFrappe) { unFrappe(); unFrappe = null; } frappe = {}; vus = {}; }

function expirer() {
  const now = Date.now(); let change = false;
  Object.keys(frappe).forEach(uid => { if (now - frappe[uid].recu > FENETRE_FRAPPE) { delete frappe[uid]; change = true; } });
  if (change) prevenir();
}

/* ---------- Cycle de vie ---------- */
function auRetour() {
  if (!ctx) return;
  if (visible()) {
    setTimeout(() => { cycle(); ecouterFrappe(); marquerUtilisateur(); }, 600); // laisse le réseau se rallumer
    clearInterval(timerBat); timerBat = setInterval(cycle, BATTEMENT);
  } else {
    clearInterval(timerBat); timerBat = null;
    quitterEtat(); finSaisie(); stopperFrappe(); marquerUtilisateur();
  }
}

function quitterEtat() {
  if (!ctx) return;
  setDoc(doc(ctx.db, 'presence', 'etat'), { [ctx.uid]: deleteField() }, { merge: true }).catch(() => {});
}

export function demarrer(options) {
  arreter();
  ctx = options; etat = {}; frappe = {}; vus = {}; dispo = false; dernierFrappe = 0;
  cycle(); ecouterFrappe(); marquerUtilisateur();
  timerBat = setInterval(cycle, BATTEMENT);
  timerExp = setInterval(expirer, 1500);
  document.addEventListener('visibilitychange', auRetour);
}

export function arreter() {
  document.removeEventListener('visibilitychange', auRetour);
  clearInterval(timerBat); clearInterval(timerExp); timerBat = timerExp = null;
  if (ctx) { quitterEtat(); finSaisie(); }
  stopperFrappe();
  ctx = null;
}

/* ---------- Ce que l'interface lit ---------- */
export const disponible = () => dispo;

function maintenant() { return Date.now() + ecartHorloge; }

export function estEnLigne(uid) {
  if (ctx && uid === ctx.uid) return typeof navigator === 'undefined' || navigator.onLine;
  const v = etat[uid];
  return !!v && maintenant() - v.t < FENETRE_LIGNE;
}

export function nbEnLigne() {
  if (!ctx) return 0;
  const autres = Object.keys(etat).filter(uid => uid !== ctx.uid && estEnLigne(uid)).length;
  return autres + 1; // moi, tant que l'appli est ouverte
}

export function quiEcrit() { return Object.values(frappe).map(f => f.n); }

/* Je tape (appelé à chaque frappe) / j'ai fini */
export function saisie(nonVide) {
  if (!ctx) return;
  if (!nonVide) { finSaisie(); return; }
  const now = Date.now();
  if (now - dernierFrappe < PAS_FRAPPE) return;
  dernierFrappe = now;
  setDoc(doc(ctx.db, 'presence', 'frappe'), { [ctx.uid]: { n: ctx.nom, t: serverTimestamp() } }, { merge: true }).catch(() => {});
}

export function finSaisie() {
  if (!ctx || !dernierFrappe) return;
  dernierFrappe = 0;
  setDoc(doc(ctx.db, 'presence', 'frappe'), { [ctx.uid]: deleteField() }, { merge: true }).catch(() => {});
}

/* Liste des membres (une seule lecture, à l'ouverture des réglages) */
export async function chargerMembres() {
  if (!ctx) return [];
  const snap = await getDocs(collection(ctx.db, 'users'));
  return snap.docs.map(d => {
    const x = d.data();
    return { uid: d.id, nom: x.name || 'Membre', role: x.role || 'member', photo: x.photo || '', statut: x.statut || '', vu: x.vu && x.vu.toMillis ? x.vu.toMillis() : 0, enLigne: estEnLigne(d.id) };
  }).sort((a, b) => (b.enLigne - a.enLigne) || (b.vu - a.vu) || a.nom.localeCompare(b.nom, 'fr'));
}

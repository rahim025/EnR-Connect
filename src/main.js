import './update.js';
import * as P from './presence.js';
import { lancerVisite } from './visite.js';
import { monterLumiere, reglerNiveau, niveau as niveauLumiere, NIVEAUX as NIVEAUX_LUMIERE } from './lumiere.js';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import {
  GoogleAuthProvider, signInWithCredential, signInWithPopup, onAuthStateChanged, signOut,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile
} from 'firebase/auth';
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, onSnapshot,
  query, orderBy, limit, where, serverTimestamp, disableNetwork, enableNetwork
} from 'firebase/firestore';
import { auth, db } from './firebase.js';
import { firebaseConfig } from './firebase-config.js';

const app = document.getElementById('app');
const PAGE = 30; // nombre de messages chargés à la fois (mode ultra léger)

const state = {
  user: null,
  role: null,            // 'admin' | 'member' | 'refused'
  eco: localStorage.getItem('eco') !== 'off', // mode économique : photos masquées tant qu'on n'appuie pas
  messages: [],
  limit: PAGE,
  announce: false,
  panel: null,           // null | 'admin' | 'settings'
  notif: localStorage.getItem('notif') !== 'off',          // notifications + bulle (Android)
  notifSec: Number(localStorage.getItem('notifSec')) || 60, // rythme de vérification en secondes
  sel: null              // id du message touché (affiche l'heure et « Supprimer »)
};
const mediaCache = new Map(); // mediaId -> dataURL
let unsubs = [];
let timers = [];
let msgUnsub = null;

const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mailOf = u => (u.email || '').toLowerCase();
// Comptes « pseudo » : un faux e-mail interne est construit à partir du pseudo (aucune adresse réelle n'est utilisée).
const PSEUDO_DOMAIN = 'pseudo.enrconnect.app';
const estPseudo = u => mailOf(u).endsWith('@' + PSEUDO_DOMAIN);
const nomAffiche = u => u.displayName || mailOf(u).split('@')[0];
let modePseudo = 'connexion'; // 'connexion' | 'inscription'

const styleLogin = document.createElement('style');
styleLogin.textContent = `
  .login .ou { margin: 18px 0 8px; opacity: .7; font-size: .9rem; }
  .pseudo-form { display: flex; flex-direction: column; gap: 10px; width: 100%; }
  .pseudo-form input { width: 100%; box-sizing: border-box; padding: 13px 14px; border: 0; border-radius: 12px; font: inherit; background: #f5f7f6; color: #12272b; }
  .pseudo-form .champ-mdp { position: relative; width: 100%; }
  .pseudo-form .champ-mdp input { padding-right: 48px; }
  .pseudo-form .oeil { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: none; border: 0; padding: 0; cursor: pointer; color: #4a5f63; }
  .pseudo-form .oeil svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .force { width: 100%; margin-top: -2px; }
  .force .barre { height: 8px; border-radius: 99px; background: rgba(255,255,255,.18); overflow: hidden; }
  .force .barre i { display: block; height: 100%; width: 0; border-radius: 99px; background: #e5484d; transition: width .3s ease, background .3s ease; }
  .force .niveau { margin: 6px 0 4px; font-size: .85rem; font-weight: 600; }
  .force ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; font-size: .82rem; }
  .force li { opacity: .7; transition: opacity .2s, color .2s; }
  .force li::before { content: '○ '; }
  .force li.ok { opacity: 1; color: #6fdc8c; }
  .force li.ok::before { content: '✔ '; }
  .pseudo-form .lien { background: none; border: 0; color: inherit; font: inherit; text-decoration: underline; opacity: .85; padding: 6px; cursor: pointer; }
`;
document.head.appendChild(styleLogin);
const heure = ts => (ts && ts.toDate ? ts.toDate() : new Date()).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/* ---------- Connexion ---------- */
async function signInGoogle() {
  const err = document.getElementById('err');
  try {
    if (Capacitor.isNativePlatform()) {
      const res = await FirebaseAuthentication.signInWithGoogle();
      const cred = GoogleAuthProvider.credential(res.credential?.idToken);
      await signInWithCredential(auth, cred);
    } else {
      await signInWithPopup(auth, new GoogleAuthProvider());
    }
  } catch (e) {
    const code = e && (e.code || e.errorMessage || '');
    if (err) err.textContent = 'Connexion impossible. Réessaie. (' + (code || 'erreur') + ')';
    console.error(e);
  }
}

function renderLogin(message = '') {
  stopAll();
  const ins = modePseudo === 'inscription';
  app.innerHTML = `
    <main class="login">
      <div class="sun" aria-hidden="true"></div>
      <h1>EnR Connect</h1>
      <p>Le groupe de discussion de la classe d'énergies renouvelables.</p>
      <button class="primary" id="btn-login">Continuer avec Google</button>
      <p class="ou">ou, sans Google</p>
      <form class="pseudo-form" id="pseudo-form">
        <input id="pseudo" type="text" placeholder="Pseudo" autocapitalize="none" autocomplete="username" maxlength="20" required />
        <div class="champ-mdp">
          <input id="mdp" type="password" placeholder="Mot de passe (6 caractères minimum)" autocomplete="${ins ? 'new-password' : 'current-password'}" minlength="6" required />
          <button type="button" class="oeil" id="oeil" aria-label="Afficher le mot de passe"></button>
        </div>
        ${ins ? `<div class="force" id="force">
          <div class="barre"><i id="force-barre"></i></div>
          <div class="niveau" id="force-niveau">Saisis un mot de passe</div>
          <ul>
            <li data-r="long">6 caractères minimum (obligatoire)</li>
            <li data-r="long8">8 caractères ou plus (recommandé)</li>
            <li data-r="min">Une lettre minuscule</li>
            <li data-r="maj">Une lettre majuscule</li>
            <li data-r="chiffre">Un chiffre</li>
            <li data-r="symbole">Un symbole (ex. ! ? @ #)</li>
          </ul>
        </div>` : ''}
        <button class="primary" type="submit">${ins ? 'Créer mon compte' : 'Se connecter'}</button>
        <button class="lien" type="button" id="bascule">${ins ? "J'ai déjà un compte" : 'Créer un compte avec un pseudo'}</button>
      </form>
      <p class="msg-erreur" id="err">${esc(message)}</p>
    </main>`;
  document.getElementById('btn-login').onclick = signInGoogle;
  document.getElementById('pseudo-form').onsubmit = submitPseudo;
  const OEIL = '<svg viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const OEIL_BARRE = '<svg viewBox="0 0 24 24"><path d="M17.94 17.94A10.9 10.9 0 0 1 12 19c-7 0-11-7-11-7a19.8 19.8 0 0 1 5.06-5.94M9.9 4.24A10.9 10.9 0 0 1 12 5c7 0 11 7 11 7a19.7 19.7 0 0 1-3.17 4.19M14.12 14.12A3 3 0 1 1 9.88 9.88"/><path d="M1 1l22 22"/></svg>';
  const champMdp = document.getElementById('mdp');
  const boutonOeil = document.getElementById('oeil');
  boutonOeil.innerHTML = OEIL;
  boutonOeil.onclick = () => {
    const visible = champMdp.type === 'text';
    champMdp.type = visible ? 'password' : 'text';
    boutonOeil.innerHTML = visible ? OEIL : OEIL_BARRE;
    boutonOeil.setAttribute('aria-label', visible ? 'Afficher le mot de passe' : 'Masquer le mot de passe');
  };
  if (ins) {
    const barre = document.getElementById('force-barre');
    const niveau = document.getElementById('force-niveau');
    const regles = {
      long: v => v.length >= 6,
      long8: v => v.length >= 8,
      min: v => /[a-z]/.test(v),
      maj: v => /[A-Z]/.test(v),
      chiffre: v => /[0-9]/.test(v),
      symbole: v => /[^A-Za-z0-9]/.test(v)
    };
    const niveaux = [
      { txt: 'Très faible', col: '#e5484d' },
      { txt: 'Faible', col: '#f76b15' },
      { txt: 'Moyen', col: '#f5a524' },
      { txt: 'Fort', col: '#8bd450' },
      { txt: 'Très fort', col: '#30c26a' }
    ];
    const maj = () => {
      const v = champMdp.value;
      let ok = 0;
      document.querySelectorAll('#force li').forEach(li => {
        const bon = regles[li.dataset.r](v);
        li.classList.toggle('ok', bon);
        if (bon) ok++;
      });
      if (!v) { barre.style.width = '0'; niveau.textContent = 'Saisis un mot de passe'; niveau.style.color = ''; return; }
      // 0 à 6 règles validées -> 5 niveaux ; sous 6 caractères le niveau reste « Très faible »
      const n = regles.long(v) ? Math.min(4, Math.max(1, Math.round((ok - 1) * 4 / 5))) : 0;
      barre.style.width = ((n + 1) * 20) + '%';
      barre.style.background = niveaux[n].col;
      niveau.textContent = niveaux[n].txt;
      niveau.style.color = niveaux[n].col;
    };
    champMdp.addEventListener('input', maj);
    maj();
  }
  document.getElementById('bascule').onclick = () => { modePseudo = ins ? 'connexion' : 'inscription'; renderLogin(); };
}

function messagePseudo(e) {
  switch (e && e.code) {
    case 'auth/email-already-in-use': return 'Ce pseudo est déjà pris. Choisis-en un autre.';
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password': return 'Pseudo ou mot de passe incorrect.';
    case 'auth/weak-password': return 'Mot de passe trop court (6 caractères minimum).';
    case 'auth/network-request-failed': return 'Pas de connexion Internet. Réessaie.';
    case 'auth/too-many-requests': return 'Trop d\'essais. Attends quelques minutes puis réessaie.';
    case 'auth/operation-not-allowed': return 'Inscription par pseudo non activée (un administrateur doit activer « E-mail/Mot de passe » dans Firebase).';
    default: return 'Connexion impossible. Réessaie. (' + ((e && e.code) || 'erreur') + ')';
  }
}

async function submitPseudo(ev) {
  ev.preventDefault();
  const err = document.getElementById('err');
  const pseudo = document.getElementById('pseudo').value.trim();
  const mdp = document.getElementById('mdp').value;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,18}[A-Za-z0-9]$/.test(pseudo)) {
    err.textContent = 'Pseudo : 3 à 20 caractères (lettres, chiffres, point, tiret), sans espace.';
    return;
  }
  err.textContent = '';
  const mail = pseudo.toLowerCase() + '@' + PSEUDO_DOMAIN;
  try {
    if (modePseudo === 'inscription') {
      const cred = await createUserWithEmailAndPassword(auth, mail, mdp);
      await updateProfile(cred.user, { displayName: pseudo }).catch(() => {});
    } else {
      await signInWithEmailAndPassword(auth, mail, mdp);
    }
  } catch (e) {
    err.textContent = messagePseudo(e);
  }
}

function renderRefused() {
  stopAll();
  app.innerHTML = `
    <main class="refuse">
      <h2>Accès réservé à la classe</h2>
      <p>Ton adresse <strong>${esc(state.user.email)}</strong> n'est pas dans la liste des membres. Demande à un administrateur de l'ajouter, puis reconnecte-toi.</p>
      <button class="primary" id="btn-out">Changer de compte</button>
    </main>`;
  document.getElementById('btn-out').onclick = () => signOut(auth);
}

async function resolveRole(user) {
  const mail = mailOf(user);
  try {
    if (user.emailVerified && (await getDoc(doc(db, 'admins', mail))).exists()) return 'admin';
    return 'member';
  } catch (e) {
    // Hors ligne : on se fie au dernier rôle connu sur ce téléphone
    return localStorage.getItem('role:' + mail) || 'member';
  }
}

onAuthStateChanged(auth, async user => {
  state.user = user;
  if (!user) { arreterNotifs(); return renderLogin(); }
  if (!user.emailVerified && !estPseudo(user)) return renderLogin('Utilise un compte Google dont l\'adresse est vérifiée.');
  state.role = await resolveRole(user);
  localStorage.setItem('role:' + mailOf(user), state.role);
  if (state.role === 'refused') return renderRefused();
  startChat();
});

/* ---------- Icônes ---------- */
const S = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const F = d => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
const ICON = {
  retour: S('<path d="M15 5l-7 7 7 7"/>'),
  soleil: S('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  chevron: S('<path d="M9 5l7 7-7 7"/>'),
  gear: S('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  camera: S('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
  megaphone: S('<path d="M3 11v2a1 1 0 0 0 1 1h3l7 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M18 9a4 4 0 0 1 0 6"/>'),
  send: F('M2 21l21-9L2 3v7l15 2-15 2z'),
  like: F('M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z'),
  clock: S('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  image: S('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>'),
  shield: S('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>'),
  logout: S('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>'),
  leaf: S('<path d="M11 20A7 7 0 0 1 4 13c0-6 7-10 16-10 0 9-4 16-9 17z"/><path d="M4 21c3-6 6-9 11-11"/>'),
  bell: S('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'),
  user: S('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>')
};

/* ---------- Avatars, dates ---------- */
const COULEURS = ['#E4572E', '#17A398', '#7B61FF', '#D98A00', '#2E9E6B', '#D6336C', '#3B82F6', '#8D6E63'];
function couleurDe(s = '') { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COULEURS[h % COULEURS.length]; }
const initiales = n => (n || '?').trim().split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase() || '?';
const avatarHTML = (nom, cle, cache = false) =>
  `<span class="avatar${cache ? ' cache' : ''}" style="background:${couleurDe(cle || nom)}" aria-hidden="true">${esc(initiales(nom))}</span>`;
const dateDe = m => (m.createdAt && m.createdAt.toDate ? m.createdAt.toDate() : new Date());

function etiquette(d) {
  const now = new Date();
  const h = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return h;
  const hier = new Date(now); hier.setDate(now.getDate() - 1);
  if (d.toDateString() === hier.toDateString()) return 'Hier ' + h;
  if ((now - d) / 864e5 < 7) return d.toLocaleDateString('fr-FR', { weekday: 'short' }) + ' ' + h;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' ' + h;
}

/* ---------- Petits composants : message de confirmation et notification ---------- */
function confirmer(titre, texte, bouton) {
  return new Promise(resolve => {
    const o = document.createElement('div');
    o.className = 'voile';
    o.innerHTML = `
      <div class="dialogue" role="alertdialog" aria-modal="true">
        <h3>${esc(titre)}</h3>
        <p>${esc(texte)}</p>
        <div class="boutons"><button type="button" class="annuler">Annuler</button><button type="button" class="valider">${esc(bouton)}</button></div>
      </div>`;
    document.body.appendChild(o);
    const fin = v => { o.remove(); resolve(v); };
    o.querySelector('.annuler').onclick = () => fin(false);
    o.querySelector('.valider').onclick = () => fin(true);
    o.onclick = e => { if (e.target === o) fin(false); };
  });
}

function toast(texte) {
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = texte;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

/* ---------- Notifications et bulle (Android) ---------- */
const NATIF = Capacitor.isNativePlatform();
const Watcher = NATIF ? registerPlugin('MessageWatcher') : null;

function demarrerNotifs() {
  const u = auth.currentUser;
  if (!NATIF || !state.notif || !u) return;
  Watcher.requestNotifications().catch(() => {});
  Watcher.start({
    apiKey: firebaseConfig.apiKey, project: firebaseConfig.projectId,
    refresh: u.refreshToken, uid: u.uid, name: nomAffiche(u), seconds: state.notifSec
  }).catch(console.error);
  Watcher.setForeground({ value: true }).catch(() => {});
}
function arreterNotifs() { if (NATIF) Watcher.stop().catch(() => {}); }

/* ---------- Discussion ---------- */
function stopAll() {
  P.arreter();
  unsubs.forEach(u => u()); unsubs = [];
  timers.forEach(clearInterval); timers = [];
  if (msgUnsub) { msgUnsub(); msgUnsub = null; }
}

function subscribeMessages() {
  if (msgUnsub) msgUnsub();
  msgUnsub = onSnapshot(
    query(collection(db, 'messages'), orderBy('createdAt', 'desc'), limit(state.limit)),
    { includeMetadataChanges: true },
    snap => {
      state.messages = snap.docs
        .map(d => ({ id: d.id, pending: d.metadata.hasPendingWrites, ...d.data({ serverTimestamps: 'estimate' }) }))
        .reverse();
      renderFeed();
    },
    e => console.error(e)
  );
}

function startChat() {
  stopAll();
  state.limit = PAGE;
  state.sel = null;
  renderShell();
  subscribeMessages();
  demarrerNotifs();
  setTimeout(() => lancerVisite({ uid: state.user.uid, admin: state.role === 'admin' }), 700);
  P.demarrer({ db, uid: state.user.uid, nom: nomAffiche(state.user), role: state.role, onChange: majPresenceUI });
}

// Mode ultra léger : en arrière-plan, l'appli coupe sa connexion (zéro donnée consommée).
// Les messages en attente partent dès qu'on rouvre l'appli.
let coupureTimer = null;
document.addEventListener('visibilitychange', () => {
  if (NATIF) Watcher.setForeground({ value: document.visibilityState === 'visible' }).catch(() => {});
  if (!state.user) return;
  clearTimeout(coupureTimer);
  if (document.visibilityState === 'hidden') {
    coupureTimer = setTimeout(() => disableNetwork(db).catch(() => {}), 15000); // 15 s pour laisser partir un message tout juste envoyé
  } else {
    enableNetwork(db).catch(() => {});
  }
});
window.addEventListener('online', renderStatut);
window.addEventListener('offline', renderStatut);

function renderShell() {
  const admin = state.role === 'admin';
  app.innerHTML = `
    <div class="layout">
      <div class="ciel" aria-hidden="true">
        <i class="rayons"></i><i class="orbe o1"></i><i class="orbe o2"></i><i class="orbe o3"></i>
        <span class="etincelles"><s></s><s></s><s></s><s></s><s></s><s></s><s></s><s></s><s></s><s></s><s></s><s></s></span>
      </div>
      <header class="entete">
        <div class="marque">
          <span class="avatar-groupe"><span class="logo"></span><i class="point" id="point"></i></span>
          <div class="titres">
            <h2>EnR Connect</h2>
            <div class="sous" id="sous"></div>
          </div>
        </div>
        <div class="actions-entete">
          ${admin ? `<button class="icone" id="btn-admin" aria-label="Administration">${ICON.shield}</button>` : ''}
          <button class="icone" id="btn-set" aria-label="Infos du groupe et réglages">${ICON.gear}</button>
        </div>
      </header>
      <section class="fil" id="fil" aria-live="polite"></section>
      <div class="frappe" id="frappe" hidden aria-live="polite"><span class="eclairs"><i></i><i></i><i></i></span><span id="frappe-txt"></span></div>
      <form class="envoi" id="form">
        <div class="bandeau-annonce" id="bandeau" hidden>${ICON.megaphone}<span>Ce message sera publié comme annonce</span></div>
        <div class="ligne-envoi">
          <button type="button" class="icone accent" id="btn-photo" aria-label="Envoyer une photo">${ICON.camera}</button>
          ${admin ? `<button type="button" class="icone accent" id="btn-annonce" aria-label="Publier comme annonce" aria-pressed="false">${ICON.megaphone}</button>` : ''}
          <textarea id="texte" rows="1" placeholder="Message" maxlength="2000" aria-label="Message"></textarea>
          <button class="send" type="submit" id="btn-send" data-mode="like" aria-label="Envoyer un J'aime">
            <span class="i-like">${ICON.like}</span><span class="i-send">${ICON.send}</span>
          </button>
        </div>
      </form>
      <input type="file" id="file" accept="image/*" hidden />
    </div>`;

  const box = document.getElementById('texte');
  box.addEventListener('input', () => {
    box.style.height = 'auto';
    box.style.height = Math.min(box.scrollHeight, 120) + 'px';
    majBoutonEnvoi();
    const ecrit = !!box.value.trim();
    const lay = document.querySelector('.layout'); if (lay) lay.classList.toggle('ecrit', ecrit);
    P.saisie(ecrit);
  });
  box.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 700px)').matches) { e.preventDefault(); envoyer(); }
  });
  document.getElementById('form').onsubmit = e => { e.preventDefault(); envoyer(); };
  document.getElementById('btn-photo').onclick = () => document.getElementById('file').click();
  document.getElementById('file').onchange = onPickPhoto;
  document.getElementById('btn-set').onclick = () => openPanel('settings');
  const ba = document.getElementById('btn-admin'); if (ba) ba.onclick = () => openPanel('admin');
  const bn = document.getElementById('btn-annonce');
  if (bn) bn.onclick = () => { state.announce = !state.announce; majAnnonce(); };
  document.getElementById('fil').onclick = onFeedClick;
  document.getElementById('sous').onclick = () => openPanel('settings');
  state.dernierId = null; state.dernierT = 0;
  monterLumiere();
  renderStatut();
}

/* Présence : nombre de personnes en ligne et « écrit… » */
function majPresenceUI() {
  renderStatut();
  const noms = P.quiEcrit();
  const el = document.getElementById('frappe'); const lay = document.querySelector('.layout');
  if (el) {
    el.hidden = noms.length === 0;
    const t = noms.length === 1 ? `${noms[0]} écrit…`
      : noms.length === 2 ? `${noms[0]} et ${noms[1]} écrivent…`
      : noms.length > 2 ? `${noms[0]}, ${noms[1]} et ${noms.length - 2} autre${noms.length > 3 ? 's' : ''} écrivent…` : '';
    const txt = document.getElementById('frappe-txt'); if (txt && t) txt.textContent = t;
  }
  if (lay) lay.classList.toggle('quelquun', noms.length > 0);
  if (document.getElementById('membres')) remplirMembres();
}

/* Petit éclat de lumière quand on envoie ou qu'un message arrive */
function eclat(classe, cible, duree = 900) {
  const el = typeof cible === 'string' ? document.querySelector(cible) : cible; if (!el) return;
  el.classList.remove(classe); void el.offsetWidth; el.classList.add(classe);
  setTimeout(() => el.classList.remove(classe), duree);
}

function majAnnonce() {
  const bn = document.getElementById('btn-annonce');
  const bandeau = document.getElementById('bandeau');
  if (bn) { bn.setAttribute('aria-pressed', state.announce); bn.classList.toggle('actif', state.announce); }
  if (bandeau) bandeau.hidden = !state.announce;
}

function majBoutonEnvoi() {
  const b = document.getElementById('btn-send'); const box = document.getElementById('texte');
  if (!b || !box) return;
  const vide = !box.value.trim();
  b.dataset.mode = vide ? 'like' : 'send';
  b.setAttribute('aria-label', vide ? "Envoyer un J'aime" : 'Envoyer');
}

function renderStatut() {
  const sous = document.getElementById('sous'); if (!sous) return;
  const on = navigator.onLine;
  sous.innerHTML = (on ? (P.disponible() ? `<b class="nb-ligne">${P.nbEnLigne()}</b> en ligne` : 'En ligne') : 'Hors ligne') + ' · Mode ultra léger';
  const p = document.getElementById('point'); if (p) p.classList.toggle('hors', !on);
}

/* Une bulle (texte, photo) */
// Liens cliquables : on travaille sur le texte déjà échappé (sûr), seuls http(s):// et www. sont reconnus.
function lierURL(html) {
  return html.replace(/\b((?:https?:\/\/|www\.)[^\s<]+)/gi, brut => {
    let url = brut, apres = '';
    const fin = /(?:[.,;:!?)\]]|&quot;|&#39;|&gt;)$/;
    while (fin.test(url)) { const m = url.match(fin)[0]; apres = m + apres; url = url.slice(0, -m.length); }
    if (!/^(?:https?:\/\/|www\.)[^\s]{2,}/i.test(url)) return brut;
    const href = /^www\./i.test(url) ? 'https://' + url : url;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>${apres}`;
  });
}

function contenuHTML(m) {
  if (m.kind === 'image') {
    if (mediaCache.has(m.mediaId)) return `<img src="${mediaCache.get(m.mediaId)}" alt="Photo envoyée par ${esc(m.name)}" />`;
    return `<button class="media-masque" data-media="${esc(m.mediaId)}">${ICON.image}<span><strong>Photo masquée</strong><small>${m.taille ? m.taille + ' Ko · ' : ''}Appuie pour charger</small></span></button>`;
  }
  return `<div class="texte">${lierURL(esc(m.text)).replace(/\n/g, '<br>')}</div>`;
}

function detailHTML(m, moi) {
  const sel = state.sel === m.id;
  if (!m.pending && !sel) return '';
  const peutSuppr = state.role === 'admin' || moi;
  return `<div class="detail">
    ${m.pending ? `<span class="attente">${ICON.clock}En attente d'envoi</span>` : ''}
    ${sel ? `<span>${esc(etiquette(dateDe(m)))}</span>${peutSuppr ? `<button class="suppr" data-del="${m.id}">Supprimer</button>` : ''}` : ''}
  </div>`;
}

function ligneHTML(x, debut, fin) {
  const m = x.m; const moi = m.uid === state.user.uid;
  if (m.kind === 'announce') {
    return `
      <div class="rang annonce-rang">
        <div class="colonne">
          <article class="bulle annonce" data-id="${m.id}">
            <div class="qui">${ICON.megaphone}<span>Annonce de ${esc(m.name)}</span></div>
            ${contenuHTML(m)}
          </article>
          ${detailHTML(m, moi)}
        </div>
      </div>`;
  }
  const pos = debut && fin ? 'seul' : debut ? 'debut' : fin ? 'fin' : 'milieu';
  const photo = m.kind === 'image' && mediaCache.has(m.mediaId) ? ' photo' : '';
  return `
    <div class="rang ${moi ? 'moi' : 'autre'}${debut ? ' nouveau' : ''}">
      ${moi ? '' : avatarHTML(m.name, m.uid, !fin)}
      <div class="colonne">
        ${!moi && debut ? `<div class="qui">${esc(m.name)}</div>` : ''}
        <article class="bulle ${moi ? 'moi' : 'autre'} ${pos}${photo}" data-id="${m.id}">${contenuHTML(m)}</article>
        ${detailHTML(m, moi)}
      </div>
    </div>`;
}

function renderFeed() {
  const fil = document.getElementById('fil'); if (!fil) return;
  const proche = fil.scrollHeight - fil.scrollTop - fil.clientHeight < 140;
  const ms = state.messages;

  const infos = ms.map((m, i) => {
    const d = dateDe(m); const p = ms[i - 1]; const pd = p && dateDe(p);
    const temps = !p || d - pd >= 20 * 60000 || d.toDateString() !== pd.toDateString();
    const rompt = temps || m.uid !== p.uid || m.kind === 'announce' || p.kind === 'announce';
    return { m, d, temps, rompt };
  });

  const plus = ms.length >= state.limit
    ? '<button class="plus-anciens" data-plus="1">Voir les messages précédents</button>' : '';

  fil.innerHTML = ms.length
    ? plus + infos.map((x, i) => {
        const suiv = infos[i + 1];
        return (x.temps ? `<div class="temps">${esc(etiquette(x.d))}</div>` : '') + ligneHTML(x, x.rompt, !suiv || suiv.rompt);
      }).join('')
    : `<div class="vide"><span class="logo grand"></span><strong>Aucun message pour l'instant</strong><span>Écris le premier.</span></div>`;

  if (proche) fil.scrollTop = fil.scrollHeight;
  // Un nouveau message arrive : il apparaît dans un éclat de lumière
  const dernier = ms[ms.length - 1];
  if (dernier) {
    const t = +dateDe(dernier);
    if (state.dernierId && dernier.id !== state.dernierId && t >= state.dernierT) {
      const b = fil.querySelector(`[data-id="${dernier.id}"]`);
      if (b) { b.classList.add('arrive'); eclat('flash', '.layout', 1100); }
    }
    state.dernierId = dernier.id; state.dernierT = t;
  }
  // Mode normal : charger automatiquement les photos
  if (!state.eco) ms.filter(m => m.kind === 'image' && !mediaCache.has(m.mediaId)).forEach(m => loadMedia(m.mediaId));
}

async function loadMedia(id) {
  if (!id || mediaCache.has(id)) return;
  try {
    const snap = await getDoc(doc(db, 'media', id));
    if (snap.exists()) { mediaCache.set(id, snap.data().data); renderFeed(); }
  } catch (e) {
    console.error(e);
  }
}

async function onFeedClick(e) {
  if (e.target.closest('a')) return; // un lien s'ouvre sans sélectionner la bulle
  const t = e.target.closest('button');
  if (t) {
    if (t.dataset.plus) { t.textContent = 'Chargement…'; state.limit += PAGE; subscribeMessages(); return; }
    if (t.dataset.media) { t.querySelector('strong').textContent = 'Chargement…'; loadMedia(t.dataset.media); return; }
    if (t.dataset.del) {
      const ok = await confirmer('Supprimer ce message ?', 'Il sera supprimé pour tout le monde dans le groupe.', 'Supprimer');
      if (ok) { state.sel = null; deleteDoc(doc(db, 'messages', t.dataset.del)).catch(() => toast('Suppression impossible.')); }
    }
    return;
  }
  const bulle = e.target.closest('.bulle');
  if (bulle) { state.sel = state.sel === bulle.dataset.id ? null : bulle.dataset.id; renderFeed(); }
}

function envoyerMessage(text, kind = 'text') {
  addDoc(collection(db, 'messages'), {
    uid: state.user.uid, name: nomAffiche(state.user),
    kind, text, createdAt: serverTimestamp()
  }).catch(console.error); // pas de await : hors ligne, le message reste en attente
}

function envoyer() {
  const box = document.getElementById('texte');
  const text = box.value.trim();
  eclat('eclat', '#btn-send', 700);
  P.finSaisie();
  if (!text) { envoyerMessage('👍'); return; } // zone vide : le bouton envoie un « J'aime »
  envoyerMessage(text, state.announce && state.role === 'admin' ? 'announce' : 'text');
  box.value = ''; box.style.height = '';
  const lay = document.querySelector('.layout'); if (lay) lay.classList.remove('ecrit');
  state.announce = false; majAnnonce(); majBoutonEnvoi();
}

/* ---------- Photos (compressées pour économiser les mégas) ---------- */
function compress(file, maxSide = 640, quality = 0.5) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}

async function onPickPhoto(e) {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try {
    let data = await compress(file);
    if (data.length > 120000) data = await compress(file, 480, 0.4); // photos très légères (≈ 30 à 90 Ko)
    const taille = Math.max(1, Math.round(data.length * 0.75 / 1024));
    const mref = doc(collection(db, 'media'));
    mediaCache.set(mref.id, data);
    setDoc(mref, { uid: state.user.uid, data, createdAt: serverTimestamp() }).catch(console.error);
    addDoc(collection(db, 'messages'), {
      uid: state.user.uid, name: nomAffiche(state.user), kind: 'image', mediaId: mref.id, taille, createdAt: serverTimestamp()
    }).catch(console.error);
  } catch (err) {
    toast('Impossible de préparer cette photo.');
  }
}

/* ---------- Panneaux : infos du groupe (réglages) et administration ---------- */
function openPanel(which) {
  closePanel();
  const p = document.createElement('div');
  p.className = 'panneau'; p.id = 'panneau';
  document.body.appendChild(p);
  state.panel = which;
  if (which === 'settings') renderSettings(p); else renderAdmin(p);
}

function closePanel() {
  const p = document.getElementById('panneau'); if (p) p.remove();
  state.panel = null;
  if (panelUnsub) { panelUnsub(); panelUnsub = null; }
}
let panelUnsub = null;

const enteteHTML = titre =>
  `<header class="entete-panneau"><button class="icone" id="close" aria-label="Retour">${ICON.retour}</button><h2>${esc(titre)}</h2></header>`;

function renderSettings(p) {
  const admin = state.role === 'admin';
  p.innerHTML = `
    ${enteteHTML('Infos du groupe')}
    <div class="corps">
      <div class="hero">
        <span class="avatar-groupe grand"><span class="logo grand"></span></span>
        <h1>EnR Connect</h1>
        <p>Groupe de discussion de la classe d'énergies renouvelables</p>
      </div>

      <h3 class="titre-section">Discussion</h3>
      <label class="rangee">
        <span class="pastille">${ICON.leaf}</span>
        <span class="libelle"><strong>Mode économique</strong><small>Les photos restent masquées jusqu'à ce que tu appuies dessus. Le texte passe toujours avec très peu de données.</small></span>
        <input type="checkbox" class="switch" id="eco" ${state.eco ? 'checked' : ''} />
      </label>

      <div class="rangee statique">
        <span class="pastille">${ICON.soleil}</span>
        <span class="libelle"><strong>Effets de lumière</strong><small>Aurores, halo solaire, faisceau et ondes. Choisis « Doux » ou « Éteint » pour économiser la batterie.</small></span>
        <select class="choix" id="lumiere" aria-label="Effets de lumière">
          ${NIVEAUX_LUMIERE.map(([v, t]) => `<option value="${v}" ${niveauLumiere() === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>

      ${NATIF ? `
      <label class="rangee">
        <span class="pastille">${ICON.bell}</span>
        <span class="libelle"><strong>Notifications et bulle</strong><small>Chaque nouveau message apparaît dans une bulle flottante, avec réponse rapide. Une petite icône discrète reste dans la barre d'état.</small></span>
        <input type="checkbox" class="switch" id="notif" ${state.notif ? 'checked' : ''} />
      </label>
      <div class="rangee statique">
        <span class="pastille">${ICON.clock}</span>
        <span class="libelle"><strong>Vérification des messages</strong><small>Plus c'est fréquent, plus ça consomme de données et de batterie.</small></span>
        <select class="choix" id="notifSec" aria-label="Fréquence de vérification">
          ${[[30, 'Toutes les 30 s'], [60, 'Chaque minute'], [300, 'Toutes les 5 min']].map(([v, t]) => `<option value="${v}" ${state.notifSec === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>` : ''}

      <h3 class="titre-section">Membres <span id="nb-membres"></span></h3>
      <div id="membres"><p class="note">Chargement…</p></div>

      ${admin ? `
      <h3 class="titre-section">Administration</h3>
      <button class="rangee" id="go-admin">
        <span class="pastille">${ICON.shield}</span>
        <span class="libelle"><strong>Administrateurs</strong><small>Annonces, suppression de messages, nominations</small></span>
        <span class="fleche">${ICON.chevron}</span>
      </button>` : ''}

      <h3 class="titre-section">Aide</h3>
      <button class="rangee" id="revoir-visite">
        <span class="pastille">${ICON.megaphone}</span>
        <span class="libelle"><strong>Revoir la visite guidée</strong><small>Explique chaque partie de l'écran et son rôle</small></span>
        <span class="fleche">${ICON.chevron}</span>
      </button>

      <h3 class="titre-section">Compte</h3>
      <div class="rangee statique">
        <span class="pastille">${ICON.user}</span>
        <span class="libelle"><strong>${esc(nomAffiche(state.user))}</strong><small>${esc(estPseudo(state.user) ? 'Compte avec pseudo' : state.user.email)} · ${admin ? 'Administrateur' : 'Membre'}</small></span>
      </div>
      <button class="rangee rouge" id="logout">
        <span class="pastille">${ICON.logout}</span>
        <span class="libelle"><strong>Se déconnecter</strong></span>
      </button>
    </div>`;
  p.querySelector('#close').onclick = closePanel;
  chargerListeMembres();
  p.querySelector('#eco').onchange = e => { state.eco = e.target.checked; localStorage.setItem('eco', state.eco ? 'on' : 'off'); renderFeed(); };
  p.querySelector('#lumiere').onchange = ev => reglerNiveau(ev.target.value);
  const ga = p.querySelector('#go-admin'); if (ga) ga.onclick = () => openPanel('admin');
  const sn = p.querySelector('#notif');
  if (sn) sn.onchange = e => {
    state.notif = e.target.checked; localStorage.setItem('notif', state.notif ? 'on' : 'off');
    if (state.notif) demarrerNotifs(); else arreterNotifs();
  };
  const ss = p.querySelector('#notifSec');
  if (ss) ss.onchange = e => {
    state.notifSec = Number(e.target.value); localStorage.setItem('notifSec', String(state.notifSec));
    if (state.notif) demarrerNotifs();
  };
  p.querySelector('#revoir-visite').onclick = () => { closePanel(); setTimeout(() => lancerVisite({ uid: state.user.uid, admin, force: true }), 350); };
  p.querySelector('#logout').onclick = () => { closePanel(); arreterNotifs(); P.arreter(); signOut(auth); };
}

/* Membres du groupe (réglages) */
let listeMembres = [];
async function chargerListeMembres() {
  try { listeMembres = await P.chargerMembres(); } catch (e) { listeMembres = null; }
  remplirMembres();
}
function remplirMembres() {
  const zone = document.getElementById('membres'); if (!zone) return;
  if (listeMembres === null) { zone.innerHTML = '<p class="note">Impossible de charger la liste pour l\'instant.</p>'; return; }
  const moi = state.user.uid;
  const liste = listeMembres.map(m => ({ ...m, enLigne: P.estEnLigne(m.uid) }))
    .sort((a, b) => (b.enLigne - a.enLigne) || (b.vu - a.vu) || a.nom.localeCompare(b.nom, 'fr'));
  const nb = document.getElementById('nb-membres');
  if (nb) nb.textContent = `(${liste.length} · ${liste.filter(m => m.enLigne).length} en ligne)`;
  zone.innerHTML = liste.map((m, i) => `
    <div class="rangee statique membre ${m.enLigne ? 'on' : ''}" style="--i:${Math.min(i, 12)}">
      <span class="avatar-pres">${avatarHTML(m.nom, m.uid).replace('class="avatar', 'class="avatar gros')}<i class="pastille-pres"></i></span>
      <span class="libelle"><strong>${esc(m.nom)}</strong><small>${m.enLigne ? 'En ligne maintenant' : (m.vu ? 'Vu ' + esc(etiquette(new Date(m.vu))).toLowerCase() : 'Pas encore connecté')}</small></span>
      ${m.uid === moi ? '<span class="badge">Toi</span>' : m.role === 'admin' ? '<span class="badge">Admin</span>' : ''}
    </div>`).join('') || '<p class="note">Aucun membre pour l\'instant.</p>';
}

function renderAdmin(p) {
  p.innerHTML = `
    ${enteteHTML('Administration')}
    <div class="corps">
      <h3 class="titre-section">Ajouter un administrateur</h3>
      <p class="note">Tout le monde peut entrer dans le groupe avec son compte Google. Un administrateur peut publier des annonces, supprimer des messages et nommer d'autres administrateurs.</p>
      <form class="ajout" id="ajout">
        <input type="email" id="nouveau" placeholder="prenom.nom@gmail.com" autocapitalize="none" required />
        <button class="primary" type="submit">Ajouter</button>
      </form>

      <h3 class="titre-section">Administrateurs <span id="nb"></span></h3>
      <div id="liste"></div>
    </div>`;
  p.querySelector('#close').onclick = () => openPanel('settings');
  p.querySelector('#ajout').onsubmit = async e => {
    e.preventDefault();
    const input = p.querySelector('#nouveau');
    const mail = input.value.trim().toLowerCase(); if (!mail) return;
    try {
      await setDoc(doc(db, 'admins', mail), { addedBy: mailOf(state.user), addedAt: serverTimestamp() });
      input.value = '';
      toast('Administrateur ajouté.');
    } catch (err) { toast('Ajout impossible.'); }
  };
  panelUnsub = onSnapshot(collection(db, 'admins'), snap => {
    const liste = p.querySelector('#liste'); if (!liste) return;
    p.querySelector('#nb').textContent = `(${snap.size})`;
    const moi = mailOf(state.user);
    liste.innerHTML = snap.docs.map(d => `
      <div class="rangee statique">
        ${avatarHTML(d.id, d.id)}
        <span class="libelle"><strong>${esc(d.id)}</strong></span>
        ${d.id === moi ? '<span class="badge">Toi</span>' : `<button class="danger" data-rm="${esc(d.id)}">Retirer</button>`}
      </div>`).join('') || '<p class="note">Aucun administrateur.</p>';
  });
  p.querySelector('#liste').onclick = async e => {
    const mail = e.target.dataset.rm; if (!mail) return;
    if (!(await confirmer('Retirer cet administrateur ?', mail, 'Retirer'))) return;
    await deleteDoc(doc(db, 'admins', mail)).catch(() => toast('Action impossible.'));
  };
}

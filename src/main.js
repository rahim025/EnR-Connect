import './update.js';
import * as P from './presence.js';
import { lancerVisite } from './visite.js';
import { reglerTheme, theme as themeActuel, THEMES } from './theme.js';
import { monterFicelle } from './ficelle.js';
import { monterLumiere, reglerNiveau, niveau as niveauLumiere, NIVEAUX as NIVEAUX_LUMIERE } from './lumiere.js';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import {
  GoogleAuthProvider, signInWithCredential, signInWithPopup, onAuthStateChanged, signOut,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile
} from 'firebase/auth';
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, onSnapshot,
  query, orderBy, limit, where, serverTimestamp, disableNetwork, enableNetwork, updateDoc, arrayUnion, arrayRemove
} from 'firebase/firestore';
import { auth, db } from './firebase.js';
import { firebaseConfig } from './firebase-config.js';

const app = document.getElementById('app');
const PAGE = 30; // nombre de messages chargés à la fois (mode ultra léger)

const state = {
  user: null,
  role: null,            // 'createur' | 'admin' | 'member' | 'refused'
  eco: localStorage.getItem('eco') !== 'off', // mode économique : photos masquées tant qu'on n'appuie pas
  messages: [],
  limit: PAGE,
  announce: false,
  panel: null,           // null | 'admin' | 'settings'
  notif: localStorage.getItem('notif') !== 'off',          // notifications + bulle (Android)
  notifSec: Number(localStorage.getItem('notifSec')) || 60, // rythme de vérification en secondes
  sel: null              // id du message touché (affiche l'heure et « Supprimer »)
};
Object.assign(state, { reply: null, edit: null, epingle: null });
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
  .pseudo-form input { width: 100%; box-sizing: border-box; padding: 13px 14px; border: 0; border-radius: 12px; font: inherit; background: #f5f7f6; color: #12272b; position: relative; z-index: 3; }
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


/* ---------- Lampe à ficelle : il faut tirer la ficelle vers le bas pour allumer / éteindre ---------- */
let lampeAllumee = false, lampeTimer = 0;
const MOTIFS = ['vac1', 'vac2', 'vac3'];
function vaciller(login, motif) {
  login.classList.remove(...MOTIFS); void login.offsetWidth; login.classList.add(motif);
}
function planifierVacillement(login) {
  clearTimeout(lampeTimer);
  if (!lampeAllumee || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  lampeTimer = setTimeout(() => {
    if (!login.isConnected || !login.classList.contains('allume')) return;
    vaciller(login, Math.random() < 0.6 ? 'vac2' : 'vac1');
    planifierVacillement(login);
  }, 6000 + Math.random() * 9000);
}
function brancherLampe() {
  clearTimeout(lampeTimer);
  const login = document.querySelector('.login'); const f = document.getElementById('ficelle');
  if (!login || !f) return;
  planifierVacillement(login);
  login.addEventListener('animationend', e => { if (e.animationName.startsWith('vac')) login.classList.remove(...MOTIFS); });
  const regler = on => {
    lampeAllumee = on; login.classList.toggle('allume', on);
    f.setAttribute('aria-pressed', on); f.setAttribute('aria-label', on ? 'Éteindre la lampe : tire la ficelle' : 'Allumer la lampe : tire la ficelle');
    if (on) { if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) vaciller(login, 'vac3'); planifierVacillement(login); }
    else { clearTimeout(lampeTimer); login.classList.remove(...MOTIFS); }
  };
  monterFicelle(login.querySelector('.lampe'), f, () => regler(!lampeAllumee));
}

function renderLogin(message = '') {
  stopAll();
  if (message) lampeAllumee = true; // une erreur doit rester visible
  const ins = modePseudo === 'inscription';
  let nouveau = true; try { nouveau = !localStorage.getItem('deja-connecte'); } catch { /* ignoré */ }
  const h = new Date().getHours();
  const [salut, mot] = h >= 5 && h < 12 ? ['Bonjour', 'Belle matinée à toi. Que ta journée de cours se passe bien.']
    : h >= 12 && h < 18 ? ['Bon après-midi', 'Content de te voir ici. Courage pour la suite de la journée.']
    : ['Bonsoir', 'Belle soirée à toi. Repose-toi bien après cette journée.'];
  app.innerHTML = `
    <main class="login${lampeAllumee ? ' allume' : ''}${nouveau ? ' nouveau' : ''}">
      <div class="lampe">
        <svg viewBox="0 0 120 112" aria-hidden="true">
          <defs>
            <linearGradient id="gAbat" x1="0" x2="1"><stop offset="0" stop-color="#1f5258"/><stop offset=".45" stop-color="#143b40"/><stop offset="1" stop-color="#0a2226"/></linearGradient>
            <linearGradient id="gLaiton" x1="0" x2="1"><stop offset="0" stop-color="#8a6417"/><stop offset=".4" stop-color="#F0C766"/><stop offset="1" stop-color="#9a6f1b"/></linearGradient>
            <radialGradient id="gHalo"><stop offset="0" stop-color="#FFF2A0" stop-opacity=".9"/><stop offset=".45" stop-color="#FFD23F" stop-opacity=".35"/><stop offset="1" stop-color="#FFD23F" stop-opacity="0"/></radialGradient>
            <radialGradient id="gVerre" cx=".4" cy=".35"><stop offset="0" stop-color="#FFFBEA"/><stop offset=".6" stop-color="#FFF08A"/><stop offset="1" stop-color="#FFD23F"/></radialGradient>
          </defs>
          <rect x="53" y="0" width="14" height="5" rx="2" fill="url(#gLaiton)"/>
          <line x1="60" y1="5" x2="60" y2="30" stroke="#6f8a8c" stroke-width="2"/>
          <rect x="52" y="30" width="16" height="10" rx="3" fill="url(#gLaiton)"/>
          <path d="M46 40 H74 C90 40 100 62 106 84 H14 C20 62 30 40 46 40 Z" fill="url(#gAbat)"/>
          <path d="M44 44 C36 52 29 66 25 82" stroke="#ffffff" stroke-opacity=".14" stroke-width="3" fill="none" stroke-linecap="round"/>
          <rect x="12" y="84" width="96" height="5" rx="2.5" fill="url(#gLaiton)"/>
          <circle cx="100" cy="90.5" r="3.4" fill="none" stroke="url(#gLaiton)" stroke-width="1.6"/>
          <ellipse class="sous-abat" cx="60" cy="87" rx="40" ry="4" fill="#FFE680" opacity=".55"/>
          <circle class="halo" cx="60" cy="94" r="38" fill="url(#gHalo)"/>
          <rect x="54" y="86" width="12" height="6" rx="2" fill="url(#gLaiton)"/>
          <circle cx="60" cy="98" r="10" fill="#2c4144" stroke="#4d6568" stroke-width="1"/>
          <circle class="vive" cx="60" cy="98" r="10" fill="url(#gVerre)"/>
          <path d="M55 92 Q57 99 60 96 Q63 99 65 92" stroke="#B9801B" stroke-width="1" fill="none" opacity=".7"/>
        </svg>
        <svg class="corde" viewBox="0 0 120 260" aria-hidden="true">
          <defs>
            <radialGradient id="gLueur" gradientUnits="userSpaceOnUse" cx="60" cy="98" r="190"><stop offset="0" stop-color="#FFF6B8"/><stop offset=".22" stop-color="#FFE066"/><stop offset=".55" stop-color="#E0A92A"/><stop offset=".85" stop-color="#C58F20" stop-opacity=".35"/><stop offset="1" stop-color="#C58F20" stop-opacity="0"/></radialGradient>
            <radialGradient id="gBouton" cx=".35" cy=".4" r=".75"><stop offset="0" stop-color="#FFE9B5"/><stop offset=".3" stop-color="#F0C766"/><stop offset=".7" stop-color="#B9801B"/><stop offset="1" stop-color="#7a520f"/></radialGradient>
            <filter id="fFlou" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter>
            <mask id="mLumiere" maskUnits="userSpaceOnUse" x="-200" y="0" width="520" height="420"><path d="M-140 48 L60 98 L260 48 L260 400 L-140 400Z" fill="#fff" filter="url(#fFlou)"/></mask>
          </defs>
          <g class="ens">
            <path class="c-base" fill="none" stroke="#3d2b0e" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
            <path class="c-fil" fill="none" stroke="#8d7d57" stroke-width="2.6" stroke-dasharray="1.6 1.9" stroke-linejoin="round" transform="translate(-.35 0)"/>
            <g class="lit"><g mask="url(#mLumiere)">
              <path class="c-lit" fill="none" stroke="url(#gLueur)" stroke-width="2.6" stroke-dasharray="1.6 1.9" stroke-linejoin="round" transform="translate(-.35 0)"/>
              <path class="c-lum" fill="none" stroke-width=".8" transform="translate(-.7 -.3)"/>
            </g></g>
            <g class="bouton">
              <rect x="-2.6" y="-3" width="5.2" height="5.5" rx="1.5" fill="#a9791f"/>
              <path d="M0 0 C-6.5 2.5 -7 11 -5.5 16 C-4 21 4 21 5.5 16 C7 11 6.5 2.5 0 0Z" fill="url(#gBouton)"/>
              <ellipse cx="-2.2" cy="9" rx="1.3" ry="3.4" fill="#fff" opacity=".45"/>
              <g class="reflets">
                <path d="M0 0 C-6.5 2.5 -7 11 -5.5 16 C-4 21 4 21 5.5 16 C7 11 6.5 2.5 0 0Z" fill="#FFE680" fill-opacity=".38"/>
                <ellipse cx="-2.8" cy="7.5" rx="1.6" ry="4.4" fill="#FFFBD0" fill-opacity=".85"/>
              </g>
            </g>
          </g>
        </svg>
        <div role="button" tabindex="0" class="ficelle" id="ficelle" aria-pressed="${lampeAllumee}" aria-label="${lampeAllumee ? 'Éteindre la lampe : tire la ficelle' : 'Allumer la lampe : tire la ficelle'}"></div>
        <span class="indice" aria-hidden="true">Tire la ficelle ↓</span>
      </div>
      <div class="accueil" aria-live="polite">
        <b>${salut} !</b>
        <span class="mot">${mot}</span>
        <span>Bienvenue sur EnR Connect, le groupe de la classe d'énergies renouvelables.</span>
        <span class="tire">Tire la ficelle de la lampe pour entrer.</span>
      </div>
      <div class="obscur" aria-hidden="true"></div>
      <div class="penombre" aria-hidden="true"></div>
      <i class="cone" aria-hidden="true"></i>
      <div class="contenu">
      <h1>EnR Connect</h1>
      <p>Le groupe de discussion de la classe d'énergies renouvelables.</p>
      <button class="primary" id="btn-login">Continuer avec Gmail</button>
      <p class="ou">ou, sans Gmail</p>
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
      </div>
    </main>`;
  brancherLampe();
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

const estAdmin = () => state.role === 'admin' || state.role === 'createur';

async function resolveRole(user) {
  const mail = mailOf(user);
  try {
    if (user.emailVerified && (await getDoc(doc(db, 'createurs', mail))).exists()) return 'createur';
    if (user.emailVerified && (await getDoc(doc(db, 'admins', mail))).exists()) return 'admin';
    return 'member';
  } catch (e) {
    // Hors ligne : on se fie au dernier rôle connu sur ce téléphone
    return localStorage.getItem('role:' + mail) || 'member';
  }
}

const T0 = Date.now();
function cacherSplash() {
  const sp = document.getElementById('splash'); if (!sp) return;
  setTimeout(() => { sp.classList.add('fin'); setTimeout(() => sp.remove(), 600); }, Math.max(0, 1100 - (Date.now() - T0)));
}
setTimeout(cacherSplash, 7000);

onAuthStateChanged(auth, async user => {
  try { await gererUtilisateur(user); } finally { cacherSplash(); }
});

async function gererUtilisateur(user) {
  state.user = user;
  if (!user) { arreterNotifs(); return renderLogin(); }
  try { localStorage.setItem('deja-connecte', '1'); } catch { /* ignoré */ }
  if (!user.emailVerified && !estPseudo(user)) return renderLogin('Utilise un compte Google dont l\'adresse est vérifiée.');
  state.role = await resolveRole(user);
  localStorage.setItem('role:' + mailOf(user), state.role);
  if (state.role === 'refused') return renderRefused();
  if (!accueilVu(user.uid)) return afficherAccueilGroupe(user.uid, startChat);
  startChat();
}

/* ---------- Icônes ---------- */
const S = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const F = d => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
const ICON = {
  fichier: S('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>'),
  telephone: S('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>'),
  retour: S('<path d="M15 5l-7 7 7 7"/>'),
  recherche: S('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
  repondre: S('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v3"/>'),
  epingle: S('<path d="M12 17v5"/><path d="M9 3h6l-1 7 4 4H6l4-4z"/>'),
  crayon: S('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  fermer: S('<path d="M18 6L6 18M6 6l12 12"/>'),
  copier: S('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'),
  palette: S('<circle cx="12" cy="12" r="9"/><path d="M12 3v18"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>'),
  info: S('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
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
/* Profils : photo et statut, gardés dans le téléphone (chargés à la demande, très peu de données) */
const profils = new Map();
try { Object.entries(JSON.parse(localStorage.getItem('profils') || '{}')).forEach(([k, v]) => profils.set(k, v)); } catch { /* ignoré */ }
const sauverProfils = () => { try { localStorage.setItem('profils', JSON.stringify(Object.fromEntries(profils))); } catch { /* ignoré */ } };
const dejaDemande = new Set();

const avatarHTML = (nom, cle, cache = false) => {
  const p = cle && profils.get(cle);
  const lien = cle ? ` data-prof="${esc(cle)}"` : '';
  if (p && p.photo) return `<span class="avatar photo-profil${cache ? ' cache' : ''}"${lien} aria-hidden="true"><img src="${p.photo}" alt="" /></span>`;
  return `<span class="avatar${cache ? ' cache' : ''}"${lien} style="background:${couleurDe(cle || nom)}" aria-hidden="true">${esc(initiales(nom))}</span>`;
};

// Chaque message porte la version du profil de son auteur (av) : on ne relit son profil que si elle a changé.
function verifierProfils(ms) {
  const dernier = new Map();
  ms.forEach(m => { if (m.uid && m.uid !== state.user.uid) dernier.set(m.uid, m.av || 0); });
  dernier.forEach((av, uid) => {
    if (!av) return;
    const p = profils.get(uid);
    if (p && (p.pv || 0) >= av) return;
    const cle = uid + ':' + av;
    if (dejaDemande.has(cle)) return;
    dejaDemande.add(cle);
    getDoc(doc(db, 'users', uid)).then(snap => {
      const d = snap.exists() ? snap.data() : {};
      profils.set(uid, { photo: d.photo || '', statut: d.statut || '', pv: Math.max(av, d.pv || 0) });
      sauverProfils(); renderFeed();
    }).catch(() => {});
  });
}
const dateDe = m => (m.createdAt && m.createdAt.toDate ? m.createdAt.toDate() : new Date());

const heureCourte = d => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
function libelleJour(d) {
  const now = new Date(); const hier = new Date(now); hier.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return "Aujourd'hui";
  if (d.toDateString() === hier.toDateString()) return 'Hier';
  const o = { weekday: 'long', day: 'numeric', month: 'long' };
  if (d.getFullYear() !== now.getFullYear()) o.year = 'numeric';
  const t = d.toLocaleDateString('fr-FR', o);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

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
function confirmer(titre, texte, bouton, annuler = 'Annuler', neutre = false) {
  return new Promise(resolve => {
    const o = document.createElement('div');
    o.className = 'voile';
    o.innerHTML = `
      <div class="dialogue" role="alertdialog" aria-modal="true">
        <h3>${esc(titre)}</h3>
        <p>${esc(texte)}</p>
        <div class="boutons">${annuler === null ? '' : `<button type="button" class="annuler">${esc(annuler)}</button>`}<button type="button" class="valider${neutre ? ' neutre' : ''}">${esc(bouton)}</button></div>
      </div>`;
    document.body.appendChild(o);
    const fin = v => { o.remove(); resolve(v); };
    const an = o.querySelector('.annuler'); if (an) an.onclick = () => fin(false);
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
  state.sel = null; state.reply = null; state.edit = null;
  renderShell();
  subscribeMessages();
  chargerEpingle();
  chargerMonProfil();
  demarrerNotifs();
  setTimeout(() => lancerVisite({ uid: state.user.uid, admin: estAdmin() }), 700);
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
  const admin = estAdmin();
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
          <button class="icone" id="btn-appel" aria-label="Appel de groupe">${ICON.telephone}</button>
          <button class="icone" id="btn-search" aria-label="Rechercher dans les messages">${ICON.recherche}</button>
          ${admin ? `<button class="icone" id="btn-admin" aria-label="Administration">${ICON.shield}</button>` : ''}
          <button class="icone" id="btn-set" aria-label="Infos du groupe et réglages">${ICON.gear}</button>
        </div>
      </header>
      <div class="epingle" id="epingle" hidden></div>
      <section class="fil" id="fil" aria-live="polite"></section>
      <div class="frappe" id="frappe" hidden aria-live="polite"><span class="eclairs"><i></i><i></i><i></i></span><span id="frappe-txt"></span></div>
      <form class="envoi" id="form">
        <div class="bandeau-contexte" id="contexte" hidden></div>
        <div class="bandeau-annonce" id="bandeau" hidden>${ICON.megaphone}<span>Ce message sera publié comme annonce</span></div>
        <div class="ligne-envoi">
          <button type="button" class="icone accent" id="btn-photo" aria-label="Envoyer une photo">${ICON.camera}</button>
          <button type="button" class="icone accent" id="btn-pdf" aria-label="Envoyer un PDF">${ICON.fichier}</button>
          ${admin ? `<button type="button" class="icone accent" id="btn-annonce" aria-label="Publier comme annonce" aria-pressed="false">${ICON.megaphone}</button>` : ''}
          <textarea id="texte" rows="1" placeholder="Message" maxlength="2000" aria-label="Message"></textarea>
          <button class="send" type="submit" id="btn-send" data-mode="like" aria-label="Envoyer un J'aime">
            <span class="i-like">${ICON.like}</span><span class="i-send">${ICON.send}</span>
          </button>
        </div>
      </form>
      <input type="file" id="file" accept="image/*" hidden />
      <input type="file" id="file-pdf" accept="application/pdf" hidden />
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
  document.getElementById('btn-pdf').onclick = () => document.getElementById('file-pdf').click();
  document.getElementById('file-pdf').onchange = onPickPdf;
  document.getElementById('btn-appel').onclick = ouvrirAppel;
  document.getElementById('btn-set').onclick = () => openPanel('settings');
  document.getElementById('btn-search').onclick = () => openPanel('search');
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
  if (m.kind === 'pdf') {
    return `<button type="button" class="fichier-pdf" data-pdf="${esc(m.mediaId)}" data-nom="${esc(m.nom || 'document.pdf')}">${ICON.fichier}<span><strong>${esc(m.nom || 'Document PDF')}</strong><small>PDF${m.taille ? ' · ' + m.taille + ' Ko' : ''} · Appuie pour ouvrir</small></span></button>`;
  }
  return `<div class="texte">${lierURL(esc(m.text)).replace(/\n/g, '<br>')}${m.editedAt ? '<span class="modifie">modifié</span>' : ''}</div>`;
}

const REACTIONS = [['coeur', '❤️'], ['pouce', '👍'], ['rire', '😂'], ['wow', '😮'], ['triste', '😢'], ['merci', '🙏']];
const trouver = id => state.messages.find(m => m.id === id);
const extrait = (m, n = 90) => m.kind === 'image' ? '📷 Photo' : m.kind === 'pdf' ? '📄 ' + (m.nom || 'PDF') : String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, n);
const monAv = () => (profils.get(state.user.uid) || {}).pv || 0;

const citationHTML = m => m.reply
  ? `<button type="button" class="citation" data-goto="${esc(m.reply.id)}"><strong>${esc(m.reply.name)}</strong><span>${esc(m.reply.extrait)}</span></button>` : '';

function reacsHTML(m) {
  const r = m.reactions || {};
  const chips = REACTIONS.filter(([k]) => (r[k] || []).length).map(([k, e]) => {
    const n = r[k].length; const moi = r[k].includes(state.user.uid);
    return `<button type="button" class="reac${moi ? ' moi' : ''}" data-react="${k}" data-id="${m.id}" aria-label="${e} ${n}">${e}<b>${n}</b></button>`;
  });
  return chips.length ? `<div class="reacs">${chips.join('')}</div>` : '';
}

function detailHTML(m, moi) {
  const sel = state.sel === m.id;
  if (!m.pending && !sel) return '';
  const admin = estAdmin();
  let h = m.pending ? `<div class="detail"><span class="attente">${ICON.clock}En attente d'envoi</span></div>` : '';
  if (sel && !m.pending) {
    const r = m.reactions || {};
    h += `<div class="choix-reac" role="group" aria-label="Réagir">${REACTIONS.map(([k, e]) =>
      `<button type="button" class="${(r[k] || []).includes(state.user.uid) ? 'actif' : ''}" data-react="${k}" data-id="${m.id}" aria-label="Réagir ${e}">${e}</button>`).join('')}</div>`;
    h += `<div class="detail actions-msg"><span>${esc(etiquette(dateDe(m)))}</span>
      <button type="button" data-reply="${m.id}">${ICON.repondre}Répondre</button>
      ${m.kind !== 'image' && m.kind !== 'pdf' ? `<button type="button" data-copy="${m.id}">${ICON.copier}Copier</button>` : ''}
      ${moi && m.kind === 'text' && m.text !== '👍' ? `<button type="button" data-edit="${m.id}">${ICON.crayon}Modifier</button>` : ''}
      ${admin && m.kind !== 'image' && m.kind !== 'pdf' ? `<button type="button" data-pin="${m.id}">${ICON.epingle}Épingler</button>` : ''}
      ${(admin || moi) ? `<button type="button" class="suppr" data-del="${m.id}">Supprimer</button>` : ''}
    </div>`;
  }
  return h;
}

function ligneHTML(x, debut, fin) {
  const m = x.m; const moi = m.uid === state.user.uid;
  if (m.kind === 'announce') {
    return `
      <div class="rang annonce-rang">
        <div class="colonne">
          <article class="bulle annonce" data-id="${m.id}">
            <div class="qui" data-prof="${esc(m.uid)}">${ICON.megaphone}<span>Annonce de ${esc(m.name)}</span></div>
            ${citationHTML(m)}${contenuHTML(m)}
          </article>
          ${reacsHTML(m)}${detailHTML(m, moi)}
        </div>
      </div>`;
  }
  const pos = debut && fin ? 'seul' : debut ? 'debut' : fin ? 'fin' : 'milieu';
  const photo = m.kind === 'image' && mediaCache.has(m.mediaId) ? ' photo' : '';
  const image = m.kind === 'image';
  return `
    <div class="rang ${moi ? 'moi' : 'autre'}${debut ? ' nouveau' : ''}">
      ${moi ? '' : avatarHTML(m.name, m.uid, !fin)}
      <div class="colonne">
        ${!moi && debut ? `<div class="qui" data-prof="${esc(m.uid)}">${esc(m.name)}</div>` : ''}
        ${image ? citationHTML(m) : ''}
        <article class="bulle ${moi ? 'moi' : 'autre'} ${pos}${photo}" data-id="${m.id}">${image ? '' : citationHTML(m)}${contenuHTML(m)}</article>
        ${reacsHTML(m)}
        ${detailHTML(m, moi)}
      </div>
    </div>`;
}

/* Message de bienvenue du groupe : écran affiché une seule fois, à la première connexion, avant la messagerie */
const accueilVu = uid => { try { return localStorage.getItem('accueil-vu:' + uid) === '1'; } catch { return false; } };
function afficherAccueilGroupe(uid, suite) {
  stopAll();
  app.innerHTML = `<main class="ecran-accueil">${accueilGroupeHTML()}
    <button class="primary" id="btn-compris">J'ai compris</button></main>`;
  document.getElementById('btn-compris').onclick = () => {
    try { localStorage.setItem('accueil-vu:' + uid, '1'); } catch { /* ignoré */ }
    suite();
  };
}
function accueilGroupeHTML() {
  return `<section class="bienvenue-groupe" aria-label="Bienvenue dans le groupe">
    <span class="avatar-groupe grand"><span class="logo grand"></span></span>
    <h2>Bienvenue dans EnR Connect</h2>
    <p class="sous">Le groupe réservé uniquement à la filière ER1 (énergies renouvelables), 1ère année.</p>
    <h3>Pourquoi ce groupe ?</h3>
    <p>Pour que tous les étudiants de la filière ER1, première année, soient au même endroit : un seul espace pour les informations des cours, les devoirs, les projets et les annonces. Ce groupe est fait pour nous seuls, donc plus besoin de chercher dans dix discussions différentes : si c'est important pour la filière, c'est ici.</p>
    <h3>Pourquoi cette application ?</h3>
    <p>Parce qu'on a voulu une messagerie à nous, simple et très légère. Elle consomme peu de données grâce au mode économique, garde tes messages même sans réseau et les envoie dès que la connexion revient.</p>
    <h3>Les doyens sont avec nous</h3>
    <p>Les doyens font aussi partie du groupe : si tu as un souci (cours, emploi du temps, administration), tu peux les écrire ici et ils t'aideront. Leurs annonces sont officielles.</p>
    <h3>Pour tous les étudiants de la filière</h3>
    <p>Que tu sois en tête de classe ou que tu aies besoin d'un coup de main, ta place est ici. Pose tes questions sans gêne, partage ce que tu as compris et aide ceux qui sont en difficulté : on avance mieux ensemble.</p>
    <p class="fin">Respecte tes camarades, reste dans le sujet de la classe et lis les annonces des administrateurs. Bon courage à tous !</p>
  </section>`;
}

function renderFeed() {
  const fil = document.getElementById('fil'); if (!fil) return;
  const proche = fil.scrollHeight - fil.scrollTop - fil.clientHeight < 140;
  const ms = state.messages;

  const infos = ms.map((m, i) => {
    const d = dateDe(m); const p = ms[i - 1]; const pd = p && dateDe(p);
    const jour = !p || d.toDateString() !== pd.toDateString();
    const temps = !p || d - pd >= 20 * 60000 || jour;
    const rompt = temps || m.uid !== p.uid || m.kind === 'announce' || p.kind === 'announce';
    return { m, d, jour, temps, rompt };
  });

  const plus = ms.length >= state.limit
    ? '<button class="plus-anciens" data-plus="1">Voir les messages précédents</button>' : '';

  fil.innerHTML = (ms.length
    ? plus + infos.map((x, i) => {
        const suiv = infos[i + 1];
        return (x.jour ? `<div class="jour"><span>${esc(libelleJour(x.d))}</span></div>` : '')
          + (x.temps ? `<div class="temps">${esc(heureCourte(x.d))}</div>` : '')
          + ligneHTML(x, x.rompt, !suiv || suiv.rompt);
      }).join('')
    : `<div class="vide"><strong>Aucun message pour l'instant</strong><span>Écris le premier.</span></div>`);

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
  verifierProfils(ms);
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
  if (!t) {
    const prof = e.target.closest('[data-prof]');
    if (prof) { ouvrirFiche(prof.dataset.prof); return; }
    const bulle = e.target.closest('.bulle');
    if (bulle) { state.sel = state.sel === bulle.dataset.id ? null : bulle.dataset.id; renderFeed(); }
    return;
  }
  const d = t.dataset;
  if (d.plus) { t.textContent = 'Chargement…'; state.limit += PAGE; subscribeMessages(); return; }
  if (d.media) { t.querySelector('strong').textContent = 'Chargement…'; loadMedia(d.media); return; }
  if (d.pdf) { ouvrirPdf(d.pdf, d.nom); return; }
  if (d.del) {
    const ok = await confirmer('Supprimer ce message ?', 'Il sera supprimé pour tout le monde dans le groupe.', 'Supprimer');
    if (ok) { state.sel = null; deleteDoc(doc(db, 'messages', d.del)).catch(() => toast('Suppression impossible.')); }
    return;
  }
  if (d.react) { reagir(d.id, d.react); return; }
  if (d.reply) { demarrerReponse(d.reply); return; }
  if (d.copy) { copierMessage(d.copy); return; }
  if (d.edit) { demarrerEdition(d.edit); return; }
  if (d.pin) { epingler(d.pin); return; }
  if (d.goto) allerAuMessage(d.goto);
}

/* ---------- Réponses, réactions, modification, épinglage ---------- */
function reagir(id, cle) {
  const m = trouver(id); if (!m || m.pending) return;
  const deja = ((m.reactions || {})[cle] || []).includes(state.user.uid);
  state.sel = null;
  updateDoc(doc(db, 'messages', id), { ['reactions.' + cle]: deja ? arrayRemove(state.user.uid) : arrayUnion(state.user.uid) })
    .catch(() => toast('Réaction impossible pour l\'instant.'));
  renderFeed();
}

function majContexte() {
  const c = document.getElementById('contexte'); if (!c) return;
  const x = state.edit ? { ic: ICON.crayon, titre: 'Modification du message', txt: state.edit.extrait }
    : state.reply ? { ic: ICON.repondre, titre: 'Réponse à ' + state.reply.name, txt: state.reply.extrait } : null;
  if (!x) { c.hidden = true; c.innerHTML = ''; return; }
  c.hidden = false;
  c.innerHTML = `${x.ic}<div class="ctx-txt"><strong>${esc(x.titre)}</strong><span>${esc(x.txt)}</span></div><button type="button" class="icone" id="ctx-fermer" aria-label="Annuler">${ICON.fermer}</button>`;
  c.querySelector('#ctx-fermer').onclick = () => annulerContexte(true);
}

function annulerContexte(viderChamp = false) {
  const etaitEdition = !!state.edit;
  state.reply = null; state.edit = null; majContexte();
  if (viderChamp && etaitEdition) {
    const b = document.getElementById('texte');
    if (b) { b.value = ''; b.style.height = ''; majBoutonEnvoi(); const lay = document.querySelector('.layout'); if (lay) lay.classList.remove('ecrit'); }
  }
}

function demarrerReponse(id) {
  const m = trouver(id); if (!m) return;
  state.edit = null; state.sel = null;
  state.reply = { id: m.id, name: m.name, extrait: extrait(m, 80) };
  majContexte(); renderFeed();
  const b = document.getElementById('texte'); if (b) b.focus();
}

function demarrerEdition(id) {
  const m = trouver(id); if (!m || m.uid !== state.user.uid || m.kind !== 'text') return;
  state.reply = null; state.sel = null;
  state.edit = { id: m.id, extrait: extrait(m, 80) };
  const b = document.getElementById('texte');
  if (b) { b.value = m.text; b.dispatchEvent(new Event('input')); b.focus(); }
  majContexte(); renderFeed();
}

async function copierMessage(id) {
  const m = trouver(id); state.sel = null; renderFeed();
  if (!m) return;
  try { await navigator.clipboard.writeText(m.text || ''); toast('Message copié'); } catch { toast('Copie impossible.'); }
}

function allerAuMessage(id) {
  const b = document.querySelector(`#fil [data-id="${CSS.escape(id)}"]`);
  if (!b) { toast('Ce message est plus ancien : charge les messages précédents.'); return; }
  b.scrollIntoView({ block: 'center', behavior: 'smooth' });
  b.classList.remove('surligne'); void b.offsetWidth; b.classList.add('surligne');
  setTimeout(() => b.classList.remove('surligne'), 2000);
}

/* Message épinglé (administrateurs) : un seul document, relu au lancement et au retour dans l'appli */
async function epingler(id) {
  const m = trouver(id); if (!m || !estAdmin()) return;
  state.sel = null;
  const data = { id: m.id, name: m.name, text: extrait(m, 400), by: nomAffiche(state.user) };
  try {
    await setDoc(doc(db, 'meta', 'epingle'), { ...data, at: serverTimestamp() });
    state.epingle = data; majEpingle(); renderFeed(); toast('Message épinglé');
  } catch { toast('Épinglage impossible pour l\'instant.'); }
}

function majEpingle() {
  const b = document.getElementById('epingle'); if (!b) return;
  const e = state.epingle;
  if (!e) { b.hidden = true; b.innerHTML = ''; return; }
  b.hidden = false;
  b.innerHTML = `<button type="button" class="ep-corps" id="ep-ouvrir">${ICON.epingle}<span class="ep-txt"><strong>Message épinglé · ${esc(e.name)}</strong><span>${esc(e.text)}</span></span></button>`
    + (estAdmin() ? `<button type="button" class="icone" id="ep-retirer" aria-label="Retirer le message épinglé">${ICON.fermer}</button>` : '');
  b.querySelector('#ep-ouvrir').onclick = async () => {
    const present = !!trouver(e.id);
    const ok = await confirmer('Message épinglé · ' + e.name, e.text, present ? 'Voir le message' : 'Fermer', present ? 'Fermer' : null, true);
    if (ok && present) allerAuMessage(e.id);
  };
  const r = b.querySelector('#ep-retirer');
  if (r) r.onclick = async () => {
    if (!(await confirmer('Retirer le message épinglé ?', 'Il ne sera plus affiché en haut pour les membres.', 'Retirer'))) return;
    try { await deleteDoc(doc(db, 'meta', 'epingle')); state.epingle = null; majEpingle(); } catch { toast('Impossible pour l\'instant.'); }
  };
}

async function chargerEpingle() {
  try { const sn = await getDoc(doc(db, 'meta', 'epingle')); state.epingle = sn.exists() ? sn.data() : null; } catch { /* hors ligne ou règles pas encore publiées */ }
  majEpingle();
}
let derniereEpingle = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !state.user || !state.role) return;
  if (Date.now() - derniereEpingle < 3 * 60 * 1000) return;
  derniereEpingle = Date.now(); chargerEpingle();
});

/* Profil : photo ronde + statut */
async function chargerMonProfil() {
  try {
    const sn = await getDoc(doc(db, 'users', state.user.uid)); const d = sn.exists() ? sn.data() : {};
    profils.set(state.user.uid, { photo: d.photo || '', statut: d.statut || '', pv: d.pv || 0 }); sauverProfils();
  } catch { /* on garde la copie du téléphone */ }
}

function compressCarre(file, taille = 160, qualite = 0.72) {
  return new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = taille;
      const cote = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - cote) / 2, (img.height - cote) / 2, cote, cote, 0, 0, taille, taille);
      URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', qualite));
    };
    img.onerror = reject; img.src = url;
  });
}

async function ouvrirFiche(uid) {
  const moi = uid === state.user.uid;
  const o = document.createElement('div'); o.className = 'voile'; document.body.appendChild(o);
  const msg = state.messages.find(m => m.uid === uid);
  let d = { name: (msg && msg.name) || (moi ? nomAffiche(state.user) : 'Membre'), role: moi ? state.role : '', vu: 0 };
  const rendre = () => {
    const p = profils.get(uid) || {};
    const enLigne = moi || P.estEnLigne(uid);
    o.innerHTML = `
      <div class="dialogue fiche" role="dialog" aria-modal="true" aria-label="Profil de ${esc(d.name)}">
        ${avatarHTML(d.name, uid).replace('class="avatar', 'class="avatar enorme').replace(/ data-prof="[^"]*"/, '')}
        <h3>${esc(d.name)}</h3>
        <div class="badges">${d.role === 'createur' ? '<span class="badge">Créateur</span>' : d.role === 'admin' ? '<span class="badge">Admin</span>' : ''}${enLigne ? '<span class="badge en-ligne">En ligne</span>' : ''}${moi ? '<span class="badge">Toi</span>' : ''}</div>
        <p class="statut-fiche">${p.statut ? esc(p.statut) : '<em>Pas de statut</em>'}</p>
        ${!enLigne && d.vu ? `<p class="vu-fiche">Vu ${esc(etiquette(new Date(d.vu))).toLowerCase()}</p>` : ''}
        <div class="boutons"><button type="button" class="annuler">Fermer</button>${moi ? '<button type="button" class="valider neutre" id="edit-profil">Modifier mon profil</button>' : ''}</div>
      </div>`;
    o.querySelector('.annuler').onclick = () => o.remove();
    const ep = o.querySelector('#edit-profil'); if (ep) ep.onclick = () => { o.remove(); modifierProfil(); };
  };
  o.onclick = e => { if (e.target === o) o.remove(); };
  rendre();
  try {
    const sn = await getDoc(doc(db, 'users', uid));
    if (sn.exists()) {
      const x = sn.data();
      d = { name: x.name || d.name, role: x.role || d.role, vu: x.vu && x.vu.toMillis ? x.vu.toMillis() : 0 };
      const p0 = profils.get(uid) || {};
      profils.set(uid, { photo: x.photo || '', statut: x.statut || '', pv: Math.max(x.pv || 0, p0.pv || 0) }); sauverProfils();
      if (document.body.contains(o)) rendre();
      renderFeed();
    }
  } catch { /* hors ligne : on garde ce qu'on a */ }
}

function modifierProfil() {
  const uid = state.user.uid; const nom = nomAffiche(state.user);
  const p0 = profils.get(uid) || {};
  let photo = p0.photo || ''; let statut = p0.statut || '';
  const o = document.createElement('div'); o.className = 'voile'; document.body.appendChild(o);
  const rendre = () => {
    const grand = photo
      ? `<span class="avatar enorme photo-profil"><img src="${photo}" alt="" /></span>`
      : avatarHTML(nom, uid).replace('class="avatar', 'class="avatar enorme').replace(/ data-prof="[^"]*"/, '');
    o.innerHTML = `
      <div class="dialogue fiche" role="dialog" aria-modal="true" aria-label="Modifier mon profil">
        ${grand}
        <div class="ligne-boutons"><button type="button" class="petit" id="p-photo">${photo ? 'Changer la photo' : 'Ajouter une photo'}</button>${photo ? '<button type="button" class="petit danger" id="p-retirer">Retirer</button>' : ''}</div>
        <label class="champ-profil"><span>Statut</span><input id="p-statut" type="text" maxlength="80" placeholder="Ex. : en stage cette semaine" value="${esc(statut)}" /></label>
        <input id="p-fichier" type="file" accept="image/*" hidden />
        <div class="boutons"><button type="button" class="annuler" id="p-annuler">Annuler</button><button type="button" class="valider neutre" id="p-ok">Enregistrer</button></div>
      </div>`;
    const champ = o.querySelector('#p-statut'); champ.oninput = () => { statut = champ.value; };
    o.querySelector('#p-photo').onclick = () => o.querySelector('#p-fichier').click();
    o.querySelector('#p-fichier').onchange = async ev => {
      const f = ev.target.files[0]; if (!f) return;
      try { photo = await compressCarre(f); rendre(); } catch { toast('Impossible de préparer cette photo.'); }
    };
    const rt = o.querySelector('#p-retirer'); if (rt) rt.onclick = () => { photo = ''; rendre(); };
    o.querySelector('#p-annuler').onclick = () => o.remove();
    o.querySelector('#p-ok').onclick = () => {
      const st = statut.trim().slice(0, 80); const pv = Date.now();
      profils.set(uid, { photo, statut: st, pv }); sauverProfils();
      setDoc(doc(db, 'users', uid), { photo, statut: st, pv }, { merge: true }).catch(() => toast('Profil enregistré sur ce téléphone, pas encore partagé.'));
      o.remove(); toast('Profil enregistré ✓'); renderFeed();
      const pn = document.getElementById('panneau'); if (pn && state.panel === 'settings') renderSettings(pn);
    };
  };
  o.onclick = e => { if (e.target === o) o.remove(); };
  rendre();
}

function envoyerMessage(text, kind = 'text') {
  const data = { uid: state.user.uid, name: nomAffiche(state.user), kind, text, av: monAv(), createdAt: serverTimestamp() };
  if (state.reply) { data.reply = { id: state.reply.id, name: state.reply.name, extrait: state.reply.extrait }; state.reply = null; majContexte(); }
  addDoc(collection(db, 'messages'), data).catch(e => { console.error(e); toast(e && e.code === 'permission-denied' ? 'Envoi refusé par le serveur (règles Firestore).' : 'Message non envoyé.'); }); // pas de await : hors ligne, le message reste en attente
}

function envoyer() {
  const box = document.getElementById('texte');
  const text = box.value.trim();
  eclat('eclat', '#btn-send', 700);
  P.finSaisie();
  if (state.edit) {
    if (!text) return;
    const m = trouver(state.edit.id);
    if (m && text !== m.text) updateDoc(doc(db, 'messages', m.id), { text, editedAt: serverTimestamp() }).catch(() => toast('Modification impossible.'));
    annulerContexte(true);
    return;
  }
  if (!text) { envoyerMessage('👍'); return; } // zone vide : le bouton envoie un « J'aime »
  envoyerMessage(text, state.announce && estAdmin() ? 'announce' : 'text');
  box.value = ''; box.style.height = '';
  const lay = document.querySelector('.layout'); if (lay) lay.classList.remove('ecrit');
  state.announce = false; majAnnonce(); majBoutonEnvoi();
}

/* ---------- PDF (stockés comme les photos : 700 Ko maximum) ---------- */
const PDF_MAX = 700 * 1024;
async function onPickPdf(e) {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { toast('Choisis un fichier PDF.'); return; }
  if (file.size > PDF_MAX) { toast('PDF trop lourd : 700 Ko maximum. Réduis-le d\'abord.'); return; }
  try {
    const data = await new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ko; r.readAsDataURL(file); });
    const nom = file.name.slice(0, 80);
    const taille = Math.max(1, Math.round(file.size / 1024));
    const mref = doc(collection(db, 'media'));
    mediaCache.set(mref.id, data);
    setDoc(mref, { uid: state.user.uid, data, kind: 'pdf', nom, createdAt: serverTimestamp() }).catch(console.error);
    addDoc(collection(db, 'messages'), {
      uid: state.user.uid, name: nomAffiche(state.user), kind: 'pdf', mediaId: mref.id, nom, taille, av: monAv(), createdAt: serverTimestamp()
    }).catch(console.error);
  } catch (err) {
    toast('Impossible de préparer ce PDF.');
  }
}

async function ouvrirPdf(id, nom) {
  try {
    if (!mediaCache.has(id)) {
      toast('Chargement du PDF…');
      const snap = await getDoc(doc(db, 'media', id));
      if (!snap.exists()) { toast('PDF introuvable.'); return; }
      mediaCache.set(id, snap.data().data);
    }
    const [, b64] = String(mediaCache.get(id)).split(',');
    const bin = atob(b64); const oct = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) oct[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([oct], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url; a.download = nom || 'document.pdf'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    console.error(err); toast('Impossible d\'ouvrir ce PDF.');
  }
}

/* ---------- Appels de groupe (vocal ou vidéo) via une salle Jitsi Meet partagée ---------- */
const SALLE_APPEL = 'https://meet.jit.si/EnRConnect-ER1-Annee1';
function ouvrirAppel() {
  const o = document.createElement('div');
  o.className = 'voile';
  o.innerHTML = `
    <div class="dialogue" role="dialog" aria-modal="true" aria-label="Appel de groupe">
      <h3>Appel de groupe</h3>
      <p>Tout le groupe ER1 peut rejoindre la même salle. Un message avec le lien est envoyé dans la discussion.</p>
      <div class="boutons appel">
        <button type="button" class="annuler">Annuler</button>
        <button type="button" class="valider neutre" data-mode="voix">Appel vocal</button>
        <button type="button" class="valider" data-mode="video">Appel vidéo</button>
      </div>
    </div>`;
  document.body.appendChild(o);
  const fin = () => o.remove();
  o.querySelector('.annuler').onclick = fin;
  o.onclick = e => { if (e.target === o) fin(); };
  o.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { fin(); lancerAppel(b.dataset.mode === 'video'); });
}
function lancerAppel(video) {
  const url = SALLE_APPEL + (video ? '' : '#config.startWithVideoMuted=true');
  envoyerMessage((video ? '📹 Appel vidéo de groupe' : '📞 Appel vocal de groupe') + ' lancé par ' + nomAffiche(state.user) + '. Rejoins-nous : ' + url);
  if (NATIF) Browser.open({ url }).catch(() => window.open(url, '_blank'));
  else window.open(url, '_blank', 'noopener');
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
      uid: state.user.uid, name: nomAffiche(state.user), kind: 'image', mediaId: mref.id, taille, av: monAv(), createdAt: serverTimestamp()
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
  if (which === 'settings') renderSettings(p);
  else if (which === 'search') renderRecherche(p);
  else if (which === 'about') renderAbout(p);
  else renderAdmin(p);
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
  const admin = estAdmin();
  p.innerHTML = `
    ${enteteHTML('Infos du groupe')}
    <div class="corps">
      <div class="hero">
        <span class="avatar-groupe grand"><span class="logo grand"></span></span>
        <h1>EnR Connect</h1>
        <p>Groupe de discussion de la classe d'énergies renouvelables</p>
      </div>

      <h3 class="titre-section">Mon profil</h3>
      <button class="rangee" id="mon-profil">
        ${avatarHTML(nomAffiche(state.user), state.user.uid).replace('class="avatar', 'class="avatar gros').replace(/ data-prof="[^"]*"/, '')}
        <span class="libelle"><strong>${esc(nomAffiche(state.user))}</strong><small>${esc((profils.get(state.user.uid) || {}).statut || 'Ajouter une photo et un statut')}</small></span>
        <span class="fleche">${ICON.chevron}</span>
      </button>

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

      <div class="rangee statique">
        <span class="pastille">${ICON.palette}</span>
        <span class="libelle"><strong>Thème</strong><small>Automatique suit le réglage de ton téléphone.</small></span>
        <select class="choix" id="theme" aria-label="Thème">
          ${THEMES.map(([v, t]) => `<option value="${v}" ${themeActuel() === v ? 'selected' : ''}>${t}</option>`).join('')}
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
      <button class="rangee" id="a-propos">
        <span class="pastille">${ICON.info}</span>
        <span class="libelle"><strong>À propos et règles du groupe</strong><small>Version de l'appli et bonnes pratiques</small></span>
        <span class="fleche">${ICON.chevron}</span>
      </button>
      <button class="rangee" id="revoir-visite">
        <span class="pastille">${ICON.megaphone}</span>
        <span class="libelle"><strong>Revoir la visite guidée</strong><small>Explique chaque partie de l'écran et son rôle</small></span>
        <span class="fleche">${ICON.chevron}</span>
      </button>

      <h3 class="titre-section">Compte</h3>
      <div class="rangee statique">
        <span class="pastille">${ICON.user}</span>
        <span class="libelle"><strong>${esc(nomAffiche(state.user))}</strong><small>${esc(estPseudo(state.user) ? 'Compte avec pseudo' : state.user.email)} · ${state.role === 'createur' ? 'Créateur' : admin ? 'Administrateur' : 'Membre'}</small></span>
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
  p.querySelector('#theme').onchange = ev => reglerTheme(ev.target.value);
  p.querySelector('#mon-profil').onclick = () => modifierProfil();
  p.querySelector('#a-propos').onclick = () => openPanel('about');
  p.querySelector('#revoir-visite').onclick = () => { closePanel(); setTimeout(() => lancerVisite({ uid: state.user.uid, admin, force: true }), 350); };
  p.querySelector('#logout').onclick = () => { closePanel(); arreterNotifs(); P.arreter(); signOut(auth); };
}

function surligner(txt = '', t) {
  const i = txt.toLowerCase().indexOf(t);
  if (i < 0) return esc(txt.slice(0, 120));
  const a = Math.max(0, i - 30);
  return `${a > 0 ? '…' : ''}${esc(txt.slice(a, i))}<mark>${esc(txt.slice(i, i + t.length))}</mark>${esc(txt.slice(i + t.length, i + t.length + 90))}`;
}

function renderRecherche(p) {
  p.innerHTML = `
    <header class="entete-panneau"><button class="icone" id="close" aria-label="Retour">${ICON.retour}</button>
      <input id="q" class="champ-recherche" type="search" placeholder="Rechercher un mot ou un nom" autocomplete="off" aria-label="Rechercher dans les messages" /></header>
    <div class="corps" id="resultats"></div>`;
  const q = p.querySelector('#q'); const z = p.querySelector('#resultats');
  const afficher = () => {
    const t = q.value.trim().toLowerCase();
    if (t.length < 2) { z.innerHTML = `<p class="note">Tape au moins 2 lettres. La recherche porte sur les ${state.messages.length} derniers messages chargés. Pour remonter plus loin, utilise « Voir les messages précédents » dans la discussion.</p>`; return; }
    const res = state.messages.filter(m => (m.kind !== 'image' && String(m.text || '').toLowerCase().includes(t)) || String(m.name || '').toLowerCase().includes(t)).reverse().slice(0, 60);
    z.innerHTML = res.length
      ? res.map(m => `<button type="button" class="resultat" data-go="${esc(m.id)}"><span class="r-haut"><strong>${esc(m.name)}</strong><small>${esc(etiquette(dateDe(m)))}</small></span><span class="r-texte">${m.kind === 'image' ? '📷 Photo' : m.kind === 'pdf' ? '📄 ' + esc(m.nom || 'PDF') : surligner(m.text, t)}</span></button>`).join('')
      : '<p class="note">Aucun message trouvé.</p>';
  };
  q.oninput = afficher; afficher();
  z.onclick = e => { const b = e.target.closest('[data-go]'); if (!b) return; const id = b.dataset.go; closePanel(); setTimeout(() => allerAuMessage(id), 200); };
  p.querySelector('#close').onclick = closePanel;
  setTimeout(() => q.focus(), 150);
}

function renderAbout(p) {
  const build = import.meta.env.VITE_BUILD;
  p.innerHTML = `
    ${enteteHTML('À propos et règles')}
    <div class="corps">
      <div class="hero">
        <span class="avatar-groupe grand"><span class="logo grand"></span></span>
        <h1>EnR Connect</h1>
        <p>Le groupe de discussion de la classe d'énergies renouvelables : simple, léger et pensé pour consommer très peu de données.</p>
      </div>
      <p class="version">Version ${build ? esc(String(build)) : 'de développement'}</p>
      <h3 class="titre-section">Règles du groupe</h3>
      <ol class="regles">
        <li>Respecte tes camarades : pas d'insultes, de moqueries ni de harcèlement.</li>
        <li>Reste dans le sujet de la classe : cours, devoirs, projets et informations pratiques.</li>
        <li>Pas de spam, de chaînes de messages ni de publicité.</li>
        <li>Ne partage jamais les informations privées ou les photos d'une personne sans son accord.</li>
        <li>Les annonces des administrateurs sont officielles : lis-les avant de poser une question.</li>
        <li>Un souci avec les cours ou l'administration ? Écris-le dans le groupe : les doyens y sont pour t'aider.</li>
        <li>Un problème ou un abus ? Préviens un administrateur.</li>
      </ol>
      <h3 class="titre-section">Bon à savoir</h3>
      <p class="note">Appuie sur un message pour réagir, répondre, copier, modifier ou supprimer le tien. Tu peux envoyer des photos et des PDF (700 Ko maximum), et lancer un appel vocal ou vidéo de groupe avec le bouton téléphone en haut. Les photos sont réduites automatiquement. En mode économique, elles restent masquées jusqu'à ce que tu appuies dessus.</p>
    </div>`;
  p.querySelector('#close').onclick = closePanel;
}

/* Membres du groupe (réglages) */
let listeMembres = [];
async function chargerListeMembres() {
  try {
    listeMembres = await P.chargerMembres();
    listeMembres.forEach(m => { profils.set(m.uid, { photo: m.photo || '', statut: m.statut || '', pv: (profils.get(m.uid) || {}).pv || 0 }); });
    sauverProfils();
  } catch (e) { listeMembres = null; }
  remplirMembres();
}
function remplirMembres() {
  const zone = document.getElementById('membres'); if (!zone) return;
  if (listeMembres === null) { zone.innerHTML = '<p class="note">Impossible de charger la liste pour l\'instant.</p>'; return; }
  const moi = state.user.uid;
  const liste = listeMembres.map(m => ({ ...m, enLigne: P.estEnLigne(m.uid) }))
    .sort((a, b) => (b.enLigne - a.enLigne) || (b.vu - a.vu) || a.nom.localeCompare(b.nom, 'fr'));
  zone.onclick = e => { const r = e.target.closest('[data-membre]'); if (r) ouvrirFiche(r.dataset.membre); };
  const nb = document.getElementById('nb-membres');
  if (nb) nb.textContent = `(${liste.length} · ${liste.filter(m => m.enLigne).length} en ligne)`;
  zone.innerHTML = liste.map((m, i) => `
    <div class="rangee statique membre ${m.enLigne ? 'on' : ''}" data-membre="${esc(m.uid)}" style="--i:${Math.min(i, 12)}">
      <span class="avatar-pres">${avatarHTML(m.nom, m.uid).replace('class="avatar', 'class="avatar gros').replace(/ data-prof="[^"]*"/, '')}<i class="pastille-pres"></i></span>
      <span class="libelle"><strong>${esc(m.nom)}</strong><small>${m.statut ? esc(m.statut) : m.enLigne ? 'En ligne maintenant' : (m.vu ? 'Vu ' + esc(etiquette(new Date(m.vu))).toLowerCase() : 'Pas encore connecté')}</small></span>
      ${m.uid === moi ? '<span class="badge">Toi</span>' : m.role === 'createur' ? '<span class="badge">Créateur</span>' : m.role === 'admin' ? '<span class="badge">Admin</span>' : ''}
    </div>`).join('') || '<p class="note">Aucun membre pour l\'instant.</p>';
}

function renderAdmin(p) {
  p.innerHTML = `
    ${enteteHTML('Administration')}
    <div class="corps">
      <h3 class="titre-section">Ajouter un administrateur</h3>
      <p class="note">Tout le monde peut entrer dans le groupe avec son compte Google. Un administrateur peut publier des annonces, supprimer des messages et nommer d'autres administrateurs. Seul le créateur peut retirer un administrateur.</p>
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
        ${d.id === moi ? '<span class="badge">Toi</span>' : state.role === 'createur' ? `<button class="danger" data-rm="${esc(d.id)}">Retirer</button>` : ''}
      </div>`).join('') || '<p class="note">Aucun administrateur.</p>';
  });
  p.querySelector('#liste').onclick = async e => {
    const mail = e.target.dataset.rm; if (!mail || state.role !== 'createur') return;
    if (!(await confirmer('Retirer cet administrateur ?', mail, 'Retirer'))) return;
    await deleteDoc(doc(db, 'admins', mail)).catch(() => toast('Action impossible.'));
  };
}

import './update.js';
import { Capacitor } from '@capacitor/core';
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

const app = document.getElementById('app');
const PAGE = 30; // nombre de messages chargés à la fois (mode ultra léger)

const state = {
  user: null,
  role: null,            // 'admin' | 'member' | 'refused'
  eco: localStorage.getItem('eco') !== 'off', // mode économique : photos masquées tant qu'on n'appuie pas
  messages: [],
  limit: PAGE,
  announce: false,
  panel: null            // null | 'admin' | 'settings'
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
        <input id="mdp" type="password" placeholder="Mot de passe (6 caractères minimum)" autocomplete="${ins ? 'new-password' : 'current-password'}" minlength="6" required />
        <button class="primary" type="submit">${ins ? 'Créer mon compte' : 'Se connecter'}</button>
        <button class="lien" type="button" id="bascule">${ins ? "J'ai déjà un compte" : 'Créer un compte avec un pseudo'}</button>
      </form>
      <p class="msg-erreur" id="err">${esc(message)}</p>
    </main>`;
  document.getElementById('btn-login').onclick = signInGoogle;
  document.getElementById('pseudo-form').onsubmit = submitPseudo;
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
  if (!user) return renderLogin();
  if (!user.emailVerified && !estPseudo(user)) return renderLogin('Utilise un compte Google dont l\'adresse est vérifiée.');
  state.role = await resolveRole(user);
  localStorage.setItem('role:' + mailOf(user), state.role);
  if (state.role === 'refused') return renderRefused();
  startChat();
});

/* ---------- Discussion ---------- */
function stopAll() {
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
      state.messages = snap.docs.map(d => ({ id: d.id, pending: d.metadata.hasPendingWrites, ...d.data() })).reverse();
      renderFeed();
    },
    e => console.error(e)
  );
}

function startChat() {
  stopAll();
  state.limit = PAGE;
  renderShell();
  subscribeMessages();
}

// Mode ultra léger : en arrière-plan, l'appli coupe sa connexion (zéro donnée consommée).
// Les messages en attente partent dès qu'on rouvre l'appli.
let coupureTimer = null;
document.addEventListener('visibilitychange', () => {
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
  app.innerHTML = `
    <div class="layout">
      <header>
        <div>
          <h2>EnR Connect</h2>
          <div class="stats" id="stats"><span>Mode ultra léger</span></div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="statut" id="statut"></span>
          ${state.role === 'admin' ? '<button class="ghost" id="btn-admin" aria-label="Administration">Admin</button>' : ''}
          <button class="ghost" id="btn-set" aria-label="Réglages">Réglages</button>
        </div>
      </header>
      <section class="fil" id="fil" aria-live="polite"></section>
      <form class="envoi" id="form">
        <button type="button" class="photo" id="btn-photo" aria-label="Envoyer une photo">Photo</button>
        ${state.role === 'admin' ? '<button type="button" class="photo" id="btn-annonce" aria-pressed="false">Annonce</button>' : ''}
        <textarea id="texte" rows="1" placeholder="Écrire un message" maxlength="2000"></textarea>
        <button class="send" type="submit">Envoyer</button>
      </form>
      <input type="file" id="file" accept="image/*" hidden />
    </div>`;

  document.getElementById('form').onsubmit = e => { e.preventDefault(); sendText(); };
  document.getElementById('texte').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 700px)').matches) { e.preventDefault(); sendText(); }
  });
  document.getElementById('btn-photo').onclick = () => document.getElementById('file').click();
  document.getElementById('file').onchange = onPickPhoto;
  document.getElementById('btn-set').onclick = () => openPanel('settings');
  const ba = document.getElementById('btn-admin'); if (ba) ba.onclick = () => openPanel('admin');
  const bn = document.getElementById('btn-annonce');
  if (bn) bn.onclick = () => {
    state.announce = !state.announce;
    bn.setAttribute('aria-pressed', state.announce);
    bn.classList.toggle('primary', state.announce);
  };
  document.getElementById('fil').onclick = onFeedClick;
  renderStatut();
}

function renderStatut() {
  const el = document.getElementById('statut'); if (!el) return;
  const on = navigator.onLine;
  el.textContent = on ? 'En ligne' : 'Hors ligne';
  el.classList.toggle('hors', !on);
}

function bubbleHTML(m) {
  const moi = m.uid === state.user.uid;
  const annonce = m.kind === 'announce';
  const peutSuppr = state.role === 'admin' || moi;
  let contenu = '';
  if (m.kind === 'image') {
    if (mediaCache.has(m.mediaId)) contenu = `<img src="${mediaCache.get(m.mediaId)}" alt="Photo envoyée par ${esc(m.name)}" />`;
    else contenu = `<button class="media-masque" data-media="${esc(m.mediaId)}">Photo masquée${m.taille ? ' (' + m.taille + ' Ko)' : ''}. Appuie pour la charger (utilise des données).</button>`;
  } else {
    contenu = `<div>${esc(m.text).replace(/\n/g, '<br>')}</div>`;
  }
  return `
    <article class="bulle ${moi ? 'moi' : ''} ${annonce ? 'annonce' : ''}" id="m-${m.id}">
      ${moi && !annonce ? '' : `<div class="qui">${annonce ? 'Annonce de ' : ''}${esc(m.name)}</div>`}
      ${contenu}
      <div class="heure">${m.pending ? 'En attente d\'envoi · ' : ''}${heure(m.createdAt)}</div>
      ${peutSuppr ? `<button class="suppr" data-del="${m.id}">Supprimer</button>` : ''}
    </article>`;
}

function renderFeed() {
  const fil = document.getElementById('fil'); if (!fil) return;
  const proche = fil.scrollHeight - fil.scrollTop - fil.clientHeight < 140;
  const plus = state.messages.length >= state.limit
    ? '<button class="media-masque" data-plus="1">Voir les messages précédents</button>' : '';
  fil.innerHTML = state.messages.length
    ? plus + state.messages.map(bubbleHTML).join('')
    : '<p class="vide">Aucun message pour l\'instant. Écris le premier.</p>';
  if (proche) fil.scrollTop = fil.scrollHeight;
  // Mode normal : charger automatiquement les photos
  if (!state.eco) state.messages.filter(m => m.kind === 'image' && !mediaCache.has(m.mediaId)).forEach(m => loadMedia(m.mediaId));
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
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.plus) { state.limit += PAGE; t.textContent = 'Chargement…'; subscribeMessages(); return; }
  if (t.dataset.media) { t.textContent = 'Chargement…'; loadMedia(t.dataset.media); }
  if (t.dataset.del && confirm('Supprimer ce message ?')) deleteDoc(doc(db, 'messages', t.dataset.del)).catch(console.error);
}

function sendText() {
  const box = document.getElementById('texte');
  const text = box.value.trim(); if (!text) return;
  const kind = state.announce && state.role === 'admin' ? 'announce' : 'text';
  addDoc(collection(db, 'messages'), {
    uid: state.user.uid, name: state.user.displayName || mailOf(state.user).split('@')[0],
    kind, text, createdAt: serverTimestamp()
  }).catch(console.error); // pas de await : hors ligne, le message reste en attente
  box.value = '';
  if (state.announce) { state.announce = false; const b = document.getElementById('btn-annonce'); if (b) { b.classList.remove('primary'); b.setAttribute('aria-pressed', 'false'); } }
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
    const name = state.user.displayName || mailOf(state.user).split('@')[0];
    setDoc(mref, { uid: state.user.uid, data, createdAt: serverTimestamp() }).catch(console.error);
    addDoc(collection(db, 'messages'), {
      uid: state.user.uid, name, kind: 'image', mediaId: mref.id, taille, createdAt: serverTimestamp()
    }).catch(console.error);
  } catch (err) {
    alert('Impossible de préparer cette photo.');
  }
}

/* ---------- Panneaux : réglages et administration ---------- */
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

function renderSettings(p) {
  p.innerHTML = `
    <header><button class="ghost" id="close">Retour</button><h2>Réglages</h2></header>
    <div class="corps">
      <label class="interrupteur">
        <span><strong>Mode économique</strong><br><span class="note">Les photos restent masquées jusqu'à ce que tu appuies dessus. Le texte passe toujours avec très peu de données.</span></span>
        <input type="checkbox" id="eco" ${state.eco ? 'checked' : ''} />
      </label>
      <p class="note">Connecté avec ${esc(estPseudo(state.user) ? 'le pseudo ' + nomAffiche(state.user) : state.user.email)} ${state.role === 'admin' ? '(administrateur)' : ''}</p>
      <button class="danger" id="logout">Se déconnecter</button>
    </div>`;
  p.querySelector('#close').onclick = closePanel;
  p.querySelector('#eco').onchange = e => { state.eco = e.target.checked; localStorage.setItem('eco', state.eco ? 'on' : 'off'); renderFeed(); };
  p.querySelector('#logout').onclick = () => { closePanel(); signOut(auth); };
}

function renderAdmin(p) {
  p.innerHTML = `
    <header><button class="ghost" id="close">Retour</button><h2>Administration</h2></header>
    <div class="corps">
      <section>
        <h3>Ajouter un administrateur</h3>
        <p class="note">Tout le monde peut entrer dans le groupe avec son compte Google. Un administrateur peut publier des annonces, supprimer des messages et nommer d'autres administrateurs.</p>
        <form class="ajout" id="ajout">
          <input type="email" id="nouveau" placeholder="prenom.nom@gmail.com" required />
          <button class="primary" type="submit">Ajouter</button>
        </form>
      </section>
      <section>
        <h3>Administrateurs <span id="nb"></span></h3>
        <div id="liste"></div>
      </section>
    </div>`;
  p.querySelector('#close').onclick = closePanel;
  p.querySelector('#ajout').onsubmit = async e => {
    e.preventDefault();
    const input = p.querySelector('#nouveau');
    const mail = input.value.trim().toLowerCase(); if (!mail) return;
    await setDoc(doc(db, 'admins', mail), { addedBy: mailOf(state.user), addedAt: serverTimestamp() }).catch(() => alert('Ajout impossible.'));
    input.value = '';
  };
  panelUnsub = onSnapshot(collection(db, 'admins'), snap => {
    const liste = p.querySelector('#liste'); if (!liste) return;
    p.querySelector('#nb').textContent = `(${snap.size})`;
    const moi = mailOf(state.user);
    liste.innerHTML = snap.docs.map(d => `<div class="ligne"><span>${esc(d.id)}</span>${d.id === moi ? '<span class="note">toi</span>' : `<button class="danger" data-rm="${esc(d.id)}">Retirer</button>`}</div>`).join('')
      || '<p class="note">Aucun administrateur.</p>';
  });
  p.querySelector('#liste').onclick = async e => {
    const mail = e.target.dataset.rm; if (!mail) return;
    if (!confirm(`Retirer ${mail} des administrateurs ?`)) return;
    await deleteDoc(doc(db, 'admins', mail)).catch(() => alert('Action impossible.'));
  };
}

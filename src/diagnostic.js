// Mini-diagnostic : garde les erreurs de l'appli et les affiche dans un écran « Problèmes ».
// Un petit bouton 🩺 apparaît dès qu'une erreur est enregistrée. Rien n'est envoyé sur Internet.
const CLE = 'enr-problemes';
const MAX = 60;

function lire() {
  try { return JSON.parse(localStorage.getItem(CLE) || '[]'); } catch { return []; }
}
function ecrire(liste) {
  try { localStorage.setItem(CLE, JSON.stringify(liste.slice(-MAX))); } catch { /* stockage plein ou bloqué */ }
}

function noter(type, message) {
  const texte = String(message || '').slice(0, 600);
  const liste = lire();
  const dernier = liste[liste.length - 1];
  if (dernier && dernier.m === texte && dernier.t === type) { dernier.n = (dernier.n || 1) + 1; dernier.h = Date.now(); }
  else liste.push({ t: type, m: texte, h: Date.now(), n: 1 });
  ecrire(liste);
  majBouton();
  envoyer(type, texte);
}

// ——— Envoi vers l'appli « EnR Moniteur » (collection Firestore « problemes », lisible par les admins seulement) ———
const vus = new Set();
let envoyes = 0;
let occupe = false;

function marquer(type, message) {
  const liste = lire();
  const x = liste.find(i => i.t === type && i.m === message);
  if (x) { x.e = 1; ecrire(liste); }
}

async function envoyer(type, message) {
  if (envoyes >= 20 || occupe) return;
  if (/permission|insufficient|problemes/i.test(message)) return; // évite de boucler sur nos propres échecs d'envoi
  const cle = type + '|' + message.slice(0, 150);
  if (vus.has(cle)) return;
  occupe = true;
  try {
    const { auth, db } = await import('./firebase.js');
    const u = auth.currentUser;
    if (!u) return; // pas connecté : l'erreur reste en local et partira à la connexion
    const { collection, addDoc, serverTimestamp } = await import('firebase/firestore');
    await addDoc(collection(db, 'problemes'), {
      type,
      message,
      build: Number(import.meta.env.VITE_BUILD || 0),
      plateforme: window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() ? 'android' : 'web',
      nom: (u.displayName || '').slice(0, 60),
      uid: u.uid,
      ecran: innerWidth + 'x' + innerHeight,
      horsLigne: !navigator.onLine,
      at: serverTimestamp()
    });
    vus.add(cle);
    envoyes++;
    marquer(type, message);
  } catch { /* l'envoi est facultatif : l'erreur reste visible en local */ }
  finally { occupe = false; }
}

// À la connexion, on envoie les erreurs gardées en local qui ne sont pas encore parties
import('./firebase.js').then(({ auth }) => {
  auth.onAuthStateChanged(u => {
    if (!u) return;
    lire().filter(x => !x.e).slice(-10).forEach(x => envoyer(x.t, x.m));
  });
}).catch(() => {});

function texteErreur(e) {
  if (!e) return 'erreur inconnue';
  if (typeof e === 'string') return e;
  return (e.code ? e.code + ' : ' : '') + (e.message || String(e));
}

window.addEventListener('error', ev => {
  const lieu = ev.filename ? ' (' + ev.filename.split('/').pop() + ':' + ev.lineno + ')' : '';
  noter('erreur', texteErreur(ev.error || ev.message) + lieu);
});
window.addEventListener('unhandledrejection', ev => noter('promesse', texteErreur(ev.reason)));

const vraiErreur = console.error.bind(console);
console.error = (...a) => { noter('console', a.map(texteErreur).join(' ')); vraiErreur(...a); };

// ——— Écran ———
let bouton = null;

function majBouton() {
  if (!document.body) return;
  const n = lire().length;
  if (!n) { if (bouton) { bouton.remove(); bouton = null; } return; }
  if (!bouton) {
    bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.setAttribute('aria-label', 'Voir les problèmes');
    bouton.style.cssText = 'position:fixed;left:10px;bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:300;'
      + 'border:0;border-radius:999px;padding:8px 12px;background:#B42318;color:#fff;font:700 .8rem system-ui,sans-serif;'
      + 'box-shadow:0 3px 14px #0006;opacity:.92';
    bouton.addEventListener('click', ouvrir);
    document.body.appendChild(bouton);
  }
  bouton.textContent = '🩺 ' + n;
}

function etat() {
  const cap = window.Capacitor;
  const l = [];
  l.push('Version du site : ' + (Number(import.meta.env.VITE_BUILD || 0) || 'locale'));
  l.push('Appli Android : ' + (cap && cap.isNativePlatform && cap.isNativePlatform() ? 'oui' : 'non (navigateur)'));
  l.push('Réseau : ' + (navigator.onLine ? 'en ligne' : 'HORS LIGNE'));
  l.push('Notifications : ' + ('Notification' in window ? Notification.permission : 'non supportées'));
  l.push('Cache hors ligne : ' + (navigator.serviceWorker && navigator.serviceWorker.controller ? 'actif' : 'inactif'));
  l.push('Écran : ' + innerWidth + '×' + innerHeight);
  return l;
}

function rapport() {
  const heure = h => new Date(h).toLocaleString('fr-FR');
  return 'EnR Connect — problèmes\n' + etat().join('\n') + '\n\n'
    + lire().map(x => '[' + x.t + '] ' + heure(x.h) + (x.n > 1 ? ' (×' + x.n + ')' : '') + '\n' + x.m).join('\n\n');
}

function ouvrir() {
  const fond = document.createElement('div');
  fond.style.cssText = 'position:fixed;inset:0;z-index:400;background:#000a;display:flex;align-items:flex-end';
  const boite = document.createElement('div');
  boite.style.cssText = 'width:100%;max-height:85%;overflow:auto;background:#fff;color:#14202b;border-radius:16px 16px 0 0;'
    + 'padding:16px 16px calc(16px + env(safe-area-inset-bottom,0px));font:14px/1.45 system-ui,sans-serif;box-sizing:border-box';
  fond.appendChild(boite);

  const titre = document.createElement('h2');
  titre.textContent = '🩺 Problèmes de l’appli';
  titre.style.cssText = 'margin:0 0 8px;font-size:1.1rem';
  boite.appendChild(titre);

  const etatEl = document.createElement('div');
  etatEl.textContent = etat().join('\n');
  etatEl.style.cssText = 'white-space:pre-wrap;background:#f1f4f8;border-radius:8px;padding:8px;font-size:.8rem;margin-bottom:10px';
  boite.appendChild(etatEl);

  const liste = lire().slice().reverse();
  if (!liste.length) {
    const v = document.createElement('p'); v.textContent = 'Aucune erreur enregistrée. 👍'; boite.appendChild(v);
  }
  liste.forEach(x => {
    const c = document.createElement('div');
    c.style.cssText = 'border-left:4px solid #B42318;background:#fdf2f1;border-radius:6px;padding:6px 8px;margin-bottom:8px;word-break:break-word';
    const e = document.createElement('small');
    e.textContent = x.t + ' · ' + new Date(x.h).toLocaleTimeString('fr-FR') + (x.n > 1 ? ' · ×' + x.n : '');
    e.style.color = '#5b6b7a';
    const t = document.createElement('div'); t.textContent = x.m;
    c.append(e, t); boite.appendChild(c);
  });

  const barre = document.createElement('div');
  barre.style.cssText = 'display:flex;gap:8px;margin-top:6px';
  const mk = (txt, f) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = txt;
    b.style.cssText = 'flex:1;padding:11px;border:1px solid #d9e0e8;border-radius:10px;background:#f1f4f8;color:#14202b;font:600 .85rem system-ui,sans-serif';
    b.addEventListener('click', f); return b;
  };
  const copier = mk('Copier', async () => {
    try { await navigator.clipboard.writeText(rapport()); copier.textContent = 'Copié ✓'; } catch { copier.textContent = 'Copie impossible'; }
  });
  barre.append(
    copier,
    mk('Effacer', () => { ecrire([]); majBouton(); fond.remove(); }),
    mk('Fermer', () => fond.remove())
  );
  boite.appendChild(barre);
  fond.addEventListener('click', ev => { if (ev.target === fond) fond.remove(); });
  document.body.appendChild(fond);
}

window.enrProblemes = ouvrir;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', majBouton);
else majBouton();

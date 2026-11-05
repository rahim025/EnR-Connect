// Mise à jour automatique, sans bouton : l'appli affiche toujours la dernière version du site.
// Au lancement et au retour dans l'appli, on compare le numéro de version du site (version.json)
// avec celui qui tourne. Si le site est plus récent, la page se recharge toute seule.
const BUILD = Number(import.meta.env.VITE_BUILD || 0);

let derniere = 0;

function toast(texte) {
  const t = document.createElement('div');
  t.setAttribute('role', 'status');
  t.textContent = texte;
  t.style.cssText = 'position:fixed;left:50%;bottom:calc(88px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:60;'
    + 'background:#0E2A2F;color:#fff;padding:9px 16px;border-radius:999px;font:600 .85rem system-ui,sans-serif;'
    + 'box-shadow:0 4px 18px #0006;opacity:0;transition:opacity .4s';
  document.body.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = '1'; });
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 500); }, 2600);
}

async function verifier() {
  if (!BUILD || !navigator.onLine) return;
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const { build } = await r.json();
    if (!(build > BUILD)) return;
    // Ne jamais couper quelqu'un qui est en train d'écrire : on recharge au prochain retour dans l'appli
    const champ = document.getElementById('texte');
    if (champ && champ.value.trim()) return;
    try { sessionStorage.setItem('maj-appliquee', String(build)); } catch { /* ignoré */ }
    location.reload();
  } catch { /* pas de réseau ou pas de version.json : on réessaiera */ }
}

function verifierSiBesoin() {
  if (Date.now() - derniere < 60 * 1000) return;
  derniere = Date.now();
  verifier();
}

window.addEventListener('load', () => {
  // Cache hors ligne (uniquement sur le vrai site, pas en local)
  if ('serviceWorker' in navigator && location.protocol === 'https:' && location.hostname !== 'localhost') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  try {
    if (sessionStorage.getItem('maj-appliquee')) {
      sessionStorage.removeItem('maj-appliquee');
      setTimeout(() => toast('Mise à jour appliquée ✓'), 1200);
    }
  } catch { /* ignoré */ }
  setTimeout(verifierSiBesoin, 2500);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) verifierSiBesoin(); });

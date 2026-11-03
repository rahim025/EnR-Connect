// Vérifie s'il existe une version plus récente de l'appli et propose de la télécharger.
// Un bouton « Mettre à jour » clignote en haut ; l'étudiant peut l'ignorer (✕) et continuer avec son ancienne version.
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

const DEPOT = 'rahim025/EnR-Connect';           // compte/dépôt GitHub (le dépôt doit être public)
const BUILD = Number(import.meta.env.VITE_BUILD || 0); // numéro de cette version, fixé au moment du build

function afficher(numero, lien) {
  if (document.getElementById('maj')) return;

  const style = document.createElement('style');
  style.textContent = `
    #maj { position: fixed; left: 50%; transform: translateX(-50%); z-index: 50; display: flex; align-items: stretch;
      border-radius: 999px; overflow: hidden; background: #F5A623; box-shadow: 0 4px 18px #0005;
      font-family: system-ui, sans-serif; animation: maj-clignote 1.4s ease-in-out infinite; }
    #maj button { font: inherit; border: 0; cursor: pointer; color: #0E2A2F; background: transparent; }
    #maj .oui { font-weight: 700; font-size: .9rem; padding: 8px 8px 8px 16px; display: flex; align-items: center; gap: 6px; }
    #maj .non { padding: 8px 12px 8px 6px; font-size: 1rem; opacity: .7; }
    #maj button:focus-visible { outline: 3px solid #0E2A2F; outline-offset: -3px; }
    @keyframes maj-clignote {
      0%, 100% { opacity: 1; box-shadow: 0 4px 18px #0005, 0 0 0 0 #F5A623aa; }
      50% { opacity: .55; box-shadow: 0 4px 18px #0005, 0 0 0 10px #F5A62300; } }
    @media (prefers-reduced-motion: reduce) { #maj { animation: none; } }`;
  document.head.appendChild(style);

  const bouton = document.createElement('div');
  bouton.id = 'maj';
  bouton.setAttribute('role', 'status');
  bouton.innerHTML = `
    <button class="oui" type="button" aria-label="Mettre à jour EnR Connect">⬆ Mettre à jour</button>
    <button class="non" type="button" aria-label="Ignorer cette mise à jour">✕</button>`;
  document.body.appendChild(bouton);

  // Se place juste sous l'en-tête de la messagerie (ou en haut de l'écran sur la page de connexion)
  const placer = () => {
    const entete = document.querySelector('.entete');
    const bas = entete ? entete.getBoundingClientRect().bottom : 0;
    bouton.style.top = (bas + 8) + 'px';
  };
  placer();
  const suivi = setInterval(() => { if (!document.getElementById('maj')) clearInterval(suivi); else placer(); }, 800);
  window.addEventListener('resize', placer);

  bouton.querySelector('.non').onclick = () => {
    // L'étudiant garde son ancienne version : on ne redemande pas pour cette version-là
    localStorage.setItem('maj-ignoree', String(numero));
    bouton.remove();
  };
  bouton.querySelector('.oui').onclick = () => {
    if (Capacitor.isNativePlatform()) Browser.open({ url: lien });
    else window.open(lien, '_blank');
  };
}

async function verifier() {
  if (!BUILD || !navigator.onLine) return; // pas de numéro de version (mode test) ou pas de réseau
  try {
    const r = await fetch(`https://api.github.com/repos/${DEPOT}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' }
    });
    if (!r.ok) return;
    const rel = await r.json();
    const numero = parseInt(String(rel.tag_name).replace(/\D/g, ''), 10);
    if (!numero || numero <= BUILD) return;
    if (localStorage.getItem('maj-ignoree') === String(numero)) return;
    const apk = (rel.assets || []).find(a => a.name.endsWith('.apk'));
    afficher(numero, apk ? apk.browser_download_url : rel.html_url);
  } catch (e) {
    // pas grave : on réessaiera au prochain lancement
  }
}

let derniere = 0;
function verifierSiBesoin() {
  if (Date.now() - derniere < 10 * 60 * 1000) return;
  derniere = Date.now();
  verifier();
}
window.addEventListener('load', () => setTimeout(verifierSiBesoin, 2500));
document.addEventListener('visibilitychange', () => { if (!document.hidden) verifierSiBesoin(); });

// Vérifie s'il existe une version plus récente de l'appli et propose de la télécharger.
// L'étudiant peut toujours choisir « Plus tard » et continuer avec son ancienne version.
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

const DEPOT = 'rahim025/EnR-Connect';           // compte/dépôt GitHub (le dépôt doit être public)
const BUILD = Number(import.meta.env.VITE_BUILD || 0); // numéro de cette version, fixé au moment du build

function afficher(numero, lien) {
  if (document.getElementById('maj')) return;

  const style = document.createElement('style');
  style.textContent = `
    #maj { position: fixed; left: 10px; right: 10px; top: max(10px, env(safe-area-inset-top)); z-index: 50;
      background: #0E2A2F; color: #fff; border: 2px solid #F5A623; border-radius: 14px; padding: 12px 14px;
      display: flex; flex-direction: column; gap: 10px; box-shadow: 0 6px 24px #0006; font-family: system-ui, sans-serif; }
    #maj p { margin: 0; font-size: .95rem; line-height: 1.35; }
    #maj .actions { display: flex; gap: 8px; justify-content: flex-end; }
    #maj button { font: inherit; border: 0; border-radius: 10px; padding: 9px 14px; cursor: pointer; }
    #maj .oui { background: #F5A623; color: #0E2A2F; font-weight: 700; }
    #maj .non { background: transparent; color: #B9CCCB; }
    #maj button:focus-visible { outline: 3px solid #F5A623; outline-offset: 2px; }`;
  document.head.appendChild(style);

  const bandeau = document.createElement('div');
  bandeau.id = 'maj';
  bandeau.setAttribute('role', 'alert');
  bandeau.innerHTML = `
    <p>Une nouvelle version d'EnR Connect est disponible.</p>
    <div class="actions">
      <button class="non" type="button">Plus tard</button>
      <button class="oui" type="button">Mise à jour</button>
    </div>`;
  document.body.appendChild(bandeau);

  bandeau.querySelector('.non').onclick = () => {
    localStorage.setItem('maj-ignoree', String(numero)); // ne plus redemander pour cette version
    bandeau.remove();
  };
  bandeau.querySelector('.oui').onclick = () => {
    if (Capacitor.isNativePlatform()) Browser.open({ url: lien });
    else window.open(lien, '_blank');
    bandeau.remove();
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

window.addEventListener('load', () => setTimeout(verifier, 2500));

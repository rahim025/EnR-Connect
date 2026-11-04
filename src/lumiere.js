// Jeu de lumière « master class » : couches supplémentaires (aurores, faisceau, halo solaire, onde)
// + profondeur au mouvement du téléphone. Trois niveaux au choix dans Réglages : intense, doux, éteint.

const CLE = 'lumiere';
export const NIVEAUX = [['intense', 'Intense'], ['doux', 'Doux'], ['off', 'Éteint']];
export const niveau = () => { try { return localStorage.getItem(CLE) || 'intense'; } catch { return 'intense'; } };

const COUCHES = `
  <i class="mc-vignette"></i>
  <i class="mc-soleil"></i>
  <i class="mc-aurore mc-a1"></i>
  <i class="mc-aurore mc-a2"></i>
  <i class="mc-faisceau"></i>
  <i class="mc-onde"></i>`;

function appliquer() {
  const lay = document.querySelector('.layout');
  if (!lay) return;
  const n = niveau();
  lay.classList.toggle('lum-doux', n === 'doux');
  lay.classList.toggle('lum-off', n === 'off');
  if (n !== 'intense') raz();
  suivreInclinaison();
}

export function reglerNiveau(n) {
  try { localStorage.setItem(CLE, n); } catch { /* ignoré */ }
  appliquer();
}

/* ---- Profondeur : les couches glissent légèrement quand on incline le téléphone ---- */
let ecoute = false, cx = 0, cy = 0, cibleX = 0, cibleY = 0, raf = 0;
const borne = (v, m) => Math.max(-m, Math.min(m, v));
function raz() { cibleX = cibleY = cx = cy = 0; poser(); }
function poser() {
  const ciel = document.querySelector('.layout > .ciel');
  if (ciel) { ciel.style.setProperty('--tx', cx.toFixed(2)); ciel.style.setProperty('--ty', cy.toFixed(2)); }
}
function boucle() {
  raf = 0;
  cx += (cibleX - cx) * 0.12; cy += (cibleY - cy) * 0.12;
  poser();
  if (Math.abs(cibleX - cx) > 0.05 || Math.abs(cibleY - cy) > 0.05) raf = requestAnimationFrame(boucle);
}
function onOrientation(e) {
  if (e.gamma == null || e.beta == null) return;
  cibleX = borne(e.gamma / 40, 1) * 14;        // gauche / droite
  cibleY = borne((e.beta - 50) / 40, 1) * 14;  // avant / arrière (téléphone tenu à ~50°)
  if (!raf) raf = requestAnimationFrame(boucle);
}
function suivreInclinaison() {
  const voulu = niveau() === 'intense' && document.visibilityState === 'visible'
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (voulu && !ecoute) { window.addEventListener('deviceorientation', onOrientation, { passive: true }); ecoute = true; }
  if (!voulu && ecoute) { window.removeEventListener('deviceorientation', onOrientation); ecoute = false; if (raf) { cancelAnimationFrame(raf); raf = 0; } }
}
document.addEventListener('visibilitychange', () => {
  const lay = document.querySelector('.layout');
  if (lay) lay.classList.toggle('pause', document.visibilityState === 'hidden'); // économise la batterie
  suivreInclinaison();
});

/* À appeler après chaque rendu de l'écran de messagerie */
export function monterLumiere() {
  const ciel = document.querySelector('.layout > .ciel');
  if (!ciel) return;
  if (!ciel.dataset.mc) { ciel.dataset.mc = '1'; ciel.insertAdjacentHTML('beforeend', COUCHES); }
  appliquer();
}

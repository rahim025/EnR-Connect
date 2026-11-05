// Thème de l'appli : automatique (suit le téléphone), clair ou sombre.
const CLE = 'theme';
export const THEMES = [['auto', 'Automatique'], ['clair', 'Clair'], ['sombre', 'Sombre']];
export const theme = () => { try { return localStorage.getItem(CLE) || 'auto'; } catch { return 'auto'; } };

const sombreSysteme = window.matchMedia('(prefers-color-scheme: dark)');

export function appliquerTheme(t = theme()) {
  const racine = document.documentElement;
  if (t === 'auto') racine.removeAttribute('data-theme');
  else racine.setAttribute('data-theme', t === 'sombre' ? 'dark' : 'light');
  // Couleur de la barre du navigateur / de l'état du téléphone
  const sombre = t === 'sombre' || (t === 'auto' && sombreSysteme.matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.remove());
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = sombre ? '#0B2327' : '#FFFFFF';
  document.head.appendChild(meta);
}

export function reglerTheme(t) {
  try { localStorage.setItem(CLE, t); } catch { /* ignoré */ }
  appliquerTheme(t);
}

if (sombreSysteme.addEventListener) sombreSysteme.addEventListener('change', () => { if (theme() === 'auto') appliquerTheme('auto'); });
appliquerTheme();

// Visite guidée : à la première connexion, chaque partie de l'écran est éclairée et expliquée.
// Elle se rouvre depuis Réglages → « Revoir la visite guidée ».

const CLE = uid => 'visite-vue:' + uid;
const dejaVue = uid => { try { return localStorage.getItem(CLE(uid)) === '1'; } catch { return false; } };
const marquerVue = uid => { try { localStorage.setItem(CLE(uid), '1'); } catch { /* ignoré */ } };

const style = document.createElement('style');
style.textContent = `
  .visite { position: fixed; inset: 0; z-index: 100; touch-action: none; }
  .visite .halo { position: fixed; border-radius: 14px; box-shadow: 0 0 0 9999px rgba(5, 18, 20, .78), 0 0 0 3px #F5A623, 0 0 22px 4px rgba(245, 166, 35, .55); transition: all .28s ease; pointer-events: none; }
  .visite .halo.plein { inset: 0; width: 0; height: 0; left: 50%; top: 50%; box-shadow: 0 0 0 9999px rgba(5, 18, 20, .82); }
  .visite .carte { position: fixed; max-height: calc(100dvh - 28px); overflow-y: auto; left: 14px; right: 14px; max-width: 420px; margin: 0 auto; box-sizing: border-box; padding: 16px 16px 12px; border-radius: 18px; background: var(--bg, #fff); color: var(--texte, #050505); box-shadow: 0 10px 40px rgba(0, 0, 0, .45); transition: top .28s ease, bottom .28s ease; }
  .visite .carte h3 { margin: 0 0 6px; font-size: 1.05rem; }
  .visite .carte p { margin: 0; font-size: .95rem; line-height: 1.42; color: var(--texte2, #65676B); }
  .visite .pied { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
  .visite .compteur { flex: 1; font-size: .8rem; color: var(--texte2, #65676B); }
  .visite .pied button { font: inherit; font-weight: 600; border: 0; border-radius: 99px; padding: 9px 16px; cursor: pointer; background: var(--surface2, #F0F2F5); color: var(--texte, #050505); }
  .visite .pied button.suivant { background: #F5A623; color: #1a1200; }
  .visite .pied button.passer { background: none; padding-left: 4px; padding-right: 4px; color: var(--texte2, #65676B); font-weight: 500; }
`;
document.head.appendChild(style);

let ouverte = false;

function etapes(admin) {
  const liste = [
    { titre: 'Bienvenue dans EnR Connect', texte: "C'est le groupe de discussion de la filière ER1. Cette visite de 30 secondes te montre à quoi sert chaque bouton, de haut en bas." },
    { cible: '.marque', titre: 'Le groupe', texte: "Le nom du groupe, avec en dessous le nombre de personnes en ligne. Appuie dessus pour voir la liste des membres." },
    { cible: '#btn-docs', titre: 'Documents par matière', texte: "Les PDF sont rangés par matière dans des dossiers. Ouvre un dossier pour retrouver les cours et les épreuves. Quand tu envoies un PDF, tu choisis son dossier." },
    { cible: '#btn-appel', titre: 'Appel de groupe', texte: "Lance un appel vocal avec les membres du groupe qui sont connectés." },
    { cible: '#btn-search', titre: 'Rechercher', texte: "Retrouve un ancien message grâce à un mot ou à un nom. Appuie sur un résultat pour aller directement au message." }
  ];
  if (admin) liste.push({ cible: '#btn-admin', titre: 'Administration', texte: "Réservé aux administrateurs : nommer d'autres administrateurs et gérer le groupe. Ils peuvent aussi supprimer des messages." });
  liste.push(
    { cible: '#btn-set', titre: 'Infos du groupe et réglages', texte: "Ton profil, la liste des membres, le thème clair ou sombre, les effets de lumière, le mode économique, les notifications, les règles du groupe et le bouton Se déconnecter." },
    { cible: '#fil', titre: 'Le fil de discussion', texte: "Tous les messages s'affichent ici, jour par jour. Appuie sur un message pour réagir, répondre, copier, ou modifier et supprimer les tiens. Appuie sur une photo de profil pour voir la fiche du membre." },
    { cible: '#btn-photo', titre: 'Envoyer une photo', texte: "Choisis une image dans ta galerie. Elle est réduite automatiquement pour consommer peu de données, et reste masquée chez les autres tant qu'ils n'appuient pas dessus." },
    { cible: '#btn-pdf', titre: 'Envoyer un document', texte: "Partage un fichier PDF : cours, énoncé, exercices. Les autres l'ouvrent en appuyant dessus." }
  );
  if (admin) liste.push({ cible: '#btn-annonce', titre: 'Publier une annonce', texte: "Réservé aux administrateurs : active ce bouton avant d'envoyer, et ton message sera publié comme annonce officielle visible par toute la classe." });
  liste.push(
    { cible: '#texte', titre: 'Écrire un message', texte: "Écris ton message ici. Le texte consomme très peu de données, même avec un petit forfait." },
    { cible: '#btn-send', titre: "J'aime et Envoyer", texte: "Quand la zone de texte est vide, ce bouton envoie un J'aime. Dès que tu écris, il devient le bouton Envoyer." },
    { titre: "C'est parti !", texte: "Tu peux revoir cette visite quand tu veux : Réglages, puis Revoir la visite guidée." }
  );
  return liste;
}

export function lancerVisite({ uid, admin = false, force = false } = {}) {
  if (ouverte || !uid) return;
  if (!force && dejaVue(uid)) return;
  ouverte = true;

  const liste = etapes(admin);
  let i = 0;

  const racine = document.createElement('div');
  racine.className = 'visite';
  racine.setAttribute('role', 'dialog');
  racine.setAttribute('aria-modal', 'true');
  racine.setAttribute('aria-label', 'Visite guidée');
  racine.innerHTML = `
    <div class="halo plein"></div>
    <div class="carte">
      <h3></h3><p></p>
      <div class="pied">
        <button type="button" class="passer">Passer</button>
        <span class="compteur"></span>
        <button type="button" class="precedent">Retour</button>
        <button type="button" class="suivant">Suivant</button>
      </div>
    </div>`;
  document.body.appendChild(racine);

  const halo = racine.querySelector('.halo');
  const carte = racine.querySelector('.carte');
  const bPrec = racine.querySelector('.precedent');
  const bSuiv = racine.querySelector('.suivant');

  function fermer() {
    marquerVue(uid);
    window.removeEventListener('resize', afficher);
    racine.remove();
    ouverte = false;
  }

  function afficher() {
    const e = liste[i];
    let cible = e.cible ? document.querySelector(e.cible) : null;
    if (cible && !cible.getClientRects().length) cible = null; // élément absent ou caché : étape centrée
    if (cible && e.cible !== '#fil') { try { cible.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { /* ignoré */ } }
    carte.querySelector('h3').textContent = e.titre;
    carte.querySelector('p').textContent = e.texte;
    racine.querySelector('.compteur').textContent = (i + 1) + ' / ' + liste.length;
    bPrec.style.visibility = i === 0 ? 'hidden' : 'visible';
    bSuiv.textContent = i === liste.length - 1 ? 'Terminer' : (i === 0 ? 'Commencer' : 'Suivant');

    carte.style.top = carte.style.bottom = 'auto';
    if (!cible) {
      halo.className = 'halo plein';
      halo.style.cssText = '';
      carte.style.top = '50%';
      carte.style.transform = 'translateY(-50%)';
      return;
    }
    carte.style.transform = 'none';
    const r = cible.getBoundingClientRect();
    const marge = 6;
    const h = window.innerHeight;
    const hautSafe = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-top')) || 0;
    halo.className = 'halo';
    halo.style.left = Math.max(r.left - marge, 4) + 'px';
    halo.style.top = Math.max(r.top - marge, 4) + 'px';
    halo.style.width = Math.min(r.width + marge * 2, window.innerWidth - 8) + 'px';
    halo.style.height = (r.height + marge * 2) + 'px';
    halo.style.inset = '';

    const place = carte.offsetHeight + 16;
    const dessous = h - r.bottom - marge;
    const dessus = r.top - marge;
    if (dessous >= place) carte.style.top = (r.bottom + marge + 12) + 'px';
    else if (dessus >= place) carte.style.bottom = (h - r.top + marge + 12) + 'px';
    else if (e.cible === '#fil') carte.style.top = (hautSafe + 80) + 'px'; // grande zone : la carte se pose en haut, le fil reste visible dessous
    else carte.style.bottom = '14px';
  }

  racine.querySelector('.passer').onclick = fermer;
  bPrec.onclick = () => { if (i > 0) { i--; afficher(); } };
  bSuiv.onclick = () => { if (i < liste.length - 1) { i++; afficher(); } else fermer(); };
  window.addEventListener('resize', afficher);
  afficher();
}

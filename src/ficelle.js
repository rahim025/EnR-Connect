// Ficelle de la lampe : vraie corde simulée (intégration de Verlet en 3D).
// - on l'attrape et on la tire dans n'importe quelle direction ;
// - à la relâche elle revient en rebondissant, puis se balance en tous sens (cône, ellipses) jusqu'à s'immobiliser ;
// - le pompon est plus lourd que la corde, comme un vrai pendule.
// Repère = celui de la lampe (px). Boucle d'animation stoppée dès que la corde est au repos.

const N = 18;              // segments
const L0 = 76;             // longueur au repos (px)
const AX = 100, AY = 91;   // point d'attache : anneau de l'abat-jour
const MAXTIRAGE = 56;      // allongement maximal quand on tire
const G = 1600;            // gravité (px/s²)
const DT = 1 / 120;
const ITER = 18;
const SEUIL = 26;          // tirage nécessaire pour allumer / éteindre

export function monterFicelle(lampe, zone, onBascule) {
  const svg = lampe.querySelector('.corde');
  if (!svg) return;
  const traits = [...svg.querySelectorAll('.c-base, .c-fil, .c-lit, .c-lum')];
  const bouton = svg.querySelector('.bouton');
  const reduit = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const P = Array.from({ length: N + 1 }, (_, i) => {
    const y = AY + L0 * i / N;
    return { x: AX, y, z: 0, px: AX, py: y, pz: 0, w: i === N ? 0.3 : 1 };
  });
  let extra = 0, ev = 0;      // allongement (tirage) et sa vitesse
  let drag = null, raf = 0, last = 0, acc = 0;

  function pas(dt) {
    if (drag) { extra = drag.extra; ev = 0; }
    else {
      ev += (-260 * extra - 14 * ev) * dt;      // ressort de rappel : rebondit avant de se stabiliser
      extra += ev * dt;
      if (extra < -8) { extra = -8; ev = Math.max(ev, 0); }
    }
    const seg = Math.max(8, L0 + extra) / N;
    const amorti = reduit ? 0.9 : 0.9935;
    for (let i = 1; i <= N; i++) {
      if (drag && i === N) continue;
      const p = P[i];
      const vx = (p.x - p.px) * amorti, vy = (p.y - p.py) * amorti, vz = (p.z - p.pz) * amorti;
      p.px = p.x; p.py = p.y; p.pz = p.z;
      p.x += vx; p.y += vy + G * dt * dt; p.z += vz;
    }
    if (drag) { const e = P[N]; e.x = e.px = drag.x; e.y = e.py = drag.y; e.z = e.pz = 0; }
    for (let it = 0; it < ITER; it++) {
      for (let i = 0; i < N; i++) {
        const a = P[i], b = P[i + 1];
        const wa = i === 0 ? 0 : a.w, wb = (drag && i + 1 === N) ? 0 : b.w;
        const ws = wa + wb; if (!ws) continue;
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        const k = (d - seg) / d / ws;
        a.x += dx * k * wa; a.y += dy * k * wa; a.z += dz * k * wa;
        b.x -= dx * k * wb; b.y -= dy * k * wb; b.z -= dz * k * wb;
      }
    }
  }

  function dessiner() {
    let d = `M${P[0].x.toFixed(2)} ${P[0].y.toFixed(2)}`;
    for (let i = 1; i < N; i++) {
      const mx = (P[i].x + P[i + 1].x) / 2, my = (P[i].y + P[i + 1].y) / 2;
      d += ` Q${P[i].x.toFixed(2)} ${P[i].y.toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`;
    }
    const e = P[N], q = P[N - 1];
    d += ` L${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
    traits.forEach(t => t.setAttribute('d', d));
    // Éclairage du pompon : plus faible quand il s'éloigne de l'ampoule, nul hors du faisceau (sous le bord de l'abat-jour)
    const dist = Math.hypot(e.x - 60, e.y - 98);
    const cone = Math.max(0, Math.min(1, (e.y - (98 - 0.25 * Math.abs(e.x - 60))) / 14));
    bouton.style.setProperty('--eclat', (Math.max(0, Math.min(1, 1.15 - dist / 190)) * cone).toFixed(3));
    const ang = Math.atan2(e.y - q.y, e.x - q.x) * 180 / Math.PI - 90;
    const s = Math.max(0.85, Math.min(1.2, 1 + e.z / 450));   // léger effet de profondeur
    bouton.setAttribute('transform', `translate(${e.x.toFixed(2)} ${e.y.toFixed(2)}) rotate(${ang.toFixed(1)}) scale(${s.toFixed(3)})`);
    zone.style.transform = `translate(${(e.x - 25).toFixed(1)}px, ${(e.y - 16).toFixed(1)}px)`;
  }

  const auRepos = () => {
    let v = 0;
    for (const p of P) v = Math.max(v, Math.abs(p.x - p.px), Math.abs(p.y - p.py), Math.abs(p.z - p.pz));
    return v < 0.012 && Math.abs(P[N].x - AX) < 0.4 && Math.abs(extra) < 0.05 && Math.abs(ev) < 0.2;
  };

  function boucle(t) {
    raf = 0;
    if (!zone.isConnected) return;
    acc += Math.min(0.05, (t - last) / 1000 || DT); last = t;
    while (acc >= DT) { pas(DT); acc -= DT; }
    dessiner();
    if (drag || !auRepos()) raf = requestAnimationFrame(boucle);
  }
  const reveiller = () => { if (!raf) { last = performance.now(); acc = 0; raf = requestAnimationFrame(boucle); } };

  // Coup de pouce : fait osciller la corde dans toutes les directions
  function secouer(fx = 0.6, fy = 0, fz = 0.9) {
    for (let i = 1; i <= N; i++) {
      const k = i / N, p = P[i];
      p.px -= (Math.random() - 0.5) * 2 * fx * k; p.py -= fy * k;
      p.pz -= (Math.random() - 0.5) * 2 * fz * k;
    }
    reveiller();
  }

  /* ---- Interaction : on attrape le pompon et on le tire où l'on veut ---- */
  const pos = e => { const r = lampe.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  let hist = [];
  zone.addEventListener('pointerdown', e => {
    const m = pos(e), end = P[N];
    drag = { ox: end.x - m.x, oy: end.y - m.y, x: end.x, y: end.y, extra: Math.max(0, extra) };
    hist = [{ ...m, t: e.timeStamp }];
    zone.setPointerCapture(e.pointerId); zone.classList.add('tire'); reveiller();
  });
  zone.addEventListener('pointermove', e => {
    if (!drag) return;
    const m = pos(e);
    hist.push({ ...m, t: e.timeStamp }); if (hist.length > 6) hist.shift();
    let tx = m.x + drag.ox, ty = m.y + drag.oy;
    const pull = Math.max(0, Math.min(ty - (AY + L0), MAXTIRAGE));
    const reach = (L0 + pull) * 0.998;
    const dx = tx - AX, dy = ty - AY, d = Math.hypot(dx, dy);
    if (d > reach) { tx = AX + dx * reach / d; ty = AY + dy * reach / d; }
    drag.x = tx; drag.y = ty; drag.extra = pull;
  });
  const lacher = (annule) => {
    if (!drag) return;
    const tire = !annule && drag.extra > SEUIL;
    // la corde garde la vitesse du doigt
    const a = hist[0], b = hist[hist.length - 1];
    if (a && b && b.t > a.t) {
      const vx = (b.x - a.x) / (b.t - a.t) * 1000, vy = (b.y - a.y) / (b.t - a.t) * 1000;
      const cap = v => Math.max(-900, Math.min(900, v));
      for (let i = N; i > N - 5; i--) { P[i].px = P[i].x - cap(vx) * DT * 0.8; P[i].py = P[i].y - cap(vy) * DT * 0.8; }
    }
    ev = 0; drag = null; hist = [];
    zone.classList.remove('tire');
    if (tire) { if (navigator.vibrate) navigator.vibrate(12); secouer(0.7, 0, 1.1); onBascule(); }
    reveiller();
  };
  zone.addEventListener('pointerup', () => lacher(false));
  zone.addEventListener('pointercancel', () => lacher(true));
  zone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); extra = 30; secouer(0.8, 0, 1); onBascule(); }
  });

  dessiner();
}

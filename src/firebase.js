import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, memoryLocalCache } from 'firebase/firestore';
import { firebaseConfig } from './firebase-config.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Cache en mémoire : plus de base locale partagée entre fenêtres (appli, bulle, service),
// ce qui pouvait laisser un message « en attente » pour toujours. Un message écrit sans réseau part
// dès que la connexion revient, tant que l'appli reste ouverte.
export const db = initializeFirestore(app, {
  // Certains réseaux mobiles et WebView bloquent la connexion temps réel : l'appli bascule alors toute seule sur un mode compatible
  experimentalAutoDetectLongPolling: true,
  localCache: memoryLocalCache()
});

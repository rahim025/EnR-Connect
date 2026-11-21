import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { firebaseConfig } from './firebase-config.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Le cache local permet d'écrire sans connexion : les messages partent dès que le réseau revient.
export const db = initializeFirestore(app, {
  // Certains réseaux mobiles et WebView bloquent la connexion temps réel : l'appli bascule alors toute seule sur un mode compatible
  experimentalAutoDetectLongPolling: true,
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

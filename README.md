# EnR Connect

Groupe de discussion de la classe (énergies renouvelables).

- Une seule messagerie pour toute la salle
- Connexion avec Google uniquement
- Compteur de membres et de personnes connectées
- Administrateurs : annonces, suppression de messages, ajout et retrait d'étudiants
- Mode économique : le texte consomme très peu, les photos ne se chargent que si on appuie dessus
- Messages écrits sans réseau : ils partent automatiquement quand la connexion revient

## Étape 1. Créer le projet Firebase (gratuit)

1. Va sur https://console.firebase.google.com et crée un projet « enr-connect ».
2. **Authentication** > Commencer > Méthode de connexion > active **Google**.
3. **Firestore Database** > Créer une base (mode production, région proche de toi).
4. Onglet **Règles** de Firestore : colle le contenu du fichier `firestore.rules` puis Publier.
5. **Paramètres du projet** > Tes applications > ajoute une application **Web** (</>) et copie la configuration dans `src/firebase-config.js`.
6. Dans le même écran, ajoute une application **Android** :
   - nom du package : `com.enrconnect.app`
   - empreinte SHA-1 : `D7:A4:96:6C:AC:1F:B1:75:9D:0C:49:A3:B7:7C:BF:41:5B:8E:DA:81`
   - télécharge le fichier `google-services.json` (garde-le pour l'étape 3).

## Étape 2. Te déclarer administrateur

Dans Firestore, crée la collection `admins` avec un document dont l'**identifiant est ton adresse Gmail en minuscules** (ex. `toi@gmail.com`). Aucun champ n'est obligatoire. Fais pareil pour chaque responsable du groupe.
Ensuite, dans l'appli, le bouton **Admin** te permet d'ajouter les adresses Gmail des étudiants.

## Étape 3. Mettre le projet sur GitHub

1. Crée un dépôt GitHub et envoie-y tout le contenu de ce dossier (branche `main`).
2. Dépôt > Settings > Secrets and variables > Actions > **New repository secret**
   - nom : `GOOGLE_SERVICES_JSON`
   - valeur : tout le contenu du fichier `google-services.json`
3. Onglet **Actions** > « Construire l'APK » > Run workflow (il se lance aussi à chaque envoi de code).
4. Au bout de quelques minutes, l'APK apparaît dans **Releases**.

## Étape 4. Partager avec la classe

Lien qui pointe toujours vers la dernière version :

    https://github.com/TON_COMPTE/TON_DEPOT/releases/latest/download/EnR-Connect.apk

Chaque étudiant ouvre le lien, télécharge l'APK et autorise l'installation depuis cette source.

## Tester sur ordinateur

    npm install
    npm run dev

## Notes

- La clé `keystore/debug.keystore` est volontairement dans le dépôt : elle garde la même empreinte SHA-1 à chaque build, sinon la connexion Google casserait à chaque version. Elle sert à une appli de classe, pas au Play Store.
- Les photos sont réduites (environ 900 px) et stockées dans Firestore pour rester gratuit, sans Firebase Storage. Les vidéos ne sont pas incluses dans cette première version.
- Les règles de sécurité vérifient côté serveur que seuls les membres de la liste lisent et écrivent.

## Notifications, bulle et réponse rapide (Android)

Sans serveur ni carte bancaire : un petit service natif (dossier `native/`, copié dans le projet Android par le workflow) vérifie les nouveaux messages toutes les 30 s, 1 min ou 5 min (réglable dans Infos du groupe). Quand un message arrive et que l'appli n'est pas affichée :

- une notification de conversation apparaît, avec un champ **Répondre** directement dedans ;
- sur Android 11 et plus, elle peut devenir une **bulle flottante** qui ouvre la discussion en petit ;
- le message part vers Firestore avec la session de l'utilisateur (aucune clé secrète dans l'appli).

À savoir : l'icône discrète du service reste dans la barre d'état ; Android peut retarder les vérifications quand le téléphone dort longtemps (économie de batterie) ; après un redémarrage du téléphone, il faut ouvrir l'appli une fois pour relancer le service ; si la bulle n'apparaît pas, activer « Bulles » pour EnR Connect dans les paramètres de notifications du téléphone.

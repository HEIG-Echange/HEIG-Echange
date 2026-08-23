# Bruno — collection API HEIG-Echange

Ce dossier contient la collection Bruno pour tester l'API manuellement, et une
suite de tests automatisee (`test-suite/`).

## Prerequis

- L'app Bruno installee ([usebruno.com/downloads](https://www.usebruno.com/downloads))

## 1. Faire une requete avec les requetes preconfigurees

1. Ouvrir Bruno → **Open Collection** → selectionner le dossier `bruno/` de ce repo.
2. En haut a droite, choisir l'environnement 
3. Dans la barre laterale, ouvrir un dossier (`auth`, `listings`, `reports`,
   `admin`, ...) et cliquer sur une requete.
4. Verifier/adapter les valeurs dans l'onglet **Vars**, ou directement dans le
   corps (`body:json`) si besoin — chaque requete a deja des valeurs par
   defaut raisonnables (`vars:pre-request`).
5. Cliquer sur **Send**.

Certaines requetes dependent du resultat d'une autre requete (variable
partagee, ex. `listingId`, `reportId`) via `script:post-response`. Dans ces
cas-la, lancer les requetes dans l'ordre du dossier (numero `seq`) :

- `listings/Create Listing` avant `listings/Get One Listing` ou
  `listings/Update Listing` (remplit `{{listingId}}`)
- `reports/Create Report` avant `admin/Review Report` (remplit `{{reportId}}`)

Les routes protegees cote API (`requireAuth`/`requireAdmin`) s'appuient sur le
cookie de session que Bruno conserve automatiquement apres un `auth/Login`
reussi — pas besoin de config d'auth supplementaire dans la requete. Pour les
routes `/admin/*`, il faut etre connecte avec un compte dont le `role` est
`admin` en base.

## 2. Lancer les suites de tests

Le dossier `test-suite/` contient des requetes numerotees avec des blocs
`tests { ... }` (assertions) — c'est une suite automatisee a lancer d'un coup,
pas des requetes a envoyer une par une.


1. Selectionner l'environnement 
2. Dans la barre laterale, survoler le dossier `test-suite` → cliquer sur
   l'icone **Run** (ou clic droit → "Run Folder").
3. Bruno execute les requetes dans l'ordre  et affiche le
   resultat de chaque `test()` (vert/rouge) avec le detail des assertions.



## Structure

- `auth/` — inscription, connexion, profil (`Me`, `Update Profile`,
  `Delete Account`), deconnexion
- `listings/` — creation, liste, detail, modification d'annonces
- `reports/` — signalement d'une annonce
- `admin/` — moderation : signalements, blocage/deblocage, historique,
  annonces (y compris supprimees), et reglages de l'analyse IA
  (`Get`/`Update AI Settings`)
- `test-suite/` — suite automatisee (inscription, login correct/incorrect,
  compte, logout, domaine refuse)
- `environments/Local.bru` — `baseUrl` pour l'API locale

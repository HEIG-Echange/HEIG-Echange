# HEIG-Échange — base de la présentation technique

Squelette pour le PowerPoint : **9 slides**, une idée par slide.
Chaque slide indique le visuel à insérer, les puces à afficher, et ce qu'il y a à dire.
Les puces sont volontairement courtes — ce qui est écrit ci-dessous sous « À dire » n'a pas à figurer sur la slide.

**Insérer un visuel dans PowerPoint :** Insertion → Images → Cet appareil → choisir le `.svg`.
Les SVG restent nets à n'importe quelle taille ; clic droit → *Convertir en forme* si on veut retoucher un bloc.
La page `apercu.html` (même dossier) affiche les cinq visuels d'un coup dans un navigateur.

| Visuel | Fichier |
|---|---|
| Architecture technique | `architecture.svg` |
| Fonctionnement du frontend | `frontend.svg` |
| Parcours utilisateur + API | `parcours-fonctionnel.svg` |
| Modèle de données | `modele-donnees.svg` |
| Pipeline CI/CD | `pipeline-ci-cd.svg` |

---

## Slide 1 — HEIG-Échange

**Visuel :** capture de l'accueil de l'app (mobile + desktop côte à côte), ou le logo.

- Plateforme de don d'objets entre étudiants de la HEIG-VD
- Application web, pensée pour le téléphone d'abord
- Réservée aux adresses `@heig-vd.ch` et `@hes-so.ch`

> **À dire :** une phrase pour situer : « Des objets encore utilisables dorment dans les chambres, et il n'existe aucun endroit pour les donner. On en a fait une application. »

---

## Slide 2 — Le problème, puis la solution

**Visuel :** aucun (ou une photo de l'étagère à dons de l'école).

- Aujourd'hui : groupes WhatsApp, affiches, mails jamais lus
- Portée limitée à un petit cercle, aucune recherche possible
- Notre réponse : un seul endroit, cherchable, réservé à l'école
- Publier une annonce doit prendre moins d'une minute

> **À dire :** poser le contraste avant/après. L'étagère physique de l'école résout le même besoin, mais on ne peut ni chercher dedans, ni savoir ce qu'elle contient sans s'y rendre.

---

## Slide 3 — Architecture

**Visuel :** `architecture.svg`

- **Front** : pages HTML statiques servies par l'app — pas de framework
- **Back** : Node 22 / Express 5 en TypeScript, 49 endpoints REST
- **Données** : MariaDB 11.4, 13 tables
- **Le tout en conteneurs**, décrits dans un seul fichier Compose
- Deux services externes seulement : envoi d'email et analyse IA des photos

> **À dire :** insister sur la simplicité assumée. Un conteneur applicatif, un conteneur base de données, deux volumes. On peut relancer toute la plateforme sur une machine neuve avec une commande.

---

## Slide 4 — Le frontend

**Visuel :** `frontend.svg`

- Une page = un fichier HTML + un module JS ; les briques communes sont partagées
- Pas de bundler, pas d'étape de build côté client : le navigateur charge les modules
- Trois paliers responsive — mobile, tablette, desktop — avec **le même HTML**
- Le client ne détient aucun secret : il n'a qu'un cookie de session

> **À dire :** expliquer le choix. Sur un projet de quatre semaines, un framework coûtait plus de temps qu'il n'en faisait gagner. Le point non négociable était l'usage mobile : c'est là que la CSS fait tout le travail.

---

## Slide 5 — Le parcours et ce qui tourne derrière

**Visuel :** `parcours-fonctionnel.svg`

- Donner : photo → l'IA propose catégorie, état et description → l'utilisateur valide → publication
- Trouver : recherche plein texte, fiche détail, « je suis intéressé », contact Teams ou mail
- Option **avant-première** : une annonce visible d'abord par ses cercles d'amis
- Confiance : email de l'école, code de confirmation, signalement, modération tracée

> **À dire :** l'IA propose, elle ne publie jamais. Sans clé d'API, l'application fonctionne exactement pareil — la pré-saisie disparaît, c'est tout.

---

## Slide 6 — Le modèle de données

**Visuel :** `modele-donnees.svg`

- 13 tables, clés étrangères déclarées partout — pas de données orphelines
- Les règles vivent dans la base : domaine d'email, catégories, états d'un objet
- Recherche assurée par un index FULLTEXT, pas par un filtrage en mémoire
- Rien n'est effacé : suppression douce + historique de modération

> **À dire :** exemple concret de la fenêtre d'avant-première : elle se lit dans la requête (`is_priority` ET date de fin dépassée), donc aucune tâche de fond n'a besoin de la refermer.

---

## Slide 7 — Qualité et sécurité

**Visuel :** aucun, ou une capture d'un run vert de la CI.

- ~90 tests Vitest (unitaires + intégration HTTP) et 57 requêtes Bruno rejouées en CI
- Mots de passe hachés (bcrypt), sessions en cookie `httpOnly`
- Chaque appel sensible revalide le compte en base : bloqué ? email expiré ?
- Uploads bornés : type, taille, nombre — contrôlés côté client **et** côté serveur
- Aucun secret dans le dépôt : scan automatique à chaque pull request

> **À dire :** la session seule ne donne pas l'accès. Un compte bloqué pendant qu'une session est ouverte perd la main au prochain appel — c'est vérifié à chaque requête, pas seulement à la connexion.

---

## Slide 8 — Du commit à la machine

**Visuel :** `pipeline-ci-cd.svg`

- Chaque pull request : lint, tests, build, image Docker, suite d'API, scan de secrets
- Déploiement par SSH — aucune commande tapée à la main sur le serveur
- Cinq environnements : trois bacs à sable, staging, production
- Sauvegarde de la base **avant** chaque déploiement, contrôle de santé après

> **À dire :** c'est la partie qu'on peut montrer en direct. Un démarrage cassé fait échouer le pipeline au lieu de passer inaperçu — le déploiement n'est « vert » que si l'application répond vraiment.

---

## Slide 9 — Où on en est, et ce qui manque

**Visuel :** aucun.

- Fait : parcours complet (publier, chercher, demander, clore), modération, notifications, CI/CD
- Assumé : messagerie interne prévue en base mais le MVP passe par Teams
- Manque : retour arrière automatique au déploiement, tests d'interface, landing page publiée par le pipeline
- Suite : durcir la mise en production et ouvrir à une première promo

> **À dire :** terminer sur ce qu'on referait autrement plutôt que sur une liste de fonctionnalités — c'est ce qui montre qu'on a compris nos propres choix.

---

## Chiffres à avoir en tête (si on pose la question)

| | |
|---|---|
| Endpoints REST | 49 (+ `/health` et `/config`) |
| Tables | 13 |
| Pages de l'application | 12 |
| Tests automatisés | ~90 Vitest + 57 requêtes Bruno |
| Environnements déployables | 5 |
| Dépendances de production | 6 (Express, session, mysql2, multer, bcryptjs, qrcode) |

## Questions probables du jury

- **Pourquoi pas de framework frontend ?** Quatre semaines, une équipe de quatre, une app à douze écrans : le coût d'apprentissage et de build dépassait le gain. Les briques communes sont factorisées à la main dans deux modules.
- **Pourquoi pas le SSO Microsoft ?** C'était l'intention de départ ; l'inscription par email de l'école avec code de confirmation donne la même garantie de périmètre sans dépendre d'une configuration Azure qu'on ne maîtrise pas. Le SSO reste la suite logique.
- **Et si le service d'IA tombe ?** L'app continue : la pré-saisie renvoie une erreur propre et le formulaire se remplit à la main.
- **Comment revenir en arrière après un mauvais déploiement ?** Relancer le workflow depuis un commit antérieur, et restaurer le dump pris juste avant. C'est manuel — c'est la première chose à automatiser.

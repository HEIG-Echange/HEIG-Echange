# Description du projet

## 1. Problématique

Les étudiants ont peu d'argent, et pourtant plein d'objets dorment dans les armoires. 
Des livres de cours déjà lus, du matériel d'anciens semestres, des meubles laissés en fin de bail. 
Des objets qui pourraient servir à d'autres finissent à la cave ou à la poubelle, 
pendant que d'autres étudiants les rachètent neufs.

Aujourd'hui, donner un objet passe par des groupes WhatsApp, 
des affiches dans les couloirs et des mails jamais lus. 
Il n'existe aucun endroit centralisé pour voir ce qui est disponible sur le campus.

Ça fonctionne mal pour trois raisons. On ne sait pas qui donne quoi sur le campus. 
Une annonce ne touche que son petit cercle, le groupe de classe ou les amis proches. 
Et organiser la remise en main propre se perd dans des messages éparpillés.

## 2. Solution

HEIG·Échange est la plateforme de don entre étudiants de la HEIG-VD.

Chaque étudiant peut mettre à disposition des objets gratuitement et parcourir les annonces des autres. 
Le contact et la prise de rendez-vous se font via l'écosystème Microsoft de l'école, 
que tous les étudiants ont déjà. Une fois l'objet donné, l'annonceur ferme le poste.

## 3. Mécanisme d'échange

### La question ouverte

Deux points étaient à trancher en équipe.

Qu'est-ce qu'on échange, des objets seulement ou aussi des services et du tutorat ?

Et comment compter les échanges ? Quatre options ont été discutées.

1. Une monnaie virtuelle, des crédits internes au campus qu'on gagne en aidant ou en donnant et qu'on dépense pour recevoir
2. Une banque de temps, 1 heure rendue = 1 heure à recevoir
3. Un système de dettes, un compteur "je te dois / tu me dois" entre étudiants
4. Le don, sans aucune contrepartie

### Ce qui a été tranché (à valider par Jeffrey et Sofia)

On part sur le don d'objets. On met à disposition un objet, un autre étudiant le récupère, 
et l'annonceur ferme ou supprime le poste.

Les services et le tutorat ne sont pas dans le périmètre pour l'instant. 
Si on les ajoute plus tard, l'idée retenue est simple. On indique le prix directement 
dans la description de l'annonce, pas besoin d'un système de comptage.

### Équilibre du don (à valider par l'équipe)

> Proposition faite après le meeting, pas encore validée par l'équipe. 
> Le don a été tranché au meeting, ce mécanisme est une suggestion qui vient s'ajouter par-dessus. 
> À discuter tous ensemble avant de l'intégrer ou non au MVP.

Le risque du pur don (feedback Rostand), c'est que ce soient toujours les mêmes qui prennent tout, 
les plus rapides ou les plus gourmands, et que ceux qui donnent sans jamais rien recevoir se lassent.

L'idée est un mécanisme léger.

- Quand plusieurs personnes demandent le même objet, le donneur voit un indicateur simple 
  sur chaque demandeur, le nombre d'objets reçus récemment
- La priorité est suggérée à ceux qui n'ont rien ou peu reçu, mais le donneur reste libre de choisir

Attention, ce mécanisme a un impact sur le MVP. Si tout le contact passe par Teams en dehors de l'app, 
on ne sait jamais qui demande ni qui reçoit les objets, donc impossible de compter quoi que ce soit. 
Pour que ça marche il faut que la demande se fasse dans l'app (bouton "Demander cet objet") 
et qu'à la fermeture du poste le donneur indique qui a reçu l'objet. 

## 4. Requirements fonctionnels

### MVP

- Connexion avec le compte Microsoft de l'école
- Accueil avec une grille d'annonces (photo, catégorie, état, propriétaire, localisation), 
  une recherche en temps réel et des filtres par catégorie (Électronique, Livres & Cours, Mobilier, etc.)
- Publier, modifier et supprimer une annonce avec titre, description, photos, catégorie, état et lieu de récupération
- Fiche détail d'un objet avec carrousel de photos, description complète et profil du donneur
- Bouton "Demander cet objet" dans l'app, pour que les demandes soient tracées 
  (lié à la proposition d'équilibre du don, section 3, à confirmer avec l'équipe)
- Bouton "Contacter via Teams" qui ouvre un chat avec le donneur
- Formulaire pour proposer un rendez-vous de récupération (date, heure, lieu, message)
- Une fois l'objet donné, l'annonceur ferme ou supprime le poste. 
  Indiquer qui a reçu l'objet à la fermeture est lié à la proposition d'équilibre du don (section 3)
- Profil avec avatar, email, filière, ses annonces et un bouton "Mettre à disposition"
- Un utilisateur peut supprimer son compte et ses données
- Système de rôles avec permissions. Un utilisateur normal gère ses propres annonces et demandes. 
  Un admin peut en plus supprimer n'importe quelle annonce (contenu inapproprié) 
  et bloquer un utilisateur qui abuse. Potentiellement rôle modérateur aussi.
- Amis prioritaires, des groupes créés librement (nom + couleur) avec gestion des membres. 
  À la publication, l'option "Prioritaires d'abord" réserve l'annonce 48h aux amis 
  avant de l'ouvrir à toute la communauté (badge "Prioritaires" sur la carte)

### Itérations futures

- Extension aux services et au tutorat, avec le prix indiqué directement 
  dans la description de l'annonce (voir section 3)
- Notation des échanges et score de fiabilité (possible seulement si les demandes 
  et réceptions sont tracées dans l'app, voir la proposition d'équilibre du don)
- Notifications Teams automatiques (bot) quand une demande arrive ou qu'une annonce 
  correspond à une recherche. Attention, ça passe par l'API Microsoft Graph, 
  il faut enregistrer l'app dans le tenant Microsoft de l'école et avoir l'accord de l'IT
- Rappels via le calendrier Outlook pour les rendez-vous de récupération (même prérequis que le bot)
- Fiche d'entraide pour le CV, un récapitulatif exportable des heures de tutorat 
  et des étudiants aidés (seulement si l'extension au tutorat se fait)

### Pistes écartées

- Le QR code (proposé par les profs) n'est pas nécessaire avec le don
- L'armoire connectée (casier avec accès QR) est hors scope, personne dans l'équipe ne fait d'embarqué

## 5. Mockups et landing page

Mockup Figma réalisé par Vincent.

Landing page réalisé par ?. 

La landing page (site vitrine du projet) sera hébergée sur GitHub Pages 
et déployée automatiquement par le pipeline.

## 6. Requirements non-fonctionnels

- Mobile-first, les étudiants utilisent surtout leur téléphone
- Aucune donnée accessible sans être connecté, l'accès est réservé aux étudiants de l'école 
  et les actions sont limitées par le rôle de chacun (user ou admin)
- Les données des échanges doivent rester cohérentes (pas d'échange perdu ou compté deux fois)
- Protection des données personnelles, on ne stocke que le minimum (nom, email, filière, annonces)
- L'application doit rester réactive sur mobile, y compris avec des photos dans les annonces 
  (images compressées, chargement progressif)
- Tout l'hébergement doit être gratuit (contrainte de budget du projet)

## 7. Décisions ouvertes

- Don d'objets (section 3), tranché au meeting, reste à valider par Jeffrey et Sofia
- Proposition d'équilibre du don (section 3), à discuter tous ensemble
- Hébergement de l'app. Le pipeline CI/CD reste sur GitHub Actions (décision DevOps), 
  l'hébergement doit être complètement gratuit, reste à choisir où (Render, Azure gratuit, autre)
- Login Microsoft, vérifier qu'on peut enregistrer 
  notre application dans le tenant Microsoft (nécessaire pour le login du MVP, 
  et plus tard pour le bot Teams). Risque technique.
- Périmètre exact du MVP, à confirmer une fois les points ci-dessus tranchés

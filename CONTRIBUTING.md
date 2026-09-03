# Contribuer à HEIG-Echange

Merci de vouloir contribuer à HEIG-Echange. Ce projet vise à créer une plateforme d’échange au sein d'une entreprise ou association.

## Prérequis
- Git
- Docker et Docker Compose

## Installation locale
Suivre le fichier `INSTALL.md` or [here](INSTALL.md) à la racine du dépôt.

## Développement
- Créer une branche dédiée
- Faire des commits clairs et atomiques
- Garder les changements liés à un seul sujet par PR

## Tests et vérifications
Avant d’ouvrir une PR, vérifier au minimum :
- que l’application démarre correctement
- que les tests passent


## Pull requests
Merci de :
- décrire clairement le problème résolu
- lier l’issue concernée si elle existe
- ajouter des captures d’écran si l’UI change
- demander une revue avant fusion

## CI/CD et validations

Le merge dans main et Staging n’est possible qu’après validation d’au moins une review et passage de tous les checks obligatoires.  
Une pull request ne peut être mergée que si les vérifications automatiques du pipeline CI sont réussies.  
Si un check échoue, corriger le problème puis relancer la validation avant de demander une revue.  
Les vérifications automatiques du dépôt font partie du processus de validation. Toute contribution doit les respecter avant merge.

## Style de code
- Respecter le style existant du projet
- Garder un code lisible
- Préférer des noms explicites

## Sécurité
Ne jamais pousser de `.env`, de clés API ou d’identifiants.



## Mails

Pour l'envoi des mails, créer un compte sur https://mailer.echange.online/ pour créer une clef d'API pour l envoi des mails. Besoin d un compte SMTP.

Voir les images sous `docs/images/mailer/` pour la création d une clef d'API pour la variable d environnement  `MAILER_API_KEY`.


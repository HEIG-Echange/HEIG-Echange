# Pipeline DevOps

Brouillon, à compléter.

## L'idée générale

Le code vit sur GitHub. La branche main est protégée, on travaille sur des branches, 
on ouvre une pull request, il faut une review et que les tests passent pour merger.

Quand une PR est ouverte, la CI (GitHub Actions) vérifie le code. Lint, tests, build. 
Si c'est rouge, pas de merge.

Quand on merge sur main, la CD construit l'image Docker, la publie sur le registry GitHub 
(ghcr.io) et déclenche le redéploiement. Une modification mergée est en ligne 
quelques minutes plus tard.

## Environnements

On garde ça simple vu la taille réduite de l'équipe.

- Dev en local, avec docker-compose, le même conteneur qu'en prod
- La CI sert de barrière de qualité, rien ne merge si c'est rouge
- Un seul environnement de production, hébergement gratuit (reste à voir où)

Pas de staging séparé. Comme l'app tourne dans le même conteneur Docker en local et en prod, 
l'écart entre les deux est déjà minimal.

## Landing page

La landing page est sur GitHub Pages, déployée automatiquement par un workflow 
quand on modifie son dossier.



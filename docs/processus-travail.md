# Processus de travail

Brouillon

## Git flow

- main est protégée et toujours déployable (règle crée mais disabled jusqu'au livrable)
- une branche par feature, créée depuis main (par exemple feature/login-microsoft)
- on push, on ouvre une pull request vers main
- il faut une review d'un autre membre et la CI verte pour merger
- au merge, le déploiement se fait automatiquement

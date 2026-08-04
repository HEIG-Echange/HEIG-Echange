# Base de données

La plateforme utilise **MariaDB 11.4** (LTS), administrée via **phpMyAdmin**.
Tout tourne dans Docker : aucun serveur SQL n'est installé sur l'hôte.

- Schéma : [`db/init/01-schema.sql`](../db/init/01-schema.sql)
- Données de référence : [`db/init/02-seed.sql`](../db/init/02-seed.sql)
- Services : `db` et `phpmyadmin` dans [`compose.yaml`](../compose.yaml)

## Architecture

```
┌──────────┐        ┌──────────┐        ┌─────────────┐
│   app    │──────▶ │    db    │ ◀───── │ phpmyadmin  │
│ (Node)   │  3306  │ MariaDB  │  3306  │  (profil    │
└──────────┘        └────┬─────┘        │   tools)    │
                         │              └─────────────┘
                    volume db-data        127.0.0.1 only
```

- Le port **3306 n'est pas publié** sur l'hôte : la base n'est joignable que par
  les conteneurs du réseau Compose.
- Les données vivent dans le **volume nommé `db-data`** : elles survivent aux
  `docker compose down` / `up` et aux redéploiements. `db/init` n'est exécuté
  qu'au **premier** démarrage (volume vide).
- **phpMyAdmin** est sous le profil `tools` : il ne démarre pas avec un
  `docker compose up` normal et n'est publié que sur `127.0.0.1`.

## Schéma — couverture des exigences

| Table | Exigences couvertes |
|---|---|
| `users` | 0 (email `@hes-so.ch` / `@heig-vd.ch`), 7 (profil, avatar), 8 (`deleted_at`), 9 (`role`, `is_blocked`) |
| `categories` | 2 (filtres) |
| `listings` | 1 (grille), 2 (recherche FULLTEXT + catégorie), 3 (CRUD), 6 (`status`/`closed_at`) |
| `listing_photos` | 1 (vignette), 4 (carrousel, `position`) |
| `messages` | 5 (contact donneur ↔ intéressé) |
| `reports` | 9 (signalement de contenu) |
| `moderation_logs` | 9 (historique des actions admin) |

> L'authentification passe par l'écosystème Microsoft de l'école : **aucun mot
> de passe utilisateur n'est stocké**. Le domaine de l'email est vérifié par un
> `CHECK` en base *et* par la validation applicative (référence).

## Accès administrateur (phpMyAdmin)

### En local (développement)

```bash
docker compose -f compose.yaml -f compose.dev.yaml --profile tools up -d
```

Puis ouvrir <http://localhost:8082> (identifiants : `MARIADB_USER` /
`MARIADB_PASSWORD`, ou `root` / `MARIADB_ROOT_PASSWORD`).

### En distant (staging / production)

phpMyAdmin n'est **jamais exposé** sur Internet (publié sur `127.0.0.1`
seulement). L'admin ouvre un **tunnel SSH** depuis son poste :

```bash
# Démarrer phpMyAdmin sur la machine (une fois)
ssh deploy@serveur 'cd /home/heigdeploy/heig/prod-pdg && docker compose --profile tools up -d phpmyadmin'

# Tunnel : le port distant 8083 devient http://localhost:8083 en local
ssh -L 8083:127.0.0.1:8083 deploy@serveur
```

Depuis phpMyAdmin : **Exporter** (dump SQL téléchargeable) et **Importer**
(rejouer un dump) en quelques clics — c'est la voie graphique demandée.

## Export / import en ligne de commande

Plus adapté aux sauvegardes automatisées ou avant une manipulation risquée.

```bash
# Export -> backups/heig_echange-<horodatage>.sql.gz
./scripts/db-backup.sh

# Import (ÉCRASE la base ; demande confirmation)
./scripts/db-restore.sh backups/heig_echange-20260802-101500Z.sql.gz
```

Les scripts lancent `mariadb-dump` / `mariadb` **dans le conteneur `db`** : aucun
client SQL à installer sur l'hôte. Le mot de passe est lu depuis `.env`, jamais
passé en argument. Une sauvegarde `pre-deploy-*.sql.gz` est aussi créée
automatiquement à chaque déploiement.

## Faire évoluer le schéma

`db/init/*.sql` **ne rejoue pas** sur une base existante. Pour une base déjà
peuplée (staging/prod), écrire une **migration versionnée** et l'appliquer :

```bash
./scripts/db-backup.sh                              # filet de sécurité d'abord
docker compose exec -T -e MYSQL_PWD="$MARIADB_PASSWORD" \
  db mariadb -u "$MARIADB_USER" "$MARIADB_DATABASE" < db/migrations/00X-xxx.sql
```

En développement, on peut simplement repartir de zéro :

```bash
docker compose down -v   # ATTENTION : -v supprime le volume db-data
docker compose up --build
```


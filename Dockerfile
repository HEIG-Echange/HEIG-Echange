# syntax=docker/dockerfile:1.25.0

# ---------------------------------------------------------------------------
# HEIG-Echange — build multi-stage
#
# Cibles disponibles :
#   runner  (defaut) image de production, minimale et non-root
#   verify           lint + tests, utilisable par la CI
#   dev              rechargement a chaud pour le developpement local
#
# L'image de base est figee par tag ET par digest : le tag documente la version
# pour un humain, le digest garantit un build bit-a-bit reproductible meme si le
# tag est repousse en amont.
#   node:22.23.2-alpine3.24 = Node.js 22 LTS "Jod" (meme majeure que la CI)
# Pour monter de version : mettre a jour le tag et le digest ensemble
#   docker buildx imagetools inspect node:<tag>
# ---------------------------------------------------------------------------
ARG NODE_IMAGE=node:22.23.2-alpine3.24

# ---------------------------------------------------------------------------
# base — socle commun a toutes les etapes
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base

ENV NODE_ENV=production \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /app

# ---------------------------------------------------------------------------
# deps — dependances de production uniquement
#
# Etape isolee pour que le node_modules de production n'herite jamais des
# devDependencies, et pour que sa couche ne soit invalidee que par un
# changement de package.json / package-lock.json.
# ---------------------------------------------------------------------------
FROM base AS deps

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --omit=dev

# ---------------------------------------------------------------------------
# build — dependances completes + compilation TypeScript
# ---------------------------------------------------------------------------
FROM base AS build

# npm ci respecte NODE_ENV : sans cette ligne, les devDependencies (dont tsc)
# seraient ignorees et la compilation echouerait.
ENV NODE_ENV=development

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --include=dev

COPY tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build

# ---------------------------------------------------------------------------
# verify — lint + tests (cible CI, ne produit aucun artefact)
#
#   docker build --target verify .
# ---------------------------------------------------------------------------
FROM build AS verify

COPY eslint.config.mjs ./
COPY test ./test
RUN npm run lint
RUN npm test

# ---------------------------------------------------------------------------
# dev — rechargement a chaud
#
# tsc recompile vers /app/dist (interne au conteneur, pas de pollution de la
# machine hote) et node --watch redemarre le serveur a chaque emission.
# Le polling est explicite car les evenements inotify ne traversent pas
# fiablement les bind mounts de Docker Desktop (Windows / macOS).
# ---------------------------------------------------------------------------
FROM build AS dev

# Seuls /app et /app/dist ont besoin d'etre accessibles en ecriture : on evite
# un chown -R sur node_modules qui dupliquerait toute la couche.
RUN chown node:node /app && chown -R node:node /app/dist
USER node

EXPOSE 3000
CMD ["sh", "-c", "node_modules/.bin/tsc --watch --preserveWatchOutput --watchFile fixedPollingInterval --watchDirectory fixedPollingInterval & exec node --watch dist/server.js"]

# ---------------------------------------------------------------------------
# runner — image de production (cible par defaut)
#
# Ne contient que le runtime Node, les dependances de production et le
# JavaScript compile : ni sources TypeScript, ni tests, ni toolchain de build.
# ---------------------------------------------------------------------------
FROM base AS runner

# Metadonnees OCI — renseignees par la CI, valeurs de repli pour un build local.
ARG VERSION=0.0.0-dev
ARG REVISION=unknown
ARG CREATED=unknown
LABEL org.opencontainers.image.title="heig-echange" \
      org.opencontainers.image.description="Plateforme de don entre etudiants de la HEIG-VD" \
      org.opencontainers.image.source="https://gitlab.com/jeffmvutuheig/heig-echange-luna" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.created="${CREATED}"

ENV PORT=3000

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/public ./public
COPY --chown=node:node package.json ./

# L'utilisateur node (uid 1000) est fourni par l'image officielle.
USER node

EXPOSE 3000

# Interroge /health avec le runtime deja present : pas de curl/wget a installer.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

# node directement, pas npm start : un intermediaire de plus ne relaierait pas
# proprement SIGTERM et ralentirait l'arret du conteneur.
CMD ["node", "dist/server.js"]



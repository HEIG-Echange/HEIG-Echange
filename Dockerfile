# syntax=docker/dockerfile:1

############################
# Base
############################
FROM node:22-alpine AS base

WORKDIR /app

# Utilisateur non-root pour la sécurité
RUN addgroup -S nodejs && adduser -S nodejs -G nodejs

############################
# Dependencies
############################
FROM base AS dependencies

COPY package*.json ./

# Installation reproductible
RUN npm ci

############################
# Development
############################
FROM dependencies AS development

COPY . .

USER nodejs

EXPOSE 3000

CMD ["npm", "run", "dev"]

############################
# Build
############################
FROM dependencies AS build

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

############################
# Production dependencies
############################
FROM base AS production-dependencies

COPY package*.json ./

RUN npm ci --omit=dev

############################
# Production
############################
FROM base AS production

ENV NODE_ENV=production

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json ./

RUN chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3000

CMD ["node", "dist/server.js"]
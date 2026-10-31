# syntax=docker/dockerfile:1
# Production web image: builds the React app, then serves it with Caddy.
# Caddy also forwards /api/* to the FastAPI container and gets HTTPS certificates automatically.
# The Caddyfile is mounted from deploy/Caddyfile by docker-compose.prod.yml.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/dist /srv

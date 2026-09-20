# syntax=docker/dockerfile:1

# --- dependencies: install once, reuse in build + dev -------------------------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- build: production bundle, build-time flags baked in --------------------
FROM deps AS build
COPY . .
ARG BACKEND_URL=""
ENV VITE_BACKEND_URL=${BACKEND_URL}
ARG DISABLE_REGISTRATION="0"
ENV VITE_DISABLE_REGISTRATION=${DISABLE_REGISTRATION}
RUN npm run build

# --- dev: Vite dev server with HMR (used by the compose dev override) ---------
# BACKEND_URL / DISABLE_REGISTRATION are runtime values here; the compose
# override injects them as VITE_* envs so edits do not require a rebuild.
FROM deps AS dev
ARG BACKEND_URL=""
ENV VITE_BACKEND_URL=${BACKEND_URL}
ARG DISABLE_REGISTRATION="0"
ENV VITE_DISABLE_REGISTRATION=${DISABLE_REGISTRATION}
COPY . .
# Runtime hardening: the dev server runs as the unprivileged `node` user (uid
# 1000 — the same uid as the host user, so the bind-mounted `./frontend` stays
# fully owned). The chown covers the `node_modules` named volume, which is
# initialized from this image in the compose dev override.
RUN chown -R node:node /app
USER node
EXPOSE 80
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "80"]

# --- serve: static nginx, single worker, minimal footprint --------------------
FROM nginx:1.27-alpine AS serve
COPY nginx.conf /etc/nginx/nginx.conf
RUN rm -f /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
# Runtime hardening: the master and worker run as the `nginx` user. The chown
# keeps the html readable (the worklog `AI-WORKLOG.md` is bind-mounted on top
# in deployments); nginx.conf already points pid/temp paths to /tmp.
RUN chown -R nginx:nginx /usr/share/nginx/html
USER nginx
EXPOSE 80

# syntax=docker/dockerfile:1

# --- dependencies: install once, reuse in build + dev -------------------------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- build: production bundle, backend origin baked in ------------------------
FROM deps AS build
COPY . .
ARG BACKEND_URL=""
ENV VITE_BACKEND_URL=${BACKEND_URL}
RUN npm run build

# --- dev: Vite dev server with HMR (used by the compose dev override) ---------
# BACKEND_URL is a runtime value here; the compose override injects it as
# VITE_BACKEND_URL so edits do not require a rebuild.
FROM deps AS dev
ARG BACKEND_URL=""
ENV VITE_BACKEND_URL=${BACKEND_URL}
COPY . .
EXPOSE 80
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "80"]

# --- serve: static nginx, single worker, minimal footprint --------------------
FROM nginx:1.27-alpine AS serve
COPY nginx.conf /etc/nginx/nginx.conf
RUN rm -f /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

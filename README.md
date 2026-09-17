# Portals

## Environment variables

`POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` are shared between the `postgres` and `backend` services and are interpolated from the project `.env` file (see `.env.example`). `POSTGRES_PASSWORD` must be non-empty; otherwise `docker compose` refuses to start.

`POSTGRES_HOST` and `POSTGRES_PORT` are set by `docker-compose.yml` for the backend service only.

| Name               | Description                                                                     | Default                            | Required |
| ------------------ | ------------------------------------------------------------------------------- | ---------------------------------- | -------- |
| `POSTGRES_USER`    | PostgreSQL user, used by both `postgres` and `backend`                          | `postgres`                         | No       |
| `POSTGRES_PASSWORD`| PostgreSQL password, used by both `postgres` and `backend`                      | —                                  | Yes      |
| `POSTGRES_DB`      | PostgreSQL database name, used by both `postgres` and `backend`                 | `postgres`                         | No       |
| `POSTGRES_HOST`    | Backend-only: hostname of the `postgres` service                                | `postgres` (set in `docker-compose.yml`) | No  |
| `POSTGRES_PORT`    | Backend-only: port the `postgres` service listens on                            | `5432` (set in `docker-compose.yml`)     | No  |
| `BACKEND_PORT`     | Host port the `backend` container is published on, mapped to the container port `8000` | `8000`                              | No   |

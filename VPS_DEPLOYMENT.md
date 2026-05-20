# VPS Deployment Guide

This deployment uses Docker Compose with:

- MongoDB in a container
- MinIO as the S3-compatible object store
- FastAPI backend
- React frontend served by Nginx
- Public Nginx reverse proxy for `rpsignage.com` and `rpsignage.in`

## 1) Prerequisites

Install on the VPS:

- Docker Engine
- Docker Compose v2
- Git
- Port `80` and `443` open
- DNS A records for both domains pointing to the VPS

## 2) Clone the project

```bash
git clone <your-repo-url>
cd SignageOS1-main
```

## 3) Configure Docker environment

Copy the example env file:

```bash
cp backend/.env.docker.example backend/.env.docker
```

Edit `backend/.env.docker` and set at least:

```env
JWT_SECRET=<strong-random-secret>
ADMIN_PASSWORD=<strong-admin-password>
MINIO_ROOT_PASSWORD=<strong-minio-password>
LETSENCRYPT_EMAIL=admin@rpsignage.com
```

The example file already points the stack to:

- `mongodb://mongodb:27017`
- `http://minio:9000`
- `https://rpsignage.com,https://rpsignage.in`

## 4) Start the stack

Run the single deployment script:

```bash
chmod +x deploy.sh
./deploy.sh
```

What the script does:

1. Generates a temporary self-signed certificate if one does not exist yet.
2. Builds the backend, frontend, and Nginx images.
3. Starts MongoDB, MinIO, backend, frontend, and public Nginx.
4. Requests a real Let's Encrypt certificate for both domains.
5. Restarts Nginx after certificates are issued.

## 5) Service layout

- `mongodb` stores application data.
- `minio` stores uploaded media.
- `backend` serves `/api/*` and streams media from MinIO.
- `frontend` serves the React SPA.
- `nginx` terminates TLS and routes both domains to the same app.

## 6) Public URLs

- `https://rpsignage.com`
- `https://rpsignage.in`

Both domains serve the same application.

## 7) Notes

- Uploaded media is stored in MinIO and served through `/api/media/serve/{id}`.
- MongoDB and MinIO data persist in Docker volumes.
- If you change the primary public domain, update `PUBLIC_APP_URL` in `backend/.env.docker`.
- MinIO console is kept internal by default. If you want it public, add a separate protected host later.

## 8) Backups

Create a backup with:

```bash
chmod +x scripts/backup.sh
./scripts/backup.sh
```

This saves:

- A MongoDB dump as `mongodump` archive
- The MinIO data volume as a compressed tarball
- A snapshot of `backend/.env.docker` for reference

Restore is intentionally manual so you can verify where the data is going before overwriting production volumes.

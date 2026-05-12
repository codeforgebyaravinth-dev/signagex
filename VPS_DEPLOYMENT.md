# VPS Deployment Guide

This project has two parts:

- Backend: FastAPI + MongoDB Atlas + Supabase S3
- Frontend: React (CRACO)

## 1) Prerequisites

Install on the VPS:

- Python 3.13+
- Node.js 18+
- Yarn 1.x or npm
- Nginx
- Git

## 2) Clone the project

```bash
git clone <your-repo-url>
cd SignageOS1-main
```

## 3) Configure backend environment

Create `backend/.env` with your production values:

```env
MONGO_URL=<your-mongodb-atlas-connection-string>
DB_NAME=signage
JWT_SECRET=<strong-random-secret>
ADMIN_EMAIL=admin@demo.com
ADMIN_PASSWORD=admin123
FRONTEND_URL=https://your-domain.com
AWS_ACCESS_KEY_ID=<your-s3-access-key-id>
AWS_SECRET_ACCESS_KEY=<your-s3-secret-access-key>
AWS_REGION=ap-southeast-2
S3_ENDPOINT_URL=https://xztrjsqymgyltfivpgdj.storage.supabase.co/storage/v1/s3
SUPABASE_URL=https://xztrjsqymgyltfivpgdj.supabase.co
S3_BUCKET=storage
```

Notes:

- The database is MongoDB Atlas.
- The media storage bucket is `storage`.
- The backend uploads media files directly to Supabase Storage using the S3 protocol.

## 4) Install backend dependencies

```bash
cd backend
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

## 5) Run the backend

Development mode:

```bash
python -m uvicorn backend.server:app --host 0.0.0.0 --port 8000
```

For production, run it behind a process manager such as systemd or supervisor.

### Example systemd service

Create `/etc/systemd/system/signage-backend.service`:

```ini
[Unit]
Description=SignageOS Backend
After=network.target

[Service]
WorkingDirectory=/opt/SignageOS1-main
EnvironmentFile=/opt/SignageOS1-main/backend/.env
ExecStart=/usr/bin/python3 -m uvicorn backend.server:app --host 0.0.0.0 --port 8000
Restart=always
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

Then enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable signage-backend
sudo systemctl start signage-backend
```

## 6) Install frontend dependencies

```bash
cd ../frontend
yarn install
```

## 7) Build the frontend for production

Set the backend URL before building:

```bash
export REACT_APP_BACKEND_URL=https://api.your-domain.com
yarn build
```

The production bundle will be generated in `frontend/build`.

## 8) Serve the frontend with Nginx

Example Nginx config:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    root /opt/SignageOS1-main/frontend/build;
    index index.html;

    location / {
        try_files $uri /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Then reload Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 9) Login accounts

Use these defaults if they are seeded in your database:

- Admin: `admin@demo.com` / `admin123`
- Dealer: `dealer@demo.com` / `dealer123`

## 10) Important deployment notes

- Make sure your MongoDB Atlas IP allowlist includes the VPS IP.
- Make sure the S3 bucket name is exactly `bucket` unless you change `S3_BUCKET`.
- If uploads fail, verify the AWS credentials can write to that bucket.
- Set HTTPS in production so cookies and auth work correctly.

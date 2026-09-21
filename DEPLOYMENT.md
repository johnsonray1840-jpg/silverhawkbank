# Silverhawk Digital Banking Platform — Production Deployment Manual

## 1. System Requirements

- **Node.js**: `v20.x LTS` or higher
- **Database**: `MySQL 8.0+` with InnoDB Storage Engine (`utf8mb4` character set)
- **Caching & Queues**: `Redis 7.x+`
- **Reverse Proxy**: `Nginx 1.24+` / Cloudflare
- **Process Manager**: `Docker Compose` or `PM2`

---

## 2. Docker Quickstart (Recommended)

To deploy the entire platform stack (MySQL 8.0, Redis 7, and NestJS API Gateway) with automatic health checking:

```bash
cd backend

# Build and start all services in detached mode
docker compose up -d --build

# Run database schema migrations
docker compose exec api npx prisma db push

# Populate database with initial seed data (Chart of Accounts, Roles, Currencies, Admin Account)
docker compose exec api npm run prisma:seed
```

---

## 3. Manual Bare-Metal / VPS Deployment

### Step A: Install Dependencies
```bash
cd backend
npm ci --production=false
```

### Step B: Configure Environment Variables
Copy `.env.example` to `.env` and configure your production credentials:
```bash
cp .env.example .env
```

### Step C: Generate Prisma Client & Migrate Database
```bash
npx prisma generate
npx prisma db push
npm run prisma:seed
```

### Step D: Compile Production Bundle
```bash
npm run build
```

### Step E: Process Management via PM2
```bash
npm install -g pm2
pm2 start dist/main.js --name "silverhawk-api" -i max
pm2 save
pm2 startup
```

---

## 4. Nginx Reverse Proxy Configuration

Place the following configuration in `/etc/nginx/sites-available/silverhawkbank.conf`:

```nginx
# Upstream NestJS Backend API
upstream silverhawk_backend {
    server 127.0.0.1:4000;
    keepalive 32;
}

server {
    listen 80;
    server_name silverhawkbank.com www.silverhawkbank.com api.silverhawkbank.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name silverhawkbank.com www.silverhawkbank.com;

    ssl_certificate /etc/letsencrypt/live/silverhawkbank.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/silverhawkbank.com/privkey.pem;

    # Static Frontend Root
    root /var/www/silverhawkbank.com;
    index index.html;

    # Security Headers
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Frontend Routing
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API Proxy
    location /api/ {
        proxy_pass http://silverhawk_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 5. Database Backup & Disaster Recovery

### Automated Nightly Backup Script
```bash
#!/bin/bash
BACKUP_DIR="/var/backups/silverhawk/mysql"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
mkdir -p "$BACKUP_DIR"

# Full InnoDB dump with single transaction guarantee
mysqldump -u silverhawk_user -p'YourPassword' \
  --single-transaction \
  --quick \
  --routines \
  --triggers \
  silverhawk_db | gzip > "$BACKUP_DIR/silverhawk_db_$TIMESTAMP.sql.gz"

# Keep last 30 days of backups
find "$BACKUP_DIR" -type f -name "*.sql.gz" -mtime +30 -exec rm {} \;
```

### Point-in-Time Database Restoration
```bash
gunzip < /var/backups/silverhawk/mysql/silverhawk_db_20260910_000000.sql.gz | mysql -u silverhawk_user -p silverhawk_db
```

---

## 6. Seed Accounts & Default Credentials

| Account Role | Email Identifier | Default Password | Transaction PIN |
| :--- | :--- | :--- | :--- |
| **Super Admin** | `admin@silverhawkbank.com` | `Admin@Silverhawk2026!` | `1234` |
| **Demo Customer** | `john.doe@example.com` | `Customer@Silverhawk2026!` | `1234` |

> ⚠️ **Important Security Note**: Universal demo credentials must be changed immediately upon deploying to a public production environment via the `/api/v1/auth/change-password` endpoint.

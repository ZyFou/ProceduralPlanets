# Procedural Planets API

Small, self-hostable Node.js/MySQL service for the Procedural Planets studio. It implements account sessions, profile settings, cloud planet storage, privacy-safe visit analytics, and a secured administration API.

## Requirements

- Node.js 22 or newer (Node.js 24 LTS recommended)
- MySQL 8+ or MariaDB 10.6+
- PM2 installed globally on the server
- HTTPS for production cookie sessions

## Run locally

```sh
cp .env.example .env
npm install
npm run migrate
npm run dev
```

The API listens on `http://localhost:7070`. MySQL must already contain the database and user configured in `.env`.

If startup reports `auth_gssapi_client`, the configured MariaDB account is using
GSSAPI authentication, which the Node `mysql2` driver does not implement. Use a
password-authenticated account instead. For the existing account, run this from
an administrator MariaDB client, replace the placeholder password, then put the
same value in `DB_PASSWORD`:

```sql
ALTER USER 'planet'@'127.0.0.1'
  IDENTIFIED VIA mysql_native_password USING PASSWORD('replace-with-a-long-password');
```

Alternatively create a dedicated account with `CREATE USER ... IDENTIFIED BY ...`
and grant it access to `procedural_planets`. MariaDB documents `auth_gssapi_client`
as a native Connector/C plugin; it is not available to `mysql2`.

## Linux deployment with PM2

Install and configure MySQL directly on the Linux machine. The API uses a normal TCP connection to `127.0.0.1:3306`.

Create the database and a dedicated account from the MySQL console:

```sql
CREATE DATABASE procedural_planets
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

CREATE USER 'planet'@'127.0.0.1' IDENTIFIED BY 'replace-with-a-long-password';
GRANT ALL PRIVILEGES ON procedural_planets.* TO 'planet'@'127.0.0.1';
FLUSH PRIVILEGES;
```

Install and launch the API:

```sh
cd /srv/procedural-planets/api
cp .env.example .env
nano .env

npm ci --omit=dev
npm run migrate

sudo npm install --global pm2
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup systemd
```

`pm2 startup` prints one final command containing your Linux user and home directory. Run that generated command once so PM2 starts after a reboot.

Useful commands:

```sh
pm2 status
pm2 logs procedural-planets-api
pm2 restart procedural-planets-api --update-env
pm2 stop procedural-planets-api
```

The supplied PM2 configuration deliberately runs one process. Authentication rate limiting is currently held in process memory; use a shared Redis-backed limiter before enabling multiple PM2 instances.

To deploy an update:

```sh
git pull
cd api
npm ci --omit=dev
npm run migrate
pm2 reload ecosystem.config.cjs --env production --update-env
```

## Frontend configuration

`VITE_API_URL` is a frontend build-time variable. Local development defaults to the same-origin `/api/v1` path, which Vite proxies to port `7070`.

```env
VITE_API_URL=https://api.example.com/api/v1
```

Configure the API with the exact frontend origin—without a trailing slash:

```env
NODE_ENV=production
API_HOST=127.0.0.1
API_PORT=7070
FRONTEND_ORIGINS=https://procedural-planets.com
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
TRUST_PROXY=true
ADMIN_EMAILS=owner@example.com
PRIVACY_HASH_SECRET=replace-with-at-least-32-random-characters
```

`example.com` and `api.example.com` are same-site, so `lax` is appropriate. If an operator hosts the frontend and API on different top-level domains, use `COOKIE_SAME_SITE=none`; browsers require `COOKIE_SECURE=true` in that configuration.

## Reverse proxy example

Example Nginx virtual host before adding the TLS configuration from your certificate provider:

```nginx
server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://127.0.0.1:7070;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Keep port `7070` and MySQL private in the Linux firewall. Expose only Nginx on ports 80/443, terminate HTTPS there, then set `COOKIE_SECURE=true`.

## Migrations

SQL migrations live in `migrations/` and are applied in filename order:

```sh
npm run migrate
```

The runner uses a MySQL advisory lock, records a SHA-256 checksum in `schema_migrations`, and refuses to continue if an already-applied migration was edited. Add a new migration file instead of changing a deployed one.

If the configured database does not exist and `DB_USER` has permission to create it, the migration runner creates it automatically. A restricted production user should normally receive an already-created database from the server administrator.

## Routes

```text
GET  /health
GET  /api/v1/health
POST /api/v1/auth/register
POST /api/v1/auth/login
GET  /api/v1/auth/session
POST /api/v1/auth/logout
GET  /api/v1/me
PATCH /api/v1/me
PUT  /api/v1/me/avatar
DELETE /api/v1/me/avatar
PUT  /api/v1/me/password
GET  /api/v1/users/:userId/avatar
GET  /api/v1/me/projects
POST /api/v1/me/projects
GET  /api/v1/me/projects/:projectId
PATCH /api/v1/me/projects/:projectId
DELETE /api/v1/me/projects/:projectId
POST /api/v1/me/projects/:projectId/share-code
GET  /api/v1/projects/:projectId/thumbnail
GET  /api/v1/projects/shared/:shareCode
GET  /api/v1/community/projects
POST /api/v1/analytics/visit
GET  /api/v1/admin/overview
GET  /api/v1/admin/users
PATCH /api/v1/admin/users/:userId
POST /api/v1/admin/users/:userId/revoke-sessions
GET  /api/v1/admin/visits
GET  /api/v1/admin/planets
GET  /api/v1/admin/audit
GET  /api/v1/admin/security
```

Admin reporting accepts `days=7|30|90` for weekly, monthly, or extended visit ranges. User listings also accept `verified=verified|unverified`, `activity=7d|30d|never`, `planets=has|none`, and `sessions=active|none` filters.

Register body:

```json
{ "email": "you@example.com", "username": "planet_creator", "password": "at least 10 characters" }
```

Login accepts either email or username:

```json
{ "identifier": "planet_creator", "password": "your password" }
```

Profile settings accept any subset of these fields:

```json
{
  "username": "planet_creator",
  "displayName": "Planet Creator",
  "websiteUrl": "https://example.com",
  "defaultProjectVisibility": "private"
}
```

Visibility can be `private`, `unlisted`, or `public`. Profile pictures are sent as a PNG, JPEG, or WebP data URL in `{ "dataUrl": "..." }`, limited to 1 MB. MySQL stores only the decoded binary image.

All browser requests must use credentials so the `HttpOnly` session cookie is sent. The included frontend client already does this.

## Planet projects

A cloud project stores the studio document `{ id, metadata, params }` as JSON. `params` are plain `procedural-planets` package parameters, so a stored planet can be recreated with `new Planet(params)`. The body type (`planet`, `gas`, `star`) is derived from `params.mode` on every write and indexed for community filtering (`/community/projects?type=gas`). `metadata.thumbnail` (a PNG/JPEG/WebP data URL, at most 256 KB) is split out of the JSON and served from `/projects/:projectId/thumbnail`; documents are limited to 1 MB. `PATCH` accepts `expectedContentRevision` so a sync never overwrites a cloud copy that changed in the meantime (`409 PROJECT_SYNC_CONFLICT`). Public author objects never include email addresses.

## Administrator access

Set `ADMIN_EMAILS` to a short comma-separated list of exact account emails. These accounts are protected bootstrap administrators and cannot be demoted in the dashboard. Additional administrators can be promoted from the Users page after signing in with a bootstrap administrator.

Run `npm run migrate` before starting the updated API.

The dashboard never returns planet document contents. It exposes planet metadata only. Visit and security records store a monthly rotating HMAC of the network address rather than the raw address. Set a private, random `PRIVACY_HASH_SECRET` with at least 32 characters in production.

## Security choices

- Passwords use Node's memory-hard scrypt implementation with per-password random salts.
- Session tokens contain 256 bits of randomness; only SHA-256 token hashes are stored in MySQL.
- Cookies are `HttpOnly`, configurable for `Secure` and `SameSite`, and are never stored in frontend storage.
- Browser origins are explicitly allowlisted through `FRONTEND_ORIGINS`.
- Cross-site state-changing requests are rejected using browser fetch metadata, and API responses include restrictive security headers.
- Login errors do not reveal whether an account exists.
- Registration and login are rate-limited per client IP.
- Profile image signatures are checked server-side; SVG and mismatched content types are rejected.
- Changing a password invalidates every other active session while preserving the current one.
- Administrator authorization is enforced on every admin API route; hiding the frontend link is not considered authorization.
- Administrator changes are written to an audit log in the same transaction as the protected change.
- The last active administrator cannot be demoted, and administrators cannot suspend or demote their own account.
- On startup and then every hour, the API removes expired sessions plus visit analytics older than 90 days, security events older than 180 days, and audit events older than one year.

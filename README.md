# Sonarr Quality Inspector

A lightweight self-hosted web UI that connects to your [Sonarr](https://sonarr.tv) instance and visually highlights episodes that have a **lower quality than the dominant quality of their season** — making it easy to spot the 1-2 episodes in an otherwise 1080p season that are still stuck at 720p.

---

## Features

- 🎨 Dark UI inspired by Sonarr's own interface
- 🔍 Per-season quality analysis — identifies the dominant quality and flags outliers
- 🏷️ Colour-coded episode grid: dominant / same quality / lower quality / missing
- 🔎 Filters by series, view mode (issues only / all), and minimum quality gap
- 🔒 API key is **never exposed to the browser** — all Sonarr calls are proxied server-side
- 🐳 Fully ephemeral Docker container — no volumes, no persistent state
- ⚙️ Configured entirely via environment variables

---

## Screenshots

> _Add screenshots here after first run._

---

## Quick start

Build and deploy are intentionally **separate steps**.

### 1. Build the image

```bash
git clone https://github.com/undermix/sonarr-quality-inspector.git
cd sonarr-quality-inspector
docker build -t undermix/sonarr-quality-inspector:latest .
```

### 2. Deploy with Docker Compose

```bash
cp .env.example .env
# Edit .env with your SONARR_URL and SONARR_API_KEY
docker compose up -d
```

Get your API key from **Sonarr → Settings → General → Security → API Key**.

Open `http://localhost:3000` in your browser.

> **Note:** `docker-compose.yml` uses the pre-built image `undermix/sonarr-quality-inspector:latest` and does not build from source. Run `docker build` separately whenever you want to update the image.

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SONARR_URL` | ✅ | — | Full URL of your Sonarr instance |
| `SONARR_API_KEY` | ✅ | — | Sonarr API key |
| `ALLOWED_ORIGINS` | ❌ | _(empty)_ | Comma-separated CORS origins (see below) |
| `PORT` | ❌ | `3000` | Internal container port |
| `EXTERNAL_PORT` | ❌ | `3000` | Host port to bind |

### `SONARR_URL` formats

All of these work:

```
http://192.168.1.50:8989
https://sonarr.yourdomain.com
http://sonarr:8989          ← Docker hostname (same network)
```

---

## Docker networking

### Sonarr on a separate Docker network

If both containers share a Docker network, you can reach Sonarr by hostname. Uncomment the `networks` section in `docker-compose.yml` and set the correct network name:

```yaml
networks:
  sonarr-net:
    external: true
    name: sonarr_default   # your existing network name
```

Then set `SONARR_URL=http://sonarr:8989` in your `.env`.

---

## Reverse proxy setup

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name inspector.yourdomain.com;

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    add_header X-Robots-Tag "noindex, nofollow" always;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

### Traefik

Add labels to the service in `docker-compose.yml`:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.sonarr-qi.rule=Host(`inspector.yourdomain.com`)"
  - "traefik.http.routers.sonarr-qi.entrypoints=websecure"
  - "traefik.http.routers.sonarr-qi.tls.certresolver=letsencrypt"
  - "traefik.http.services.sonarr-qi.loadbalancer.server.port=3000"
```

---

## CORS

If you access the app from a different origin than where it is hosted (uncommon), set `ALLOWED_ORIGINS`:

```
ALLOWED_ORIGINS=https://inspector.yourdomain.com,https://home.yourdomain.com
```

For same-origin access (the normal case), leave it empty.

---

## Security notes

- The Sonarr API key is stored only in the container's environment — never sent to the browser.
- All Sonarr API calls are server-side proxied; only sanitised, read-only data reaches the frontend.
- The container runs as a non-root user.
- The filesystem is mounted read-only with a `/tmp` tmpfs.
- Security headers (CSP, HSTS, X-Frame-Options, etc.) are set by the Express backend via `helmet`.
- Rate limiting is applied on all API endpoints.
- If you expose this publicly, protect it with an authentication layer (e.g. Authelia, Authentik, Cloudflare Access, or your reverse proxy's basic auth).

---

## License

[MIT](LICENSE)

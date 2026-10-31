# Deploying OrigamiEvolve to a live server

The whole app (website, API, workers, MongoDB, Redis, file storage) runs on **one Linux server** with Docker.
The web server **Caddy** sits in front: it serves the website, forwards `/api` to FastAPI, and gets a free HTTPS
certificate for your domain automatically.

```
Internet ──443/80──▶ Caddy (web) ──/api──▶ FastAPI (api) ──▶ MongoDB, Redis, /data storage
                       │                                   ▲
                       └── built React app                 └── Celery workers (ingest, optimize) + beat
```

Files used:

| File | What it is |
|---|---|
| `docker-compose.prod.yml` | Production overlay: adds the `web` (Caddy) service, sets production settings |
| `frontend/Dockerfile` | Builds the React app and packages it with Caddy |
| `deploy/Caddyfile` | Caddy config: website + `/api` proxy + HTTPS + security headers |
| `.env.production.example` | Template for the server's `.env` |
| `deploy/make-env.sh` | Creates `.env` with strong random passwords |
| `deploy/server-setup.sh` | One-time server setup: Docker, firewall, swap |
| `deploy/backup.sh` | Backs up MongoDB and the file storage |

---

## 1. Get a server

Any Ubuntu 22.04 or 24.04 server works, for example a DigitalOcean Droplet, AWS EC2/Lightsail, Azure VM or
Oracle Cloud VM.

- **Size:** at least 2 GB RAM (4 GB is more comfortable: MongoDB, Redis and four Python containers run together).
- **Disk:** 25 GB or more.
- When creating it, add your SSH key (or set a password), and note the server's **public IP address**.

## 2. Point your domain at the server

In your domain provider's DNS settings, add an **A record**:

| Type | Name | Value |
|---|---|---|
| A | `origami` (or `@` for the bare domain) | your server's IP |

This gives e.g. `origami.yourdomain.com`. DNS can take a few minutes to update. Check with
`nslookup origami.yourdomain.com` on your own computer.

No domain yet? You can still test by IP address over plain HTTP (see step 4).

## 3. Set up the server (once)

From PowerShell on your computer:

```powershell
ssh root@<server-ip>
```

Then on the server:

```bash
git clone https://github.com/<your-account>/ORIGAMIEVOLVE23.git origami
cd origami
bash deploy/server-setup.sh
exit
```

Log in again (`ssh root@<server-ip>`) so the Docker permissions apply, then `cd origami`.

If the repository is private, GitHub asks for a username and a **personal access token** (not your password):
GitHub → Settings → Developer settings → Personal access tokens → Fine-grained token with read access to the repo.

## 4. Create the server's .env

```bash
bash deploy/make-env.sh origami.yourdomain.com you@example.com
```

This writes `.env` with random MongoDB and Redis passwords. **Never commit it.**

Testing by IP only (no domain): `bash deploy/make-env.sh :80 you@example.com` and later open `http://<server-ip>`.
Switching to a real domain later: edit `DOMAIN` and `ORIGAMI_CORS_ORIGINS` in `.env` (keep the passwords), then
run step 5 again.

## 5. Start everything

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile full up -d --build
```

The first build takes a few minutes. Then check:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile full ps
```

All services should be `running` and `healthy` (workers can take about 30 seconds).

To avoid typing the long command, add this shortcut once:

```bash
echo "alias dc='docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile full'" >> ~/.bashrc
source ~/.bashrc
```

From now on `dc ps`, `dc logs api --tail 50` and so on work.

## 6. Create an API token

```bash
dc exec -T api python -m origami_api.cli create-token demo
```

Copy the printed `oe_...` token and keep it safe; it is shown only once.

## 7. Open the website

Go to `https://origami.yourdomain.com`, paste the token into **API token**, and click Save.
**System status** should show mongo, redis and storage as `ok`.

---

## Updating after you push new code

```bash
cd ~/origami
git pull
dc up -d --build
```

Data is kept: it lives in Docker volumes, not in the code folder.

## Backups

```bash
bash deploy/backup.sh
```

This writes `backups/<date-time>/mongo.archive.gz` and `storage.tar.gz`. Copy them to your computer from PowerShell:

```powershell
scp -r root@<server-ip>:~/origami/backups/<date-time> .
```

Restore (on the server, in `~/origami`, with the stack running):

```bash
set -a; . ./.env; set +a
dc exec -T mongo mongorestore --archive --gzip --drop \
  --username "$MONGO_ROOT_USER" --password "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin \
  < backups/<date-time>/mongo.archive.gz
dc exec -T api tar xzf - -C /data < backups/<date-time>/storage.tar.gz
```

Make a backup before demo day.

## Useful commands

| Task | Command |
|---|---|
| Status | `dc ps` |
| Logs | `dc logs web --tail 50` (or `api`, `worker-optimize`, `worker-ingest`, `beat`, `mongo`, `redis`) |
| Restart one service | `dc restart api` |
| Stop everything (data kept) | `dc stop` |
| Start again | `dc up -d` |
| List / revoke tokens | `dc exec api python -m origami_api.cli list-tokens` / `revoke-token <name>` |

Never run `dc down -v`: `-v` deletes the volumes, which means **all data**.

## Troubleshooting

| Problem | Fix |
|---|---|
| Browser shows a certificate error, or `dc logs web` mentions ACME / challenge failures | The domain doesn't point at this server yet (check `nslookup`), or ports 80/443 are blocked. Some clouds (AWS, Azure, Oracle) also need 80 and 443 opened in their own firewall or security group, in addition to `ufw`. Then `dc restart web`. |
| `502 Bad Gateway` on the site | The API isn't healthy: `dc ps`, then `dc logs api --tail 50`. |
| Jobs stay `queued` | `dc logs worker-optimize --tail 50`; restart it with `dc restart worker-optimize`. |
| Server very slow, or containers restarting | Out of memory: set `ORIGAMI_OPTIMIZE_CONCURRENCY=1` and `INGEST_CONCURRENCY=1` in `.env`, then `dc up -d`; or resize the server. |
| `/ready` shows a MongoDB error after editing `.env` | MongoDB keeps the password from its very first start. Put the original password back. |
| `.env already exists` from make-env.sh | Intentional, to protect the existing passwords. Edit `.env` by hand instead. |

## Security checklist

- `.env` holds the passwords and stays only on the server (`chmod 600`, git-ignored).
- Only ports 22, 80 and 443 are open. MongoDB, Redis and the API listen on `127.0.0.1` only.
- HTTPS everywhere, with HSTS and security headers set by Caddy.
- The app has no rate limiting and no user accounts: share API tokens only with people you trust, and revoke
  tokens you no longer need.

# worker/

Cloudflare Worker handling `/api/prepare`, `/api/publish`, `GET /<hash>`, `/api/report`, `DELETE /api/admin/page/:hash`, and the daily TTL cron.

## First-time setup

```sh
npm install
npx wrangler login

# Enable R2 in the dashboard first (one-time, free tier ok but needs a payment method on file):
#   https://dash.cloudflare.com/?to=/:account/r2
# Then create the bucket:
npx wrangler r2 bucket create share-insights-pages

# Create the KV namespace (already done if id is already in wrangler.toml):
npx wrangler kv namespace create share-insights-state
#  → copy the printed id into wrangler.toml under [[kv_namespaces]]

# Set secrets (you'll be prompted to paste values):
npx wrangler secret put ADMIN_TOKEN          # any long random string; you use this to admin-delete
npx wrangler secret put TURNSTILE_SECRET     # from Cloudflare → Turnstile → your site config
npx wrangler secret put ABUSE_SLACK_WEBHOOK  # Slack incoming-webhook URL where abuse reports go
```

## Local dev

```sh
npx wrangler dev --local --persist-to .wrangler/state
# default port 8787; Miniflare emulates R2 + KV in-memory
```

Smoke test with the CLI:

```sh
echo '<!doctype html><html><head><title>smoke</title></head><body><h1>hi</h1></body></html>' > /tmp/smoke.html
SHARE_INSIGHTS_URL=http://localhost:8787 python ../cli/share_insights.py /tmp/smoke.html --title smoke
```

Try a dirty payload — should 400:

```sh
echo '<!doctype html><html><body><script>alert(1)</script></body></html>' > /tmp/dirty.html
SHARE_INSIGHTS_URL=http://localhost:8787 python ../cli/share_insights.py /tmp/dirty.html
```

Try a secret in the payload — should 400 with `secrets_detected`:

```sh
printf '%s' '<!doctype html><html><body><p>AKIAIOSFODNN7EXAMPLE</p></body></html>' > /tmp/secret.html
SHARE_INSIGHTS_URL=http://localhost:8787 python ../cli/share_insights.py /tmp/secret.html --allow-secrets
# (--allow-secrets bypasses the CLI scanner so the server scanner is what trips)
```

## Deploy

```sh
npx wrangler deploy
```

After deploy, set Cloudflare billing alerts at $25 and $50 (Dashboard → Billing → Notifications). The Worker checks the `admin:read_only` KV key on every publish — to manually freeze the service, do `wrangler kv key put --binding STATE admin:read_only 1`.

## Endpoints recap

| Method | Path | Auth |
|---|---|---|
| POST | `/api/prepare` | none, rate-limited |
| POST | `/api/publish` | none, rate-limited |
| GET | `/<hash>` | none, cached 5min |
| POST | `/api/report` | none |
| DELETE | `/api/admin/page/:hash` | `Authorization: Bearer ADMIN_TOKEN` |
| GET | `/robots.txt` | none |

## Pages routing

Cloudflare Pages serves `pages/index.html` and `pages/abuse.html` for any path the Worker doesn't claim. Route the Worker in the dashboard at `share-insights.pages.dev/api/*` and `share-insights.pages.dev/:hash` (12-hex-char pattern) only; everything else falls through to Pages.

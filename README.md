# share-insights

Publish a clean, shareable HTML page from any AI-coding session — Claude Code, Codex, Claude.ai / Cowork / Cursor (via MCP), or ChatGPT (via Custom GPT). One short URL, no signup, content-addressed, auto-deleted after 90 days of disuse.

> **Status:** v1, hosted at `https://share-insights.pages.dev`.

## How it works

```
your AI session
      │
      ▼
[skill prompts the model to]
  1. summarize the session
  2. redact secrets / PII
  3. fill the canonical HTML template
  4. show you a preview
  5. ask "publish?"
      │
      ▼
POST /api/publish  ──► [Cloudflare Worker]
                         • per-IP rate limit
                         • regex secret scan
                         • strict-allowlist HTML sanitize
                         • sha256[:12] content hash
                         ▼
                       [R2]
                         ▼
        https://share-insights.pages.dev/<hash>
```

## Install — Claude Code (one command)

This repo is a Claude Code plugin marketplace. From inside Claude Code:

```
/plugin marketplace add tshradheya/share-insights
/plugin install share-insights@share-insights
```

That installs:

- The `/share-insights` skill (summarize → redact → preview → publish)
- The bundled MCP server pointer at `share-insights-mcp.tshradheya.workers.dev/mcp` — so the same publish flow is available via the model's tool list whenever you want it

For local development against an uncommitted version of this repo, point the marketplace at the directory instead:

```
/plugin marketplace add /path/to/share-insights
/plugin install share-insights@share-insights
```

## Install — Codex CLI

Same Python CLI works standalone — invoke directly:

```sh
python3 cli/share_insights.py <file.html> --title "..."
```

The Python file is a symlink into the plugin (`plugins/share-insights/skills/share-insights/share_insights.py` is the canonical copy).

## Install — Claude.ai / Cowork / Cursor / Desktop (MCP)

Settings → Connectors → Add custom connector → paste:

```
https://mcp.share-insights.pages.dev/sse
```

The model will see two tools: `prepare_insights` (dry-run + warnings) and `publish_insights` (final commit). Both require your explicit consent at call time.

## Install — ChatGPT.com (Custom GPT)

Open [Share Insights GPT](https://chat.openai.com/g/...) (link goes here after publish). Plus required.

## Privacy

- URLs are unguessable (sha256 prefix). Pages are not listed anywhere, not indexed (`noindex` + `robots.txt` Disallow).
- Pages auto-delete 90 days after the last view.
- Backend stores only the rendered HTML + minimal metadata (created_at, last_viewed_at, source-tool name). No user identifiers.
- Anyone with the URL can read the page — there is no per-page password in v1.

## Report a page

Every page has a "Report this page" footer link, or email `abuse@share-insights.pages.dev`. Reviewed within 24h. Full policy at [/abuse](https://share-insights.pages.dev/abuse).

## Limits

- 10 MB max HTML upload (matches existing `html-upload` upstream). Use `--compress` if your page exceeds it.
- 20 publishes per IP per day, 5 per hour.
- After 5 rapid publishes you'll be asked to solve a Turnstile challenge.
- Hard service spend cap: $50/mo. Above ceiling the API returns 503 until the next billing cycle.

## Repo layout

| Path | What |
|---|---|
| `.claude-plugin/marketplace.json` | Declares this repo as a Claude Code plugin marketplace |
| `plugins/share-insights/` | The installable plugin — `.claude-plugin/plugin.json`, `.mcp.json`, and `skills/share-insights/{SKILL.md, share_insights.py}` |
| `worker/` | Cloudflare Worker: `/api/prepare`, `/api/publish`, `/<hash>`, `/api/report`, cron TTL |
| `mcp/` | Cloudflare Worker exposing the MCP server bundled by the plugin |
| `cli/share_insights.py` | Symlink → the plugin's canonical Python CLI, for standalone use |
| `chatgpt/` | OpenAPI spec + GPT instructions + Knowledge template + `PUBLISH.md` walkthrough |
| `pages/` | Static landing + abuse pages |
| `template/share-insights.html.tpl` | Canonical HTML template (source of truth) |
| `scripts/sync-template.sh` | Stamps template into SKILL.md and chatgpt Knowledge file |

## Local development

See [docs in worker/README.md](worker/README.md) for the wrangler + Miniflare setup. TL;DR:

```sh
cd worker && npm i && npx wrangler dev --local
# in another shell:
SHARE_INSIGHTS_URL=http://localhost:8787 python cli/share_insights.py /tmp/test.html --title "smoke test"
```

## Smoke tests

1. Claude Code skill: `/share-insights` → confirm preview → URL works.
2. MCP from Cursor: add the MCP URL, ask the agent to publish, check both consent prompts fire.
3. ChatGPT GPT: open the GPT, ask it to publish, check `prepare` then `publish` both authorize.
4. Rate limit: loop 25 publishes; the 21st should 429.
5. Secret scanner: include `AKIAIOSFODNN7EXAMPLE` in the HTML; expect rejection naming the matched pattern.
6. Sanitizer: include `<script>alert(1)</script>`; expect 400 listing the violation.
7. TTL cron: invoke `wrangler triggers cron schedule` manually, check stale objects vanish.
8. Abuse report: hit the footer link, confirm the queue triggers.
9. Spend cap: flip `READ_ONLY` KV manually, confirm `/api/publish` returns 503.

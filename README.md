# share-insights

> Publish a clean, redacted HTML summary of any AI conversation to a short shareable URL.
> Anonymous · content-addressed · unindexed · auto-deletes after 90 days.

**Live:** <https://share-insights.pages.dev/>
**Sample page:** <https://share-insights.tshradheya.workers.dev/34362d82b231>
**Built by:** [Shradheya Thakre](https://github.com/tshradheya) · MIT licensed

---

## Why

Long, productive sessions with Claude / ChatGPT / Cursor / Codex end up with insights worth sharing. PDF/Word exports are ugly, lose linking, and have no version history. share-insights turns the work you just did into a styled HTML page at a short URL like `share-insights.tshradheya.workers.dev/a1b2c3d4e5f6` — one URL, no signup, no install for ChatGPT users, one install command for Claude Code users.

It's defense-in-depth around the obvious failure mode of "AI summarizes my session and leaks an API key": the agent redacts → user reviews the preview in chat → the server's regex scanner has the final say. A strict HTML allow-list rejects `<script>`, external resources, and event handlers, so a malicious page can't be hosted under our domain.

---

## How

```
your AI session
      │
      ▼
[skill / GPT / MCP tool prompts the model to]
  1. summarize
  2. redact secrets / PII
  3. render the canonical HTML template
  4. show you a preview in chat
  5. ask "publish? yes/no"
      │
      ▼
POST /api/publish  ──► [Cloudflare Worker]
                         • per-IP rate limit (KV)
                         • regex secret scan
                         • strict-allowlist HTML sanitize (parse5)
                         • sha256(html)[:12] as content hash
                         ▼
                       [R2 bucket]
                         ▼
        share-insights.tshradheya.workers.dev/<hash>
        (cron sweeps R2 nightly, deletes objects unread for 90 days)
```

---

## Install

### Claude Code <sub>(free, one command)</sub>

```
/plugin marketplace add tshradheya/share-insights
/plugin install share-insights@share-insights
```

That installs both the `/share-insights` skill **and** auto-wires the hosted MCP server. Run `/share-insights` in any session.

### Claude Desktop <sub>(free, all plans)</sub>

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "share-insights": {
      "type": "http",
      "url": "https://share-insights-mcp.tshradheya.workers.dev/mcp"
    }
  }
}
```

Restart Claude Desktop. In any chat: *"share this conversation."*

### Claude.ai web <sub>(Pro / Team / Enterprise)</sub>

Settings → Connectors → Add custom connector → paste:

```
https://share-insights-mcp.tshradheya.workers.dev/mcp
```

### Cursor <sub>(free, all plans)</sub>

Edit `~/.cursor/mcp.json` with the same `mcpServers` block as Claude Desktop.

### ChatGPT.com <sub>(Plus required)</sub>

Open the published GPT: <https://chatgpt.com/g/g-6a1137bf11748191a837919a8646853a-share-insights>

After visiting once, you can `@share-insights` from any ChatGPT conversation to publish that conversation.

### Codex CLI / standalone Python

```sh
git clone https://github.com/tshradheya/share-insights
python3 share-insights/cli/share_insights.py your-file.html --title "..."
```

---

## What's hosted where

| Component | URL |
|---|---|
| API worker (publish, sanitize, store, serve) | `share-insights.tshradheya.workers.dev` |
| MCP server (two-tool prepare+publish) | `share-insights-mcp.tshradheya.workers.dev/mcp` |
| Landing + abuse | `share-insights.pages.dev` |
| Source | `github.com/tshradheya/share-insights` |
| Sample page | `share-insights.tshradheya.workers.dev/34362d82b231` |

---

## Privacy

- URLs are unguessable 12-char content hashes — no listing page exists.
- `<meta name="robots" content="noindex,nofollow">` and `robots.txt: Disallow: /`.
- No accounts. No tracking pixels. Backend stores only the rendered HTML + minimal metadata (`source`, `created_at`, `last_viewed_at`, salted IP hash).
- Pages auto-delete **90 days after the last view** (cron sweeps R2 nightly).
- Anyone with the URL can read the page — there is no per-page password.

## Limits

- 10 MB max HTML per upload (`--compress` shrinks embedded images).
- 20 publishes / IP / day · 5 / hour. Turnstile challenge kicks in after 5 rapid attempts.
- 503 above a $50/month hard spend cap.

## Report a page

Every page has a "Report this page" footer link → `/api/report` → Slack webhook → manual review within 24h. Full policy at <https://share-insights.pages.dev/abuse>.

---

## Repo layout

```
share-insights/
├── .claude-plugin/marketplace.json     # Claude Code marketplace manifest
├── plugins/share-insights/             # the installable plugin
│   ├── .claude-plugin/plugin.json
│   ├── .mcp.json                       # auto-wires the hosted MCP on install
│   └── skills/share-insights/
│       ├── SKILL.md                    # canonical agent instructions
│       └── share_insights.py           # canonical Python uploader
│
├── worker/                             # Cloudflare Worker — the only real backend
│   ├── src/
│   │   ├── index.ts                    # routes + handlers
│   │   ├── sanitize.ts                 # strict-allowlist HTML sanitizer (parse5)
│   │   ├── secrets.ts                  # regex secret-pattern list
│   │   └── ratelimit.ts                # per-IP KV rate limit
│   └── wrangler.toml
│
├── mcp/                                # Hosted MCP Worker, calls the API worker via service binding
│   └── src/index.ts
│
├── chatgpt/                            # ChatGPT Custom GPT artifacts
│   ├── openapi.yaml                    # the Action schema
│   ├── instructions.md                 # the GPT system prompt
│   ├── share-insights-template.html    # Knowledge file uploaded to the GPT
│   └── PUBLISH.md                      # step-by-step walkthrough
│
├── cli/share_insights.py               # symlink → plugin's canonical CLI
├── pages/                              # Cloudflare Pages: landing + abuse
├── template/share-insights.html.tpl    # source of truth for the page template
└── scripts/sync-template.sh            # stamps template into SKILL.md + chatgpt Knowledge
```

---

## Local development

### API worker

```sh
cd worker
npm install
npx wrangler dev --local --persist-to .wrangler/state
```

`wrangler dev --local` uses Miniflare to emulate R2 + KV in-memory.

Smoke test against the local worker:

```sh
SHARE_INSIGHTS_URL=http://localhost:8787 \
  python3 cli/share_insights.py /tmp/test.html --title smoke
```

### MCP server

```sh
cd mcp && npm install && npx wrangler dev --local --port 8788
```

### Pages site

`pages/` is plain static HTML — just `open pages/index.html`.

### Deploy

Requires `nvm use 20` (wrangler 4 needs Node 20+) and a one-time `wrangler login`. Then:

```sh
( cd worker && npx wrangler deploy )
( cd mcp    && npx wrangler deploy )
npx wrangler pages deploy pages --project-name share-insights
```

After editing `template/share-insights.html.tpl`, run `scripts/sync-template.sh` to stamp the change into SKILL.md and the ChatGPT Knowledge file.

---

## Security posture

| Threat | Mitigation |
|---|---|
| Secret / PII leak from session | LLM redaction → mandatory preview → server regex backstop (three layers) |
| XSS via injected HTML | Strict allowlist sanitizer (parse5), CSP `default-src 'none'`, `noindex` |
| Spam / R2 fill | Per-IP rate limits, Turnstile after burst, 90-day TTL, $50/mo hard cap |
| Search-engine indexing of accidental shares | `noindex` meta + `X-Robots-Tag` + `robots.txt: Disallow: /` |
| Malicious page reported | Footer report link → Slack webhook → manual delete within 24h |

Detail in [the implementation plan](https://github.com/tshradheya/share-insights/blob/main/README.md#how) and `worker/src/sanitize.ts`.

---

## Credits

Built by [Shradheya Thakre](https://github.com/tshradheya). Forked from the internal `html-upload` skill pattern. Cloudflare's free tier carries the entire stack. The plugin/marketplace structure follows the Claude Code spec.

## License

MIT — see [LICENSE](LICENSE).

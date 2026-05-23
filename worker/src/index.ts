// share-insights API Worker.
//
// Routes:
//   POST /api/prepare              — dry-run sanitize + secret scan, stage in KV for 5 min
//   POST /api/publish              — commit a staged prepare OR direct publish (CLI uses this)
//   GET  /<hash>                   — serve a published page
//   POST /api/report               — push abuse report to queue
//   DELETE /api/admin/page/:hash   — admin delete (Bearer ADMIN_TOKEN)
//   GET  /robots.txt               — Disallow: /
//   *                              — falls through to Pages (landing, abuse)
//
// Scheduled (cron 0 3 * * *): sweep R2 objects whose last_viewed_at is older
// than TTL_DAYS.

import { scanForSecrets } from "./secrets";
import { sanitizeOrReject } from "./sanitize";
import { checkAndIncrement, verifyTurnstile } from "./ratelimit";

export interface Env {
  PAGES: R2Bucket;
  STATE: KVNamespace;
  PUBLIC_BASE_URL: string;
  TTL_DAYS: string;
  RATE_LIMIT_DAILY: string;
  RATE_LIMIT_HOURLY: string;
  BURST_THRESHOLD: string;
  MAX_HTML_BYTES: string;
  ADMIN_NOTIFY_EMAIL: string;
  ADMIN_TOKEN: string;
  TURNSTILE_SECRET: string;
  ABUSE_SLACK_WEBHOOK: string;
}

type PublishPayload = {
  html?: string;
  title?: string;
  source?: string;
  preview_token?: string;
  turnstile_token?: string;
};

type StagedPrep = {
  html: string;
  title: string;
  source: string;
};

const ALLOWED_SOURCES = new Set([
  "claude-code", "codex", "mcp", "chatgpt-gpt", "web", "cli",
]);

const HASH_PATH_RE = /^\/([a-f0-9]{12})$/;

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    const path = url.pathname;

    if (path === "/robots.txt") {
      return new Response("User-agent: *\nDisallow: /\n", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    if (path === "/api/prepare" && method === "POST") return handlePrepare(req, env);
    if (path === "/api/publish" && method === "POST") return handlePublish(req, env);
    if (path === "/api/report"  && method === "POST") return handleReport(req, env);

    const adminMatch = path.match(/^\/api\/admin\/page\/([a-f0-9]{12})$/);
    if (adminMatch && method === "DELETE") return handleAdminDelete(req, env, adminMatch[1]);

    const hashMatch = path.match(HASH_PATH_RE);
    if (hashMatch && method === "GET") return handleGetPage(env, hashMatch[1], ctx);

    // Anything else — fall through to Pages (landing + abuse page) handled
    // by the [routes] config in wrangler.toml. If we're hit directly, 404.
    return new Response("Not found", { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(sweepStalePages(env));
  },
} satisfies ExportedHandler<Env>;

// ---------------------------------------------------------------------------
// /api/prepare — dry-run, store result in KV for 5 minutes, return token.
// ---------------------------------------------------------------------------

async function handlePrepare(req: Request, env: Env): Promise<Response> {
  if (await isReadOnly(env)) return jsonResp({ error: "read_only" }, 503);
  const ip = clientIp(req);
  const body = await parseJson<PublishPayload>(req);
  if (!body) return jsonResp({ error: "invalid_json" }, 400);

  const check = await preflight(body, env, ip, /* enforceRate */ false);
  if (check.kind === "error") return check.response;

  const token = await stagePrep(env, check.staged);
  return jsonResp({
    preview_token: token,
    warnings: check.warnings,
    size_bytes: check.staged.html.length,
    expires_in: 300,
  }, 200);
}

// ---------------------------------------------------------------------------
// /api/publish — either a fresh upload OR a redeem of a prepare token.
// ---------------------------------------------------------------------------

async function handlePublish(req: Request, env: Env): Promise<Response> {
  if (await isReadOnly(env)) return jsonResp({ error: "read_only" }, 503);
  const ip = clientIp(req);
  const body = await parseJson<PublishPayload>(req);
  if (!body) return jsonResp({ error: "invalid_json" }, 400);

  let staged: StagedPrep;

  if (body.preview_token) {
    const prep = await redeemPrep(env, body.preview_token);
    if (!prep) return jsonResp({ error: "preview_token_expired_or_invalid" }, 400);
    staged = prep;
  } else {
    const check = await preflight(body, env, ip, /* enforceRate */ true);
    if (check.kind === "error") return check.response;
    staged = check.staged;
  }

  // Rate-limit the FINAL commit only.
  const limits = {
    daily: Number(env.RATE_LIMIT_DAILY),
    hourly: Number(env.RATE_LIMIT_HOURLY),
    burst: Number(env.BURST_THRESHOLD),
  };
  const rate = await checkAndIncrement(env.STATE, ip, limits);
  if (rate.blocked) {
    return jsonResp({ error: "rate_limited", window: rate.reason }, 429);
  }
  if (rate.needsTurnstile) {
    const ok = body.turnstile_token
      ? await verifyTurnstile(env.TURNSTILE_SECRET, body.turnstile_token, ip)
      : false;
    if (!ok) {
      return jsonResp({
        error: "turnstile_required",
        challenge_url: "https://share-insights.pages.dev/challenge",
      }, 429);
    }
  }

  const hash = await sha256Hex(staged.html, 12);
  const key = `${hash}.html`;

  const existing = await env.PAGES.head(key);
  const cached = existing !== null;
  if (!cached) {
    await env.PAGES.put(key, staged.html, {
      httpMetadata: { contentType: "text/html; charset=utf-8" },
      customMetadata: {
        source: staged.source,
        title: staged.title.slice(0, 200),
        created_at: new Date().toISOString(),
        last_viewed_at: new Date().toISOString(),
        ip_hash: await sha256Hex(ip + ":" + new Date().toISOString().slice(0, 10), 16),
      },
    });
  }

  const pageUrl = `${env.PUBLIC_BASE_URL}/${hash}`;
  return jsonResp({
    url: pageUrl,
    hash,
    cached,
    size_bytes: staged.html.length,
  }, 200);
}

// ---------------------------------------------------------------------------
// GET /<hash> — serve from R2 + bump last_viewed_at metadata.
// ---------------------------------------------------------------------------

async function handleGetPage(env: Env, hash: string, ctx: ExecutionContext): Promise<Response> {
  const key = `${hash}.html`;
  const obj = await env.PAGES.get(key);
  if (!obj) return new Response("Not found", { status: 404 });

  // Bump last_viewed_at lazily (don't block the response).
  const meta = obj.customMetadata ?? {};
  ctx.waitUntil(
    env.PAGES.put(key, obj.body, {
      httpMetadata: obj.httpMetadata,
      customMetadata: { ...meta, last_viewed_at: new Date().toISOString() },
    }).catch(() => undefined),
  );

  return new Response(obj.body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-robots-tag": "noindex, nofollow",
      "content-security-policy":
        "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

// ---------------------------------------------------------------------------
// /api/report — anyone can report a URL. Push to queue, ack 200.
// ---------------------------------------------------------------------------

async function handleReport(req: Request, env: Env): Promise<Response> {
  const ip = clientIp(req);
  const body = await parseJson<{ url?: string; reason?: string; reporter_email?: string }>(req);
  if (!body || !body.url || !body.reason) {
    return jsonResp({ error: "missing_fields" }, 400);
  }
  if (body.reason.length > 2000) {
    return jsonResp({ error: "reason_too_long" }, 400);
  }

  // Rate-limit reports too — 10 per IP per hour. Spam guard.
  const rlKey = `rl:report:${ip}`;
  const current = Number((await env.STATE.get(rlKey)) ?? 0);
  if (current >= 10) return jsonResp({ error: "report_rate_limited" }, 429);
  await env.STATE.put(rlKey, String(current + 1), { expirationTtl: 3600 });

  const reportedUrl = body.url.slice(0, 500);
  const reason = body.reason.slice(0, 2000);
  const reporterEmail = body.reporter_email?.slice(0, 200);

  if (env.ABUSE_SLACK_WEBHOOK) {
    const ipHash = await sha256Hex(ip + ":report", 16);
    const slackBody = {
      text: `:rotating_light: share-insights abuse report`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "Abuse report" },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*URL*\n${reportedUrl}` },
            { type: "mrkdwn", text: `*Reporter*\n${reporterEmail ?? "(anonymous)"}` },
            { type: "mrkdwn", text: `*IP hash*\n\`${ipHash}\`` },
            { type: "mrkdwn", text: `*When*\n${new Date().toISOString()}` },
          ],
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*Reason*\n${reason}` },
        },
      ],
    };
    try {
      await fetch(env.ABUSE_SLACK_WEBHOOK, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(slackBody),
      });
    } catch {
      // Slack delivery is best-effort; still ack the user.
    }
  }

  return jsonResp({ ok: true }, 200);
}

// ---------------------------------------------------------------------------
// DELETE /api/admin/page/:hash — Bearer ADMIN_TOKEN.
// ---------------------------------------------------------------------------

async function handleAdminDelete(req: Request, env: Env, hash: string): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.ADMIN_TOKEN}`;
  if (!env.ADMIN_TOKEN || !timingSafeEqualStr(auth, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }
  await env.PAGES.delete(`${hash}.html`);
  return jsonResp({ ok: true, deleted: hash }, 200);
}

// ---------------------------------------------------------------------------
// Cron: delete R2 objects whose last_viewed_at is older than TTL_DAYS.
// ---------------------------------------------------------------------------

async function sweepStalePages(env: Env): Promise<void> {
  const ttlMs = Number(env.TTL_DAYS) * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - ttlMs;

  let cursor: string | undefined = undefined;
  do {
    const list = await env.PAGES.list({ cursor, limit: 1000 });
    for (const obj of list.objects) {
      const lastViewedRaw = obj.customMetadata?.last_viewed_at;
      const lastViewed = lastViewedRaw ? Date.parse(lastViewedRaw) : obj.uploaded.getTime();
      if (lastViewed < cutoff) {
        await env.PAGES.delete(obj.key);
      }
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
}

// ---------------------------------------------------------------------------
// Shared preflight: size, schema, secret scan, sanitize.
// ---------------------------------------------------------------------------

type PreflightResult =
  | { kind: "ok"; staged: StagedPrep; warnings: Warning[] }
  | { kind: "error"; response: Response };

type Warning =
  | { kind: "size"; bytes: number }
  | { kind: "secrets_redacted_count"; count: number };

async function preflight(
  body: PublishPayload,
  env: Env,
  _ip: string,
  _enforceRate: boolean,
): Promise<PreflightResult> {
  const maxBytes = Number(env.MAX_HTML_BYTES);
  const html = body.html ?? "";
  if (!html) return err("missing_html", 400);
  const byteLen = new TextEncoder().encode(html).length;
  if (byteLen > maxBytes) return err("html_too_large", 413, { size_bytes: byteLen, limit: maxBytes });

  const title = (body.title ?? "Untitled").slice(0, 200);
  const source = body.source ?? "cli";
  if (!ALLOWED_SOURCES.has(source)) return err("invalid_source", 400);

  // Secret scan first — cheaper than parsing HTML.
  const secrets = scanForSecrets(html);
  if (secrets.length > 0) {
    return err("secrets_detected", 400, {
      matches: secrets.map(s => ({ pattern: s.name, excerpt: s.excerpt })),
      hint: "Remove the secrets, then retry.",
    });
  }

  const sanitized = sanitizeOrReject(html);
  if (!sanitized.ok) {
    return err("html_violations", 400, {
      violations: sanitized.violations,
      hint: "Only inline SVG, base64 images (data:image/*), and HTTPS links are allowed. Strip <script>, <iframe>, on* handlers.",
    });
  }

  return {
    kind: "ok",
    staged: { html: sanitized.html, title, source },
    warnings: [{ kind: "size", bytes: sanitized.html.length }],
  };
}

function err(code: string, status: number, extra: Record<string, unknown> = {}): { kind: "error"; response: Response } {
  return { kind: "error", response: jsonResp({ error: code, ...extra }, status) };
}

// ---------------------------------------------------------------------------
// Prep-staging: 5-minute KV holdover for the prepare → publish dance.
// ---------------------------------------------------------------------------

async function stagePrep(env: Env, staged: StagedPrep): Promise<string> {
  const token = await randomToken(24);
  await env.STATE.put(`prep:${token}`, JSON.stringify(staged), { expirationTtl: 300 });
  return token;
}

async function redeemPrep(env: Env, token: string): Promise<StagedPrep | null> {
  const raw = await env.STATE.get(`prep:${token}`);
  if (!raw) return null;
  await env.STATE.delete(`prep:${token}`);
  try {
    return JSON.parse(raw) as StagedPrep;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Utilities.
// ---------------------------------------------------------------------------

function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? "0.0.0.0";
}

async function parseJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

function jsonResp(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function sha256Hex(input: string, prefixChars = 64): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const hex = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, prefixChars);
}

async function randomToken(bytes: number): Promise<string> {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, "0")).join("");
}

async function isReadOnly(env: Env): Promise<boolean> {
  return (await env.STATE.get("admin:read_only")) === "1";
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// MCP server (Streamable HTTP transport) for share-insights.
//
// Exposes two tools so users see two consent moments before anything is
// published:
//
//   prepare_insights(html, title?)        → preview_token, warnings, size_bytes
//   publish_insights(preview_token)       → url, hash
//
// Internally forwards to the main share-insights API Worker. This server is
// the integration surface; the API Worker is the engine.
//
// Transport: JSON-RPC 2.0 over POST. Stateless (no Mcp-Session-Id required —
// tools return immediately, no streaming needed).

export interface Env {
  API_BASE_URL: string;
  API: Fetcher;
}

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

const TOOLS = [
  {
    name: "prepare_insights",
    description:
      "Dry-run: scan an HTML page for secrets and disallowed elements WITHOUT publishing it, " +
      "then stage it server-side for 5 minutes. Returns a preview_token plus warnings. " +
      "ALWAYS call this first, surface the warnings to the user verbatim, and ASK for explicit " +
      "consent (\"publish? yes/no\") before calling publish_insights. The user must see what's about " +
      "to go live on a public URL — secrets, customer names, internal paths can leak otherwise.",
    inputSchema: {
      type: "object",
      properties: {
        html: {
          type: "string",
          description:
            "A complete self-contained HTML document. Embed images as data:image/* URIs. " +
            "Use inline SVG for diagrams. No <script>, <iframe>, external CSS, on* handlers — " +
            "the server will reject otherwise.",
        },
        title: {
          type: "string",
          description: "Page title (defaults to <title> tag content).",
        },
      },
      required: ["html"],
    },
  },
  {
    name: "publish_insights",
    description:
      "Commit a previously prepared page to a public URL. Only call this AFTER the user " +
      "has reviewed the prepare_insights output and explicitly said yes. The preview_token " +
      "expires after 5 minutes — if it expired, call prepare_insights again.",
    inputSchema: {
      type: "object",
      properties: {
        preview_token: {
          type: "string",
          description: "The preview_token returned by prepare_insights.",
        },
      },
      required: ["preview_token"],
    },
  },
] as const;

const SERVER_INFO = {
  name: "share-insights",
  version: "0.1.0",
};

const PROTOCOL_VERSION = "2024-11-05";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // CORS preflight — Claude.ai and Cursor will OPTIONS us first.
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Health / discovery probe.
    if (req.method === "GET" && url.pathname === "/") {
      return new Response(JSON.stringify({
        name: SERVER_INFO.name,
        version: SERVER_INFO.version,
        transport: "streamable-http",
        endpoint: `${url.origin}/mcp`,
      }, null, 2), {
        headers: { "content-type": "application/json", ...corsHeaders() },
      });
    }

    // Some clients hit /sse expecting old-style SSE — point them at /mcp.
    if (url.pathname === "/sse") {
      return new Response(JSON.stringify({
        error: "use_streamable_http",
        endpoint: `${url.origin}/mcp`,
      }), { status: 410, headers: { "content-type": "application/json", ...corsHeaders() } });
    }

    if (req.method !== "POST" || url.pathname !== "/mcp") {
      return new Response("Not found", { status: 404, headers: corsHeaders() });
    }

    let body: JsonRpcRequest;
    try {
      body = await req.json<JsonRpcRequest>();
    } catch {
      return jsonRpcError(null, -32700, "Parse error");
    }

    if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
      return jsonRpcError(body.id ?? null, -32600, "Invalid Request");
    }

    const id = body.id ?? null;

    switch (body.method) {
      case "initialize":
        return jsonRpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          serverInfo: SERVER_INFO,
          capabilities: { tools: {} },
        });

      case "notifications/initialized":
        // Notifications have no id and expect no response.
        return new Response(null, { status: 204, headers: corsHeaders() });

      case "tools/list":
        return jsonRpcResult(id, { tools: TOOLS });

      case "tools/call":
        return await handleToolCall(id, body.params ?? {}, env);

      case "ping":
        return jsonRpcResult(id, {});

      default:
        return jsonRpcError(id, -32601, `Method not found: ${body.method}`);
    }
  },
} satisfies ExportedHandler<Env>;

async function handleToolCall(
  id: number | string | null,
  params: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const name = params.name as string | undefined;
  const args = (params.arguments ?? {}) as Record<string, unknown>;

  if (name === "prepare_insights") {
    const html = args.html;
    const title = args.title;
    if (typeof html !== "string") {
      return jsonRpcResult(id, toolError("html is required and must be a string"));
    }
    const resp = await env.API.fetch(`${env.API_BASE_URL}/api/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ html, title, source: "mcp" }),
    });
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return jsonRpcResult(id, toolError(formatApiError(payload, resp.status)));
    }
    const summary = formatPrepareSummary(payload);
    return jsonRpcResult(id, toolText(summary));
  }

  if (name === "publish_insights") {
    const token = args.preview_token;
    if (typeof token !== "string") {
      return jsonRpcResult(id, toolError("preview_token is required and must be a string"));
    }
    const resp = await env.API.fetch(`${env.API_BASE_URL}/api/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preview_token: token, source: "mcp" }),
    });
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return jsonRpcResult(id, toolError(formatApiError(payload, resp.status)));
    }
    const url = (payload as { url?: string }).url ?? "(no url returned)";
    return jsonRpcResult(id, toolText(`Published: ${url}\n\nThis page is unlisted, noindexed, and auto-deletes after 90 days of no views. Anyone with the URL can read it. Use the "Report this page" footer link to take it down sooner.`));
  }

  return jsonRpcResult(id, toolError(`Unknown tool: ${name}`));
}

// ---------------------------------------------------------------------------
// Formatting helpers — turn API responses into model-readable text content.
// ---------------------------------------------------------------------------

function formatPrepareSummary(payload: unknown): string {
  const p = payload as { preview_token?: string; warnings?: unknown[]; size_bytes?: number };
  const lines: string[] = [];
  lines.push("HTML prepared for publish. Show this to the user and ASK for explicit consent before calling publish_insights.\n");
  if (typeof p.size_bytes === "number") {
    lines.push(`Size: ${(p.size_bytes / 1024).toFixed(1)} KB`);
  }
  lines.push("");
  lines.push("Server checks that passed:");
  lines.push("  - Secret regex scan");
  lines.push("  - HTML allowlist sanitizer (no <script>, no external resources)");
  lines.push("");
  lines.push("REMINDER FOR THE USER:");
  lines.push("  - The page will be public to anyone with the URL.");
  lines.push("  - It is not indexed by search engines.");
  lines.push("  - It auto-deletes 90 days after the last view.");
  lines.push("");
  lines.push(`preview_token (valid 5 min): ${p.preview_token ?? "(missing)"}`);
  return lines.join("\n");
}

function formatApiError(payload: unknown, status: number): string {
  const p = payload as {
    error?: string;
    matches?: { pattern: string; excerpt: string }[];
    violations?: { kind: string; name?: string; on?: string; scheme?: string; mediaType?: string }[];
    hint?: string;
    size_bytes?: number;
    limit?: number;
    window?: string;
  };
  const code = p.error ?? `http_${status}`;
  const lines = [`Error: ${code}`];
  if (p.matches?.length) {
    lines.push("Matched secret patterns (must remove before retrying):");
    for (const m of p.matches.slice(0, 20)) lines.push(`  - ${m.pattern}: ${m.excerpt}`);
  }
  if (p.violations?.length) {
    lines.push("HTML allowlist violations:");
    for (const v of p.violations.slice(0, 20)) {
      if (v.kind === "element") lines.push(`  - element <${v.name}>`);
      else if (v.kind === "attribute") lines.push(`  - attribute ${v.name} on <${v.on}>`);
      else if (v.kind === "url-scheme") lines.push(`  - ${v.name ?? "attr"} scheme '${v.scheme}' on <${v.on}>`);
      else if (v.kind === "data-uri-type") lines.push(`  - bad data URI type '${v.mediaType}' on <${v.on}>`);
      else lines.push(`  - ${v.kind}`);
    }
  }
  if (p.size_bytes && p.limit) {
    lines.push(`Size ${(p.size_bytes / 1024).toFixed(1)} KB exceeds limit ${(p.limit / 1024 / 1024).toFixed(1)} MB.`);
  }
  if (p.window) lines.push(`Rate-limit window: ${p.window}`);
  if (p.hint) lines.push(`Hint: ${p.hint}`);
  return lines.join("\n");
}

function toolText(text: string): unknown {
  return { content: [{ type: "text", text }], isError: false };
}

function toolError(text: string): unknown {
  return { content: [{ type: "text", text }], isError: true };
}

// ---------------------------------------------------------------------------
// JSON-RPC plumbing.
// ---------------------------------------------------------------------------

function jsonRpcResult(id: number | string | null, result: unknown): Response {
  const resp: JsonRpcResponse = { jsonrpc: "2.0", id, result };
  return new Response(JSON.stringify(resp), {
    headers: { "content-type": "application/json", ...corsHeaders() },
  });
}

function jsonRpcError(id: number | string | null, code: number, message: string): Response {
  const resp: JsonRpcResponse = { jsonrpc: "2.0", id, error: { code, message } };
  return new Response(JSON.stringify(resp), {
    status: 200, // JSON-RPC errors still 200 at HTTP layer
    headers: { "content-type": "application/json", ...corsHeaders() },
  });
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, mcp-session-id, authorization",
    "access-control-max-age": "86400",
  };
}

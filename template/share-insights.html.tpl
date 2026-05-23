<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <meta name="generator" content="share-insights">
  <title>{{TITLE}}</title>
  <style>
    :root {
      --bg: #fafaf9;
      --bg-elev: #ffffff;
      --fg: #0a0a0a;
      --fg-soft: #3f3f46;
      --muted: #71717a;
      --rule: #e4e4e7;
      --code-bg: #f4f4f5;
      --code-fg: #18181b;
      --hi-1: #7c3aed;
      --hi-2: #ec4899;
      --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
      --shadow-md: 0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.05);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #09090b;
        --bg-elev: #18181b;
        --fg: #fafafa;
        --fg-soft: #d4d4d8;
        --muted: #a1a1aa;
        --rule: #27272a;
        --code-bg: #18181b;
        --code-fg: #f4f4f5;
        --hi-1: #a78bfa;
        --hi-2: #f472b6;
        --shadow-sm: 0 1px 2px rgba(0,0,0,0.5);
        --shadow-md: 0 1px 2px rgba(0,0,0,0.5), 0 4px 20px rgba(0,0,0,0.3);
      }
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); }
    body {
      font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    /* Fixed gradient hairline at the top */
    .topbar {
      position: fixed; top: 0; left: 0; right: 0;
      height: 3px;
      background: linear-gradient(90deg, var(--hi-1) 0%, var(--hi-2) 100%);
      z-index: 10;
    }

    /* Page shell — generous max-width, grid on desktop */
    .page {
      max-width: 1200px;
      margin: 0 auto;
      padding: 48px 32px 96px;
      display: grid;
      grid-template-columns: 1fr;
      gap: 0;
    }
    @media (min-width: 960px) {
      .page {
        grid-template-columns: 240px minmax(0, 1fr);
        gap: 64px;
        padding: 64px 48px 120px;
      }
    }
    @media (min-width: 1280px) {
      .page { padding-left: 64px; padding-right: 64px; }
    }

    /* Sidebar */
    aside.rail {
      position: relative;
    }
    @media (min-width: 960px) {
      aside.rail {
        position: sticky;
        top: 48px;
        align-self: start;
        height: max-content;
      }
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--muted);
      font-size: 12.5px;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      text-decoration: none;
      padding: 6px 12px 6px 8px;
      border-radius: 999px;
      background: var(--bg-elev);
      border: 1px solid var(--rule);
      box-shadow: var(--shadow-sm);
      transition: border-color 0.15s, transform 0.15s;
      margin-bottom: 24px;
    }
    .brand:hover {
      border-color: color-mix(in oklab, var(--hi-1) 30%, var(--rule));
      transform: translateY(-1px);
    }
    .brand svg { flex-shrink: 0; }

    .meta-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 24px;
    }
    .meta-list .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--muted);
      background: var(--bg-elev);
      border: 1px solid var(--rule);
      padding: 4px 11px 4px 9px;
      border-radius: 999px;
    }
    .meta-list .chip::before {
      content: "";
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--muted);
    }
    .meta-list .chip.source {
      color: var(--fg);
      border-color: color-mix(in oklab, var(--hi-1) 35%, var(--rule));
      background: linear-gradient(90deg, color-mix(in oklab, var(--hi-1) 10%, var(--bg-elev)), color-mix(in oklab, var(--hi-2) 8%, var(--bg-elev)));
    }
    .meta-list .chip.source::before {
      background: linear-gradient(135deg, var(--hi-1), var(--hi-2));
      box-shadow: 0 0 6px color-mix(in oklab, var(--hi-1) 50%, transparent);
    }

    nav.toc { display: none; }
    @media (min-width: 960px) {
      nav.toc {
        display: block;
        border-top: 1px solid var(--rule);
        padding-top: 18px;
      }
      nav.toc .toc-label {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
        margin-bottom: 10px;
      }
      nav.toc ul {
        list-style: none;
        padding: 0;
        margin: 0;
      }
      nav.toc li { margin: 0; }
      nav.toc a {
        display: block;
        font-size: 13.5px;
        color: var(--fg-soft);
        padding: 6px 10px;
        border-radius: 6px;
        text-decoration: none;
        border: 1px solid transparent;
        margin-bottom: 1px;
        transition: background 0.12s, color 0.12s;
      }
      nav.toc a:hover {
        color: var(--fg);
        background: var(--bg-elev);
        border-color: var(--rule);
      }
    }

    /* Main column */
    main.content { min-width: 0; max-width: 760px; }

    header.hero { padding: 0 0 32px; }
    header.hero h1 {
      font-size: 44px;
      line-height: 1.08;
      letter-spacing: -0.025em;
      font-weight: 700;
      margin: 0 0 14px;
      color: var(--fg);
    }
    @media (max-width: 640px) { header.hero h1 { font-size: 32px; } }
    header.hero .lede {
      color: var(--muted);
      font-size: 15px;
      max-width: 60ch;
      margin: 0;
    }

    section {
      padding: 36px 0 8px;
      border-top: 1px solid var(--rule);
      scroll-margin-top: 32px;
    }
    section:first-of-type { border-top: none; padding-top: 16px; }
    section > h2 {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 22px;
      font-weight: 600;
      letter-spacing: -0.01em;
      margin: 0 0 16px;
      color: var(--fg);
    }
    section > h2 .icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px; height: 30px;
      border-radius: 9px;
      background: linear-gradient(135deg, color-mix(in oklab, var(--hi-1) 20%, transparent), color-mix(in oklab, var(--hi-2) 20%, transparent));
      color: var(--hi-1);
      border: 1px solid color-mix(in oklab, var(--hi-1) 18%, var(--rule));
      flex-shrink: 0;
    }
    section > h2 .icon svg { width: 16px; height: 16px; stroke: currentColor; stroke-width: 2; fill: none; stroke-linecap: round; stroke-linejoin: round; }

    h3 { font-size: 15px; font-weight: 600; margin: 28px 0 8px; color: var(--fg); }
    p, ul, ol { margin: 12px 0; color: var(--fg-soft); }
    p strong, li strong { color: var(--fg); }

    a { color: var(--hi-1); text-decoration: none; border-bottom: 1px solid color-mix(in oklab, var(--hi-1) 35%, transparent); transition: border-color 0.15s; }
    a:hover { border-bottom-color: var(--hi-1); }

    ul, ol { padding-left: 22px; }
    li { margin: 6px 0; }
    li::marker { color: var(--hi-1); }

    blockquote {
      margin: 18px 0;
      padding: 14px 20px;
      border-left: 3px solid var(--hi-1);
      background: color-mix(in oklab, var(--hi-1) 5%, transparent);
      color: var(--fg-soft);
      border-radius: 0 8px 8px 0;
    }
    blockquote p:first-child { margin-top: 0; }
    blockquote p:last-child { margin-bottom: 0; }

    code {
      font-family: ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace;
      font-size: 13.5px;
      background: var(--code-bg);
      color: var(--code-fg);
      padding: 1.5px 6px;
      border-radius: 4px;
      border: 1px solid var(--rule);
    }
    pre {
      position: relative;
      background: var(--code-bg);
      color: var(--code-fg);
      padding: 20px;
      margin: 18px 0;
      border-radius: 10px;
      border: 1px solid var(--rule);
      overflow-x: auto;
      font-size: 13px;
      line-height: 1.6;
      box-shadow: var(--shadow-md);
    }
    pre::before {
      content: "";
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 2px;
      background: linear-gradient(90deg, var(--hi-1), var(--hi-2));
      border-radius: 10px 10px 0 0;
    }
    pre code { background: transparent; padding: 0; border: none; font-size: inherit; }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      font-size: 14.5px;
      border: 1px solid var(--rule);
      border-radius: 10px;
      overflow: hidden;
      background: var(--bg-elev);
    }
    th, td { border-bottom: 1px solid var(--rule); padding: 10px 14px; text-align: left; }
    th { background: var(--code-bg); font-weight: 600; color: var(--fg); font-size: 12.5px; text-transform: uppercase; letter-spacing: 0.04em; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: color-mix(in oklab, var(--hi-1) 3%, transparent); }

    img, figure svg {
      max-width: 100%; height: auto;
      display: block;
      margin: 18px auto;
      border-radius: 10px;
      box-shadow: var(--shadow-md);
    }
    figcaption { color: var(--muted); font-size: 13px; text-align: center; margin-top: 6px; }
    hr { border: none; border-top: 1px solid var(--rule); margin: 32px 0; }

    section#redactions > h2 .icon {
      background: color-mix(in oklab, var(--muted) 15%, transparent);
      color: var(--muted);
      border-color: var(--rule);
    }
    section#redactions ul { font-size: 14px; color: var(--muted); }

    footer.footer {
      grid-column: 1 / -1;
      margin-top: 56px;
      padding: 24px 0 0;
      border-top: 1px solid var(--rule);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      color: var(--muted);
      font-size: 13px;
    }
    footer.footer .left { display: inline-flex; align-items: center; gap: 8px; }
    footer.footer a { color: var(--muted); border-bottom-color: transparent; }
    footer.footer a:hover { color: var(--fg-soft); border-bottom-color: var(--rule); }
  </style>
</head>
<body>

  <div class="topbar" aria-hidden="true"></div>

  <div class="page">

    <aside class="rail">
      <a href="https://share-insights.pages.dev/" class="brand">
        <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden="true">
          <defs>
            <linearGradient id="lm1" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#7c3aed"/>
              <stop offset="100%" stop-color="#5b21b6"/>
            </linearGradient>
            <linearGradient id="lm2" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#ec4899"/>
              <stop offset="100%" stop-color="#be185d"/>
            </linearGradient>
          </defs>
          <rect x="3" y="3" width="17" height="17" rx="4" fill="url(#lm1)"/>
          <rect x="12" y="12" width="17" height="17" rx="4" fill="url(#lm2)" opacity="0.9"/>
        </svg>
        <span>share-insights</span>
      </a>

      <div class="meta-list">
        <span class="chip source">{{SOURCE}}</span>
        <span class="chip">{{CREATED_AT}}</span>
      </div>

      <nav class="toc" aria-label="On this page">
        <div class="toc-label">On this page</div>
        <ul>
          <li><a href="#tldr">TL;DR</a></li>
          <li><a href="#decisions">Decisions</a></li>
          <li><a href="#findings">Findings</a></li>
          <li><a href="#code">Code &amp; diffs</a></li>
          <li><a href="#open-questions">Open questions</a></li>
          <li><a href="#next-steps">Next steps</a></li>
          <li><a href="#redactions">Redactions</a></li>
        </ul>
      </nav>
    </aside>

    <main class="content">
      <header class="hero">
        <h1>{{TITLE}}</h1>
        <p class="lede">An AI-generated session summary. Unindexed. Auto-deletes 90 days after the last view.</p>
      </header>

      <section id="tldr">
        <h2>
          <span class="icon"><svg viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/></svg></span>
          TL;DR
        </h2>
        {{TLDR}}
      </section>

      <section id="decisions">
        <h2>
          <span class="icon"><svg viewBox="0 0 24 24"><path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></span>
          Decisions
        </h2>
        {{DECISIONS}}
      </section>

      <section id="findings">
        <h2>
          <span class="icon"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></span>
          Findings
        </h2>
        {{FINDINGS}}
      </section>

      <section id="code">
        <h2>
          <span class="icon"><svg viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></span>
          Code &amp; diffs
        </h2>
        {{CODE}}
      </section>

      <section id="open-questions">
        <h2>
          <span class="icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg></span>
          Open questions
        </h2>
        {{OPEN_QUESTIONS}}
      </section>

      <section id="next-steps">
        <h2>
          <span class="icon"><svg viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></span>
          Next steps
        </h2>
        {{NEXT_STEPS}}
      </section>

      <section id="redactions">
        <h2>
          <span class="icon"><svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>
          Redactions
        </h2>
        <p>The following were removed before publishing:</p>
        {{REDACTIONS}}
      </section>
    </main>

    <footer class="footer">
      <span class="left">
        <svg width="14" height="14" viewBox="0 0 32 32" aria-hidden="true">
          <defs>
            <linearGradient id="fm1" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#7c3aed"/>
              <stop offset="100%" stop-color="#5b21b6"/>
            </linearGradient>
            <linearGradient id="fm2" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#ec4899"/>
              <stop offset="100%" stop-color="#be185d"/>
            </linearGradient>
          </defs>
          <rect x="3" y="3" width="17" height="17" rx="4" fill="url(#fm1)"/>
          <rect x="12" y="12" width="17" height="17" rx="4" fill="url(#fm2)" opacity="0.9"/>
        </svg>
        Published with <a href="https://share-insights.pages.dev/">share-insights</a>
      </span>
      <a href="https://share-insights.pages.dev/abuse?url={{REPORT_URL}}">Report this page</a>
    </footer>

  </div>
</body>
</html>

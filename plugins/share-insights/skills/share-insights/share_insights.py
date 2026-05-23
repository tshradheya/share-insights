"""Publish an HTML page to share-insights.

Reads an HTML file, scans it locally for secret patterns, uploads to the
share-insights API, prints the shareable URL, and appends a JSONL record to
~/.share-insights/ledger.jsonl so the URL stays findable later.

UX inspired by an internal HTML-publishing skill — same single-file CLI shape
and JSONL ledger, redone for an anonymous public endpoint (no JWT, no auth).

Usage:
  python share_insights.py <file.html>
  python share_insights.py --title "Refactor session" --source claude-code <file.html>
  python share_insights.py --compress <file.html>            # compress embedded images
  python share_insights.py --base-url http://localhost:8787 <file.html>

Environment:
  SHARE_INSIGHTS_URL   overrides the API base URL (default: production)
"""

import argparse
import base64
import datetime
import io
import json
import os
import re
import sys
import urllib.error
import urllib.request

DEFAULT_BASE_URL = "https://share-insights.pages.dev"
MAX_HTML_SIZE = 10 * 1024 * 1024  # 10 MiB, matches Worker MAX_HTML_BYTES
MAX_WIDTH = 1440
JPEG_QUALITY = 50

LEDGER_DIR = os.path.expanduser("~/.share-insights")
LEDGER_PATH = os.path.join(LEDGER_DIR, "ledger.jsonl")

BASE64_IMAGE_RE = re.compile(r"data:image/([^;]+);base64,([A-Za-z0-9+/=\s]+)")
TITLE_RE = re.compile(r"<title[^>]*>([^<]*)</title>", re.IGNORECASE | re.DOTALL)

# Mirror of worker/src/secrets.ts. Keep in sync manually for v1.
SECRET_PATTERNS = [
    ("AWS_ACCESS_KEY_ID", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("GITHUB_PAT", re.compile(r"\bghp_[A-Za-z0-9]{36,}\b")),
    ("GITHUB_FINE_GRAINED_PAT", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b")),
    ("GITHUB_OAUTH", re.compile(r"\bgho_[A-Za-z0-9]{36,}\b")),
    ("GITHUB_APP_TOKEN", re.compile(r"\b(ghu|ghs)_[A-Za-z0-9]{36,}\b")),
    ("STRIPE_LIVE", re.compile(r"\bsk_live_[A-Za-z0-9]{20,}\b")),
    ("STRIPE_RESTRICTED", re.compile(r"\brk_live_[A-Za-z0-9]{20,}\b")),
    ("OPENAI_KEY", re.compile(r"\bsk-[A-Za-z0-9_-]{32,}\b")),
    ("ANTHROPIC_KEY", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{32,}\b")),
    ("GOOGLE_API_KEY", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("SLACK_TOKEN", re.compile(r"\bxox[abpsr]-[A-Za-z0-9-]{10,}\b")),
    ("JWT", re.compile(r"\beyJ[A-Za-z0-9_=-]+\.eyJ[A-Za-z0-9_=-]+\.[A-Za-z0-9_.+/=-]+\b")),
    ("PRIVATE_KEY_BLOCK", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("PASSWORD_KV", re.compile(r"\b(password|passwd|pwd)\s*[:=]\s*[\"']?[^\s\"']{6,}", re.IGNORECASE)),
]


def fmt_size(nbytes: int) -> str:
    if nbytes >= 1024 * 1024:
        return f"{nbytes / (1024 * 1024):.1f} MB"
    if nbytes >= 1024:
        return f"{nbytes / 1024:.1f} KB"
    return f"{nbytes} B"


def extract_title(html: str) -> str | None:
    m = TITLE_RE.search(html)
    if not m:
        return None
    title = " ".join(m.group(1).split())
    return title or None


def derive_title(flag: str | None, html: str, file_path: str) -> str:
    if flag and flag.strip():
        return flag.strip()
    return extract_title(html) or os.path.basename(file_path)


def scan_for_secrets(text: str) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    for name, pat in SECRET_PATTERNS:
        for m in pat.finditer(text):
            excerpt = m.group(0)[:24] + ("…" if len(m.group(0)) > 24 else "")
            found.append((name, excerpt))
            if len(found) >= 25:
                return found
    return found


def compress_images(html: str) -> str:
    try:
        from PIL import Image
    except ImportError:
        print("Warning: Pillow not available, skipping image compression.", file=sys.stderr)
        print("Install with: pip install Pillow", file=sys.stderr)
        return html

    count = 0

    def _replace(match: re.Match[str]) -> str:
        nonlocal count
        original_b64 = match.group(2)
        try:
            raw = base64.b64decode(original_b64)
            img = Image.open(io.BytesIO(raw))
            if img.width > MAX_WIDTH:
                ratio = MAX_WIDTH / img.width
                img = img.resize((MAX_WIDTH, int(img.height * ratio)), Image.Resampling.LANCZOS)
            has_alpha = img.mode in ("RGBA", "LA", "PA") or (
                img.mode == "P" and "transparency" in img.info
            )
            buf = io.BytesIO()
            if has_alpha:
                if img.mode != "RGBA":
                    img = img.convert("RGBA")
                quantized = img.quantize(colors=256, method=Image.Quantize.FASTOCTREE)
                quantized.save(buf, format="PNG", optimize=True)
                fmt = "png"
            else:
                if img.mode != "RGB":
                    img = img.convert("RGB")
                img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
                fmt = "jpeg"
            new_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
            count += 1
            return f"data:image/{fmt};base64,{new_b64}"
        except Exception as e:
            print(f"Warning: failed to compress an image: {e}", file=sys.stderr)
            return match.group(0)

    out = BASE64_IMAGE_RE.sub(_replace, html)
    if count > 0:
        print(f"Compressed {count} embedded image(s).")
    return out


def append_ledger(record: dict) -> None:
    try:
        os.makedirs(LEDGER_DIR, exist_ok=True)
        with open(LEDGER_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError as e:
        print(f"Warning: could not write ledger entry to {LEDGER_PATH}: {e}", file=sys.stderr)


def post_json(url: str, body: dict) -> tuple[int, dict]:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "content-type": "application/json",
            "user-agent": "share-insights-cli/0.1 (+https://share-insights.pages.dev)",
            "accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read().decode("utf-8"))
        except Exception:
            payload = {"error": f"http_{e.code}"}
        return e.code, payload
    except urllib.error.URLError as e:
        print(f"Error: could not connect to {url}: {e.reason}", file=sys.stderr)
        sys.exit(1)


def render_violations(payload: dict) -> str:
    parts: list[str] = []
    if "violations" in payload:
        for v in payload["violations"][:20]:
            if v.get("kind") == "element":
                parts.append(f"  - element <{v['name']}>")
            elif v.get("kind") == "attribute":
                parts.append(f"  - attribute {v['name']} on <{v['on']}>")
            elif v.get("kind") == "url-scheme":
                parts.append(f"  - {v['attr']} scheme '{v['scheme']}' on <{v['on']}>")
            elif v.get("kind") == "data-uri-type":
                parts.append(f"  - {v['attr']} media type '{v['mediaType']}' on <{v['on']}>")
            elif v.get("kind") == "css-expression":
                parts.append(f"  - CSS expression() / javascript: on <{v['on']}>")
    if "matches" in payload:
        for m in payload["matches"][:20]:
            parts.append(f"  - {m['pattern']}: {m['excerpt']}")
    return "\n".join(parts)


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish HTML to share-insights.")
    parser.add_argument("file", help="Path to HTML file")
    parser.add_argument("--title", help="Page title (default: <title> tag or filename)")
    parser.add_argument("--source", default="cli",
                        choices=["cli", "claude-code", "codex", "mcp", "chatgpt-gpt", "web"],
                        help="Which surface invoked this upload")
    parser.add_argument("--compress", action="store_true",
                        help="Compress embedded base64 images if over size limit")
    parser.add_argument("--base-url", default=os.environ.get("SHARE_INSIGHTS_URL", DEFAULT_BASE_URL),
                        help="API base URL (default: production or SHARE_INSIGHTS_URL env var)")
    parser.add_argument("--allow-secrets", action="store_true",
                        help="Skip the local secret scanner (server still enforces it)")
    args = parser.parse_args()

    file_path = os.path.expanduser(args.file)
    if not os.path.isfile(file_path):
        print(f"Error: file not found: {file_path}", file=sys.stderr)
        sys.exit(1)

    with open(file_path, encoding="utf-8") as f:
        html = f.read()
    original_size = len(html.encode("utf-8"))
    print(f"Read: {file_path} ({fmt_size(original_size)})")

    upload_html = html
    if original_size > MAX_HTML_SIZE:
        images = BASE64_IMAGE_RE.findall(html)
        if args.compress and images:
            print(f"File exceeds {fmt_size(MAX_HTML_SIZE)}; compressing images...")
            upload_html = compress_images(html)
            new_size = len(upload_html.encode("utf-8"))
            print(f"After compression: {fmt_size(new_size)}")
            if new_size > MAX_HTML_SIZE:
                print(f"Error: still {fmt_size(new_size)} after compression "
                      f"(limit {fmt_size(MAX_HTML_SIZE)}).", file=sys.stderr)
                sys.exit(1)
        else:
            print(f"Error: file is {fmt_size(original_size)}, limit is {fmt_size(MAX_HTML_SIZE)}.",
                  file=sys.stderr)
            if images:
                print("Hint: re-run with --compress to attempt image compression.",
                      file=sys.stderr)
            sys.exit(1)

    if not args.allow_secrets:
        hits = scan_for_secrets(upload_html)
        if hits:
            print("Error: secret-like patterns detected in HTML. Remove them and retry, "
                  "or pass --allow-secrets to defer to the server scan.", file=sys.stderr)
            for name, excerpt in hits:
                print(f"  - {name}: {excerpt}", file=sys.stderr)
            sys.exit(1)

    title = derive_title(args.title, html, file_path)
    body = {
        "html": upload_html,
        "title": title,
        "source": args.source,
    }
    url = f"{args.base_url.rstrip('/')}/api/publish"
    print(f"Uploading: {fmt_size(len(upload_html.encode('utf-8')))} → {url}")
    status, payload = post_json(url, body)

    if status == 200:
        page_url = payload.get("url", "")
        page_hash = payload.get("hash", "")
        cached = payload.get("cached", False)
        print("\nPublished!")
        print(f"  Hash:   {page_hash}")
        print(f"  Cached: {str(cached).lower()}")
        print(f"  URL:    {page_url}")
        record = {
            "ts": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
            "url": page_url,
            "hash": page_hash,
            "src": file_path,
            "title": title,
            "size_kb": round(len(upload_html.encode("utf-8")) / 1024, 1),
            "source": args.source,
            "cached": bool(cached),
        }
        append_ledger(record)
        print(f"  Logged: {LEDGER_PATH}")
        return

    if status == 400 and payload.get("error") == "secrets_detected":
        print("Error: server detected secret patterns:", file=sys.stderr)
        print(render_violations(payload), file=sys.stderr)
        sys.exit(2)
    if status == 400 and payload.get("error") == "html_violations":
        print("Error: HTML failed sanitizer:", file=sys.stderr)
        print(render_violations(payload), file=sys.stderr)
        print(f"\nHint: {payload.get('hint', '')}", file=sys.stderr)
        sys.exit(2)
    if status == 413:
        print(f"Error: HTML too large: {fmt_size(payload.get('size_bytes', 0))} "
              f"(limit {fmt_size(payload.get('limit', MAX_HTML_SIZE))}).", file=sys.stderr)
        sys.exit(2)
    if status == 429:
        print(f"Error: rate limited ({payload.get('window', '?')}). Try again later.",
              file=sys.stderr)
        if payload.get("error") == "turnstile_required":
            print(f"Solve a challenge at {payload.get('challenge_url')} and retry.",
                  file=sys.stderr)
        sys.exit(3)
    if status == 503:
        print("Error: service is in read-only mode (spend cap or maintenance).",
              file=sys.stderr)
        sys.exit(4)

    print(f"Error: server returned HTTP {status}: {payload}", file=sys.stderr)
    sys.exit(5)


if __name__ == "__main__":
    main()

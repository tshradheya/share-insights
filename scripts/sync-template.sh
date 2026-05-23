#!/usr/bin/env bash
# Stamp template/share-insights.html.tpl into the three places that need it:
#   skill/SKILL.md   (between <!-- TEMPLATE-BEGIN --> markers)
#   chatgpt/instructions.md (same markers)
#   mcp/src/index.ts (only the description text refers to it; no inlining there)
#
# This script is idempotent — re-run it whenever you edit the template.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TPL="$ROOT/template/share-insights.html.tpl"

if [[ ! -f "$TPL" ]]; then
  echo "Template not found: $TPL" >&2
  exit 1
fi

stamp() {
  local target="$1"
  local begin="$2"
  local end="$3"
  if ! grep -q "$begin" "$target"; then
    echo "Marker '$begin' not found in $target — skipping. Add the markers to enable sync." >&2
    return 0
  fi
  python3 - "$target" "$TPL" "$begin" "$end" <<'PY'
import sys, pathlib
target, tpl, begin, end = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
text = pathlib.Path(target).read_text(encoding="utf-8")
template = pathlib.Path(tpl).read_text(encoding="utf-8")
i = text.find(begin)
j = text.find(end, i + len(begin))
if i < 0 or j < 0:
    print(f"Markers missing in {target}", file=sys.stderr); sys.exit(2)
new = text[:i + len(begin)] + "\n```html\n" + template + "\n```\n" + text[j:]
pathlib.Path(target).write_text(new, encoding="utf-8")
print(f"Stamped: {target}")
PY
}

stamp "$ROOT/plugins/share-insights/skills/share-insights/SKILL.md" "<!-- TEMPLATE-BEGIN -->" "<!-- TEMPLATE-END -->"
# Note: chatgpt/instructions.md no longer inlines the template — it's uploaded
# as a Knowledge file alongside the GPT (see chatgpt/PUBLISH.md). If you ever
# want it inlined, add <!-- TEMPLATE-BEGIN --> and <!-- TEMPLATE-END --> markers
# back to chatgpt/instructions.md and a stamp call below.

# Also keep the standalone template file in chatgpt/ in sync (Knowledge upload).
cp "$TPL" "$ROOT/chatgpt/share-insights-template.html"
echo "Synced: $ROOT/chatgpt/share-insights-template.html"

echo "Done. Now re-deploy the MCP worker if its tool descriptions reference template features."

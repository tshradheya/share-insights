// Strict-allowlist HTML sanitizer.
//
// Policy: if anything outside the allowlist is encountered, REJECT the upload
// with a structured list of violations. No silent stripping. The client (CLI /
// MCP / GPT) surfaces these to the user so what they preview is exactly what
// gets published.
//
// Built on parse5 because Workers don't ship a DOM. We walk the tree, check
// every element + attribute + URL scheme, collect violations, and serialize
// back out unchanged on success.

import { parse, serialize } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";

type Document = DefaultTreeAdapterMap["document"];
type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

export type Violation =
  | { kind: "element"; name: string }
  | { kind: "attribute"; name: string; on: string }
  | { kind: "url-scheme"; attr: string; on: string; scheme: string }
  | { kind: "data-uri-type"; attr: string; on: string; mediaType: string }
  | { kind: "css-expression"; on: string };

// All entries lowercase — parse5 normalizes HTML tag names. SVG mixed-case
// names (linearGradient, clipPath) get lowercased too, so include them in
// their lowercase form.
const ALLOWED_ELEMENTS = new Set([
  "html", "head", "body", "meta", "title", "style",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "br", "hr", "strong", "em", "b", "i", "u", "s", "sub", "sup",
  "code", "pre", "blockquote",
  "ul", "ol", "li",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "a", "span", "div",
  "section", "article", "header", "footer", "main", "nav", "aside",
  "figure", "figcaption",
  "img",
  "svg", "g", "path", "rect", "circle", "ellipse", "line",
  "polyline", "polygon", "text", "tspan", "defs", "use", "symbol",
  "lineargradient", "radialgradient", "stop", "desc",
  "marker", "pattern", "clippath", "mask",
  "foreignobject",
  "details", "summary",
]);

const ALLOWED_ATTRS_GLOBAL = new Set([
  "class", "id", "style", "title", "lang", "dir", "role",
  "aria-label", "aria-labelledby", "aria-describedby", "aria-hidden",
]);

const ALLOWED_ATTRS_BY_ELEMENT: Record<string, Set<string>> = {
  a: new Set(["href", "rel", "target"]),
  img: new Set(["src", "alt", "width", "height", "loading"]),
  meta: new Set(["name", "content", "charset", "http-equiv"]),
  // SVG geometry + presentation attrs (all keys lowercase — parse5 lowercases).
  svg: new Set([
    "xmlns", "viewbox", "width", "height", "fill", "stroke", "stroke-width",
    "preserveaspectratio", "xmlns:xlink", "aria-hidden", "role",
  ]),
  g: new Set(["transform", "fill", "stroke", "stroke-width", "opacity"]),
  path: new Set(["d", "fill", "stroke", "stroke-width", "transform", "fill-rule", "clip-rule", "opacity", "stroke-linecap", "stroke-linejoin"]),
  rect: new Set(["x", "y", "width", "height", "rx", "ry", "fill", "stroke", "stroke-width", "transform", "opacity"]),
  circle: new Set(["cx", "cy", "r", "fill", "stroke", "stroke-width", "transform", "opacity"]),
  ellipse: new Set(["cx", "cy", "rx", "ry", "fill", "stroke", "stroke-width", "transform", "opacity"]),
  line: new Set(["x1", "y1", "x2", "y2", "stroke", "stroke-width", "transform", "opacity"]),
  polyline: new Set(["points", "fill", "stroke", "stroke-width", "transform", "opacity"]),
  polygon: new Set(["points", "fill", "stroke", "stroke-width", "transform", "opacity"]),
  text: new Set(["x", "y", "dx", "dy", "text-anchor", "font-size", "font-family", "fill", "stroke", "transform", "opacity"]),
  tspan: new Set(["x", "y", "dx", "dy", "font-size", "fill", "text-anchor"]),
  lineargradient: new Set(["id", "x1", "y1", "x2", "y2", "gradientunits", "gradienttransform"]),
  radialgradient: new Set(["id", "cx", "cy", "r", "fx", "fy", "gradientunits", "gradienttransform"]),
  stop: new Set(["offset", "stop-color", "stop-opacity"]),
  use: new Set(["href", "xlink:href", "x", "y", "width", "height"]),
  symbol: new Set(["id", "viewbox", "width", "height"]),
  marker: new Set(["id", "viewbox", "refx", "refy", "markerwidth", "markerheight", "orient"]),
  pattern: new Set(["id", "viewbox", "x", "y", "width", "height", "patternunits"]),
  clippath: new Set(["id"]),
  mask: new Set(["id"]),
  defs: new Set([]),
  foreignobject: new Set(["x", "y", "width", "height"]),
  desc: new Set([]),
  td: new Set(["colspan", "rowspan", "align"]),
  th: new Set(["colspan", "rowspan", "align", "scope"]),
  col: new Set(["span"]),
  colgroup: new Set(["span"]),
  details: new Set(["open"]),
  ol: new Set(["start", "type"]),
  table: new Set(["border"]),
};

const ALLOWED_HREF_SCHEMES = new Set(["https:", "mailto:", "#"]);
const ALLOWED_DATA_IMAGE_TYPES = new Set([
  "image/png", "image/jpeg", "image/jpg", "image/gif",
  "image/webp", "image/svg+xml",
]);

const CSS_EXPRESSION_RE = /expression\s*\(|javascript:|vbscript:|@import|url\s*\(\s*["']?(?!data:image\/)/i;

export function sanitizeOrReject(html: string): { ok: true; html: string } | { ok: false; violations: Violation[] } {
  const violations: Violation[] = [];
  const doc = parse(html);
  walk(doc as unknown as Node, violations);
  if (violations.length > 0) {
    return { ok: false, violations };
  }
  return { ok: true, html: serialize(doc as Document) };
}

function walk(node: Node, violations: Violation[]): void {
  // Document fragments have childNodes; we don't care about #document itself.
  const children = (node as { childNodes?: Node[] }).childNodes;
  if (!children) return;

  for (const child of children) {
    const tagName = (child as Element).tagName;
    if (tagName) {
      const lc = tagName.toLowerCase();
      if (!ALLOWED_ELEMENTS.has(lc)) {
        violations.push({ kind: "element", name: lc });
        // Don't recurse into a disallowed element — the report is enough.
        continue;
      }
      checkAttrs(child as Element, violations);
    }
    walk(child, violations);
  }
}

function checkAttrs(el: Element, violations: Violation[]): void {
  const tag = el.tagName.toLowerCase();
  for (const attr of el.attrs) {
    const name = attr.name.toLowerCase();
    const value = attr.value;

    // Event handlers are always blocked.
    if (name.startsWith("on")) {
      violations.push({ kind: "attribute", name, on: tag });
      continue;
    }

    // Disallow <meta http-equiv> entirely (CSP/refresh tricks).
    if (tag === "meta" && name === "http-equiv") {
      violations.push({ kind: "attribute", name: "http-equiv", on: "meta" });
      continue;
    }

    const allowedForTag = ALLOWED_ATTRS_BY_ELEMENT[tag];
    const isGlobal = ALLOWED_ATTRS_GLOBAL.has(name);
    const isTagSpecific = allowedForTag?.has(name) ?? false;

    if (!isGlobal && !isTagSpecific) {
      violations.push({ kind: "attribute", name, on: tag });
      continue;
    }

    // URL-bearing attributes get scheme-checked.
    if (name === "href" || name === "src" || name === "xlink:href") {
      const v = value.trim();
      if (v === "" || v.startsWith("#")) continue;
      let scheme: string;
      if (v.startsWith("data:")) {
        scheme = "data:";
        if (name !== "src") {
          violations.push({ kind: "url-scheme", attr: name, on: tag, scheme });
          continue;
        }
        const mediaMatch = v.match(/^data:([^;,]+)/);
        const mediaType = mediaMatch ? mediaMatch[1].toLowerCase() : "";
        if (!ALLOWED_DATA_IMAGE_TYPES.has(mediaType)) {
          violations.push({ kind: "data-uri-type", attr: name, on: tag, mediaType });
        }
        continue;
      }
      try {
        const u = new URL(v, "https://example.invalid");
        // Construction succeeded — check scheme.
        if (!ALLOWED_HREF_SCHEMES.has(u.protocol)) {
          violations.push({ kind: "url-scheme", attr: name, on: tag, scheme: u.protocol });
        }
      } catch {
        violations.push({ kind: "url-scheme", attr: name, on: tag, scheme: "invalid" });
      }
      continue;
    }

    // Inline style: block expression(), javascript:, @import, and url() that
    // isn't a data:image/.
    if (name === "style" && CSS_EXPRESSION_RE.test(value)) {
      violations.push({ kind: "css-expression", on: tag });
    }
  }
}

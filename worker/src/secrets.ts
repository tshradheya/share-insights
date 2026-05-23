// Shared secret-scanner regex list. Keep in sync with cli/share_insights.py
// (the Python side hand-mirrors these patterns). Patterns are intentionally
// conservative — false positives are easier to fix (user revises) than false
// negatives (credentials leak to a public URL).

export type SecretPattern = {
  name: string;
  pattern: RegExp;
};

export const SECRET_PATTERNS: SecretPattern[] = [
  { name: "AWS_ACCESS_KEY_ID", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "AWS_SECRET_KEY", pattern: /\b[A-Za-z0-9/+=]{40}\b(?=\s*[\"',])/g },
  { name: "GITHUB_PAT", pattern: /\bghp_[A-Za-z0-9]{36,}\b/g },
  { name: "GITHUB_FINE_GRAINED_PAT", pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { name: "GITHUB_OAUTH", pattern: /\bgho_[A-Za-z0-9]{36,}\b/g },
  { name: "GITHUB_APP_TOKEN", pattern: /\b(ghu|ghs)_[A-Za-z0-9]{36,}\b/g },
  { name: "STRIPE_LIVE", pattern: /\bsk_live_[A-Za-z0-9]{20,}\b/g },
  { name: "STRIPE_RESTRICTED", pattern: /\brk_live_[A-Za-z0-9]{20,}\b/g },
  { name: "OPENAI_KEY", pattern: /\bsk-[A-Za-z0-9_-]{32,}\b/g },
  { name: "ANTHROPIC_KEY", pattern: /\bsk-ant-[A-Za-z0-9_-]{32,}\b/g },
  { name: "GOOGLE_API_KEY", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "SLACK_TOKEN", pattern: /\bxox[abpsr]-[A-Za-z0-9-]{10,}\b/g },
  { name: "JWT", pattern: /\beyJ[A-Za-z0-9_=-]+\.eyJ[A-Za-z0-9_=-]+\.[A-Za-z0-9_.+/=-]+\b/g },
  { name: "PRIVATE_KEY_BLOCK", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: "PASSWORD_KV", pattern: /\b(password|passwd|pwd)\s*[:=]\s*[\"']?[^\s\"']{6,}/gi },
];

export type SecretMatch = {
  name: string;
  excerpt: string;
};

export function scanForSecrets(text: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const { name, pattern } of SECRET_PATTERNS) {
    // Make a fresh RegExp so global state is fine across calls.
    const re = new RegExp(pattern.source, pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      matches.push({
        name,
        excerpt: m[0].slice(0, 24) + (m[0].length > 24 ? "…" : ""),
      });
      if (matches.length >= 25) return matches; // cap noise
    }
  }
  return matches;
}

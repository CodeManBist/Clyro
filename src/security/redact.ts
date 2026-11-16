
const REDACTED = "[REDACTED]";

const SECRET_PATTERNS: RegExp[] = [
  // Google API keys
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,

  // AWS access key IDs
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,

  // GitHub tokens
  /\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]+\b/g,

  // Authorization bearer tokens
  /(\bBearer\s+)[^\s"'`,;]+/gi,

  // PEM private keys
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,

  // URLs containing username and password
  /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s/]+@/gi,

  // Environment variable assignments containing secrets
  /(\b(?:export\s+)?[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE)[A-Z0-9_]*\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s]+)/gi,
];

export function redactSecrets(input: string): string {
  let output = input;

  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, (match, prefix?: string) => {
      return prefix ? `${prefix}${REDACTED}` : REDACTED;
    });
  }

  // Also redact the exact Gemini API key configured in this process.
  const geminiKey = process.env.GEMINI_API_KEY;

  if (geminiKey && geminiKey.length > 0) {
    output = output.replaceAll(geminiKey, REDACTED);
  }

  return output;
}

/** Backward-compatible name retained for existing callers. */
export const redact = redactSecrets;

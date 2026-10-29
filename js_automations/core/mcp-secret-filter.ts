// core/mcp-secret-filter.ts
// Best-effort masking of credentials before script sources and logs are handed to an
// external AI client. A safety net, not a guarantee: it catches the common shapes
// (named assignments, well-known token formats), not every possible secret.

export const MASK = '***';

// Words that mark the name of a value as sensitive.
const SENSITIVE_WORDS =
  'token|password|passwd|passphrase|secret|api[_-]?key|apikey|auth(?:orization)?|credential|private[_-]?key';
const SENSITIVE_NAME = `(?:[\\w.-]*?(?:${SENSITIVE_WORDS})[\\w.-]*)`;

/** True if a key/variable name suggests its value is a credential (e.g. "api_token", "wifiPassword"). */
export function isSensitiveName(name: string): boolean {
  return new RegExp(SENSITIVE_WORDS, 'i').test(name);
}

// key: 'value' / key = "value" / "key": "value" — only string literals, keeps the quote style.
const NAMED_STRING = new RegExp(`(\\b${SENSITIVE_NAME}["']?\\s*[:=]\\s*)(["'\`])([^"'\`\\n]{4,})\\2`, 'gi');

// Token formats that are recognizable on their own.
const TOKEN_PATTERNS: RegExp[] = [
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, // JWT (also HA long-lived tokens)
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g, // OpenAI / Anthropic style
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google API key
  /\b(?:jsamcp|jsa)_[0-9a-f]{32,}\b/g, // JSA's own tokens
];

// Long hex strings in quotes (webhook secrets, API keys) — not bare, to spare hashes in prose.
const QUOTED_HEX = /(["'`])[0-9a-fA-F]{32,}\1/g;

// A named value is not a credential when it is an interpolated template (`Bearer ${token}` references one
// instead of containing it) or a plain URL such as an OAuth token endpoint.
function isCodeOrPlainUrl(quote: string, value: string): boolean {
  if (quote === '`' && value.includes('${')) return true;
  return /^https?:\/\/[^\s@]+$/i.test(value);
}

export interface MaskResult {
  text: string;
  /** Number of values that were replaced. */
  masked: number;
}

export function maskSecrets(input: string): MaskResult {
  let masked = 0;
  let text = input.replace(NAMED_STRING, (match, prefix: string, quote: string, value: string) => {
    if (isCodeOrPlainUrl(quote, value)) return match;
    masked++;
    return `${prefix}${quote}${MASK}${quote}`;
  });
  for (const pattern of TOKEN_PATTERNS) {
    text = text.replace(pattern, () => {
      masked++;
      return MASK;
    });
  }
  text = text.replace(QUOTED_HEX, (_m, quote: string) => {
    masked++;
    return `${quote}${MASK}${quote}`;
  });
  return { text, masked };
}

/**
 * Masks a structured value before it is serialized: string leaves go through the filter, and strings
 * under sensitive key names are replaced entirely — except empty ones, which stay empty so an assistant can tell a
 * credential that is still missing from one that is filled in. Needed because JSON.stringify escapes inner quotes,
 * which would hide `password = "x"` inside a string from the text patterns.
 */
export function maskDeep(value: unknown): unknown {
  if (typeof value === 'string') return maskSecrets(value).text;
  if (Array.isArray(value)) return value.map(maskDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        typeof v === 'string' && isSensitiveName(k) ? (v === '' ? v : MASK) : maskDeep(v),
      ])
    );
  }
  return value;
}

/** Masks and appends a one-line notice when something was replaced. */
export function maskWithNotice(input: string): string {
  const { text, masked } = maskSecrets(input);
  return masked ? `${text}\n\n[${masked} value(s) masked by JSA secret filter]` : text;
}

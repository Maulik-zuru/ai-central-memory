/**
 * Strips credential-shaped content from a snippet before it is queued for upload.
 *
 * This is a mitigation, not a guarantee, and the Sources screen says so in those words. Pattern
 * matching catches the shapes credentials usually take; it cannot catch a secret that reads like
 * prose ("the staging password is the dog's name"). Anything this misses is still protected by the
 * fact that nothing becomes a memory without the user approving the suggestion — redaction reduces
 * exposure, review is what prevents it.
 *
 * Ordering matters: PEM blocks are removed first (they are multi-line and would otherwise be
 * partially matched by the line rules), then assignments, then bare prefixed tokens.
 */

const PEM_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

// `NAME = value` / `NAME: value` / `NAME=value`, where NAME looks like a credential holder.
// The value is taken up to end-of-line, minus a trailing quote/semicolon/comma so the surrounding
// syntax survives and the line stays readable in the review UI.
const SECRET_ASSIGNMENT =
  /\b([A-Za-z_][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|CREDENTIALS)[A-Za-z0-9_]*)(\s*[:=]\s*)(["']?)([^\s"';,]+)(["']?)/gi;

const AUTH_HEADER = /\b(Authorization\s*:\s*)(\S.*)$/gim;

// Bare tokens that are self-identifying regardless of context, including this product's own key
// prefix — an agent transcript that echoes a paired key must not ship it back to the server.
const KNOWN_PREFIXES = /\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{16,}|gho_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|mp_[A-Za-z0-9]{16,})\b/g;

const REDACTED = '[redacted]';

export function redact(input: string): string {
  return input
    .replace(PEM_BLOCK, '[redacted private key]')
    .replace(AUTH_HEADER, (_m, header: string) => `${header}${REDACTED}`)
    .replace(SECRET_ASSIGNMENT, (_m, name: string, sep: string, openQuote: string, value: string, closeQuote: string) =>
      // Already-redacted input must round-trip unchanged, so the function is safe to apply twice
      // (the queue re-serializes, and a retry path could otherwise double-mangle a line).
      value === REDACTED ? `${name}${sep}${openQuote}${value}${closeQuote}` : `${name}${sep}${openQuote}${REDACTED}${closeQuote}`,
    )
    .replace(KNOWN_PREFIXES, REDACTED);
}

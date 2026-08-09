import { describe, expect, it } from 'vitest';
import { redact } from '../src/main/redact';

// docs/Phase13_DesktopAgent_Implementation_Plan.md §7.3. Redaction runs before anything is queued,
// so these are the last line of defence between a local transcript and the network.
describe('redact', () => {
  it('strips assignments to secret-shaped identifiers, keeping the shape of the line', () => {
    expect(redact('export OPENAI_API_KEY=sk-abc123def456')).toBe('export OPENAI_API_KEY=[redacted]');
    expect(redact('const dbPassword = "hunter2";')).toBe('const dbPassword = "[redacted]";');
    expect(redact('AWS_SECRET_ACCESS_KEY: wJalrXUtnFEMI/K7MDENG')).toBe('AWS_SECRET_ACCESS_KEY: [redacted]');
  });

  it('strips known credential prefixes wherever they appear', () => {
    expect(redact('use sk-proj-AAAABBBBCCCCDDDDEEEE for now')).toBe('use [redacted] for now');
    expect(redact('token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')).toBe('token [redacted]');
    expect(redact('id AKIAIOSFODNN7EXAMPLE')).toBe('id [redacted]');
    expect(redact('key mp_liveabcdefghijklmnopqrstuvwxyz012345')).toBe('key [redacted]');
  });

  it('strips Authorization header values but keeps the header name', () => {
    expect(redact('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def')).toBe('Authorization: [redacted]');
  });

  it('strips PEM blocks entirely', () => {
    const pem = ['before', '-----BEGIN RSA PRIVATE KEY-----', 'MIIEow', 'AQAB', '-----END RSA PRIVATE KEY-----', 'after'].join('\n');
    const out = redact(pem);
    expect(out).toContain('before');
    expect(out).toContain('after');
    expect(out).not.toContain('MIIEow');
    expect(out).toContain('[redacted private key]');
  });

  it('leaves ordinary prose alone — including sentences that merely mention keys', () => {
    const prose = 'I keep my API keys in 1Password and rotate them quarterly.';
    expect(redact(prose)).toBe(prose);
  });

  it('is idempotent — redacting twice changes nothing further', () => {
    const once = redact('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI');
    expect(redact(once)).toBe(once);
  });
});

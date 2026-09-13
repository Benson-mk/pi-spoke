import { test, expect } from 'vitest';
import { redact } from '../../src/security/redaction.js';
test('A29: recognized authentication secrets are removed from diagnostic text', () => {
  const text = 'Authorization: Bearer abcdefghijklmnop apiKey=secretvalue sk-abcdefghijklmnop';
  const clean = redact(text);
  for (const secret of ['abcdefghijklmnop','secretvalue','sk-abcdefghijklmnop']) expect(clean).not.toContain(secret);
});

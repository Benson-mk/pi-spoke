import { test, expect } from 'vitest';
import { fileDiagnostic } from '../../src/helpers/diagnostics.js';

test('file diagnostics preserve known causes without publishing input or arbitrary exception text', () => {
  expect(fileDiagnostic(new Error('Could not find edits[0] in /private/secret; oldText=credential'))).toMatchObject({
    category: 'EDIT_MISMATCH', detail: 'The edit target did not match uniquely.', truncated: false,
  });
  const secret = 'sk-syntheticsecret123456';
  const diagnostic = fileDiagnostic(new Error('unknown: ' + secret.repeat(100)));
  expect(diagnostic).toMatchObject({ category: 'FILE_TOOL_ERROR', truncated: true });
  expect(JSON.stringify(diagnostic)).not.toContain(secret);
  expect(fileDiagnostic(new Error('Could not edit file: FILE_TOO_LARGE. Error code: EDIT_MISMATCH.')).category).toBe('FILE_TOOL_ERROR');
});

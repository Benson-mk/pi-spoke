export class SpokeError extends Error {
  constructor(readonly code: string, message = code, readonly safeToRetrySameRequest = false) { super(message); }
}
export function fail(code: string, message?: string): never { throw new SpokeError(code, message); }

/** Only report schema structure, never values from the rejected request. */
type InputIssue = { path: PropertyKey[]; code: string; expected?: string; minimum?: number | bigint; maximum?: number | bigint;
  errors?: InputIssue[][] };
export function invalidInput(issues: readonly InputIssue[], maxBytesLimit = 16384): never {
  const relevant = issues.flatMap(issue => issue.code === 'invalid_union' && issue.errors?.length
    ? [...issue.errors].sort((a, b) => a.length - b.length)[0]! : [issue]);
  const descriptions = relevant.slice(0, 4).map(issue => {
    const field = issue.path.length ? issue.path.map(part => typeof part === 'number' ? `[${part}]` : String(part).replace(/[^a-zA-Z0-9_]/g, '')).join('.') : 'input';
    if (field === 'max_bytes') return `max_bytes must be an integer from 1 to ${maxBytesLimit.toLocaleString('en-US')} bytes`;
    if (issue.code === 'invalid_type') return `${field}: expected ${issue.expected ?? 'valid type'}`;
    if (issue.code === 'too_big') return `${field}: maximum ${issue.maximum}`;
    if (issue.code === 'too_small') return `${field}: minimum ${issue.minimum}`;
    if (issue.code === 'unrecognized_keys') return `${field}: unknown field`;
    if (issue.code === 'invalid_value') return `${field}: expected an allowed option`;
    return `${field}: invalid ${issue.code.replace(/[^a-z_]/g, '')}`;
  });
  fail('INVALID_ARGUMENT', `Invalid input: ${descriptions.join('; ')}${relevant.length > 4 ? '; further errors omitted' : ''}`);
}

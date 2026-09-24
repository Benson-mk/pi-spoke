/** Only fixed categories and details cross the durable observation boundary. */
export type FileDiagnostic = { category: string; detail: string; truncated: boolean };

export function fileDiagnostic(error: unknown): FileDiagnostic {
  const message = error instanceof Error ? error.message : String(error);
  const mapping: [RegExp, string, string][] = [
    [/^DIRECTORY_INPUT$/, 'DIRECTORY_INPUT', 'The target is a directory, not a regular file.'],
    [/^FILE_TOO_LARGE$/, 'FILE_TOO_LARGE', 'The file exceeds the one MiB file-tool limit.'],
    [/^UNSUPPORTED_INPUT: binary file$/, 'BINARY_INPUT', 'The file contains binary data.'],
    [/^UNSUPPORTED_INPUT: file is not UTF-8 text$/, 'INVALID_UTF8', 'The file is not valid UTF-8 text.'],
    [/^(?:Could not find (?:the exact text|edits\[\d+\]) in |Found \d+ occurrences of edits\[\d+\] in )/, 'EDIT_MISMATCH', 'The edit target did not match uniquely.'],
    [/^FILE_CHANGED$/, 'FILE_CHANGED', 'The file changed during the operation.'],
    [/^PROTECTED_PATH(?:$|:)/, 'PROTECTED_PATH', 'The target is protected.'],
    [/^PATH_NOT_ALLOWED$/, 'PATH_NOT_ALLOWED', 'The target is outside the granted roots.'],
    [/^UNSAFE_PATH(?:$|:)/, 'UNSAFE_PATH', 'The target has an unsafe type or path topology.'],
    [/^ENOENT(?:$|:)/, 'FILE_NOT_FOUND', 'The target does not exist.'],
    [/^(?:EACCES|EPERM)(?:$|:)/, 'ACCESS_DENIED', 'The operation was denied; sandbox denial is not established.'],
    [/^LIMIT_EXCEEDED$/, 'LIMIT_EXCEEDED', 'The operation exceeded a configured limit.'],
    [/^SEARCH_FAILED$/, 'SEARCH_FAILED', 'The search helper failed; sandbox denial is not established.'],
  ];
  const match = mapping.find(([pattern]) => pattern.test(message));
  return { category: match?.[1] ?? 'FILE_TOOL_ERROR', detail: match?.[2] ?? 'The file operation failed; further detail is unavailable.',
    truncated: Buffer.byteLength(message) > 512 };
}

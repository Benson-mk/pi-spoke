export class SpokeError extends Error {
  constructor(readonly code: string, message = code, readonly safeToRetrySameRequest = false) { super(message); }
}
export function fail(code: string, message?: string): never { throw new SpokeError(code, message); }

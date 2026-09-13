export function redact(text: string, secrets: string[] = []): string {
  let value = text;
  for (const secret of secrets.filter(value => value.length >= 6).sort((a, b) => b.length - a.length)) value = value.split(secret).join('[REDACTED]');
  return value.replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|authorization|cookie|access[_-]?token)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

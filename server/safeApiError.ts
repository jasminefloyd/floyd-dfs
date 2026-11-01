/** Remove credential-shaped values before an otherwise safe validation message is returned to a client. */
export function redactSensitiveErrorText(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/((?:api[_-]?key|service[_-]?role[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

/**
 * @file audit-sanitizer.ts
 * @description Sanitizador estricto para registros de auditoría (Fase 2B).
 *
 * Elimina cualquier rastro de contraseñas, tokens de refresco, tokens de acceso,
 * tokens de reseteo, secretos o credenciales antes de persistir en audit_logs.
 */

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'pass',
  'secret',
  'token',
  'rawtoken',
  'refreshtoken',
  'accesstoken',
  'resettoken',
  'invitationtoken',
  'jwtsecret',
  'cookiesecret',
  'authorization',
  'cookie',
  'bearer',
  'signature',
]);

/**
 * Sanitiza recursivamente un objeto de metadatos eliminando cualquier clave o valor sensible.
 */
export function sanitizeAuditMetadata(metadata?: Record<string, unknown> | null): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object') {
    return {};
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (SENSITIVE_KEYS.has(normalizedKey)) {
      sanitized[key] = '[REDACTED]';
      continue;
    }

    if (value && typeof value === 'object') {
      if (Array.isArray(value)) {
        sanitized[key] = value.map((item) =>
          typeof item === 'object' && item !== null
            ? sanitizeAuditMetadata(item as Record<string, unknown>)
            : item
        );
      } else {
        sanitized[key] = sanitizeAuditMetadata(value as Record<string, unknown>);
      }
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

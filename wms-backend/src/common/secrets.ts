import { Logger } from '@nestjs/common';

/**
 * Central secret accessors. Every entry point fails fast on a missing or weak
 * value — a deployment must never silently fall back to a secret that is
 * readable in the public repository (the old `'wms-dev-secret'` fallback made
 * forged tokens authenticate against any instance whose .env was incomplete).
 *
 * The repository is public by design, so secrets live ONLY in the environment;
 * this file is the single place that decides what counts as valid.
 */

const MIN_SECRET_LENGTH = 32;

const logger = new Logger('Secrets');

function requiredSecret(name: string): string {
  const value = process.env[name];
  if (!value || value.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `${name} is missing or shorter than ${MIN_SECRET_LENGTH} chars. ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" ` +
        `and set it in the environment. Refusing to start with a default or weak secret.`,
    );
  }
  return value;
}

let cachedJwt: string | undefined;
let cachedRefresh: string | undefined;

/** Access-token signing/verification secret. */
export function jwtSecret(): string {
  return (cachedJwt ??= requiredSecret('JWT_SECRET'));
}

/** Refresh-token signing secret. Must differ from the access secret. */
export function jwtRefreshSecret(): string {
  if (cachedRefresh) return cachedRefresh;
  const value = requiredSecret('JWT_REFRESH_SECRET');
  if (value === jwtSecret()) {
    throw new Error(
      'JWT_REFRESH_SECRET must differ from JWT_SECRET — sharing one secret means a leaked access token can mint refresh tokens.',
    );
  }
  cachedRefresh = value;
  logger.log('JWT secrets loaded from environment');
  return value;
}

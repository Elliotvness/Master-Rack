/**
 * The process entry point (task **T-14a**).
 *
 * Deliberately the thinnest file in the application. Everything that can be
 * decided is decided in `createApp`, which a test drives through
 * `app.inject()` without a socket; what is left here is the socket, the
 * database pool, and the signal handling — the three things that cannot be
 * exercised without actually running.
 *
 * `createApp` throws before this ever listens if the configuration is
 * malformed or the router and the policy registry disagree. That ordering is
 * the point: a process that binds a port and then refuses every request is
 * worse than one that never binds it, because a health check will call the
 * first one healthy.
 */

import type { FastifyInstance } from 'fastify';

import { closeDatabase, configureDatabase } from '@rms/db';

import { createApp, databaseDenyRecorder } from './app.js';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    // Same posture as CLAIM_LEASE_MINUTES: refuse, never default. A database
    // URL guessed from a fallback is a process that connects somewhere nobody
    // chose.
    throw new Error(`${name} is required and unset. Refusing to start.`);
  }
  return value;
}

/**
 * Returns the instance so a test can start the process for real — port 0, a
 * kernel-assigned port — and then close it. An entry point nothing ever runs is
 * an entry point nobody has proven boots, and this is the first code in the
 * repository that binds a socket at all.
 */
export async function start(): Promise<FastifyInstance> {
  configureDatabase(required('DATABASE_URL'));

  const app = createApp({ recordDeny: databaseDenyRecorder() });
  // 0 is legal and means "let the kernel choose" — which is how the test binds
  // without colliding with anything. Anything outside the port range, or not a
  // whole number, is refused rather than coerced.
  const port = Number(process.env['PORT'] ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new RangeError(
      `PORT must be a whole number from 0 to 65535 (0 means kernel-assigned); ` +
        `got '${String(process.env['PORT'])}'.`,
    );
  }

  const shutdown = async (): Promise<void> => {
    await app.close();
    await closeDatabase();
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());

  await app.listen({ port, host: '127.0.0.1' });
  return app;
}

// Only when run as the process entry, never on import — a test that imports
// this module must not open a socket.
if (process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts')) {
  start().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

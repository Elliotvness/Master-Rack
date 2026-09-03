/**
 * The entry point, started for real (task **T-14a**).
 *
 * Everything else in this task is proven through `app.inject()`, which drives
 * the router without a socket. This file is the one place that binds one —
 * port 0, so the kernel picks it and two runs cannot collide — because an
 * entry point nothing ever runs is an entry point nobody has proven boots, and
 * this is the first code in the repository that listens at all.
 */

import { afterEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';

import { closeDatabase } from '@rms/db';

import { start } from './server.js';

const ADMIN_URL =
  process.env['DATABASE_ADMIN_URL'] ?? 'postgresql://postgres:postgres@localhost:55432/rms';
const APP_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://app_user:app_user_dev_only@localhost:55432/rms';

async function probe(): Promise<boolean> {
  const client = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    try {
      await client.end();
    } catch {
      /* already closed */
    }
  }
}

const available = await probe();
const maybe = available ? it : it.skip;

let running: FastifyInstance | undefined;
afterEach(async () => {
  if (running !== undefined) {
    await running.close();
    running = undefined;
  }
  await closeDatabase();
});

describe('the process entry point', () => {
  maybe('binds a port, serves the gate, and shuts down', async () => {
    process.env['DATABASE_URL'] = APP_URL;
    process.env['PORT'] = '0';
    running = await start();

    const address = running.server.address();
    expect(address).not.toBeNull();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    expect(port).toBeGreaterThan(0);

    // Over a real socket, not through inject: an unauthenticated request to a
    // declared route must be refused by the gate, not served.
    const res = await fetch(`http://127.0.0.1:${String(port)}/api/client/v1/projects`);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });

  maybe('refuses to start with DATABASE_URL unset, rather than defaulting somewhere', async () => {
    const saved = process.env['DATABASE_URL'];
    delete process.env['DATABASE_URL'];
    await expect(start()).rejects.toThrow(/DATABASE_URL is required/);
    process.env['DATABASE_URL'] = saved;
  });

  maybe('refuses a PORT that is not a whole number in range', async () => {
    process.env['DATABASE_URL'] = APP_URL;
    process.env['PORT'] = 'eighty';
    await expect(start()).rejects.toThrow(RangeError);
    process.env['PORT'] = '0';
  });
});

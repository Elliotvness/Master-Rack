import { fileURLToPath } from 'node:url';

/**
 * The alias table, in one file.
 *
 * It must agree with `paths` in tsconfig.base.json and with the bundler config
 * when apps exist, and tools/check-aliases.mjs asserts that three-way
 * agreement. It lives here rather than inside vitest.config.ts because the
 * benchmark config needs the same table, and a second copy is a fourth thing to
 * keep in agreement.
 */
export const alias = {
  '@rms/kernel-units': fileURLToPath(
    new URL('./packages/kernel-units/src/index.ts', import.meta.url),
  ),
  '@rms/kernel-model': fileURLToPath(
    new URL('./packages/kernel-model/src/index.ts', import.meta.url),
  ),
  '@rms/workflow': fileURLToPath(
    new URL('./packages/workflow/src/index.ts', import.meta.url),
  ),
  '@rms/kernel-catalog': fileURLToPath(
    new URL('./packages/kernel-catalog/src/index.ts', import.meta.url),
  ),
  '@rms/kernel-derive': fileURLToPath(
    new URL('./packages/kernel-derive/src/index.ts', import.meta.url),
  ),
  '@rms/kernel-rules': fileURLToPath(
    new URL('./packages/kernel-rules/src/index.ts', import.meta.url),
  ),
  '@rms/kernel-checks': fileURLToPath(
    new URL('./packages/kernel-checks/src/index.ts', import.meta.url),
  ),
  '@rms/kernel-bom': fileURLToPath(
    new URL('./packages/kernel-bom/src/index.ts', import.meta.url),
  ),
  '@rms/display-list': fileURLToPath(
    new URL('./packages/display-list/src/index.ts', import.meta.url),
  ),
  '@rms/kernel-geom': fileURLToPath(
    new URL('./packages/kernel-geom/src/index.ts', import.meta.url),
  ),
  '@rms/contracts': fileURLToPath(
    new URL('./packages/contracts/src/index.ts', import.meta.url),
  ),
  '@rms/db': fileURLToPath(new URL('./packages/db/src/index.ts', import.meta.url)),
  '@rms/api': fileURLToPath(new URL('./apps/api/src/index.ts', import.meta.url)),
  '@rms/client-web': fileURLToPath(
    new URL('./apps/client-web/src/index.ts', import.meta.url),
  ),
  '@rms/internal-web': fileURLToPath(
    new URL('./apps/internal-web/src/index.ts', import.meta.url),
  ),
};


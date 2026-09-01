/**
 * The package's error base, in its own module.
 *
 * It lives here rather than in `release.ts` because `cell-ids.ts` and
 * `spot-check.ts` both need it, and `release.ts` imports `spot-check.ts`. A
 * shared base in the module that also holds the gate makes the import graph a
 * cycle — which ESM tolerates for types and breaks for a class that another
 * module extends at load time.
 */
export class CatalogError extends Error {
  override readonly name: string = 'CatalogError';
}

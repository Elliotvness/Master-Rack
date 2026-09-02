/**
 * The modules that contain TYPES ONLY — interfaces and type aliases, no runtime.
 *
 * This is the one list both consumers read, on purpose:
 *
 *   - `vitest.config.ts` excludes these paths from coverage. A types-only
 *     module compiles to a comment block and `export {};`. There is nothing in
 *     it a test could execute, so it has no coverage to measure, and the
 *     `packages/workflow/src/**` 100% threshold must not depend on how a given
 *     platform counts a file with no statements. F-37: on Linux the two files
 *     below reported 0/0 and the package read 100%; on Windows the same files
 *     reported 62 + 28 uncovered LINES and the package read 67.85%, failing
 *     `pnpm verify` at its last step. Identical source, opposite verdicts.
 *
 *   - `tools/check-types-only.mjs` asserts that every path here STILL compiles
 *     to an empty module. That is the guard, and it is why this list is a
 *     module rather than a comment in the config: an exclusion that nothing
 *     re-checks is a hole with a docstring (F-08's shape). Add a runtime export
 *     to one of these files and the checker goes red, which drags the file
 *     back under the coverage threshold instead of letting it hide behind the
 *     exclusion.
 *
 * Two lists that could disagree is the defect this repository keeps finding in
 * itself; one list, imported twice, cannot.
 *
 * Paths are repository-relative, forward slashes, the SOURCE file. The checker
 * derives the emitted file (`src/x.ts` → `dist/x.js`) and refuses to pass if it
 * has not been built.
 */
export const TYPES_ONLY = Object.freeze([
  'packages/workflow/src/assumptions.ts',
  'packages/workflow/src/finding.ts',
]);

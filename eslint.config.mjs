// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '**/dist/**', // build output; the source it came from is already linted
      'coverage/**',
      'src/**', // the documentation toolchain is Python
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',

      // A-05 will add a rule banning raw database pool checkout. Until the
      // database layer exists there is nothing to ban, and a rule that matches
      // nothing is worse than no rule because it reads as enforced.
      'no-restricted-syntax': [
        'error',
        {
          // Determinism (blueprint §12.2): no implicit inputs at calculation time.
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message:
            'Date.now() is banned: derivation must be deterministic. Pass the time in as an explicit, recorded input.',
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message:
            'Math.random() is banned: derivation must be deterministic and reproducible.',
        },
      ],
    },
  },
  {
    // A-05: withTenant() is the only permitted database entry point. A raw
    // pool checkout skips the transaction-local tenant context, which means
    // every RLS policy compares against an unset GUC and the query sees
    // nothing — or, worse, the previous tenant's context under a pooler.
    files: ['apps/**/*.ts', 'packages/**/*.ts'],
    ignores: [
      'packages/db/src/with-tenant.ts',
      'packages/db/src/*.test.ts',
      // The auth DB tests seed and assert directly against Postgres.
      'apps/**/*.db.test.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'pg',
              message:
                'Import from @rms/db and use withTenant() instead. A raw pg client bypasses ' +
                'the transaction-local tenant context that every RLS policy depends on.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message:
            'Date.now() is banned: derivation must be deterministic. Pass the time in as an explicit, recorded input.',
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message:
            'Math.random() is banned: derivation must be deterministic and reproducible.',
        },
        {
          selector: "CallExpression[callee.property.name='connect'][callee.object.name=/[Pp]ool/]",
          message:
            'Raw pool checkout is banned. Use withTenant(), which sets the tenant context ' +
            'transaction-locally so it cannot survive the connection returning to the pool.',
        },
      ],
    },
  },
  {
    // Build tooling runs in Node and is allowed to talk to the operator. The
    // benchmark is included by name rather than by a broad tools/**/*.ts glob:
    // its whole output IS its report, so console is the point, and a report
    // written to console.error would read as a failure on a passing run.
    files: [
      'tools/**/*.mjs',
      'tools/**/*.js',
      'tools/bench/**/*.ts',
      '*.config.ts',
      '*.config.mjs',
      'vitest.alias.ts',
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
      'no-restricted-imports': 'off',
      'no-restricted-syntax': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
  {
    // The database package and the api app legitimately touch Node globals.
    files: ['packages/db/**/*.ts', 'apps/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);

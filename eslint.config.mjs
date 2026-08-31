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
    // Build tooling runs in Node and is allowed to talk to the operator.
    files: ['tools/**/*.mjs', 'tools/**/*.js', '*.config.ts', '*.config.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
);

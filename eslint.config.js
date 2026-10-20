const tseslint = require('typescript-eslint');

const forbiddenTestModifiers = ['it', 'test', 'describe'].flatMap((fn) =>
  ['skip', 'only', 'todo'].map((mod) => ({
    selector: `MemberExpression[object.name='${fn}'][property.name='${mod}']`,
    message: `${fn}.${mod} é proibido (Princípio V).`,
  })),
);

module.exports = tseslint.config(
  { ignores: ['node_modules/', 'out/', 'dist/', 'coverage/', 'tests/arch/fixtures/**', 'build/'] },
  ...tseslint.configs.strict,
  {
    rules: {
      'no-warning-comments': ['error', { terms: ['todo', 'fixme', 'xxx'], location: 'anywhere' }],
      'no-restricted-syntax': ['error', ...forbiddenTestModifiers],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'child_process',
              importNames: ['exec', 'execSync'],
              message: 'Use execFile/spawn sem shell.',
            },
            {
              name: 'node:child_process',
              importNames: ['exec', 'execSync'],
              message: 'Use execFile/spawn sem shell.',
            },
          ],
        },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['tests/**'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);

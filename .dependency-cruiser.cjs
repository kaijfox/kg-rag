/**
 * Star dependency rule (architecture-proposal.md section 1): every package imports only @kg/core (plus
 * third-party libraries); tests may also import @kg/testkit; testkit imports only core; core imports no
 * package; only @kg/app (the composition root) may import siblings.
 */
module.exports = {
  forbidden: [
    {
      name: 'star-rule',
      comment: 'A package may import only itself, core and (in tests) testkit. Only app may import siblings.',
      severity: 'error',
      from: { path: '^packages/([^/]+)/', pathNot: '^packages/(app|core)/' },
      to: { path: '^packages/', pathNot: ['^packages/$1/', '^packages/core/', '^packages/testkit/'] },
    },
    {
      name: 'core-is-a-leaf',
      comment: 'core imports no other package.',
      severity: 'error',
      from: { path: '^packages/core/' },
      to: { path: '^packages/', pathNot: '^packages/core/' },
    },
    {
      name: 'core-runtime-deps',
      comment: 'core source depends on zod and node builtins only.',
      severity: 'error',
      from: { path: '^packages/core/src/' },
      to: { dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-no-pkg', 'npm-unknown'], pathNot: '/zod/' },
    },
    {
      name: 'testkit-only-in-tests',
      comment: 'Implementation sources must not import testkit (it is a devDependency). app is exempt in Phase 1: the skeleton wires fakes.',
      severity: 'error',
      from: { path: '^packages/(?!app/|testkit/)[^/]+/src/' },
      to: { path: '^packages/testkit/' },
    },
    {
      name: 'testkit-imports-core-only',
      severity: 'error',
      from: { path: '^packages/testkit/' },
      to: { path: '^packages/', pathNot: ['^packages/testkit/', '^packages/core/'] },
    },
    {
      name: 'not-to-unresolvable',
      comment: 'An import that does not resolve is usually a sibling package the importer has not declared.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true, viaOnly: { dependencyTypesNot: ['type-only'] } },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(fixtures|golden)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default'], mainFields: ['main', 'types'] },
    combinedDependencies: true,
    preserveSymlinks: false,
  },
};

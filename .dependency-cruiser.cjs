/**
 * Star dependency rule (architecture-proposal.md section 1, as amended by state-machine-revision.md section 5):
 * every package imports only @kg/core (plus third-party libraries); tests may also import @kg/testkit; testkit
 * imports only core; core imports no package. Only @kg/app (the composition root) may import sibling packages,
 * with two exceptions: the shared pipeline toolkit @kg/pipeline may also be imported by search, ingest and eval, and the
 * shared SQLite layer @kg/sqlite may also be imported by store and eventlog.
 * @kg/pipeline itself imports only core (and, in its tests, testkit). XState (xstate, @xstate/*, @statelyai/*)
 * is imported only by @kg/pipeline, except that @kg/app may list @statelyai/inspect as a devDependency only.
 */
module.exports = {
  forbidden: [
    {
      name: 'star-rule',
      comment: 'A package may import only itself, core, (in tests) testkit, pipeline and sqlite. Only app may import other siblings. pipeline and sqlite importers are narrowed by their own rules.',
      severity: 'error',
      from: { path: '^packages/([^/]+)/', pathNot: '^packages/(app|core)/' },
      to: { path: '^packages/', pathNot: ['^packages/$1/', '^packages/core/', '^packages/testkit/', '^packages/pipeline/', '^packages/sqlite/'] },
    },
    {
      name: 'sqlite-importers',
      comment: '@kg/sqlite may be imported only by store, eventlog and app (and by itself).',
      severity: 'error',
      from: { path: '^packages/', pathNot: '^packages/(store|eventlog|app|sqlite)/' },
      to: { path: '^packages/sqlite/' },
    },
    {
      name: 'pipeline-kit-importers',
      comment: '@kg/pipeline may be imported only by search, ingest, eval and app (and by itself).',
      severity: 'error',
      from: { path: '^packages/', pathNot: ['^packages/(search|ingest|eval|app|pipeline)/'] },
      to: { path: '^packages/pipeline/' },
    },
    {
      name: 'pipeline-imports-core-only',
      comment: '@kg/pipeline source imports only @kg/core (and itself). Its tests may also import testkit (see the next rule).',
      severity: 'error',
      from: { path: '^packages/pipeline/', pathNot: '^packages/pipeline/test/' },
      to: { path: '^packages/', pathNot: ['^packages/pipeline/', '^packages/core/'] },
    },
    {
      name: 'pipeline-tests-import-core-or-testkit',
      comment: '@kg/pipeline tests may import @kg/core, @kg/testkit and itself, and nothing else in packages/.',
      severity: 'error',
      from: { path: '^packages/pipeline/test/' },
      to: { path: '^packages/', pathNot: ['^packages/pipeline/', '^packages/core/', '^packages/testkit/'] },
    },
    {
      name: 'xstate-only-in-pipeline',
      comment: 'xstate, @xstate/* and @statelyai/* are imported only from @kg/pipeline, app included. The one exception, @statelyai/inspect, is covered by the two rules after this one.',
      severity: 'error',
      from: { path: '^packages/', pathNot: '^packages/pipeline/' },
      to: {
        dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-no-pkg', 'npm-unknown'],
        path: 'node_modules/(xstate|@xstate|@statelyai)/',
        pathNot: 'node_modules/@statelyai/inspect/',
      },
    },
    {
      name: 'statelyai-inspect-app-devdep-only',
      comment: 'Only @kg/app may import @statelyai/inspect, and only as a devDependency (it is the live inspector, opt-in, never shipped in library packages).',
      severity: 'error',
      from: { path: '^packages/', pathNot: '^packages/app/' },
      to: { dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-no-pkg', 'npm-unknown'], path: 'node_modules/@statelyai/inspect/' },
    },
    {
      name: 'statelyai-inspect-not-runtime-in-app',
      comment: '@kg/app lists @statelyai/inspect as a devDependency only; a runtime (npm) dependency on it is forbidden.',
      severity: 'error',
      from: { path: '^packages/app/' },
      to: { dependencyTypes: ['npm'], path: 'node_modules/@statelyai/inspect/' },
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
    exclude: { path: '(^|/)(fixtures|golden|\\.venv)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default'], mainFields: ['main', 'types'] },
    combinedDependencies: true,
    preserveSymlinks: false,
  },
};

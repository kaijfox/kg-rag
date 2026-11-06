/**
 * Dependency rules. The kernel is the foundation and imports nothing in packages/. Modules (what a use case swaps) import
 * the kernel only. Evaluation imports the kernel only in its source; its tests may use modules to build an index. The app
 * is the composition root and may import all three.
 */
module.exports = {
  forbidden: [
    {
      name: 'kernel-imports-nothing',
      comment: 'The kernel is a leaf: no other package in packages/.',
      severity: 'error',
      from: { path: '^packages/kernel/' },
      to: { path: '^packages/', pathNot: '^packages/kernel/' },
    },
    {
      name: 'modules-import-kernel-only',
      comment: 'Modules depend on the kernel, never on evaluation or the app.',
      severity: 'error',
      from: { path: '^packages/modules/' },
      to: { path: '^packages/', pathNot: '^packages/(modules|kernel)/' },
    },
    {
      name: 'eval-source-imports-kernel-only',
      comment: 'Evaluation source uses the kernel; its tests may build an index with modules.',
      severity: 'error',
      from: { path: '^packages/eval/src/' },
      to: { path: '^packages/', pathNot: '^packages/(eval|kernel)/' },
    },
    {
      name: 'eval-tests-import-kernel-and-modules',
      severity: 'error',
      from: { path: '^packages/eval/test/' },
      to: { path: '^packages/', pathNot: '^packages/(eval|kernel|modules)/' },
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
    exclude: { path: '(^|/)(fixtures|\\.venv)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default'], mainFields: ['main', 'types'] },
    combinedDependencies: true,
    preserveSymlinks: false,
  },
};

import { defineConfig } from 'vitest/config';
const P = '/Users/kaifox/projects/obsidian/kg-rag/packages';
export default defineConfig({
  resolve: {
    alias: [
      { find: '@kg/testkit/conformance', replacement: `${P}/testkit/src/conformance.ts` },
      { find: '@kg/testkit', replacement: `${P}/testkit/src/index.ts` },
      { find: '@kg/core', replacement: `${P}/core/src/index.ts` },
    ],
  },
  server: { fs: { strict: false } },
  test: { include: ['test/**/*.test.ts'], testTimeout: 30000 },
});

/** @kg/app: the kg command line, the MCP server and the session viewer. */
export { main } from './cli';
export { openKg, sidecarCommand, type AppOptions } from './open';
export { TOOLS, callTool, createMcpServer, serveStdio } from './mcp';
export { createViewerServer } from './viewer';
export { diffIndexes, type IndexDiff } from './diff';

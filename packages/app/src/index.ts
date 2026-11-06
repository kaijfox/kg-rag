/** @kg/app: the kg command line, the MCP server and the session viewer. */
export { main, COMMANDS, SUBCOMMANDS, OPTION_NAMES } from './cli';
export { openKg, sidecarCommand, type AppOptions } from './open';
export { INSTRUCTIONS, TOOLS, callTool, createMcpServer, publicMeta, serveStdio } from './mcp';
export { createViewerServer } from './viewer';
export { diffIndexes, type IndexDiff } from './diff';
export { runDoctor, formatDoctor, type Check } from './doctor';
export { exportDatabase, type ExportResult } from './export';
export { buildReport, formatReport, type Report } from './report';
export { watchSources, type Watcher } from './watch';

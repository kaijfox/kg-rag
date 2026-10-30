/**
 * @kg/viewer: read-only HTTP view of the event log (see README.md). The page is served from web/ and vendor/;
 * the pure rendering functions live in web/render.js so the browser and the tests run the same code.
 */
export { createViewerServer, type ViewerOptions } from './server';

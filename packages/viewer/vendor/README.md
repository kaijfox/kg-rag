# vendor

`mermaid.min.js` is the browser bundle of Mermaid, served by the viewer at `/vendor/mermaid.min.js` (the page loads
nothing from the network).

- Package: `mermaid@12.1.0` (npm), published 2026-10-02. Chosen as the newest release on npm that was more than two
  weeks old when vendored (2026-10-18). Check: `npm view mermaid time`.
- File: `dist/mermaid.min.js` from `npm pack mermaid@12.1.0`, unmodified. 5,493,176 bytes.
- sha256: `6484afc32872a3aa16cac9a76ba1816a1ed4cc870a6593cc2e17757750f518b2`.
- Licence: MIT, `LICENSE-mermaid` (copied from the package). The bundle's comments carry notices for the third-party
  code it contains (for example MIT); their full texts are not copied.
- Global: the bundle sets `globalThis.mermaid`.
- To update: pack the new version in a scratch directory, copy `dist/mermaid.min.js` and `LICENSE`, and record the
  version, date and hash here.

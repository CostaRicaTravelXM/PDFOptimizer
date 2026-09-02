/**
 * pdfjs-dist ships types only for its bare entry point, but both call sites import the
 * explicit `.mjs` build so bundlers pick the ES module rather than the CommonJS one.
 * Point the subpaths at the same declarations.
 */
declare module 'pdfjs-dist/build/pdf.mjs' {
  export * from 'pdfjs-dist';
}

declare module 'pdfjs-dist/build/pdf.worker.mjs';

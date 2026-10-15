// The stylesheet import is added to dist/index.js at build time (see
// scripts/postbuild.mjs) rather than written here, so the published type
// declarations don't carry an `import "*.css"` that breaks type-checking
// in consumers without CSS module declarations.
export * from "./Kadmos.js";

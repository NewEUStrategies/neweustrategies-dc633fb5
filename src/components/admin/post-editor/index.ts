// Public entry point for the post editor (atomic-design tree).
//
// The route admin.posts.$slug is a thin composition root: state + persistence
// live in ./hooks, pure logic in ./lib, and all UI in the atoms / molecules /
// organisms layers. Consumers import from this barrel, never from deep paths.
export * from "./types";
export * from "./lib";
export * from "./hooks";
export * from "./organisms";

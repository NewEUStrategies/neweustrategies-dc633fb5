import config from "./vitest.config";

// Each shard collects only part of the coverage. The required `test` job merges
// all four reports using vitest.config.ts and enforces the unchanged thresholds.
if (config.test?.coverage) config.test.coverage.thresholds = undefined;
export default config;

// One contract for the runner, browser spec and comparison. A fixed odd count
// prevents partial runs or a lucky subset of samples from passing the gate.
export const firstVisitSamples = [1, 2, 3, 4, 5, 6, 7] as const;
export const firstVisitPages = [
  { path: "/", lang: "pl" },
  { path: "/en", lang: "en" },
] as const;
export const firstVisitCacheStates = ["cold", "warm"] as const;

export const firstVisitReportDirectory = (baseline: boolean) =>
  baseline ? "reports/first-visit-baseline" : "reports/first-visit";

export function firstVisitEnvironment(
  artifact: { artifactRoot: string; baseline: boolean },
  measurementCase: string,
) {
  return {
    NES_PERFORMANCE_ARTIFACT_ROOT: artifact.artifactRoot,
    NES_PERFORMANCE_BASELINE: artifact.baseline ? "1" : "0",
    NES_PERFORMANCE_REPORT_DIR: firstVisitReportDirectory(artifact.baseline),
    // The fixture uses this identifier to select scenario-specific SSR data.
    // Keep output-file namespacing in the Playwright config instead.
    NES_PERFORMANCE_CASE: measurementCase,
  };
}

export function firstVisitCases() {
  return firstVisitSamples.flatMap((sample) =>
    firstVisitPages.flatMap((page) =>
      firstVisitCacheStates.map((cacheState) => ({ ...page, cacheState, sample })),
    ),
  );
}

export function firstVisitComparisonPlan(baselineRoot: string, candidateRoot: string) {
  return firstVisitCases().flatMap((measurement, index) => {
    const pair = [
      { ...measurement, artifactRoot: baselineRoot, baseline: true },
      { ...measurement, artifactRoot: candidateRoot, baseline: false },
    ];
    // Alternate which artifact runs first, including across successive samples
    // of the same scenario. Both builds must finish before the first pair.
    return (index + measurement.sample) % 2 === 0 ? pair : pair.reverse();
  });
}

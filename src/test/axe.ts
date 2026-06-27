// Shared accessibility-test helper. Runs axe-core against a rendered DOM subtree
// and returns the violations (so callers assert `toEqual([])`).
//
// happy-dom has no layout/paint engine, so rules that depend on real rendering
// are disabled here: `color-contrast` (needs computed pixel colors) and `region`
// (page-level landmark wrapping, which is the host route's job, not a component's).
// Everything structural - alt text, form labels, button/link names, ARIA
// validity, heading order, list semantics - is fully exercised.
import axe, { type Result, type RuleObject } from "axe-core";

const DISABLED_RULES: RuleObject = {
  "color-contrast": { enabled: false },
  region: { enabled: false },
};

export async function axeViolations(
  container: Element,
  extraDisabled: RuleObject = {},
): Promise<Result[]> {
  const results = await axe.run(container as HTMLElement, {
    rules: { ...DISABLED_RULES, ...extraDisabled },
  });
  return results.violations;
}

/** Compact, readable summary of violations for test failure messages. */
export function summarize(violations: Result[]): string {
  return violations.map((v) => `${v.id} (${v.nodes.length})`).join(", ");
}

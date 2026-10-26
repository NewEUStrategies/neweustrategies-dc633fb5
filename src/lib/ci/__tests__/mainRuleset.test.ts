// @vitest-environment node
//
// RULESET MAIN - plik w repo musi dać się nałożyć na GitHubie bez zatrzymania
// kanału wdrożenia, a rozjazd z tym, co GitHub naprawdę stosuje, ma być
// czerwony. Przypadki syntetyczne pilnują, że każda reguła łapie swój błąd
// (trafienie i pudło); przypadki na prawdziwych plikach - że repo jest zielone
// z właściwego powodu.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GITHUB_ACTIONS_APP_ID,
  LOVABLE_APP_SLUG,
  RULESET_PATH,
  defaultCodeOwners,
  parseRuleset,
  rulesetDrift,
  rulesetIssues,
  rulesetPayload,
  workflowChecks,
  type LiveRule,
  type Ruleset,
  type RulesetContext,
} from "@/lib/ci/mainRuleset";

const WORKFLOWS = join(".github", "workflows");

function parsed(text: string): Ruleset {
  const result = parseRuleset(text);
  if ("error" in result) throw new Error(result.error);
  return result;
}

const realRuleset = (): Ruleset => parsed(readFileSync(RULESET_PATH, "utf8"));
const realContext = (): RulesetContext => ({
  workflows: readdirSync(WORKFLOWS)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => workflowChecks(name, readFileSync(join(WORKFLOWS, name), "utf8"))),
  defaultCodeOwners: defaultCodeOwners(readFileSync(join(".github", "CODEOWNERS"), "utf8")),
});

/** Plik sprzed naprawy (audyt 2026-10): PR + review Code Ownera, bez obejść. */
const PRE_FIX = JSON.stringify({
  name: "main-release-quality",
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
  bypass_actors: [],
  rules: [
    { type: "deletion" },
    { type: "non_fast_forward" },
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: true,
        do_not_enforce_on_create: false,
        required_status_checks: [
          { context: "Required release checks" },
          { context: "e2e" },
          { context: "e2e-seeded" },
        ],
      },
    },
    {
      type: "pull_request",
      parameters: {
        required_approving_review_count: 1,
        dismiss_stale_reviews_on_push: true,
        require_code_owner_review: true,
        require_last_push_approval: true,
        required_review_thread_resolution: true,
      },
    },
  ],
});

/** Reguły w kształcie `GET /repos/{repo}/rules/branches/main` dla zadeklarowanego pliku. */
const asLive = (ruleset: Ruleset): LiveRule[] =>
  ruleset.rules.map((rule) => ({ ...rule, ruleset_id: 1, ruleset_source: "x/y" }));

describe("prawdziwe pliki repozytorium", () => {
  it("ruleset main nakłada się bez zatrzymania Lovable i wymaga checków, które PR-y raportują", () => {
    expect(rulesetIssues(realRuleset(), realContext())).toEqual([]);
  });

  it("wymagane statusy to checki workflowów jadących na pull_request, przypięte do GitHub Actions", () => {
    const checks = realRuleset().rules.find((r) => r.type === "required_status_checks");
    const list = checks?.parameters?.["required_status_checks"] as {
      context: string;
      integration_id: number;
    }[];
    expect(list.map((c) => c.context)).toEqual(["Required release checks", "e2e", "e2e-seeded"]);
    expect(new Set(list.map((c) => c.integration_id))).toEqual(new Set([GITHUB_ACTIONS_APP_ID]));
    const reported = realContext()
      .workflows.filter((w) => w.pullRequest)
      .flatMap((w) => w.checks);
    for (const { context } of list) expect(reported).toContain(context);
  });

  it("Lovable omija ruleset trybem „always” - push na main nie przechodzi przez PR", () => {
    expect(realRuleset().bypass_actors).toContainEqual({
      actor_type: "Integration",
      app_slug: LOVABLE_APP_SLUG,
      bypass_mode: "always",
    });
  });

  it("plik sprzed naprawy jest odrzucony: zatrzymałby Lovable i żadnego PR-a nie dałoby się scalić", () => {
    const issues = rulesetIssues(parsed(PRE_FIX), realContext());
    expect(
      issues.some((i) => i.includes(`obejścia „always" dla aplikacji ${LOVABLE_APP_SLUG}`)),
    ).toBe(true);
    expect(issues.some((i) => i.includes("autor PR-a nie zatwierdzi własnego"))).toBe(true);
    expect(issues.some((i) => i.includes(`bez integration_id ${GITHUB_ACTIONS_APP_ID}`))).toBe(
      true,
    );
  });

  it("CODEOWNERS: domyślna reguła `*` ma jednego właściciela", () => {
    expect(realContext().defaultCodeOwners).toEqual(["@NewEUStrategies"]);
  });
});

describe("workflowChecks", () => {
  it("nazwa checka = `name:` joba albo jego identyfikator; pull_request z bloku `on:`", () => {
    const yaml = [
      "name: CI",
      "on:",
      "  push:",
      "    branches: [main]",
      "  pull_request:",
      "jobs:",
      "  verify:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - name: krok, nie job",
      "  release-gate:",
      '    name: "Required release checks"',
      "    needs: [verify]",
    ].join("\n");
    expect(workflowChecks("ci.yml", yaml)).toEqual({
      file: "ci.yml",
      pullRequest: true,
      checks: ["verify", "Required release checks"],
    });
  });

  it("`on:` w jednej linii; pull_request_target i sam push nie są pull_request", () => {
    const job = "jobs:\n  a:\n    runs-on: x\n";
    expect(workflowChecks("a", `on: [push, pull_request]\n${job}`).pullRequest).toBe(true);
    expect(workflowChecks("b", `on: [push, pull_request_target]\n${job}`).pullRequest).toBe(false);
    expect(workflowChecks("c", `on:\n  push:\n  workflow_dispatch:\n${job}`).pullRequest).toBe(
      false,
    );
  });

  it("prawdziwe workflowy: CI i E2E jadą na PR-ach, pomiar widgetów CMS nie", () => {
    const byFile = new Map(realContext().workflows.map((w) => [w.file, w]));
    expect(byFile.get("ci.yml")).toMatchObject({ pullRequest: true });
    expect(byFile.get("ci.yml")?.checks).toContain("Required release checks");
    expect(byFile.get("e2e.yml")?.checks).toEqual(["e2e", "e2e-seeded"]);
    expect(byFile.get("cms-widget-performance.yml")?.pullRequest).toBe(false);
  });
});

describe("rulesetIssues - każda reguła łapie swój błąd", () => {
  const context: RulesetContext = {
    workflows: [{ file: "ci.yml", pullRequest: true, checks: ["Required release checks"] }],
    defaultCodeOwners: ["@owner"],
  };
  const base = (): Ruleset => realRuleset();
  const withRules = (rules: Ruleset["rules"]): Ruleset => ({ ...base(), rules });
  const statusRule = (contexts: { context: string; integration_id?: number }[]) => ({
    type: "required_status_checks",
    parameters: { strict_required_status_checks_policy: false, required_status_checks: contexts },
  });
  const keep = (type: string) => base().rules.filter((r) => r.type === type);

  it("zielony przypadek wzorcowy", () => {
    const ok = withRules([
      ...keep("deletion"),
      ...keep("non_fast_forward"),
      statusRule([{ context: "Required release checks", integration_id: GITHUB_ACTIONS_APP_ID }]),
    ]);
    expect(rulesetIssues(ok, context)).toEqual([]);
  });

  it("status, którego żaden workflow PR nie raportuje", () => {
    const issues = rulesetIssues(
      withRules([
        ...keep("deletion"),
        ...keep("non_fast_forward"),
        statusRule([{ context: "e2e", integration_id: GITHUB_ACTIONS_APP_ID }]),
      ]),
      context,
    );
    expect(issues).toEqual([expect.stringContaining('„e2e" nie jest checkiem')]);
  });

  it("brak obejścia Lovable albo obejście tylko przez PR", () => {
    const rules = [...keep("deletion"), ...keep("non_fast_forward"), ...keep("pull_request")];
    const none = { ...withRules(rules), bypass_actors: [] };
    const viaPr: Ruleset = {
      ...withRules(rules),
      bypass_actors: [
        { actor_type: "Integration", app_slug: LOVABLE_APP_SLUG, bypass_mode: "pull_request" },
      ],
    };
    for (const ruleset of [none, viaPr])
      expect(rulesetIssues(ruleset, context)).toEqual([
        expect.stringContaining("zatrzymałyby push Lovable"),
      ]);
    // Same reguły integralności (bez PR-a i statusów) nie blokują pushu - obejście zbędne.
    expect(
      rulesetIssues(
        { ...withRules([...keep("deletion"), ...keep("non_fast_forward")]), bypass_actors: [] },
        context,
      ),
    ).toEqual([]);
  });

  it("zatwierdzenie review przy jednym Code Ownerze; przy dwóch przechodzi", () => {
    const pr = {
      type: "pull_request",
      parameters: { required_approving_review_count: 1, require_code_owner_review: false },
    };
    const ruleset = withRules([...keep("deletion"), ...keep("non_fast_forward"), pr]);
    expect(rulesetIssues(ruleset, context)).toEqual([
      expect.stringContaining("autor PR-a nie zatwierdzi własnego"),
    ]);
    expect(rulesetIssues(ruleset, { ...context, defaultCodeOwners: ["@a", "@b"] })).toEqual([]);
  });

  it("brak deletion/non_fast_forward, zły enforcement i zakres gałęzi", () => {
    const broken: Ruleset = {
      ...withRules([]),
      enforcement: "disabled",
      conditions: { ref_name: { include: ["refs/heads/dev"], exclude: [] } },
    };
    const issues = rulesetIssues(broken, context);
    expect(issues).toHaveLength(4);
    expect(issues.join("\n")).toMatch(/enforcement „disabled"/);
    expect(issues.join("\n")).toMatch(/refs\/heads\/main/);
    expect(issues.join("\n")).toMatch(/deletion/);
    expect(issues.join("\n")).toMatch(/non_fast_forward/);
  });

  it("obejście bez identyfikatora", () => {
    const ruleset: Ruleset = {
      ...withRules([...keep("deletion"), ...keep("non_fast_forward")]),
      bypass_actors: [{ actor_type: "RepositoryRole", bypass_mode: "always" }],
    };
    expect(rulesetIssues(ruleset, context)).toEqual([
      expect.stringContaining("RepositoryRole bez actor_id"),
    ]);
  });
});

describe("rulesetDrift - deklaracja kontra reguły stosowane przez GitHuba", () => {
  it("brak jakiejkolwiek reguły to jeden, jednoznaczny komunikat (stan z audytu)", () => {
    expect(rulesetDrift(realRuleset(), [])).toEqual([
      expect.stringContaining("nie działa ŻADNA reguła"),
    ]);
  });

  it("pełna zgodność; reguły ponad deklarację nie są rozjazdem", () => {
    const ruleset = realRuleset();
    expect(rulesetDrift(ruleset, [...asLive(ruleset), { type: "required_signatures" }])).toEqual(
      [],
    );
  });

  it("brak reguły, zmieniony parametr i brakujący wymagany status", () => {
    const ruleset = realRuleset();
    const live = asLive(ruleset)
      .filter((rule) => rule.type !== "deletion")
      .map((rule) => {
        if (rule.type === "pull_request")
          return {
            ...rule,
            parameters: { ...rule.parameters, required_review_thread_resolution: false },
          };
        if (rule.type === "required_status_checks")
          return {
            ...rule,
            parameters: {
              ...rule.parameters,
              required_status_checks: [{ context: "e2e", integration_id: GITHUB_ACTIONS_APP_ID }],
            },
          };
        return rule;
      });
    const drift = rulesetDrift(ruleset, live);
    expect(drift).toEqual([
      "brak reguły deletion na main",
      expect.stringContaining('brak „Required release checks"'),
      expect.stringContaining('brak „e2e-seeded"'),
      expect.stringContaining("pull_request.required_review_thread_resolution: zadeklarowane true"),
    ]);
  });

  it("status spełniany przez inną aplikację niż GitHub Actions to rozjazd", () => {
    const ruleset = realRuleset();
    const live = asLive(ruleset).map((rule) =>
      rule.type === "required_status_checks"
        ? {
            ...rule,
            parameters: {
              ...rule.parameters,
              required_status_checks: (
                rule.parameters?.["required_status_checks"] as { context: string }[]
              ).map(({ context }) => ({ context })),
            },
          }
        : rule,
    );
    expect(rulesetDrift(ruleset, live)).toHaveLength(3);
  });
});

describe("rulesetPayload", () => {
  it("app_slug zamienia na actor_id; reszta payloadu bez zmian", () => {
    const ruleset = realRuleset();
    const payload = rulesetPayload(ruleset, new Map([[LOVABLE_APP_SLUG, 123]]));
    expect(payload["bypass_actors"]).toEqual([
      { actor_type: "Integration", actor_id: 123, bypass_mode: "always" },
    ]);
    expect(payload["rules"]).toEqual(ruleset.rules);
    expect(JSON.stringify(payload)).not.toContain("app_slug");
  });

  it("nierozwiązana aplikacja przerywa nałożenie", () => {
    expect(() => rulesetPayload(realRuleset(), new Map())).toThrow(LOVABLE_APP_SLUG);
  });
});

describe("parseRuleset i defaultCodeOwners", () => {
  it("niepoprawny JSON i brak pól to błąd z nazwą pliku", () => {
    expect(parseRuleset("{")).toEqual({ error: expect.stringContaining(RULESET_PATH) });
    expect(parseRuleset("{}")).toEqual({ error: expect.stringContaining("brak name") });
  });

  it("ostatnia reguła `*` wygrywa, komentarze i ścieżki pomijane", () => {
    const text = "# komentarz\n* @a\n/docs/ @c\n*   @b @d\n";
    expect(defaultCodeOwners(text)).toEqual(["@b", "@d"]);
    expect(defaultCodeOwners("/src/ @x\n")).toEqual([]);
  });
});

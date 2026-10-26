// Czysta logika rulesetu gałęzi main (governance/release/main-ruleset.json).
//
// PRZYCZYNA (audyt wydania 2026-10): plik deklarował `enforcement: active`,
// a na GitHubie nie działała żadna reguła - main nie miał ochrony i nic tego
// nie zgłaszało. Do tego treść była sprzeczna z faktycznym kanałem wdrożenia:
// wymagała PR-a i review Code Ownera bez `bypass_actors`, a Lovable
// (gpt-engineer-app[bot]) pushuje commity prosto na main. Nałożenie pliku bez
// zmian zatrzymałoby publikacje Lovable, a review Code Ownera nie dałoby się
// spełnić: jedynym Code Ownerem jest konto, z którego powstają PR-y, a autor
// nie zatwierdza własnego PR-a.
//
// Moduł zamyka obie klasy błędu:
//   * `rulesetIssues` - ruleset musi dać się nałożyć bez zatrzymania kanału
//     Lovable i bez warunku, którego nikt nie spełni, a wymagane statusy muszą
//     być nazwami checków, które workflowy faktycznie raportują na PR-ach;
//   * `rulesetDrift` - porównanie z regułami, które GitHub NAPRAWDĘ stosuje
//     do main (`GET /repos/{repo}/rules/branches/main`), żeby „zadeklarowany,
//     ale niezastosowany" był czerwonym przebiegiem, a nie cichą fikcją.
//
// Format pliku = payload REST API rulesetów z jednym wyjątkiem: wpis
// `bypass_actors` aplikacji ma `app_slug` zamiast liczbowego `actor_id`.
// Identyfikator aplikacji rozwiązuje `bun run governance:apply-ruleset`
// (publiczne `GET /apps/{slug}`) - w repo nie ma liczby, której nie da się
// sprawdzić.

export const RULESET_PATH = "governance/release/main-ruleset.json";
export const RULESET_BRANCH = "main";
/** Aplikacja GitHub Actions - jedyne źródło, które może spełnić wymagany status. */
export const GITHUB_ACTIONS_APP_ID = 15368;
/** Aplikacja Lovable; jej bot `gpt-engineer-app[bot]` pushuje na main bez PR-a. */
export const LOVABLE_APP_SLUG = "gpt-engineer-app";

export interface BypassActor {
  readonly actor_type: string;
  readonly actor_id?: number;
  readonly app_slug?: string;
  readonly bypass_mode: string;
}

export interface RulesetRule {
  readonly type: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
}

export interface Ruleset {
  readonly name: string;
  readonly target: string;
  readonly enforcement: string;
  readonly conditions: {
    readonly ref_name: { readonly include: readonly string[]; readonly exclude: readonly string[] };
  };
  readonly bypass_actors: readonly BypassActor[];
  readonly rules: readonly RulesetRule[];
}

interface StatusCheck {
  readonly context: string;
  readonly integration_id?: number;
}

/** Reguła z `GET /repos/{repo}/rules/branches/{branch}` (pola, których używamy). */
export interface LiveRule {
  readonly type: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
}

/** Checki, które workflow raportuje, i czy w ogóle jedzie na PR-ach. */
export interface WorkflowChecks {
  readonly file: string;
  readonly pullRequest: boolean;
  /** Nazwa checka = `name:` joba albo jego identyfikator. */
  readonly checks: readonly string[];
}

export interface RulesetContext {
  readonly workflows: readonly WorkflowChecks[];
  /** Właściciele domyślnej reguły `*` z `.github/CODEOWNERS`. */
  readonly defaultCodeOwners: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function parseRuleset(text: string): Ruleset | { readonly error: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { error: `${RULESET_PATH}: niepoprawny JSON (${(error as Error).message})` };
  }
  if (!isRecord(value)) return { error: `${RULESET_PATH}: oczekiwano obiektu` };
  const conditions = value["conditions"];
  const refName = isRecord(conditions) ? conditions["ref_name"] : undefined;
  if (
    typeof value["name"] !== "string" ||
    typeof value["target"] !== "string" ||
    typeof value["enforcement"] !== "string" ||
    !isRecord(refName) ||
    !Array.isArray(refName["include"]) ||
    !Array.isArray(value["bypass_actors"]) ||
    !Array.isArray(value["rules"])
  ) {
    return {
      error: `${RULESET_PATH}: brak name/target/enforcement/conditions.ref_name/bypass_actors/rules`,
    };
  }
  const exclude = Array.isArray(refName["exclude"]) ? refName["exclude"] : [];
  return {
    ...(value as unknown as Ruleset),
    conditions: { ref_name: { include: refName["include"] as string[], exclude } },
  };
}

const indentOf = (line: string): number => line.length - line.trimStart().length;
const isContent = (line: string): boolean => line.trim() !== "" && !line.trim().startsWith("#");
const unquote = (text: string): string => text.trim().replace(/^(["'])(.*)\1$/, "$2");

/**
 * Checki workflowu z YAML-a czytanego wcięciami (bez zależności): workflowy mają
 * przewidywalny kształt, a brakujący job ma zapalić test, nie formatowanie.
 */
export function workflowChecks(file: string, yaml: string): WorkflowChecks {
  const lines = yaml.split(/\r?\n/);
  let pullRequest = false;
  const checks: string[] = [];
  let section: "on" | "jobs" | null = null;
  let job: { id: string; name: string | null } | null = null;
  const flush = (): void => {
    if (job) checks.push(job.name ?? job.id);
    job = null;
  };
  for (const line of lines) {
    if (!isContent(line)) continue;
    const indent = indentOf(line);
    const text = line.trim();
    if (indent === 0) {
      flush();
      const onInline = /^(?:on|"on"|'on'):\s*(.+)$/.exec(text);
      if (onInline) pullRequest ||= /\bpull_request\b(?!_)/.test(onInline[1]!);
      section = /^(?:on|"on"|'on'):\s*$/.test(text) ? "on" : text === "jobs:" ? "jobs" : null;
      continue;
    }
    if (section === "on" && indent === 2 && /^pull_request\s*:/.test(text)) pullRequest = true;
    if (section !== "jobs") continue;
    if (indent === 2) {
      flush();
      const id = /^([A-Za-z0-9_-]+):\s*$/.exec(text)?.[1];
      if (id) job = { id, name: null };
    } else if (indent === 4 && job !== null) {
      const name = /^name:\s*(.+)$/.exec(text)?.[1];
      if (name) (job as { name: string | null }).name = unquote(name);
    }
  }
  flush();
  return { file, pullRequest, checks };
}

/** Właściciele z reguły `*` (ostatnie trafienie, jak liczy GitHub). */
export function defaultCodeOwners(codeowners: string): string[] {
  const rules = codeowners
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("* ") || line === "*");
  return rules.at(-1)?.split(/\s+/).slice(1) ?? [];
}

const ruleOf = (ruleset: Ruleset, type: string): RulesetRule | undefined =>
  ruleset.rules.find((rule) => rule.type === type);

function statusChecks(rule: RulesetRule | undefined): StatusCheck[] {
  const list = rule?.parameters?.["required_status_checks"];
  return Array.isArray(list) ? (list as StatusCheck[]) : [];
}

/** Problemy, przez które ruleset nie da się nałożyć albo nie chroni tego, co deklaruje. */
export function rulesetIssues(ruleset: Ruleset, context: RulesetContext): string[] {
  const issues: string[] = [];
  if (ruleset.enforcement !== "active")
    issues.push(`enforcement „${ruleset.enforcement}" - ruleset main ma być aktywny`);
  if (ruleset.target !== "branch") issues.push(`target „${ruleset.target}" zamiast „branch"`);
  if (!ruleset.conditions.ref_name.include.includes(`refs/heads/${RULESET_BRANCH}`))
    issues.push(`conditions.ref_name.include nie obejmuje refs/heads/${RULESET_BRANCH}`);
  for (const type of ["deletion", "non_fast_forward"])
    if (!ruleOf(ruleset, type)) issues.push(`brak reguły ${type} - main da się usunąć/przepisać`);

  for (const actor of ruleset.bypass_actors) {
    const id =
      actor.actor_type === "Integration" ? (actor.actor_id ?? actor.app_slug) : actor.actor_id;
    if (id === undefined || id === null || id === "")
      issues.push(`bypass_actors: wpis ${actor.actor_type} bez actor_id/app_slug`);
  }

  // Lovable pushuje prosto na main. Reguła, której direct push nie spełni
  // (PR, wymagany status), bez obejścia dla aplikacji Lovable zatrzymuje
  // publikacje - obejście „pull_request" tu nie wystarcza, bo pushu bez PR-a nie ma.
  const blocksDirectPush = ["pull_request", "required_status_checks"].filter((type) =>
    ruleOf(ruleset, type),
  );
  const lovable = ruleset.bypass_actors.find(
    (actor) => actor.actor_type === "Integration" && actor.app_slug === LOVABLE_APP_SLUG,
  );
  if (blocksDirectPush.length > 0 && lovable?.bypass_mode !== "always")
    issues.push(
      `reguły ${blocksDirectPush.join(", ")} bez obejścia „always" dla aplikacji ${LOVABLE_APP_SLUG} zatrzymałyby push Lovable na main`,
    );

  const pr = ruleOf(ruleset, "pull_request")?.parameters ?? {};
  const approvals = Number(pr["required_approving_review_count"] ?? 0);
  const codeOwnerReview = pr["require_code_owner_review"] === true;
  if ((approvals > 0 || codeOwnerReview) && context.defaultCodeOwners.length < 2)
    issues.push(
      `pull_request wymaga zatwierdzenia (${approvals} review${codeOwnerReview ? ", Code Owner" : ""}), a CODEOWNERS ma jednego właściciela (${context.defaultCodeOwners.join(" ") || "brak"}) - autor PR-a nie zatwierdzi własnego, więc żaden PR nie dałby się scalić`,
    );

  const reported = new Map<string, string[]>();
  for (const workflow of context.workflows) {
    if (!workflow.pullRequest) continue;
    for (const check of workflow.checks)
      reported.set(check, [...(reported.get(check) ?? []), workflow.file]);
  }
  for (const check of statusChecks(ruleOf(ruleset, "required_status_checks"))) {
    if (!reported.has(check.context))
      issues.push(
        `wymagany status „${check.context}" nie jest checkiem żadnego workflowu jadącego na pull_request - PR-y czekałyby na niego bez końca`,
      );
    if (check.integration_id !== GITHUB_ACTIONS_APP_ID)
      issues.push(
        `wymagany status „${check.context}" bez integration_id ${GITHUB_ACTIONS_APP_ID} (GitHub Actions) - spełni go dowolna aplikacja z uprawnieniem do statusów`,
      );
  }
  return issues;
}

/** Payload REST API: `app_slug` zamieniony na `actor_id` rozwiązany przez wywołującego. */
export function rulesetPayload(
  ruleset: Ruleset,
  appIds: ReadonlyMap<string, number>,
): Record<string, unknown> {
  const bypass = ruleset.bypass_actors.map(({ app_slug: slug, ...actor }) => {
    if (slug === undefined) return actor;
    const id = appIds.get(slug);
    if (id === undefined) throw new Error(`nie rozwiązano identyfikatora aplikacji ${slug}`);
    return { ...actor, actor_id: id };
  });
  return { ...ruleset, bypass_actors: bypass };
}

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Rozjazd między deklaracją a regułami, które GitHub stosuje do main. Pusta
 * lista = każda zadeklarowana reguła działa z zadeklarowanymi parametrami
 * (reguły ponad deklarację nie są rozjazdem - może je dokładać organizacja).
 * Obejść (`bypass_actors`) API reguł gałęzi nie pokazuje, więc nie porównujemy ich.
 */
export function rulesetDrift(ruleset: Ruleset, live: readonly LiveRule[]): string[] {
  if (live.length === 0)
    return [
      `na ${RULESET_BRANCH} nie działa ŻADNA reguła - ${RULESET_PATH} nie jest zastosowany na GitHubie`,
    ];
  const drift: string[] = [];
  for (const rule of ruleset.rules) {
    const matches = live.filter((candidate) => candidate.type === rule.type);
    if (matches.length === 0) {
      drift.push(`brak reguły ${rule.type} na ${RULESET_BRANCH}`);
      continue;
    }
    for (const [key, expected] of Object.entries(rule.parameters ?? {})) {
      if (key === "required_status_checks") {
        const declared = expected as StatusCheck[];
        const liveChecks = matches.flatMap((match) => statusChecks(match));
        for (const check of declared)
          if (
            !liveChecks.some(
              (other) =>
                other.context === check.context && other.integration_id === check.integration_id,
            )
          )
            drift.push(
              `required_status_checks: brak „${check.context}" (integration_id ${String(check.integration_id)})`,
            );
        continue;
      }
      if (!matches.some((match) => sameValue(match.parameters?.[key], expected)))
        drift.push(
          `${rule.type}.${key}: zadeklarowane ${JSON.stringify(expected)}, na GitHubie ${matches.map((match) => JSON.stringify(match.parameters?.[key])).join(" / ")}`,
        );
    }
  }
  return drift;
}

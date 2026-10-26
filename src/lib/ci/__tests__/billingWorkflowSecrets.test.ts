// @vitest-environment node
//
// SEKRETY ROZLICZEŃ W WORKFLOW GITHUB ACTIONS - kto je widzi i który endpoint
// dostaje który sekret.
//
// JAKIE RYZYKO PILNUJE TEN PLIK.
//   1. `billing-nightly.yml` trzymał klucz Stripe sandbox i klucz bramki
//      w env JOBA, czyli widział je każdy krok - także akcje zewnętrzne
//      przypięte samym tagiem (`oven-sh/setup-bun@v2`). Przesunięty tag
//      podmienia kod uruchamiany obok sekretów bez śladu w repo, a od PAY-17c
//      dochodzi tam klucz `service_role` NASZEJ bazy. Sekrety mają być w env
//      wyłącznie tych kroków, które ich używają, a akcje przypięte do SHA.
//   2. `scheduler.yml` wołał `/api/public/billing-cron` sekretem społeczności.
//      Endpoint przestał go przyjmować (PAY-17a), więc dobowy przebieg
//      rozliczeń musi jechać WŁASNYM sekretem - bez „spadania" na sekret
//      społeczności, gdy własnego brakuje.
//   3. Sonda trzymała klucz `service_role` PRODUKCJI w sekretach repo - każdy
//      workflow wypchnięty na gałąź mógł go wypisać (przegląd 7.6). Teraz
//      żaden workflow nie dostaje klucza `service_role`.
//   4. `scheduler.yml` niósł BILLING_CRON_SECRET obok `actions/checkout@v7`
//      (tag, nie SHA) - przegląd 3.6/7.10. Pinowanie obowiązuje KAŻDY workflow
//      z sekretem rozliczeń, nie tylko nocną sondę.
//
// Parsujemy YAML wcięciami, bez zależności: workflow ma przewidywalny kształt,
// a test ma się zapalić przy przesunięciu sekretu, nie przy zmianie formatowania.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Block {
  /** Pierwsza linia bloku (np. `- name: Tick`). */
  readonly head: string;
  readonly lines: readonly string[];
}

const indentOf = (line: string): number => line.length - line.trimStart().length;
const isContent = (line: string): boolean => line.trim() !== "" && !line.trim().startsWith("#");

/** Linie bloku zaczynającego się w `start` (wszystko głębiej wcięte niż jego nagłówek). */
function blockAt(lines: readonly string[], start: number): Block {
  const head = lines[start]!;
  const base = indentOf(head);
  const body: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (isContent(line) && indentOf(line) <= base) break;
    body.push(line);
  }
  return { head, lines: [head, ...body] };
}

/** Kroki joba: bloki zaczynające się od `- ` na poziomie listy `steps:`. */
function stepsOf(lines: readonly string[]): Block[] {
  const stepsLine = lines.findIndex((line) => line.trim() === "steps:");
  if (stepsLine < 0) throw new Error("test: workflow bez `steps:`");
  const steps: Block[] = [];
  const stepIndent = indentOf(lines[stepsLine]!) + 2;
  for (let index = stepsLine + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (isContent(line) && indentOf(line) < stepIndent) break;
    if (indentOf(line) === stepIndent && line.trimStart().startsWith("- ")) {
      steps.push(blockAt(lines, index));
    }
  }
  return steps;
}

/** Env JOBA - blok `env:` wcięty jak `steps:`. */
function jobEnvOf(lines: readonly string[]): readonly string[] {
  const stepsLine = lines.findIndex((line) => line.trim() === "steps:");
  const jobIndent = indentOf(lines[stepsLine]!);
  const envLine = lines.findIndex(
    (line, index) => index < stepsLine && line.trim() === "env:" && indentOf(line) === jobIndent,
  );
  return envLine < 0 ? [] : blockAt(lines, envLine).lines;
}

const stepNamed = (steps: readonly Block[], name: string): Block => {
  const step = steps.find((candidate) =>
    candidate.lines.some(
      (line) => line.trim() === `name: ${name}` || line.trim() === `- name: ${name}`,
    ),
  );
  if (!step) throw new Error(`test: brak kroku „${name}"`);
  return step;
};

const text = (block: Block | readonly string[]): string =>
  ("lines" in block ? block.lines : block).join("\n");

/**
 * Sekrety, których WARTOŚĆ trafia do tekstu: każde odwołanie do kontekstu
 * `secrets` w wyrażeniu `${{ }}`. Notacja kropkowa w dowolnej pisowni
 * (`${{ secrets.X }}`, `${{secrets.x}}`, `${{ secrets.X || '' }}`) daje nazwę
 * wielkimi literami - GitHub nie rozróżnia wielkości liter nazw sekretów.
 * Dostęp bez nazwy po kropce (`secrets['X']`, `toJSON(secrets)`) daje `*`,
 * czyli „dowolny sekret". Pomija wyłącznie kontrolę obecności
 * `secrets.X != ''` - wyrażenie daje `true`/`false`, nie wartość. Napis
 * `secrets.X` poza `${{ }}` (komentarz, komunikat skryptu) niczego nie
 * podstawia.
 */
const secretValuesIn = (source: string): string[] =>
  [...source.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].flatMap(([, expression]) =>
    [...expression!.matchAll(/\bsecrets\b(?:\s*\.\s*([A-Z0-9_]+)\b(\s*!=\s*'')?)?/gi)]
      .filter(([, , presence]) => presence === undefined)
      .map(([, name]) => name?.toUpperCase() ?? "*"),
  );

/** Krok czyta wartość sekretu spełniającego `name` albo dowolnego (`*`). */
const readsSecret = (block: Block, name: (secret: string) => boolean): boolean =>
  secretValuesIn(text(block)).some((secret) => secret === "*" || name(secret));

describe("billing-nightly.yml - sekrety w krokach, akcje przypięte (PAY-17b)", () => {
  const lines = readFileSync(".github/workflows/billing-nightly.yml", "utf8").split("\n");
  const steps = stepsOf(lines);

  // KRYTERIUM PAY-17b.
  it("env JOBA nie zawiera żadnego sekretu", () => {
    const env = text(jobEnvOf(lines));

    expect(env).not.toMatch(/secrets\./);
    // Konfiguracja bez sekretów zostaje na poziomie joba.
    expect(env).toContain('PROBE_WAIT_TIMEOUT_MS: "1200000"');
    expect(env).toContain("PROBE_REQUIRE_CONFIG:");
  });

  it("klucze operatora widzą WYŁĄCZNIE trzy kroki sondy", () => {
    const withStripeKey = steps.filter((step) =>
      readsSecret(step, (name) => name === "STRIPE_SANDBOX_API_KEY"),
    );
    const withGatewayKey = steps.filter((step) =>
      readsSecret(step, (name) => name === "LOVABLE_API_KEY"),
    );

    for (const holders of [withStripeKey, withGatewayKey]) {
      expect(holders).toHaveLength(3);
      for (const step of holders) {
        expect(text(step)).toMatch(/run: bun scripts\/billing-renewal-probe\.ts (arm|wait|verify)/);
      }
    }
  });

  it("dostęp do naszej bazy (adres, klucz publikowalny, token sondy) widzi WYŁĄCZNIE krok weryfikacji", () => {
    // Wartość sekretu (także `secrets['X']`), nie kontrola obecności (`!= ''`).
    const holders = steps.filter((step) =>
      readsSecret(step, (name) => /^(PROBE_SUPABASE_[A-Z0-9_]+|BILLING_PROBE_TOKEN)$/.test(name)),
    );

    expect(holders).toHaveLength(1);
    const verify = text(holders[0]!);
    expect(verify).toContain("run: bun scripts/billing-renewal-probe.ts verify");
    expect(verify).toContain("PROBE_SUPABASE_URL: ${{ secrets.PROBE_SUPABASE_URL }}");
    expect(verify).toContain(
      "PROBE_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.PROBE_SUPABASE_PUBLISHABLE_KEY }}",
    );
    expect(verify).toContain("BILLING_PROBE_TOKEN: ${{ secrets.BILLING_PROBE_TOKEN }}");
    // Adres wdrożenia zawęża kontrolę punktu odbioru webhooków (przegląd 7.12).
    expect(verify).toContain("PROBE_APP_BASE_URL: ${{ vars.APP_BASE_URL }}");
  });

  // Audyt ED14: komplet konfiguracji jednym błędem, przed pierwszym krokiem
  // z wartością sekretu.
  it("kontrola konfiguracji sondy jest pierwsza, widzi tylko obecność i obejmuje KAŻDY sekret sondy", () => {
    const preflight = stepNamed(steps, "Sprawdź konfigurację sondy");
    const used = new Set(secretValuesIn(lines.join("\n")));

    expect(steps.indexOf(preflight)).toBe(0);
    expect(secretValuesIn(text(preflight))).toEqual([]);
    expect(used.size).toBe(5);
    for (const name of used) {
      expect(text(preflight)).toContain(`HAS_${name}: \${{ secrets.${name} != '' }}`);
      expect(text(preflight)).toMatch(new RegExp(`for name in [A-Z_ ]*\\b${name}\\b`));
    }
  });

  // KRYTERIUM przeglądu 7.6.
  it("ŻADEN krok nie dostaje klucza `service_role` (prawo zapisu do repo != dostęp do bazy)", () => {
    for (const step of steps) {
      expect(text(step)).not.toMatch(/secrets\.[A-Z_]*SERVICE_ROLE[A-Z_]*/);
    }
  });

  it("akcje zewnętrzne nie widzą sekretów i są przypięte do SHA z komentarzem wersji", () => {
    const actions = steps.filter((step) => text(step).includes("uses:"));

    expect(actions.length).toBeGreaterThanOrEqual(3);
    for (const step of actions) {
      expect(text(step)).not.toMatch(/secrets\./);
      const uses = step.lines.find((line) => line.includes("uses:"))!;
      expect(uses).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
    }
  });

  it("komentarze o czekaniu na Test Clock zgadzają się z PROBE_WAIT_TIMEOUT_MS (20 min)", () => {
    const workflow = lines.join("\n");

    expect(1_200_000 / 60_000).toBe(20);
    expect(workflow).not.toContain("sufit 40 min");
    expect(workflow).toContain("sufit 20 min");
    expect(workflow).not.toContain("PROBE_WAIT_TIMEOUT_S)");
  });
});

// KRYTERIUM PAY-17b (przegląd 3.6/7.10): KAŻDY workflow, który dotyka sekretu
// rozliczeń, ma akcje przypięte do SHA commita - nie tylko nocna sonda.
const BILLING_SECRET = /secrets\.(BILLING_[A-Z_]+|STRIPE_[A-Z_]+|PROBE_[A-Z_]+|LOVABLE_API_KEY)\b/;

describe.each(
  readdirSync(".github/workflows")
    .filter((name) => /\.ya?ml$/.test(name))
    .filter((name) => BILLING_SECRET.test(readFileSync(`.github/workflows/${name}`, "utf8"))),
)("%s - sekret rozliczeń obok akcji przypiętych do SHA (PAY-17b)", (name) => {
  const lines = readFileSync(`.github/workflows/${name}`, "utf8").split("\n");

  it("każde `uses:` wskazuje pełny SHA commita z komentarzem wersji", () => {
    const uses = lines.filter((line) => /^\s*(- )?uses:/.test(line));

    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) {
      expect(line).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
    }
  });
});

it("lista workflow z sekretem rozliczeń obejmuje scheduler i nocną sondę", () => {
  const holders = readdirSync(".github/workflows").filter((name) =>
    BILLING_SECRET.test(readFileSync(`.github/workflows/${name}`, "utf8")),
  );

  expect(holders).toEqual(expect.arrayContaining(["billing-nightly.yml", "scheduler.yml"]));
});

describe("scheduler.yml - dobowy przebieg rozliczeń jedzie własnym sekretem (PAY-17a)", () => {
  const lines = readFileSync(".github/workflows/scheduler.yml", "utf8").split("\n");
  const steps = stepsOf(lines);

  it("krok wołający billing-cron dostaje BILLING_CRON_SECRET i nic innego", () => {
    const billing = stepNamed(steps, "Tick rozliczeń");

    expect(text(billing)).toContain("SCHEDULER_SECRET: ${{ secrets.BILLING_CRON_SECRET }}");
    expect(text(billing)).not.toContain("COMMUNITY_CRON_SECRET");
    expect(text(billing)).toContain("steps.plan.outputs.endpoint == '/api/public/billing-cron'");
  });

  it("krok społeczności NIE biegnie dla billing-cron i nie zna sekretu rozliczeń", () => {
    const community = stepNamed(steps, "Tick");

    expect(text(community)).toContain("SCHEDULER_SECRET: ${{ secrets.COMMUNITY_CRON_SECRET }}");
    expect(text(community)).not.toContain("BILLING_CRON_SECRET");
    expect(text(community)).toContain("steps.plan.outputs.endpoint != '/api/public/billing-cron'");
  });

  it("żaden krok nie składa sekretów wyrażeniem `a && b || c` (cichy fallback)", () => {
    for (const step of steps) {
      expect(text(step)).not.toMatch(/secrets\.[A-Z_]+ \|\|/);
    }
  });

  // Przegląd 3.0: zamiatarka w billing-cron planuje pracę do terminu
  // wołającego. Trzy miejsca muszą znać TEN SAM termin: pg_net w invokerze,
  // scheduler repo i stała w kodzie endpointu.
  it("termin kroku rozliczeń = BILLING_CRON_CALLER_TIMEOUT_MS = timeout pg_net invokera", () => {
    const route = readFileSync("src/routes/api/public/billing-cron.ts", "utf8");
    const constant = /export const BILLING_CRON_CALLER_TIMEOUT_MS = ([\d_]+);/.exec(route)?.[1];
    expect(constant).toBeDefined();
    const ms = Number(constant!.replaceAll("_", ""));

    const migrations = readdirSync("supabase/migrations").filter((name) =>
      readFileSync(`supabase/migrations/${name}`, "utf8").includes(
        "CREATE OR REPLACE FUNCTION public.invoke_billing_cron()",
      ),
    );
    const latest = readFileSync(`supabase/migrations/${migrations.sort().at(-1)!}`, "utf8");
    expect(latest).toContain(`timeout_milliseconds := ${ms}`);
    // ... i puka WŁASNYM sekretem rozliczeń, nie sekretem runnera.
    expect(latest).toContain("'x-billing-cron-secret', cfg.billing_secret");

    const billing = stepNamed(steps, "Tick rozliczeń");
    expect(text(billing)).toContain(`SCHEDULER_TIMEOUT_MS: "${ms}"`);
  });

  it("dokumentacja sekretów nie podsuwa sekretu runnera jako sekretu rozliczeń", () => {
    // Nagłówek jako jeden akapit: bez `#` i łamania linii.
    const header = lines
      .filter((line) => line.startsWith("#"))
      .map((line) => line.replace(/^#\s*/, ""))
      .join(" ");
    const alternative =
      /secrets\.BILLING_CRON_SECRET\s+= env BILLING_CRON_SECRET aplikacji ALBO (\S+)/.exec(
        header,
      )?.[1];

    // Dawniej: „ALBO job_runner_settings.secret" - sekret, który otwiera też
    // community-cron i jobs-tick.
    expect(alternative).toBe("job_runner_settings.billing_secret");
  });

  it("kontrola konfiguracji wymaga sekretu WŁAŚCIWEGO dla zakresu i nie widzi wartości", () => {
    const cfg = stepNamed(steps, "Sprawdź konfigurację");
    const planIndex = steps.indexOf(stepNamed(steps, "Ustal zakres ticku"));

    // Zakres jest znany PRZED kontrolą - od niego zależy wymagany sekret.
    expect(planIndex).toBeLessThan(steps.indexOf(cfg));
    expect(text(cfg)).toContain("HAS_BILLING_SECRET: ${{ secrets.BILLING_CRON_SECRET != '' }}");
    expect(text(cfg)).toContain("HAS_COMMUNITY_SECRET: ${{ secrets.COMMUNITY_CRON_SECRET != '' }}");
    expect(secretValuesIn(text(cfg))).toEqual([]);
  });
});

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
//
// Parsujemy YAML wcięciami, bez zależności: workflow ma przewidywalny kształt,
// a test ma się zapalić przy przesunięciu sekretu, nie przy zmianie formatowania.
import { readFileSync } from "node:fs";
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
      text(step).includes("secrets.STRIPE_SANDBOX_API_KEY"),
    );
    const withGatewayKey = steps.filter((step) => text(step).includes("secrets.LOVABLE_API_KEY"));

    for (const holders of [withStripeKey, withGatewayKey]) {
      expect(holders).toHaveLength(3);
      for (const step of holders) {
        expect(text(step)).toMatch(/run: bun scripts\/billing-renewal-probe\.ts (arm|wait|verify)/);
      }
    }
  });

  it("klucz `service_role` naszej bazy widzi WYŁĄCZNIE krok weryfikacji", () => {
    const holders = steps.filter((step) => text(step).includes("secrets.PROBE_SUPABASE_"));

    expect(holders).toHaveLength(1);
    expect(text(holders[0]!)).toContain("run: bun scripts/billing-renewal-probe.ts verify");
    expect(text(holders[0]!)).toContain(
      "PROBE_SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.PROBE_SUPABASE_SERVICE_ROLE_KEY }}",
    );
    expect(text(holders[0]!)).toContain("PROBE_SUPABASE_URL: ${{ secrets.PROBE_SUPABASE_URL }}");
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

  it("kontrola konfiguracji wymaga sekretu WŁAŚCIWEGO dla zakresu i nie widzi wartości", () => {
    const cfg = stepNamed(steps, "Sprawdź konfigurację");
    const planIndex = steps.indexOf(stepNamed(steps, "Ustal zakres ticku"));

    // Zakres jest znany PRZED kontrolą - od niego zależy wymagany sekret.
    expect(planIndex).toBeLessThan(steps.indexOf(cfg));
    expect(text(cfg)).toContain("HAS_BILLING_SECRET: ${{ secrets.BILLING_CRON_SECRET != '' }}");
    expect(text(cfg)).toContain("HAS_COMMUNITY_SECRET: ${{ secrets.COMMUNITY_CRON_SECRET != '' }}");
    expect(text(cfg)).not.toMatch(/: \$\{\{ secrets\.[A-Z_]+ \}\}/);
  });
});

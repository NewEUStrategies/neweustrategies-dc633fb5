/**
 * Jedna komenda, która puszcza CAŁY zestaw tanich bramek blokujących - ten sam,
 * który przewraca CI, i w tej samej kolejności.
 *
 * PO CO TO ISTNIEJE. Bramki w tym repo są dobre; trzy wydania z rzędu przeszły
 * jednak z czerwonym CI, bo przed wypchnięciem NIKT ich nie uruchomił. Nie da
 * się tego naprawić kolejną bramką - trzeba, żeby uruchomienie całości było
 * jedną komendą i trwało sekundy, a nie żeby wymagało czytania
 * `.github/workflows/ci.yml` i przepisywania z niego 20 linii.
 *
 *     bun run verify:static     # sekundy - bramki statyczne
 *     bun run verify:blocking   # + typy, lint i testy (minuty)
 *
 * LISTA NIE JEST PRZEPISANA Z RĘKI. Bierzemy WSZYSTKIE skrypty `check:*`
 * z package.json i odejmujemy te, które czegoś wymagają (buildu, bazy,
 * klastra Postgresa) - każde wykluczenie z powodem, w `EXCLUDED` niżej.
 * Dzięki temu NOWA bramka wchodzi tu automatycznie: żeby jej tu nie było,
 * trzeba ją jawnie wykluczyć i napisać dlaczego. Odwrotna kolejność
 * (ręczna lista) rozjechałaby się z CI w pierwszym tygodniu.
 *
 * Usage: bun run verify:static
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Bramki, które NIE należą do zestawu statycznego - klucz: powód. */
const EXCLUDED: Readonly<Record<string, string>> = {
  "check:bundle": "mierzy artefakt buildu (.output) - wymaga `bun run build`",
  "check:chunks": "graf chunków z artefaktu buildu",
  "check:entry-purity": "chunk startowy z artefaktu buildu",
  "check:db-contract": "sonduje Data API - wymaga SUPABASE_URL i klucza",
  // Ta sama klasa co `check:db-contract`: bramka PO WDROŻENIU, pyta wdrożoną
  // bazę o rejestr migracji przez RPC. W CI jedzie WYŁĄCZNIE w jobie
  // `post-deploy` (push na main / workflow_dispatch), z sekretami - PR-a nie
  // bramkuje w ogóle. Bez wykluczenia `verify:static` był czerwony u każdego,
  // kto nie ma poświadczeń produkcyjnych, i to na bramce, która i tak nie
  // decyduje o jego zmianie: całe narzędzie „uruchom bramki przed pushem"
  // przestawało być uruchamialne.
  "check:migration-ledger": "sonduje wdrożoną bazę (RPC) - wymaga SUPABASE_URL i klucza",
  "check:pg-harness": "stawia własny klaster PostgreSQL 16",
  "check:careers-harness": "jw. - klaster PostgreSQL 16",
  // Trzy uprzęże dopisane po tym, jak powstała ta lista. Robią dokładnie to
  // samo, co dwie wyżej (`initdb` + własny klaster na własnym porcie), więc
  // należą tu z tego samego powodu - automatyczne wciąganie nowych bramek
  // złapało je jako „statyczne", choć żadna nie czyta wyłącznie plików repo.
  "check:events-harness": "jw. - klaster PostgreSQL 16 (port 5436)",
  "check:programs-harness": "jw. - klaster PostgreSQL 16",
  "check:tenant-isolation": "jw. - klaster PostgreSQL 16 (asercje RLS na żywej bazie)",
  "check:chunk-parity": "test vitest - jedzie w `bun run test`",
  "check:permissions-parity": "testy vitest - jadą w `bun run test`",
  "check:i18n-parity": "testy vitest - jadą w `bun run test`",
  "check:ci-gates": "testy vitest - jadą w `bun run test`",
  "check:widget-fidelity": "testy vitest - jadą w `bun run test`",
};

/**
 * Kolejność po KOSZCIE, nie alfabetycznie: pierwszy sygnał ma przyjść
 * najszybciej. `format:check` idzie przed wszystkim, bo dokładnie ta klasa
 * (115 błędów prettier/prettier) blokowała ostatnie wydanie, a jej wykrycie
 * kosztuje sekundy - podczas gdy `bun run lint` liczy je minutami.
 */
const FIRST: readonly string[] = ["format:check", "check:gate-coverage"];

interface PackageManifest {
  readonly scripts?: Readonly<Record<string, string>>;
}

function gateNames(): string[] {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as PackageManifest;
  const names = Object.keys(manifest.scripts ?? {});
  const gates = names
    .filter((name) => name.startsWith("check:"))
    .filter((name) => !(name in EXCLUDED))
    .filter((name) => !FIRST.includes(name))
    .sort();
  return [...FIRST.filter((name) => names.includes(name)), ...gates];
}

interface StepResult {
  readonly name: string;
  readonly ms: number;
  readonly ok: boolean;
}

function run(name: string): StepResult {
  const started = Date.now();
  const result = spawnSync("bun", ["run", name], { stdio: "inherit" });
  return { name, ms: Date.now() - started, ok: result.status === 0 };
}

function main(): void {
  const steps = gateNames();
  console.log(`[verify:static] ${steps.length} bramek, kolejność po koszcie.\n`);

  const done: StepResult[] = [];
  for (const name of steps) {
    const result = run(name);
    done.push(result);
    if (result.ok) continue;

    const spent = done.reduce((sum, step) => sum + step.ms, 0);
    console.error(
      [
        "",
        `✗ [verify:static] OBLANE na: ${name}  (po ${(spent / 1000).toFixed(1)} s)`,
        `  Pozostałe ${steps.length - done.length} bramek NIE zostały uruchomione -`,
        "  napraw tę i puść ponownie. Dokładnie ten sam krok przewróci CI.",
      ].join("\n"),
    );
    process.exit(1);
  }

  const total = done.reduce((sum, step) => sum + step.ms, 0);
  const slowest = [...done].sort((a, b) => b.ms - a.ms).slice(0, 3);
  console.log(
    [
      "",
      `✓ [verify:static] ${done.length} bramek OK w ${(total / 1000).toFixed(1)} s.`,
      `  Najdroższe: ${slowest.map((step) => `${step.name} (${(step.ms / 1000).toFixed(1)} s)`).join(", ")}.`,
      `  Wykluczone z tego zestawu (${Object.keys(EXCLUDED).length}): wymagają buildu, bazy albo klastra - patrz EXCLUDED w scripts/verify-static.ts.`,
      "  Dalej: bun run verify:blocking (typy + lint + testy).",
    ].join("\n"),
  );
}

main();

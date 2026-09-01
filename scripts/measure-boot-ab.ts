// POMIAR PORÓWNAWCZY PIERWSZEGO WCZYTANIA: dwie rewizje, jedna miara.
//
// Usage:
//   bun run measure:boot-ab <rewizja-bazowa> [trasa]
//   bun run measure:boot-ab 1d5d0ed /cookies
//
// CO ROBI, KROK PO KROKU:
//   1. zakłada worktree na podanej rewizji bazowej (nie rusza drzewa roboczego);
//   2. buduje w nim artefakt `vite.smoke.config.ts` i mierzy go sondą;
//   3. buduje artefakt z BIEŻĄCEGO drzewa i mierzy go tą samą sondą;
//   4. wypisuje tabelę różnic z werdyktem „szum / różnica" na wiersz.
//
// ── DLACZEGO TO NIE JEST BRAMKA CI I NIE MA SIĘ NIĄ STAĆ ──────────────────
//
// Świadomie `measure:*`, a nie `check:*`: `scripts/check-gate-coverage.ts`
// wymaga, żeby KAŻDA bramka `check:*` była wpięta w workflow, i słusznie -
// bramka niewpięta wygląda w repo identycznie jak wpięta. Ten skrypt bramką nie
// jest z dwóch powodów, oba mierzalne:
//   * kosztuje DWA pełne buildy artefaktu (zmierzone: 1 min 47 s + 2 min 41 s
//     na hoście, w CI >= 3 min 30 s każdy) plus dwa przebiegi przeglądarki;
//   * jego wynik jest RÓŻNICĄ, a nie progiem. Nie ma liczby, przy której
//     „wolniej" powinno automatycznie wywalić przebieg: +11 KB za wcześniej
//     martwy hint słownika to dobry interes, a te same +11 KB za nic to zły.
//     Tę ocenę robi człowiek i dlatego to narzędzie odpowiada na pytanie,
//     a nie wydaje wyroku.
// Progów pilnuje `e2e/boot-timing.spec.ts` i on JEST wpięty w CI.
//
// ── OGRANICZENIE, KTÓREGO NIE WOLNO PRZEMILCZEĆ ───────────────────────────
//
// Artefakt smoke gada z ZAŚLEPKĄ Supabase, więc żadne zapytanie nie wraca
// z danymi. To znaczy, że najważniejszy zysk prefetchu SSR - treść obecna
// w PIERWSZYM dokumencie zamiast dociągana po hydratacji - tym pomiarem jest
// NIEMIERZALNY, a `htmlTextChars` po obu stronach pokaże tę samą statyczną
// powłokę. Skrypt wypisuje to ostrzeżenie na końcu każdego przebiegu, żeby
// czytelnik tabeli nie wziął „zero różnicy w treści" za „prefetch nic nie dał".
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  diffSamples,
  formatReport,
  modulepreloadTargets,
  parseProbeOutput,
  type BootSample,
} from "./lib/bootAbReport";

/** Porty: dwa różne, bo oba serwery mogą stać równolegle. */
const PORT_BEFORE = 4194;
const PORT_AFTER = 4195;

const REPO_ROOT = process.cwd();

function run(
  command: string,
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; label: string },
): { ok: boolean; stdout: string } {
  process.stderr.write(`  -> ${options.label}\n`);
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...options.env },
  });
  const stdout = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return { ok: result.status === 0, stdout };
}

/** Zaślepki Supabase - te same, których używa CI, żeby nie mierzyć innej rzeczy. */
const PLACEHOLDER_ENV: NodeJS.ProcessEnv = {
  VITE_SUPABASE_URL: "https://placeholder.supabase.co",
  VITE_SUPABASE_ANON_KEY: "placeholder-anon-key",
  VITE_SUPABASE_PUBLISHABLE_KEY: "placeholder-anon-key",
  NODE_OPTIONS: "--max-old-space-size=8192",
};

function buildArtifact(tree: string): boolean {
  return run("./node_modules/.bin/vite", ["build", "--config", "vite.smoke.config.ts"], {
    cwd: tree,
    env: PLACEHOLDER_ENV,
    label: `build artefaktu w ${tree}`,
  }).ok;
}

function probe(tree: string, label: string, port: number, route: string): BootSample | null {
  const { stdout } = run(
    "./node_modules/.bin/playwright",
    ["test", "--config", "playwright.ab.config.ts"],
    {
      cwd: tree,
      env: { NES_AB_LABEL: label, NES_AB_PORT: String(port), NES_AB_ROUTE: route },
      label: `pomiar ${label} na ${route}`,
    },
  );
  const sample = parseProbeOutput(stdout, label);
  if (!sample) process.stderr.write(stdout.split("\n").slice(-25).join("\n") + "\n");
  return sample;
}

function main(): number {
  const [baseRevision, routeArg] = process.argv.slice(2);
  if (!baseRevision) {
    process.stderr.write(
      "Podaj rewizję bazową, np. `bun run measure:boot-ab 1d5d0ed /cookies`.\n" +
        "Rewizja bazowa to punkt odniesienia - zwykle commit sprzed mierzonej zmiany.\n",
    );
    return 2;
  }
  const route = routeArg ?? "/cookies";

  const worktree = mkdtempSync(join(tmpdir(), "nes-boot-ab-"));
  let worktreeAdded = false;
  try {
    // `--detach`: nie zakładamy gałęzi, bo to pomiar, nie praca nad kodem.
    const added = run("git", ["worktree", "add", "--detach", worktree, baseRevision], {
      cwd: REPO_ROOT,
      label: `worktree bazowy na ${baseRevision}`,
    });
    if (!added.ok) {
      process.stderr.write(`Nie udało się założyć worktree na \`${baseRevision}\`.\n`);
      return 1;
    }
    worktreeAdded = true;

    // ZALEŻNOŚCI PRZEZ SYMLINK, nie przez `bun install`. Uzasadnienie: rewizja
    // bazowa i bieżąca muszą jechać na TYCH SAMYCH wersjach paczek, inaczej
    // porównanie mierzy też różnicę w bundlach vendorowych. Jeśli `package.json`
    // rewizji bazowej różni się zależnościami, symlink jest ZŁY - dlatego to
    // sprawdzamy i mówimy wprost, a nie po cichu.
    const baseDeps = run("git", ["show", `${baseRevision}:package.json`], {
      cwd: REPO_ROOT,
      label: "porównanie zależności bazy i HEAD-a",
    });
    if (baseDeps.ok) {
      const pick = (raw: string): string => {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (typeof parsed !== "object" || parsed === null) return "";
          const record = parsed as Record<string, unknown>;
          return JSON.stringify([record.dependencies, record.devDependencies]);
        } catch {
          return "";
        }
      };
      const headJson = run("git", ["show", "HEAD:package.json"], {
        cwd: REPO_ROOT,
        label: "odczyt package.json HEAD-a",
      });
      const baseRaw = baseDeps.stdout.slice(0, baseDeps.stdout.lastIndexOf("}") + 1);
      const headRaw = headJson.stdout.slice(0, headJson.stdout.lastIndexOf("}") + 1);
      if (pick(baseRaw) && pick(baseRaw) !== pick(headRaw)) {
        process.stderr.write(
          "UWAGA: rewizja bazowa ma INNE zależności niż HEAD. Współdzielone " +
            "`node_modules` sprawi, że baza pojedzie na wersjach paczek z HEAD-a, " +
            "a różnica w bundlach vendorowych wejdzie w pomiar. Wynik czytaj " +
            "wyłącznie dla metryk, które od tego nie zależą.\n",
        );
      }
    }
    symlinkSync(join(REPO_ROOT, "node_modules"), join(worktree, "node_modules"));

    // Harness pomiarowy pochodzi z BIEŻĄCEGO drzewa i jedzie po obu stronach.
    // Bez tego rewizja bazowa (która sondy nie zna) nie dałaby się zmierzyć,
    // a gdyby każda strona używała własnej wersji sondy, porównanie mierzyłoby
    // różnicę w sondzie.
    for (const asset of ["playwright.ab.config.ts", "e2e-ab"]) {
      const source = join(REPO_ROOT, asset);
      if (!existsSync(source)) {
        process.stderr.write(`Brak \`${asset}\` w bieżącym drzewie - nie ma czym mierzyć.\n`);
        return 1;
      }
      run("cp", ["-r", source, join(worktree, asset)], {
        cwd: REPO_ROOT,
        label: `wstawienie ${asset} do worktree bazowego`,
      });
    }

    process.stderr.write(`\n== BAZA (${baseRevision}) ==\n`);
    if (!buildArtifact(worktree)) {
      process.stderr.write("Build bazy padł - pomiaru nie ma.\n");
      return 1;
    }
    const before = probe(worktree, "BAZA", PORT_BEFORE, route);

    process.stderr.write("\n== HEAD (bieżące drzewo) ==\n");
    if (!buildArtifact(REPO_ROOT)) {
      process.stderr.write("Build HEAD-a padł - pomiaru nie ma.\n");
      return 1;
    }
    const after = probe(REPO_ROOT, "PO", PORT_AFTER, route);

    if (!before || !after) {
      process.stderr.write(
        `Sonda nie oddała próbki (baza: ${before ? "ok" : "brak"}, ` +
          `HEAD: ${after ? "ok" : "brak"}). Wynik powyżej.\n`,
      );
      return 1;
    }

    process.stdout.write(`\nTRASA: ${route}   BAZA: ${baseRevision}\n\n`);
    process.stdout.write(
      formatReport(diffSamples(before, after), { before: "BAZA", after: "PO" }) + "\n",
    );

    // RÓŻNICA JAKOŚCIOWA, osobno od tabeli: hint albo jest, albo go nie ma,
    // i żadna liczba tego nie zastąpi.
    const hintsBefore = modulepreloadTargets(before.linkHeader);
    const hintsAfter = modulepreloadTargets(after.linkHeader);
    process.stdout.write("\nHINTY `modulepreload` W NAGŁÓWKU `Link`\n");
    process.stdout.write(`  BAZA: ${hintsBefore.length ? hintsBefore.join(", ") : "(brak)"}\n`);
    process.stdout.write(`  PO:   ${hintsAfter.length ? hintsAfter.join(", ") : "(brak)"}\n`);

    process.stdout.write(
      "\nCZEGO TEN POMIAR NIE POKAZUJE: artefakt smoke gada z zaślepką Supabase, " +
        "więc żadne zapytanie nie wraca z danymi. Zysk prefetchu SSR (treść " +
        "w pierwszym dokumencie zamiast po hydratacji) jest tu NIEMIERZALNY - " +
        "identyczna `treść tekstowa w SSR` po obu stronach potwierdza wyłącznie, " +
        "że bez danych obie wersje renderują tę samą statyczną powłokę.\n",
    );
    return 0;
  } finally {
    if (worktreeAdded) {
      run("git", ["worktree", "remove", "--force", worktree], {
        cwd: REPO_ROOT,
        label: "sprzątanie worktree bazowego",
      });
    }
    rmSync(worktree, { recursive: true, force: true });
  }
}

process.exit(main());

/**
 * Generator lustra drizzle: każda nowa migracja `supabase/migrations/` (źródło
 * prawdy schematu) dostaje w `drizzle/migrations/` kopię z nagłówkiem
 * generatora, wpis `meta/_journal.json` (`when` = maksimum dziennika + 60 s)
 * i snapshot w łańcuchu `prevId`. Produkcja (Lovable Cloud) wykonuje wyłącznie
 * ten dziennik migratorem Drizzle - plików drizzle nie pisze się ręcznie
 * (docs/RUNBOOK_MIGRACJE_LOVABLE.md).
 *
 * Lustra spoza origin/main (lokalne dla gałęzi) generator przepisuje przy każdym
 * przebiegu - po `git merge origin/main` wystarczy uruchomić go ponownie.
 * Lustro z main jest forward-only; jedyny wyjątek to `--rewrite <tag>` dla
 * wpisu, którego produkcja nie zapisała (runbook §6.3).
 *
 * Cienki runner: plan, reguły i raport siedzą w src/lib/migrations/drizzleMirror.ts,
 * argumenty i zapis w src/lib/migrations/drizzleMirrorCli.ts (oba z testami),
 * dysk i git w scripts/lib/drizzleMirrorDisk.ts.
 *
 * Usage:
 *   bun run migrations:mirror                    # zapis (baza: origin/main, potem main)
 *   bun run migrations:mirror --dry-run          # plan bez zapisu
 *   bun run migrations:mirror --check            # CI: kod 1, gdy lustro nieaktualne
 *   bun run migrations:mirror --rewrite <tag>    # przepisanie niewdrożonego lustra z main
 *   [--base <ref> | --no-base]
 * Kod wyjścia: 0 - ok; 1 - plan z błędami albo (--check) lustro nieaktualne;
 * 2 - błędne wywołanie albo nieczytelny ref bazy.
 */
import { runMirrorCli } from "../src/lib/migrations/drizzleMirrorCli";
import { gitBaseJournal, nodeMirrorFs } from "./lib/drizzleMirrorDisk";

process.exit(
  runMirrorCli(process.argv.slice(2), {
    fs: nodeMirrorFs,
    log: (line) => console.log(line),
    now: () => Date.now(),
    baseJournal: gitBaseJournal,
  }),
);

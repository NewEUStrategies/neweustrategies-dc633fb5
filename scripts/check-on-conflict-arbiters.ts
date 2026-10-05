/**
 * Bramka kontraktowa: KAŻDY CEL `onConflict` W `.upsert(...)` MA ARBITRA
 * w schemacie odtworzonym z migracji.
 *
 * Cienki runner - model kluczy unikalnych, ekstrakcja celów z kodu (drzewo
 * składniowe kompilatora TypeScript), polityka bloków DO, zapadka
 * dynamicznego DDL (pary: skrót bloku + tekst `EXECUTE`), DDL kluczy poza
 * modelem (ciała funkcji, kaskady - baza zero) i uzasadnienie żyją
 * w `src/lib/ci/onConflictArbiters.ts`,
 * więc inwariant ma test jednostkowy
 * (`src/lib/ci/__tests__/onConflictArbiters.test.ts`), a nie tylko przebieg
 * w CI. Wejście czyta `scripts/lib/onConflictArbitersInputs.ts` - TEN SAM
 * loader, którego używa test stanu repozytorium, więc test mierzy dokładnie
 * to, co bramka w CI.
 *
 * Po co: `ON CONFLICT (kolumny)` bez klucza o dokładnie tym zbiorze kolumn to
 * 42P10 przy KAŻDYM wywołaniu - a atrapa bazy w testach przyjmuje każdy cel.
 * Tak przez wiele wydań nie działała żadna wysyłka zaproszenia
 * (`user_roles`: `user_id,role` po zamianie klucza na `tenant_id,user_id,role`).
 *
 * Migracje idą SUROWE (bez `stripSqlComments`, który nie zna dollar-quote
 * i potrafi połknąć `DROP` za `$$ SELECT '--' $$`). Czyta wyłącznie pliki
 * repo (migracje + `src/**`), bez bazy i bez buildu.
 *
 * Usage: bun run check:on-conflict-arbiters
 */
import {
  analyzeOnConflictArbiters,
  onConflictArbitersFailed,
  renderOnConflictArbitersReport,
} from "../src/lib/ci/onConflictArbiters";
import { loadProductionSources, loadRawMigrationFiles } from "./lib/onConflictArbitersInputs";

function main(): void {
  const started = Date.now();
  const report = analyzeOnConflictArbiters({
    migrations: loadRawMigrationFiles(),
    sources: loadProductionSources(),
  });
  const rendered = renderOnConflictArbitersReport(report);
  const elapsed = `  (${((Date.now() - started) / 1000).toFixed(2)} s)`;

  if (onConflictArbitersFailed(report)) {
    console.error(rendered + elapsed);
    process.exit(1);
  }
  console.log(rendered + elapsed);
}

main();

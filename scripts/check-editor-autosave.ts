/**
 * Bramka inwariantu: KOMENTARZ OBIECUJĄCY AUTOZAPIS MUSI ZNACZYĆ REALNY ZAPIS.
 *
 * Cienki runner - inwariant, rejestr powierzchni edytorskich i uzasadnienie
 * żyją w `src/lib/ci/editorAutosaveContract.ts` (konwencja jak
 * `check-content-layering.ts`), dzięki czemu bramka ma test jednostkowy
 * (`src/lib/ci/__tests__/editorAutosaveContract.test.ts`), a nie tylko przebieg
 * w CI.
 *
 * Usage: bun run check:editor-autosave
 */
import { existsSync, readFileSync } from "node:fs";
import {
  EDITOR_AUTOSAVE_SURFACES,
  renderEditorAutosaveReport,
  scanEditorAutosaveContract,
  type EditorSource,
} from "../src/lib/ci/editorAutosaveContract";

function collect(): EditorSource[] {
  return EDITOR_AUTOSAVE_SURFACES.map((surface) => {
    if (!existsSync(surface.file)) {
      console.error(
        `✗ ${surface.file} (${surface.label}) - plik z rejestru nie istnieje; ` +
          "zaktualizuj EDITOR_AUTOSAVE_SURFACES razem z przenosinami edytora.",
      );
      process.exit(1);
    }
    return { ...surface, source: readFileSync(surface.file, "utf8") };
  });
}

function main(): void {
  const sources = collect();
  const violations = scanEditorAutosaveContract(sources);
  const rendered = renderEditorAutosaveReport(violations, sources.length);

  if (violations.length > 0) {
    console.error(rendered);
    process.exit(1);
  }
  console.log(rendered);
}

main();

// KAŻDY EKRAN HUBA Z ZAPISEM POKAZUJE ŹRÓDŁO PRAWDY (SPEC §3.1, §6.1, §6.4).
//
// Hub nie ma własnych danych - zapisuje byty modułów ich mutatorami
// (`HUB_SYNC_MANIFEST.writers`). Admin poprawiający plan w Diagnostyce,
// macierz oferty albo dane wejściowe musi widzieć, KTÓRY byt zmienia i gdzie
// jeszcze ta zmiana się pojawi - inaczej „szybka naprawa" wygląda jak
// lokalne ustawienie huba, które rozjedzie się z modułem. Tę wiedzę niesie
// `SourceHeader` z bytem z manifestu.
//
// CO TEN PLIK DOWODZI.
//   1. ODKRYCIE, NIE LISTA Z PAMIĘCI. Ekranem z zapisem jest każdy plik
//      produkcyjny `src/components/admin/revenue/**`, który woła pisarza
//      z manifestu (eksport `ścieżka#eksport`), hak RPC panelu (dane
//      wejściowe, wyciszenia), organizm zapisu modułu albo aplikator szybkiej
//      naprawy. Nowy ekran z zapisem bez nagłówka zapala test.
//   2. Taki plik renderuje `<SourceHeader entity="…">` z bytem z manifestu;
//      hak RPC panelu - z TYM bytem, którego RPC jest pisarzem.
//   3. Dialog szybkiej naprawy bierze byt z rejestru napraw - każda naprawa
//      wskazuje byt z manifestu, a jej pisarz jest pisarzem tego bytu.
//   4. Ekrany z kart (QuickFixDialog, PlanBenefitMatrix, ManualInputsGrid,
//      wyciszenie) są wśród odkrytych.
//   5. LISTA ZALEGŁYCH jest jawna i JEDNOKIERUNKOWA: wpis musi naprawdę nie
//      mieć nagłówka (po naprawie test każe wpis zdjąć) - zgłoszenie
//      integratora, nie cichy wyjątek.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { QUICK_FIXES } from "@/lib/admin/revenue/quickFixes";
import { maskComments } from "@/lib/ci/i18nKeyUsage";
import { HUB_ENTITY_IDS, HUB_SYNC_MANIFEST, type HubEntityId } from "@/lib/revenue/syncManifest";

const ROOT = "src/components/admin/revenue";

function productionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === "__tests__" ? [] : productionFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** Eksporty pisarzy z manifestu (`ścieżka#eksport`) → byt. */
const MANIFEST_WRITERS = new Map<string, HubEntityId>(
  HUB_SYNC_MANIFEST.flatMap((entity) =>
    entity.writers.flatMap((writer) => {
      const name = writer.ref.split("#")[1];
      return name ? [[name, entity.id] as const] : [];
    }),
  ),
);

/**
 * Haki panelu, które owijają RPC-pisarza z manifestu (`kind: "rpc"`), i byt,
 * do którego ten RPC pisze - nagłówek ekranu musi mówić o TYM bycie.
 */
const PANEL_RPC_HOOKS: Readonly<Record<string, HubEntityId>> = {
  useSaveRevenueInput: "revenue_input",
  useSnoozeRevenueCheck: "revenue_diagnostic",
  useUnsnoozeRevenueCheck: "revenue_diagnostic",
};

/** Organizmy zapisu modułów, które hub montuje zamiast własnego formularza. */
const MODULE_WRITE_ORGANISMS = ["AccessPlanEditorDialog", "CouponCreateDialog"] as const;

/** Aplikator szybkiej naprawy (`QuickFixSpec.apply.useApplier`) - byt z rejestru. */
const QUICK_FIX_APPLIER = "useApplier";

/**
 * ZALEGŁE - ekrany z zapisem jeszcze bez nagłówka źródła. Każdy wpis to
 * zgłoszenie do integracji (raport S7.3b), nie wyjątek na stałe.
 */
const PENDING_SOURCE_HEADER: Readonly<Record<string, string>> = {
  "src/components/admin/revenue/diagnostics/SnoozeDialog.tsx":
    'wyciszenie diagnozy - <SourceHeader entity="revenue_diagnostic" /> w treści dialogu (S7.1-ui)',
  "src/components/admin/revenue/diagnostics/DiagnosticsBoard.tsx":
    'przywrócenie wyciszenia z listy - <SourceHeader entity="revenue_diagnostic" /> przy wyciszonych (S7.1-ui)',
};

interface WriteScreen {
  file: string;
  text: string;
  /** Nazwy pisarzy, przez które plik zapisuje. */
  writers: string[];
}

function usesName(text: string, name: string): boolean {
  return new RegExp(`(?:\\b${name}\\s*\\(|<${name}\\b)`).test(text);
}

const WRITE_SCREENS: WriteScreen[] = productionFiles(ROOT).flatMap((file) => {
  const text = maskComments(readFileSync(file, "utf8"));
  const names = [
    ...MANIFEST_WRITERS.keys(),
    ...Object.keys(PANEL_RPC_HOOKS),
    ...MODULE_WRITE_ORGANISMS,
    QUICK_FIX_APPLIER,
  ];
  const writers = names.filter((name) => usesName(text, name));
  return writers.length > 0 ? [{ file, text, writers }] : [];
});

/** Byty z `<SourceHeader entity="…">` (dosłowne) w pliku. */
function headerEntities(text: string): string[] {
  return [...text.matchAll(/<SourceHeader\b[^>]*\bentity="([^"]+)"/g)].map((m) => m[1]);
}

describe("odkrycie ekranów z zapisem", () => {
  it("ekrany z karty S7 są wśród odkrytych", () => {
    const files = WRITE_SCREENS.map((screen) => screen.file);
    expect(files).toEqual(
      expect.arrayContaining([
        `${ROOT}/diagnostics/QuickFixDialog.tsx`,
        `${ROOT}/offer/PlanBenefitMatrix.tsx`,
        `${ROOT}/inputs/ManualInputsGrid.tsx`,
        `${ROOT}/diagnostics/SnoozeDialog.tsx`,
      ]),
    );
  });

  it("lista zaległych wskazuje wyłącznie odkryte ekrany", () => {
    const files = new Set(WRITE_SCREENS.map((screen) => screen.file));
    for (const file of Object.keys(PENDING_SOURCE_HEADER)) expect(files.has(file), file).toBe(true);
  });
});

describe("każdy ekran z zapisem renderuje SourceHeader z bytem z manifestu", () => {
  const ready = WRITE_SCREENS.filter((screen) => !(screen.file in PENDING_SOURCE_HEADER));

  it.each(ready.map((screen) => [screen.file, screen] as const))("%s", (_file, screen) => {
    expect(screen.text, "import SourceHeader").toMatch(
      /from "@\/components\/admin\/revenue\/molecules\/SourceHeader"/,
    );
    if (screen.writers.includes(QUICK_FIX_APPLIER)) {
      // Byt dynamiczny: z rejestru napraw (sprawdzony niżej, naprawa po naprawie).
      expect(screen.text).toMatch(/<SourceHeader\b[^>]*\bentity=\{spec\.apply\.entity\}/);
      return;
    }
    const entities = headerEntities(screen.text);
    expect(entities.length, "dosłowny byt w <SourceHeader entity=…>").toBeGreaterThan(0);
    for (const entity of entities) {
      expect(HUB_ENTITY_IDS as readonly string[], entity).toContain(entity);
    }
    for (const writer of screen.writers) {
      const target = PANEL_RPC_HOOKS[writer] ?? MANIFEST_WRITERS.get(writer);
      if (target && writer in PANEL_RPC_HOOKS) {
        expect(entities, `${writer} pisze do ${target}`).toContain(target);
      }
    }
  });
});

// Zgodność pisarza naprawy z pisarzami bytu (z jawnym wyjątkiem P24
// `assignUnassignedCrmTasks`) pilnuje `quickFixes.test.ts` - tu liczy się,
// że nagłówek dialogu dostaje byt, który manifest zna.
describe("szybkie naprawy - byt nagłówka z rejestru napraw", () => {
  it.each(Object.values(QUICK_FIXES).map((spec) => [spec.id, spec] as const))(
    "%s: byt nagłówka jest bytem manifestu z ekranem-właścicielem albo zakładką huba",
    (_id, spec) => {
      const entity = HUB_SYNC_MANIFEST.find((e) => e.id === spec.apply.entity);
      expect(entity, spec.apply.entity).toBeDefined();
      expect((entity?.owners.length ?? 0) + (entity?.hubTabs.length ?? 0)).toBeGreaterThan(0);
      expect(spec.apply.columns.length, "kolumny różnicy dla nagłówka").toBeGreaterThan(0);
    },
  );
});

describe("lista zaległych jest jednokierunkowa", () => {
  it.each(Object.entries(PENDING_SOURCE_HEADER))(
    "%s nadal bez nagłówka (po naprawie zdejmij wpis): %s",
    (file) => {
      const text = maskComments(readFileSync(file, "utf8"));
      expect(text).not.toMatch(/<SourceHeader\b/);
    },
  );
});

/**
 * Bramka: „komentarz obiecuje autozapis" musi znaczyć „kod robi autozapis".
 *
 * DEFEKT, którego pilnuje: w edytorze STRON (`admin.pages.$slug.tsx`) stał
 * komentarz „Autozapis włączony (jak dla wpisów) - chroni przed utratą pracy
 * przy awarii lub zamknięciu karty" nad kodem, w którym `useAutosave` nie
 * występowało w ogóle. Zapis szedł WYŁĄCZNIE z przycisku, więc obietnica była
 * nieprawdziwa przez osiem wydań: review czytało komentarz i mu wierzyło, a
 * redaktor tracił builder strony przy zamknięciu karty. Stos WPISÓW miał
 * poprawne wpięcie przez cały ten czas - rozjazd był niewidoczny, bo nic go nie
 * porównywało.
 *
 * Skaner jest znakowy (`stripTsComments`), więc ZAKOMENTOWANE `useAutosave(…)`
 * NIE spełnia kontraktu - inaczej bramkę dałoby się uciszyć dokładnie tym, czego
 * ma pilnować.
 *
 * Moduł jest CZYSTY (bez I/O) - pliki wczytuje test bramki.
 */
import { stripTsComments } from "../../../scripts/lib/stripComments";

/** Powierzchnia edytorska: plik + to, czego kontrakt od niego wymaga. */
export interface EditorSurface {
  /** Ścieżka względem korzenia repo - trafia do komunikatu bramki. */
  file: string;
  /** Nazwa dla ludzi ("edytor stron"), żeby czerwony log dało się czytać. */
  label: string;
}

export interface EditorSource extends EditorSurface {
  source: string;
}

export type AutosaveDefect = "missing-useAutosave" | "missing-unsaved-guard" | "commented-out-only";

export interface AutosaveViolation {
  file: string;
  label: string;
  defect: AutosaveDefect;
  /** Linia komentarza, który obiecuje autozapis - punkt startu naprawy. */
  claimLine: number | null;
}

/**
 * REJESTR powierzchni, które MUSZĄ autozapisywać. Nowy edytor treści dopisuje
 * się tu świadomie - lista jest krótka i celowo ręczna, żeby bramka nie zgadywała
 * po nazwach plików, a dodanie edytora bez autozapisu było decyzją, nie
 * przeoczeniem.
 */
export const EDITOR_AUTOSAVE_SURFACES: readonly EditorSurface[] = [
  {
    file: "src/components/admin/post-editor/hooks/usePostEditorForm.ts",
    label: "edytor wpisów",
  },
  { file: "src/routes/admin.pages.$slug.tsx", label: "edytor stron" },
] as const;

const CLAIM_RE = /autozapis|autosave|auto-save|auto-zapis/i;
const HOOK_CALL_RE = /\buseAutosave\s*[<(]/;
const GUARD_CALL_RE = /\buseUnsavedChangesGuard\s*\(/;

/**
 * Treść komentarzy linia po linii. `stripTsComments` zachowuje numerację i
 * kolumny (wycięte znaki zastępuje spacjami), więc różnica względem oryginału
 * wyznacza komentarz - a literał tekstowy ze słowem „autosave" nim nie jest.
 *
 * Bierzemy CIĄGŁY zakres od pierwszej do ostatniej różnicy, a nie same różniące
 * się znaki: spacja wewnątrz komentarza maskuje się na spację, więc porównanie
 * znak po znaku sklejało wyrazy („//autozapiswłączony") i psuło komunikat.
 */
export function commentTextByLine(source: string): Array<{ line: number; text: string }> {
  const raw = source.split("\n");
  const masked = stripTsComments(source).split("\n");
  const out: Array<{ line: number; text: string }> = [];
  raw.forEach((line, index) => {
    const maskedLine = masked[index] ?? "";
    let first = -1;
    let last = -1;
    for (let i = 0; i < line.length; i += 1) {
      if (maskedLine[i] === line[i]) continue;
      if (first < 0) first = i;
      last = i;
    }
    if (first < 0) return;
    const text = line.slice(first, last + 1).trim();
    if (text) out.push({ line: index + 1, text });
  });
  return out;
}

/** Pierwszy komentarz obiecujący autozapis (albo null). */
export function findAutosaveClaim(source: string): { line: number; text: string } | null {
  return commentTextByLine(source).find((c) => CLAIM_RE.test(c.text)) ?? null;
}

/** Wywołanie hooka w ŻYWYM kodzie - komentarz się nie liczy. */
export function wiresAutosave(source: string): boolean {
  return HOOK_CALL_RE.test(stripTsComments(source));
}

/** Strażnik zamknięcia karty / zmiany trasy w ŻYWYM kodzie. */
export function guardsUnsavedChanges(source: string): boolean {
  return GUARD_CALL_RE.test(stripTsComments(source));
}

/** Hook występuje wyłącznie w komentarzu - najczystszy objaw tego defektu. */
export function mentionsHookOnlyInComments(source: string): boolean {
  return HOOK_CALL_RE.test(source) && !wiresAutosave(source);
}

export function scanEditorAutosaveContract(files: readonly EditorSource[]): AutosaveViolation[] {
  const violations: AutosaveViolation[] = [];
  for (const { file, label, source } of files) {
    const claimLine = findAutosaveClaim(source)?.line ?? null;
    if (!wiresAutosave(source)) {
      violations.push({
        file,
        label,
        defect: mentionsHookOnlyInComments(source) ? "commented-out-only" : "missing-useAutosave",
        claimLine,
      });
      continue;
    }
    // Autozapis bez strażnika to ta sama utrata pracy, tylko węższym oknem:
    // debounce jeszcze nie wystrzelił, a karta już się zamyka.
    if (!guardsUnsavedChanges(source)) {
      violations.push({ file, label, defect: "missing-unsaved-guard", claimLine });
    }
  }
  return violations.sort((a, b) => a.file.localeCompare(b.file));
}

const REMEDY: Record<AutosaveDefect, string> = {
  "missing-useAutosave": "wepnij useAutosave({ value: form, enabled, save: saveFn })",
  "missing-unsaved-guard": "dodaj useUnsavedChangesGuard(autosave.isDirty || …)",
  "commented-out-only": "useAutosave jest tylko w komentarzu - wywołaj go naprawdę",
};

export function renderEditorAutosaveReport(
  violations: readonly AutosaveViolation[],
  scanned: number,
): string {
  if (violations.length === 0) {
    return `✓ Kontrakt autozapisu: ${scanned} powierzchni edytorskich zapisuje samoczynnie.`;
  }
  const lines = violations.map((v) => {
    const at = v.claimLine === null ? v.file : `${v.file}:${v.claimLine}`;
    return `  ✗ ${at} (${v.label}) - ${REMEDY[v.defect]}`;
  });
  return [`✗ Kontrakt autozapisu złamany w ${violations.length} miejscach:`, ...lines].join("\n");
}

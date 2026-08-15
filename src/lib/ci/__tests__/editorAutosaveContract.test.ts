// Test bramki kontraktu autozapisu. Konwencja repo: inwariant CI ma test, bo
// inaczej skaner nie ma jak umrzeć na czerwono, gdy przestanie cokolwiek widzieć
// - a pusta bramka brzmi identycznie jak zielona. Druga połowa pliku uruchamia
// bramkę na PRAWDZIWYCH źródłach, bo to ona jest właściwym zabezpieczeniem.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EDITOR_AUTOSAVE_SURFACES,
  commentTextByLine,
  findAutosaveClaim,
  guardsUnsavedChanges,
  mentionsHookOnlyInComments,
  renderEditorAutosaveReport,
  scanEditorAutosaveContract,
  wiresAutosave,
} from "@/lib/ci/editorAutosaveContract";

const surface = (source: string) => [{ file: "a.tsx", label: "edytor", source }];

/** Dokładny kształt defektu z admin.pages.$slug.tsx: obietnica bez wpięcia. */
const CLAIM_ONLY = [
  "// Autozapis włączony (jak dla wpisów): chroni przed utratą pracy przy",
  "// zamknięciu karty.",
  "const isDirty = form !== savedFormRef.current;",
  "useUnsavedChangesGuard(isDirty || busy);",
].join("\n");

const WIRED = [
  "// Autozapis - kontrakt jak w edytorze wpisów.",
  "const autosave = useAutosave<PageForm | null>({ value: form, save: saveFn });",
  "useUnsavedChangesGuard(autosave.isDirty || busy);",
].join("\n");

describe("commentTextByLine", () => {
  it("oddziela komentarz od kodu w tej samej linii", () => {
    const out = commentTextByLine("const a = 1; // autozapis włączony\nconst b = 2;");
    expect(out).toEqual([{ line: 1, text: "// autozapis włączony" }]);
  });

  it("literał tekstowy ze słowem autosave to NIE komentarz", () => {
    expect(commentTextByLine('const s = "autosave";')).toEqual([]);
  });

  it("zachowuje numerację linii w komentarzu blokowym", () => {
    const out = commentTextByLine("const a = 1;\n/* autozapis\n   dalej */\nconst b = 2;");
    expect(out.map((c) => c.line)).toEqual([2, 3]);
  });
});

describe("wiresAutosave - komentarz nie spełnia kontraktu", () => {
  it("widzi żywe wywołanie hooka", () => {
    expect(wiresAutosave(WIRED)).toBe(true);
  });

  it("widzi wywołanie z parametrem typu (useAutosave<T>({…}))", () => {
    expect(wiresAutosave("const a = useAutosave<Form | null>({ value });")).toBe(true);
  });

  it("NIE zalicza wywołania schowanego w komentarzu liniowym", () => {
    expect(wiresAutosave("// const autosave = useAutosave({ value: form });")).toBe(false);
  });

  it("NIE zalicza wywołania schowanego w komentarzu blokowym", () => {
    expect(wiresAutosave("/*\n const a = useAutosave({ value });\n*/")).toBe(false);
  });

  it("odróżnia import/typ od wywołania", () => {
    expect(wiresAutosave('import { useAutosave } from "@/hooks/useAutosave";')).toBe(false);
  });
});

describe("findAutosaveClaim", () => {
  it("wskazuje linię obietnicy - naprawa zaczyna się od niej", () => {
    expect(findAutosaveClaim(CLAIM_ONLY)?.line).toBe(1);
  });

  it("łapie obietnicę po angielsku i po polsku", () => {
    expect(findAutosaveClaim("// autosave keeps the draft safe")).not.toBeNull();
    expect(findAutosaveClaim("// autozapis chroni szkic")).not.toBeNull();
  });

  it("milczy, gdy komentarze nic nie obiecują", () => {
    expect(findAutosaveClaim("// zwykły komentarz\nconst a = 1;")).toBeNull();
  });
});

describe("scanEditorAutosaveContract", () => {
  it("zgłasza obietnicę bez wpięcia (defekt z edytora stron)", () => {
    const hits = scanEditorAutosaveContract(surface(CLAIM_ONLY));
    expect(hits).toEqual([
      { file: "a.tsx", label: "edytor", defect: "missing-useAutosave", claimLine: 1 },
    ]);
  });

  it("rozpoznaje osobno hook żyjący WYŁĄCZNIE w komentarzu", () => {
    const source = "// const autosave = useAutosave({ value: form });\nconst a = 1;";
    expect(mentionsHookOnlyInComments(source)).toBe(true);
    expect(scanEditorAutosaveContract(surface(source))[0]?.defect).toBe("commented-out-only");
  });

  it("zgłasza autozapis bez strażnika zamknięcia karty", () => {
    const source = "const autosave = useAutosave({ value: form, save });";
    expect(guardsUnsavedChanges(source)).toBe(false);
    expect(scanEditorAutosaveContract(surface(source))[0]?.defect).toBe("missing-unsaved-guard");
  });

  it("milczy na poprawnie wpiętym edytorze", () => {
    expect(scanEditorAutosaveContract(surface(WIRED))).toEqual([]);
  });

  it("sortuje trafienia po pliku - log jest stabilny między przebiegami", () => {
    const hits = scanEditorAutosaveContract([
      { file: "src/b.tsx", label: "b", source: CLAIM_ONLY },
      { file: "src/a.tsx", label: "a", source: CLAIM_ONLY },
    ]);
    expect(hits.map((h) => h.file)).toEqual(["src/a.tsx", "src/b.tsx"]);
  });
});

describe("renderEditorAutosaveReport", () => {
  it("zielony log podaje zasięg skanu", () => {
    expect(renderEditorAutosaveReport([], 2)).toContain("2 powierzchni");
  });

  it("czerwony log podaje plik, linię i konkretną naprawę", () => {
    const report = renderEditorAutosaveReport(scanEditorAutosaveContract(surface(CLAIM_ONLY)), 1);
    expect(report).toContain("a.tsx:1");
    expect(report).toContain("useAutosave");
  });
});

describe("PRAWDZIWE źródła - edytory treści zapisują samoczynnie", () => {
  const sources = EDITOR_AUTOSAVE_SURFACES.map((s) => ({
    ...s,
    source: readFileSync(resolve(process.cwd(), s.file), "utf8"),
  }));

  it("rejestr wskazuje na istniejące pliki (bramka nie skanuje pustki)", () => {
    expect(sources.length).toBeGreaterThan(0);
    sources.forEach((s) => expect(s.source.length).toBeGreaterThan(0));
  });

  it("każda zarejestrowana powierzchnia autozapisuje i pilnuje wyjścia", () => {
    const violations = scanEditorAutosaveContract(sources);
    expect(renderEditorAutosaveReport(violations, sources.length)).toContain("✓");
    expect(violations).toEqual([]);
  });
});

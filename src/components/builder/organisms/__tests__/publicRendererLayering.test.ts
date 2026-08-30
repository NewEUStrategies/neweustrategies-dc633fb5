// PUBLICZNY RENDERER NIE ZNA KODU EDYTORA - regresja na klasę defektu, która
// w tym repozytorium wystąpiła już DWA RAZY w tym samym kształcie.
//
// ── CO SIĘ STAŁO ────────────────────────────────────────────────────────────
// `BuilderRenderer` (chrome KAŻDEJ strony publicznej) trzymał
// `lazy(() => import("@/components/admin/builder/.../EmptyContainerPickerBox"))`
// z komentarzem obiecującym wprost, że „słowniki edytora nie wchodzą do bundla
// publicznego chrome". Bliźniaczo `ClubInsights` sięgał po `EChart` z katalogu
// panelu, tłumacząc to tym, że prymityw „trzyma ECharts poza grafem SSR".
//
// OBIE OPTYMALIZACJE BYŁY PRAWDZIWE I OBIE MIERZYŁY NIE TO, CO TRZEBA.
// `lazy()` zdejmuje moduł ze ŚCIEŻKI STARTOWEJ - i to działa. Ale NIE usuwa
// krawędzi w grafie importów, a bramka `check:bundle` liczy do budżetu
// czytelnika wszystko OSIĄGALNE z publicznej trasy, również przez `import()`.
// Zmierzone na `main` 2879ee8: `i18n-builder` 31,0 KB + `StructurePicker`
// 1,0 KB + sam boks 0,4 KB siedziały w budżecie PUBLICZNYM, choć renderują się
// wyłącznie w kanwie administratora. Po odwróceniu zależności (kanwa PODAJE
// komponent przez kontekst) `public` zszedł z 2701,8 na 2669,7 KB.
//
// ── DLACZEGO TEST, A NIE KOMENTARZ ──────────────────────────────────────────
// Komentarz już tam stał i był nieprawdziwy przez cały czas swojego istnienia.
// Zdanie w kodzie nie mierzy niczego; ten plik mierzy. Każdy przyszły
// `import("@/components/admin/...")` w publicznym rendererze zapali się tutaj,
// zanim zdąży wejść do budżetu czytelnika.
//
// ── CZEGO TEN TEST NIE PILNUJE ──────────────────────────────────────────────
// `ClubInsights` nadal importuje `EChart` z katalogu panelu i trzyma tym
// 266,8 KB ECharts w budżecie publicznym. To NIE jest przeoczenie, tylko
// świadoma decyzja produktowa z 2026-08-30: publiczne wglądy klubu zachowują
// pełne wykresy (wykres liniowy z trzema seriami, słupkowy i kołowy), a floor
// bramki bierze ten koszt na siebie. Gdyby ta decyzja się zmieniła, zysk jest
// policzalny i wynosi 266,8 KB - wtedy tutaj dochodzi drugi katalog.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/** Pliki, które renderują treść PUBLICZNĄ i nie mają prawa znać panelu. */
const PUBLICZNE_RENDERERY = [
  "src/components/builder/organisms/BuilderRenderer.tsx",
  "src/components/builder/organisms/BuilderWidgetNode.tsx",
] as const;

/**
 * Łapie obie formy krawędzi naraz - statyczną i dynamiczną - bo to właśnie
 * pomylenie ich kosztowało 32,4 KB budżetu publicznego.
 */
const KRAWEDZ_DO_PANELU = /(?:from|import)\s*\(?\s*["']@\/components\/admin\/[^"']+["']/g;

describe("publiczny renderer buildera nie sięga do katalogu panelu", () => {
  it.each(PUBLICZNE_RENDERERY)("%s nie importuje nic z @/components/admin", (sciezka) => {
    const zrodlo = readFileSync(sciezka, "utf8");
    const trafienia = [...zrodlo.matchAll(KRAWEDZ_DO_PANELU)].map((m) => m[0]);
    expect(
      trafienia,
      `${sciezka} ciągnie kod panelu do bundla czytelnika. ` +
        `Podaj komponent z góry (kontekst albo właściwość), tak jak robi to ` +
        `BuilderEmptyPickerProvider - lazy() NIE usuwa tej krawędzi.`,
    ).toEqual([]);
  });

  it("kontrapunkt: wzorzec faktycznie łapie obie formy krawędzi", () => {
    const statyczna = `import { X } from "@/components/admin/builder/X";`;
    const dynamiczna = `const X = lazy(() => import("@/components/admin/builder/X"));`;
    expect([...statyczna.matchAll(KRAWEDZ_DO_PANELU)]).toHaveLength(1);
    expect([...dynamiczna.matchAll(KRAWEDZ_DO_PANELU)]).toHaveLength(1);
  });

  it("kontrapunkt: import spoza katalogu panelu nie jest zgłaszany", () => {
    const swoj = `import { Y } from "@/components/builder/organisms/Y";`;
    expect([...swoj.matchAll(KRAWEDZ_DO_PANELU)]).toHaveLength(0);
  });

  it("kanwa panelu MA prawo importować boks - to ona jest jego właścicielem", () => {
    const kanwa = readFileSync(
      "src/components/admin/builder/ui/organisms/builder/VisualCanvas.tsx",
      "utf8",
    );
    expect(kanwa).toContain("EmptyContainerPickerBox");
    expect(kanwa).toContain("box={EmptyContainerPickerBox}");
  });
});

// Bramki ŚCIEŻEK biblioteki mediów: `normalizeFolderPath` i `likePrefix`.
//
// To są dwie funkcje, od których zależy, czy operacja NIEODWRACALNA trafi tam,
// gdzie miała trafić. Pierwsza decyduje, czy da się zaadresować katalog spoza
// własnego drzewa; druga - czy `deleteMediaFolder(recursive)` skasuje folder
// "raporty_2026", czy przy okazji także "raportyX2026" i wszystko, co pasuje do
// wzorca LIKE. Obie stały na zerze wywołań.
//
// Tabela granic jest tu, a nie w teście orkiestracji, bo te reguły są CZYSTE -
// przeciskanie kilkudziesięciu przypadków przez osiem handlerów server fn
// kosztowałoby dziesięć razy więcej i dowodziło tego samego.
import { describe, expect, it, vi } from "vitest";

// Moduł deklaruje osiem server fn na poziomie modułu - bez atrapy frameworka
// sam import ciągnie za sobą middleware uwierzytelniania i klienta serwerowego.
vi.mock("@tanstack/react-start", async () => (await import("@/test/serverFn")).reactStartStub());
vi.mock("@/integrations/supabase/require-staff", () => ({ requireStaff: {} }));
vi.mock("@/lib/server/rate-limit.server", () => ({ rateLimit: async () => true }));
vi.mock("@/lib/server/audit.server", () => ({ recordAudit: async () => undefined }));
vi.mock("@/lib/server/userTenant.server", () => ({ resolveUserTenantId: async () => "t" }));

import { likePrefix, normalizeFolderPath } from "@/lib/media.functions";

describe("normalizeFolderPath - postać kanoniczna", () => {
  it("puste wejście to katalog główny", () => {
    expect(normalizeFolderPath("")).toBe("/");
    expect(normalizeFolderPath("/")).toBe("/");
  });

  it("dokleja brakujący ukośnik z przodu i z tyłu", () => {
    expect(normalizeFolderPath("press")).toBe("/press/");
    expect(normalizeFolderPath("/press")).toBe("/press/");
    expect(normalizeFolderPath("press/")).toBe("/press/");
  });

  it("skleja powtórzone ukośniki", () => {
    // Bez tego "/press//2026/" i "/press/2026/" byłyby DWOMA różnymi folderami
    // w bazie, a użytkownik widziałby jeden.
    expect(normalizeFolderPath("//press//2026//")).toBe("/press/2026/");
  });

  it("obcina białe znaki na krańcach", () => {
    expect(normalizeFolderPath("  /press/  ")).toBe("/press/");
  });

  it("przepuszcza zagnieżdżenie i znaki diakrytyczne", () => {
    expect(normalizeFolderPath("/raporty-ą/2026 Q1/")).toBe("/raporty-ą/2026 Q1/");
  });
});

describe("normalizeFolderPath - wyjście poza drzewo", () => {
  it("odrzuca segment nadrzędny", () => {
    // To jest ta bramka: bez niej `bulkMoveMedia` przyjąłby ścieżkę wyprowadzającą
    // poza katalog, w którym operator ma prawo pisać.
    expect(() => normalizeFolderPath("/press/../tajne/")).toThrow("Invalid folder path");
    expect(() => normalizeFolderPath("/../")).toThrow("Invalid folder path");
    expect(() => normalizeFolderPath("..")).toThrow("Invalid folder path");
  });

  it("odrzuca segment bieżący", () => {
    expect(() => normalizeFolderPath("/press/./2026/")).toThrow("Invalid folder path");
    expect(() => normalizeFolderPath(".")).toThrow("Invalid folder path");
  });

  it("odrzuca ukośnik wsteczny - ścieżka w stylu Windows nie jest furtką", () => {
    expect(() => normalizeFolderPath("/press\\..\\tajne/")).toThrow("Invalid folder path");
    expect(() => normalizeFolderPath("/press\\2026/")).toThrow("Invalid folder path");
  });

  it("przepuszcza nazwę ZACZYNAJĄCĄ SIĘ od kropek, bo to legalny folder", () => {
    // Bramka celuje w SEGMENT równy ".." - nie w każdą nazwę z kropką.
    expect(normalizeFolderPath("/..archiwum/")).toBe("/..archiwum/");
    expect(normalizeFolderPath("/.ukryty/")).toBe("/.ukryty/");
  });
});

describe("normalizeFolderPath - znaki niedozwolone", () => {
  it.each(["<", ">", ":", '"', "|", "?", "*"])("odrzuca znak %s", (ch) => {
    expect(() => normalizeFolderPath(`/press${ch}2026/`)).toThrow("Invalid folder path");
  });

  it("odrzuca znaki sterujące", () => {
    // Znak sterujący w nazwie folderu rozjeżdża logi, eksporty i nagłówki HTTP.
    expect(() => normalizeFolderPath("/press\u0007 2026/")).toThrow("Invalid folder path");
    expect(() => normalizeFolderPath("/press\u001f2026/")).toThrow("Invalid folder path");
    expect(() => normalizeFolderPath("/press\n2026/")).toThrow("Invalid folder path");
  });

  it("odrzuca segment dłuższy niż 64 znaki, przepuszcza dokładnie 64", () => {
    expect(normalizeFolderPath(`/${"a".repeat(64)}/`)).toBe(`/${"a".repeat(64)}/`);
    expect(() => normalizeFolderPath(`/${"a".repeat(65)}/`)).toThrow("Invalid folder path");
  });

  it("nie ma limitu ZAGNIEŻDŻENIA, dopóki każdy segment mieści się w limicie", () => {
    const deep = "/" + Array.from({ length: 20 }, (_, i) => `p${i}`).join("/") + "/";
    expect(normalizeFolderPath(deep)).toBe(deep);
  });
});

describe("likePrefix - escapowanie wzorca LIKE", () => {
  it("dokleja wildcard do zwykłego prefiksu", () => {
    expect(likePrefix("/press/")).toBe("/press/%");
  });

  it("escapuje podkreślenie, które w LIKE znaczy DOWOLNY ZNAK", () => {
    // Bez tego kasowanie "/raporty_2026/" złapałoby też "/raportyX2026/" -
    // czyli cudze pliki w obrębie tenanta, operacją nieodwracalną.
    expect(likePrefix("/raporty_2026/")).toBe("/raporty\\_2026/%");
  });

  it("escapuje procent, który w LIKE znaczy DOWOLNY CIĄG", () => {
    expect(likePrefix("/rabat%/")).toBe("/rabat\\%/%");
  });

  it("escapuje ukośnik wsteczny, czyli sam znak ucieczki", () => {
    // Nieescapowany backslash zjadłby następny znak wzorca i przesunął całe
    // dopasowanie o jedną pozycję.
    expect(likePrefix("/a\\b/")).toBe("/a\\\\b/%");
  });

  it("escapuje KAŻDE wystąpienie, nie tylko pierwsze", () => {
    expect(likePrefix("/a_b_c%/")).toBe("/a\\_b\\_c\\%/%");
  });

  it("zostawia dokładnie jeden wildcard - na końcu", () => {
    // Wildcard w środku prefiksu rozszerzyłby zakres operacji na rodzeństwo.
    const out = likePrefix("/press/2026/");
    expect(out.endsWith("%")).toBe(true);
    expect(out.slice(0, -1)).not.toContain("%");
  });
});

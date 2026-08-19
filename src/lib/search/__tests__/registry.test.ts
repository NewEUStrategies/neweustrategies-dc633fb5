// Rejestr komend palety. Dwie funkcje, obie bez testu do dziś, obie decydują
// o czymś, czego użytkownik nie może sprawdzić samodzielnie:
//
//   * `visibleCommands` decyduje, CO w ogóle widać. Pokazanie komendy
//     administracyjnej gościowi nie daje mu uprawnień (trasy i RLS stoją
//     osobno), ale ujawnia MAPĘ PANELU: adresy, nazwy sekcji, istnienie
//     ekranów. Odwrotny błąd - ukrycie komendy przed uprawnionym - jest
//     niewidoczny w logach i zgłasza go dopiero użytkownik.
//   * `buildHaystack` jest indeksem dopasowania. Czego tu nie ma, tego
//     wyszukiwarka komend nie znajdzie NIGDY, niezależnie od jakości matchera.
//
// Dopasowania rozmytego NIE testujemy tutaj - `fuzzy.ts` ma własny test i 100%
// pokrycia. Tutaj: WIDOCZNOŚĆ i ZAWARTOŚĆ INDEKSU.
import { describe, it, expect } from "vitest";
import { buildHaystack, visibleCommands, type PaletteCommand } from "@/lib/search/registry";

const GUEST = { isAdmin: false, isAuthenticated: false };
const USER = { isAdmin: false, isAuthenticated: true };
const ADMIN = { isAdmin: true, isAuthenticated: true };

const ids = (cmds: PaletteCommand[]) => cmds.map((c) => c.id);

describe("visibleCommands - widoczność per rola", () => {
  it("GOŚĆ widzi wyłącznie nawigację publiczną", () => {
    const visible = visibleCommands(GUEST);
    expect(visible.every((c) => !c.adminOnly && !c.authOnly)).toBe(true);
    expect(ids(visible)).toEqual(["nav:home", "nav:blog", "nav:pricing"]);
  });

  it("gość NIE POZNAJE mapy panelu - żaden adres /admin nie wycieka", () => {
    expect(visibleCommands(GUEST).some((c) => c.to?.startsWith("/admin"))).toBe(false);
  });

  it("gość nie widzi też adresów konta", () => {
    expect(visibleCommands(GUEST).some((c) => c.to?.startsWith("/profile"))).toBe(false);
  });

  it("ZALOGOWANY dostaje sekcję konta, ale nadal ani jednej komendy admina", () => {
    const visible = visibleCommands(USER);
    expect(visible.some((c) => c.section === "account")).toBe(true);
    expect(visible.some((c) => c.adminOnly)).toBe(false);
    expect(ids(visible)).toContain("acc:profile");
    expect(ids(visible)).not.toContain("adm:dashboard");
  });

  it("ADMIN widzi komplet - żadna komenda nie jest przed nim ukryta", () => {
    const visible = visibleCommands(ADMIN);
    expect(visible.some((c) => c.adminOnly)).toBe(true);
    expect(visible.some((c) => c.authOnly)).toBe(true);
    expect(ids(visible)).toContain("adm:paywall");
    expect(ids(visible)).toContain("acc:billing");
  });

  it("widoczność jest MONOTONICZNA: gość ⊂ zalogowany ⊂ admin", () => {
    const guest = new Set(ids(visibleCommands(GUEST)));
    const user = new Set(ids(visibleCommands(USER)));
    const admin = new Set(ids(visibleCommands(ADMIN)));
    expect([...guest].every((id) => user.has(id))).toBe(true);
    expect([...user].every((id) => admin.has(id))).toBe(true);
    expect(admin.size).toBeGreaterThan(user.size);
    expect(user.size).toBeGreaterThan(guest.size);
  });

  it("dwie flagi są NIEZALEŻNE: admin bez sesji dostaje komendy admina, ale nie konta", () => {
    // Kombinacja nie występuje w produkcji (`isAdmin` bierze się z ról sesji),
    // ale funkcja traktuje flagi rozłącznie i test to przypina - gdyby ktoś
    // zmienił `adminOnly` na „admin ORAZ zalogowany", zobaczymy to tutaj.
    const visible = visibleCommands({ isAdmin: true, isAuthenticated: false });
    expect(visible.some((c) => c.adminOnly)).toBe(true);
    expect(visible.some((c) => c.authOnly)).toBe(false);
    expect(ids(visible)).not.toContain("acc:profile");
  });

  it("nie gubi ani nie dubluje komend - lista admina to CAŁY rejestr, bez powtórek", () => {
    const all = ids(visibleCommands(ADMIN));
    expect(new Set(all).size).toBe(all.length);
  });

  it("zwraca nową listę przy każdym wywołaniu (filter nie mutuje rejestru)", () => {
    const a = visibleCommands(ADMIN);
    const b = visibleCommands(ADMIN);
    expect(a).not.toBe(b);
    expect(ids(a)).toEqual(ids(b));
  });
});

describe("rejestr - inwarianty wpisu", () => {
  const all = visibleCommands(ADMIN);

  it("każda komenda ma cel: adres ALBO akcję (inaczej Enter nic nie robi)", () => {
    const dead = all.filter((c) => !c.to && !c.run);
    expect(dead).toEqual([]);
  });

  it("każda komenda ma etykietę w OBU językach - rejestr nie chodzi przez słownik i18n", () => {
    const missing = all.filter((c) => !c.label_pl?.trim() || !c.label_en?.trim());
    expect(missing.map((c) => c.id)).toEqual([]);
  });

  it("adresy są bezwzględne - względny cel wywróciłby nawigację routera", () => {
    expect(all.filter((c) => c.to && !c.to.startsWith("/")).map((c) => c.id)).toEqual([]);
  });

  it("każda komenda administracyjna prowadzi pod /admin", () => {
    const stray = all.filter((c) => c.adminOnly && c.to && !c.to.startsWith("/admin"));
    expect(stray.map((c) => c.id)).toEqual([]);
  });

  it("każda komenda konta prowadzi pod /profile", () => {
    const stray = all.filter((c) => c.authOnly && c.to && !c.to.startsWith("/profile"));
    expect(stray.map((c) => c.id)).toEqual([]);
  });

  it("komendy „popularne” istnieją dla gościa i dla admina - pusty stan nie może być pusty", () => {
    expect(visibleCommands(GUEST).filter((c) => c.popular).length).toBeGreaterThan(0);
    expect(visibleCommands(ADMIN).filter((c) => c.popular).length).toBeGreaterThan(0);
  });

  it("każda komenda ma ikonę - wiersz bez ikony rozjeżdża siatkę palety", () => {
    expect(all.filter((c) => !c.icon).map((c) => c.id)).toEqual([]);
  });
});

describe("buildHaystack - zawartość indeksu dopasowania", () => {
  const cmd: PaletteCommand = {
    id: "test",
    section: "admin",
    label_pl: "Wpisy",
    label_en: "Posts",
    hint_pl: "lista wpisów",
    hint_en: "post list",
    keywords_pl: ["artykuły", "treści"],
    keywords_en: ["articles"],
    to: "/admin/posts",
  };

  it("indeksuje etykiety OBU języków - Polak szukający „posts” ma trafić", () => {
    const hay = buildHaystack({ cmd, lang: "pl" });
    expect(hay).toContain("Wpisy");
    expect(hay).toContain("Posts");
  });

  it("indeksuje podpowiedzi, słowa kluczowe obu języków i ścieżkę", () => {
    const hay = buildHaystack({ cmd, lang: "pl" });
    expect(hay).toContain("lista wpisów");
    expect(hay).toContain("post list");
    expect(hay).toContain("artykuły");
    expect(hay).toContain("articles");
    // Ścieżka w indeksie pozwala trafić komendę, wpisując jej adres.
    expect(hay).toContain("/admin/posts");
  });

  it("IGNORUJE parametr lang - indeks jest jeden dla obu języków", () => {
    // `BuildHaystackInput` deklaruje `lang`, ale funkcja destrukturyzuje samo
    // `cmd`. To martwy parametr w publicznym API: wołający ma prawo sądzić, że
    // zawęża indeks do jednego języka, a nie zawęża. Świadomie przypięte, żeby
    // zmiana na indeks per język nie przeszła niezauważona.
    expect(buildHaystack({ cmd, lang: "pl" })).toBe(buildHaystack({ cmd, lang: "en" }));
  });

  it("brak pól opcjonalnych nie wstrzykuje „undefined” do indeksu", () => {
    const bare: PaletteCommand = {
      id: "bare",
      section: "navigation",
      label_pl: "Start",
      label_en: "Home",
    };
    const hay = buildHaystack({ cmd: bare, lang: "pl" });
    expect(hay).not.toContain("undefined");
    expect(hay).toBe("Start Home");
  });

  it("przycina indeks - wiodące i końcowe spacje psułyby premię za początek frazy", () => {
    const bare: PaletteCommand = {
      id: "bare",
      section: "navigation",
      label_pl: "Start",
      label_en: "Home",
    };
    const hay = buildHaystack({ cmd: bare, lang: "pl" });
    expect(hay).toBe(hay.trim());
  });

  it("KAŻDA komenda rejestru ma niepusty indeks - inaczej jest nieodnajdywalna", () => {
    const empty = visibleCommands(ADMIN).filter(
      (c) => buildHaystack({ cmd: c, lang: "pl" }).length === 0,
    );
    expect(empty.map((c) => c.id)).toEqual([]);
  });

  it("indeks każdej komendy niesie jej adres, gdy komenda go ma", () => {
    for (const c of visibleCommands(ADMIN)) {
      if (c.to) expect(buildHaystack({ cmd: c, lang: "pl" })).toContain(c.to);
    }
  });
});

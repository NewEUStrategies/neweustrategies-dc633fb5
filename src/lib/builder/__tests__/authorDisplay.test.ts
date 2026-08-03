// Kontrakt prezentacji autora: dwie niezależne osie widoczności + dwa
// niezależne rozmiary, z pełną zgodnością wstecz dla trzech historycznych
// zapisów tego samego ustawienia.
//
// DLACZEGO TEN TEST ISTNIEJE
// Reguła "jak pokazać autora" żyła wcześniej w czterech kopiach (post-lista,
// slider, lista z oceną, metadane wpisu). Kopie się rozjechały: ten sam autor
// renderował się w różnych rozmiarach, a wariantu "sam awatar bez nazwiska"
// trójstan `authorDisplay` w ogóle nie potrafił wyrazić. Teraz jest JEDEN
// rezolwer - i to on musi mieć przypiętą precedencję, bo z niej korzysta
// zarówno renderer, jak i panel właściwości oraz warstwa zapytań.
import { describe, it, expect } from "vitest";
import {
  AUTHOR_AVATAR_SIZE_PX_DEFAULT,
  AUTHOR_DISPLAY_WIDGETS,
  AUTHOR_NAME_SIZE_PX_DEFAULT,
  authorDisplayMode,
  authorLabelText,
  authorVisibilityPatch,
  defaultAuthorLabel,
  formatAuthorLabelPrefix,
  needsSharedAuthorControl,
  resolveAuthorDisplay,
  widgetAuthorDisplayDefaults,
  widgetHasAuthorDisplay,
} from "../authorDisplay";

describe("resolveAuthorDisplay - kontrakt domyślny", () => {
  it("pusta treść = zdjęcie 20 px + nazwisko 12 px", () => {
    const d = resolveAuthorDisplay({}, "pl");
    expect(d.visible).toBe(true);
    expect(d.showName).toBe(true);
    expect(d.showAvatar).toBe(true);
    expect(d.nameSizePx).toBe(AUTHOR_NAME_SIZE_PX_DEFAULT);
    expect(d.nameSizePx).toBe(12);
    expect(d.avatarSizePx).toBe(AUTHOR_AVATAR_SIZE_PX_DEFAULT);
    expect(d.avatarSizePx).toBe(20);
    expect(d.mode).toBe("avatar");
    // Zdjęcie samo pełni rolę etykiety, więc prefiksu nie ma.
    expect(d.labelPrefix).toBe("");
  });

  it("baseline widgetu podmienia domyślne wymiary, treść nadal wygrywa", () => {
    const base = resolveAuthorDisplay({}, "pl", { avatarSizePx: 64, avatarRadiusPx: 999 });
    expect(base.avatarSizePx).toBe(64);
    expect(base.avatarRadiusPx).toBe(999);

    const overridden = resolveAuthorDisplay({ authorAvatarSizePx: 28 }, "pl", {
      avatarSizePx: 64,
    });
    expect(overridden.avatarSizePx).toBe(28);
  });

  it("rozmiary są domykane do zakresu oferowanego w panelu", () => {
    expect(resolveAuthorDisplay({ authorSizePx: 999 }, "pl").nameSizePx).toBe(24);
    expect(resolveAuthorDisplay({ authorSizePx: 1 }, "pl").nameSizePx).toBe(8);
    expect(resolveAuthorDisplay({ authorAvatarSizePx: 999 }, "pl").avatarSizePx).toBe(64);
    expect(resolveAuthorDisplay({ authorAvatarSizePx: 2 }, "pl").avatarSizePx).toBe(8);
  });

  it("akceptuje liczby zapisane jako string (panel commituje stringi)", () => {
    const d = resolveAuthorDisplay({ authorSizePx: "18", authorAvatarSizePx: "44" }, "pl");
    expect(d.nameSizePx).toBe(18);
    expect(d.avatarSizePx).toBe(44);
  });
});

describe("resolveAuthorDisplay - obie osie chowane niezależnie", () => {
  it("samo nazwisko: prefiks etykiety wchodzi zamiast zdjęcia", () => {
    const pl = resolveAuthorDisplay({ showAuthorAvatar: false }, "pl");
    expect(pl.showName).toBe(true);
    expect(pl.showAvatar).toBe(false);
    expect(pl.labelPrefix).toBe("Autor: ");
    expect(pl.mode).toBe("label");

    const en = resolveAuthorDisplay({ showAuthorAvatar: false }, "en");
    expect(en.labelPrefix).toBe("By: ");
  });

  it("samo zdjęcie: nazwisko schowane, bez prefiksu (nie ma czego etykietować)", () => {
    const d = resolveAuthorDisplay({ showAuthorName: false }, "pl");
    expect(d.showName).toBe(false);
    expect(d.showAvatar).toBe(true);
    expect(d.labelPrefix).toBe("");
    expect(d.visible).toBe(true);
    expect(d.mode).toBe("avatar");
  });

  it("obie osie wyłączone = brak sekcji autora", () => {
    const d = resolveAuthorDisplay({ showAuthorName: false, showAuthorAvatar: false }, "pl");
    expect(d.visible).toBe(false);
    expect(d.mode).toBe("none");
  });

  it("wymiary są niezależne: zmiana czcionki nie rusza awatara i odwrotnie", () => {
    const d = resolveAuthorDisplay({ authorSizePx: 20 }, "pl");
    expect(d.nameSizePx).toBe(20);
    expect(d.avatarSizePx).toBe(20); // default, nie echo czcionki
    const e = resolveAuthorDisplay({ authorAvatarSizePx: 48 }, "pl");
    expect(e.nameSizePx).toBe(12);
    expect(e.avatarSizePx).toBe(48);
  });
});

describe("resolveAuthorDisplay - etykieta", () => {
  it("własna etykieta redakcji wygrywa nad domyślną", () => {
    const d = resolveAuthorDisplay({ showAuthorAvatar: false, authorLabel_pl: "Redakcja" }, "pl");
    expect(d.labelPrefix).toBe("Redakcja: ");
  });

  it("nie dubluje dwukropka, gdy redakcja wpisała go sama", () => {
    const d = resolveAuthorDisplay({ showAuthorAvatar: false, authorLabel_pl: "Napisał: " }, "pl");
    expect(d.labelPrefix).toBe("Napisał: ");
    expect(d.labelPrefix).not.toContain(": :");
  });

  it("etykieta jest czytana per język, bez fallbacku PL→EN", () => {
    const content = { showAuthorAvatar: false, authorLabel_pl: "Redakcja" };
    expect(resolveAuthorDisplay(content, "en").labelPrefix).toBe("By: ");
    expect(authorLabelText(content, "pl")).toBe("Redakcja");
    expect(authorLabelText(content, "en")).toBe("");
  });

  it("pomocnicze funkcje etykiety są spójne z rezolwerem", () => {
    expect(defaultAuthorLabel("pl")).toBe("Autor");
    expect(defaultAuthorLabel("en")).toBe("By");
    expect(formatAuthorLabelPrefix("Autor")).toBe("Autor: ");
    expect(formatAuthorLabelPrefix("Autor:")).toBe("Autor: ");
    expect(formatAuthorLabelPrefix("   ")).toBe("");
  });
});

describe("resolveAuthorDisplay - zgodność wstecz", () => {
  it("historyczny showAuthor=false gasi całą sekcję", () => {
    expect(resolveAuthorDisplay({ showAuthor: false }, "pl").visible).toBe(false);
    // ...także w zapisie stringowym z selecta "0"/"1".
    expect(resolveAuthorDisplay({ showAuthor: "0" }, "pl").visible).toBe(false);
    expect(resolveAuthorDisplay({ showAuthor: "1" }, "pl").visible).toBe(true);
  });

  it("historyczny trójstan authorDisplay wygrywa nad showAuthor", () => {
    expect(resolveAuthorDisplay({ showAuthor: false, authorDisplay: "label" }, "pl").mode).toBe(
      "label",
    );
    expect(resolveAuthorDisplay({ authorDisplay: "avatar" }, "pl").mode).toBe("avatar");
    expect(resolveAuthorDisplay({ authorDisplay: "none" }, "pl").visible).toBe(false);
  });

  it("historyczna para showAuthorAvatar/showAuthorLabel działa jak dotąd", () => {
    // oba wyłączone = brak autora (kontrakt `postListAuthorDisplay`)
    expect(
      resolveAuthorDisplay({ showAuthorAvatar: "0", showAuthorLabel: "0" }, "pl").visible,
    ).toBe(false);
    // samo zdjęcie wyłączone = degradacja do etykiety
    expect(resolveAuthorDisplay({ showAuthorAvatar: "0" }, "pl").mode).toBe("label");
    // sama etykieta wyłączona = zdjęcie + nazwisko
    expect(resolveAuthorDisplay({ showAuthorLabel: "0" }, "pl").mode).toBe("avatar");
  });

  it("klucz kanoniczny wygrywa nad każdym zapisem historycznym", () => {
    const d = resolveAuthorDisplay(
      { authorDisplay: "avatar", showAuthor: true, showAuthorName: false },
      "pl",
    );
    expect(d.showName).toBe(false);
    expect(d.showAvatar).toBe(true);
  });

  it("nieznana wartość trójstanu nie wywraca rezolwera", () => {
    expect(resolveAuthorDisplay({ authorDisplay: "sabotage" }, "pl").mode).toBe("avatar");
  });
});

describe("authorDisplayMode - warstwa zapytań", () => {
  it("zwraca trójstan bez znajomości języka", () => {
    expect(authorDisplayMode({})).toBe("avatar");
    expect(authorDisplayMode({ showAuthorAvatar: false })).toBe("label");
    expect(authorDisplayMode({ showAuthor: false })).toBe("none");
  });
});

describe("authorVisibilityPatch - panel utrzymuje klucze historyczne w spójności", () => {
  it("zapisuje komplet: kanoniczne + historyczne", () => {
    expect(authorVisibilityPatch(true, false)).toEqual({
      showAuthorName: true,
      showAuthorAvatar: false,
      showAuthor: true,
      authorDisplay: "label",
      showAuthorLabel: true,
    });
    expect(authorVisibilityPatch(false, false)).toEqual({
      showAuthorName: false,
      showAuthorAvatar: false,
      showAuthor: false,
      authorDisplay: "none",
      showAuthorLabel: false,
    });
  });

  it("patch jest punktem stałym rezolwera (zapis -> odczyt -> ten sam stan)", () => {
    for (const [name, avatar] of [
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ] as const) {
      const d = resolveAuthorDisplay(authorVisibilityPatch(name, avatar), "pl");
      expect([d.showName, d.showAvatar]).toEqual([name, avatar]);
    }
  });
});

describe("katalog widgetów z autorem", () => {
  it("każdy widget z bylinem ma DOKŁADNIE jedno miejsce na kontrolkę", () => {
    for (const type of AUTHOR_DISPLAY_WIDGETS) {
      expect(widgetHasAuthorDisplay(type)).toBe(true);
    }
    // Edytory niestandardowe wpinają kontrolkę same - panel nie dubluje.
    expect(needsSharedAuthorControl("post-list")).toBe(false);
    expect(needsSharedAuthorControl("slider")).toBe(false);
    expect(needsSharedAuthorControl("rated-list")).toBe(false);
    // Widgety schematowe dostają ją z zakładki „Treść".
    expect(needsSharedAuthorControl("post-meta")).toBe(true);
    expect(needsSharedAuthorControl("testimonial")).toBe(true);
    // Widget bez autora nie dostaje jej wcale.
    expect(widgetHasAuthorDisplay("heading")).toBe(false);
    expect(needsSharedAuthorControl("heading")).toBe(false);
  });

  it("karta autora dziedziczy historyczny przełącznik zdjęcia jako baseline", () => {
    const defaults = widgetAuthorDisplayDefaults("post-author-card", { showAvatar: false });
    expect(defaults.showAvatar).toBe(false);
    expect(resolveAuthorDisplay({ showAvatar: false }, "pl", defaults).showAvatar).toBe(false);
    // ...ale kanoniczny klucz nadal go przebija.
    expect(
      resolveAuthorDisplay({ showAvatar: false, showAuthorAvatar: true }, "pl", defaults)
        .showAvatar,
    ).toBe(true);
  });
});

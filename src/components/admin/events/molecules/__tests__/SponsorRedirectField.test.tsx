// Molekuła „Przekierowanie logotypu" - wybór, dokąd prowadzi kliknięcie w logo
// sponsora: szczegóły wystawcy, zewnętrzny adres (https://) albo brak linku.
//
// CO TEN PLIK DOWODZI.
//   1. POLE ADRESU JEST TYLKO PRZY TRYBIE ZEWNĘTRZNYM. Szczegóły wystawcy i brak
//      linku nie mają adresu, więc nie pokazują pola, którego baza i tak nie
//      zapisze (`admin_event_sponsor_set_link` zeruje `link_url` poza trybem
//      `external`).
//   2. KLIENT ZATRZYMUJE TO, CZEGO BAZA NIE PRZYJMIE. Funkcja bazy rzuca
//      `invalid_link_url` dla adresu spoza `^https://[^\s]{3,}$` (bez względu na
//      wielkość liter, `~*`) albo dłuższego niż 2008 znaków
//      (`20260923000000_event_link_url_regex_within_limit.sql`). Pole liczy to
//      samo PRAWDZIWYM `isHttpsUrl`: granice (3 znaki po schemacie, 2008 znaków
//      razem), `http://`, spacja w środku - każdy z tych adresów gasi zapis
//      i oznacza pole `aria-invalid`, zanim cokolwiek wyjdzie do bazy.
//   3. PUSTE POLE NIE KRZYCZY. Świeżo wybrany tryb zewnętrzny bez adresu ma
//      zgaszony zapis i `aria-invalid`, ale nie pokazuje komunikatu - organizator
//      jeszcze niczego nie wpisał.
//   4. ZAPIS TYLKO ZMIANY. Przycisk jest zgaszony, dopóki szkic nie różni się od
//      wartości z bazy, oraz w trakcie zapisu; powrót do wartości wyjściowej
//      znów go gasi. Zapis oddaje rodzicowi DOKŁADNIE szkic (tryb + adres).
//   5. ODMOWA BAZY NIE KASUJE SZKICU. Molekuła nie zna wyniku zapisu - komunikat
//      pokazuje rodzic, a wartość z bazy zostaje ta sama. Ponowny render z TĄ
//      SAMĄ wartością zostawia wpisany adres do poprawienia; dopiero NOWA wartość
//      (dane odświeżone po udanym zapisie) nadpisuje szkic.
//   6. JĘZYK NIE ROZGAŁĘZIA MOLEKUŁY. Etykiety to te same klucze w PL i EN
//      (parytet słowników pilnuje bramka `check:i18n-parity`).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Wywołania RPC i komunikatów po zapisie - to
// `organisms/__tests__/SponsorSectionDrawer.test.tsx`, gdzie molekuła siedzi
// w prawdziwym rodzicu. Przycinania adresu przed wysyłką (`setSponsorLink`
// w `lib/events/sponsorBoardApi.ts`) - molekuła sama niczego nie przycina;
// spacje z brzegów zdejmuje już pole `type="url"` (sanityzacja wartości wg HTML).
//
// Radix Select nie otwiera listy pod happy-dom - wspólna atrapa natywnego
// `<select>` z `@/test/reactStubs` (zachowuje `id` wyzwalacza, więc etykieta
// dalej wiąże się z polem).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { SponsorLink } from "@/lib/events/sponsorBoardApi";

const h = vi.hoisted(() => ({
  lang: "pl" as string,
  saved: [] as SponsorLink[],
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);

import { SponsorRedirectField } from "@/components/admin/events/molecules/SponsorRedirectField";

const R = "sponsorBoard.redirect";
const WYSTAWCA: SponsorLink = { mode: "exhibitor", url: "" };

function pole(value: SponsorLink = WYSTAWCA, isSaving = false) {
  const onSave = (link: SponsorLink) => {
    h.saved.push(link);
  };
  const widok = render(
    <SponsorRedirectField id="link-s1" value={value} isSaving={isSaving} onSave={onSave} />,
  );
  return {
    ...widok,
    przerysuj: (next: SponsorLink, saving = false) =>
      widok.rerender(
        <SponsorRedirectField id="link-s1" value={next} isSaving={saving} onSave={onSave} />,
      ),
  };
}

const tryb = (): HTMLSelectElement => {
  const el = screen.getByLabelText(`${R}.label`);
  if (!(el instanceof HTMLSelectElement)) throw new Error("wybór trybu nie jest listą");
  return el;
};
const adres = (): HTMLInputElement => {
  const el = screen.getByLabelText(`${R}.urlLabel`);
  if (!(el instanceof HTMLInputElement)) throw new Error("pole adresu nie jest polem tekstowym");
  return el;
};
const zapis = (): HTMLButtonElement => {
  const el = screen.getByRole("button", { name: `${R}.save` });
  if (!(el instanceof HTMLButtonElement)) throw new Error("zapis nie jest przyciskiem");
  return el;
};

const wybierz = (mode: string) => fireEvent.change(tryb(), { target: { value: mode } });
const wpisz = (url: string) => fireEvent.change(adres(), { target: { value: url } });

beforeEach(() => {
  h.lang = "pl";
  h.saved = [];
});

describe("wybór trybu", () => {
  it.each(["pl", "en"])("w języku %s lista oferuje trzy tryby pod tymi samymi kluczami", (lang) => {
    h.lang = lang;
    pole();
    const opcje = Array.from(tryb().options).map((o) => [o.value, o.textContent]);
    expect(opcje).toEqual([
      ["exhibitor", `${R}.exhibitor`],
      ["external", `${R}.external`],
      ["none", `${R}.none`],
    ]);
    expect(tryb().id).toBe("link-s1-mode");
  });

  it("pokazuje tryb z bazy, bez pola adresu i ze zgaszonym zapisem", () => {
    pole();
    expect(tryb().value).toBe("exhibitor");
    expect(screen.queryByLabelText(`${R}.urlLabel`)).toBeNull();
    expect(zapis().disabled).toBe(true);
  });

  it("zmiana na brak linku zapala zapis i oddaje rodzicowi nowy tryb", () => {
    pole();
    wybierz("none");
    expect(tryb().value).toBe("none");
    expect(zapis().disabled).toBe(false);
    fireEvent.click(zapis());
    expect(h.saved).toEqual([{ mode: "none", url: "" }]);
  });

  it("powrót do trybu z bazy znowu gasi zapis", () => {
    pole();
    wybierz("none");
    wybierz("exhibitor");
    expect(zapis().disabled).toBe(true);
  });

  it("w trakcie zapisu przycisk jest zgaszony mimo zmiany", () => {
    pole(WYSTAWCA, true);
    wybierz("none");
    expect(zapis().disabled).toBe(true);
  });
});

describe("adres zewnętrzny", () => {
  it("tryb zewnętrzny odsłania puste pole adresu: nieważne, ale bez komunikatu", () => {
    pole();
    wybierz("external");
    expect(adres().id).toBe("link-s1-url");
    expect(adres().value).toBe("");
    expect(adres().getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByText(`${R}.urlInvalid`)).toBeNull();
    expect(zapis().disabled).toBe(true);
  });

  it("poprawny adres zdejmuje oznaczenie błędu i idzie do zapisu razem z trybem", () => {
    pole();
    wybierz("external");
    wpisz("https://example.org/sponsor");
    expect(adres().getAttribute("aria-invalid")).toBe("false");
    expect(screen.queryByText(`${R}.urlInvalid`)).toBeNull();
    fireEvent.click(zapis());
    expect(h.saved).toEqual([{ mode: "external", url: "https://example.org/sponsor" }]);
  });

  it.each<[string, string]>([
    ["http:// zamiast https://", "http://example.org"],
    ["sam schemat bez hosta", "https://"],
    ["tylko dwa znaki po schemacie", "https://ab"],
    ["spacja w środku adresu", "https://example.org/moja strona"],
    ["adres dłuższy niż 2008 znaków", `https://${"a".repeat(2001)}`],
  ])("adres odrzucany przez bazę (%s) gasi zapis i mówi, co poprawić", (_nazwa, url) => {
    pole();
    wybierz("external");
    wpisz(url);
    expect(adres().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(`${R}.urlInvalid`)).toBeTruthy();
    expect(zapis().disabled).toBe(true);
  });

  it.each<[string, string]>([
    ["dokładnie trzy znaki po schemacie", "https://abc"],
    ["dokładnie 2008 znaków razem", `https://${"a".repeat(2000)}`],
    ["schemat wielkimi literami (baza porównuje przez ~*)", "HTTPS://EXAMPLE.ORG"],
  ])("adres na granicy przyjmowanej przez bazę (%s) można zapisać", (_nazwa, url) => {
    pole();
    wybierz("external");
    wpisz(url);
    expect(adres().getAttribute("aria-invalid")).toBe("false");
    expect(screen.queryByText(`${R}.urlInvalid`)).toBeNull();
    fireEvent.click(zapis());
    expect(h.saved).toEqual([{ mode: "external", url }]);
  });

  it("spacje na brzegach adresu nie blokują zapisu i nie trafiają do szkicu", () => {
    pole();
    wybierz("external");
    wpisz("  https://example.org  ");
    expect(screen.queryByText(`${R}.urlInvalid`)).toBeNull();
    fireEvent.click(zapis());
    expect(h.saved).toEqual([{ mode: "external", url: "https://example.org" }]);
  });

  it("zapisany adres z bazy jest w polu, a zapis czeka na zmianę", () => {
    pole({ mode: "external", url: "https://example.org" });
    expect(tryb().value).toBe("external");
    expect(adres().value).toBe("https://example.org");
    expect(zapis().disabled).toBe(true);
    wpisz("https://example.org/nowy");
    expect(zapis().disabled).toBe(false);
    wpisz("https://example.org");
    expect(zapis().disabled).toBe(true);
  });

  it("zmiana trybu z zewnętrznego chowa pole adresu", () => {
    pole({ mode: "external", url: "https://example.org" });
    wybierz("none");
    expect(screen.queryByLabelText(`${R}.urlLabel`)).toBeNull();
    expect(zapis().disabled).toBe(false);
  });
});

describe("szkic a wartość z bazy", () => {
  it("odmowa bazy (ta sama wartość po zapisie) zostawia wpisany adres do poprawienia", () => {
    const widok = pole(WYSTAWCA);
    wybierz("external");
    wpisz("https://example.org/odrzucony");
    fireEvent.click(zapis());
    widok.przerysuj(WYSTAWCA);
    expect(tryb().value).toBe("external");
    expect(adres().value).toBe("https://example.org/odrzucony");
    expect(zapis().disabled).toBe(false);
  });

  it("nowa wartość z bazy (udany zapis) nadpisuje szkic i gasi zapis", () => {
    const widok = pole(WYSTAWCA);
    wybierz("external");
    wpisz("https://example.org/przyjety");
    widok.przerysuj({ mode: "external", url: "https://example.org/przyjety" });
    expect(adres().value).toBe("https://example.org/przyjety");
    expect(zapis().disabled).toBe(true);
  });

  it("wartość zmieniona w bazie z innego miejsca wraca do pola", () => {
    const widok = pole({ mode: "external", url: "https://example.org" });
    widok.przerysuj({ mode: "none", url: "" });
    expect(tryb().value).toBe("none");
    expect(screen.queryByLabelText(`${R}.urlLabel`)).toBeNull();
  });
});

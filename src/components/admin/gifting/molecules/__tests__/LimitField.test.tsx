// Molekula: pole limitu panelu prezentow.
//
// PO CO TEN PLIK ISTNIEJE. To jest jedyne miejsce w panelu, w ktorym liczba
// wpisana przez czlowieka zamienia sie w regule egzekwowana przez baze. Domena
// ma tu jedna wlasciwosc, ktora czyni kazdy "oczywisty" skrot NIEBEZPIECZNYM:
//
//   0 NIE ZNACZY "NIC", 0 ZNACZY "BEZ LIMITU".
//
// Skutek: gdyby puste pole koercjowac do zera - odruch, ktory `Number("")`
// podpowiada sam z siebie, bo `Number("") === 0` - to skasowanie zawartosci
// pola i zapis formularza ustawialoby BUDZET KLIKNIEC NA NIESKONCZONOSC.
// Jeden upubliczniony link otwieralby wtedy platny artykul calemu internetowi.
// Dokladnie ta pulapke naprawiala migracja 20260724090600 (patrz jej naglowek:
// "domyslna konfiguracja umozliwiala obejscie paywalla"), a `admin-model.ts`
// utrwala reguly w `parseGiftAdminLimitInput` (puste -> null, nigdy 0).
//
// Ten plik pilnuje, ze POLE tej reguly nie obchodzi: ze puste pole melduje
// `null`, ze `0` wpisane SWIADOMIE dostaje glosne ostrzezenie, i ze zakres
// input-a jest ten sam, co CHECK w bazie (parytet liczb ma osobna bramke -
// `src/lib/gifting/__tests__/dbEnumParity.test.ts`).
//
// ATRAPY: wylacznie i18n (granica). `@/lib/gifting/admin-model` biegnie
// PRAWDZIWY - to sasiad, a nie granica, i to on nosi cala regule.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";
import { GIFT_ADMIN_BOUNDS, type GiftAdminLimitField } from "@/lib/gifting/admin-model";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

const { LimitField } = await import("@/components/admin/gifting/molecules/LimitField");

const onChange = vi.fn();

beforeEach(() => {
  onChange.mockReset();
});

function renderField(overrides: Partial<Parameters<typeof LimitField>[0]> = {}) {
  const props = {
    field: "max_redemptions_per_link" as GiftAdminLimitField,
    label: "Budzet kliknieć na link",
    hint: "podpowiedz",
    value: 5 as number | null,
    issue: undefined,
    onChange,
    ...overrides,
  };
  return render(<LimitField {...props} />);
}

function input(): HTMLInputElement {
  return screen.getByRole("spinbutton") as HTMLInputElement;
}

describe("LimitField - puste pole NIE JEST cichym zerem", () => {
  it("skasowanie zawartosci melduje null, a NIE 0", () => {
    renderField({ value: 5 });
    fireEvent.change(input(), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(null);
    // Asercja negatywna jest tu rownie wazna: `Number("")` daje 0, wiec
    // regresja polegajaca na "uproszczeniu" parsera przeszlaby test, ktory
    // sprawdza tylko `toHaveBeenCalled()`.
    expect(onChange).not.toHaveBeenCalledWith(0);
  });

  it("same biale znaki tez daja null", () => {
    renderField({ value: 5 });
    fireEvent.change(input(), { target: { value: "   " } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("null renderuje sie jako PUSTE pole, a nie jako '0'", () => {
    // Gdyby pole pokazywalo "0" dla stanu "w edycji", admin widzialby
    // "bez limitu" tam, gdzie nie ma jeszcze zadnej wartosci.
    renderField({ value: null });
    expect(input().value).toBe("");
  });

  it("pusty draft dostaje komunikat 'wymagane', a nie ostrzezenie o zerze", () => {
    renderField({ value: null, issue: "required", zeroWarning: "UWAGA-ZERO" });
    expect(screen.getByText(/giftingAdmin\.settings\.errors\.required/)).toBeTruthy();
    expect(screen.queryByText("UWAGA-ZERO")).toBeNull();
  });
});

describe("LimitField - semantyka '0 = bez limitu'", () => {
  it("wartosc 0 podnosi glosne ostrzezenie", () => {
    renderField({ value: 0, zeroWarning: "0 = bez limitu klikniec" });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("0 = bez limitu klikniec");
  });

  it("wartosc > 0 ostrzezenia NIE pokazuje", () => {
    renderField({ value: 1, zeroWarning: "0 = bez limitu klikniec" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("pole bez zeroWarning nie wymysla ostrzezenia dla zera", () => {
    // Miesieczny limit i TTL tez dopuszczaja 0, ale ich konsekwencja jest
    // inna niz przy budzecie klikniec - panel podaje ostrzezenie tylko tam,
    // gdzie 0 otwiera paywall.
    renderField({ value: 0 });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("blad walidacji WYGRYWA z ostrzezeniem o zerze", () => {
    // Zero poza zakresem to sprzecznosc; pokazanie obu komunikatow naraz
    // kazaloby adminowi zgadywac, ktory jest prawdziwy.
    renderField({ value: 0, issue: "range", zeroWarning: "UWAGA-ZERO" });
    expect(screen.queryByText("UWAGA-ZERO")).toBeNull();
    expect(screen.getByText(/giftingAdmin\.settings\.errors\.range/)).toBeTruthy();
  });

  it("wpisanie 0 melduje liczbe 0, a nie null", () => {
    // Druga strona reguly: SWIADOME zero musi doleciec do draftu, inaczej
    // "bez limitu" byloby nieosiagalne z panelu.
    renderField({ value: 5 });
    fireEvent.change(input(), { target: { value: "0" } });
    expect(onChange).toHaveBeenCalledWith(0);
  });
});

describe("LimitField - wartosci spoza zakresu i nie-liczby", () => {
  it("wartosc powyzej maksimum melduje liczbe (walidacje robi draft, nie pole)", () => {
    // Pole CELOWO nie obcina wartosci: obciecie ukrywaloby pomylke admina.
    // Zamiast tego liczba jedzie do draftu, a `validateGiftAdminDraft` oznacza
    // ja jako "range" i blokuje zapis.
    renderField({ field: "monthly_limit", value: 10 });
    fireEvent.change(input(), { target: { value: "5000" } });
    expect(onChange).toHaveBeenCalledWith(5000);
  });

  it("wartosc ujemna tez dolatuje do draftu", () => {
    renderField({ field: "monthly_limit", value: 10 });
    fireEvent.change(input(), { target: { value: "-3" } });
    expect(onChange).toHaveBeenCalledWith(-3);
  });

  it("ulamek jest obcinany do calkowitej (wszystkie limity sa calkowite)", () => {
    renderField({ value: 5 });
    fireEvent.change(input(), { target: { value: "3.9" } });
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it("smiec tekstowy daje null, a NIE NaN", () => {
    // NaN w polu kontrolowanym psul zapis i generowal ostrzezenia Reacta -
    // patrz komentarz przy `parseGiftAdminLimitInput`.
    renderField({ value: 5 });
    fireEvent.change(input(), { target: { value: "abc" } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("wartosc poza zakresem dostaje komunikat z GRANICAMI z bazy", () => {
    renderField({ field: "link_ttl_days", value: 900, issue: "range" });
    const message = screen.getByText(/giftingAdmin\.settings\.errors\.range/);
    // Atrapa i18n dokleja parametry, wiec widac, ze do komunikatu ida
    // realne granice pola, a nie liczby wpisane recznie w tekscie.
    expect(message.textContent).toContain("max=365");
    expect(message.textContent).toContain("min=0");
  });
});

describe("LimitField - atrybuty pola pochodza z GIFT_ADMIN_BOUNDS", () => {
  const FIELDS: readonly GiftAdminLimitField[] = [
    "monthly_limit",
    "link_ttl_days",
    "max_redemptions_per_link",
  ];

  it.each(FIELDS)("%s: min/max input-a === zakres modelu", (field) => {
    // Przegladarka, walidacja draftu i CHECK w bazie maja egzekwowac DOKLADNIE
    // ten sam przedzial - inaczej admin dostaje odmowe dopiero z serwera.
    renderField({ field, value: GIFT_ADMIN_BOUNDS[field].fallback });
    expect(input().getAttribute("min")).toBe(String(GIFT_ADMIN_BOUNDS[field].min));
    expect(input().getAttribute("max")).toBe(String(GIFT_ADMIN_BOUNDS[field].max));
  });

  it.each(FIELDS)("%s: identyfikator pola jest unikalny per pole", (field) => {
    renderField({ field, value: 1 });
    expect(input().id).toBe(`gift-admin-${field}`);
  });

  it("krok wynosi 1 (limity sa calkowite)", () => {
    renderField({ value: 5 });
    expect(input().getAttribute("step")).toBe("1");
  });
});

describe("LimitField - dostepnosc", () => {
  it("etykieta jest powiazana z polem", () => {
    renderField({ label: "Budzet klikniec" });
    expect(screen.getByLabelText("Budzet klikniec")).toBe(input());
  });

  it("blad oznacza pole jako niepoprawne i wskazuje komunikat", () => {
    renderField({ value: null, issue: "required" });
    expect(input().getAttribute("aria-invalid")).toBe("true");
    const described = input().getAttribute("aria-describedby");
    expect(described).toBe("gift-admin-max_redemptions_per_link-message");
    expect(document.getElementById(described ?? "")?.textContent).toContain("required");
  });

  it("stan poprawny NIE ustawia aria-invalid", () => {
    renderField({ value: 5 });
    expect(input().getAttribute("aria-invalid")).toBeNull();
  });

  it("podpowiedz jest opisem pola, gdy nie ma bledu", () => {
    renderField({ value: 5, hint: "ilu odbiorcow otworzy artykul" });
    const described = input().getAttribute("aria-describedby");
    expect(document.getElementById(described ?? "")?.textContent).toBe(
      "ilu odbiorcow otworzy artykul",
    );
  });

  it("nie wnosi naruszen dostepnosci - stan poprawny", async () => {
    const { container } = renderField({ value: 5 });
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("nie wnosi naruszen dostepnosci - stan bledny", async () => {
    const { container } = renderField({ value: null, issue: "required" });
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

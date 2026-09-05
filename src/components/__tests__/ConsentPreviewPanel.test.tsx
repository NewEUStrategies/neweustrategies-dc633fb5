// Panel podglądu zgody (`?consent-preview=1`) - narzędzie redakcji do
// sprawdzania, które skrypty wchodzą przy jakiej zgodzie.
//
// CO TU JEST PRZYPINANE I DLACZEGO. Ten panel jest w drzewie na KAŻDEJ
// stronie publicznej, a przełącza rzecz o skutkach prawnych (RODO/ePrivacy).
// Cztery rzeczy muszą być tu prawdziwe:
//
//   1. PANEL NIE ISTNIEJE BEZ JAWNEGO ŻĄDANIA. Bez `?consent-preview=1`
//      nie renderuje się nic - inaczej odwiedzający dostałby narzędzie
//      redakcyjne przyklejone do rogu ekranu.
//
//   2. KATEGORIA „NIEZBĘDNE" NIE JEST PRZEŁĄCZALNA. Jej pole jest
//      zablokowane, a próba zmiany nie może dotknąć magazynu podglądu.
//      To jedyna kategoria, której nie da się wyłączyć zgodnie z prawem.
//
//   3. PRZEŁĄCZENIE JEDNEJ KATEGORII ZACHOWUJE POZOSTAŁE. Panel wysyła
//      CAŁY stan (`{...categories, [cat]: next}`), więc zgubienie rozkładu
//      cicho odwoływałoby zgody, których nikt nie odwoływał.
//
//   4. „WSZYSTKO"/„NIC"/RESET SĄ TRZEMA RÓŻNYMI OPERACJAMI - skróty muszą
//      wysyłać komplet, pustkę i CZYSZCZENIE podglądu (powrót do decyzji
//      rzeczywistej), a nie to samo trzy razy.
//
// GRANICĄ ATRAPY jest moduł `@/lib/ads/consent`: to on czyta adres strony,
// `sessionStorage` i stan zgody, i on ma własne testy. Tutaj interesuje nas
// WYŁĄCZNIE, co panel z niego czyta i co do niego wysyła. `react-i18next`
// jest podmieniony na PRAWDZIWY tłumacz (`realT`), żeby napisy mierzyły
// słownik rdzenia.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ConsentCategory } from "@/lib/ads/consent";

const h = vi.hoisted(() => ({
  lang: "pl" as "pl" | "en",
  /** Prawdziwy `getFixedT`, wstrzyknięty pod importami - fabryka nic nie importuje. */
  fixedT: null as null | typeof realT,
  requested: true,
  preview: false,
  categories: {
    necessary: true,
    functional: false,
    analytics: false,
    marketing: false,
  } as Record<ConsentCategory, boolean>,
  setPreview: vi.fn(),
  clearPreview: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.(h.lang), i18n: { language: h.lang }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@/lib/ads/consent", () => ({
  isConsentPreviewRequested: () => h.requested,
  setConsentPreview: h.setPreview,
  clearConsentPreview: h.clearPreview,
  useEffectiveConsent: () => ({ categories: h.categories, preview: h.preview }),
}));

import { ConsentPreviewPanel } from "@/components/ConsentPreviewPanel";
import { realT } from "@/test/i18nReal";

h.fixedT = realT;

/** Pole wyboru kategorii - podpisane samą nazwą kategorii. */
function toggle(cat: ConsentCategory): HTMLElement {
  return screen.getByLabelText(cat);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.lang = "pl";
  h.requested = true;
  h.preview = false;
  h.categories = { necessary: true, functional: false, analytics: false, marketing: false };
});

describe("panel pojawia się wyłącznie na jawne żądanie", () => {
  it("bez parametru w adresie nie renderuje niczego", () => {
    h.requested = false;
    const { container } = render(<ConsentPreviewPanel />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(realT("pl")("consent.preview.title"))).toBeNull();
  });

  it("z parametrem pokazuje tytuł, podpowiedź i cztery kategorie", () => {
    render(<ConsentPreviewPanel />);

    expect(screen.getByText(realT("pl")("consent.preview.title"))).toBeInTheDocument();
    expect(screen.getByText(realT("pl")("consent.preview.hint"))).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
  });
});

describe("znacznik mówi, czy patrzysz na podgląd, czy na decyzję rzeczywistą", () => {
  it("bez aktywnego podglądu pokazuje stan rzeczywisty", () => {
    render(<ConsentPreviewPanel />);

    expect(screen.getByText(realT("pl")("consent.preview.inactive"))).toBeInTheDocument();
    expect(screen.queryByText(realT("pl")("consent.preview.active"))).toBeNull();
  });

  it("przy aktywnym podglądzie znacznik się zmienia", () => {
    // Bez tego rozróżnienia redaktor nie wie, czy właśnie testuje, czy patrzy
    // na własną, prawdziwą zgodę.
    h.preview = true;
    render(<ConsentPreviewPanel />);

    expect(screen.getByText(realT("pl")("consent.preview.active"))).toBeInTheDocument();
  });

  it("po angielsku napisy idą z angielskiego słownika", () => {
    h.lang = "en";
    render(<ConsentPreviewPanel />);

    expect(screen.getByText(realT("en")("consent.preview.title"))).toBeInTheDocument();
    expect(screen.getByText(realT("en")("consent.preview.acceptAll"))).toBeInTheDocument();
  });
});

describe("przełączniki kategorii", () => {
  it("pola odbijają stan zgody, a niezbędne jest zablokowane", () => {
    h.categories = { necessary: true, functional: true, analytics: false, marketing: false };
    render(<ConsentPreviewPanel />);

    expect(toggle("necessary")).toBeChecked();
    expect(toggle("necessary")).toBeDisabled();
    expect(toggle("functional")).toBeChecked();
    expect(toggle("analytics")).not.toBeChecked();
  });

  it("włączenie analityki wysyła CAŁY stan, nie samą zmienioną kategorię", () => {
    // Panel wysyła komplet; zgubienie rozkładu cicho odwołałoby zgodę
    // funkcjonalną, której nikt nie odwoływał.
    h.categories = { necessary: true, functional: true, analytics: false, marketing: false };
    render(<ConsentPreviewPanel />);

    fireEvent.click(toggle("analytics"));

    expect(h.setPreview).toHaveBeenCalledTimes(1);
    expect(h.setPreview).toHaveBeenCalledWith({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: false,
    });
  });

  it("wyłączenie marketingu też przechodzi przez magazyn podglądu", () => {
    h.categories = { necessary: true, functional: false, analytics: false, marketing: true };
    render(<ConsentPreviewPanel />);

    fireEvent.click(toggle("marketing"));

    expect(h.setPreview).toHaveBeenCalledWith({
      necessary: true,
      functional: false,
      analytics: false,
      marketing: false,
    });
  });

  it("kategoria niezbędna jest NIEPRZEŁĄCZALNA - klik nic nie zmienia", () => {
    render(<ConsentPreviewPanel />);

    fireEvent.click(toggle("necessary"));

    expect(h.setPreview).not.toHaveBeenCalled();
  });

  it("nawet WYMUSZONA zmiana pola niezbędnego nie dociera do magazynu", () => {
    // Sam atrybut `disabled` to bariera wyłącznie w przeglądarce - rozszerzenie,
    // narzędzia deweloperskie albo zmiana atrybutu w DOM ją zdejmują. Dowodem
    // reguły jest bramka W KODZIE, dlatego zdarzenie idzie tu wprost na pole,
    // z pominięciem blokady interfejsu.
    render(<ConsentPreviewPanel />);

    const necessary = toggle("necessary");
    if (!(necessary instanceof HTMLInputElement)) throw new Error("test: to nie jest pole wyboru");
    necessary.disabled = false;
    fireEvent.click(necessary);

    // Pole wraca do stanu włączonego, bo jego wartość jest sterowana stanem
    // zgody - wymuszony klik nie zostawia po sobie nawet wrażenia zmiany.
    expect(necessary.checked).toBe(true);
    expect(h.setPreview).not.toHaveBeenCalled();
    expect(h.clearPreview).not.toHaveBeenCalled();
  });
});

describe("trzy skróty to trzy różne operacje", () => {
  it("skrot akceptacji wlacza komplet kategorii opcjonalnych", () => {
    render(<ConsentPreviewPanel />);

    fireEvent.click(screen.getByRole("button", { name: realT("pl")("consent.preview.acceptAll") }));

    expect(h.setPreview).toHaveBeenCalledWith({
      functional: true,
      analytics: true,
      marketing: true,
    });
  });

  it("skrot odmowy wysyla pusty komplet, a nie czysci podgladu", () => {
    render(<ConsentPreviewPanel />);

    fireEvent.click(screen.getByRole("button", { name: realT("pl")("consent.preview.rejectAll") }));

    expect(h.setPreview).toHaveBeenCalledWith({});
    expect(h.clearPreview).not.toHaveBeenCalled();
  });

  it("reset CZYŚCI podgląd, zamiast ustawiać kolejny stan", () => {
    // To jedyna droga powrotu do decyzji rzeczywistej - wysłanie tu
    // `setConsentPreview({})` zostawiłoby redaktora w podglądzie „nic".
    render(<ConsentPreviewPanel />);

    fireEvent.click(screen.getByTitle(realT("pl")("consent.preview.reset")));

    expect(h.clearPreview).toHaveBeenCalledTimes(1);
    expect(h.setPreview).not.toHaveBeenCalled();
  });
});

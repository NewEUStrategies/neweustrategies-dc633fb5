// Organizm „Boczny panel sekcji sponsorów" - edycja jednej sekcji tablicy
// sponsorów: tytuł PL/EN, układ (siatka / baner), logotypy z przekierowaniem,
// dodanie firmy z CRM i usunięcie pustej sekcji.
//
// CO TEN PLIK DOWODZI.
//   1. NAGŁÓWEK MÓWI JĘZYKIEM PANELU. Po polsku tytuł sekcji to `name_pl`, po
//      angielsku (także `en-GB`) `name_en`; brak tytułu w bieżącym języku
//      pokazuje drugi, a nie pusty nagłówek. Bez sekcji panel jest zamknięty.
//   2. TYTUŁ ZAWSZE WYCHODZI W OBU JĘZYKACH. Zapis niesie identyfikator sekcji
//      i wydarzenia, tytuły przycięte, a brakujący język dostaje tytuł z drugiego.
//      Oba pola puste nie idą do bazy wcale. Wynik zapisu kończy się komunikatem.
//      NIEZAPISANY TYTUŁ PRZEŻYWA ODŚWIEŻENIE: nowy obiekt wiersza TEJ SAMEJ
//      sekcji (lista sekcji odświeża się po zmianie układu, zapisie linku,
//      usunięciu logotypu) nie nadpisuje wpisanego tekstu; dopiero INNA sekcja
//      wczytuje swoje tytuły.
//   3. UKŁAD PRZEŁĄCZA SIĘ OSOBNĄ OPERACJĄ z identyfikatorem sekcji; bieżący
//      układ jest wciśnięty, a w trakcie zmiany oba przyciski są zgaszone.
//      Sekcja z więcej niż jednym logotypem ma zgaszony baner z wyjaśnieniem
//      (baza i tak odmówi `banner_single_image`), a odmowa bazy mówi zdaniem
//      z mapy odmów sponsorów, nie ogólnym „nie udało się".
//   4. KAŻDY LOGOTYP MA SWOJE OPERACJE. Edycja i usunięcie dostają identyfikator
//      TEJ firmy; logo z magazynu idzie przez adres markowy, a firma bez logo
//      pokazuje nazwę zamiast pustego obrazka.
//   5. PRZEKIEROWANIE TRAFIA DO WŁAŚCIWEJ FIRMY. Zapis z pola logotypu niesie jej
//      identyfikator; firma bez wpisu w mapie linków startuje od szczegółów
//      wystawcy. Odmowa bazy (`invalid_link_url`) daje komunikat i NIE kasuje
//      wpisanego adresu; zwykły przerender panelu (np. pisanie tytułu) też nie.
//   6. BANER MA JEDEN OBRAZ. Przy układzie baneru z logotypem dodanie kolejnej
//      firmy jest zgaszone i panel mówi dlaczego; siatka i pusty baner przyjmują.
//   8. OGŁOSZENIE TO PRZEŁĄCZNIK PRZY LOGO. Firma dodana z tablicy jest
//      nieogłoszona (plakietka przy nazwie), a przełącznik woła
//      `admin_event_sponsors_set_published` dla TEJ JEDNEJ firmy - z identyfikatorem
//      i nowym stanem. Wynik to zdanie o skutku (ogłoszony / wycofany), odmowa
//      bazy idzie przez mapę odmów sponsorów, a w trakcie zapisu przełącznik
//      jest zgaszony.
//   7. USUNIĘCIE SEKCJI TYLKO PUSTEJ I TYLKO PO POTWIERDZENIU. Z firmami przycisk
//      jest zgaszony z wyjaśnieniem; pusta sekcja pyta (okno niszczące), odmowa
//      niczego nie usuwa, a udane usunięcie zamyka panel. Okno potwierdzenia
//      mówi, CO się stanie (sekcja zniknie z panelu i ze strony, bez cofnięcia),
//      a nie powtarza podpowiedzi o firmach - do okna dochodzi się tylko
//      z pustej sekcji, więc tamto zdanie było w nim nieprawdą.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Reguł pola przekierowania (granice adresu,
// „zapis tylko zmiany") - to `molecules/__tests__/SponsorRedirectField.test.tsx`;
// tutaj molekuła jest PRAWDZIWA, bo dowodem jest to, z czym panel woła zapis.
// Tak samo formularz tytułu (`SponsorSectionTitleForm.test.tsx`) - prawdziwy,
// bo o jego ponownym montowaniu decyduje `key` nadany przez panel.
// Słownika odmów bazy - to `lib/events/__tests__/adminSponsorErrors.test.ts`;
// tutaj mapa jest atrapą oddającą `odmowa:<komunikat>`, żeby było widać, że
// odmowa przeszła przez nią, a nie przez ogólny komunikat.
// Tablicy sekcji i karty sekcji (`SponsorSectionsBoard`, `SponsorSectionCard`) -
// osobne pliki. Zapytań do bazy - hooki są atrapą, liczy się to, z czym panel je
// woła. `brandedMediaUrl` zostaje prawdziwe.
//
// Radix Select nie otwiera listy pod happy-dom - wspólna atrapa natywnego
// `<select>` z `@/test/reactStubs`. Radix Sheet (Dialog) działa bez atrapy.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";

import type { SponsorLogo } from "@/components/admin/events/molecules/SponsorSectionCard";
import type { ConfirmDialogRequest } from "@/lib/appDialogs";
import type { SponsorLink } from "@/lib/events/sponsorBoardApi";
import type { EventSponsorTierRow } from "@/lib/events/sponsorsApi";

type Wynik = { onSuccess?: () => void; onError?: (error: unknown) => void };
type Mutacja =
  "saveTier" | "deleteTier" | "setLayout" | "setLink" | "deleteSponsor" | "setPublished";
type AtrapaMutacji = { mutate: (input: unknown, wynik?: Wynik) => void; isPending: boolean };

const h = vi.hoisted(() => {
  const stan = {
    lang: "pl" as string,
    eventIds: new Set<string>(),
    calls: {} as Record<string, unknown[]>,
    errors: {} as Record<string, Error | null>,
    pending: {} as Record<string, boolean>,
    confirmAnswer: true,
    confirmCalls: [] as Array<Omit<ConfirmDialogRequest, "kind">>,
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    openChanges: [] as boolean[],
    added: [] as string[],
    edited: [] as string[],
    /** Atrapa hooka mutacji: zapisuje ładunek i odpala `onSuccess`/`onError` wg `errors`. */
    mutacja: (nazwa: string, eventId: string): AtrapaMutacji => {
      stan.eventIds.add(eventId);
      return {
        mutate: (input, wynik) => {
          (stan.calls[nazwa] ??= []).push(input);
          const blad = stan.errors[nazwa] ?? null;
          if (blad === null) wynik?.onSuccess?.();
          else wynik?.onError?.(blad);
        },
        isPending: stan.pending[nazwa] === true,
      };
    },
  };
  return stan;
});

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/appDialogs", () => ({
  confirmDialog: (opts: Omit<ConfirmDialogRequest, "kind">) => {
    h.confirmCalls.push(opts);
    return Promise.resolve(h.confirmAnswer);
  },
}));
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock("@/lib/events/adminSponsorErrors", () => ({
  adminSponsorErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

vi.mock("@/lib/events/sponsorBoardApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/events/sponsorBoardApi")>();
  return {
    ...actual,
    useSetTierLayout: (eventId: string) => h.mutacja("setLayout", eventId),
    useSetSponsorLink: (eventId: string) => h.mutacja("setLink", eventId),
  };
});
vi.mock("@/lib/events/useEventSponsors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/events/useEventSponsors")>();
  return {
    ...actual,
    useSaveSponsorTier: (eventId: string) => h.mutacja("saveTier", eventId),
    useDeleteSponsorTier: (eventId: string) => h.mutacja("deleteTier", eventId),
    useDeleteSponsor: (eventId: string) => h.mutacja("deleteSponsor", eventId),
    useSetSponsorsPublished: (eventId: string) => h.mutacja("setPublished", eventId),
  };
});

import { SponsorSectionDrawer } from "@/components/admin/events/organisms/SponsorSectionDrawer";
import { sponsorBoardEn, sponsorBoardPl } from "@/lib/i18n-admin-event-sponsor-board";

type Props = ComponentProps<typeof SponsorSectionDrawer>;

const B = "sponsorBoard";
const LOGO_Z_MAGAZYNU =
  "https://project.supabase.co/storage/v1/object/public/media/sponsors/acme.png";

function sekcja(patch: Partial<EventSponsorTierRow> = {}): EventSponsorTierRow {
  return {
    accent_color: "",
    benefits: [],
    created_at: "",
    description_en: "",
    description_pl: "",
    event_id: "ev1",
    id: "t1",
    is_active: true,
    key: "gold",
    logo_size: "md",
    max_companies: 0,
    name_en: "Gold partners",
    name_pl: "Złoci partnerzy",
    published_sponsors_count: 0,
    rank: 1,
    slots_left: 0,
    sort_order: 10,
    sponsors_count: 0,
    updated_at: "",
    ...patch,
  };
}

const ACME: SponsorLogo = {
  id: "s1",
  name: "Acme",
  logoUrl: LOGO_Z_MAGAZYNU,
  isPublished: true,
};
const BEZ_LOGO: SponsorLogo = {
  id: "s2",
  name: "Bez Logo sp. z o.o.",
  logoUrl: "",
  isPublished: true,
};
/** Firma dopiero co dodana z tablicy - nieogłoszona. */
const NOWA: SponsorLogo = {
  id: "s3",
  name: "Nowa Firma",
  logoUrl: LOGO_Z_MAGAZYNU,
  isPublished: false,
};

function szuflada(patch: Partial<Props> = {}) {
  const props = (p: Partial<Props>): Props => ({
    eventId: "ev1",
    tier: sekcja(),
    layout: "grid",
    logos: [],
    links: new Map<string, SponsorLink>(),
    onOpenChange: (open) => {
      h.openChanges.push(open);
    },
    onAddSponsor: (tierId) => {
      h.added.push(tierId);
    },
    onEditSponsor: (sponsorId) => {
      h.edited.push(sponsorId);
    },
    ...p,
  });
  const widok = render(<SponsorSectionDrawer {...props(patch)} />);
  return {
    przerysuj: (next: Partial<Props>) =>
      widok.rerender(<SponsorSectionDrawer {...props({ ...patch, ...next })} />),
  };
}

const panel = (): HTMLElement => screen.getByRole("dialog");

function kliknij(element: HTMLElement): void {
  act(() => {
    fireEvent.click(element);
  });
}

function przycisk(nazwa: string, w: HTMLElement = panel()): HTMLButtonElement {
  const el = within(w).getByRole("button", { name: nazwa });
  if (!(el instanceof HTMLButtonElement)) throw new Error(`„${nazwa}” nie jest przyciskiem`);
  return el;
}

function pole(etykieta: string, w: HTMLElement = panel()): HTMLInputElement | HTMLSelectElement {
  const el = within(w).getByLabelText(etykieta);
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) return el;
  throw new Error(`„${etykieta}” nie jest polem formularza`);
}

function wpisz(etykieta: string, wartosc: string, w: HTMLElement = panel()): void {
  fireEvent.change(pole(etykieta, w), { target: { value: wartosc } });
}

const logotyp = (nazwa: string): HTMLElement => {
  const wiersz = within(panel())
    .getAllByRole("listitem")
    .find((li) => within(li).queryAllByText(nazwa).length > 0);
  if (wiersz === undefined) throw new Error(`brak logotypu „${nazwa}” w panelu`);
  return wiersz;
};

const wywolania = (nazwa: Mutacja): unknown[] => h.calls[nazwa] ?? [];

async function usunSekcje(): Promise<void> {
  await act(async () => {
    fireEvent.click(przycisk(`${B}.drawer.deleteSection`));
  });
}

beforeEach(() => {
  h.lang = "pl";
  h.eventIds.clear();
  h.calls = {};
  h.errors = {};
  h.pending = {};
  h.confirmAnswer = true;
  h.confirmCalls = [];
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  h.openChanges = [];
  h.added = [];
  h.edited = [];
});

describe("otwarcie i nagłówek", () => {
  it("bez sekcji panel jest zamknięty", () => {
    szuflada({ tier: null });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each<[string, Partial<EventSponsorTierRow>, string]>([
    ["pl", {}, "Złoci partnerzy"],
    ["pl", { name_pl: "" }, "Gold partners"],
    ["en", {}, "Gold partners"],
    ["en-GB", {}, "Gold partners"],
    ["en", { name_en: "" }, "Złoci partnerzy"],
  ])("w języku %s (%o) nagłówek to „%s”", (lang, patch, tytul) => {
    h.lang = lang;
    szuflada({ tier: sekcja(patch) });
    expect(within(panel()).getByRole("heading", { name: tytul })).toBeTruthy();
  });

  it.each(["grid", "banner"] as const)("podtytuł nazywa układ sekcji (%s)", (layout) => {
    szuflada({ layout });
    expect(within(panel()).getByText(`${B}.sponsors.${layout}`, { selector: "p" })).toBeTruthy();
  });

  it("pola tytułu startują od tytułów sekcji, z limitem 120 znaków", () => {
    szuflada();
    expect(pole(`${B}.add.titlePl`).value).toBe("Złoci partnerzy");
    expect(pole(`${B}.add.titleEn`).value).toBe("Gold partners");
    expect(pole(`${B}.add.titlePl`).getAttribute("maxlength")).toBe("120");
    expect(pole(`${B}.add.titleEn`).getAttribute("maxlength")).toBe("120");
  });

  // REGRESJA: panel przepisywał pola efektem zależnym od OBIEKTU wiersza, a lista
  // sekcji oddaje nowy obiekt po każdym odświeżeniu - wpisany tytuł znikał.
  it("odświeżony wiersz TEJ SAMEJ sekcji nie kasuje niezapisanego tytułu, inna sekcja wczytuje swoje", () => {
    const widok = szuflada();
    wpisz(`${B}.add.titlePl`, "Roboczy tytuł");
    wpisz(`${B}.add.titleEn`, "Draft title");
    // Odświeżenie po np. zmianie układu: ten sam identyfikator, nowy obiekt,
    // inne pola pochodne (limit, licznik) - i te same zapisane tytuły.
    widok.przerysuj({ tier: sekcja({ max_companies: 1, sponsors_count: 1, updated_at: "x" }) });
    expect(pole(`${B}.add.titlePl`).value).toBe("Roboczy tytuł");
    expect(pole(`${B}.add.titleEn`).value).toBe("Draft title");
    widok.przerysuj({ tier: sekcja({ id: "t2", name_pl: "Srebrni", name_en: "Silver" }) });
    expect(pole(`${B}.add.titlePl`).value).toBe("Srebrni");
    expect(pole(`${B}.add.titleEn`).value).toBe("Silver");
  });

  it("ponowne otwarcie tej samej sekcji po zamknięciu panelu wczytuje jej zapisane tytuły", () => {
    const widok = szuflada();
    wpisz(`${B}.add.titlePl`, "Porzucony tytuł");
    widok.przerysuj({ tier: null });
    widok.przerysuj({ tier: sekcja() });
    expect(pole(`${B}.add.titlePl`).value).toBe("Złoci partnerzy");
  });

  it("otwarcie panelu nad sekcją wczytuje jej tytuły, a przejście do innej sekcji - tytuły tamtej", () => {
    const widok = szuflada({ tier: null });
    widok.przerysuj({ tier: sekcja() });
    expect(pole(`${B}.add.titlePl`).value).toBe("Złoci partnerzy");
    wpisz(`${B}.add.titlePl`, "Roboczy tytuł");
    widok.przerysuj({ tier: sekcja({ id: "t2", name_pl: "Srebrni", name_en: "Silver" }) });
    expect(pole(`${B}.add.titlePl`).value).toBe("Srebrni");
    expect(pole(`${B}.add.titleEn`).value).toBe("Silver");
  });

  it("wszystkie operacje panelu dotyczą wydarzenia z parametru", () => {
    szuflada({ eventId: "ev9" });
    expect([...h.eventIds]).toEqual(["ev9"]);
  });

  it("Escape prosi rodzica o zamknięcie panelu", () => {
    szuflada();
    fireEvent.keyDown(panel(), { key: "Escape" });
    expect(h.openChanges).toEqual([false]);
  });
});

describe("tytuł sekcji", () => {
  it("zapis niesie sekcję, wydarzenie i oba tytuły przycięte, a potem potwierdza", () => {
    szuflada();
    wpisz(`${B}.add.titlePl`, "  Partnerzy główni ");
    wpisz(`${B}.add.titleEn`, " Main partners ");
    kliknij(przycisk(`${B}.drawer.save`));
    expect(wywolania("saveTier")).toEqual([
      { id: "t1", eventId: "ev1", namePl: "Partnerzy główni", nameEn: "Main partners" },
    ]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${B}.toasts.sectionSaved`);
  });

  it("tytuł tylko po polsku idzie także jako angielski", () => {
    szuflada();
    wpisz(`${B}.add.titleEn`, "  ");
    kliknij(przycisk(`${B}.drawer.save`));
    expect(wywolania("saveTier")).toEqual([
      { id: "t1", eventId: "ev1", namePl: "Złoci partnerzy", nameEn: "Złoci partnerzy" },
    ]);
  });

  it("tytuł tylko po angielsku idzie także jako polski", () => {
    szuflada();
    wpisz(`${B}.add.titlePl`, "");
    kliknij(przycisk(`${B}.drawer.save`));
    expect(wywolania("saveTier")).toEqual([
      { id: "t1", eventId: "ev1", namePl: "Gold partners", nameEn: "Gold partners" },
    ]);
  });

  it("oba tytuły puste nie idą do bazy", () => {
    szuflada();
    wpisz(`${B}.add.titlePl`, " ");
    wpisz(`${B}.add.titleEn`, "");
    kliknij(przycisk(`${B}.drawer.save`));
    expect(wywolania("saveTier")).toEqual([]);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("odmowa zapisu kończy się komunikatem błędu, a pola zostają", () => {
    h.errors.saveTier = new Error("forbidden");
    szuflada();
    wpisz(`${B}.add.titlePl`, "Nowy tytuł");
    kliknij(przycisk(`${B}.drawer.save`));
    expect(h.toastError).toHaveBeenCalledWith(`${B}.toasts.error`);
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(pole(`${B}.add.titlePl`).value).toBe("Nowy tytuł");
  });

  it("w trakcie zapisu przycisk tytułu jest zgaszony", () => {
    h.pending.saveTier = true;
    szuflada();
    expect(przycisk(`${B}.drawer.save`).disabled).toBe(true);
  });
});

describe("układ sekcji", () => {
  it.each(["grid", "banner"] as const)("bieżący układ (%s) jest wciśnięty", (layout) => {
    szuflada({ layout });
    const inny = layout === "grid" ? "banner" : "grid";
    expect(przycisk(`${B}.sponsors.${layout}`).getAttribute("aria-pressed")).toBe("true");
    expect(przycisk(`${B}.sponsors.${inny}`).getAttribute("aria-pressed")).toBe("false");
  });

  it("wybór układu wysyła go z identyfikatorem sekcji i nie zapisuje tytułu", () => {
    szuflada();
    kliknij(przycisk(`${B}.sponsors.banner`));
    kliknij(przycisk(`${B}.sponsors.grid`));
    expect(wywolania("setLayout")).toEqual([
      { id: "t1", layout: "banner" },
      { id: "t1", layout: "grid" },
    ]);
    expect(wywolania("saveTier")).toEqual([]);
  });

  // ZMIANA: ta asercja oczekiwała ogólnego `toasts.error` dla `banner_single_image`,
  // a przy dwóch logotypach. Dwa logotypy gaszą dziś baner zawczasu (niżej), więc
  // odmowa bazy przychodzi tylko przy wyścigu (ktoś dopiął firmę w międzyczasie)
  // i MA mówić, dlaczego - przez mapę odmów sponsorów, nie ogólnym zdaniem.
  it.each(["banner_single_image", "invalid_layout"])(
    "odmowa zmiany układu (%s) mówi zdaniem z mapy odmów, nie ogólnym błędem",
    (kod) => {
      h.errors.setLayout = new Error(kod);
      szuflada({ logos: [ACME] });
      kliknij(przycisk(`${B}.sponsors.banner`));
      expect(h.toastError).toHaveBeenCalledWith(`odmowa:${kod}`);
      expect(h.toastError).not.toHaveBeenCalledWith(`${B}.toasts.error`);
    },
  );

  it("sekcja z więcej niż jednym logotypem ma zgaszony baner i mówi dlaczego", () => {
    szuflada({ logos: [ACME, BEZ_LOGO] });
    const baner = przycisk(`${B}.sponsors.banner`);
    expect(baner.disabled).toBe(true);
    expect(przycisk(`${B}.sponsors.grid`).disabled).toBe(false);
    const wyjasnienie = within(panel()).getByText(`${B}.drawer.bannerBlocked`);
    expect(baner.getAttribute("aria-describedby")).toBe(wyjasnienie.id);
    kliknij(baner);
    expect(wywolania("setLayout")).toEqual([]);
  });

  it.each<[string, SponsorLogo[]]>([
    ["bez logotypów", []],
    ["z jednym logotypem", [ACME]],
  ])("sekcja %s może przejść na baner i nie widzi wyjaśnienia blokady", (_nazwa, logos) => {
    szuflada({ logos });
    const baner = przycisk(`${B}.sponsors.banner`);
    expect(baner.disabled).toBe(false);
    expect(baner.hasAttribute("aria-describedby")).toBe(false);
    expect(within(panel()).queryByText(`${B}.drawer.bannerBlocked`)).toBeNull();
  });

  it("w trakcie zmiany układu oba przyciski są zgaszone", () => {
    h.pending.setLayout = true;
    szuflada();
    expect(przycisk(`${B}.sponsors.grid`).disabled).toBe(true);
    expect(przycisk(`${B}.sponsors.banner`).disabled).toBe(true);
  });
});

describe("logotypy", () => {
  it("logo z magazynu idzie przez adres markowy i ma nazwę firmy jako opis", () => {
    szuflada({ logos: [ACME] });
    const obraz = within(logotyp("Acme")).getByRole("img", { name: "Acme" });
    expect(obraz.getAttribute("src")).toBe(
      "https://neweuropeanstrategies.com/media/sponsors/acme.png",
    );
  });

  it("firma bez logo pokazuje nazwę zamiast pustego obrazka", () => {
    szuflada({ logos: [BEZ_LOGO] });
    const wiersz = logotyp(BEZ_LOGO.name);
    expect(within(wiersz).queryByRole("img")).toBeNull();
    expect(within(wiersz).getAllByText(BEZ_LOGO.name)).toHaveLength(2);
  });

  it("edycja i usunięcie dostają identyfikator TEJ firmy", () => {
    szuflada({ logos: [ACME, BEZ_LOGO] });
    kliknij(przycisk(`${B}.drawer.editLogo`, logotyp(BEZ_LOGO.name)));
    kliknij(przycisk(`${B}.drawer.deleteLogo`, logotyp("Acme")));
    expect(h.edited).toEqual(["s2"]);
    expect(wywolania("deleteSponsor")).toEqual(["s1"]);
  });

  it("odmowa usunięcia logotypu kończy się komunikatem błędu", () => {
    h.errors.deleteSponsor = new Error("forbidden");
    szuflada({ logos: [ACME] });
    kliknij(przycisk(`${B}.drawer.deleteLogo`, logotyp("Acme")));
    expect(h.toastError).toHaveBeenCalledWith(`${B}.toasts.error`);
  });
});

describe("ogłoszenie logotypu", () => {
  const przelacznik = (nazwa: string): HTMLElement =>
    within(logotyp(nazwa)).getByRole("switch", { name: `${B}.drawer.published` });

  it("przełącznik pokazuje stan TEJ firmy, a nieogłoszona ma plakietkę przy nazwie", () => {
    szuflada({ logos: [ACME, NOWA] });
    expect(przelacznik("Acme").getAttribute("aria-checked")).toBe("true");
    expect(przelacznik("Nowa Firma").getAttribute("aria-checked")).toBe("false");
    expect(within(logotyp("Nowa Firma")).getByText(`${B}.sponsors.draftBadge`)).toBeTruthy();
    expect(within(logotyp("Acme")).queryByText(`${B}.sponsors.draftBadge`)).toBeNull();
  });

  it("ogłoszenie wysyła identyfikator TEJ firmy i nowy stan, a potem mówi o skutku", () => {
    szuflada({ logos: [ACME, NOWA] });
    kliknij(przelacznik("Nowa Firma"));
    expect(wywolania("setPublished")).toEqual([{ ids: ["s3"], isPublished: true }]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${B}.toasts.announced`);
  });

  it("wycofanie ogłoszonej firmy wysyła `false` i mówi, że zniknęła ze strony", () => {
    szuflada({ logos: [ACME] });
    kliknij(przelacznik("Acme"));
    expect(wywolania("setPublished")).toEqual([{ ids: ["s1"], isPublished: false }]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${B}.toasts.withdrawn`);
  });

  it("odmowa bazy mówi zdaniem z mapy odmów sponsorów, nie ogólnym błędem", () => {
    h.errors.setPublished = new Error(
      "sponsor_tier_required: 1 sponsor(s) in the selection have no tier",
    );
    szuflada({ logos: [NOWA] });
    kliknij(przelacznik("Nowa Firma"));
    expect(h.toastError).toHaveBeenCalledWith(
      "odmowa:sponsor_tier_required: 1 sponsor(s) in the selection have no tier",
    );
    expect(h.toastError).not.toHaveBeenCalledWith(`${B}.toasts.error`);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("w trakcie zapisu ogłoszenia przełączniki są zgaszone", () => {
    h.pending.setPublished = true;
    szuflada({ logos: [ACME, NOWA] });
    expect(przelacznik("Acme").hasAttribute("disabled")).toBe(true);
    expect(przelacznik("Nowa Firma").hasAttribute("disabled")).toBe(true);
  });

  it("napisy ogłoszenia mają PL i EN, różne od siebie", () => {
    const pl = sponsorBoardPl.sponsorBoard;
    const en = sponsorBoardEn.sponsorBoard;
    for (const [a, b] of [
      [pl.drawer.published, en.drawer.published],
      [pl.toasts.announced, en.toasts.announced],
      [pl.toasts.withdrawn, en.toasts.withdrawn],
      [pl.sponsors.draftBadge, en.sponsors.draftBadge],
    ]) {
      expect(a).not.toBe("");
      expect(b).not.toBe("");
      expect(a).not.toBe(b);
    }
  });
});

describe("przekierowanie logotypu", () => {
  const R = `${B}.redirect`;
  const links = new Map<string, SponsorLink>([
    ["s1", { mode: "external", url: "https://example.org/acme" }],
  ]);

  it("każda firma ma własne pole: zapisany link z mapy, brak wpisu to szczegóły wystawcy", () => {
    szuflada({ logos: [ACME, BEZ_LOGO], links });
    expect(pole(`${R}.label`, logotyp("Acme")).value).toBe("external");
    expect(pole(`${R}.urlLabel`, logotyp("Acme")).value).toBe("https://example.org/acme");
    expect(pole(`${R}.label`, logotyp(BEZ_LOGO.name)).value).toBe("exhibitor");
    expect(within(logotyp(BEZ_LOGO.name)).queryByLabelText(`${R}.urlLabel`)).toBeNull();
  });

  it("zapis przekierowania niesie identyfikator firmy i kończy się potwierdzeniem", () => {
    szuflada({ logos: [ACME, BEZ_LOGO], links });
    const wiersz = logotyp(BEZ_LOGO.name);
    wpisz(`${R}.label`, "none", wiersz);
    kliknij(przycisk(`${R}.save`, wiersz));
    expect(wywolania("setLink")).toEqual([{ id: "s2", mode: "none", url: "" }]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${B}.toasts.linkSaved`);
  });

  it("odmowa bazy (invalid_link_url) daje komunikat i zostawia wpisany adres", () => {
    h.errors.setLink = new Error("invalid_link_url");
    szuflada({ logos: [ACME], links });
    const wiersz = logotyp("Acme");
    wpisz(`${R}.urlLabel`, "https://example.org/nowy", wiersz);
    kliknij(przycisk(`${R}.save`, wiersz));
    expect(wywolania("setLink")).toEqual([
      { id: "s1", mode: "external", url: "https://example.org/nowy" },
    ]);
    expect(h.toastError).toHaveBeenCalledWith(`${B}.toasts.error`);
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(pole(`${R}.urlLabel`, logotyp("Acme")).value).toBe("https://example.org/nowy");
  });

  it("pisanie tytułu sekcji nie kasuje niezapisanego przekierowania firmy bez linku", () => {
    szuflada({ logos: [BEZ_LOGO] });
    wpisz(`${R}.label`, "external", logotyp(BEZ_LOGO.name));
    wpisz(`${R}.urlLabel`, "https://example.org/bez-logo", logotyp(BEZ_LOGO.name));
    wpisz(`${B}.add.titlePl`, "Inny tytuł");
    expect(pole(`${R}.label`, logotyp(BEZ_LOGO.name)).value).toBe("external");
    expect(pole(`${R}.urlLabel`, logotyp(BEZ_LOGO.name)).value).toBe(
      "https://example.org/bez-logo",
    );
  });

  it("w trakcie zapisu przekierowania jego przycisk jest zgaszony", () => {
    h.pending.setLink = true;
    szuflada({ logos: [BEZ_LOGO] });
    const wiersz = logotyp(BEZ_LOGO.name);
    wpisz(`${R}.label`, "none", wiersz);
    expect(przycisk(`${R}.save`, wiersz).disabled).toBe(true);
  });
});

describe("dodawanie sponsora", () => {
  it.each<[string, Partial<Props>]>([
    ["siatka z logotypami", { layout: "grid", logos: [ACME, BEZ_LOGO] }],
    ["pusty baner", { layout: "banner", logos: [] }],
  ])("%s przyjmuje kolejną firmę do tej sekcji", (_nazwa, patch) => {
    szuflada(patch);
    kliknij(przycisk(`${B}.drawer.addSponsor`));
    expect(h.added).toEqual(["t1"]);
    expect(within(panel()).queryByText(`${B}.drawer.bannerFull`)).toBeNull();
  });

  it("baner z logotypem nie przyjmuje drugiej firmy i mówi dlaczego", () => {
    szuflada({ layout: "banner", logos: [ACME] });
    expect(przycisk(`${B}.drawer.addSponsor`).disabled).toBe(true);
    expect(within(panel()).getByText(`${B}.drawer.bannerFull`)).toBeTruthy();
  });
});

describe("usuwanie sekcji", () => {
  // ZMIANA: podpowiedź pod zgaszonym przyciskiem i treść okna potwierdzenia były
  // TYM SAMYM kluczem (`deleteConfirmBody`). Podpowiedź ma dziś własny klucz
  // `deleteBlocked`; `deleteConfirmBody` mówi, co się stanie po potwierdzeniu.
  it("sekcja z firmami ma zgaszone usuwanie i wyjaśnienie", () => {
    szuflada({ logos: [ACME] });
    expect(przycisk(`${B}.drawer.deleteSection`).disabled).toBe(true);
    expect(within(panel()).getByText(`${B}.drawer.deleteBlocked`)).toBeTruthy();
    expect(within(panel()).queryByText(`${B}.drawer.deleteConfirmBody`)).toBeNull();
  });

  it("pusta sekcja pyta o potwierdzenie w oknie niszczącym", async () => {
    szuflada();
    expect(within(panel()).queryByText(`${B}.drawer.deleteBlocked`)).toBeNull();
    await usunSekcje();
    expect(h.confirmCalls).toEqual([
      {
        title: `${B}.drawer.deleteConfirmTitle`,
        description: `${B}.drawer.deleteConfirmBody`,
        confirmLabel: `${B}.drawer.confirm`,
        cancelLabel: `${B}.drawer.cancel`,
        destructive: true,
      },
    ]);
  });

  it.each([
    ["pl", sponsorBoardPl.sponsorBoard.drawer, /nie można cofnąć/],
    ["en", sponsorBoardEn.sponsorBoard.drawer, /cannot be undone/],
  ] as const)(
    "treść okna potwierdzenia (%s) mówi o skutku, a nie powtarza podpowiedzi o firmach",
    (_lang, slownik, nieodwracalne) => {
      expect(slownik.deleteConfirmBody).not.toBe(slownik.deleteBlocked);
      expect(slownik.deleteConfirmBody).toMatch(nieodwracalne);
    },
  );

  it("odmowa w oknie potwierdzenia niczego nie usuwa", async () => {
    h.confirmAnswer = false;
    szuflada();
    await usunSekcje();
    expect(wywolania("deleteTier")).toEqual([]);
    expect(h.openChanges).toEqual([]);
  });

  it("potwierdzenie usuwa TĘ sekcję, potwierdza komunikatem i zamyka panel", async () => {
    szuflada();
    await usunSekcje();
    expect(wywolania("deleteTier")).toEqual(["t1"]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${B}.toasts.sectionDeleted`);
    expect(h.openChanges).toEqual([false]);
  });

  it("odmowa bazy daje komunikat błędu i panel zostaje otwarty", async () => {
    h.errors.deleteTier = new Error("in use");
    szuflada();
    await usunSekcje();
    expect(h.toastError).toHaveBeenCalledWith(`${B}.toasts.error`);
    expect(h.openChanges).toEqual([]);
  });

  it("w trakcie usuwania przycisk jest zgaszony", () => {
    h.pending.deleteTier = true;
    szuflada();
    expect(przycisk(`${B}.drawer.deleteSection`).disabled).toBe(true);
  });
});

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
//   3. UKŁAD PRZEŁĄCZA SIĘ OSOBNĄ OPERACJĄ z identyfikatorem sekcji; bieżący
//      układ jest wciśnięty, a w trakcie zmiany oba przyciski są zgaszone.
//   4. KAŻDY LOGOTYP MA SWOJE OPERACJE. Edycja i usunięcie dostają identyfikator
//      TEJ firmy; logo z magazynu idzie przez adres markowy, a firma bez logo
//      pokazuje nazwę zamiast pustego obrazka.
//   5. PRZEKIEROWANIE TRAFIA DO WŁAŚCIWEJ FIRMY. Zapis z pola logotypu niesie jej
//      identyfikator; firma bez wpisu w mapie linków startuje od szczegółów
//      wystawcy. Odmowa bazy (`invalid_link_url`) daje komunikat i NIE kasuje
//      wpisanego adresu; zwykły przerender panelu (np. pisanie tytułu) też nie.
//   6. BANER MA JEDEN OBRAZ. Przy układzie baneru z logotypem dodanie kolejnej
//      firmy jest zgaszone i panel mówi dlaczego; siatka i pusty baner przyjmują.
//   7. USUNIĘCIE SEKCJI TYLKO PUSTEJ I TYLKO PO POTWIERDZENIU. Z firmami przycisk
//      jest zgaszony z wyjaśnieniem; pusta sekcja pyta (okno niszczące), odmowa
//      niczego nie usuwa, a udane usunięcie zamyka panel.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Reguł pola przekierowania (granice adresu,
// „zapis tylko zmiany") - to `molecules/__tests__/SponsorRedirectField.test.tsx`;
// tutaj molekuła jest PRAWDZIWA, bo dowodem jest to, z czym panel woła zapis.
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
type Mutacja = "saveTier" | "deleteTier" | "setLayout" | "setLink" | "deleteSponsor";
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
  };
});

import { SponsorSectionDrawer } from "@/components/admin/events/organisms/SponsorSectionDrawer";

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

const ACME: SponsorLogo = { id: "s1", name: "Acme", logoUrl: LOGO_Z_MAGAZYNU };
const BEZ_LOGO: SponsorLogo = { id: "s2", name: "Bez Logo sp. z o.o.", logoUrl: "" };

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

  it("odmowa zmiany układu kończy się komunikatem błędu", () => {
    h.errors.setLayout = new Error("banner_single_image");
    szuflada({ logos: [ACME, BEZ_LOGO] });
    kliknij(przycisk(`${B}.sponsors.banner`));
    expect(h.toastError).toHaveBeenCalledWith(`${B}.toasts.error`);
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
  it("sekcja z firmami ma zgaszone usuwanie i wyjaśnienie", () => {
    szuflada({ logos: [ACME] });
    expect(przycisk(`${B}.drawer.deleteSection`).disabled).toBe(true);
    expect(within(panel()).getByText(`${B}.drawer.deleteConfirmBody`)).toBeTruthy();
  });

  it("pusta sekcja pyta o potwierdzenie w oknie niszczącym", async () => {
    szuflada();
    expect(within(panel()).queryByText(`${B}.drawer.deleteConfirmBody`)).toBeNull();
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

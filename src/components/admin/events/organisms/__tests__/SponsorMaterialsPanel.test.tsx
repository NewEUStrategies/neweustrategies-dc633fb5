// Organizm „MATERIALY FIRMY" - lista plikow i odnosnikow wiszacych na JEDNYM
// przypieciu sponsora.
//
// CO TEN PLIK DOWODZI.
//   1. CZTERY STANY LISTY MAJA CZTERY WIDOKI. „Brak materialow" po nieudanym
//      zapytaniu to nieprawda o stanie bazy: organizator wgrywa paczke
//      logotypow drugi raz, bo pierwszej nie widzi.
//   2. LISTA CZYTA SIE ZE SZCZEGOLU PRZYPIECIA, nie osobnym zapytaniem na
//      wiersz - inaczej rozwiniecie dwudziestu sponsorow to dwadziescia zapytan.
//   3. WIDOCZNOSC PUBLICZNA JEST WIDOCZNA W WIERSZU. To jedyne miejsce, z
//      ktorego organizator dowiaduje sie, czy cennik lezy juz na stronie
//      wydarzenia, czy tylko w panelu.
//   4. RODZAJ MATERIALU STOI PRZY TYTULE - paczka logotypow i wideo zachowuja
//      sie inaczej po klinieciu.
//   5. `materials` JEST JSON-em, wiec smieci w kolumnie NIE MOGA wywracac
//      ekranu; wiersze bez ksztaltu sa pomijane.
//   6. KASOWANIE JEST ZA POTWIERDZENIEM i idzie z identyfikatorem TEGO wiersza.
//   7. ODMOWA ZAPISU NIE ZAMYKA FORMULARZA.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) FORMULARZA materialu - ma wlasny plik
// `SponsorMaterialDialog.test.tsx`; tutaj jest atrapa. (2) Slownika odmow bazy.
// (3) Parytetu rodzajow materialu z CHECK-iem bazy.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { MouseEventHandler, ReactNode } from "react";
import { axeViolations, summarize } from "@/test/axe";
import type { SponsorMaterialInput } from "@/lib/events/sponsorsApi";

/** Ksztalt drugiego argumentu `mutate` - tylko to, co organizm przekazuje. */
interface Wynik<T> {
  onSuccess?: (value: T) => void;
  onError?: (error: unknown) => void;
}

const h = vi.hoisted(() => ({
  lang: "pl",
  szczegol: undefined as unknown,
  isLoading: false,
  listError: null as unknown,
  pytaneOSzczegol: [] as string[],
  zapisy: [] as unknown[],
  zapisBlad: null as unknown,
  zapisPending: false,
  kasowania: [] as string[],
  kasowanieBlad: null as unknown,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

vi.mock("@/lib/events/adminSponsorErrors", () => ({
  adminSponsorErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

vi.mock("@/components/ui/alert-dialog", () => {
  const stan: { open: boolean; onOpenChange?: (open: boolean) => void } = { open: false };
  return {
    AlertDialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange?: (open: boolean) => void;
      children?: ReactNode;
    }) => {
      stan.open = open;
      stan.onOpenChange = onOpenChange;
      return <div>{children}</div>;
    },
    AlertDialogContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? (
        <div role="alertdialog" aria-label="potwierdzenie">
          {children}
        </div>
      ) : null,
    AlertDialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    AlertDialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    AlertDialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
    AlertDialogCancel: ({ children }: { children?: ReactNode }) => (
      <button type="button" onClick={() => stan.onOpenChange?.(false)}>
        {children}
      </button>
    ),
    AlertDialogAction: ({
      children,
      onClick,
    }: {
      children?: ReactNode;
      onClick?: MouseEventHandler<HTMLButtonElement>;
    }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
  };
});

vi.mock("@/components/admin/events/molecules/SponsorMaterialDialog", () => ({
  SponsorMaterialDialog: ({
    open,
    onOpenChange,
    sponsorId,
    material,
    nextSortOrder,
    isSaving,
    onSubmit,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    sponsorId: string;
    material: Record<string, unknown> | null;
    nextSortOrder: number;
    isSaving: boolean;
    onSubmit: (input: SponsorMaterialInput) => void;
  }) =>
    !open ? null : (
      <div
        role="dialog"
        aria-label="formularz-materialu"
        data-material={material === null ? "nowy" : String(material.id)}
        data-kolejnosc={String(nextSortOrder)}
        data-zapis={String(isSaving)}
      >
        <button
          type="button"
          data-testid="formularz-zapisz"
          onClick={() =>
            onSubmit({
              id: material === null ? undefined : String(material.id),
              sponsorId: material === null ? sponsorId : undefined,
              titlePl: "Paczka logotypow",
              titleEn: "Logo pack",
              url: "https://alfa.example.com/logo.zip",
            })
          }
        />
        <button type="button" data-testid="formularz-zamknij" onClick={() => onOpenChange(false)} />
      </div>
    ),
}));

vi.mock("@/lib/events/useEventSponsors", () => ({
  useSponsorDetail: (sponsorId: string) => {
    h.pytaneOSzczegol.push(sponsorId);
    return { data: h.szczegol, isLoading: h.isLoading, error: h.listError };
  },
  useSaveSponsorMaterial: () => ({
    mutate: (input: SponsorMaterialInput, wynik?: Wynik<string>) => {
      h.zapisy.push(input);
      if (h.zapisBlad === null) wynik?.onSuccess?.("ok");
      else wynik?.onError?.(h.zapisBlad);
    },
    isPending: h.zapisPending,
  }),
  useDeleteSponsorMaterial: () => ({
    mutate: (id: string, wynik?: Wynik<boolean>) => {
      h.kasowania.push(id);
      if (h.kasowanieBlad === null) wynik?.onSuccess?.(true);
      else wynik?.onError?.(h.kasowanieBlad);
    },
    isPending: false,
  }),
}));

const { SponsorMaterialsPanel } =
  await import("@/components/admin/events/organisms/SponsorMaterialsPanel");

const T = "adminEventSponsors";
const M = "adminEventSponsors.sponsors.materials";
const WYDARZENIE = "11111111-1111-4111-8111-111111111111";
const PRZYPIECIE = "22222222-2222-4222-8222-222222222222";
const MATERIAL = "33333333-3333-4333-8333-333333333333";
const INNY_MATERIAL = "44444444-4444-4444-8444-444444444444";

/**
 * Wiersz materialu tak, jak przychodzi w kolumnie `materials` szczegolu
 * przypiecia: to JSON, wiec panel dostaje LUZNY rekord bez gwarancji ksztaltu.
 * Fixtura celowo trzyma ten sam luzny typ.
 */
function material(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MATERIAL,
    kind: "logo_pack",
    title_pl: "Paczka logotypow",
    title_en: "Logo pack",
    url: "https://alfa.example.com/logo.zip",
    sort_order: 10,
    is_published: true,
    ...overrides,
  };
}

/** Szczegol przypiecia z podanymi materialami. */
function szczegol(materials: unknown): Record<string, unknown> {
  return { id: PRZYPIECIE, event_id: WYDARZENIE, materials };
}

function panel() {
  return render(<SponsorMaterialsPanel eventId={WYDARZENIE} sponsorId={PRZYPIECIE} />);
}

const wiersze = (): HTMLElement[] => screen.queryAllByRole("listitem");

const wiersz = (index = 0): HTMLElement => {
  const found = wiersze()[index];
  if (found === undefined) throw new Error(`brak wiersza nr ${index} na liscie materialow`);
  return found;
};

const przycisk = (nazwa: string): HTMLElement => screen.getByRole("button", { name: nazwa });
const formularz = (): HTMLElement => screen.getByRole("dialog", { name: "formularz-materialu" });
const okno = (): HTMLElement => screen.getByRole("alertdialog");

beforeEach(() => {
  h.lang = "pl";
  h.szczegol = szczegol([material()]);
  h.isLoading = false;
  h.listError = null;
  h.pytaneOSzczegol = [];
  h.zapisy = [];
  h.zapisBlad = null;
  h.zapisPending = false;
  h.kasowania = [];
  h.kasowanieBlad = null;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("cztery stany listy materialow", () => {
  it("zapytanie w locie mowi „wczytywanie” i nie rysuje ani jednego materialu", () => {
    h.isLoading = true;
    h.szczegol = undefined;
    panel();

    expect(screen.getByText(`${M}.loading`)).toBeTruthy();
    expect(wiersze()).toHaveLength(0);
    expect(screen.queryByText(`${M}.empty`)).toBeNull();
  });

  it("awaria pokazuje odmowe bazy i NIE mowi, ze materialow nie ma", () => {
    h.szczegol = undefined;
    h.listError = new Error("not_found: brak przypiecia");
    panel();

    expect(screen.getByText("odmowa:not_found: brak przypiecia")).toBeTruthy();
    expect(screen.queryByText(`${M}.empty`)).toBeNull();
  });

  it("brak materialow to „pusto”, a nie awaria", () => {
    h.szczegol = szczegol([]);
    panel();

    expect(screen.getByText(`${M}.empty`)).toBeTruthy();
  });

  it("brak awarii wyrazony jako `undefined` (nie `null`) tez nie jest awaria", () => {
    h.listError = undefined;
    h.szczegol = szczegol([]);
    panel();

    expect(screen.getByText(`${M}.empty`)).toBeTruthy();
  });

  it("szczegol przypiecia jest pytany o TEN sponsor - lista nie robi zapytania na wiersz", () => {
    panel();

    expect(new Set(h.pytaneOSzczegol)).toEqual(new Set([PRZYPIECIE]));
  });
});

describe("smieci w kolumnie `materials` nie wywracaja ekranu", () => {
  it.each([
    ["brak kolumny", undefined],
    ["`null`", null],
    ["napis zamiast tablicy", "nope"],
    ["liczba", 7],
    ["obiekt zamiast tablicy", { id: MATERIAL }],
  ])("%s konczy sie stanem pustym, nie wyjatkiem", (_opis, wartosc) => {
    h.szczegol = szczegol(wartosc);
    panel();

    expect(screen.getByText(`${M}.empty`)).toBeTruthy();
  });

  it("pozycje bez ksztaltu sa pomijane, a poprawne zostaja", () => {
    h.szczegol = szczegol([null, 7, "nope", material()]);
    panel();

    expect(wiersze()).toHaveLength(1);
    expect(within(wiersz()).getByText("Paczka logotypow")).toBeTruthy();
  });
});

describe("wiersz materialu", () => {
  it("mowi tytul w jezyku interfejsu i pokazuje rodzaj pliku", () => {
    panel();

    expect(within(wiersz()).getByText("Paczka logotypow")).toBeTruthy();
    expect(within(wiersz()).getByText(`${T}.materialKinds.logo_pack`)).toBeTruthy();
  });

  it("po angielsku tytul jest angielski, a przy pustym wraca polski", () => {
    h.lang = "en";
    h.szczegol = szczegol([material(), material({ id: INNY_MATERIAL, title_en: "" })]);
    panel();

    expect(within(wiersz(0)).getByText("Logo pack")).toBeTruthy();
    expect(within(wiersz(1)).getByText("Paczka logotypow")).toBeTruthy();
  });

  it("pusty tytul polski spada na angielski", () => {
    h.szczegol = szczegol([material({ title_pl: "" })]);
    panel();

    expect(within(wiersz()).getByText("Logo pack")).toBeTruthy();
  });

  it("brak rodzaju pokazuje kreske, a nie klucz slownika", () => {
    h.szczegol = szczegol([material({ kind: null })]);
    panel();

    expect(within(wiersz()).getByText("-")).toBeTruthy();
  });

  it("MATERIAL PUBLICZNY jest oznaczony, a wewnetrzny nie - to decyzja o tym, co widzi uczestnik", () => {
    h.szczegol = szczegol([material(), material({ id: INNY_MATERIAL, is_published: false })]);
    panel();

    expect(within(wiersz(0)).getByText(`${T}.filters.published`)).toBeTruthy();
    expect(within(wiersz(1)).queryByText(`${T}.filters.published`)).toBeNull();
  });

  it("flaga publikacji inna niz `true` znaczy WEWNETRZNY - nie zgadujemy z niej publikacji", () => {
    h.szczegol = szczegol([
      material({ is_published: "tak" }),
      material({ id: INNY_MATERIAL, is_published: null }),
    ]);
    panel();

    expect(screen.queryByText(`${T}.filters.published`)).toBeNull();
  });

  it("odnosnik prowadzi pod adres materialu i otwiera sie w nowej karcie BEZ przekazania odsylacza", () => {
    panel();

    const odnosnik = within(wiersz()).getByRole("link");
    expect(odnosnik).toHaveAttribute("href", "https://alfa.example.com/logo.zip");
    expect(odnosnik).toHaveAttribute("target", "_blank");
    expect(odnosnik.getAttribute("rel")).toContain("noopener");
    expect(odnosnik.getAttribute("rel")).toContain("noreferrer");
  });

  // ---------------------------------------------------------------------------
  // DEFEKT: adres materialu siedzi w kolumnie `materials` typu JSON, a panel
  // wstawia go do `href` bez sprawdzenia. Material bez adresu (import, starsza
  // wersja panelu, recznie poprawiony JSON) dostaje `href=""`, czyli kotwice
  // wskazujaca BIEZACA strone: klikniecie przeladowuje panel organizatora.
  // Drugi skutek jest cichszy i gorszy: kotwica z pustym `href` PRZESTAJE byc
  // odnosnikiem dla czytnika ekranu (`a[href]` wymaga wartosci niepustej),
  // wiec `aria-label` nie ma juz czego nazwac - w drzewie dostepnosci zostaje
  // bezimienny element. Pozycja bez adresu nie powinna miec kotwicy w ogole.
  // ---------------------------------------------------------------------------
  it.fails(
    "DEFEKT: material BEZ adresu dostaje kotwice z pustym `href` zamiast wygaszonej ikony",
    () => {
      h.szczegol = szczegol([material({ url: null })]);
      panel();

      expect(within(wiersz()).queryByRole("link")).toBeNull();
      expect(wiersz().querySelector("a")).toBeNull();
    },
  );
});

describe("formularz materialu - styk z panelem", () => {
  it("„Dodaj material” otwiera PUSTY formularz z podpowiedziana kolejnoscia", () => {
    h.szczegol = szczegol([
      material({ sort_order: 10 }),
      material({ id: INNY_MATERIAL, sort_order: 40 }),
    ]);
    panel();
    fireEvent.click(przycisk(`${M}.addAction`));

    expect(formularz()).toHaveAttribute("data-material", "nowy");
    expect(formularz()).toHaveAttribute("data-kolejnosc", "50");
  });

  it("kolejnosc, ktora nie jest liczba, nie psuje podpowiedzi", () => {
    h.szczegol = szczegol([material({ sort_order: "dziesiec" })]);
    panel();
    fireEvent.click(przycisk(`${M}.addAction`));

    expect(formularz()).toHaveAttribute("data-kolejnosc", "10");
  });

  it("olowek otwiera formularz TEGO wiersza", () => {
    h.szczegol = szczegol([material(), material({ id: INNY_MATERIAL })]);
    panel();
    fireEvent.click(within(wiersz(1)).getByRole("button", { name: `${M}.dialog.editTitle` }));

    expect(formularz()).toHaveAttribute("data-material", INNY_MATERIAL);
  });

  it("zapis w toku dojezdza do formularza", () => {
    h.zapisPending = true;
    panel();
    fireEvent.click(przycisk(`${M}.addAction`));

    expect(formularz()).toHaveAttribute("data-zapis", "true");
  });

  it("udany zapis zamyka formularz i mowi o tym", () => {
    panel();
    fireEvent.click(przycisk(`${M}.addAction`));
    fireEvent.click(screen.getByTestId("formularz-zapisz"));

    expect(h.zapisy).toHaveLength(1);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${T}.sponsors.toasts.materialSaved`);
    expect(screen.queryByRole("dialog", { name: "formularz-materialu" })).toBeNull();
  });

  it("ODMOWA ZAPISU NIE ZAMYKA formularza - wpisany adres zostaje na ekranie", () => {
    h.zapisBlad = new Error("invalid_url: zly adres");
    panel();
    fireEvent.click(przycisk(`${M}.addAction`));
    fireEvent.click(screen.getByTestId("formularz-zapisz"));

    expect(h.toastError).toHaveBeenCalledWith("odmowa:invalid_url: zly adres");
    expect(formularz()).toBeTruthy();
  });

  it("zamkniecie formularza przez uzytkownika nie wysyla niczego", () => {
    panel();
    fireEvent.click(przycisk(`${M}.addAction`));
    fireEvent.click(screen.getByTestId("formularz-zamknij"));

    expect(screen.queryByRole("dialog", { name: "formularz-materialu" })).toBeNull();
    expect(h.zapisy).toHaveLength(0);
  });
});

describe("usuniecie materialu", () => {
  it("kosz nie kasuje od razu - najpierw pyta", () => {
    panel();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${M}.deleteConfirm` }));

    expect(okno()).toBeTruthy();
    expect(h.kasowania).toHaveLength(0);
  });

  it("potwierdzenie kasuje TEN wiersz i mowi o tym", () => {
    h.szczegol = szczegol([material(), material({ id: INNY_MATERIAL })]);
    panel();
    fireEvent.click(within(wiersz(1)).getByRole("button", { name: `${M}.deleteConfirm` }));
    fireEvent.click(within(okno()).getByRole("button", { name: `${M}.dialog.saveAction` }));

    expect(h.kasowania).toEqual([INNY_MATERIAL]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${T}.sponsors.toasts.materialDeleted`);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("odmowa bazy przy kasowaniu konczy sie zdaniem i zamyka pytanie", () => {
    h.kasowanieBlad = new Error("not_found: material nie istnieje");
    panel();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${M}.deleteConfirm` }));
    fireEvent.click(within(okno()).getByRole("button", { name: `${M}.dialog.saveAction` }));

    expect(h.toastError).toHaveBeenCalledWith("odmowa:not_found: material nie istnieje");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("rezygnacja z potwierdzenia nie kasuje niczego", () => {
    panel();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${M}.deleteConfirm` }));
    fireEvent.click(within(okno()).getByRole("button", { name: `${M}.dialog.cancelAction` }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(h.kasowania).toHaveLength(0);
  });
});

describe("dostepnosc", () => {
  it("lista materialow nie ma naruszen axe", async () => {
    h.szczegol = szczegol([material(), material({ id: INNY_MATERIAL, is_published: false })]);
    const { container } = panel();

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("stan pusty i stan awarii tez nie maja naruszen axe", async () => {
    h.szczegol = szczegol([]);
    const pusty = panel();
    const bezMaterialow = await axeViolations(pusty.container);
    expect(bezMaterialow, summarize(bezMaterialow)).toEqual([]);
    pusty.unmount();

    h.szczegol = undefined;
    h.listError = new Error("not_found: brak przypiecia");
    const awaria = panel();
    const naruszenia = await axeViolations(awaria.container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("ikony wiersza maja nazwy - inaczej czytnik oglasza trzy bezimienne przyciski", () => {
    panel();

    expect(within(wiersz()).getByRole("link", { name: `${M}.dialog.url` })).toBeTruthy();
    expect(within(wiersz()).getByRole("button", { name: `${M}.dialog.editTitle` })).toBeTruthy();
    expect(within(wiersz()).getByRole("button", { name: `${M}.deleteConfirm` })).toBeTruthy();
  });
});

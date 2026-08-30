// Molekula „NOWA PODSTRONA WYDARZENIA" - okno, w ktorym powstaje strona.
//
// PO CO TEN PLIK ISTNIEJE. To jedyne miejsce w module, ktore ZAKLADA wiersz
// w `pages` - czyli tresc, SEO i adres publiczny. Okno pyta o cztery rzeczy
// (dwa tytuly, ikone, szablon), a kazda z nich psuje sie inaczej:
//
//   1. TYTUL W OBU JEZYKACH JEST WYMAGANY, tak jak w `admin_event_page_create`
//      (`invalid_titles`). Blokada tutaj istnieje po to, zeby powod odmowy stal
//      PRZY POLU, ktore go wywolalo - a nie w toascie nad calym ekranem, gdzie
//      nie widac, ktorego z dwoch tytulow brakuje.
//   2. SLUGU NIE MA W TYM OKNIE - liczy go baza z tytulu. Okno, ktore pytaloby
//      o adres, byloby drugim zrodlem prawdy dla SEO; kolizja adresu wraca
//      z bazy i pokazuje ja panel, a nie to okno.
//   3. IKONA Z SZABLONU JEST PROPOZYCJA, NIE NADPISANIEM. Wpisana recznie
//      wygrywa, bo redaktor wpisal ja pozniej i swiadomie - odwrotna kolejnosc
//      kasowalaby jego wybor przy kazdym klikniecu w kafel szablonu.
//   4. ODMOWA BAZY NIE MOZE CZYSCIC POL. Okno zamyka sie DOPIERO po udanym
//      zapisie (`setCreateOpen(false)` w `onSuccess`), wiec po odmowie
//      redaktor ma zobaczyc swoje tytuly na miejscu i poprawic jedna rzecz -
//      a nie wpisywac wszystko od nowa.
//   5. DRUGIE KLIKNIECIE W CZASIE ZAPISU TO DRUGA STRONA. `admin_event_page_
//      create` nie jest idempotentne: dwa wolania zakladaja dwie strony i dwie
//      pozycje w menu, a redaktor widzi jedna, bo druga przychodzi po
//      odswiezeniu listy.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Zawartosci szablonow (`build()`, listy
// blokow) - `eventPageTemplates.test.ts`. (2) Ladunku RPC i doklejenia
// dokumentu buildera - `eventPagesRpc.test.ts`. (3) Odsylacza „Edytuj tresc"
// po utworzeniu - to zakres panelu.
//
// Radix Dialog jest podmieniony na natywny odpowiednik: pod happy-dom nie ma
// dla niego portalu ani pelnej mechaniki fokusa, a przedmiotem dowodu jest to,
// KTORE wartosci okno oferuje i ktora dojedzie do ladunku.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import { axeViolations, summarize } from "@/test/axe";
import {
  DEFAULT_EVENT_PAGE_TEMPLATE_ID,
  EVENT_PAGE_TEMPLATES,
} from "@/lib/events/eventPageTemplates";
import type { EventPageCreateInput } from "@/lib/events/eventPagesApi";

const h = vi.hoisted(() => ({
  language: "pl",
  /** Ladunki oddane do zapisu przez okno. */
  submitted: [] as EventPageCreateInput[],
  openChanges: [] as boolean[],
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);

vi.mock("@/lib/icons/DynamicIcon", () => ({
  DynamicIcon: ({ name }: { name: string }) => <span data-testid={`ikona-${name}`} />,
}));

// Atrapa zostawia z Radiksa KONTRAKT: przy `open === false` z wnetrza okna nie
// ma w drzewie niczego, a otwarte okno jest OPISANE swoim tytulem.
const TYTUL_OKNA = "okno-nowej-strony-tytul";

vi.mock("@/components/ui/dialog", () => {
  const stan = { open: false };
  return {
    Dialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange?: (open: boolean) => void;
      children?: ReactNode;
    }) => {
      stan.open = open;
      return (
        <div data-open={String(open)}>
          {/* Zamkniecie „z zewnatrz" - klawiszem Esc albo klikiem w tlo. Przycisk
              jest OPISANY, bo asercje dostepnosci ida po CALYM drzewie i element
              atrapy bez nazwy mierzylby wade atrapy, a nie molekuly. */}
          <button
            type="button"
            aria-label="zamknij okno z zewnatrz"
            data-testid="okno-zamknij-z-zewnatrz"
            onClick={() => onOpenChange?.(false)}
          />
          {children}
        </div>
      );
    },
    DialogContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? (
        <div role="dialog" aria-labelledby={TYTUL_OKNA}>
          {children}
        </div>
      ) : null,
    DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2 id={TYTUL_OKNA}>{children}</h2>,
    DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  };
});

const { EventPageCreateDialog } =
  await import("@/components/admin/events/molecules/EventPageCreateDialog");

const C = "adminEvents.studio.pages.create.";
const EVENT_ID = "3f1a0c8e-0000-4000-8000-000000000042";

function renderuj(props: { open?: boolean; isSaving?: boolean } = {}) {
  return render(
    <EventPageCreateDialog
      open={props.open ?? true}
      onOpenChange={(open) => h.openChanges.push(open)}
      eventId={EVENT_ID}
      isSaving={props.isSaving === true}
      onSubmit={(input) => h.submitted.push(input)}
    />,
  );
}

function pole(key: string): HTMLElement {
  return screen.getByLabelText(`${C}${key}`);
}

function wpisz(key: string, value: string): void {
  fireEvent.change(pole(key), { target: { value } });
}

function utworz(): void {
  fireEvent.click(screen.getByText(`${C}submit`));
}

/** Wypelnia okno tak, zeby zapis przeszedl walidacje. */
function wypelnijPoprawnie(): void {
  wpisz("titlePl", "Materialy prasowe");
  wpisz("titleEn", "Press materials");
}

function ladunek(): EventPageCreateInput {
  if (h.submitted.length !== 1) {
    throw new Error(`test: oczekiwano jednego zapisu, bylo ${h.submitted.length}`);
  }
  return h.submitted[0];
}

/** Kafel szablonu po jego nazwie - tak, jak znajduje go redaktor. */
function szablon(id: string): HTMLElement {
  const template = EVENT_PAGE_TEMPLATES.find((item) => item.id === id);
  if (template === undefined) throw new Error(`test: nie ma szablonu ${id}`);
  return screen.getByRole("radio", { name: new RegExp(template.name.pl) });
}

beforeEach(() => {
  h.language = "pl";
  h.submitted = [];
  h.openChanges = [];
});

describe("okno startuje puste i zamkniete niczego nie zostawia", () => {
  it("pola sa puste, a wybrany jest szablon domyslny", () => {
    renderuj();

    expect((pole("titlePl") as HTMLInputElement).value).toBe("");
    expect((pole("titleEn") as HTMLInputElement).value).toBe("");
    expect((pole("icon") as HTMLInputElement).value).toBe("");
    expect(szablon(DEFAULT_EVENT_PAGE_TEMPLATE_ID).getAttribute("aria-checked")).toBe("true");
  });

  it("zamkniete okno nie ma w drzewie ani jednego pola", () => {
    renderuj({ open: false });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText(`${C}titlePl`)).toBeNull();
  });

  // RESET PRZY OTWARCIU, nie przy zamknieciu: pola wyczyszczone w trakcie
  // animacji zamykania migaja pustka na oczach redaktora.
  it("ponowne otwarcie czysci pola po poprzednim podejsciu", () => {
    const { rerender } = renderuj();
    wpisz("titlePl", "Pierwsze podejscie");

    const props = {
      onOpenChange: (open: boolean) => h.openChanges.push(open),
      eventId: EVENT_ID,
      isSaving: false,
      onSubmit: (input: EventPageCreateInput) => h.submitted.push(input),
    };
    rerender(<EventPageCreateDialog open={false} {...props} />);
    rerender(<EventPageCreateDialog open {...props} />);

    expect((pole("titlePl") as HTMLInputElement).value).toBe("");
  });

  it("„Anuluj” zamyka okno i NIE zakłada strony", () => {
    renderuj();
    wypelnijPoprawnie();
    fireEvent.click(screen.getByText(`${C}cancel`));

    expect(h.openChanges).toEqual([false]);
    expect(h.submitted).toEqual([]);
  });

  // Klawisz Esc i klik w tlo ida ta sama droga, co „Anuluj" - i tak samo NIE
  // zakladaja strony. Okno, ktore zapisuje przy zamknieciu, zakladaloby strone
  // z polowicznie wpisanym tytulem.
  it("zamkniecie z zewnatrz (Esc, tlo) tez niczego nie zaklada", () => {
    renderuj();
    wypelnijPoprawnie();
    fireEvent.click(screen.getByTestId("okno-zamknij-z-zewnatrz"));

    expect(h.openChanges).toEqual([false]);
    expect(h.submitted).toEqual([]);
  });
});

describe("tytul w obu jezykach - warunek, ktory ma baza", () => {
  // KOMUNIKAT STOI PRZY POLU, a nie w toascie: `invalid_titles` z bazy nie
  // mowi, ktorego z dwoch tytulow brakuje.
  it("puste tytuly zatrzymuja zapis i mowia o tym przy polu", () => {
    renderuj();
    utworz();

    expect(screen.getByText("adminEvents.studio.errors.invalidTitles")).toBeTruthy();
    expect(h.submitted).toEqual([]);
  });

  it("sam tytul polski nie wystarcza", () => {
    renderuj();
    wpisz("titlePl", "Materialy prasowe");
    utworz();

    expect(screen.getByText("adminEvents.studio.errors.invalidTitles")).toBeTruthy();
    expect(h.submitted).toEqual([]);
  });

  it("sam tytul angielski tez nie wystarcza", () => {
    renderuj();
    wpisz("titleEn", "Press materials");
    utworz();

    expect(h.submitted).toEqual([]);
  });

  // Tytul z samych spacji jest dla bazy pusty (`btrim(...) = ''`), wiec ma byc
  // pusty takze tutaj - inaczej okno przepuszczaloby strone bez nazwy.
  it("tytul z samych bialych znakow liczy sie jako brak", () => {
    renderuj();
    wpisz("titlePl", "   ");
    wpisz("titleEn", "Press materials");
    utworz();

    expect(screen.getByText("adminEvents.studio.errors.invalidTitles")).toBeTruthy();
    expect(h.submitted).toEqual([]);
  });

  // KOMUNIKAT MILCZY PRZED PIERWSZA PROBA: czerwone pole w pustym oknie wita
  // redaktora bledem, zanim ten cokolwiek zrobil.
  it("komunikat nie stoi w oknie, ktorego jeszcze nie probowano zapisac", () => {
    renderuj();
    expect(screen.queryByText("adminEvents.studio.errors.invalidTitles")).toBeNull();
  });

  it("komplet tytulow jedzie PRZYCIETY, bo slug liczy sie z tytulu", () => {
    renderuj();
    wpisz("titlePl", "  Materialy prasowe  ");
    wpisz("titleEn", "  Press materials  ");
    utworz();

    expect(ladunek().titlePl).toBe("Materialy prasowe");
    expect(ladunek().titleEn).toBe("Press materials");
  });
});

describe("ikona - wzorzec bazy egzekwowany przy polu", () => {
  it("bledna ikona zatrzymuje zapis i mowi o tym komunikatem", () => {
    renderuj();
    wypelnijPoprawnie();
    fireEvent.change(pole("icon"), { target: { value: "gazeta!" } });
    utworz();

    expect(screen.getByText("adminEvents.studio.pages.entry.iconInvalid")).toBeTruthy();
    expect(pole("icon").getAttribute("aria-invalid")).toBe("true");
    expect(h.submitted).toEqual([]);
  });

  it("wpisana nazwa jest przycinana i sprowadzana do malych liter", () => {
    renderuj();
    wypelnijPoprawnie();
    wpisz("icon", "  Newspaper  ");
    utworz();

    expect(ladunek().icon).toBe("newspaper");
  });

  // BRAK WPISANEJ IKONY NIE JEST BLEDEM: pole puste znaczy „wez ikone
  // szablonu". Do bazy nie ma prawa pojsc PUSTY NAPIS - `event_pages_icon_check`
  // go nie przepusci, a pozycja i tak ma sie czym narysowac.
  it("puste pole ikony bierze ikone SZABLONU, a nigdy pustego napisu", () => {
    renderuj();
    wypelnijPoprawnie();
    utworz();

    const domyslny = EVENT_PAGE_TEMPLATES.find(
      (item) => item.id === DEFAULT_EVENT_PAGE_TEMPLATE_ID,
    );
    expect(ladunek().icon).toBe(domyslny?.icon);
    expect(ladunek().icon).not.toBe("");
  });
});

describe("szablon strony", () => {
  it("okno oferuje KOMPLET szablonow, kazdy jako osobna opcja", () => {
    renderuj();

    expect(screen.getAllByRole("radio")).toHaveLength(EVENT_PAGE_TEMPLATES.length);
    expect(screen.getByRole("radiogroup", { name: `${C}template` })).toBeTruthy();
  });

  // LISTA BLOKOW POD KAZDA POZYCJA to jedyne miejsce, w ktorym redaktor przed
  // klikiem widzi SKLAD strony - nazwa szablonu tego nie mowi.
  it("kazdy kafel niesie opis i sklad strony", () => {
    renderuj();
    const wybrany = EVENT_PAGE_TEMPLATES[1];

    expect(screen.getByText(wybrany.description.pl)).toBeTruthy();
    for (const element of wybrany.elements) {
      expect(screen.getAllByText(element.pl).length).toBeGreaterThan(0);
    }
  });

  it("wybrany szablon jedzie do ladunku", () => {
    renderuj();
    wypelnijPoprawnie();
    fireEvent.click(szablon("event-page-agenda"));
    utworz();

    expect(ladunek().templateId).toBe("event-page-agenda");
  });

  it("wybor przestawia zaznaczenie, a poprzedni kafel je traci", () => {
    renderuj();
    fireEvent.click(szablon("event-page-agenda"));

    expect(szablon("event-page-agenda").getAttribute("aria-checked")).toBe("true");
    expect(szablon(DEFAULT_EVENT_PAGE_TEMPLATE_ID).getAttribute("aria-checked")).toBe("false");
  });

  // IKONA Z SZABLONU JEST PROPOZYCJA: podglad pokazuje ja od razu, zeby
  // redaktor widzial, co wjedzie do menu, jesli sam nic nie wpisze.
  it("podglad ikony idzie za szablonem, dopoki pole ikony jest puste", () => {
    renderuj();
    fireEvent.click(szablon("event-page-agenda"));

    expect(screen.getAllByTestId("ikona-calendar-days").length).toBeGreaterThan(0);
    utworz();
  });

  // ...ALE WPISANA RECZNIE WYGRYWA. Odwrotna kolejnosc kasowalaby wybor
  // redaktora przy kazdym klikniecu w kafel.
  it("ikona wpisana recznie wygrywa z ikona szablonu", () => {
    renderuj();
    wypelnijPoprawnie();
    wpisz("icon", "newspaper");
    fireEvent.click(szablon("event-page-agenda"));
    utworz();

    expect(ladunek().icon).toBe("newspaper");
    expect(ladunek().templateId).toBe("event-page-agenda");
  });
});

describe("ladunek i przebieg zapisu", () => {
  it("nowa strona wchodzi DO MENU i niesie identyfikator wydarzenia", () => {
    renderuj();
    wypelnijPoprawnie();
    utworz();

    expect(ladunek()).toEqual({
      eventId: EVENT_ID,
      titlePl: "Materialy prasowe",
      titleEn: "Press materials",
      icon: "file-text",
      inMenu: true,
      templateId: DEFAULT_EVENT_PAGE_TEMPLATE_ID,
    });
  });

  // DRUGIE KLIKNIECIE W CZASIE ZAPISU TO DRUGA STRONA - RPC nie jest
  // idempotentne, wiec oba przyciski gasna na czas zapisu.
  it("trwajacy zapis gasi OBA przyciski i drugie klikniecie nic nie wysyla", () => {
    renderuj({ isSaving: true });
    const utworzPrzycisk = screen.getByText(`${C}submit`).closest("button");
    const anulujPrzycisk = screen.getByText(`${C}cancel`).closest("button");

    expect(utworzPrzycisk?.hasAttribute("disabled")).toBe(true);
    expect(anulujPrzycisk?.hasAttribute("disabled")).toBe(true);

    fireEvent.click(utworzPrzycisk as HTMLElement);
    expect(h.submitted).toEqual([]);
  });

  // ODMOWA BAZY ZOSTAWIA POLA. Okno zamyka panel dopiero po UDANYM zapisie,
  // wiec po odmowie („adres juz zajety", „oba tytuly wymagane") redaktor ma
  // poprawic jedna rzecz, a nie wpisywac wszystko od nowa.
  it("odmowa zapisu ZOSTAWIA wypelnione pola i wybrany szablon", () => {
    const { rerender } = renderuj();
    wypelnijPoprawnie();
    wpisz("icon", "newspaper");
    fireEvent.click(szablon("event-page-agenda"));
    utworz();

    const props = {
      onOpenChange: (open: boolean) => h.openChanges.push(open),
      eventId: EVENT_ID,
      onSubmit: (input: EventPageCreateInput) => h.submitted.push(input),
    };
    // Zapis w toku, a potem odmowa - okno ZOSTAJE otwarte, bo panel zamyka je
    // wylacznie w `onSuccess`.
    rerender(<EventPageCreateDialog open isSaving {...props} />);
    rerender(<EventPageCreateDialog open isSaving={false} {...props} />);

    expect((pole("titlePl") as HTMLInputElement).value).toBe("Materialy prasowe");
    expect((pole("titleEn") as HTMLInputElement).value).toBe("Press materials");
    expect((pole("icon") as HTMLInputElement).value).toBe("newspaper");
    expect(szablon("event-page-agenda").getAttribute("aria-checked")).toBe("true");
  });

  it("poprawiony formularz wysyla sie za drugim razem", () => {
    renderuj();
    utworz();
    expect(h.submitted).toEqual([]);

    wypelnijPoprawnie();
    utworz();
    expect(ladunek().titlePl).toBe("Materialy prasowe");
  });
});

describe("dostepnosc", () => {
  it("okno nowej strony nie ma naruszen axe", async () => {
    const { container } = renderuj();
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("okno z komunikatami bledow tez nie ma naruszen axe", async () => {
    const { container } = renderuj();
    fireEvent.change(pole("icon"), { target: { value: "gazeta!" } });
    utworz();

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});

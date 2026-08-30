// Molekula „ZGODA / REGULAMIN WYDARZENIA" - formularz, ktory decyduje o tym,
// CO uczestnik zaakceptowal i CZY ta akceptacja jest jeszcze aktualna.
//
// DLACZEGO TO NIE JEST ZWYKLY FORMULARZ KATALOGU. Akceptacja zgody jest
// DOWODEM: wiersz `event_term_acceptances` niesie numer wersji, a nie tresc.
// Dlatego kazda poprawka regulaminu ma dwa mozliwe znaczenia i tylko czlowiek
// wie ktore: „poprawilem literowke, dotychczasowe zgody zostaja wazne" albo
// „zmienilem tresc, wszyscy musza zaakceptowac ponownie". Przelacznik wersji
// jest miejscem, w ktorym to rozroznienie zapada.
//
// CO TEN PLIK DOWODZI. Kazda regula jako PARA „moze / nie moze":
//   1. WERSJE PODNOSI SIE TYLKO PRZY EDYCJI. Nowa zgoda startuje z wersja 1,
//      wiec przelacznika NIE MA wcale - a przy edycji jest i startuje
//      WYLACZONY, bo automat przy kazdej poprawce nauczylby redakcje bac sie
//      poprawiania literowek.
//   2. WYMAGANA vs OPCJONALNA to dwa rozne zobowiazania i obie wartosci musza
//      dojechac do bazy JAWNIE.
//   3. MIEJSCE WYSWIETLENIA (`registration` / `access` /
//      `registration_and_access`) rozstrzyga, GDZIE zgoda w ogole zostanie
//      pokazana. Zgubiony wariant to zgoda, ktorej nikt nie zobaczy - czyli
//      brak dowodu tam, gdzie mial byc.
//   4. KLUCZ TECHNICZNY jest zamrozony po zapisie (RPC edycji go nie czyta).
//   5. ODNOSNIK ZEWNETRZNY musi byc `https` - baza ma na to CHECK
//      (`event_terms_external_url_https`).
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Tabeli regul szkicu (`termsGroupsDraft`) -
// ma wlasny plik. (2) Wierszy formularza (`AdminForm*Row`). (3) Parytetu
// zbioru miejsc wyswietlenia z CHECK-iem bazy - `termsGroupsDbEnumParity`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { radixSwitchStub } from "@/test/reactStubs";
import { axeViolations, summarize } from "@/test/axe";
import type { EventTermRow, TermInput } from "@/lib/events/termsGroupsApi";

const h = vi.hoisted(() => ({
  submitted: [] as TermInput[],
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/components/ui/switch", async () => radixSwitchStub(await import("react")));

// Radix Dialog montuje sie w portalu; atrapa zostawia z niego KONTRAKT:
// przy zamknietym oknie nic z jego wnetrza nie jest w drzewie, a otwarte okno
// jest OPISANE swoim tytulem (Radix wiaze `Content` z `Title` przez
// `aria-labelledby`) - bez tego asercja dostepnosci mierzylaby wade atrapy.
const TYTUL_OKNA = "okno-zgody-tytul";

vi.mock("@/components/ui/dialog", () => {
  const stan = { open: false };
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => {
      stan.open = open;
      return <div data-open={String(open)}>{children}</div>;
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

vi.mock("@/components/atoms/FormSelect", () => {
  const FormSelect = ({
    id,
    value,
    options,
    onValueChange,
    disabled,
    "aria-label": ariaLabel,
  }: {
    id?: string;
    value: string;
    options: readonly { value: string; label: ReactNode }[];
    onValueChange: (value: string) => void;
    disabled?: boolean;
    "aria-label"?: string;
  }) => (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {String(option.label)}
        </option>
      ))}
    </select>
  );
  return { FormSelect, default: FormSelect };
});

const { EventTermDialog } = await import("@/components/admin/events/molecules/EventTermDialog");

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const TERM_ID = "22222222-2222-4222-8222-222222222222";
const D = "adminEventTerms.terms.dialog.";

/**
 * Wiersz `admin_event_terms_list`.
 *
 * `external_url` przychodzi z RPC jako `NULL` („zgoda bez odnosnika"), a
 * sygnatura generowana z bazy opisuje kolumne jako `string` - `RETURNS TABLE`
 * nie niesie informacji o nullowalnosci. Rzutowanie jest wierne bazie.
 */
const BRAK_ODNOSNIKA = null as unknown as string;

function termRow(overrides: Partial<EventTermRow> = {}): EventTermRow {
  return {
    acceptances_current: 40,
    acceptances_total: 52,
    body_en: "Consent body.",
    body_pl: "Tresc zgody.",
    created_at: "2026-08-01T09:00:00.000Z",
    display: "registration",
    event_id: EVENT_ID,
    external_url: "https://example.org/regulamin",
    id: TERM_ID,
    is_active: true,
    is_required: true,
    key: "rodo",
    label_en: "Data processing consent",
    label_pl: "Zgoda na przetwarzanie danych",
    sort_order: 10,
    updated_at: "2026-08-02T09:00:00.000Z",
    version: 3,
    withdrawn_count: 1,
    ...overrides,
  };
}

function renderuj(props: { term?: EventTermRow | null; isSaving?: boolean } = {}) {
  return render(
    <EventTermDialog
      open
      onOpenChange={() => undefined}
      eventId={EVENT_ID}
      term={props.term ?? null}
      nextSortOrder={30}
      isSaving={props.isSaving === true}
      onSubmit={(input) => h.submitted.push(input)}
    />,
  );
}

function pole(key: string): HTMLElement {
  return screen.getByLabelText(`${D}${key}`);
}

function wpisz(key: string, value: string): void {
  fireEvent.change(pole(key), { target: { value } });
}

function zapisz(): void {
  fireEvent.click(screen.getByText(`${D}saveAction`));
}

/** Minimum, ktore przechodzi walidacje molekuly przy zakladaniu zgody. */
function wypelnijPoprawnie(): void {
  wpisz("key", "rodo");
  wpisz("labelPl", "Zgoda na przetwarzanie danych");
  wpisz("labelEn", "Data processing consent");
  wpisz("bodyPl", "Tresc zgody.");
}

beforeEach(() => {
  h.submitted = [];
});

describe("wersja zgody - para „edycja moze podniesc / nowa nie ma czego”", () => {
  // NOWA ZGODA STARTUJE Z WERSJA 1. Przelacznik „podnies wersje" w tym trybie
  // nie ma znaczenia (nie ma czego uniewazniac), wiec go NIE MA - inaczej
  // obiecywalby operacje bez skutku.
  it("formularz nowej zgody NIE MA przelacznika wersji", () => {
    renderuj();
    expect(screen.queryByLabelText(`${D}bumpVersion`)).toBeNull();
  });

  it("formularz edycji MA przelacznik wersji", () => {
    renderuj({ term: termRow() });
    expect(screen.getByLabelText(`${D}bumpVersion`)).toBeTruthy();
  });

  // PRZELACZNIK STARTUJE WYLACZONY. Automat przy kazdej poprawce tresci
  // kazalby wszystkim akceptowac zgode ponownie - a wtedy redakcja
  // przestalaby poprawiac literowki.
  it("przelacznik wersji startuje WYLACZONY przy kazdym otwarciu", () => {
    renderuj({ term: termRow({ version: 7 }) });
    expect((screen.getByLabelText(`${D}bumpVersion`) as HTMLInputElement).checked).toBe(false);
  });

  it("edycja bez podniesienia wersji wysyla `bumpVersion: false`", () => {
    renderuj({ term: termRow() });
    zapisz();
    expect(h.submitted[0]?.bumpVersion).toBe(false);
  });

  it("edycja z podniesieniem wersji wysyla `bumpVersion: true`", () => {
    renderuj({ term: termRow() });
    fireEvent.click(screen.getByLabelText(`${D}bumpVersion`));
    zapisz();
    expect(h.submitted[0]?.bumpVersion).toBe(true);
  });

  // NOWA ZGODA W OGOLE NIE NIESIE TEGO KLUCZA. Wyslany przy tworzeniu byl by
  // pytaniem o podniesienie wersji, ktorej jeszcze nie ma.
  it("nowa zgoda nie niesie klucza podniesienia wersji", () => {
    renderuj();
    wypelnijPoprawnie();
    zapisz();
    expect(h.submitted[0]?.bumpVersion).toBeUndefined();
  });
});

describe("klucz techniczny - para „nowa zgoda moze / edycja nie moze”", () => {
  it("nowa zgoda ma klucz EDYTOWALNY", () => {
    renderuj();
    expect((pole("key") as HTMLInputElement).disabled).toBe(false);
  });

  it("zgoda zapisana ma klucz ZABLOKOWANY, ale widoczny", () => {
    renderuj({ term: termRow({ key: "rodo" }) });
    const input = pole("key") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.value).toBe("rodo");
  });

  it("edycja niesie identyfikator i NIE niesie klucza ani wydarzenia", () => {
    renderuj({ term: termRow() });
    zapisz();
    expect(h.submitted[0]?.id).toBe(TERM_ID);
    expect(h.submitted[0]?.key).toBeUndefined();
    expect(h.submitted[0]?.eventId).toBeUndefined();
  });
});

describe("wymagana vs opcjonalna - para na jednym przelaczniku", () => {
  it("zgoda WYMAGANA jedzie jako `true`", () => {
    renderuj({ term: termRow({ is_required: false }) });
    fireEvent.click(screen.getByLabelText(`${D}isRequired`));
    zapisz();
    expect(h.submitted[0]?.isRequired).toBe(true);
  });

  // ZDJECIE OBOWIAZKU MUSI DOJECHAC JAWNIE. Pominiety klucz zostawilby
  // w bazie poprzednia wymagalnosc, wiec „zgoda przestala byc obowiazkowa"
  // nie zdarzyloby sie wcale, choc ekran pokazalby sukces.
  it("zgoda OPCJONALNA jedzie jako `false`, a nie jako brak klucza", () => {
    renderuj({ term: termRow({ is_required: true }) });
    fireEvent.click(screen.getByLabelText(`${D}isRequired`));
    zapisz();
    expect(h.submitted[0]?.isRequired).toBe(false);
  });

  it("nowa zgoda startuje jako opcjonalna", () => {
    renderuj();
    expect((screen.getByLabelText(`${D}isRequired`) as HTMLInputElement).checked).toBe(false);
  });

  // WYLACZENIE ZGODY TO POPRAWNA ALTERNATYWA DLA USUNIECIA (baza odmawia
  // `term_in_use`, gdy sa akceptacje). Znacznik aktywnosci musi jechac w obie
  // strony.
  it("wylaczenie zgody jedzie jako `isActive: false`", () => {
    renderuj({ term: termRow({ is_active: true }) });
    fireEvent.click(screen.getByLabelText(`${D}isActive`));
    zapisz();
    expect(h.submitted[0]?.isActive).toBe(false);
  });
});

describe("miejsce wyswietlenia zgody", () => {
  it("droplista niesie WSZYSTKIE trzy miejsca, ktore baza przyjmuje", () => {
    renderuj();
    const opcje = within(pole("display"))
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(opcje).toEqual([
      "adminEventTerms.displays.registration",
      "adminEventTerms.displays.access",
      "adminEventTerms.displays.registration_and_access",
    ]);
  });

  it("nowa zgoda startuje na zapisie, bo tam pyta sie o zgode najczesciej", () => {
    renderuj();
    expect((pole("display") as HTMLSelectElement).value).toBe("registration");
  });

  it.each(["registration", "access", "registration_and_access"] as const)(
    "wybor `%s` jedzie do ladunku",
    (display) => {
      renderuj();
      wypelnijPoprawnie();
      fireEvent.change(pole("display"), { target: { value: display } });
      zapisz();
      expect(h.submitted[0]?.display).toBe(display);
    },
  );

  // ZGODA POKAZYWANA PRZY WEJSCIU (`access`) TO INNY MOMENT NIZ PRZY ZAPISIE.
  // Wiersz otwarty do edycji musi wrocic z TYM SAMYM miejscem, bo inaczej
  // pierwszy zapis po cichu przenosi zgode w inne miejsce ekranu uczestnika.
  it("edycja otwiera sie z miejscem ZAPISANYM, a nie domyslnym", () => {
    renderuj({ term: termRow({ display: "registration_and_access" }) });
    expect((pole("display") as HTMLSelectElement).value).toBe("registration_and_access");
  });
});

describe("co zatrzymuje zapis PRZED zadaniem", () => {
  it("pusty formularz nie woła warstwy zapisu", () => {
    renderuj();
    zapisz();
    expect(h.submitted).toEqual([]);
  });

  it("klucz niezgodny ze wzorcem bazy zatrzymuje zapis", () => {
    renderuj();
    wpisz("key", "1-rodo");
    wpisz("labelPl", "Zgoda");
    wpisz("labelEn", "Consent");
    zapisz();
    expect(h.submitted).toEqual([]);
    expect(screen.getByText("adminEventTerms.validation.invalidKey")).toBeTruthy();
  });

  it("brak etykiety w jednym z jezykow zatrzymuje zapis", () => {
    renderuj();
    wpisz("key", "rodo");
    wpisz("labelPl", "Zgoda na przetwarzanie danych");
    zapisz();
    expect(h.submitted).toEqual([]);
    expect(screen.getByText("adminEventTerms.validation.invalidLabels")).toBeTruthy();
  });

  // ODNOSNIK MUSI BYC `https`. Baza ma na to CHECK, a regulamin podany po
  // `http` to dokument, ktory przegladarka moze zablokowac uczestnikowi
  // w chwili, w ktorej ma go zaakceptowac.
  it("odnosnik po `http` zatrzymuje zapis", () => {
    renderuj();
    wypelnijPoprawnie();
    wpisz("externalUrl", "http://example.org/regulamin");
    zapisz();
    expect(h.submitted).toEqual([]);
    expect(screen.getByText("adminEventTerms.validation.invalidUrl")).toBeTruthy();
  });

  it("odnosnik po `https` przechodzi", () => {
    renderuj();
    wypelnijPoprawnie();
    wpisz("externalUrl", "https://example.org/regulamin");
    zapisz();
    expect(h.submitted[0]?.externalUrl).toBe("https://example.org/regulamin");
  });

  it("przed proba zapisu nie ma ani jednego komunikatu bledu", () => {
    renderuj();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // DEFEKT (`it.fails`). Baza ma CHECK `event_terms_has_content`: zgoda bez
  // tresci w zadnym jezyku I BEZ odnosnika jest odrzucana, bo to checkbox pod
  // pustym miejscem - uczestnik akceptowalby cos, czego nie da sie przeczytac.
  // `validateTermDraft` tej reguly NIE ZNA, wiec formularz puszcza taki zapis
  // do bazy. Odmowa wraca jako `new row ... violates check constraint
  // "event_terms_has_content"` - komunikat BEZ glowy w formacie `klucz: tresc`,
  // wiec `adminTermsFailure` degraduje go do `adminEventTerms.errors.unknown`
  // („Nie udalo sie wykonac operacji"). Redaktor nie ma jak zgadnac, ze
  // brakuje tresci. Poprawka nalezy do produkcji: regula w szkicu zgody.
  it.fails("zgoda bez tresci i bez odnosnika nie powinna isc do bazy", () => {
    renderuj();
    wpisz("key", "rodo");
    wpisz("labelPl", "Zgoda na przetwarzanie danych");
    wpisz("labelEn", "Data processing consent");
    zapisz();
    expect(h.submitted).toEqual([]);
  });
});

describe("ksztalt ladunku", () => {
  it("nowa zgoda niesie wydarzenie, przyciety klucz i przyciete etykiety", () => {
    renderuj();
    wpisz("key", "  regulamin  ");
    wpisz("labelPl", "  Regulamin wydarzenia  ");
    wpisz("labelEn", "  Event terms  ");
    wpisz("bodyPl", "Tresc.");
    zapisz();
    expect(h.submitted[0]).toMatchObject({
      eventId: EVENT_ID,
      key: "regulamin",
      labelPl: "Regulamin wydarzenia",
      labelEn: "Event terms",
    });
  });

  // PUSTE POLE ODNOSNIKA TO JAWNE „BEZ ODNOSNIKA". Warstwa danych rozroznia
  // `null` (wyczysc) od braku klucza (zostaw) - molekula musi podac pierwsze.
  it("puste pole odnosnika jedzie jako `null`", () => {
    renderuj();
    wypelnijPoprawnie();
    zapisz();
    expect(h.submitted[0]?.externalUrl).toBeNull();
  });

  it("wiersz bez odnosnika otwiera sie z PUSTYM polem, a nie z napisem", () => {
    renderuj({ term: termRow({ external_url: BRAK_ODNOSNIKA }) });
    expect((pole("externalUrl") as HTMLInputElement).value).toBe("");
  });

  it("kolejnosc jedzie jako liczba, nie jako tekst z pola", () => {
    renderuj();
    wypelnijPoprawnie();
    wpisz("sortOrder", "40");
    zapisz();
    expect(h.submitted[0]?.sortOrder).toBe(40);
  });

  it("tresc w obu jezykach jedzie przycieta", () => {
    renderuj();
    wypelnijPoprawnie();
    wpisz("bodyPl", "  Tresc polska.  ");
    wpisz("bodyEn", "  English body.  ");
    zapisz();
    expect(h.submitted[0]).toMatchObject({ bodyPl: "Tresc polska.", bodyEn: "English body." });
  });
});

describe("naglowek i stan zapisu", () => {
  it("nowa zgoda ma tytul zakladania, a edycja tytul edycji", () => {
    const widok = renderuj();
    expect(screen.getByText(`${D}createTitle`)).toBeTruthy();
    widok.unmount();
    renderuj({ term: termRow() });
    expect(screen.getByText(`${D}editTitle`)).toBeTruthy();
  });

  // TRWAJACY ZAPIS GASI OBA PRZYCISKI: dwa klikniecia to dwie zgody o tym
  // samym kluczu, czyli odmowa unikalnosci przy drugiej z nich.
  it("trwajacy zapis gasi przycisk i drugie klikniecie nic nie wysyla", () => {
    renderuj({ term: termRow(), isSaving: true });
    const przycisk = screen.getByText(`${D}saveAction`).closest("button");
    expect(przycisk?.hasAttribute("disabled")).toBe(true);
    fireEvent.click(przycisk as HTMLElement);
    expect(h.submitted).toEqual([]);
  });

  it("zamkniete okno nie ma w drzewie ani jednego pola", () => {
    render(
      <EventTermDialog
        open={false}
        onOpenChange={() => undefined}
        eventId={EVENT_ID}
        term={null}
        nextSortOrder={30}
        isSaving={false}
        onSubmit={(input) => h.submitted.push(input)}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText(`${D}key`)).toBeNull();
  });
});

describe("dostepnosc", () => {
  it("formularz nowej zgody nie ma naruszen dostepnosci", async () => {
    const { container } = renderuj();
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("formularz edycji z przelacznikiem wersji nie ma naruszen dostepnosci", async () => {
    const { container } = renderuj({ term: termRow() });
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("formularz z komunikatami bledow nie ma naruszen dostepnosci", async () => {
    const { container } = renderuj();
    zapisz();
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});

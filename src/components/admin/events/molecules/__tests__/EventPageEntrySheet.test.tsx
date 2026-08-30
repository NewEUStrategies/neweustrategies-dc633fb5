// Molekula „POZYCJA MENU WYDARZENIA" - szuflada, w ktorej redaktor nadaje
// jednej podstronie etykiete, ikone, kolor i WIDOCZNOSC PER GRUPA.
//
// PO CO TEN PLIK ISTNIEJE. Szuflada nie zapisuje strony - zapisuje MAPOWANIE
// strony na menu wydarzenia. Roznica jest cala trescia tego ekranu i to na niej
// psuje sie najwiecej:
//
//   1. IKONA I KOLOR MAJA WZORCE Z BAZY (`event_pages_icon_check`,
//      `event_pages_color_check`). Wartosc, ktorej baza nie przyjmie, ma
//      zatrzymac sie PRZY POLU - komunikat o naruszeniu ograniczenia tabeli
//      w toascie nad ekranem nie mowi redaktorowi, ktore z dwoch pol poprawic.
//   2. PUSTE POLE TO NIE „BIALY" I NIE „BRAK IKONY W MENU", tylko
//      DZIEDZICZENIE: `null` w bazie znaczy „kolor z brandingu wydarzenia"
//      i „ikona domyslna". Wyslanie pustego napisu zamiast `null` zapisalo by
//      pustke jako wartosc i pozycja przestalaby reagowac na zmiane brandingu.
//   3. ZAPIS NADPISUJE CALY WIERSZ (`admin_event_page_upsert` ma
//      `DO UPDATE SET … = EXCLUDED.…`), wiec kazde pole musi wyjsc z szuflady
//      za kazdym razem - takze `sortOrder`, ktorego szuflada nie pokazuje.
//      Zgubiony `sort_order` przestawia pozycje na poczatek menu przy zmianie
//      samej ikony.
//   4. PUSTY WYBOR GRUP ZNACZY „WSZYSCY, TAKZE GOSCIE" - i musi dojechac jako
//      PUSTA TABLICA, a nie jako brak klucza (brak klucza zostawia poprzednia
//      widocznosc, czyli nie odbiera niczego).
//   5. RESET TYLKO PRZY OTWARCIU. Szuflada otwarta nad inna pozycja jest nowa
//      praca; szuflada, ktora czysci szkic przy KAZDEJ zmianie wiersza z bazy,
//      kasuje redaktorowi wpisana etykiete w chwili odswiezenia listy.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Regul czystych (`eventPageLabel`,
// `eventPageInput`) - `lib/events/__tests__/eventPagesApi.test.ts`.
// (2) Parytetu wzorcow z CHECK-ami bazy - `eventPagesDbEnumParity.test.ts`.
// (3) Zestawu akcji wiersza listy (odpiecie pozycji modulowej) -
// `EventPagesMenuPanel.test.tsx`.
//
// Radix Sheet jest podmieniony na natywny odpowiednik: pod happy-dom nie ma dla
// niego pelnego API wskaznika i portalu, a przedmiotem dowodu jest to, KTORE
// wartosci molekula oferuje i ktora dojedzie do ladunku.
//
// RODO: zadnych prawdziwych danych osobowych, adresy wylacznie `example.org`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

import { axeViolations, summarize } from "@/test/axe";
import type { EventPageInput } from "@/lib/events/eventPagesApi";
import type { EventGroupRow } from "@/lib/events/termsGroupsApi";

const h = vi.hoisted(() => ({
  language: "pl",
  /** Ladunki oddane do zapisu przez szuflade. */
  submitted: [] as EventPageInput[],
  /** Zadania zamkniecia szuflady (`onOpenChange`). */
  openChanges: [] as boolean[],
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);

// Selektor ikony ciagnie caly katalog Lucide - tutaj liczy sie wylacznie NAZWA
// ikony, ktora podglad przy polu probuje narysowac.
vi.mock("@/lib/icons/DynamicIcon", () => ({
  DynamicIcon: ({ name }: { name: string }) => <span data-testid={`ikona-${name}`} />,
}));

// Szuflada Radiksa montuje sie w portalu i pod happy-dom nie odtwarza pelnej
// mechaniki fokusa. Atrapa zostawia z niej KONTRAKT: przy `open === false`
// z jej wnetrza nie ma w drzewie NICZEGO, a otwarta szuflada jest OPISANA
// swoim tytulem (Radix wiaze `Content` z `Title` przez `aria-labelledby` - bez
// tego asercja dostepnosci mierzylaby wade atrapy, a nie molekuly).
const TYTUL_SZUFLADY = "szuflada-pozycji-tytul";

vi.mock("@/components/ui/sheet", () => {
  const stan = { open: false };
  return {
    Sheet: ({ open, children }: { open: boolean; children?: ReactNode }) => {
      stan.open = open;
      return <div data-open={String(open)}>{children}</div>;
    },
    SheetContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? (
        <div role="dialog" aria-labelledby={TYTUL_SZUFLADY}>
          {children}
        </div>
      ) : null,
    SheetHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    SheetTitle: ({ children }: { children?: ReactNode }) => <h2 id={TYTUL_SZUFLADY}>{children}</h2>,
    SheetDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  };
});

const { EventPageEntrySheet } =
  await import("@/components/admin/events/molecules/EventPageEntrySheet");

const E = "adminEvents.studio.pages.entry.";

const ENTRY_ID = "5a1c0000-0000-4000-8000-000000000001";
const PAGE_ID = "6b2d0000-0000-4000-8000-000000000001";
const GROUP_VIP = "7c3e0000-0000-4000-8000-000000000001";
const GROUP_PRESS = "8d4f0000-0000-4000-8000-000000000002";

/**
 * Wiersz PRZYPIETY - szuflada nie zaklada mapowania, tylko je zmienia.
 *
 * Ksztalt jest zwezeniem z `eventPagesApi` (`AttachedEventPageRow`), wiec
 * kolumna dodana do sygnatury RPC zaczerwieni ten budownik, a nie test.
 */
type Attached = Parameters<typeof EventPageEntrySheet>[0]["entry"] & object;

function entryRow(overrides: Partial<Attached> = {}): Attached {
  return {
    id: ENTRY_ID,
    page_id: PAGE_ID,
    page_path: "kongres/agenda",
    page_slug: "agenda",
    page_status: "published",
    title_pl: "Program kongresu",
    title_en: "Congress programme",
    menu_label_pl: "Agenda",
    menu_label_en: "Agenda",
    icon: "calendar-days",
    color: "#6A48C8",
    in_menu: true,
    sort_order: 40,
    visible_to_groups: [],
    module: null,
    updated_at: "2026-08-26T10:00:00.000Z",
    ...overrides,
  };
}

function groupRow(id: string, namePl: string, nameEn: string): EventGroupRow {
  return {
    attendee_visibility: "own_group",
    can_chat: true,
    can_lead_retrieval: false,
    can_meet: true,
    can_see_attendees: true,
    can_see_recording: true,
    color: "#FA9346",
    created_at: "2026-08-01T09:00:00.000Z",
    description_en: "",
    description_pl: "",
    event_id: "3f1a0c8e-0000-4000-8000-000000000042",
    extra_members_count: 0,
    id,
    is_default: false,
    is_system: false,
    key: id.slice(0, 8),
    members_count: 0,
    min_tier_rank: 0,
    name_en: nameEn,
    name_pl: namePl,
    primary_members_count: 0,
    sort_order: 10,
    tickets_count: 0,
    updated_at: "2026-08-02T09:00:00.000Z",
  };
}

const GRUPY: readonly EventGroupRow[] = [
  groupRow(GROUP_VIP, "Goscie honorowi", "VIP guests"),
  groupRow(GROUP_PRESS, "Prasa", "Press"),
];

function renderuj(
  props: {
    entry?: Attached | null;
    open?: boolean;
    groups?: readonly EventGroupRow[];
    isSaving?: boolean;
  } = {},
) {
  return render(
    <EventPageEntrySheet
      open={props.open ?? true}
      onOpenChange={(open) => h.openChanges.push(open)}
      entry={props.entry === undefined ? entryRow() : props.entry}
      groups={props.groups ?? []}
      isSaving={props.isSaving === true}
      onSubmit={(input) => h.submitted.push(input)}
    />,
  );
}

function pole(key: string): HTMLElement {
  return screen.getByLabelText(`${E}${key}`);
}

function wpisz(key: string, value: string): void {
  fireEvent.change(pole(key), { target: { value } });
}

function zapisz(): void {
  fireEvent.click(screen.getByText(`${E}save`));
}

/** Jedyny ladunek oddany do zapisu - brak zapisu jest tu bledem testu. */
function ladunek(): EventPageInput {
  if (h.submitted.length !== 1) {
    throw new Error(`test: oczekiwano jednego zapisu, bylo ${h.submitted.length}`);
  }
  return h.submitted[0];
}

beforeEach(() => {
  h.language = "pl";
  h.submitted = [];
  h.openChanges = [];
});

describe("szkic bierze sie z wiersza, i to TYLKO przy otwarciu", () => {
  it("kazde pole startuje z wartoscia zapisana", () => {
    renderuj({
      entry: entryRow({
        menu_label_pl: "Agenda",
        menu_label_en: "Programme",
        icon: "calendar-days",
        color: "#6A48C8",
        in_menu: true,
      }),
    });

    expect((pole("menuLabelPl") as HTMLInputElement).value).toBe("Agenda");
    expect((pole("menuLabelEn") as HTMLInputElement).value).toBe("Programme");
    expect((pole("icon") as HTMLInputElement).value).toBe("calendar-days");
    // Pole heksadecymalne pokazuje wartosc BEZ krzyzyka - krzyzyk stoi obok,
    // jako staly napis, zeby nie dalo sie wpisac go dwa razy.
    expect((pole("color") as HTMLInputElement).value).toBe("6A48C8");
    // Przelacznik Radiksa jest przyciskiem `role="switch"`, wiec stan czyta sie
    // z `aria-checked` - to ta sama wartosc, ktora oglasza czytnik ekranu.
    expect(pole("inMenu").getAttribute("aria-checked")).toBe("true");
  });

  // PUSTE KOLUMNY BAZY (`NULL`) TO PUSTE POLA, a nie napis „null" ani wartosc
  // domyslna wpisana do szkicu - inaczej pierwszy zapis utrwalilby domyslna
  // ikone jako wlasna i pozycja przestalaby dziedziczyc.
  it("brak etykiety, ikony i koloru daje POLA PUSTE", () => {
    renderuj({
      entry: entryRow({ menu_label_pl: null, menu_label_en: null, icon: null, color: null }),
    });

    expect((pole("menuLabelPl") as HTMLInputElement).value).toBe("");
    expect((pole("icon") as HTMLInputElement).value).toBe("");
    expect((pole("color") as HTMLInputElement).value).toBe("");
    // Podglad przy pustym polu rysuje ikone DOMYSLNA - tak samo, jak zrobi to
    // wiersz listy i strona publiczna.
    expect(screen.getByTestId("ikona-file-text")).toBeTruthy();
  });

  it("bez pozycji szuflada nie ma w drzewie ani jednego pola formularza", () => {
    renderuj({ entry: null });

    expect(screen.queryByLabelText(`${E}menuLabelPl`)).toBeNull();
    expect(screen.queryByText(`${E}save`)).toBeNull();
    // Naglowek zostaje - szuflada otwarta bez tytulu nie mialaby nazwy
    // dostepnej, a `aria-labelledby` wskazywalby w pustke.
    expect(screen.getByRole("heading", { name: `${E}title` })).toBeTruthy();
  });

  it("zamknieta szuflada nie zostawia w drzewie niczego", () => {
    renderuj({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText(`${E}icon`)).toBeNull();
  });

  // DEFEKT. Naglowek molekuly obiecuje „RESET TYLKO PRZY OTWARCIU", ale efekt
  // resetu ma w zaleznosciach `entry`, czyli OBIEKT wiersza - a ten jest nowy
  // przy kazdym odswiezeniu listy z bazy (`admin_event_pages_list` oddaje swieze
  // obiekty). Wystarczy wiec, ze React Query odswiezy liste w tle - przy
  // powrocie do karty (`refetchOnWindowFocus` jest wlaczone domyslnie) albo po
  // uniewaznieniu z sasiedniej mutacji - i szuflada nadpisuje wpisany szkic
  // wartosciami z bazy. Redaktor traci etykiete w polowie pisania, bez zadnego
  // komunikatu i bez wlasnego dzialania.
  //
  // Zaleznoscia powinien byc `entry.id` (tozsamosc POZYCJI, nie obiektu) - tak
  // samo, jak panel trzyma `editedId`, a nie wiersz.
  it.fails("DEFEKT: odswiezenie wiersza pod otwarta szuflada KASUJE wpisany szkic", () => {
    const { rerender } = renderuj({ entry: entryRow({ menu_label_pl: "Agenda" }) });
    wpisz("menuLabelPl", "Program");

    rerender(
      <EventPageEntrySheet
        open
        onOpenChange={(open) => h.openChanges.push(open)}
        entry={entryRow({ menu_label_pl: "Agenda", updated_at: "2026-08-27T10:00:00.000Z" })}
        groups={[]}
        isSaving={false}
        onSubmit={(input) => h.submitted.push(input)}
      />,
    );

    expect((pole("menuLabelPl") as HTMLInputElement).value).toBe("Program");
  });
  // ETYKIETA ANGIELSKA JEST OSOBNYM POLEM, nie kopia polskiej: menu wydarzenia
  // jest dwujezyczne, a tlumaczenie dopisuje sie pozniej.
  it("obie etykiety zmieniaja sie niezaleznie od siebie", () => {
    renderuj({ entry: entryRow({ menu_label_pl: "Agenda", menu_label_en: "Agenda" }) });
    wpisz("menuLabelEn", "Programme");
    zapisz();

    expect(ladunek().menuLabelPl).toBe("Agenda");
    expect(ladunek().menuLabelEn).toBe("Programme");
  });
});

describe("naglowek niesie etykiete ZAPISANA, nie szkic", () => {
  // Tytul wiazany z `aria-labelledby` nie moze znikac miedzy skasowaniem starej
  // etykiety a wpisaniem nowej - szuflada bez nazwy jest dla czytnika ekranu
  // bezimiennym oknem.
  it("skasowanie etykiety w szkicu NIE gasi naglowka", () => {
    renderuj({ entry: entryRow({ menu_label_pl: "Agenda", title_pl: "Program kongresu" }) });
    wpisz("menuLabelPl", "");

    expect(screen.getByRole("heading", { name: "Agenda" })).toBeTruthy();
  });

  it("po angielsku naglowek bierze etykiete angielska", () => {
    h.language = "en";
    renderuj({ entry: entryRow({ menu_label_pl: "Agenda", menu_label_en: "Programme" }) });

    expect(screen.getByRole("heading", { name: "Programme" })).toBeTruthy();
  });

  // Wlasnej etykiety nie ma - naglowek siega po TYTUL STRONY, tak samo jak
  // wiersz listy i menu publiczne.
  it("pozycja bez wlasnej etykiety pokazuje tytul strony", () => {
    renderuj({ entry: entryRow({ menu_label_pl: null, menu_label_en: null }) });
    expect(screen.getByRole("heading", { name: "Program kongresu" })).toBeTruthy();
  });
});

describe("ikona - wzorzec bazy egzekwowany PRZY POLU", () => {
  // `event_pages_icon_check` przepusci kazde kebab-case slowo, wiec podglad
  // przy polu jest jedyna walidacja literowki: nieznana nazwa daje znak
  // zapytania, zanim redaktor kliknie zapis.
  it("podglad rysuje TE ikone, ktora wpisano", () => {
    renderuj({ entry: entryRow({ icon: null }) });
    wpisz("icon", "handshake");
    expect(screen.getByTestId("ikona-handshake")).toBeTruthy();
  });

  it("wpisana nazwa jest przycinana i sprowadzana do malych liter", () => {
    renderuj({ entry: entryRow({ icon: null }) });
    wpisz("icon", "  Calendar-Days  ");
    expect((pole("icon") as HTMLInputElement).value).toBe("calendar-days");
  });

  // KOMUNIKAT DOPIERO PO PROBIE ZAPISU: czerwone pole w trakcie pisania
  // („cal" nie jest jeszcze poprawne) uczy ignorowac komunikaty.
  it("bledna ikona milczy w trakcie pisania, a mowi po probie zapisu", () => {
    renderuj({ entry: entryRow({ icon: null }) });
    fireEvent.change(pole("icon"), { target: { value: "kalendarz!" } });

    expect(screen.queryByText(`${E}iconInvalid`)).toBeNull();

    zapisz();
    expect(screen.getByText(`${E}iconInvalid`)).toBeTruthy();
    expect(h.submitted).toEqual([]);
  });

  it("bledna ikona wiaze komunikat z polem przez `aria-describedby`", () => {
    renderuj({ entry: entryRow({ icon: null }) });
    fireEvent.change(pole("icon"), { target: { value: "kalendarz!" } });
    zapisz();

    const input = pole("icon");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const opis = input.getAttribute("aria-describedby");
    expect(opis).not.toBeNull();
    expect(document.getElementById(opis ?? "")?.textContent).toBe(`${E}iconInvalid`);
  });

  // KONTRAPUNKT: poprawiona ikona ODBLOKOWUJE zapis. Bez tego przypadku
  // asercja wyzej przechodzilaby takze wtedy, gdyby szuflada nie zapisywala
  // NIGDY.
  it("poprawiona ikona przechodzi i jedzie do ladunku", () => {
    renderuj({ entry: entryRow({ icon: null }) });
    fireEvent.change(pole("icon"), { target: { value: "kalendarz!" } });
    zapisz();
    wpisz("icon", "calendar-days");
    zapisz();

    expect(ladunek().icon).toBe("calendar-days");
  });

  // PUSTE POLE TO `null`, NIE PUSTY NAPIS: `null` znaczy „bez wlasnej ikony",
  // czyli degradacje do domyslnej. Pusty napis nie przeszedlby CHECK-a bazy.
  it("wyczyszczona ikona jedzie jako `null`, a nie jako pusty napis", () => {
    renderuj({ entry: entryRow({ icon: "calendar-days" }) });
    wpisz("icon", "");
    zapisz();

    expect(ladunek().icon).toBeNull();
  });
});

describe("kolor - dwa wejscia na jedna wartosc", () => {
  it("wpisany kod jedzie WIELKIMI literami, z krzyzykiem", () => {
    renderuj({ entry: entryRow({ color: null }) });
    wpisz("color", "6a48c8");
    zapisz();

    expect(ladunek().color).toBe("#6A48C8");
  });

  // Redaktor przeklei kolor z identyfikacji wizualnej razem z krzyzykiem;
  // podwojny krzyzyk („##6A48C8") nie przeszedlby CHECK-a bazy.
  it("wklejony krzyzyk nie dubluje sie", () => {
    renderuj({ entry: entryRow({ color: null }) });
    wpisz("color", "#6A48C8");

    expect((pole("color") as HTMLInputElement).value).toBe("6A48C8");
    zapisz();
    expect(ladunek().color).toBe("#6A48C8");
  });

  // PROBNIK SYSTEMOWY JEST DRUGIM WEJSCIEM na te sama wartosc - pipeta jest
  // szybsza, ale kolor z ksiegi znaku przychodzi jako napis.
  it("probnik systemowy zapisuje kolor tak samo jak pole tekstowe", () => {
    renderuj({ entry: entryRow({ color: null }) });
    fireEvent.change(screen.getByLabelText(`${E}colorPicker`), { target: { value: "#d73953" } });
    zapisz();

    expect(ladunek().color).toBe("#D73953");
  });

  // PUSTE POLE NIE ZNACZY BIALY, znaczy „kolor z brandingu wydarzenia" -
  // dlatego probnik pokazuje wtedy biel, ale sam z siebie jej NIE zapisuje.
  it("pusty kolor pokazuje w probniku biel, a do bazy jedzie `null`", () => {
    renderuj({ entry: entryRow({ color: null }) });

    expect((screen.getByLabelText(`${E}colorPicker`) as HTMLInputElement).value).toBe("#ffffff");
    zapisz();
    expect(ladunek().color).toBeNull();
  });

  // WYCZYSZCZENIE KOLORU TO POWROT DO BRANDINGU WYDARZENIA - do bazy jedzie
  // `null`, a nie pusty napis, ktorego CHECK i tak by nie przepuscil.
  it("wyczyszczenie zapisanego koloru jedzie jako `null`", () => {
    renderuj({ entry: entryRow({ color: "#6A48C8" }) });
    wpisz("color", "");

    expect((pole("color") as HTMLInputElement).value).toBe("");
    zapisz();
    expect(ladunek().color).toBeNull();
  });

  it("bledny kolor zatrzymuje zapis i mowi o tym przy polu", () => {
    renderuj({ entry: entryRow({ color: null }) });
    fireEvent.change(pole("color"), { target: { value: "ZZZ" } });

    expect(screen.queryByText(`${E}colorInvalid`)).toBeNull();
    zapisz();

    expect(screen.getByText(`${E}colorInvalid`)).toBeTruthy();
    expect(pole("color").getAttribute("aria-invalid")).toBe("true");
    expect(h.submitted).toEqual([]);
  });

  // Trzy znaki to POPRAWNY zapis koloru w CSS, ale nie w tej kolumnie: CHECK
  // bazy zada dokladnie szesciu. Skrot przepuszczony tutaj konczylby sie
  // naruszeniem ograniczenia w toascie.
  it("skrot trzyznakowy tez jest odrzucany - CHECK bazy zada szesciu", () => {
    renderuj({ entry: entryRow({ color: null }) });
    fireEvent.change(pole("color"), { target: { value: "FFF" } });
    zapisz();

    expect(screen.getByText(`${E}colorInvalid`)).toBeTruthy();
    expect(h.submitted).toEqual([]);
  });
});

describe("widocznosc per grupa", () => {
  it("bez grup wydarzenia stoi ZDANIE, a nie pusta ramka", () => {
    renderuj({ groups: [] });
    expect(screen.getByText(`${E}visibilityNoGroups`)).toBeTruthy();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("kazda grupa wydarzenia ma wlasne pole wyboru z nazwa w jezyku interfejsu", () => {
    renderuj({ groups: GRUPY });

    expect(screen.getByRole("checkbox", { name: "Goscie honorowi" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Prasa" })).toBeTruthy();
  });

  it("po angielsku nazwy grup ida po angielsku", () => {
    h.language = "en";
    renderuj({ groups: GRUPY });

    expect(screen.getByRole("checkbox", { name: "VIP guests" })).toBeTruthy();
  });

  it("zaznaczenie grupy dokleja jej identyfikator do ladunku", () => {
    renderuj({ groups: GRUPY, entry: entryRow({ visible_to_groups: [] }) });
    fireEvent.click(screen.getByRole("checkbox", { name: "Prasa" }));
    zapisz();

    expect(ladunek().visibleToGroups).toEqual([GROUP_PRESS]);
  });

  it("odznaczenie grupy zdejmuje ja z ladunku, zostawiajac pozostale", () => {
    renderuj({ groups: GRUPY, entry: entryRow({ visible_to_groups: [GROUP_VIP, GROUP_PRESS] }) });
    fireEvent.click(screen.getByRole("checkbox", { name: "Goscie honorowi" }));
    zapisz();

    expect(ladunek().visibleToGroups).toEqual([GROUP_PRESS]);
  });

  // PUSTY WYBOR ZNACZY „WSZYSCY, TAKZE GOSCIE" i musi dojechac jako PUSTA
  // TABLICA - brak klucza zostawilby poprzednia widocznosc, wiec „pokaz
  // wszystkim" nie odbieraloby zadnego ograniczenia.
  it("zdjecie ostatniej grupy jedzie jako PUSTA TABLICA, a nie brak klucza", () => {
    renderuj({ groups: GRUPY, entry: entryRow({ visible_to_groups: [GROUP_VIP] }) });
    fireEvent.click(screen.getByRole("checkbox", { name: "Goscie honorowi" }));
    zapisz();

    const input = ladunek();
    expect(input.visibleToGroups).toEqual([]);
    expect(Object.keys(input)).toContain("visibleToGroups");
  });

  it("stan pol wyboru czyta sie z wiersza, nie z kolejnosci grup", () => {
    renderuj({ groups: GRUPY, entry: entryRow({ visible_to_groups: [GROUP_PRESS] }) });

    expect(
      (screen.getByRole("checkbox", { name: "Prasa" }) as HTMLElement).getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      (screen.getByRole("checkbox", { name: "Goscie honorowi" }) as HTMLElement).getAttribute(
        "aria-checked",
      ),
    ).toBe("false");
  });
});

describe("ladunek zapisu - CALY wiersz, przy kazdej zmianie", () => {
  // `admin_event_page_upsert` nadpisuje KAZDA kolumne, takze pominieta. Zapis
  // samej ikony bez `sort_order` przestawilby pozycje na poczatek menu.
  it("zmiana jednego pola wysyla komplet pol pozycji", () => {
    renderuj({
      groups: GRUPY,
      entry: entryRow({
        menu_label_pl: "Agenda",
        menu_label_en: "Programme",
        icon: "calendar-days",
        color: "#6A48C8",
        in_menu: true,
        sort_order: 40,
        visible_to_groups: [GROUP_VIP],
      }),
    });
    wpisz("menuLabelPl", "Program");
    zapisz();

    expect(ladunek()).toEqual({
      id: ENTRY_ID,
      menuLabelPl: "Program",
      menuLabelEn: "Programme",
      icon: "calendar-days",
      color: "#6A48C8",
      inMenu: true,
      sortOrder: 40,
      visibleToGroups: [GROUP_VIP],
    });
  });

  // ZNACZNIK MODULU NIE JEDZIE W LADUNKU. Gdyby wszedl, pierwszy zapis pozycji
  // modulowej mogl by go wyczyscic - a wtedy piatka dalaby sie odpiac i zasiew
  // zalozylby szosta strone o tej samej tresci.
  it("ladunek NIE niesie znacznika modulu, takze dla pozycji modulowej", () => {
    renderuj({ entry: entryRow({ module: "agenda" }) });
    zapisz();

    expect(Object.keys(ladunek())).not.toContain("module");
  });

  it("przelacznik obecnosci w menu jedzie jako wartosc logiczna", () => {
    renderuj({ entry: entryRow({ in_menu: true }) });
    fireEvent.click(pole("inMenu"));
    zapisz();

    expect(ladunek().inMenu).toBe(false);
  });

  // TRWAJACY ZAPIS GASI OBA PRZYCISKI: drugie klikniecie to drugi zapis tego
  // samego wiersza, czyli wyscig o `sort_order`.
  it("trwajacy zapis gasi przyciski i drugie klikniecie nic nie wysyla", () => {
    renderuj({ isSaving: true });
    const przycisk = screen.getByText(`${E}save`).closest("button");

    expect(przycisk?.hasAttribute("disabled")).toBe(true);
    fireEvent.click(przycisk as HTMLElement);
    expect(h.submitted).toEqual([]);
  });

  it("„Anuluj” zamyka szuflade i NIE zapisuje niczego", () => {
    renderuj();
    fireEvent.click(screen.getByText(`${E}cancel`));

    expect(h.openChanges).toEqual([false]);
    expect(h.submitted).toEqual([]);
  });
});

describe("dostepnosc", () => {
  it("szuflada pozycji menu nie ma naruszen axe", async () => {
    const { container } = renderuj({ groups: GRUPY });
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("szuflada z komunikatami bledow tez nie ma naruszen axe", async () => {
    const { container } = renderuj({ groups: GRUPY });
    fireEvent.change(pole("icon"), { target: { value: "kalendarz!" } });
    fireEvent.change(pole("color"), { target: { value: "ZZZ" } });
    zapisz();

    expect(within(container).getAllByRole("alert")).toHaveLength(2);
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});

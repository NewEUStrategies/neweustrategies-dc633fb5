// Molekula „GRUPA UCZESTNIKOW" - szuflada, w ktorej zapada decyzja o tym,
// KTO KOGO WIDZI i KTO MOZE SIE Z KIM SPOTKAC.
//
// DLACZEGO TEN PLIK JEST OSTRZEJSZY OD zwyklego formularza katalogu. Szesc
// przelacznikow tej szuflady to nie ustawienia wygladu, tylko uprawnienia
// czytane pozniej w SQL-u przy KAZDYM zapytaniu uczestnika: lista obecnych,
// gielda spotkan, czat, skanowanie leadow, nagranie. Pomylka tutaj nie psuje
// widoku - otwiera dane uczestnikow komus, kto nie mial ich zobaczyc.
//
// CO TEN PLIK DOWODZI. Kazde uprawnienie ma PARE „moze / nie moze":
//   1. KLUCZ TECHNICZNY jest edytowalny przy zakladaniu grupy i ZAMROZONY przy
//      edycji. RPC edycji w ogole go nie czyta, wiec pole odblokowane
//      obiecywaloby zmiane, ktora nigdy sie nie stanie.
//   2. WLACZNIK I ZASIEG TO DWA POLA, bo baza ma na to dwa warunki. Przy
//      wylaczonym wlaczniku zasieg jest NIEDOSTEPNY i do bazy jedzie `none` -
//      CHECK `can_see_attendees OR attendee_visibility = 'none'` odrzucilby
//      kazde inne zestawienie, a organizator dostalby komunikat o warunku
//      tabeli zamiast zrozumialego ekranu.
//   3. ZAKLADKA CZLONKOW pokazuje liczniki TYLKO dla grupy zapisanej. Grupa
//      bez identyfikatora nie ma czlonkow, wiec puste liczniki udawalyby, ze
//      jest co pokazac.
//   4. NIEKOMPLETNY SZKIC NIE DOTYKA WARSTWY ZAPISU - kazda regula osobno,
//      a asercja stoi na atrapie zapisu, nie na czerwonym zdaniu.
//   5. LADUNEK JEST TYM, CO ZOBACZY BAZA: przyciete nazwy, kolor `null` przy
//      pustym polu, liczby zamiast tekstow.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Tabeli regul szkicu (`termsGroupsDraft`) -
// ma wlasny plik; tutaj dowodzimy, ze molekula ich UZYWA i co robi z wynikiem.
// (2) Wierszy formularza (`AdminForm*Row`) - to osobne molekuly panelu.
// (3) Parytetu zbioru zasiegow z CHECK-iem bazy - `termsGroupsDbEnumParity`.
//
// Radix Sheet, Tabs, Select i Switch sa podmienione na natywne odpowiedniki:
// pod happy-dom nie ma dla nich pelnego API wskaznika, a przedmiotem dowodu
// jest to, KTORE wartosci molekula oferuje i ktora dojedzie do ladunku.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { radixSwitchStub, radixTabsStub } from "@/test/reactStubs";
import { axeViolations, summarize } from "@/test/axe";
import type { EventGroupRow, GroupInput } from "@/lib/events/termsGroupsApi";

const h = vi.hoisted(() => ({
  language: "pl",
  /** Szkice oddane do zapisu przez molekule. */
  submitted: [] as GroupInput[],
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);
vi.mock("@/components/ui/switch", async () => radixSwitchStub(await import("react")));
vi.mock("@/components/ui/tabs", async () => radixTabsStub(await import("react")));

// Szuflada Radiksa montuje sie w portalu i pod happy-dom nie odtwarza pelnej
// mechaniki fokusa. Atrapa zostawia z niej KONTRAKT: przy `open === false`
// z jej wnetrza nie ma w drzewie NICZEGO, a otwarta szuflada jest OPISANA
// swoim tytulem (Radix wiaze `Content` z `Title` przez `aria-labelledby` -
// bez tego asercja dostepnosci mierzylaby wade atrapy, a nie molekuly).
const TYTUL_SZUFLADY = "szuflada-grupy-tytul";

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

// Droplista zasiegu stoi na Radix Select (przez `FormSelect`). Atrapa jest
// natywna i ETYKIETOWANA, bo dowodzimy, KTORE zasiegi molekula oferuje i czy
// pole jest dostepne przy wylaczonym wlaczniku.
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

const { EventGroupDialog } = await import("@/components/admin/events/molecules/EventGroupDialog");

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const GROUP_ID = "22222222-2222-4222-8222-222222222222";
const D = "adminEventTerms.groups.dialog.";

/**
 * Wiersz `admin_event_groups_list`.
 *
 * `color` przychodzi z RPC jako `NULL` („grupa bez koloru"), a sygnatura
 * generowana z bazy opisuje kolumne jako `string` - `RETURNS TABLE` nie niesie
 * informacji o nullowalnosci. Rzutowanie jest wiec WIERNE bazie, nie obejsciem
 * typu: molekula te pustke rozroznia (puste pole zamiast napisu „null").
 */
const BRAK_KOLORU = null as unknown as string;

function groupRow(overrides: Partial<EventGroupRow> = {}): EventGroupRow {
  return {
    attendee_visibility: "own_group",
    can_chat: true,
    can_lead_retrieval: false,
    can_meet: true,
    can_see_attendees: true,
    can_see_recording: true,
    color: "#FA9346",
    created_at: "2026-08-01T09:00:00.000Z",
    description_en: "VIP guests",
    description_pl: "Goscie honorowi",
    event_id: EVENT_ID,
    extra_members_count: 4,
    id: GROUP_ID,
    is_default: false,
    is_system: false,
    key: "vip",
    members_count: 12,
    min_tier_rank: 2,
    name_en: "VIP guests",
    name_pl: "Goscie honorowi",
    primary_members_count: 12,
    sort_order: 20,
    tickets_count: 3,
    updated_at: "2026-08-02T09:00:00.000Z",
    ...overrides,
  };
}

function renderuj(props: { group?: EventGroupRow | null; isSaving?: boolean } = {}) {
  return render(
    <EventGroupDialog
      open
      onOpenChange={() => undefined}
      eventId={EVENT_ID}
      group={props.group ?? null}
      nextSortOrder={30}
      isSaving={props.isSaving === true}
      onSubmit={(input) => h.submitted.push(input)}
    />,
  );
}

/** Pole formularza po kluczu etykiety. */
function pole(key: string): HTMLElement {
  return screen.getByLabelText(`${D}${key}`);
}

function wpisz(key: string, value: string): void {
  fireEvent.change(pole(key), { target: { value } });
}

function przelacz(key: string): void {
  fireEvent.click(pole(key));
}

function zapisz(): void {
  fireEvent.click(screen.getByText(`${D}saveAction`));
}

/** Wypelnia szuflade tak, zeby zapis przeszedl walidacje. */
function wypelnijPoprawnie(): void {
  wpisz("key", "vip");
  wpisz("namePl", "Goscie honorowi");
  wpisz("nameEn", "VIP guests");
}

function zakladka(key: string): HTMLElement {
  return screen.getByRole("tab", { name: `${D}${key}` });
}

beforeEach(() => {
  h.language = "pl";
  h.submitted = [];
});

describe("klucz techniczny - para „nowa grupa moze / edycja nie moze”", () => {
  // KLUCZ JEST TOZSAMOSCIA GRUPY W BAZIE (`event_groups_event_key_unique`)
  // i wskazuja go bilety oraz czlonkostwa. Przy zakladaniu grupy trzeba go
  // podac, przy edycji nie ma go jak zmienic.
  it("nowa grupa ma klucz EDYTOWALNY", () => {
    renderuj();
    expect((pole("key") as HTMLInputElement).disabled).toBe(false);
  });

  it("grupa zapisana ma klucz ZABLOKOWANY", () => {
    renderuj({ group: groupRow() });
    expect((pole("key") as HTMLInputElement).disabled).toBe(true);
  });

  it("zablokowany klucz nadal POKAZUJE wartosc zapisana", () => {
    renderuj({ group: groupRow({ key: "vip" }) });
    expect((pole("key") as HTMLInputElement).value).toBe("vip");
  });
});

describe("widocznosc uczestnikow - para „wlacznik wlaczony / wylaczony”", () => {
  // WLACZNIK JEST WLACZNIKIEM, ZASIEG ZASIEGIEM. Zlanie ich w jedno pole
  // odebraloby organizatorowi mozliwosc pokazania listy WEZIEJ niz wszystkim
  // zapisanym (np. tylko wlasnej grupie).
  it("przy wlaczonym wlaczniku zasieg jest DOSTEPNY", () => {
    renderuj({ group: groupRow({ can_see_attendees: true }) });
    expect((pole("visibility") as HTMLSelectElement).disabled).toBe(false);
  });

  it("przy wylaczonym wlaczniku zasieg jest NIEDOSTEPNY", () => {
    renderuj({ group: groupRow({ can_see_attendees: false, attendee_visibility: "none" }) });
    expect((pole("visibility") as HTMLSelectElement).disabled).toBe(true);
  });

  it("droplista niesie WSZYSTKIE cztery zasiegi, ktore baza przyjmuje", () => {
    renderuj();
    const opcje = within(pole("visibility"))
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(opcje).toEqual([
      "adminEventTerms.visibilities.none",
      "adminEventTerms.visibilities.own_group",
      "adminEventTerms.visibilities.registered",
      "adminEventTerms.visibilities.everyone",
    ]);
  });

  it("wybrany zasieg jedzie do ladunku", () => {
    renderuj();
    wypelnijPoprawnie();
    fireEvent.change(pole("visibility"), { target: { value: "everyone" } });
    zapisz();
    expect(h.submitted[0]?.attendeeVisibility).toBe("everyone");
  });

  // CHECK BAZY: `can_see_attendees OR attendee_visibility = 'none'`. Wylaczony
  // wlacznik z zasiegiem „wszyscy zapisani" to odmowa - molekula domyka to
  // sama, zeby organizator nie czytal komunikatu o warunku tabeli.
  it("wylaczony wlacznik wysyla zasieg `none`, mimo wybranego wczesniej szerszego", () => {
    renderuj();
    wypelnijPoprawnie();
    fireEvent.change(pole("visibility"), { target: { value: "everyone" } });
    przelacz("canSeeAttendees");
    zapisz();
    expect(h.submitted[0]).toMatchObject({ canSeeAttendees: false, attendeeVisibility: "none" });
  });
});

describe("pozostale uprawnienia jada do ladunku jawnie", () => {
  it("komplet przelacznikow z wiersza trafia do zapisu bez zmian", () => {
    renderuj({
      group: groupRow({
        can_meet: true,
        can_chat: false,
        can_lead_retrieval: true,
        can_see_recording: false,
      }),
    });
    zapisz();
    expect(h.submitted[0]).toMatchObject({
      canMeet: true,
      canChat: false,
      canLeadRetrieval: true,
      canSeeRecording: false,
    });
  });

  // PARA NA JEDNYM UPRAWNIENIU: nadanie i odebranie prawa do skanowania leadow
  // musi dojechac do bazy jako `true` i jako `false` - pominiety klucz
  // ZOSTAWIA stan poprzedni, wiec „odebralem uprawnienie" nie zmienialoby nic.
  it("nadanie prawa do skanowania leadow jedzie jako `true`", () => {
    renderuj({ group: groupRow({ can_lead_retrieval: false }) });
    przelacz("canLeadRetrieval");
    zapisz();
    expect(h.submitted[0]?.canLeadRetrieval).toBe(true);
  });

  it("odebranie prawa do skanowania leadow jedzie jako `false`", () => {
    renderuj({ group: groupRow({ can_lead_retrieval: true }) });
    przelacz("canLeadRetrieval");
    zapisz();
    expect(h.submitted[0]?.canLeadRetrieval).toBe(false);
  });

  // GRUPA DOMYSLNA WCHODZI DO KAZDEGO NOWEGO ZAPISU BEZ BILETU, wiec jej
  // ustawienie jest decyzja o uprawnieniach wszystkich przyszlych uczestnikow.
  it("znacznik grupy domyslnej jedzie do ladunku", () => {
    renderuj();
    wypelnijPoprawnie();
    przelacz("isDefault");
    zapisz();
    expect(h.submitted[0]?.isDefault).toBe(true);
  });
});

describe("zakladka czlonkow - para „grupa zapisana / grupa jeszcze nie”", () => {
  // GRUPA BEZ IDENTYFIKATORA NIE MA CZLONKOW. Trzy zera udawalyby, ze jest co
  // pokazac - a to inny komunikat niz „najpierw zapisz".
  it("nowa grupa NIE pokazuje licznikow, tylko zdanie o zapisie", () => {
    renderuj();
    fireEvent.click(zakladka("tabMembers"));
    expect(screen.getByText(`${D}membersAfterSaveHint`)).toBeTruthy();
    expect(screen.queryByText("adminEventTerms.labels.members")).toBeNull();
  });

  it("grupa zapisana pokazuje trzy liczniki z wiersza listy", () => {
    renderuj({
      group: groupRow({ primary_members_count: 12, extra_members_count: 4, tickets_count: 3 }),
    });
    fireEvent.click(zakladka("tabMembers"));
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("adminEventTerms.labels.members")).toBeTruthy();
    expect(within(panel).getByText("12")).toBeTruthy();
    expect(within(panel).getByText("4")).toBeTruthy();
    expect(within(panel).getByText("3")).toBeTruthy();
    expect(within(panel).queryByText(`${D}membersAfterSaveHint`)).toBeNull();
  });

  // ZERO CZLONKOW TO NIE JEST „BRAK DANYCH". Grupa zapisana, do ktorej nikt
  // jeszcze nie nalezy, ma pokazac zero - inaczej organizator nie odrozni jej
  // od grupy, ktorej licznikow ekran nie umie policzyc.
  it("grupa zapisana bez ani jednego czlonka pokazuje zera", () => {
    renderuj({
      group: groupRow({ primary_members_count: 0, extra_members_count: 0, tickets_count: 0 }),
    });
    fireEvent.click(zakladka("tabMembers"));
    expect(within(screen.getByRole("tabpanel")).getAllByText("0")).toHaveLength(3);
  });

  // PRZEJSCIE NA LICZNIKI I Z POWROTEM NIE MOZE KASOWAC PRACY. Zerkniecie na
  // liczbe czlonkow w trakcie edycji nazwy jest zwyklym ruchem redaktora.
  it("przelaczenie zakladki nie kasuje wpisanych wartosci", () => {
    renderuj({ group: groupRow() });
    wpisz("namePl", "Rada programowa");
    fireEvent.click(zakladka("tabMembers"));
    fireEvent.click(zakladka("tabGeneral"));
    expect((pole("namePl") as HTMLInputElement).value).toBe("Rada programowa");
  });
});

describe("co zatrzymuje zapis PRZED zadaniem", () => {
  it("pusty formularz nie woła warstwy zapisu", () => {
    renderuj();
    zapisz();
    expect(h.submitted).toEqual([]);
  });

  // KLUCZ NIEZGODNY ZE WZORCEM BAZY konczy sie odmowa `invalid_key`. Bramka
  // po stronie molekuly pokazuje blad PRZY POLU, a nie w toascie, ktory
  // zniknie razem z wpisana trescia.
  it("klucz niezgodny ze wzorcem bazy zatrzymuje zapis i nazywa pole", () => {
    renderuj();
    wpisz("key", "VIP!");
    wpisz("namePl", "Goscie");
    wpisz("nameEn", "Guests");
    zapisz();
    expect(h.submitted).toEqual([]);
    expect(screen.getByText("adminEventTerms.validation.invalidKey")).toBeTruthy();
  });

  it("brak nazwy w jednym z jezykow zatrzymuje zapis", () => {
    renderuj();
    wpisz("key", "vip");
    wpisz("namePl", "Goscie honorowi");
    zapisz();
    expect(h.submitted).toEqual([]);
    expect(screen.getByText("adminEventTerms.validation.invalidNames")).toBeTruthy();
  });

  // KOLOR JEDZIE DO CSS JAKO ZMIENNA, wiec baza wymaga literalu
  // heksadecymalnego (`event_groups_color_hex`).
  it("kolor spoza formatu heksadecymalnego zatrzymuje zapis", () => {
    renderuj();
    wypelnijPoprawnie();
    wpisz("color", "pomaranczowy");
    zapisz();
    expect(h.submitted).toEqual([]);
    expect(screen.getByText("adminEventTerms.validation.invalidColor")).toBeTruthy();
  });

  it("ranga i kolejnosc spoza liczb calkowitych zatrzymuja zapis", () => {
    renderuj();
    wypelnijPoprawnie();
    wpisz("minTierRank", "trzy");
    zapisz();
    expect(h.submitted).toEqual([]);
    expect(screen.getByText("adminEventTerms.validation.invalidNumber")).toBeTruthy();
  });

  // BLAD POKAZUJE SIE DOPIERO PO PROBIE ZAPISU. Czerwone pola przy pierwszym
  // otwarciu pustego formularza czytaja sie jak awaria ekranu.
  it("przed proba zapisu nie ma ani jednego komunikatu bledu", () => {
    renderuj();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("ksztalt ladunku", () => {
  it("nowa grupa niesie wydarzenie, przyciety klucz i przyciete nazwy", () => {
    renderuj();
    wpisz("key", "  rada_programowa  ");
    wpisz("namePl", "  Rada programowa  ");
    wpisz("nameEn", "  Programme board  ");
    zapisz();
    expect(h.submitted[0]).toMatchObject({
      eventId: EVENT_ID,
      key: "rada_programowa",
      namePl: "Rada programowa",
      nameEn: "Programme board",
    });
  });

  // PUSTE POLE KOLORU TO JAWNE „BEZ KOLORU". Warstwa danych rozroznia `null`
  // (wyczysc) od braku klucza (zostaw) - molekula musi podac to pierwsze.
  it("puste pole koloru jedzie jako `null`", () => {
    renderuj();
    wypelnijPoprawnie();
    zapisz();
    expect(h.submitted[0]?.color).toBeNull();
  });

  it("wiersz bez koloru otwiera sie z PUSTYM polem, a nie z napisem", () => {
    renderuj({ group: groupRow({ color: BRAK_KOLORU }) });
    expect((pole("color") as HTMLInputElement).value).toBe("");
  });

  it("liczby jada jako liczby, nie jako teksty z pola", () => {
    renderuj();
    wypelnijPoprawnie();
    wpisz("minTierRank", "3");
    wpisz("sortOrder", "40");
    zapisz();
    expect(h.submitted[0]?.minTierRank).toBe(3);
    expect(h.submitted[0]?.sortOrder).toBe(40);
  });

  it("edycja niesie identyfikator grupy i NIE niesie klucza", () => {
    renderuj({ group: groupRow() });
    zapisz();
    expect(h.submitted[0]?.id).toBe(GROUP_ID);
    expect(h.submitted[0]?.key).toBeUndefined();
    expect(h.submitted[0]?.eventId).toBeUndefined();
  });
});

describe("naglowek, jezyk i stan zapisu", () => {
  it("nowa grupa ma tytul zakladania", () => {
    renderuj();
    expect(screen.getByText(`${D}createTitle`)).toBeTruthy();
  });

  // NAGLOWEK NIESIE NAZWE ZAPISANA, NIE SZKIC: tytul wiazany z `aria` nie moze
  // znikac miedzy skasowaniem starej nazwy a wpisaniem nowej.
  it("naglowek edycji trzyma nazwe ZAPISANA, mimo wyczyszczenia pola", () => {
    renderuj({ group: groupRow({ name_pl: "Goscie honorowi" }) });
    wpisz("namePl", "");
    expect(screen.getByRole("heading", { name: "Goscie honorowi" })).toBeTruthy();
  });

  it("po angielsku naglowek bierze nazwe angielska", () => {
    h.language = "en";
    renderuj({ group: groupRow({ name_pl: "Goscie honorowi", name_en: "VIP guests" }) });
    expect(screen.getByRole("heading", { name: "VIP guests" })).toBeTruthy();
  });

  // TRWAJACY ZAPIS GASI OBA PRZYCISKI: dwa klikniecia to dwie grupy o tym
  // samym kluczu, czyli odmowa unikalnosci przy drugiej z nich.
  it("trwajacy zapis gasi przyciski i drugie klikniecie nic nie wysyla", () => {
    renderuj({ group: groupRow(), isSaving: true });
    const przycisk = screen.getByText(`${D}saveAction`).closest("button");
    expect(przycisk?.hasAttribute("disabled")).toBe(true);
    fireEvent.click(przycisk as HTMLElement);
    expect(h.submitted).toEqual([]);
  });

  // ZAMKNIETA SZUFLADA NIE ZOSTAWIA POL W DRZEWIE - inaczej czytnik ekranu
  // czytalby formularz, ktorego nie widac.
  it("zamknieta szuflada nie ma w drzewie ani jednego pola", () => {
    render(
      <EventGroupDialog
        open={false}
        onOpenChange={() => undefined}
        eventId={EVENT_ID}
        group={null}
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
  it("szuflada nowej grupy nie ma naruszen dostepnosci", async () => {
    const { container } = renderuj();
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("szuflada z komunikatami bledow nie ma naruszen dostepnosci", async () => {
    const { container } = renderuj();
    zapisz();
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("zakladka licznikow czlonkow nie ma naruszen dostepnosci", async () => {
    const { container } = renderuj({ group: groupRow() });
    fireEvent.click(zakladka("tabMembers"));
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});

describe("pary „nadaje / odbiera” na trzech pozostalych uprawnieniach", () => {
  // TE SAME TRZY UPRAWNIENIA, CO W `EventGroupsPermissionsPanel`, tylko od
  // strony zapisu. Ladunek `admin_event_group_save` idzie przez `p_payload ?
  // 'klucz'`, wiec KLUCZ POMINIETY ZOSTAWIA STAN POPRZEDNI - „odebralem prawo"
  // bez jawnego `false` nie odbiera niczego. Dlatego kazde uprawnienie ma tu
  // pare: nadanie i odebranie, a nie sam happy path.
  it("prawo do umawiania spotkan: nadanie jedzie jako `true`", () => {
    renderuj({ group: groupRow({ can_meet: false }) });
    przelacz("canMeet");
    zapisz();
    expect(h.submitted[0]?.canMeet).toBe(true);
  });

  it("prawo do umawiania spotkan: odebranie jedzie jako `false`", () => {
    renderuj({ group: groupRow({ can_meet: true }) });
    przelacz("canMeet");
    zapisz();
    expect(h.submitted[0]?.canMeet).toBe(false);
  });

  it("prawo do rozmowy: nadanie jedzie jako `true`", () => {
    renderuj({ group: groupRow({ can_chat: false }) });
    przelacz("canChat");
    zapisz();
    expect(h.submitted[0]?.canChat).toBe(true);
  });

  it("prawo do rozmowy: odebranie jedzie jako `false`", () => {
    renderuj({ group: groupRow({ can_chat: true }) });
    przelacz("canChat");
    zapisz();
    expect(h.submitted[0]?.canChat).toBe(false);
  });

  // NAGRANIE JEST TRESCIA PLATNA. Grupa, ktora dostala do niego dostep przez
  // pomylke, oglada material zarezerwowany dla wyzszego biletu - i odwrotnie:
  // odebranie, ktore nie dojechalo, zostawia dostep otwarty.
  it("dostep do nagrania: nadanie jedzie jako `true`", () => {
    renderuj({ group: groupRow({ can_see_recording: false }) });
    przelacz("canSeeRecording");
    zapisz();
    expect(h.submitted[0]?.canSeeRecording).toBe(true);
  });

  it("dostep do nagrania: odebranie jedzie jako `false`", () => {
    renderuj({ group: groupRow({ can_see_recording: true }) });
    przelacz("canSeeRecording");
    zapisz();
    expect(h.submitted[0]?.canSeeRecording).toBe(false);
  });
});

describe("opis grupy jedzie do ladunku w obu jezykach", () => {
  // OPIS JEST JEDYNYM MIEJSCEM, w ktorym organizator tlumaczy, KOMU ta grupa
  // przysluguje - a uczestnik czyta go na ekranie wyboru. Pole, ktore nie
  // dojezdza do ladunku, kasuje to wyjasnienie przy kazdym zapisie grupy.
  it("nowy opis w obu jezykach dociera do zapisu", () => {
    renderuj();
    wypelnijPoprawnie();
    wpisz("descriptionPl", "  Goscie zaproszeni imiennie  ");
    wpisz("descriptionEn", "  Personally invited guests  ");
    zapisz();
    expect(h.submitted[0]).toMatchObject({
      descriptionPl: "Goscie zaproszeni imiennie",
      descriptionEn: "Personally invited guests",
    });
  });

  it("wyczyszczenie opisu dojezdza jako pustka, a nie jako stara tresc", () => {
    renderuj({ group: groupRow({ description_pl: "Stary opis", description_en: "Old text" }) });
    wpisz("descriptionPl", "");
    wpisz("descriptionEn", "");
    zapisz();
    expect(h.submitted[0]).toMatchObject({ descriptionPl: "", descriptionEn: "" });
  });

  it("opis wpisany w jednym jezyku nie nadpisuje drugiego", () => {
    renderuj({ group: groupRow({ description_pl: "Goscie honorowi", description_en: "VIP" }) });
    wpisz("descriptionPl", "Goscie honorowi 2026");
    zapisz();
    expect(h.submitted[0]).toMatchObject({
      descriptionPl: "Goscie honorowi 2026",
      descriptionEn: "VIP",
    });
  });
});

describe("wycofanie sie z szuflady - para „zapis wysyla / anulowanie nie wysyla”", () => {
  /** Wariant z podgladem `onOpenChange` - `renderuj` przekazuje tam pustke. */
  function renderujZZamknieciem(props: { isSaving?: boolean } = {}) {
    const zamkniecia: boolean[] = [];
    render(
      <EventGroupDialog
        open
        onOpenChange={(next) => zamkniecia.push(next)}
        eventId={EVENT_ID}
        group={groupRow()}
        nextSortOrder={30}
        isSaving={props.isSaving === true}
        onSubmit={(input) => h.submitted.push(input)}
      />,
    );
    return zamkniecia;
  }

  // ANULOWANIE MA ZAMKNAC SZUFLADE I NIE ZAPISAC NICZEGO. Gdyby wolalo zapis,
  // przypadkowa zmiana uprawnien grupy utrwalilaby sie mimo wycofania sie - a
  // ten formularz ustawia, kto kogo widzi i kto z kim rozmawia.
  it("anulowanie zamyka szuflade i NIE woła zapisu", () => {
    const zamkniecia = renderujZZamknieciem();
    fireEvent.click(screen.getByText(`${D}cancelAction`));
    expect(zamkniecia).toEqual([false]);
    expect(h.submitted).toEqual([]);
  });

  it("zapis woła warstwe zapisu i NIE zamyka szuflady sam z siebie", () => {
    const zamkniecia = renderujZZamknieciem();
    zapisz();
    expect(h.submitted).toHaveLength(1);
    expect(zamkniecia).toEqual([]);
  });

  it("trwajacy zapis gasi rowniez anulowanie - klikniecie nic nie zamyka", () => {
    const zamkniecia = renderujZZamknieciem({ isSaving: true });
    fireEvent.click(screen.getByText(`${D}cancelAction`));
    expect(zamkniecia).toEqual([]);
  });
});

describe("naglowek grupy bez nazwy w jezyku ekranu", () => {
  // NAGLOWEK JEST WIAZANY Z SZUFLADA PRZEZ `aria-labelledby`, wiec pusty tytul
  // to szuflada bez nazwy dla czytnika ekranu. Wiersze sprzed wymogu
  // `invalid_names` (obie nazwy obowiazkowe) nadal siedza w tabeli, wiec
  // molekula musi miec z czego wziac zapasowy napis.
  it("po polsku naglowek bierze nazwe angielska, gdy polskiej nie ma", () => {
    h.language = "pl";
    renderuj({ group: groupRow({ name_pl: "", name_en: "VIP guests" }) });
    expect(screen.getByRole("heading", { name: "VIP guests" })).toBeTruthy();
  });

  it("po angielsku naglowek bierze nazwe polska, gdy angielskiej nie ma", () => {
    h.language = "en";
    renderuj({ group: groupRow({ name_pl: "Goscie honorowi", name_en: "" }) });
    expect(screen.getByRole("heading", { name: "Goscie honorowi" })).toBeTruthy();
  });

  it("grupa bez zadnej nazwy dostaje tytul edycji, a nie pusty naglowek", () => {
    renderuj({ group: groupRow({ name_pl: "", name_en: "" }) });
    expect(screen.getByRole("heading", { name: `${D}editTitle` })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: `${D}createTitle` })).toBeNull();
  });
});

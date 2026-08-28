// Podstrony wydarzenia - MAPOWANIE strona -> menu wydarzenia (`event_pages`).
//
// NIE BUDUJEMY DRUGIEGO SILNIKA STRON. Trescia podstrony nadal jest wiersz
// `public.pages` (builder, SEO, okruszki, harmonogram publikacji, rewizje),
// a `event_pages` dokleda do niej WYLACZNIE to, czego menu wydarzenia
// potrzebuje, a `pages` dac nie moze: wlasna etykiete w dwoch jezykach, ikone,
// kolor, kolejnosc w TYM menu i widocznosc per grupa uczestnikow. Wlasny CRUD
// stron per wydarzenie oznaczalby drugie zrodlo prawdy dla SEO i rewizji - to
// jest ryzyko nr 1 projektu modulu
// (`docs/PROJEKT_MODUL_EVENT_BUILDER_2026-08-23.md` §0.1, §4.7, §9.1).
//
// RPC, NIE ZAPYTANIE TABELARYCZNE. Poprzednia wersja czytala `pages` wprost
// i dzielila liste po `menu_order`, czyli po kolumnie menu CALEGO serwisu -
// dwa menu na jednej kolumnie rozjezdzaja sie przy pierwszej zmianie kolejnosci
// w jednym z nich. Teraz kazda operacja ma swoja funkcje bazy, bo kazda z nich
// robi wiecej, niz widzi klient: lista dokleja sciezke publiczna z lancucha
// slugow rodzicow, zapis waliduje grupe wzgledem wydarzenia, kolejnosc
// przestawia sie JEDNYM zapisem, a „utworz strone" zaklada korzen, strone
// i przypiecie w jednej transakcji.
//
// KLUCZE POMINIETE (`undefined`) NIE WCHODZA DO PAYLOADU - ta sama konwencja,
// co w grupach i sponsorach. `null` znaczy „wyczysc" (ikona, kolor), brak
// klucza znaczy „nie ruszaj".
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import type { UiLang } from "@/lib/i18n/format";
import type { BuilderDocument } from "@/lib/builder/types";
import { parseBuilderDoc } from "@/lib/builder/parse";
import { toJson } from "@/lib/content-model/json";
import { eventPageTemplateDocument } from "@/lib/events/eventPageTemplates";

type Fns = Database["public"]["Functions"];

type EventPagesListRow = Fns["admin_event_pages_list"]["Returns"][number];

/**
 * PIEC ZAWSZE OBECNYCH STRON WYDARZENIA.
 *
 * Zbior jest przepisany JEDEN DO JEDNEGO z `event_pages_module_values`
 * (migracja `20260826181500_event_default_module_pages.sql`) i z kolejnoscia
 * z `_event_default_pages()`. Wartosci NIE SA napisami interfejsu - to
 * identyfikatory z bazy, wiec nie chodza przez slownik; napisy tych pozycji
 * bierze sie z tytulu strony (`eventPageLabel`), bo redakcja moze je zmienic.
 *
 * PO CO TO W KLIENCIE, JESLI BAZA JUZ PILNUJE ZBIORU. Panel musi ODROZNIC
 * pozycje modulowa od zwyklej, zeby nie pokazac przy niej akcji odpiecia,
 * ktorej baza i tak odmowi - a przycisk, ktory zawsze konczy sie bledem,
 * jest gorszy od braku przycisku.
 */
export const EVENT_PAGE_MODULES = [
  "participants",
  "speakers",
  "partners",
  "agenda",
  "discussions",
] as const;

export type EventPageModule = (typeof EVENT_PAGE_MODULES)[number];

/**
 * Znacznik z bazy -> znany modul albo `null`.
 *
 * ZWEZENIE NA GRANICY, NIE RZUTOWANIE. Wygenerowane typy opisuja `module` jako
 * `string`, bo w bazie to kolumna `text` z ograniczeniem `CHECK` - a `CHECK`
 * nie ma jak przejsc do typow. Nieznana wartosc czytamy jako `null`, czyli
 * „zwykla pozycja": pozycja z literowka w znaczniku ma sie zachowac jak zwykla
 * strona, a nie wysadzic caly ekran.
 */
export function eventPageModule(value: string | null | undefined): EventPageModule | null {
  if (value === null || value === undefined) return null;
  for (const module of EVENT_PAGE_MODULES) if (module === value) return module;
  return null;
}

/**
 * Kolumny, ktore lista oddaje NULL-em.
 *
 * Generowane typy `RETURNS TABLE` opisuja KAZDA kolumne jako non-null, a tutaj
 * to nieprawda dla pieciu z nich: lista pokazuje takze strony NIEPRZYPIETE
 * (`LEFT JOIN`, wiec `id IS NULL`), a etykieta, ikona i kolor sa opcjonalne
 * w samej tabeli. Zwezamy je tutaj, KLUCZAMI z wygenerowanego wiersza - nie
 * recznie przepisanym interfejsem, ktory rozjechalby sie przy pierwszej
 * migracji.
 */
type NullableListColumn = "id" | "menu_label_pl" | "menu_label_en" | "icon" | "color";

export type EventPageRow = Omit<EventPagesListRow, NullableListColumn | "module"> & {
  [K in NullableListColumn]: EventPagesListRow[K] | null;
} & {
  /**
   * Znacznik jednej z pieciu pozycji modulowych; `null` = zwykla pozycja menu.
   *
   * Typ jest WEZSZY od wygenerowanego (`string`), bo `fetchEventPages` zweza
   * go na granicy przez `eventPageModule` - patrz komentarz tamtej funkcji.
   */
  module: EventPageModule | null;
};

/** Wiersz listy PRZYPIETY do menu wydarzenia - ma identyfikator mapowania. */
export type AttachedEventPageRow = EventPageRow & { id: string };

/**
 * Wiersz jednej z pieciu pozycji zawsze obecnych.
 *
 * Zawsze jest PRZYPIETY: znacznik nadaje wylacznie zasiew, razem z wierszem
 * `event_pages` - pozycji modulowej bez mapowania nie ma jak powstac.
 */
export type ModuleEventPageRow = AttachedEventPageRow & { module: EventPageModule };

/** Strona-korzen wydarzenia. Poza lista podstron, wiec poza `event_pages`. */
export type EventRootPageRow = Pick<
  Database["public"]["Tables"]["pages"]["Row"],
  "id" | "slug" | "title_pl" | "title_en" | "status"
>;

/** `event_pages_icon_check` z migracji, jeden do jednego. */
export const EVENT_PAGE_ICON_PATTERN = /^[a-z0-9-]{1,48}$/;

/** `event_pages_color_check` z migracji, jeden do jednego. */
export const EVENT_PAGE_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/**
 * Ikona pozycji bez wlasnej ikony.
 *
 * JEDNA STALA NA PANEL I PODGLAD: gdyby wiersz listy rysowal inna ikone niz
 * podglad obok niego, redaktor czytalby to jako blad podgladu, a nie jako brak
 * wlasnej ikony.
 */
export const EVENT_PAGE_DEFAULT_ICON = "file-text";

/** Odstep miedzy kolejnymi pozycjami - ten sam, co w `admin_event_page_create`. */
const SORT_ORDER_STEP = 10;

type PayloadInput = Record<string, Json | undefined>;

function payload(input: PayloadInput): Json {
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Json;
}

/* ------------------------------------------------------------------ odczyt --- */

/**
 * Podstrony wydarzenia: przypiete oraz nieprzypiete z poddrzewa korzenia.
 *
 * TO WOLANIE MA SKUTEK UBOCZNY W BAZIE. `admin_event_pages_list` DOSIEWA
 * brakujace strony modulowe na wejsciu (migracja 20260826181500, krok 4b), bo
 * dla wydarzen sprzed tej migracji nie ma backfillu, a strona skasowana
 * w `/admin/pages` zabiera pozycje menu razem z soba (`ON DELETE CASCADE`).
 * Pierwsze wejscie na ekran zwraca wiec liste, ktorej chwile wczesniej nie
 * bylo - i to jest poprawne zachowanie, nie wyscig.
 *
 * PUSTA LISTA PRZESTALA BYC STANEM ZWYKLYM. Po zasiewie kazde istniejace
 * wydarzenie ma co najmniej piec pozycji, wiec zero wierszy znaczy albo
 * wydarzenie skasowane w innej karcie, albo awarie - i ekran ma o tym mowic
 * inaczej niz „utworz pierwsza strone".
 */
export async function fetchEventPages(eventId: string): Promise<EventPageRow[]> {
  const { data, error } = await supabase.rpc("admin_event_pages_list", { p_event_id: eventId });
  if (error) throw new Error(error.message);
  // Zwezenie `module` z `string` do znanego zbioru robi sie TUTAJ, raz, na
  // granicy sieci - nie w kazdym miejscu, ktore czyta wiersz.
  return (data ?? []).map((row) => ({ ...row, module: eventPageModule(row.module) }));
}

/**
 * Strona-korzen wydarzenia albo `null`.
 *
 * Czytamy ja WYLACZNIE dla slugu: edytor stron adresuje strone slugiem,
 * a `events.root_page_id` trzyma identyfikator. Korzen nie jest pozycja menu,
 * wiec nie ma go na liscie podstron.
 */
export async function fetchEventRootPage(
  rootPageId: string | null,
): Promise<EventRootPageRow | null> {
  if (rootPageId === null || rootPageId === "") return null;
  const { data, error } = await supabase
    .from("pages")
    .select("id, slug, title_pl, title_en, status")
    .eq("id", rootPageId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/* -------------------------------------------------------------------- zapis --- */

export interface EventPageInput {
  /** Podany = edycja istniejacego mapowania. */
  id?: string;
  /** Wymagane przy PRZYPIECIU (razem z `pageId`). */
  eventId?: string;
  pageId?: string;
  menuLabelPl?: string;
  menuLabelEn?: string;
  /** `null` = bez wlasnej ikony. */
  icon?: string | null;
  /** `null` = kolor z brandingu wydarzenia. */
  color?: string | null;
  inMenu?: boolean;
  sortOrder?: number;
  /** Pusta tablica = widoczne dla wszystkich, takze dla gosci. */
  visibleToGroups?: readonly string[];
}

/** Przypina strone do menu wydarzenia albo zmienia wyglad istniejacej pozycji. */
export async function saveEventPage(input: EventPageInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_page_upsert", {
    p_payload: payload({
      id: input.id,
      event_id: input.eventId,
      page_id: input.pageId,
      menu_label_pl: input.menuLabelPl,
      menu_label_en: input.menuLabelEn,
      icon: input.icon,
      color: input.color,
      in_menu: input.inMenu,
      sort_order: input.sortOrder,
      visible_to_groups:
        input.visibleToGroups === undefined ? undefined : [...input.visibleToGroups],
    }),
  });
  if (error) throw new Error(error.message);
  return String(data);
}

/**
 * Odpina strone od menu wydarzenia.
 *
 * TRESC ZOSTAJE. Wiersz `pages` z historia, SEO i harmonogramem publikacji
 * nalezy do `/admin/pages` - pomylkowe odpiecie kosztuje jedno klikniecie,
 * pomylkowe usuniecie strony kosztuje tresc.
 */
export async function detachEventPage(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_event_page_detach", { p_id: id });
  if (error) throw new Error(error.message);
  return data === true;
}

/**
 * Ustawia kolejnosc pozycji menu - kolejnosc tablicy jest kolejnoscia w menu.
 *
 * JEDEN ZAPIS NA CALA LISTE: przeniesienie jednej pozycji zmienia kilka
 * `sort_order` naraz, a seria osobnych zapisow zostawia menu w stanie
 * posrednim, gdy ktorys z nich padnie.
 */
export async function reorderEventPages(eventId: string, ids: readonly string[]): Promise<number> {
  const { data, error } = await supabase.rpc("admin_event_pages_reorder", {
    p_event_id: eventId,
    p_ids: [...ids],
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export interface EventPageCreateInput {
  eventId: string;
  titlePl: string;
  titleEn: string;
  icon?: string;
  inMenu?: boolean;
  /**
   * Szablon ukladu strony.
   *
   * NIEZNANY IDENTYFIKATOR NIE JEST BLEDEM TUTAJ, tylko brakiem szablonu:
   * `eventPageTemplateDocument` oddaje wtedy `null`, a RPC zaklada pusta strone
   * robocza - dokladnie tak, jak przed wprowadzeniem szablonow. Blad zglasza
   * baza tylko wtedy, gdy dokument JEST, ale ma zly kształt.
   */
  templateId?: string | null;
}

/**
 * Zaklada podstrone wydarzenia i od razu ja przypina.
 *
 * JEDNO WOLANIE, TRZY SKUTKI (korzen, strona, przypiecie) - bo rozbite na trzy
 * kroki w interfejsie daloby stan, w ktorym strona istnieje, ale nie nalezy do
 * zadnego wydarzenia. Zwraca identyfikator POZYCJI MENU, nie strony.
 *
 * SZABLON JEDZIE W TEJ SAMEJ TRANSAKCJI. Doklejenie tresci osobnym zapisem po
 * utworzeniu zostawialoby przy bledzie sieci strone pusta - a redaktor widzialby
 * pozycje w menu, ktora niczego nie pokazuje.
 */
export async function createEventPage(input: EventPageCreateInput): Promise<string> {
  const document = eventPageTemplateDocument(input.templateId);
  const { data, error } = await supabase.rpc("admin_event_page_create", {
    p_payload: payload({
      event_id: input.eventId,
      title_pl: input.titlePl,
      title_en: input.titleEn,
      icon: input.icon,
      in_menu: input.inMenu,
      // `toJson` zamiast rzutowania: bramka `check:unknown-casts` trzyma JEDNO
      // usankcjonowane `as unknown as Json` w `lib/content-model/json.ts`, zeby
      // nie bylo ich rozsianych po repozytorium. Ten sam helper serializuje
      // `builder_data` w `lib/wp-import/localizedMerge.ts`.
      builder_data: document === null ? undefined : toJson(document),
    }),
  });
  if (error) throw new Error(error.message);
  return String(data);
}

/**
 * Dokument buildera podstrony - zrodlo podgladu tresci w studiu.
 *
 * CZYTAMY `pages` WPROST, bo to jedna kolumna jednego wiersza, do ktorego
 * redaktor ma dostep tymi samymi regulami, co w `/admin/pages`. Wlasny RPC
 * dublowalby te reguly bez zadnego zysku.
 */
export async function fetchEventPageDocument(pageId: string): Promise<BuilderDocument | null> {
  const { data, error } = await supabase
    .from("pages")
    .select("builder_data")
    .eq("id", pageId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const raw = data?.builder_data ?? null;
  // PUSTA STRONA ODDAJE `null`, nie pusty dokument: podglad ma wtedy powiedziec
  // „ta strona nie ma jeszcze tresci", a nie narysowac pusta kanwe bez slowa.
  if (raw === null) return null;
  const doc = parseBuilderDoc(raw);
  return doc.sections.length === 0 ? null : doc;
}

/* ------------------------------------------------------------ czysta czesc --- */

/** Czy wiersz ma mapowanie, czyli czy nalezy do wydarzenia. */
export function isEventPageAttached(row: EventPageRow): row is AttachedEventPageRow {
  return row.id !== null && row.id !== "";
}

/**
 * Czy wiersz jest jedna z pieciu pozycji zawsze obecnych.
 *
 * WARUNEK JEST PODWOJNY, i to nie jest ostroznosc na zapas: `id` bierze sie
 * z `LEFT JOIN`-a, wiec typ dopuszcza `null` takze tam, gdzie znacznik jest
 * ustawiony. Bez sprawdzenia mapowania interfejs dostalby wiersz, ktorego nie
 * ma jak zapisac (`admin_event_page_upsert` adresuje pozycje przez `id`).
 */
export function isModuleEventPage(row: EventPageRow): row is ModuleEventPageRow {
  return row.module !== null && isEventPageAttached(row);
}

/**
 * Wejscie zapisu odtwarzajace CALY wiersz, ze zmiana nalozona na wierzch.
 *
 * ZAPIS NADPISUJE KAZDE POLE, TAKZE POMINIETE. `admin_event_page_upsert` ma
 * `ON CONFLICT DO UPDATE SET … = EXCLUDED.…` dla wszystkich kolumn, a klucz
 * nieobecny w payloadzie czyta jako pusty - wiec „przelacz obecnosc w menu"
 * wyslane samo skasowaloby pozycji ikone, kolor, etykiety i widocznosc per
 * grupa. Kazda zmiana jednego pola wysyla wiec pelny wiersz.
 *
 * `module` JEST JEDYNYM POLEM, KTOREGO TU NIE MA - i to jest cala tresc kroku 6
 * migracji 20260826181500. Znacznik nadaje WYLACZNIE zasiew, a RPC trzyma go
 * poza lista `DO UPDATE SET`; gdyby wszedl na te liste albo do tego payloadu,
 * pierwsze przelaczenie „w menu / poza menu" wyczyscilo by go i pozycja
 * przestalaby byc modulowa.
 */
export function eventPageInput(
  entry: AttachedEventPageRow,
  changes: Partial<EventPageInput> = {},
): EventPageInput {
  return {
    id: entry.id,
    menuLabelPl: entry.menu_label_pl ?? "",
    menuLabelEn: entry.menu_label_en ?? "",
    icon: entry.icon,
    color: entry.color,
    inMenu: entry.in_menu,
    sortOrder: entry.sort_order,
    visibleToGroups: entry.visible_to_groups,
    ...changes,
  };
}

/**
 * Podzial na „Strony w menu" i „Pozostale strony".
 *
 * TRZY STANY, DWIE ZAKLADKI. Wiersz listy jest w jednym z trzech stanow:
 * przypiety i w menu (`id !== null && in_menu`), przypiety poza menu
 * (`id !== null && !in_menu`) albo NIEPRZYPIETY (`id === null` - strona lezy
 * w poddrzewie korzenia, ale nie ma wiersza `event_pages`). W menu siedzi
 * wylacznie pierwszy stan; dwa pozostale ida do „Pozostalych", bo z punktu
 * widzenia menu znacza to samo - uczestnik ich tam nie zobaczy.
 *
 * INTERFEJS MUSI JE ODROZNIC, i to jest jedyny powod, dla ktorego `menu` ma
 * wezszy typ: pozycje przypieta sie ODPINA (jest co odpiac), a nieprzypieta
 * PRZYPINA. Ta sama akcja na obu stanach usunelaby komus ikone i widocznosc
 * przy proznym klikniecu „poza menu".
 *
 * KOLEJNOSC WEJSCIA ZOSTAJE. Lista przychodzi posortowana przez baze
 * (`in_menu` malejaco, potem `sort_order`, potem tytul), wiec podzial nie ma
 * prawa jej przestawic - inaczej menu w panelu rozjezdza sie z menu publicznym.
 */
export function splitEventPages(rows: readonly EventPageRow[]): {
  menu: AttachedEventPageRow[];
  other: EventPageRow[];
} {
  const menu: AttachedEventPageRow[] = [];
  const other: EventPageRow[] = [];
  for (const row of rows) {
    if (isEventPageAttached(row) && row.in_menu) menu.push(row);
    else other.push(row);
  }
  return { menu, other };
}

/**
 * Etykieta pozycji w jezyku interfejsu.
 *
 * WLASNA ETYKIETA WYGRYWA, TYTUL STRONY JEST ZAPASEM - dokladnie tak, jak
 * liczy to `event_menu` na powierzchni publicznej: w menu mieszcza sie dwa
 * slowa, a tytul strony bywa zdaniem („Program kongresu dzien pierwszy").
 *
 * ZAPAS SIEGA DO DRUGIEGO JEZYKA na samym koncu. Wiersz bez tytulu w jezyku
 * interfejsu istnieje (tlumaczenie dopisuje sie pozniej), a pusta etykieta
 * w liscie jest wierszem, ktorego nie da sie kliknac swiadomie.
 */
export function eventPageLabel(row: EventPageRow, lang: UiLang): string {
  const candidates =
    lang === "en"
      ? [row.menu_label_en, row.title_en, row.menu_label_pl, row.title_pl]
      : [row.menu_label_pl, row.title_pl, row.menu_label_en, row.title_en];
  for (const candidate of candidates) {
    const text = (candidate ?? "").trim();
    if (text !== "") return text;
  }
  return "";
}

/**
 * Pozycja menu w kszalcie, w ktorym czyta ja PODGLAD STRONY WYDARZENIA.
 *
 * KSZTALT MIESZKA W LIB, A NIE W KONTEKSCIE PODGLADU, bo ma DWOCH producentow:
 * rame studia (stan zapisany, `base`) i ekran „Strony i menu" (szkic
 * przelacznika trybu). Dwa niezalezne mapowania jednej listy to dokladnie ten
 * defekt, z ktorym walczy `EventOverviewLayout` - tylko o warstwe nizej.
 */
export interface EventMenuDraftItem {
  /** `event_pages.id` - pozycja aktywna poznaje sie po IDENTYFIKATORZE, nie po etykiecie. */
  key: string;
  /**
   * `pages.id` STRONY pod pozycja menu.
   *
   * PO CO OSOBNO OD `key`: podglad, ktory ma zachowywac sie jak publikacja,
   * musi po kliknieciu pozycji POBRAC DOKUMENT strony - a dokument wisi na
   * stronie, nie na pozycji menu. Bez tego pola nakladka musialaby odtwarzac
   * mapowanie z listy stron drugi raz.
   */
  pageId: string;
  /** Pelna sciezka publiczna strony - podglad pokazuje ja jako chrome adresu. */
  path: string;
  label: string;
  /** Nazwa ikony; nigdy pusta - brak wlasnej degraduje do `EVENT_PAGE_DEFAULT_ICON`. */
  icon: string;
  /** `#RRGGBB` albo pusty napis = krazek z motywu. */
  color: string;
  /**
   * Znacznik pozycji modulowej (`event_pages.module`); `null` = zwykla strona.
   *
   * PO CO W PODGLADZIE: podstrona modulowa niesie tresc, ktorej NIE MA
   * w dokumencie CMS - program, prelegentow i uczestnikow sklada baza. Bez tego
   * pola podglad musialby zgadywac po sciezce (`/agenda`), czyli po napisie,
   * ktory organizator moze zmienic.
   */
  module: EventPageModule | null;
}



/**
 * Lista podstron -> pozycje menu podgladu, w kolejnosci z bazy.
 *
 * WCHODZI CALA LISTA, NIE JUZ PODZIELONA: podzial na „w menu" i „pozostale" jest
 * czescia tej samej reguly (`splitEventPages`), a wolajacy, ktory podzieli po
 * swojemu, moze wpuscic do menu pozycje z `in_menu = false`.
 *
 * KOLEJNOSCI NIE PRZESTAWIAMY. Lista przychodzi posortowana przez RPC
 * (`in_menu` malejaco, potem `sort_order`, potem tytul), a `event_menu` na
 * stronie publicznej sortuje tak samo - wlasne sortowanie tutaj rozjechaloby
 * podglad z publikacja.
 */
export function eventPreviewMenu(
  rows: readonly EventPageRow[],
  lang: UiLang,
): EventMenuDraftItem[] {
  return splitEventPages(rows).menu.map((entry) => ({
    key: entry.id,
    pageId: entry.page_id,
    path: entry.page_path,
    label: eventPageLabel(entry, lang),
    icon: entry.icon ?? EVENT_PAGE_DEFAULT_ICON,
    color: entry.color ?? "",
    module: entry.module,
  }));

}

/** Kolejnosc dla pozycji dokladanej na koniec menu. */
export function nextEventPageSortOrder(menu: readonly EventPageRow[]): number {
  let max = 0;
  for (const row of menu) if (row.sort_order > max) max = row.sort_order;
  return max + SORT_ORDER_STEP;
}

/**
 * Kolejnosc po przesunieciu pozycji o jedno miejsce.
 *
 * ZAMIANA SASIADAMI, nie „wstaw gdziekolwiek": przyciski w gore i w dol sa
 * jedynym sposobem przestawiania listy, wiec ich skutek musi byc odwracalny
 * jednym klikniecem w przeciwna strone. Ruch poza zakres oddaje TE SAMA
 * tablice - wolajacy pozna po tozsamosci, ze nie ma czego zapisywac.
 */
export function moveEventPage(
  ids: readonly string[],
  id: string,
  direction: -1 | 1,
): readonly string[] {
  const from = ids.indexOf(id);
  if (from === -1) return ids;
  const to = from + direction;
  if (to < 0 || to >= ids.length) return ids;
  const out = [...ids];
  out[from] = ids[to];
  out[to] = id;
  return out;
}

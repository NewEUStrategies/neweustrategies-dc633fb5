// BRAMKA: każdy klucz, który pięć map odmów potrafi ZWRÓCIĆ, musi istnieć w
// nakładce i18n - w OBU językach.
//
// DLACZEGO TO JEST BRAMKA, A NIE ZWYKŁY TEST. Klucz błędu podróżuje w GŁOWIE
// komunikatu plpgsql, więc jedyne, co spina SQL ze słownikiem, to NAZWA -
// zapisana w dwóch niezależnych plikach, których nic ze sobą nie sprawdza.
// Nowy `RAISE EXCEPTION` w migracji przechodzi `tsc`, przechodzi przegląd i
// przechodzi parytet PL/EN (klucza nie ma w ŻADNYM z języków, więc parytet go
// nie widzi). Widać go dopiero na ekranie: albo surową kropkowaną ścieżką
// (`i18n.t()` na nieznanym kluczu oddaje sam klucz), albo zdaniem awaryjnym,
// z którego organizator nie dowie się, co poprawić.
//
// TECHNIKA JEST TA SAMA, CO W `adminAgendaErrors.test.ts` i `adminSponsorErrors
// .test.ts`: lista kodów w postaci z SQL-a, przepuszczona przez PRAWDZIWY mapper
// (nie przez własną kopię `camel()`), a obecność klucza czytana z EKSPORTOWANEGO
// słownika nakładki. Dzięki przejściu przez mapper bramka pilnuje obu połów
// kontraktu naraz: i tego, że kod jest rozpoznawany, i tego, że klucz ma tekst.
//
// STRONA EN CZYTANA JEST Z EKSPORTU, NIE PRZEZ `i18n.exists(klucz, { lng: "en" })`.
// Instancja i18next ma `fallbackLng: "pl"`, więc `exists()` odpowiada „tak" na
// klucz obecny WYŁĄCZNIE po polsku - ZMIERZONE na tym HEAD: klucz dopisany
// tylko do bundla „pl" daje `exists(..., { lng: "en" }) === true`. Sprawdzenie
// EN tą drogą byłoby więc puste, a bramka mierzyłaby dwa razy to samo.
// `readKey(<nakladka>En, klucz)` patrzy DOKŁADNIE w plik, w którym klucz ma
// stać, i dlatego łapie też klucz obecny w innej nakładce albo w rdzeniu.
//
// SKĄD LISTY KODÓW. Z `RAISE EXCEPTION '<kod>: …'` w funkcjach, które WOŁA
// warstwa `src/lib/events/*Api.ts` danego modułu. Kody funkcji, których żaden
// klient nie woła, świadomie tu nie stoją - patrz komentarz przy rejestracjach.
//
// LISTY SĄ RĘCZNE, ALE NIE SĄ NA WIARĘ. Przypadek „ręczna lista kodów nadąża za
// migracjami" konfrontuje każdą z nich ze skanem drzewa `supabase/migrations`
// (`src/test/events/pgRaiseCodes.ts`), więc kod dopisany w nowej migracji
// czerwieni bramkę od razu, zamiast czekać, aż ktoś zajrzy do listy.
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { readKey, type ResourceTree } from "@/lib/ci/i18nParity";
import { scanRaiseCodes } from "@/test/events/pgRaiseCodes";
import { adminRegistrationFailure } from "@/lib/events/adminRegistrationErrors";
import { adminTermsFailure } from "@/lib/events/adminTermsErrors";
import { adminOnsiteFailure } from "@/lib/events/adminOnsiteErrors";
import { publicEventErrorKey } from "@/lib/events/publicEventErrors";
import { adminEventStudioErrorKey } from "@/lib/events/adminEventStudioErrors";
import {
  adminEventRegistrationEn,
  adminEventRegistrationPl,
} from "@/lib/i18n-admin-event-registration";
import { adminEventTermsEn, adminEventTermsPl } from "@/lib/i18n-admin-event-terms";
import { adminEventOnsiteEn, adminEventOnsitePl } from "@/lib/i18n-admin-event-onsite";
import { eventFrontEn, eventFrontPl } from "@/lib/i18n-event-front";
import { adminEventsEn, adminEventsPl } from "@/lib/i18n-admin-events";

/** Klucz ma tekst, gdy w słowniku stoi pod nim NIEPUSTY napis (nie gałąź). */
function maTekst(slownik: ResourceTree, klucz: string): boolean {
  const wartosc = readKey(slownik, klucz);
  return typeof wartosc === "string" && wartosc.trim() !== "";
}

/**
 * `assert_event_admin_tenant()` / `assert_event_staff_tenant()` podnoszą
 * `forbidden` PRZED ciałem każdej funkcji administracyjnej modułu, więc ten kod
 * dociera do każdej z map panelu.
 */
const STRAZNIK_TENANTA = "forbidden";

/** Zapisy, bilety, pakiety, stawki - `registrationsApi`, `packagesApi`, `audienceGrantsApi`. */
const KODY_REJESTRACJI = [
  // admin_event_registration_decide / _upsert / _mark_notified, admin_event_waitlist_promote
  "already_registered",
  "invalid_action",
  "invalid_request",
  "invalid_transition",
  "no_seats_left",
  "not_found",
  "reason_required",
  "invalid_answers",
  "invalid_name",
  "invalid_status",
  // admin_event_registration_field_upsert
  "invalid_consent_url",
  "invalid_key",
  "invalid_labels",
  "invalid_options",
  // admin_event_ticket_upsert / _delete
  "invalid_access_code",
  "invalid_benefits",
  "invalid_early_bird",
  "invalid_names",
  "invalid_price_schedule",
  "quota_below_sold",
  "ticket_in_use",
  // admin_event_package_upsert / _delete / _order_create / _order_set_status
  "package_in_use",
  "package_sold_out",
  "invalid_email",
  // admin_event_package_seat_invite / _revoke
  "order_cancelled",
  "seat_revoked",
  "seat_taken",
  // admin_event_audience_grant_save / _revoke (ekran „stawki i uprawnienia")
  "invalid_audience",
  "invalid_evidence",
  "invalid_subject",
  STRAZNIK_TENANTA,
] as const;

/** Grupy i zgody - `termsGroupsApi`. */
const KODY_GRUP_I_ZGOD = [
  // admin_event_group_upsert / _delete / _member_set
  "invalid_key",
  "invalid_names",
  "invalid_request",
  "not_found",
  "group_in_use",
  "group_system",
  // admin_event_term_upsert / _delete
  "invalid_labels",
  "term_in_use",
  STRAZNIK_TENANTA,
] as const;

/** Punkty kontrolne, odprawa, urządzenia i identyfikatory - `onsiteApi`. */
const KODY_ONSITE = [
  // admin_event_checkpoint_save / _delete
  "invalid_kind",
  "invalid_names",
  "invalid_payload",
  "not_found",
  "room_not_in_event",
  "session_not_in_event",
  "session_required",
  "sponsor_not_in_event",
  "sponsor_required",
  "checkpoint_has_devices",
  "checkpoint_in_use",
  // admin_event_scanner_device_issue / _revoke / _set_active
  "checkpoint_not_in_event",
  "invalid_expiry",
  "invalid_label",
  "invalid_scopes",
  "device_revoked",
  // admin_event_checkin_search / _manual (przez `_event_checkin_write`)
  "query_too_short",
  "invalid_source",
  "person_not_found",
  "checkpoint_not_found",
  "invalid_direction",
  // admin_event_badge_template_save / _delete
  "custom_dimensions_required",
  "invalid_background_color",
  "invalid_background_url",
  "invalid_dimensions",
  "invalid_name",
  "invalid_orientation",
  "invalid_paper_format",
  "invalid_qr_size",
  "too_many_elements",
  "template_in_use",
  // admin_event_badge_print / _badge_sheet - odmowy PODNOSZONE W FUNKCJI
  // POMOCNICZEJ wydruku, nie w ciele RPC. Do listy dopisane po tym, jak skan
  // migracji (przypadek „ręczna lista nadąża za migracjami" niżej) pokazał je
  // jako kody osiągalne z `onsiteApi`, których bramka nie mierzyła.
  "template_missing",
  "template_not_in_event",
  // walidacja POJEDYNCZEGO bloku układu identyfikatora
  "invalid_element",
  "invalid_element_align",
  "invalid_element_field",
  "invalid_element_font_size",
  "invalid_element_kind",
  "invalid_element_text",
  "invalid_element_url",
  "invalid_element_width",
  STRAZNIK_TENANTA,
] as const;

/** Powierzchnia uczestnika - `publicEventApi` (agenda, zakładki, lista osób). */
const KODY_UCZESTNIKA = [
  // event_session_signup
  "forbidden",
  "invalid_payload",
  "invalid_status",
  "not_found",
  "overlap_conflict",
  "signup_disabled",
  "tier_required",
  // event_bookmark_toggle / event_bookmarks_mine / event_attendees
  "auth_required",
  "invalid_scope",
  // event_meeting_directory_visibility_set
  "requester_not_participating",
] as const;

/** Studio wydarzenia - `eventDetailApi`, `eventPagesApi`. */
const KODY_STUDIA = [
  // admin_event_general_save
  "cover_required",
  "external_url_invalid",
  "external_url_required",
  "invalid_capacity",
  "invalid_currency",
  "invalid_ends_at",
  "invalid_event",
  "invalid_format",
  "invalid_guest_mode",
  "invalid_hashtag",
  "invalid_join_url",
  "invalid_languages",
  "invalid_price",
  "invalid_recording_url",
  "invalid_registration_flow",
  "invalid_registration_mode",
  "invalid_slug",
  "invalid_starts_at",
  "invalid_support_email",
  "invalid_tier_rank",
  "invalid_titles",
  "invalid_video_platform",
  "invalid_visibility",
  "not_found",
  "slug_taken",
  // admin_event_set_status
  "invalid_status",
  // admin_event_branding_save
  "invalid_appearance",
  "invalid_color",
  "invalid_image",
  // admin_event_page_upsert / _detach / _create
  "invalid_group",
  "invalid_icon",
  "invalid_page",
  "module_page",
  "invalid_builder_data",
  // admin_event_features_save
  "invalid_feature",
  STRAZNIK_TENANTA,
] as const;

interface BramkowanaMapa {
  nazwa: string;
  prefix: string;
  klucz: (error: unknown) => string;
  kody: readonly string[];
  /** Nakładka, w której klucze tego modułu muszą stać. */
  nakladka: string;
  pl: ResourceTree;
  en: ResourceTree;
  /**
   * Moduły `src/lib/events/<nazwa>.ts`, których ekrany czytają tę mapę. Z nich
   * skan bierze nazwy `supabase.rpc("…")` i schodzi do ciał funkcji w SQL-u.
   */
  moduly: readonly string[];
  /**
   * Czy mapa przekazuje parametry do `i18n.t()`. Trzy mapy panelu wyciągają
   * liczby z ogona komunikatu; studio i powierzchnia uczestnika wołają `t()`
   * z SAMYM kluczem - i dlatego ich zdania nie mogą mieć miejsc interpolacji.
   */
  interpoluje: boolean;
}

const MAPY: readonly BramkowanaMapa[] = [
  {
    nazwa: "adminRegistrationErrors",
    prefix: "adminEventRegistration.errors.",
    klucz: (error) => adminRegistrationFailure(error).key,
    kody: KODY_REJESTRACJI,
    nakladka: "src/lib/i18n-admin-event-registration.ts",
    pl: adminEventRegistrationPl,
    en: adminEventRegistrationEn,
    moduly: ["registrationsApi", "packagesApi", "audienceGrantsApi"],
    interpoluje: true,
  },
  {
    nazwa: "adminTermsErrors",
    prefix: "adminEventTerms.errors.",
    klucz: (error) => adminTermsFailure(error).key,
    kody: KODY_GRUP_I_ZGOD,
    nakladka: "src/lib/i18n-admin-event-terms.ts",
    pl: adminEventTermsPl,
    en: adminEventTermsEn,
    moduly: ["termsGroupsApi"],
    interpoluje: true,
  },
  {
    nazwa: "adminOnsiteErrors",
    prefix: "adminEventOnsite.errors.",
    klucz: (error) => adminOnsiteFailure(error).key,
    kody: KODY_ONSITE,
    nakladka: "src/lib/i18n-admin-event-onsite.ts",
    pl: adminEventOnsitePl,
    en: adminEventOnsiteEn,
    moduly: ["onsiteApi"],
    interpoluje: true,
  },
  {
    nazwa: "publicEventErrors",
    prefix: "eventFront.errors.",
    klucz: publicEventErrorKey,
    kody: KODY_UCZESTNIKA,
    nakladka: "src/lib/i18n-event-front.ts",
    pl: eventFrontPl,
    en: eventFrontEn,
    moduly: ["publicEventApi"],
    interpoluje: false,
  },
  {
    nazwa: "adminEventStudioErrors",
    prefix: "adminEvents.studio.errors.",
    klucz: adminEventStudioErrorKey,
    kody: KODY_STUDIA,
    nakladka: "src/lib/i18n-admin-events.ts",
    pl: adminEventsPl,
    en: adminEventsEn,
    moduly: ["eventDetailApi", "eventPagesApi"],
    interpoluje: false,
  },
];

describe.each(MAPY)("bramka kluczy i18n: $nazwa", (mapa) => {
  const awaryjny = `${mapa.prefix}unknown`;
  const klucze = mapa.kody.map((kod) => ({ kod, klucz: mapa.klucz(new Error(`${kod}: detail`)) }));

  it("bramka mierzy niepustą listę kluczy", () => {
    // Bez tego przypadku pomyłka w budowie listy (pusta tablica, zły filtr)
    // dawałaby ZIELONĄ bramkę mierzącą pustkę - najgorszy możliwy wynik, bo
    // wygląda jak dowód.
    expect(klucze.length).toBeGreaterThan(0);
    expect(new Set(mapa.kody).size).toBe(mapa.kody.length);
  });

  it("żaden kod z migracji nie degraduje do zdania awaryjnego", () => {
    // Degradacja znaczy albo brak wpisu w nakładce, albo literówkę w kodzie
    // SQL-a. Jedno i drugie kończy się komunikatem bez powodu odmowy.
    const zdegradowane = klucze.filter((wpis) => wpis.klucz === awaryjny).map((wpis) => wpis.kod);
    expect(zdegradowane, `dopisz je w ${mapa.nakladka}`).toEqual([]);
  });

  it.each(klucze)("klucz $klucz stoi w nakładce po polsku i po angielsku", ({ klucz }) => {
    // `i18n.t()` na nieznanym kluczu oddaje SAM KLUCZ, a nie pusty napis - brak
    // wpisu w jednym języku pokazuje kropkowaną ścieżkę tylko części
    // użytkowników i dlatego potrafi przeżyć w produkcji miesiącami.
    expect(maTekst(mapa.pl, klucz), `brak PL: ${klucz} (${mapa.nakladka})`).toBe(true);
    expect(maTekst(mapa.en, klucz), `brak EN: ${klucz} (${mapa.nakladka})`).toBe(true);
  });

  it("zdanie awaryjne modułu też stoi w nakładce w obu językach", () => {
    // Klucz, do którego spada KAŻDA nierozpoznana odmowa. Jego brak zamienia
    // każdy nieznany błąd w surową ścieżkę i18n - w tym miejscu byłby to
    // pojedynczy punkt awarii całej mapy.
    expect(maTekst(mapa.pl, awaryjny), `brak PL: ${awaryjny}`).toBe(true);
    expect(maTekst(mapa.en, awaryjny), `brak EN: ${awaryjny}`).toBe(true);
    expect(i18n.t(awaryjny)).not.toContain(mapa.prefix);
  });

  it("ręczna lista kodów nadąża za migracjami", () => {
    // LISTA WYŻEJ JEST PRZEPISANA RĘCZNIE, a więc starzeje się po cichu: nowy
    // `RAISE EXCEPTION` w migracji nie dopisuje się do niej sam, przechodzi
    // `tsc`, przechodzi lint i przechodzi parytet PL/EN (klucza nie ma w ŻADNYM
    // języku, więc parytet go nie widzi). Cała reszta tej bramki byłaby wtedy
    // ZIELONA, bo mierzyłaby wyłącznie kody, o których ktoś pamiętał.
    //
    // Dlatego listę konfrontujemy z drzewem `supabase/migrations`: skan bierze
    // nazwy `supabase.rpc("…")` z modułów klienckich tej mapy i schodzi w ciała
    // funkcji razem z ich wywołaniami (`assert_event_admin_tenant()` podnosi
    // `forbidden` przed ciałem każdej funkcji panelu, a odprawę zapisuje
    // `_event_checkin_write()` - bez domknięcia po wywołaniach nie byłoby
    // widać ani strażnika tenanta, ani połowy kodów odprawy).
    //
    // ZMIERZONE: to sprawdzenie znalazło `template_missing`
    // i `template_not_in_event`, których lista on-site nie miała.
    const skan = scanRaiseCodes(mapa.moduly);
    expect(skan.missingFunctions, "RPC bez definicji w migracjach").toEqual([]);
    // Pusty skan (zła ścieżka, zmieniony kształt `rpc("…")`) wyglądałby jak
    // „moduł bez odmów", czyli jak sukces - stąd dolne ograniczenie.
    expect(skan.functions.length).toBeGreaterThan(0);
    expect(skan.codes.length).toBeGreaterThan(0);
    const nieobjete = skan.codes.filter((kod) => !mapa.kody.includes(kod));
    expect(nieobjete, `dopisz je do listy tej mapy i do ${mapa.nakladka}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// MAPY, KTÓRE WOŁAJĄ `i18n.t()` BEZ PARAMETRÓW.
//
// Studio wydarzenia i powierzchnia uczestnika nie czytają liczb z ogona - nie
// mają `paramsOf()`. Miejsce interpolacji w ICH słowniku nie ma więc czym się
// wypełnić i pokaże się na ekranie jako surowe wąsy. Żadna inna bramka tego nie
// widzi: klucz istnieje, stoi w obu językach, parytet jest zielony.
// ---------------------------------------------------------------------------
const BEZ_INTERPOLACJI = MAPY.filter((mapa) => !mapa.interpoluje);

describe("zdania bez interpolacji", () => {
  it("bramka mierzy dokładnie te mapy, które wołają `t()` bez parametrów", () => {
    // Lista powstaje z filtra, więc przestawiona flaga zamieniłaby tę bramkę
    // w ZIELONĄ pustkę (`describe.each([])` nie zgłasza nic). Wymieniamy oba
    // moduły z nazwy także po to, żeby dołożenie `paramsOf()` do którejś z tych
    // map było świadomą zmianą TU, a nie cichym wyłączeniem sprawdzenia.
    expect(BEZ_INTERPOLACJI.map((mapa) => mapa.nazwa)).toEqual([
      "publicEventErrors",
      "adminEventStudioErrors",
    ]);
  });
});

describe.each(BEZ_INTERPOLACJI)("zdania bez interpolacji: $nazwa", (mapa) => {
  it("żadne zdanie odmowy tego modułu nie ma miejsca interpolacji", () => {
    // Sprawdzamy CAŁĄ gałąź `errors`, a nie tylko klucze użyte w przypadkach:
    // wąsy dopisane do klucza, którego dziś nikt nie testuje, wyszłyby dopiero
    // u redaktora albo u uczestnika.
    for (const [jezyk, slownik] of [
      ["pl", mapa.pl],
      ["en", mapa.en],
    ] as const) {
      const galaz = readKey(slownik, mapa.prefix.slice(0, -1));
      expect(typeof galaz, `brak gałęzi ${mapa.prefix} w ${jezyk}`).toBe("object");
      for (const [klucz, zdanie] of Object.entries(galaz as Record<string, unknown>)) {
        if (typeof zdanie !== "string") continue;
        expect(zdanie, `${jezyk}: ${klucz} ma interpolację, której mapa nie wypełni`).not.toContain(
          "{{",
        );
      }
    }
  });
});

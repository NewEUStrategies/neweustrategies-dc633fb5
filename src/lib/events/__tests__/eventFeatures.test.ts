// Testy przelacznikow modulow wydarzenia.
//
// PILNUJEMY TRZECH RZECZY, KTORE PSUJA SIE CICHO.
//
// 1) „KLUCZ NIEOBECNY = MODUL WLACZONY". Odwrocenie tej reguly nie wywala
//    niczego: modul dodany w przyszlosci po prostu ZNIKA wszystkim wydarzeniom
//    zapisanym przed jego powstaniem, bo ich kolumna nie ma jego klucza.
//
// 2) UMOWA Z RPC. `admin_event_features_save` zapisuje WYLACZNIE wylaczenia,
//    ale klucz POMINIETY w payloadzie zachowuje dzisiejszy stan - wiec payload
//    zlozony z samych `false` umialby tylko wylaczac. Test trzyma oba konce tej
//    umowy naraz: komplet kluczy w payloadzie i same `false` w kolumnie.
//
// 3) MAPOWANIE NA SEKCJE STUDIA. Literowka w kluczu sekcji albo w kluczu grupy
//    nie psuje kompilacji ani ekranu - po prostu pozycja PRZESTAJE sie chowac,
//    czyli przelacznik zaczyna klamac. Asercja idzie przez przeciecie zbiorow
//    z `EVENT_STUDIO_SECTIONS`, a nie przez przepisana liste nazw: kopia
//    zgodna z kopia nie dowodzi niczego.
import { describe, expect, it } from "vitest";
import {
  ALL_EVENT_FEATURES_ENABLED,
  EVENT_FEATURE_HINT_KEYS,
  EVENT_FEATURE_KEYS,
  EVENT_FEATURE_LABEL_KEYS,
  eventFeatureHidingSection,
  eventFeaturesDirty,
  eventFeaturesFromJson,
  eventFeaturesPayload,
  eventFeaturesStored,
  hiddenStudioSections,
  type EventFeatureKey,
  type EventFeaturesDraft,
} from "@/lib/events/eventFeatures";
import { EVENT_STUDIO_SECTIONS, type EventStudioSection } from "@/lib/events/eventStudioNav";

function features(off: readonly EventFeatureKey[] = []): EventFeaturesDraft {
  const draft: EventFeaturesDraft = { ...ALL_EVENT_FEATURES_ENABLED };
  for (const key of off) draft[key] = false;
  return draft;
}

describe("odczyt przelacznikow z kolumny jsonb", () => {
  it("BRAK KLUCZA znaczy modul WLACZONY", () => {
    // Kolumna pustego wydarzenia to `{}` - i to nie moze znaczyc „nic nie ma".
    expect(eventFeaturesFromJson({})).toEqual(ALL_EVENT_FEATURES_ENABLED);
    expect(eventFeaturesFromJson({ meetings: false })).toEqual(features(["meetings"]));
    // Modul, ktory dopiero powstal, jest wlaczony wydarzeniu sprzed jego czasow.
    expect(eventFeaturesFromJson({ onsite: false }).sponsors).toBe(true);
  });

  it("smieciowy jsonb DEGRADUJE do wszystkiego wlaczonego, zamiast rzucac", () => {
    // Wyjatek zabralby redaktorowi cale studio, a domysl „wszystko wylaczone"
    // schowalby przed nim polowe panelu bez zadnego powodu.
    for (const value of [null, undefined, [], ["meetings"], "meetings", 42, true, false]) {
      expect(eventFeaturesFromJson(value)).toEqual(ALL_EVENT_FEATURES_ENABLED);
    }
  });

  it("wylacza wylacznie doslowne `false`, a nie wartosc „falsywa”", () => {
    // RPC nie zapisze takich wartosci (wymaga booleana), wiec jesli sa
    // w kolumnie, przyszly z pominieciem RPC i nie ma powodu im wierzyc.
    const draft = eventFeaturesFromJson({
      pages: "false",
      registration: 0,
      tickets: null,
      sessions: "",
    });
    expect(draft).toEqual(ALL_EVENT_FEATURES_ENABLED);
  });

  it("odczyt jest KOPIA, a nie wspoldzielona stala", () => {
    const first = eventFeaturesFromJson(null);
    first.meetings = false;
    expect(ALL_EVENT_FEATURES_ENABLED.meetings).toBe(true);
    expect(eventFeaturesFromJson(null).meetings).toBe(true);
  });

  it("klucz spoza bialej listy jest ignorowany, tak jak w RPC", () => {
    const draft = eventFeaturesFromJson({ meetings: false, wystawcy: false });
    expect(Object.keys(draft).sort()).toEqual([...EVENT_FEATURE_KEYS].sort());
    expect(draft.meetings).toBe(false);
  });
});

describe("payload i to, co z niego trafia do kolumny", () => {
  it("do KOLUMNY ida wylacznie wylaczenia - `true` sie nie zapisuje", () => {
    expect(eventFeaturesStored(features(["meetings", "onsite"]))).toEqual({
      meetings: false,
      onsite: false,
    });
    expect(eventFeaturesStored(features())).toEqual({});
  });

  it("PAYLOAD niesie komplet siedmiu kluczy, zeby dalo sie modul WLACZYC", () => {
    // Klucz pominiety w payloadzie zachowuje dzisiejszy stan (tak stanowi RPC),
    // wiec payload z samych `false` nie odkrecilby zadnego wylaczenia: zapis
    // wyslalby `{}`, baza nie zmienilaby niczego, a przelacznik wracalby na
    // „wylaczony" przy najblizszym odswiezeniu.
    const payload = eventFeaturesPayload(features(["tickets"]));
    expect(Object.keys(payload).sort()).toEqual([...EVENT_FEATURE_KEYS].sort());
    expect(payload.tickets).toBe(false);
    expect(payload.registration).toBe(true);
    // Wlaczenie z powrotem musi pojsc do bazy JAWNIE.
    expect(eventFeaturesPayload(features()).tickets).toBe(true);
    // ...i dopiero RPC wyrzuca `true` z zapisu.
    expect(Object.values(eventFeaturesStored(features())).length).toBe(0);
  });

  it("payload przyjmuje wylacznie booleany - typ bazy nie zna niczego innego", () => {
    for (const value of Object.values(eventFeaturesPayload(features(["pages", "sponsors"])))) {
      expect(typeof value).toBe("boolean");
    }
  });
});

describe("wykrywanie zmiany", () => {
  it("reaguje na przelaczenie kazdego z siedmiu modulow", () => {
    for (const key of EVENT_FEATURE_KEYS) {
      expect(eventFeaturesDirty(features(), features([key]))).toBe(true);
    }
  });

  it("NIE reaguje, gdy stan jest ten sam - inaczej pasek zapisu stalby zawsze", () => {
    expect(eventFeaturesDirty(features(), features())).toBe(false);
    expect(eventFeaturesDirty(features(["onsite"]), features(["onsite"]))).toBe(false);
    // Kolejnosc kluczy w obiekcie nie jest zmiana stanu.
    expect(
      eventFeaturesDirty(features(["onsite", "meetings"]), features(["meetings", "onsite"])),
    ).toBe(false);
  });
});

describe("mapowanie funkcji na sekcje studia", () => {
  const ALL_SECTIONS: ReadonlySet<string> = new Set(EVENT_STUDIO_SECTIONS);

  it("wszystko wlaczone = nic nie jest ukryte", () => {
    expect(hiddenStudioSections(features()).size).toBe(0);
  });

  it("KAZDA funkcja chowa co najmniej jedna PRAWDZIWA sekcje studia", () => {
    // To jest asercja przez przeciecie zbiorow: literowka w kluczu sekcji nie
    // kompiluje sie, ale literowka w kluczu GRUPY (`meeting` zamiast
    // `meetings`) oddaje pusty zbior - i przelacznik przestaje chowac
    // cokolwiek, czego nikt nie widzi do momentu awarii na ekranie.
    for (const key of EVENT_FEATURE_KEYS) {
      const hidden = hiddenStudioSections(features([key]));
      expect(hidden.size, `funkcja ${key} nie chowa zadnej sekcji`).toBeGreaterThan(0);
      const unknown = [...hidden].filter((section) => !ALL_SECTIONS.has(section));
      expect(unknown, `funkcja ${key} wskazuje sekcje spoza modelu nawigacji`).toEqual([]);
    }
  });

  it("„Funkcje dodatkowe” NIGDY sie nie chowaja - inaczej wylaczenie byloby nieodwracalne", () => {
    const everythingOff = hiddenStudioSections(features([...EVENT_FEATURE_KEYS]));
    expect(everythingOff.has("features")).toBe(false);
    // Ekrany, ktorych zaden przelacznik nie dotyczy, tez zostaja na miejscu.
    for (const section of ["overview", "general", "branding", "groups", "analytics"] as const) {
      expect(everythingOff.has(section)).toBe(false);
    }
  });

  it("funkcja grupowa chowa CALA grupe, a funkcja pojedyncza jeden ekran", () => {
    // „Rejestracja" to grupa sidebara: jej dzieci licza sie z modelu nawigacji,
    // wiec podstrona dopisana do grupy w przyszlosci schowa sie razem z nia.
    const registrationOff = hiddenStudioSections(features(["registration"]));
    expect(registrationOff.has("registrationList")).toBe(true);
    expect(registrationOff.has("registrationTickets")).toBe(true);
    expect(registrationOff.has("registrationForm")).toBe(true);
    expect(registrationOff.size).toBeGreaterThan(2);

    // „Bilety" chowaja JEDNA podstrone tej samej grupy - wydarzenie z zapisami
    // i wolnym wstepem to najczestszy przypadek w kalendarzu.
    const ticketsOff = hiddenStudioSections(features(["tickets"]));
    expect([...ticketsOff]).toEqual(["registrationTickets"]);

    // Agenda, spotkania i odprawa to tez grupy - kazda znika w calosci.
    expect(hiddenStudioSections(features(["sessions"])).has("contentConflicts")).toBe(true);
    // Sklad grupy liczy sie z EVENT_STUDIO_NAV, nie z drugiej listy tutaj.
    // `contentSpeakers` doszedl do grupy PO napisaniu mapy funkcji i schowal sie
    // razem z nia bez zadnej zmiany w `eventFeatures.ts` - o to szlo. Druga
    // lista wymagalaby pamietania o niej i milczaco puszczalaby nowy ekran.
    expect(hiddenStudioSections(features(["sessions"])).has("contentSpeakers")).toBe(true);
    expect(hiddenStudioSections(features(["meetings"])).has("meetingsStats")).toBe(true);
    expect(hiddenStudioSections(features(["onsite"])).has("onsiteBadges")).toBe(true);
    // A „Strony i menu" oraz „Sponsorzy" sa pozycjami samodzielnymi.
    expect([...hiddenStudioSections(features(["pages"]))]).toEqual(["pages"]);
    expect([...hiddenStudioSections(features(["sponsors"]))]).toEqual(["sponsors"]);
  });

  it("ekran ukrytej sekcji wie, KTORY modul go chowa", () => {
    const draft = features(["meetings", "tickets"]);
    expect(eventFeatureHidingSection(draft, "meetingsTables")).toBe("meetings");
    expect(eventFeatureHidingSection(draft, "registrationTickets")).toBe("tickets");
    // Sekcja widoczna nie ma powodu tlumaczyc sie modulem.
    expect(eventFeatureHidingSection(draft, "registrationList")).toBe(null);
    expect(eventFeatureHidingSection(features(), "meetingsTables")).toBe(null);
  });

  it("przy dwoch wylaczeniach naraz odpowiada SZERSZY modul", () => {
    // Wlaczenie samych „Biletow" nie przywroci tego ekranu do nawigacji, dopoki
    // cala „Rejestracja" jest wylaczona - i to ten modul ma byc nazwany.
    const draft = features(["registration", "tickets"]);
    expect(eventFeatureHidingSection(draft, "registrationTickets")).toBe("registration");
  });

  it("zbior ukrytych sekcji jest typowany kluczami sekcji studia", () => {
    // Straznik warstwy: gdyby funkcja oddawala dowolne napisy, sidebar
    // porownywalby swoje klucze z czyms, co juz sie z nimi nie spina.
    const hidden: ReadonlySet<EventStudioSection> = hiddenStudioSections(features(["onsite"]));
    expect([...hidden].every((section) => ALL_SECTIONS.has(section))).toBe(true);
  });
});

describe("klucze slownika", () => {
  it("kazda funkcja ma etykiete i podpowiedz - typ wymusza pokrycie, test pilnuje ksztaltu", () => {
    for (const key of EVENT_FEATURE_KEYS) {
      expect(EVENT_FEATURE_LABEL_KEYS[key]).toBe(`adminEvents.studio.features.labels.${key}`);
      expect(EVENT_FEATURE_HINT_KEYS[key]).toBe(`adminEvents.studio.features.hints.${key}`);
    }
  });
});

// Katalog uczestnikow gieldy spotkan - ODPOWIEDZ RPC, ktorej nikt nie waliduje.
//
// PO CO TEN PLIK OBOK `meetingDirectory.test.ts`. Tamten sprawdza jeden wiersz
// wizytowki. Tutaj stoi to, co decyduje o TRESCI EKRANU, zanim jeszcze padnie
// pierwsza karta:
//
//   1. POWOD BLOKADY steruje nastepnym dzialaniem uczestnika („czekaj",
//      „zapisz sie", „napisz do organizatora"). Zle rozczytany powod wysyla
//      go w zla strone albo - gorzej - kasuje komunikat i zostawia pusty ekran.
//   2. ZAKRES WIDOCZNOSCI (`scope`) mowi, KOGO wolno pokazac. Wartosc nieznana
//      musi spasc do najwezszej, nie do najszerszej - inaczej blad odczytu
//      zamienia sie w wyciek listy uczestnikow.
//   3. GRUPY sa filtrem listy i przepustka; do dzis nie byly parsowane ani raz.
//   4. STAN ROZMOWY zmienia przycisk z „Zapros" na odnosnik do terminarza.
//
// RODO: dane syntetyczne, zadnych prawdziwych uczestnikow.
import { describe, expect, it } from "vitest";
import {
  DIRECTORY_BLOCKS,
  EMPTY_DIRECTORY,
  directoryBlockKey,
  directoryEntryName,
  directoryEntrySubtitle,
  parseMeetingDirectory,
} from "@/lib/events/meetingDirectory";

const REG_A = "aaaaaaaa-1111-4111-8111-111111111111";
const REG_B = "bbbbbbbb-2222-4222-8222-222222222222";

describe("powod blokady", () => {
  it("kazdy powod z katalogu przechodzi pod wlasna nazwa", () => {
    // Powody sa STOPNIOWANE: sklejenie ich w jeden komunikat kasuje roznice
    // miedzy „czekaj", „zapisz sie" i „napisz do organizatora".
    for (const block of DIRECTORY_BLOCKS) {
      expect(parseMeetingDirectory({ blocked: block }).blocked).toBe(block);
    }
  });

  it("kazdy powod ma WLASNY klucz i18n, zaden nie dzieli go z innym", () => {
    // Dwa powody pod jednym kluczem to jeden komunikat dla dwoch roznych
    // sytuacji - i uczestnik robi wtedy nie to, co trzeba.
    const keys = DIRECTORY_BLOCKS.map(directoryBlockKey);
    expect(new Set(keys).size).toBe(DIRECTORY_BLOCKS.length);
    expect(directoryBlockKey("requester_not_participating")).toBe(
      "eventMeetings.participant.directory.blocks.requesterNotParticipating",
    );
  });

  it("wartosc spoza katalogu i brak pola znacza BRAK blokady", () => {
    // Zapisane jako zachowanie: klient nie zna powodow, ktorych nie ma w jego
    // slowniku, i pokazuje wtedy katalog. Kolejna pozycja `blocked` po stronie
    // SQL wymaga wiec dopisania jej TUTAJ, inaczej uczestnik zobaczy pusta
    // liste bez zdania wyjasniajacego.
    expect(parseMeetingDirectory({ blocked: "cos_nowego" }).blocked).toBeNull();
    expect(parseMeetingDirectory({ blocked: "  " }).blocked).toBeNull();
    expect(parseMeetingDirectory({ blocked: 7 }).blocked).toBeNull();
    expect(parseMeetingDirectory({}).blocked).toBeNull();
  });
});

describe("zakres widocznosci", () => {
  it("kazdy zakres z katalogu przechodzi bez zmiany", () => {
    for (const scope of ["none", "own_group", "registered", "everyone"] as const) {
      expect(parseMeetingDirectory({ scope }).scope).toBe(scope);
    }
  });

  it("zakres nieznany spada do najwezszego, a nie do najszerszego", () => {
    // To jest kierunek degradacji, ktory decyduje o tym, czy blad odczytu jest
    // niedogodnoscia, czy wyciekiem listy uczestnikow.
    expect(parseMeetingDirectory({ scope: "wszyscy_i_jeszcze_wiecej" }).scope).toBe("none");
    expect(parseMeetingDirectory({ scope: null }).scope).toBe("none");
    expect(parseMeetingDirectory(null).scope).toBe("none");
  });
});

describe("grupy - filtr listy i przepustka", () => {
  it("grupy wydarzenia czytaja obie nazwy i kolor znacznika", () => {
    // Kolor jest jedynym, co odroznia znaczniki grup na karcie; nazwy sa
    // dwujezyczne, bo katalog dziala w obu wersjach jezykowych.
    const parsed = parseMeetingDirectory({
      groups: [
        { id: "g1", name_pl: "Wystawcy", name_en: "Exhibitors", color: "#123456" },
        { id: "g2", name_pl: "Prelegenci" },
      ],
    });
    expect(parsed.groups).toEqual([
      { id: "g1", namePl: "Wystawcy", nameEn: "Exhibitors", color: "#123456" },
      { id: "g2", namePl: "Prelegenci", nameEn: null, color: null },
    ]);
  });

  it("grupa bez identyfikatora odpada - filtr bez klucza nie da sie zaznaczyc", () => {
    const parsed = parseMeetingDirectory({
      groups: [
        { name_pl: "Bez id" },
        { id: "  ", name_pl: "Puste id" },
        { id: "g3" },
        "nie obiekt",
      ],
    });
    expect(parsed.groups.map((group) => group.id)).toEqual(["g3"]);
  });

  it("grupy przy wizytowce czytaja sie tak samo jak grupy wydarzenia", () => {
    // Wlasciciel karty widzi dokladnie te etykiety, ktore widza inni - jedna
    // funkcja parsujaca jest tego warunkiem.
    const parsed = parseMeetingDirectory({
      rows: [{ registration_id: REG_A, groups: [{ id: "g1", name_pl: "Wystawcy" }] }],
    });
    expect(parsed.rows[0]?.groups).toEqual([
      { id: "g1", namePl: "Wystawcy", nameEn: null, color: null },
    ]);
  });

  it("brak grup i wartosc nie bedaca lista daja pusta liste, nie wyjatek", () => {
    expect(parseMeetingDirectory({ groups: "wszystkie" }).groups).toEqual([]);
    expect(
      parseMeetingDirectory({ rows: [{ registration_id: REG_A, groups: 3 }] }).rows[0]?.groups,
    ).toEqual([]);
  });
});

describe("wiersze katalogu", () => {
  it("wpis bez identyfikatora zapisu odpada - bez niego nie da sie zaprosic", () => {
    // `event_meeting_invite` przyjmuje `counterpart_registration_id`; karta bez
    // niego mialaby przycisk, ktory zawsze konczy sie odmowa bazy.
    const parsed = parseMeetingDirectory({
      rows: [
        { first_name: "Bez", last_name: "Zapisu" },
        { registration_id: "   ", first_name: "Puste" },
        { registration_id: REG_A, first_name: "Ewa", last_name: "Testowa" },
      ],
    });
    expect(parsed.rows.map((row) => row.registrationId)).toEqual([REG_A]);
  });

  it("brakujace imie i nazwisko daja pusty napis, a nie 'null' na karcie", () => {
    // `directoryEntryName` sklada etykiete z tych dwoch pol - `null` wypisalby
    // sie na karcie doslownie.
    const [entry] = parseMeetingDirectory({ rows: [{ registration_id: REG_A }] }).rows;
    expect(entry.firstName).toBe("");
    expect(entry.lastName).toBe("");
    expect(directoryEntryName(entry)).toBe("");
  });

  it("drugi wiersz karty nie ma osieroconego separatora", () => {
    // Uczestnik bez firmy nie moze dostac podpisu w rodzaju „Analityk ·".
    const [zPelnymi, samoStanowisko, pusty] = parseMeetingDirectory({
      rows: [
        { registration_id: REG_A, job_title: "Analityk", company: "Firma Przykladowa" },
        { registration_id: REG_B, job_title: "Analityk" },
        { registration_id: "cccccccc-3333-4333-8333-333333333333" },
      ],
    }).rows;
    expect(directoryEntrySubtitle(zPelnymi)).toBe("Analityk · Firma Przykladowa");
    expect(directoryEntrySubtitle(samoStanowisko)).toBe("Analityk");
    expect(directoryEntrySubtitle(pusty)).toBe("");
  });

  it("odpowiedz bez listy wierszy daje pusty katalog, a nie wyjatek", () => {
    expect(parseMeetingDirectory({ rows: "brak" }).rows).toEqual([]);
    expect(parseMeetingDirectory(null)).toEqual(EMPTY_DIRECTORY);
    expect(parseMeetingDirectory("odpowiedz tekstowa")).toEqual(EMPTY_DIRECTORY);
  });
});

describe("stan rozmowy zmienia przycisk", () => {
  it("zaproszenie i przyjete spotkanie sa rozroznialne", () => {
    // Kto ma z nami zywe zaproszenie, dostaje odnosnik do terminarza zamiast
    // „Zapros" - inaczej uczestnik wysyla drugie zaproszenie i dostaje odmowe.
    const rows = parseMeetingDirectory({
      rows: [
        { registration_id: REG_A, meeting_status: "invited" },
        { registration_id: REG_B, meeting_status: "accepted" },
      ],
    }).rows;
    expect(rows.map((row) => row.meetingStatus)).toEqual(["invited", "accepted"]);
  });

  it("stan spoza pary i brak stanu znacza 'nic nas nie laczy'", () => {
    // Odrzucone albo odwolane spotkanie NIE moze blokowac nowego zaproszenia -
    // inaczej jedna odmowa zamyka kontakt na zawsze.
    const rows = parseMeetingDirectory({
      rows: [{ registration_id: REG_A, meeting_status: "declined" }, { registration_id: REG_B }],
    }).rows;
    // Mapa, a nie `every`: lista skrocona przez parser dawalaby prawde pusta,
    // wiec test przechodzilby takze wtedy, gdy obie karty w ogole zniknely
    // z katalogu - czyli w przypadku, ktory kasuje mozliwosc zaproszenia.
    expect(rows.map((row) => row.registrationId)).toEqual([REG_A, REG_B]);
    expect(rows.map((row) => row.meetingStatus)).toEqual([null, null]);
  });

  it("okno dostepnosci jest zgloszone tylko przy jawnym `true`", () => {
    // „Ma wolne terminy" musi znaczyc dokladnie to; wartosc nieokreslona
    // obiecywalaby uczestnikowi terminarz, ktorego nie ma.
    const rows = parseMeetingDirectory({
      rows: [
        { registration_id: REG_A, has_availability: true },
        { registration_id: REG_B, has_availability: "tak" },
      ],
    }).rows;
    expect(rows.map((row) => row.hasAvailability)).toEqual([true, false]);
  });
});

describe("naglowek katalogu", () => {
  it("licznik calosci czyta sie tylko z liczby skonczonej", () => {
    // Licznik stoi nad lista i steruje stronicowaniem; napis albo `Infinity`
    // z niepoprawnej odpowiedzi zamienilby go w „NaN uczestnikow".
    expect(parseMeetingDirectory({ total_count: 42.9 }).totalCount).toBe(42);
    expect(parseMeetingDirectory({ total_count: "42" }).totalCount).toBe(0);
    expect(parseMeetingDirectory({}).totalCount).toBe(0);
  });

  it("wypisanie sie z katalogu jest decyzja uczestnika i wymaga jawnego `true`", () => {
    // To jest zgoda na widocznosc - milczenie w odpowiedzi nie moze jej
    // ustanawiac ani cofac.
    expect(parseMeetingDirectory({ directory_opt_out: true }).optedOut).toBe(true);
    expect(parseMeetingDirectory({ directory_opt_out: "tak" }).optedOut).toBe(false);
    expect(parseMeetingDirectory({}).optedOut).toBe(false);
  });

  it("wlasny identyfikator zapisu jest wyluskiwany, bo bez niego nie ma zaproszen", () => {
    expect(parseMeetingDirectory({ my_registration_id: REG_A }).myRegistrationId).toBe(REG_A);
    expect(parseMeetingDirectory({ my_registration_id: "" }).myRegistrationId).toBeNull();
  });
});

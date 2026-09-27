// Rozbiór zwrotki `event_cfp_export_my_data` na sekcje paczki RODO.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW. Server fn eksportu nie ma pokrycia
// runtime'owego (dwie bramki statyczne zamiast atrapy klienta), więc każda
// z trzech obietnic tego modułu byłaby niesprawdzona: odmowa bazy musi wrócić
// JAKO BŁĄD (inaczej `manifest.failed` milczy, a plik podpisuje się jako
// komplet), zwrotka o obcym kształcie jest zawężana, a nie rzutowana, a brak
// klucza ma dać `[]`, nie `undefined` w pliku osoby, której dane dotyczą.
import { describe, expect, it } from "vitest";

import { cfpExportSection, type CfpExportSectionId } from "@/lib/events/cfpExportSection";
import {
  EXPORT_ROW_LIMIT,
  EXPORT_SECTION_GROUPS,
  buildExportManifest,
  detectTruncatedSections,
} from "@/lib/profile/exportManifest";

const SUBMISSIONS: CfpExportSectionId = "event_cfp_submissions";

/** Zwrotka RPC tak, jak oddaje ją baza: jeden obiekt, cztery listy. */
function payload() {
  return {
    event_cfp_submissions: [{ id: "sub-1", title: "Transformacja energetyczna" }],
    event_speaker_materials: [{ id: "mat-1", kind: "slides" }],
    event_cfp_reviewer_roles: [{ event_id: "ev-1", role: "reviewer" }],
    event_cfp_reviews_written: [{ submission_id: "sub-9", score: 4 }],
  };
}

describe("cfpExportSection - odmowa bazy", () => {
  it("błąd RPC wraca jako BŁĄD sekcji, bez danych, tym samym obiektem", () => {
    const error = { message: "permission denied for function event_cfp_export_my_data" };

    const section = cfpExportSection({ data: null, error }, SUBMISSIONS);

    // `null`, a nie `[]`: pusta lista w pliku czyta się jako „nie zgłaszałem
    // wystąpień", a to jest inna informacja niż „nie udało się tego odczytać".
    expect(section.data).toBeNull();
    // Ten sam obiekt - kod i szczegóły PostgREST jadą dalej do sekcji `errors`.
    expect(section.error).toBe(error);
  });

  it("błąd wygrywa z danymi - sekcja nie miesza odmowy z wierszami", () => {
    const error = { message: "timeout" };
    expect(cfpExportSection({ data: payload(), error }, SUBMISSIONS)).toEqual({
      data: null,
      error,
    });
  });

  it("sekcja z błędem trafia do `manifest.failed` - plik nie udaje kompletu", () => {
    // Tak składa to server fn: klucz sekcji z błędem idzie do `errors`, a lista
    // kluczy `errors` do manifestu.
    const errors: Record<string, string> = {};
    for (const key of EXPORT_SECTION_GROUPS.event_cfp) {
      const section = cfpExportSection({ data: null, error: { message: "denied" } }, key);
      if (section.error) errors[key] = section.error.message;
    }

    expect(buildExportManifest(Object.keys(errors)).failed).toEqual([
      ...EXPORT_SECTION_GROUPS.event_cfp,
    ]);
  });
});

describe("cfpExportSection - poprawna zwrotka", () => {
  it("każda z czterech sekcji grupy czyta WŁASNY klucz zwrotki", () => {
    // Sekcje dzielą jedno wywołanie RPC; pomyłka klucza wkładałaby materiały
    // prelegenta pod nagłówek recenzji i odwrotnie.
    const data = payload();
    for (const key of EXPORT_SECTION_GROUPS.event_cfp) {
      expect(cfpExportSection({ data, error: null }, key)).toEqual({
        data: data[key],
        error: null,
      });
    }
  });

  it("wiersze przechodzą bez kopiowania i bez mapowania pól", () => {
    // Kształt wierszy należy do RPC (tam zapada, czego NIE oddajemy). Klient,
    // który by je przepisywał, byłby drugim miejscem decydującym o zakresie.
    const data = payload();
    expect(cfpExportSection({ data, error: null }, SUBMISSIONS).data).toBe(
      data.event_cfp_submissions,
    );
  });

  it("sekcja wypełniona do sufitu RPC jest w manifeście zgłoszona jako ucięta", () => {
    // RPC dostaje `p_limit: ROW_LIMIT`, więc lista równa sufitowi mogła nie
    // zmieścić wszystkiego. Sygnał ucięcia liczy się z ZAWARTOŚCI sekcji -
    // działa tylko dlatego, że ten moduł oddaje listę w całości.
    const full = Array.from({ length: EXPORT_ROW_LIMIT }, (_, i) => ({ id: `sub-${i}` }));
    const section = cfpExportSection(
      { data: { ...payload(), event_cfp_submissions: full }, error: null },
      SUBMISSIONS,
    );

    // Ta sama lista, którą dostał emiter - więc ta sama, którą liczy manifest.
    expect(section.data).toBe(full);
    expect(detectTruncatedSections({ [SUBMISSIONS]: full })).toEqual([
      { id: SUBMISSIONS, limit: EXPORT_ROW_LIMIT, returned: EXPORT_ROW_LIMIT },
    ]);
  });

  it("brak klucza w zwrotce daje pustą listę, nie `undefined`", () => {
    const { event_cfp_submissions: _dropped, ...rest } = payload();
    expect(cfpExportSection({ data: rest, error: null }, SUBMISSIONS)).toEqual({
      data: [],
      error: null,
    });
  });

  it("jawny `null` pod kluczem też schodzi na pustą listę", () => {
    expect(
      cfpExportSection(
        { data: { ...payload(), event_cfp_submissions: null }, error: null },
        SUBMISSIONS,
      ).data,
    ).toEqual([]);
  });

  it("pusta lista zostaje pustą listą", () => {
    expect(
      cfpExportSection(
        { data: { ...payload(), event_cfp_submissions: [] }, error: null },
        SUBMISSIONS,
      ).data,
    ).toEqual([]);
  });
});

describe("cfpExportSection - rozjechany kontrakt jsonb", () => {
  // Zwrotka, która nie jest obiektem, to rozjazd kontraktu po stronie bazy.
  // Moduł ZAWĘŻA zamiast rzutować (zachowanie przeniesione 1:1 z server fn):
  // bez tego `null` wywracałby odczyt klucza błędem silnika JS, a lista albo
  // skalar dawałyby w pliku wartość, której nikt nie zadeklarował.
  it.each([
    ["null (funkcja nic nie zwróciła)", null],
    ["lista zamiast obiektu", [{ id: "sub-1" }]],
    ["napis", "event_cfp_submissions"],
    ["liczba", 4],
    ["wartość logiczna", true],
  ])("%s daje pustą listę bez błędu", (_label, data) => {
    expect(cfpExportSection({ data, error: null }, SUBMISSIONS)).toEqual({
      data: [],
      error: null,
    });
  });
});

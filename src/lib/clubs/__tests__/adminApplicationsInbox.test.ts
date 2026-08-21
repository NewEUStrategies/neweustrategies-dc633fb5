// Skrzynka zgłoszeń klubowych - REGUŁY ścieżki, która JUŻ RAZ ZAWIODŁA.
//
// CO TEN PLIK DOWODZI. Wejście do klubu ma incydent produkcyjny w historii
// (`source_type='club_application'` złamał CHECK na `crm_leads`, stąd bramka
// `check:pg-harness`), więc jego reguły są tu rozłożone przypadek po przypadku:
//
//   1. `duplicate_open` MA WŁASNE ZDANIE. Cofnięcie decyzji przy drugim
//      OTWARTYM zgłoszeniu tej samej osoby narusza indeks częściowy w bazie.
//      Operator, który widzi „nie udało się zapisać statusu”, nie ma pojęcia,
//      że przeszkodą jest inne zgłoszenie - i klika trzeci raz.
//   2. FILTRY JADĄ JAKO `null`, NIE JAKO `""`. Pusty napis w `p_status` to
//      filtr po statusie RÓWNYM PUSTEMU NAPISOWI - czyli pusta skrzynka jak brak
//      zgłoszeń. Statusy spoza słownika też schodzą na `null`: wcześniej szło
//      tu rzutowanie `as ClubApplicationStatus`, które przemilcza każdą wartość.
//   3. STAN CRM ROZRÓŻNIA „NIGDY NIE PRÓBOWANO” OD „PRÓBOWANO I NIE WYSZŁO”.
//      Zlepienie tych dwóch stanów w jedno zdanie jest dokładnie tym, co czyni
//      porażkę synchronizacji niewidzialną - a wtedy redakcja zakłada, że
//      kartoteka w CRM istnieje.
//   4. STAN POCZTY MA TRZY ROZŁĄCZNE PRZYPADKI (błąd wysyłki / brak wysyłki /
//      wysłano wtedy i o TYM statusie). Nieudana wysyłka nie cofa decyzji, więc
//      ten ślad jest jedyną informacją, że kandydat czeka na maila, który nie
//      poszedł.
//   5. POLE OPCJONALNE PUSTE NIE POKAZUJE ETYKIETY, ale ZERO lat doświadczenia
//      to podana wartość, nie pustka.
//   6. NAZWY DWUJĘZYCZNE SCHODZĄ NA DRUGI JĘZYK, a nie na puste miejsce.
//   7. ZAKŁADKA „WSZYSTKIE” JEST PIERWSZA i niesie sumę zaległości; brak wpisu
//      w licznikach znaczy ZERO, nie `undefined`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Mapowania komunikatu bazy na kod -
// `clubApplicationStatusErrorCode` ma testy w `applyApi.test.ts`; tutaj
// zaczynamy od KODU i dowodzimy, że ma własne zdanie. (2) Kontraktu RPC (nazwy
// funkcji i argumentów) - to `applyApi.test.ts`. (3) Renderu skrzynki, mutacji
// i toastów - to `ClubApplicationsInbox.test.tsx`. (4) Wysyłki maila
// (`notifyClubApplicationStatus`) - to server fn z własnym zakresem; tutaj
// tylko odczyt JEJ WYNIKU.
import { describe, expect, it } from "vitest";
import {
  APPLICATION_DETAIL_FIELDS,
  APPLICATION_STATUSES,
  applicationClubName,
  applicationDetailValue,
  applicationInboxKeys,
  applicationListFilters,
  applicationMailState,
  applicationMailToast,
  applicationSpecTabs,
  applicationStatusActions,
  applicationStatusErrorKey,
  applicationStatusTone,
  bilingualLabel,
  crmChipView,
  crmRetryToast,
  crmTone,
  narrowApplicationStatus,
  pendingBySpec,
  totalPending,
} from "@/lib/clubs/adminApplicationsInbox";
import type { ClubApplicationStatus } from "@/lib/clubs/applyApi";
import { CLUB_BASE_ISO, clubIsoOffset } from "@/test/clubs/fixtures";
import {
  clubApplicationAdminRow,
  clubApplicationCountRow,
  clubApplicationCrmRetryResult,
} from "@/test/clubs/inboxFixtures";

describe("słownik statusów", () => {
  it("niesie PEŁNY zbiór pięciu statusów w kolejności decyzji", () => {
    expect(APPLICATION_STATUSES).toEqual([
      "pending",
      "review",
      "accepted",
      "rejected",
      "needs_info",
    ]);
  });

  it("każdy status ma ton, a decyzje odcinające i czekające NIE dzielą tonu", () => {
    expect(applicationStatusTone("accepted")).toBe("positive");
    expect(applicationStatusTone("rejected")).toBe("negative");
    expect(applicationStatusTone("review")).toBe("warning");
    expect(applicationStatusTone("needs_info")).toBe("warning");
    expect(applicationStatusTone("pending")).toBe("neutral");
  });

  it("przyciski wiersza pomijają status, który wiersz JUŻ ma", () => {
    expect(applicationStatusActions("pending")).toEqual([
      "review",
      "accepted",
      "rejected",
      "needs_info",
    ]);
    expect(applicationStatusActions("needs_info")).not.toContain("needs_info");
    for (const status of APPLICATION_STATUSES) {
      expect(applicationStatusActions(status)).toHaveLength(APPLICATION_STATUSES.length - 1);
    }
  });
});

describe("klucze cache", () => {
  it("lista i liczniki wiszą pod jednym korzeniem - unieważnia się je razem", () => {
    expect(applicationInboxKeys.all).toEqual(["admin", "club-applications"]);
    expect(applicationInboxKeys.counts()).toEqual(["admin", "club-applications", "counts"]);
    expect(applicationInboxKeys.list("energia", "pending", "kowalska")).toEqual([
      "admin",
      "club-applications",
      "list",
      "energia",
      "pending",
      "kowalska",
    ]);
  });
});

describe("filtry listy", () => {
  it("pusty napis znaczy BRAK filtra, a nie filtr po pustej wartości", () => {
    expect(applicationListFilters("", "", "")).toEqual({
      specialization: null,
      status: null,
      search: null,
    });
  });

  it("wartości wypełnione jadą bez zmian", () => {
    expect(applicationListFilters("energia-klimat", "review", "anna")).toEqual({
      specialization: "energia-klimat",
      status: "review",
      search: "anna",
    });
  });

  it("status spoza słownika schodzi na null, a nie jedzie do RPC", () => {
    expect(narrowApplicationStatus("")).toBeNull();
    expect(narrowApplicationStatus("wymyslony")).toBeNull();
    expect(applicationListFilters("", "wymyslony", "").status).toBeNull();
    for (const status of APPLICATION_STATUSES) {
      expect(narrowApplicationStatus(status)).toBe(status);
    }
  });
});

describe("odmowa zapisu statusu", () => {
  it("`duplicate_open` dostaje WŁASNE zdanie", () => {
    expect(applicationStatusErrorKey("duplicate_open")).toBe(
      "adminClubs.applications.statusErrors.duplicate_open",
    );
  });

  it("kod nierozpoznany schodzi na ogólny komunikat", () => {
    expect(applicationStatusErrorKey("unknown")).toBe("adminClubs.applications.statusError");
  });

  it("dwa kody NIE dzielą jednego zdania", () => {
    expect(applicationStatusErrorKey("duplicate_open")).not.toBe(
      applicationStatusErrorKey("unknown"),
    );
  });
});

describe("wynik wysyłki powiadomienia", () => {
  it("nieudana wysyłka mówi błędem, ale osobnym - decyzja jest zapisana", () => {
    expect(applicationMailToast({ ok: false, error: "smtp" })).toEqual({
      tone: "error",
      key: "adminClubs.applications.mail.failed",
    });
  });

  it("wysyłka w kolejce to sukces", () => {
    expect(applicationMailToast({ ok: true })).toEqual({
      tone: "success",
      key: "adminClubs.applications.mail.queued",
    });
  });

  it("poczta już wysłana wcześniej (`duplicate`) to sukces z innym zdaniem", () => {
    expect(applicationMailToast({ ok: true, skipped: "duplicate" })).toEqual({
      tone: "success",
      key: "adminClubs.applications.mail.duplicate",
    });
  });

  it("pominięcie z innego powodu niż duplikat jedzie zdaniem o kolejce", () => {
    expect(applicationMailToast({ ok: true, skipped: "suppressed" }).key).toBe(
      "adminClubs.applications.mail.queued",
    );
  });
});

describe("ponowienie synchronizacji CRM", () => {
  it("stan `ok` po ponowieniu to sukces", () => {
    expect(crmRetryToast(clubApplicationCrmRetryResult())).toEqual({
      tone: "success",
      key: "adminClubs.applications.crm.retryOk",
    });
  });

  it("dalszy błąd po ponowieniu NIE jest raportowany jako sukces", () => {
    expect(
      crmRetryToast(
        clubApplicationCrmRetryResult({ crm_sync_status: "error", crm_error: "check constraint" }),
      ),
    ).toEqual({ tone: "error", key: "adminClubs.applications.crm.retryFailed" });
  });

  it("stan `pending` po ponowieniu też nie jest sukcesem", () => {
    expect(crmRetryToast(clubApplicationCrmRetryResult({ crm_sync_status: "pending" })).tone).toBe(
      "error",
    );
  });
});

describe("widoczny stan synchronizacji z CRM", () => {
  it("stan `ok` niesie datę SYNCHRONIZACJI i nie pozwala ponawiać", () => {
    const view = crmChipView(clubApplicationAdminRow());
    expect(view).toEqual({
      state: "ok",
      tone: "positive",
      detailKey: "adminClubs.applications.crm.syncedAt",
      detailIso: clubIsoOffset(5),
      canRetry: false,
    });
  });

  it("stan `ok` bez znacznika czasu nie zmyśla daty", () => {
    const view = crmChipView(clubApplicationAdminRow({ crm_synced_at: null }));
    expect(view.detailIso).toBeNull();
    expect(view.detailKey).toBe("adminClubs.applications.crm.syncedAt");
  });

  it("błąd z próbą niesie datę PRÓBY i pozwala ponowić", () => {
    const view = crmChipView(
      clubApplicationAdminRow({
        crm_sync_status: "error",
        crm_synced_at: null,
        crm_last_attempt_at: clubIsoOffset(30),
        crm_error: 'new row violates check constraint "crm_leads_source_type_check"',
      }),
    );
    expect(view).toEqual({
      state: "error",
      tone: "negative",
      detailKey: "adminClubs.applications.crm.lastAttempt",
      detailIso: clubIsoOffset(30),
      canRetry: true,
    });
  });

  it("„nigdy nie próbowano” to OSOBNY stan, bez daty", () => {
    const view = crmChipView(
      clubApplicationAdminRow({
        crm_sync_status: "pending",
        crm_lead_id: null,
        crm_synced_at: null,
        crm_last_attempt_at: null,
      }),
    );
    expect(view).toEqual({
      state: "pending",
      tone: "neutral",
      detailKey: "adminClubs.applications.crm.never",
      detailIso: null,
      canRetry: true,
    });
  });

  it("ton stanu CRM: tylko `ok` jest zielony, tylko `error` czerwony", () => {
    expect(crmTone("ok")).toBe("positive");
    expect(crmTone("error")).toBe("negative");
    expect(crmTone("pending")).toBe("neutral");
  });
});

describe("stan poczty do kandydata", () => {
  it("błąd wysyłki wygrywa nad wszystkim - to ślad do ponowienia", () => {
    expect(
      applicationMailState(clubApplicationAdminRow({ notify_error: "550 mailbox unavailable" })),
    ).toEqual({ kind: "error", message: "550 mailbox unavailable" });
  });

  it("brak statusu wysyłki znaczy „nie wysłano”", () => {
    expect(
      applicationMailState(clubApplicationAdminRow({ notified_status: null, notified_at: null })),
    ).toEqual({ kind: "none" });
  });

  it("status bez daty też znaczy „nie wysłano” - data jest dowodem wysyłki", () => {
    expect(applicationMailState(clubApplicationAdminRow({ notified_at: null })).kind).toBe("none");
  });

  it("wysłano: niesie DATĘ i status, KTÓREGO wysyłka dotyczyła", () => {
    expect(
      applicationMailState(
        clubApplicationAdminRow({ notified_status: "accepted", notified_at: CLUB_BASE_ISO }),
      ),
    ).toEqual({ kind: "sent", status: "accepted", iso: CLUB_BASE_ISO });
  });
});

describe("nazwy dwujęzyczne", () => {
  it("po angielsku wygrywa nazwa angielska, po polsku - polska", () => {
    const row = clubApplicationAdminRow();
    expect(applicationClubName(row, "en")).toBe("Energy club");
    expect(applicationClubName(row, "pl")).toBe("Klub energetyczny");
  });

  it("brak nazwy w języku operatora schodzi na drugi język, nie na pustkę", () => {
    expect(applicationClubName({ club_name_pl: "Klub", club_name_en: null }, "en")).toBe("Klub");
    expect(applicationClubName({ club_name_pl: "", club_name_en: "Club" }, "pl")).toBe("Club");
  });

  it("zgłoszenie bez klubu (sama specjalizacja) nie ma nazwy", () => {
    expect(applicationClubName({ club_name_pl: null, club_name_en: null }, "pl")).toBeNull();
    expect(applicationClubName({ club_name_pl: "", club_name_en: "" }, "en")).toBeNull();
  });

  it("etykieta katalogu zachowuje się tak samo", () => {
    expect(bilingualLabel({ label_pl: "Energia", label_en: "Energy" }, "en")).toBe("Energy");
    expect(bilingualLabel({ label_pl: "Energia", label_en: "" }, "en")).toBe("Energia");
    expect(bilingualLabel({ label_pl: "", label_en: "Energy" }, "pl")).toBe("Energy");
  });
});

describe("kartoteka kandydata", () => {
  it("ma czternaście pól, bez powtórzeń, a opisowe są na końcu", () => {
    expect(APPLICATION_DETAIL_FIELDS).toHaveLength(14);
    const fields = APPLICATION_DETAIL_FIELDS.map((entry) => entry.field);
    expect(new Set(fields).size).toBe(fields.length);
    expect(
      APPLICATION_DETAIL_FIELDS.filter((entry) => entry.wide).map((entry) => entry.field),
    ).toEqual(["expertise", "motivation", "goals", "contribution"]);
  });

  it("każde pole ma klucz etykiety ze słownika formularza zgłoszenia", () => {
    for (const entry of APPLICATION_DETAIL_FIELDS) {
      expect(entry.labelKey.startsWith("club.spec.apply."), entry.field).toBe(true);
    }
  });

  it("wartość wypełniona jedzie jako napis", () => {
    const row = clubApplicationAdminRow();
    expect(applicationDetailValue(row, "city")).toBe("Warszawa");
    expect(applicationDetailValue(row, "years_experience")).toBe("9");
  });

  it("pole puste i pole null znaczą to samo: nie pokazuj", () => {
    const row = clubApplicationAdminRow({ city: "", years_experience: null });
    expect(applicationDetailValue(row, "city")).toBeNull();
    expect(applicationDetailValue(row, "years_experience")).toBeNull();
  });

  it("ZERO lat doświadczenia to podana wartość, nie pustka", () => {
    expect(
      applicationDetailValue(clubApplicationAdminRow({ years_experience: 0 }), "years_experience"),
    ).toBe("0");
  });
});

describe("zakładki skrzynki", () => {
  const specs = [
    { slug: "energia-klimat", label_pl: "Energia i klimat", label_en: "Energy and climate" },
    { slug: "cyfryzacja", label_pl: "Cyfryzacja", label_en: "Digital" },
  ];

  it("zapytania W LOCIE (brak danych) dają samą zakładkę „wszystkie” z zerem", () => {
    expect(
      applicationSpecTabs({
        specs: undefined,
        counts: undefined,
        lang: "pl",
        allLabel: "Wszystkie",
      }),
    ).toEqual([{ slug: "", label: "Wszystkie", pending: 0 }]);
  });

  it("licznik „wszystkich” jest sumą zaległości po specjalizacjach", () => {
    const counts = [
      clubApplicationCountRow({ specialization_slug: "energia-klimat", pending: 2 }),
      clubApplicationCountRow({ specialization_slug: "cyfryzacja", pending: 3, total: 3 }),
    ];
    expect(totalPending(counts)).toBe(5);
    expect(totalPending(undefined)).toBe(0);
    const tabs = applicationSpecTabs({ specs, counts, lang: "pl", allLabel: "Wszystkie" });
    expect(tabs[0]).toEqual({ slug: "", label: "Wszystkie", pending: 5 });
  });

  it("specjalizacja bez wpisu w licznikach ma ZERO, nie undefined", () => {
    const counts = [clubApplicationCountRow({ specialization_slug: "energia-klimat", pending: 2 })];
    const tabs = applicationSpecTabs({ specs, counts, lang: "pl", allLabel: "Wszystkie" });
    expect(tabs[1]).toEqual({ slug: "energia-klimat", label: "Energia i klimat", pending: 2 });
    expect(tabs[2]).toEqual({ slug: "cyfryzacja", label: "Cyfryzacja", pending: 0 });
    expect(pendingBySpec(counts).get("cyfryzacja")).toBeUndefined();
    expect(pendingBySpec(undefined).size).toBe(0);
  });

  it("etykiety zakładek idą w języku operatora", () => {
    const tabs = applicationSpecTabs({
      specs,
      counts: undefined,
      lang: "en",
      allLabel: "All",
    });
    expect(tabs.map((tab) => tab.label)).toEqual(["All", "Energy and climate", "Digital"]);
  });

  it("zakładka „wszystkie” jest PIERWSZA i ma pusty slug - brak filtra to widok", () => {
    const tabs = applicationSpecTabs({
      specs,
      counts: undefined,
      lang: "pl",
      allLabel: "Wszystkie",
    });
    expect(tabs[0].slug).toBe("");
    expect(tabs.filter((tab) => tab.slug === "")).toHaveLength(1);
  });
});

describe("kontrakt typów statusu", () => {
  it("każdy status ze słownika daje się użyć jako ClubApplicationStatus", () => {
    const statuses: readonly ClubApplicationStatus[] = APPLICATION_STATUSES;
    expect(statuses).toHaveLength(5);
  });
});

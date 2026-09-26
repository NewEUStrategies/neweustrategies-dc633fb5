// Czyste reguły FORMULARZA KLONU EDYCJI.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. `?from=` BEZ WALIDACJI. Adres przeklejony z literówką poleciałby do RPC
//      jako nie-UUID i skończył się `22P02`, z którego organizator nie dowie
//      się niczego.
//   2. ROK W TYTULE. „Kongres 2026" ma się stać „Kongres 2027" - a tytuł bez
//      roku ma zostać nietknięty (dopisany rok byłby zgadywaniem).
//   3. DOMYŚLNE Z DWÓCH ŹRÓDEŁ. Szkic ma startować z przełączników oddanych
//      przez bazę; własna lista w TS rozjechałaby się z `_event_clone_settings`.
//   4. WALIDACJA INNA NIŻ BAZA. Każdy powód odmowy odpowiada odmowie SQL; reguła
//      luźniejsza wypuszcza szkic, który baza odrzuci, a ostrzejsza blokuje
//      szkic, który by przeszedł.
//   5. ADRES ZAPISÓW WYSŁANY BEZ ZMIANY. Niezmieniony adres zewnętrzny ma NIE
//      jechać - wtedy baza (słusznie) ostrzega, że prowadzi do poprzedniej edycji.
import { describe, expect, it } from "vitest";

import { freezeClock } from "@/test/time";
import { CLONE_SOURCE_ID, clonePreview } from "@/test/events/eventCloneFixtures";
import {
  cloneDraftFromPreview,
  cloneDraftToInput,
  cloneSourceContext,
  eventCloneIssue,
  parseCloneSearch,
  suggestEditionTitle,
  type EventCloneDraft,
} from "@/lib/events/eventCloneDraft";

freezeClock();

function draft(overrides: Partial<EventCloneDraft> = {}): EventCloneDraft {
  return { ...cloneDraftFromPreview(clonePreview()), ...overrides };
}

describe("parseCloneSearch - ?from=", () => {
  it("przepuszcza UUID (znormalizowany do małych liter i bez spacji)", () => {
    expect(parseCloneSearch({ from: ` ${CLONE_SOURCE_ID.toUpperCase()} ` })).toEqual({
      from: CLONE_SOURCE_ID,
    });
  });

  it.each([[{}], [{ from: "kongres-2026" }], [{ from: 42 }], [{ from: "" }]])(
    "odrzuca wszystko inne: %j",
    (search) => {
      expect(parseCloneSearch(search)).toEqual({});
    },
  );
});

describe("suggestEditionTitle", () => {
  it.each([
    ["Kongres 2026", "Kongres 2027"],
    ["Forum 2025/2026", "Forum 2026/2027"],
    ["Szczyt 1999", "Szczyt 2000"],
    ["Kongres Bezpieczeństwa", "Kongres Bezpieczeństwa"],
    ["Sala 12026", "Sala 12026"],
  ])("%s -> %s", (from, to) => {
    expect(suggestEditionTitle(from)).toBe(to);
  });
});

describe("cloneDraftFromPreview", () => {
  it("tytuły z podbitym rokiem, termin i strefa z bazy, przełączniki z podglądu", () => {
    const initial = cloneDraftFromPreview(clonePreview());
    expect(initial).toEqual({
      titlePl: "Kongres 2027",
      titleEn: "Congress 2027",
      slug: "",
      startsAt: "2100-03-20T08:00:00.000Z",
      endsAt: "",
      timezone: "Europe/Warsaw",
      externalRegistrationUrl: "",
      include: clonePreview().include,
      flags: {
        includeCancelledSessions: false,
        sessionsAsDraft: false,
        sponsorsUnpublished: true,
        keepAccessCodes: false,
        refreshSponsorSnapshots: true,
        crmRenewalTasks: false,
        cfpReviewers: false,
      },
      codeSuffix: "-2100",
      crmTaskDueDays: "30",
    });
  });

  it("bez podpowiedzi terminu: pusty początek i pusty przyrostek; adres zewnętrzny ze źródła", () => {
    const base = clonePreview();
    const initial = cloneDraftFromPreview(
      clonePreview({
        target: { ...base.target, suggestedStartsAt: null },
        source: { ...base.source, externalRegistrationUrl: "https://tickets.example.org/2026" },
      }),
    );
    expect(initial.startsAt).toBe("");
    expect(initial.codeSuffix).toBe("");
    expect(initial.externalRegistrationUrl).toBe("https://tickets.example.org/2026");
  });

  it("szkic ma WŁASNĄ kopię przełączników - zmiana nie przecieka do podglądu źródła", () => {
    const preview = clonePreview();
    const initial = cloneDraftFromPreview(preview);
    initial.include.agenda = false;
    expect(preview.include.agenda).toBe(true);
  });
});

describe("eventCloneIssue - lustro odmów SQL", () => {
  it("poprawny szkic przechodzi (bez końca i z końcem po początku)", () => {
    expect(eventCloneIssue(draft(), false)).toBeNull();
    expect(eventCloneIssue(draft({ endsAt: "2100-03-21T17:00:00.000Z" }), false)).toBeNull();
  });

  it.each<[string, Partial<EventCloneDraft>, boolean, string]>([
    ["pusty tytuł PL", { titlePl: "  " }, false, "adminEventClone.issues.titles"],
    ["pusty tytuł EN", { titleEn: "" }, false, "adminEventClone.issues.titles"],
    ["tytuł PL > 200", { titlePl: "x".repeat(201) }, false, "adminEventClone.issues.titleLength"],
    ["tytuł EN > 200", { titleEn: "y".repeat(201) }, false, "adminEventClone.issues.titleLength"],
    ["brak początku", { startsAt: "" }, false, "adminEventClone.issues.startsAt"],
    ["koniec przed początkiem", { endsAt: "2100-03-19T08:00:00.000Z" }, false, "adminEventClone.issues.endsAt"],
    ["koniec równy początkowi", { endsAt: "2100-03-20T08:00:00.000Z" }, false, "adminEventClone.issues.endsAt"],
    ["koniec nie jest datą", { endsAt: "jutro" }, false, "adminEventClone.issues.endsAt"],
    ["brak strefy", { timezone: " " }, false, "adminEventClone.issues.timezone"],
    ["slug ze spacją", { slug: "zly slug" }, false, "adminEventClone.issues.slug"],
    ["slug za krótki", { slug: "ab" }, false, "adminEventClone.issues.slug"],
    ["zapisy zewnętrzne bez adresu", { externalRegistrationUrl: "" }, true, "adminEventClone.issues.externalUrl"],
    ["adres bez https", { externalRegistrationUrl: "http://x.example.org" }, true, "adminEventClone.issues.externalUrlInvalid"],
    ["adres za długi", { externalRegistrationUrl: `https://${"a".repeat(2050)}` }, true, "adminEventClone.issues.externalUrlInvalid"],
  ])("%s", (_name, patch, external, expected) => {
    expect(eventCloneIssue(draft(patch), external)).toBe(expected);
  });

  it("slug wielkimi literami jest poprawny (normalizacja jak przy wysyłce)", () => {
    expect(eventCloneIssue(draft({ slug: "Kongres-2027" }), false)).toBeNull();
  });

  it("adres zapisów sprawdzany TYLKO dla źródła z zapisami zewnętrznymi", () => {
    expect(eventCloneIssue(draft({ externalRegistrationUrl: "" }), false)).toBeNull();
    expect(eventCloneIssue(draft({ externalRegistrationUrl: "https://t.example.org/x" }), true)).toBeNull();
  });

  it("przyrostek kodów sprawdzany tylko przy kopiowaniu kodów", () => {
    const withCodes = draft({ include: { ...clonePreview().include, codes: true } });
    expect(eventCloneIssue({ ...withCodes, codeSuffix: "-2027" }, false)).toBeNull();
    expect(eventCloneIssue({ ...withCodes, codeSuffix: "vip_27" }, false)).toBeNull();
    expect(eventCloneIssue({ ...withCodes, codeSuffix: "" }, false)).toBe("adminEventClone.issues.codeSuffix");
    expect(eventCloneIssue({ ...withCodes, codeSuffix: "z spacja" }, false)).toBe(
      "adminEventClone.issues.codeSuffix",
    );
    expect(eventCloneIssue(draft({ codeSuffix: "" }), false)).toBeNull();
  });

  it("termin zadań CRM: pełne dni 1-365, tylko gdy zadania są włączone", () => {
    const flags = { ...draft().flags, crmRenewalTasks: true };
    for (const ok of ["1", "30", "365", " 14 "]) {
      expect(eventCloneIssue(draft({ flags, crmTaskDueDays: ok }), false), ok).toBeNull();
    }
    for (const bad of ["0", "366", "1.5", "-3", "", "abc", "1000"]) {
      expect(eventCloneIssue(draft({ flags, crmTaskDueDays: bad }), false), bad).toBe(
        "adminEventClone.issues.dueDays",
      );
    }
    expect(eventCloneIssue(draft({ crmTaskDueDays: "0" }), false)).toBeNull();
  });
});

describe("cloneSourceContext", () => {
  it("tryb zewnętrzny i adres źródła z podglądu", () => {
    const base = clonePreview();
    expect(cloneSourceContext(base)).toEqual({ id: CLONE_SOURCE_ID, externalMode: false, externalUrl: null });
    expect(
      cloneSourceContext(
        clonePreview({
          source: { ...base.source, registrationMode: "external", externalRegistrationUrl: "https://t/x" },
        }),
      ),
    ).toEqual({ id: CLONE_SOURCE_ID, externalMode: true, externalUrl: "https://t/x" });
  });
});

describe("cloneDraftToInput", () => {
  const plain = { id: CLONE_SOURCE_ID, externalMode: false, externalUrl: null };
  const external = { id: CLONE_SOURCE_ID, externalMode: true, externalUrl: "https://tickets.example.org/2026" };

  it("przycięte pola, slug małymi literami, przyrostek wielkimi, termin jako liczba, klucz idempotencji", () => {
    const input = cloneDraftToInput(
      plain,
      draft({
        titlePl: "  Kongres 2027 ",
        titleEn: " Congress 2027",
        slug: " Kongres-2027 ",
        endsAt: "2100-03-21T17:00:00.000Z",
        codeSuffix: " -x27 ",
        crmTaskDueDays: "14",
      }),
      "event.clone:k1",
    );
    expect(input).toMatchObject({
      sourceEventId: CLONE_SOURCE_ID,
      titlePl: "Kongres 2027",
      titleEn: "Congress 2027",
      startsAt: "2100-03-20T08:00:00.000Z",
      endsAt: "2100-03-21T17:00:00.000Z",
      timezone: "Europe/Warsaw",
      slug: "kongres-2027",
      idempotencyKey: "event.clone:k1",
    });
    expect(input.options).toMatchObject({ codeSuffix: "-X27", crmTaskDueDays: 14, sponsorsUnpublished: true });
    expect(input.include).toEqual(clonePreview().include);
  });

  it("puste pola nie jadą; zły przyrostek = null, zły termin = 30 (podgląd nie odmawia)", () => {
    const input = cloneDraftToInput(
      plain,
      draft({ startsAt: "", endsAt: " ", timezone: "", slug: "", codeSuffix: "z spacja", crmTaskDueDays: "x" }),
    );
    for (const key of ["startsAt", "endsAt", "timezone", "slug", "externalRegistrationUrl", "idempotencyKey"]) {
      expect(input, key).not.toHaveProperty(key);
    }
    expect(input.options).toMatchObject({ codeSuffix: null, crmTaskDueDays: 30 });
  });

  it("adres zapisów jedzie TYLKO zmieniony i tylko w trybie zewnętrznym", () => {
    expect(
      cloneDraftToInput(external, draft({ externalRegistrationUrl: " https://tickets.example.org/2026 " })),
    ).not.toHaveProperty("externalRegistrationUrl");
    expect(
      cloneDraftToInput(external, draft({ externalRegistrationUrl: "https://tickets.example.org/2027" })),
    ).toHaveProperty("externalRegistrationUrl", "https://tickets.example.org/2027");
    expect(
      cloneDraftToInput({ ...external, externalUrl: null }, draft({ externalRegistrationUrl: "" })),
    ).not.toHaveProperty("externalRegistrationUrl");
    expect(
      cloneDraftToInput(plain, draft({ externalRegistrationUrl: "https://inny.example.org" })),
    ).not.toHaveProperty("externalRegistrationUrl");
  });
});

// Warstwa rekrutacyjna kontaktu: parsowanie zgłoszeń, historia z aliasów,
// bramka kształtu ścieżki CV i normalizacja linku zewnętrznego.
//
// Testy trzymają kontrakt, na którym stoją DWIE powierzchnie panelu (skrzynka
// /admin/careers i moduł „Rekrutacja" na karcie kontaktu CRM) oraz sanityzacja
// w server-fn - dlatego każde z tych zachowań ma tu własne oczekiwanie.
import { describe, expect, it } from "vitest";

import {
  CAREERS_FORM_ID,
  CAREER_STAGES,
  CAREER_STAGE_STYLE,
  aliasCustomValues,
  asCustomRecord,
  buildRecruitmentLayer,
  departmentLabel,
  fallbackApplicationMessage,
  isCareerCvPath,
  normalizeCvUrl,
  parseRecruitmentApplications,
  parseRecruitmentPipeline,
  seniorityLabel,
  stageLabel,
  startLabel,
} from "../recruitmentLayer";

const CV_PATH = "uploads/2026-08-14/2f9b3c14-77d1-4b0e-9d4e-8c2a1f6e0b55.pdf";

function application(over: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    form_id: CAREERS_FORM_ID,
    created_at: "2026-08-14T10:00:00.000Z",
    lang: "pl",
    message: "Chcę pracować nad agendą europejską.",
    custom: {
      department: "analysis",
      role: "analyst_economy",
      role_label: "Analityk gospodarczy",
      seniority: "mid",
      start: "month",
      linkedin: "https://linkedin.com/in/kandydat",
      cv_path: CV_PATH,
      cv_file_name: "cv-kandydat.pdf",
      cv_url: "",
    },
    ...over,
  };
}

describe("isCareerCvPath", () => {
  it("przyjmuje wyłącznie kształt generowany przez uploadCv", () => {
    expect(isCareerCvPath(CV_PATH)).toBe(true);
    expect(isCareerCvPath("uploads/2026-08-14/abc12345.docx")).toBe(true);
  });

  it("odrzuca ścieżki spoza prefiksu uploads i obce rozszerzenia", () => {
    // To jest bramka bezpieczeństwa: panel podpisuje ścieżkę bez pytania, więc
    // podmiana pola w żądaniu nie może dać linku do cudzego pliku.
    expect(isCareerCvPath("private/2026-08-14/inny-kandydat.pdf")).toBe(false);
    expect(isCareerCvPath("uploads/../secrets/dump.pdf")).toBe(false);
    expect(isCareerCvPath("uploads/2026-08-14/plik.exe")).toBe(false);
    expect(isCareerCvPath("")).toBe(false);
    expect(isCareerCvPath(undefined)).toBe(false);
  });
});

describe("normalizeCvUrl", () => {
  it("dokleja schemat do adresu bez protokołu", () => {
    // Bez tego <a href="linkedin.com/in/x"> w panelu jest URL-em RELATYWNYM.
    expect(normalizeCvUrl("linkedin.com/in/kandydat")).toBe("https://linkedin.com/in/kandydat");
  });

  it("zachowuje poprawny adres i odsiewa śmieci", () => {
    expect(normalizeCvUrl("https://drive.example.com/cv")).toBe("https://drive.example.com/cv");
    expect(normalizeCvUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeCvUrl("nie-adres")).toBeNull();
    expect(normalizeCvUrl("  ")).toBeNull();
  });
});

describe("asCustomRecord", () => {
  it("przepuszcza tylko wartości tekstowe", () => {
    expect(asCustomRecord({ a: "x", b: 7, c: null, d: { e: 1 } })).toEqual({ a: "x" });
  });

  it("znosi kształty inne niż obiekt", () => {
    expect(asCustomRecord(null)).toEqual({});
    expect(asCustomRecord(["x"])).toEqual({});
    expect(asCustomRecord("x")).toEqual({});
  });
});

describe("aliasCustomValues", () => {
  it("czyta append-only historię z crm_leads.aliases.custom", () => {
    const aliases = {
      sources: ["contact-form:/zatrudniamy"],
      custom: { role_label: ["Analityk", "Analityk", "Redaktor"] },
    };
    expect(aliasCustomValues(aliases, "role_label")).toEqual(["Analityk", "Redaktor"]);
  });

  it("zwraca pustą listę dla brakującego lub obcego kształtu", () => {
    expect(aliasCustomValues({}, "role_label")).toEqual([]);
    expect(aliasCustomValues({ custom: "x" }, "role_label")).toEqual([]);
    expect(aliasCustomValues({ custom: { role_label: "x" } }, "role_label")).toEqual([]);
    expect(aliasCustomValues(null, "role_label")).toEqual([]);
  });
});

describe("parseRecruitmentApplications", () => {
  it("bierze tylko wiersze formularza rekrutacyjnego", () => {
    const rows = [
      application(),
      { id: "msg-2", form_id: "contact", created_at: "2026-08-13T10:00:00.000Z" },
      { id: "msg-3", created_at: "2026-08-12T10:00:00.000Z" },
    ];
    const parsed = parseRecruitmentApplications(rows);
    expect(parsed.map((a) => a.id)).toEqual(["msg-1"]);
  });

  it("mapuje pola custom na warstwę i sortuje od najnowszego", () => {
    const parsed = parseRecruitmentApplications([
      application({ id: "old", created_at: "2026-01-01T10:00:00.000Z" }),
      application({ id: "new", created_at: "2026-08-14T10:00:00.000Z" }),
    ]);
    expect(parsed.map((a) => a.id)).toEqual(["new", "old"]);
    expect(parsed[0]).toMatchObject({
      role: "analyst_economy",
      roleLabel: "Analityk gospodarczy",
      department: "analysis",
      seniority: "mid",
      start: "month",
      cvPath: CV_PATH,
      cvFileName: "cv-kandydat.pdf",
    });
  });

  it("zeruje ścieżkę CV o nieznanym kształcie, zamiast ją podpisywać", () => {
    const parsed = parseRecruitmentApplications([
      application({ custom: { cv_path: "private/other-candidate.pdf" } }),
    ]);
    expect(parsed[0].cvPath).toBe("");
  });

  it("normalizuje link zewnętrzny podany bez schematu", () => {
    const parsed = parseRecruitmentApplications([
      application({ custom: { cv_url: "drive.example.com/cv" } }),
    ]);
    expect(parsed[0].cvUrl).toBe("https://drive.example.com/cv");
  });

  it("domyśla brakującą rolę jako zgłoszenie spontaniczne", () => {
    const parsed = parseRecruitmentApplications([application({ custom: {} })]);
    expect(parsed[0].role).toBe("open");
  });
});

describe("buildRecruitmentLayer", () => {
  it("składa liczniki i daty ze zgłoszeń", () => {
    const layer = buildRecruitmentLayer({
      aliases: { custom: { role_label: ["Analityk gospodarczy"] } },
      messages: [
        application({ id: "a", created_at: "2026-03-01T09:00:00.000Z" }),
        application({ id: "b", created_at: "2026-08-14T10:00:00.000Z" }),
      ],
    });
    expect(layer.hasHistory).toBe(true);
    expect(layer.applicationCount).toBe(2);
    expect(layer.firstAppliedAt).toBe("2026-03-01T09:00:00.000Z");
    expect(layer.lastAppliedAt).toBe("2026-08-14T10:00:00.000Z");
    expect(layer.roleLabels).toEqual(["Analityk gospodarczy"]);
  });

  it("widzi historię z aliasów, gdy zgłoszenie zostało usunięte ze skrzynki", () => {
    const layer = buildRecruitmentLayer({
      aliases: { custom: { role_label: ["Redaktor prowadzący"], seniority: ["senior"] } },
      messages: [],
    });
    expect(layer.hasHistory).toBe(true);
    expect(layer.applicationCount).toBe(0);
    expect(layer.firstAppliedAt).toBeNull();
  });

  it("kontakt bez śladu rekrutacyjnego nie ma historii", () => {
    const layer = buildRecruitmentLayer({ aliases: { sources: ["newsletter"] }, messages: [] });
    expect(layer.hasHistory).toBe(false);
    expect(layer.applicationCount).toBe(0);
  });
});

describe("etykiety", () => {
  it("tłumaczą slug w obu językach panelu", () => {
    expect(departmentLabel("analysis", "pl")).toBe("Analizy");
    expect(departmentLabel("analysis", "en")).toBe("Research");
    expect(seniorityLabel("mid", "pl")).toBe("Specjalista");
    expect(startLabel("immediately", "en")).toBe("Immediately");
  });

  it("pokazują nieznany slug surowo, a puste pole jako puste", () => {
    expect(departmentLabel("kosmos", "pl")).toBe("kosmos");
    expect(departmentLabel("", "pl")).toBe("");
    expect(seniorityLabel(undefined, "pl")).toBe("");
  });
});

describe("fallbackApplicationMessage", () => {
  it("streszcza dopasowanie, gdy kandydat nie napisał uzasadnienia", () => {
    // `contact_messages.message` jest wymagane w zod server-fn, w polityce pól
    // tenanta i w kolumnie - puste „Dlaczego Ty" wywracało całą wysyłkę.
    const text = fallbackApplicationMessage({
      lang: "pl",
      roleLabel: "Analityk gospodarczy",
      department: "analysis",
      seniority: "mid",
      start: "month",
    });
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("Analityk gospodarczy");
    expect(text).toContain("Analizy");
    expect(text).toContain("Specjalista");
    expect(text).toContain("W ciągu miesiąca");
  });

  it("jest niepusty także przy zgłoszeniu bez żadnego dopasowania", () => {
    const text = fallbackApplicationMessage({
      lang: "en",
      roleLabel: "",
      department: "",
      seniority: "",
      start: "",
    });
    expect(text.trim().length).toBeGreaterThan(0);
  });
});

describe("isCareerCvPath: konwencja z tenantem i legacy", () => {
  it("przyjmuje sciezke z tenantem (konwencja obowiazujaca)", () => {
    expect(
      isCareerCvPath(
        "11111111-1111-1111-1111-111111111111/uploads/2026-08-14/aaaaaaaa-1111-2222-3333-444444444444.pdf",
      ),
    ).toBe(true);
  });

  it("nadal przyjmuje sciezke legacy bez tenanta", () => {
    // Plikow sprzed zmiany konwencji NIE przenosimy (UPDATE storage.objects.name
    // rozjechalby wiersz z plikiem), wiec musza dalej przechodzic walidacje.
    expect(isCareerCvPath("uploads/2026-08-14/aaaaaaaa-1111-2222-3333-444444444444.pdf")).toBe(
      true,
    );
  });

  it("odrzuca obcy prefiks udajacy tenanta", () => {
    expect(isCareerCvPath("../../etc/uploads/2026-08-14/aaaaaaaa-1111-2222-3333-4444.pdf")).toBe(
      false,
    );
    expect(
      isCareerCvPath("nie-uuid/uploads/2026-08-14/aaaaaaaa-1111-2222-3333-444444444444.pdf"),
    ).toBe(false);
  });
});

describe("warstwa procesu (pipeline)", () => {
  const PIPELINE = {
    id: "app-1",
    stage: "interview",
    stage_changed_at: "2026-08-14T12:00:00.000Z",
    stage_note: "Po rozmowie wstepnej.",
    rating: 4,
    rejection_reason: "",
    next_step_at: null,
    owner_id: null,
  };

  it("znosi kształt obiektu i jednoelementowej tablicy", () => {
    // PostgREST zwraca osadzona relacje raz tak, raz tak - zaleznie od tego, jak
    // wykryje kardynalnosc.
    expect(parseRecruitmentPipeline(PIPELINE)?.stage).toBe("interview");
    expect(parseRecruitmentPipeline([PIPELINE])?.stage).toBe("interview");
    expect(parseRecruitmentPipeline(null)).toBeNull();
    expect(parseRecruitmentPipeline(undefined)).toBeNull();
    expect(parseRecruitmentPipeline([])).toBeNull();
  });

  it("rozpoznaje etapy domkniete - od nich liczy sie retencja CV", () => {
    expect(parseRecruitmentPipeline({ ...PIPELINE, stage: "rejected" })?.closed).toBe(true);
    expect(parseRecruitmentPipeline({ ...PIPELINE, stage: "hired" })?.closed).toBe(true);
    expect(parseRecruitmentPipeline({ ...PIPELINE, stage: "withdrawn" })?.closed).toBe(true);
    expect(parseRecruitmentPipeline({ ...PIPELINE, stage: "interview" })?.closed).toBe(false);
    expect(parseRecruitmentPipeline({ ...PIPELINE, stage: "new" })?.closed).toBe(false);
  });

  it("nieznany etap degraduje do new, zamiast wywracac panel", () => {
    expect(parseRecruitmentPipeline({ ...PIPELINE, stage: "kosmos" })?.stage).toBe("new");
    expect(parseRecruitmentPipeline({ ...PIPELINE, stage: null })?.stage).toBe("new");
  });

  it("doklada etap do zgloszenia w warstwie", () => {
    const parsed = parseRecruitmentApplications([
      { ...application(), career_applications: PIPELINE },
    ]);
    expect(parsed[0].pipeline?.stage).toBe("interview");
    expect(parsed[0].pipeline?.rating).toBe(4);
  });

  it("zgloszenie bez joina ma pipeline null, a nie blad", () => {
    expect(parseRecruitmentApplications([application()])[0].pipeline).toBeNull();
  });

  it("tlumaczy etykiety etapow w obu jezykach", () => {
    expect(stageLabel("screening", "pl")).toBe("Wstępna selekcja");
    expect(stageLabel("screening", "en")).toBe("Screening");
    expect(stageLabel("", "pl")).toBe("");
  });

  it("kazdy etap ma etykiete i kolor - lista enuma nie moze sie rozjechac z UI", () => {
    for (const stage of CAREER_STAGES) {
      expect(stageLabel(stage, "pl")).not.toBe(stage);
      expect(stageLabel(stage, "en")).not.toBe(stage);
      expect(CAREER_STAGE_STYLE[stage]).toBeTruthy();
    }
  });
});

describe("cv_purged_at", () => {
  it("przenosi znacznik usuniecia przez retencje", () => {
    // Retencja zdejmuje cv_path i zostawia ten znacznik - panel musi odroznic
    // "kandydat nie dal CV" od "CV skasowalismy zgodnie z polityka".
    const parsed = parseRecruitmentApplications([
      application({ custom: { cv_purged_at: "2026-08-14" } }),
    ]);
    expect(parsed[0].cvPath).toBe("");
    expect(parsed[0].cvPurgedAt).toBe("2026-08-14");
  });
});

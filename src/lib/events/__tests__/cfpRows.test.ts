// Reguły ekranów naboru (strony listy, średnie, przyciski, stan maila,
// odpowiedzi) oraz zbiory i etykiety z `cfpEnums`.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW: każda z tych reguł, zgubiona, daje
// uczestnikowi albo organizatorowi zły ekran bez jednego błędu w konsoli.
import { describe, expect, it } from "vitest";

import {
  asOneOf,
  CFP_DECIDABLE_STATUSES,
  CFP_RECOMMENDATION_LABEL_KEYS,
  CFP_SPEAKER_ROLE_LABEL_KEYS,
  CFP_SUBMISSION_STATUS_LABEL_KEYS,
  CFP_SUBMISSION_STATUSES,
  CFP_TALK_LANGUAGE_LABEL_KEYS,
  localizedPair,
  SPEAKER_MATERIAL_KIND_LABEL_KEYS,
  SPEAKER_MATERIAL_VISIBILITY_LABEL_KEYS,
} from "@/lib/events/cfpEnums";
import {
  cfpAnswerDisplay,
  cfpNoticeFor,
  cfpNotifyFeedback,
  cfpNotifyState,
  cfpPageCount,
  cfpPageRange,
  countsTowardsCfpLimit,
  formatCfpScore,
  isCfpDecidable,
  isCfpEditable,
  isCfpRespondable,
  isCfpWithdrawable,
} from "@/lib/events/cfpRows";

describe("cfpEnums", () => {
  it("zawężenie napisu do zbioru z wartością awaryjną", () => {
    expect(asOneOf(CFP_SUBMISSION_STATUSES, "accepted", "draft")).toBe("accepted");
    expect(asOneOf(CFP_SUBMISSION_STATUSES, "nope", "draft")).toBe("draft");
    expect(asOneOf(CFP_SUBMISSION_STATUSES, 5, "draft")).toBe("draft");
  });

  it("para językowa: język interfejsu, a przy pustym - drugi", () => {
    expect(localizedPair("pl", "PL", "EN")).toBe("PL");
    expect(localizedPair("en", "PL", "EN")).toBe("EN");
    expect(localizedPair("en", "PL", "")).toBe("PL");
    expect(localizedPair("pl", "", "EN")).toBe("EN");
  });

  it("mapy etykiet mają dosłowny klucz dla każdej wartości", () => {
    for (const status of CFP_SUBMISSION_STATUSES) {
      expect(CFP_SUBMISSION_STATUS_LABEL_KEYS[status]).toBe(`eventCfp.statuses.${status}`);
    }
    expect(Object.values(CFP_SPEAKER_ROLE_LABEL_KEYS)).toHaveLength(4);
    expect(Object.values(CFP_RECOMMENDATION_LABEL_KEYS)).toHaveLength(4);
    expect(Object.values(CFP_TALK_LANGUAGE_LABEL_KEYS)).toHaveLength(2);
    expect(Object.values(SPEAKER_MATERIAL_KIND_LABEL_KEYS)).toHaveLength(4);
    expect(Object.values(SPEAKER_MATERIAL_VISIBILITY_LABEL_KEYS)).toHaveLength(3);
  });
});

describe("strony listy i średnie", () => {
  it("liczba stron i zakres", () => {
    expect(cfpPageCount(0, 25)).toBe(1);
    expect(cfpPageCount(26, 25)).toBe(2);
    expect(cfpPageCount(10, 0)).toBe(1);
    expect(cfpPageRange(0, 25, 0)).toEqual({ from: 0, to: 0 });
    expect(cfpPageRange(1, 25, 30)).toEqual({ from: 26, to: 30 });
    expect(cfpPageRange(0, 25, 60)).toEqual({ from: 1, to: 25 });
  });

  it("średnia z jedną cyfrą po przecinku w konwencji języka", () => {
    expect(formatCfpScore(4.25, "pl")).toBe("4,3");
    expect(formatCfpScore(4, "en")).toBe("4.0");
    expect(formatCfpScore(null, "pl")).toBeNull();
    expect(formatCfpScore(Number.NaN, "pl")).toBeNull();
  });
});

describe("przyciski ze stanu", () => {
  it("decyzja organizatora", () => {
    for (const status of CFP_DECIDABLE_STATUSES) expect(isCfpDecidable(status)).toBe(true);
    expect(isCfpDecidable("accepted")).toBe(false);
    expect(isCfpDecidable("draft")).toBe(false);
  });

  it("mail tylko o przyjęciu, odmowie i prośbie o zmiany", () => {
    expect(cfpNoticeFor("accepted")).toBe("accepted");
    expect(cfpNoticeFor("changes_requested")).toBe("changes_requested");
    expect(cfpNoticeFor("waitlisted")).toBeNull();
  });

  it("kroki prelegenta", () => {
    expect(isCfpEditable("draft")).toBe(true);
    expect(isCfpEditable("changes_requested")).toBe(true);
    expect(isCfpEditable("submitted")).toBe(false);
    expect(isCfpWithdrawable("submitted")).toBe(true);
    expect(isCfpWithdrawable("confirmed")).toBe(true);
    expect(isCfpWithdrawable("rejected")).toBe(false);
    expect(isCfpWithdrawable("withdrawn")).toBe(false);
    expect(isCfpWithdrawable("declined")).toBe(false);
    expect(isCfpRespondable("accepted")).toBe(true);
    expect(isCfpRespondable("confirmed")).toBe(false);
    expect(countsTowardsCfpLimit("withdrawn")).toBe(false);
    expect(countsTowardsCfpLimit("draft")).toBe(true);
  });
});

describe("stan maila do prelegenta", () => {
  const base = {
    status: "accepted" as const,
    notifiedStatus: null,
    notifiedAt: null,
    notifyError: null,
    decidedAt: "2026-09-02T10:00:00+00:00",
  };

  it("nie dotyczy stanów bez maila", () => {
    expect(cfpNotifyState({ ...base, status: "under_review" })).toBe("notApplicable");
  });

  it("błąd wysyłki wygrywa", () => {
    expect(cfpNotifyState({ ...base, notifyError: "x" })).toBe("failed");
  });

  it("czeka: brak wysyłki, mail o innym stanie albo sprzed nowej decyzji", () => {
    expect(cfpNotifyState(base)).toBe("pending");
    expect(cfpNotifyState({ ...base, notifiedStatus: "rejected", notifiedAt: "2026-09-03T00:00:00Z" })).toBe(
      "pending",
    );
    expect(cfpNotifyState({ ...base, notifiedStatus: "accepted", notifiedAt: "2026-09-01T00:00:00Z" })).toBe(
      "pending",
    );
  });

  it("aktualny: mail o obecnym stanie po ostatniej decyzji (albo bez stempla decyzji)", () => {
    expect(cfpNotifyState({ ...base, notifiedStatus: "accepted", notifiedAt: "2026-09-03T00:00:00Z" })).toBe(
      "upToDate",
    );
    expect(
      cfpNotifyState({ ...base, decidedAt: null, notifiedStatus: "accepted", notifiedAt: "2026-09-03T00:00:00Z" }),
    ).toBe("upToDate");
  });

  it("wynik funkcji serwerowej -> komunikat", () => {
    expect(cfpNotifyFeedback({ ok: true })).toBe("sent");
    expect(cfpNotifyFeedback({ ok: true, skipped: "duplicate" })).toBe("sent");
    expect(cfpNotifyFeedback({ ok: true, skipped: "not_applicable" })).toBe("skipped");
    expect(cfpNotifyFeedback({ ok: false, error: "x" })).toBe("failed");
  });
});

describe("odpowiedzi na pytania", () => {
  const options = [
    { value: "a", labelPl: "Opcja A", labelEn: "Option A" },
    { value: "b", labelPl: "", labelEn: "Only EN" },
    { value: "c", labelPl: "", labelEn: "" },
    { value: "d", labelPl: "Tylko PL", labelEn: "" },
  ];

  it("pusta odpowiedź", () => {
    for (const value of [undefined, null, ""]) {
      expect(cfpAnswerDisplay({ fieldType: "text", options: [] }, value, "pl")).toEqual({ kind: "empty" });
    }
  });

  it("tak/nie", () => {
    expect(cfpAnswerDisplay({ fieldType: "checkbox", options: [] }, true, "pl")).toEqual({ kind: "yes" });
    expect(cfpAnswerDisplay({ fieldType: "checkbox", options: [] }, "true", "pl")).toEqual({ kind: "yes" });
    expect(cfpAnswerDisplay({ fieldType: "checkbox", options: [] }, false, "pl")).toEqual({ kind: "no" });
  });

  it("wybory: etykiety w języku UI, nieznana wartość zostaje wartością", () => {
    expect(cfpAnswerDisplay({ fieldType: "multiselect", options }, ["a", "b", "c", "z", 1], "pl")).toEqual({
      kind: "list",
      values: ["Opcja A", "Only EN", "c", "z"],
    });
    expect(cfpAnswerDisplay({ fieldType: "multiselect", options }, [], "pl")).toEqual({ kind: "empty" });
    expect(cfpAnswerDisplay({ fieldType: "multiselect", options }, "a", "pl")).toEqual({ kind: "empty" });
    expect(cfpAnswerDisplay({ fieldType: "select", options }, "a", "en")).toEqual({ kind: "text", value: "Option A" });
    expect(cfpAnswerDisplay({ fieldType: "select", options }, 3, "en")).toEqual({ kind: "empty" });
    expect(cfpAnswerDisplay({ fieldType: "select", options }, "d", "en")).toEqual({ kind: "text", value: "Tylko PL" });
    expect(cfpAnswerDisplay({ fieldType: "select", options }, "c", "en")).toEqual({ kind: "text", value: "c" });
  });

  it("adres jest odnośnikiem tylko przy https", () => {
    expect(cfpAnswerDisplay({ fieldType: "url", options: [] }, "https://x.pl", "pl")).toEqual({
      kind: "url",
      value: "https://x.pl",
    });
    expect(cfpAnswerDisplay({ fieldType: "url", options: [] }, "javascript:alert(1)", "pl")).toEqual({
      kind: "text",
      value: "javascript:alert(1)",
    });
  });

  it("liczby i teksty", () => {
    expect(cfpAnswerDisplay({ fieldType: "number", options: [] }, 12, "pl")).toEqual({ kind: "text", value: "12" });
    expect(cfpAnswerDisplay({ fieldType: "textarea", options: [] }, "abc", "pl")).toEqual({
      kind: "text",
      value: "abc",
    });
  });
});

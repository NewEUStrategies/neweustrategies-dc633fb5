// Nakładka panelu giełdy spotkań (`i18n-admin-event-meetings`): gałąź
// `eventMeetings.errors.*` bez czytelnika.
//
// Odmowy giełdy mają DWÓCH czytelników i każdy ma własną gałąź słownika:
//   * front uczestnika - `meetingErrorI18nKey` składa
//     `eventMeetings.errors.<klucz bazy>` wyłącznie z `MEETING_ERROR_KEYS`,
//     czyli ze snake_case (albo jednego słowa: `forbidden`, `unknown`);
//     właścicielem tej gałęzi jest `i18n-event-meetings`;
//   * panel organizatora - `adminMeetingFailure` składa
//     `adminEventMeetings.errors.<camelCase>`.
// Nakładka panelu niosła TRZECIĄ kopię: 36 zdań na język pod
// `eventMeetings.errors.<camelCase>` (`notFound`, `tableBusy`…). Żadna z dwóch
// dróg do niej nie prowadzi, a dosłownego `t("eventMeetings.errors.…")` nie ma
// w kodzie wcale - więc była to martwa, rozjechana kopia zdań uczestnika
// (np. „Nie znaleziono tego wydarzenia." obok żywego „Nie znaleziono tego
// spotkania."), ładowana do magazynu przy każdym wejściu do panelu.
import { describe, expect, it } from "vitest";
import { adminEventMeetingsEn, adminEventMeetingsPl } from "@/lib/i18n-admin-event-meetings";
import { MEETING_ERROR_KEYS, meetingErrorI18nKey } from "@/lib/events/meetingsErrors";
import { adminMeetingFailure } from "@/lib/events/adminMeetingErrors";

const BUNDLES = { pl: adminEventMeetingsPl, en: adminEventMeetingsEn } as const;

function branch(tree: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node !== null && typeof node === "object" ? Reflect.get(node, part) : undefined,
      tree,
    );
}

describe("i18n-admin-event-meetings - błędy uczestnika nie mieszkają w nakładce panelu", () => {
  it("klucz błędu uczestnika jest zawsze kluczem bazy (snake_case), nigdy camelCase", () => {
    // Kontrola drogi odczytu: gdyby `meetingErrorI18nKey` umiało oddać
    // camelCase, gałąź niżej miałaby czytelnika.
    for (const key of MEETING_ERROR_KEYS) {
      const i18nKey = meetingErrorI18nKey(new Error(`${key}: komunikat bazy`));
      expect(i18nKey).toBe(`eventMeetings.errors.${key}`);
      expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
    }
    // Odmowa w camelCase nie jest kluczem bazy - spada do komunikatu ogólnego.
    expect(meetingErrorI18nKey(new Error("tableBusy: x"))).toBe("eventMeetings.errors.unknown");
  });

  it("panel organizatora czyta własną gałąź `adminEventMeetings.errors`", () => {
    expect(adminMeetingFailure(new Error("table_busy: x")).key).toBe(
      "adminEventMeetings.errors.tableBusy",
    );
    expect(branch(adminEventMeetingsPl, "adminEventMeetings.errors.tableBusy")).toBeTypeOf(
      "string",
    );
  });

  it.each(["pl", "en"] as const)(
    "%s: nakładka panelu nie wnosi `eventMeetings.errors` - właścicielem jest i18n-event-meetings",
    (lang) => {
      const errors = branch(BUNDLES[lang], "eventMeetings.errors");
      const keys = errors !== null && typeof errors === "object" ? Object.keys(errors) : [];
      // Klucz spoza kontraktu bazy jest nieosiągalny; klucz z kontraktu
      // byłby kolizją z właścicielem (patrz `i18nOverlayIntegrity.gate.test.ts`).
      expect(keys).toEqual([]);
    },
  );
});

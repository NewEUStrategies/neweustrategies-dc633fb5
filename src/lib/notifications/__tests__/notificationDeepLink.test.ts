// Regresja na KONTRAKT KLIKNIĘCIA W BELCE POWIADOMIEŃ, potwierdzony na żywo
// w podglądzie: powiadomienie o wiadomości niesie href `/messages?c=<uuid>`,
// belka rozpoznaje go jako link wewnętrzny (nawigacja SPA, nie przeładowanie),
// wyciąga z niego id rozmówcy dla profilu aktora, a lista skleja wiele takich
// powiadomień w jedną pozycję rozmowy.
//
// Test celuje w te trzy moduły RAZEM, bo rozjazd między nimi (np. inny format
// href po stronie triggera bazy) nie psuje żadnego z nich osobno - psuje tylko
// przejście z dzwonka do właściwego kanału czatu, czyli dokładnie tę ścieżkę,
// której użytkownik używa.
import { describe, expect, it } from "vitest";
import { groupNotifications } from "../grouping";
import { isInternalHref, notificationActorId } from "../notificationLink";
import { CONSENT_KEYS, getConsentDefinition } from "../consentCatalog";
import type { NotificationRow } from "../useNotifications";

const CONV = "ce7fe774-39a9-45e7-a56f-551a3b71e768";
const HREF = `/messages?c=${CONV}`;

function row(over: Partial<NotificationRow> & { id: string }): NotificationRow {
  return {
    id: over.id,
    kind: over.kind ?? "message",
    href: "href" in over ? (over.href ?? null) : HREF,
    read_at: over.read_at ?? null,
    created_at: over.created_at ?? "2026-09-02T07:25:00.000Z",
    tenant_id: over.tenant_id ?? "tenant-1",
    user_id: over.user_id ?? "user-1",
    title_pl: over.title_pl ?? "Nowa wiadomość",
    title_en: over.title_en ?? "New message",
    body_pl: over.body_pl ?? null,
    body_en: over.body_en ?? null,
    icon: over.icon ?? null,
  };
}

describe("deep link powiadomienia o wiadomości", () => {
  it("href z triggera jest wewnętrzny i niesie id rozmowy", () => {
    expect(isInternalHref(HREF)).toBe(true);
    expect(notificationActorId(HREF)).toBe(CONV);
  });

  it("adres zewnętrzny nigdy nie oddaje id rozmowy", () => {
    expect(notificationActorId("//evil.example/messages?c=" + CONV)).toBeNull();
    expect(notificationActorId("https://evil.example/messages?c=" + CONV)).toBeNull();
    expect(notificationActorId(null)).toBeNull();
    expect(notificationActorId(undefined)).toBeNull();
    expect(notificationActorId("")).toBeNull();
  });

  it("kilka powiadomień tej samej rozmowy to jedna pozycja z licznikiem", () => {
    const groups = groupNotifications(
      [row({ id: "a" }), row({ id: "b" }), row({ id: "c", read_at: "2026-09-02T07:30:00.000Z" })],
      { groupByConversation: true },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.conversationId).toBe(CONV);
    expect(groups[0]?.unreadCount).toBe(2);
    expect(groups[0]?.latest.id).toBe("a");
  });

  it("bez grupowania każda pozycja zostaje osobno, ale zna swoją rozmowę", () => {
    const groups = groupNotifications([row({ id: "a" }), row({ id: "b" })], {
      groupByConversation: false,
    });
    expect(groups.map((g) => g.key)).toEqual(["n:a", "n:b"]);
    expect(groups.every((g) => g.isSingle && !g.isConversation)).toBe(true);
    expect(groups[0]?.conversationId).toBe(CONV);
  });

  it("inny rodzaj powiadomienia nie wpada do grupy rozmowy", () => {
    const groups = groupNotifications(
      [row({ id: "a" }), row({ id: "sys", kind: "system", href: "/profile/plan" })],
      { groupByConversation: true },
    );
    expect(groups).toHaveLength(2);
    expect(groups[1]?.conversationId).toBeNull();
    expect(groups[1]?.isConversation).toBe(false);
  });

  it("powiadomienie bez href jest pozycją pojedynczą", () => {
    const groups = groupNotifications([row({ id: "x", href: null })], {
      groupByConversation: true,
    });
    expect(groups[0]?.key).toBe("n:x");
    expect(groups[0]?.conversationId).toBeNull();
  });

  it("przeczytane powiadomienie spoza rozmowy ma zerowy licznik", () => {
    const groups = groupNotifications(
      [
        row({
          id: "s",
          kind: "system",
          href: "/profile/plan",
          read_at: "2026-09-02T07:30:00.000Z",
        }),
      ],
      { groupByConversation: true },
    );
    expect(groups[0]?.unreadCount).toBe(0);
    expect(groups[0]?.isConversation).toBe(false);
  });

  it("przeczytane powiadomienie nie podbija licznika", () => {
    const groups = groupNotifications([row({ id: "r", read_at: "2026-09-02T07:30:00.000Z" })], {
      groupByConversation: true,
    });
    expect(groups[0]?.unreadCount).toBe(0);
  });
});

describe("katalog zgód", () => {
  it("każdy klucz katalogu ma definicję z kategorią i wersją", () => {
    for (const key of CONSENT_KEYS) {
      const def = getConsentDefinition(key);
      expect(def, key).toBeDefined();
      expect(def?.category).toBeTruthy();
      expect(def?.version).toMatch(/^\d+\.\d+$/);
    }
  });

  it("nieznany klucz nie ma definicji", () => {
    expect(getConsentDefinition("nie_istnieje")).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import {
  EXPERT_PING_TITLE_EN,
  notificationSignalOf,
  signalToastFromRow,
  type SignalNotificationRow,
} from "../signalToast";

const NOW = Date.parse("2026-11-20T12:00:00.000Z");
const UID = "b0000000-0000-0000-0000-00000000000b";

const mention: SignalNotificationRow = {
  id: "n-1",
  user_id: UID,
  kind: "club",
  icon: "at-sign",
  href: "/club/klub?post=1",
  read_at: null,
  created_at: "2026-11-20T11:59:50.000Z",
  title_pl: "Anna wspomniał(a) o Tobie",
  title_en: "Anna mentioned you",
};

const ping: SignalNotificationRow = {
  id: "n-2",
  user_id: UID,
  kind: "club",
  icon: null,
  href: "/club/klub/t/temat",
  read_at: null,
  created_at: "2026-11-20T11:59:59.000Z",
  title_pl: "Poproszono Cie o zdanie",
  title_en: EXPERT_PING_TITLE_EN,
  body_pl: 'Anna prosi o Twoje zdanie w temacie "Temat".',
  body_en: 'Anna is asking for your view on "Temat".',
};

describe("notificationSignalOf", () => {
  it("wzmianka i prośba o zdanie to sygnały", () => {
    expect(notificationSignalOf(mention)).toBe("mention");
    expect(notificationSignalOf(ping)).toBe("expert_ping");
  });
  it("inne powiadomienia nie dają okienka", () => {
    expect(
      notificationSignalOf({ kind: "connection", title_en: "New connection request" }),
    ).toBeNull();
    expect(notificationSignalOf({ kind: "club", title_en: "New reply in your thread" })).toBeNull();
  });
  it("jawny znacznik meta.signal ma pierwszeństwo", () => {
    expect(notificationSignalOf({ kind: "content", meta: { signal: "expert_ping" } })).toBe(
      "expert_ping",
    );
  });
});

describe("signalToastFromRow", () => {
  it("prośba o zdanie: tytuł i treść w języku interfejsu", () => {
    expect(signalToastFromRow({ row: ping, userId: UID, lang: "en", nowMs: NOW })).toEqual({
      toastId: "signal:n-2",
      notificationId: "n-2",
      signal: "expert_ping",
      title: EXPERT_PING_TITLE_EN,
      description: 'Anna is asking for your view on "Temat".',
      href: "/club/klub/t/temat",
    });
  });
  it("wzmianka po polsku bez treści", () => {
    const toast = signalToastFromRow({ row: mention, userId: UID, lang: "pl", nowMs: NOW });
    expect(toast?.title).toBe("Anna wspomniał(a) o Tobie");
    expect(toast?.description).toBeNull();
  });
  it("cudzy, przeczytany albo stary wiersz nie daje okienka", () => {
    expect(
      signalToastFromRow({ row: mention, userId: "other", lang: "pl", nowMs: NOW }),
    ).toBeNull();
    expect(
      signalToastFromRow({
        row: { ...mention, read_at: "2026-11-20T11:59:55Z" },
        userId: UID,
        lang: "pl",
        nowMs: NOW,
      }),
    ).toBeNull();
    expect(
      signalToastFromRow({
        row: { ...mention, created_at: "2026-11-20T11:55:00.000Z" },
        userId: UID,
        lang: "pl",
        nowMs: NOW,
      }),
    ).toBeNull();
  });
  it("adres spoza aplikacji nie trafia do akcji okienka", () => {
    const toast = signalToastFromRow({
      row: { ...mention, href: "//evil.example/x" },
      userId: UID,
      lang: "pl",
      nowMs: NOW,
    });
    expect(toast?.href).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { eventDeleteFailureKey } from "@/lib/admin/eventDeleteErrors";
import { adminCommunityEventsEn, adminCommunityEventsPl } from "@/lib/i18n-admin-community-events";
import { readKey } from "@/lib/ci/i18nParity";

describe("eventDeleteFailureKey", () => {
  it("odmowa triggera `event_has_payments` ma własne zdanie (przegląd R45)", () => {
    const error = {
      message:
        "event_has_payments: this event has paid registrations or refund history - cancel the event instead of deleting it",
      code: "P0001",
    };
    expect(eventDeleteFailureKey(error)).toBe("adminCommunityEvents.toasts.deleteHasPayments");
    expect(eventDeleteFailureKey(new Error(error.message))).toBe(
      "adminCommunityEvents.toasts.deleteHasPayments",
    );
  });

  it("każda inna odmowa zostaje komunikatem bazy (bez zgadywania)", () => {
    expect(eventDeleteFailureKey(new Error("permission denied for table events"))).toBeNull();
    expect(eventDeleteFailureKey({ message: "event_has_payments_extra: x" })).toBeNull();
    expect(eventDeleteFailureKey(null)).toBeNull();
  });

  it("zdanie stoi w nakładce po polsku i po angielsku", () => {
    const key = "adminCommunityEvents.toasts.deleteHasPayments";
    expect(typeof readKey(adminCommunityEventsPl, key)).toBe("string");
    expect(typeof readKey(adminCommunityEventsEn, key)).toBe("string");
  });
});

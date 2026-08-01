// Guard: /api/public/nl-click nie może być otwartym przekierowaniem.
// Adres docelowy honorujemy wyłącznie z ważnym podpisem per-link (`k`).
import { describe, expect, it } from "vitest";
import { buildTrackedClickUrl } from "@/lib/newsletter/tracking";
import {
  signTrackingLink,
  verifyTrackingLink,
} from "@/lib/newsletter/trackingToken.server";

const CID = "11111111-1111-4111-8111-111111111111";
const SUB = "22222222-2222-4222-8222-222222222222";
const TARGET = "https://dest.example.com/a?x=1";

describe("tracked click link signature", () => {
  it("podpisany link z wysyłki przechodzi weryfikację", () => {
    const url = new URL(
      buildTrackedClickUrl("https://news.example.com", CID, "t", TARGET, (target) =>
        signTrackingLink(CID, SUB, target),
      ),
    );
    expect(verifyTrackingLink(CID, SUB, TARGET, url.searchParams.get("k"))).toBe(true);
  });

  it("podmieniony adres (phishing) nie przechodzi", () => {
    const sig = signTrackingLink(CID, SUB, TARGET);
    expect(verifyTrackingLink(CID, SUB, "https://phishing.example.com", sig)).toBe(false);
  });

  it("brak podpisu nie przechodzi", () => {
    expect(verifyTrackingLink(CID, SUB, TARGET, null)).toBe(false);
  });
});

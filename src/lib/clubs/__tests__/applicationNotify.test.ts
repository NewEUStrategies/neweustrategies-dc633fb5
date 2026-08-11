import { describe, expect, it } from "vitest";

import {
  NOTIFIABLE_STATUSES,
  emailTypeForStatus,
  isNotifiableStatus,
} from "@/lib/clubs/applicationNotify.functions";
import { txCopy, txSubject } from "@/lib/email-templates/tx-copy";
import { TX_EMAIL_CATEGORY } from "@/lib/email/suppressionPolicy";

describe("club application status notifications", () => {
  it("notifies only on decisions the candidate must learn about", () => {
    expect(isNotifiableStatus("accepted")).toBe(true);
    expect(isNotifiableStatus("rejected")).toBe(true);
    expect(isNotifiableStatus("needs_info")).toBe(true);
    expect(isNotifiableStatus("pending")).toBe(false);
    expect(isNotifiableStatus("review")).toBe(false);
  });

  it("maps every notifiable status to copy in both languages", () => {
    for (const status of NOTIFIABLE_STATUSES) {
      const type = emailTypeForStatus(status);
      for (const lang of ["pl", "en"] as const) {
        const copy = txCopy(type, lang);
        expect(copy.heading.length).toBeGreaterThan(5);
        expect(copy.intro.length).toBeGreaterThan(20);
        expect(copy.cta.length).toBeGreaterThan(3);
        expect(txSubject(type, lang, { subject: "Energetyka" })).toContain(
          "New European Strategies",
        );
      }
      // Poczta 1:1 wywołana działaniem odbiorcy - nie wysyłka za zgodą.
      expect(TX_EMAIL_CATEGORY[type]).toBe("transactional");
    }
  });

  it("keeps PL and EN copy distinct (no untranslated fallback)", () => {
    for (const status of NOTIFIABLE_STATUSES) {
      const type = emailTypeForStatus(status);
      expect(txCopy(type, "pl").heading).not.toBe(txCopy(type, "en").heading);
    }
  });
});

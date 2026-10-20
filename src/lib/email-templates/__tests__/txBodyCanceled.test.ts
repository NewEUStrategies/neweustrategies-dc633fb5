// P12: treść maila o rezygnacji ZALEŻNA OD DATY - migawki PL/EN.
//
// Mail wysłany w trakcie opłaconego okresu mówi „dostęp do {data}, możesz
// wznowić"; wysłany po końcu (koniec windykacji, kolejka) - „dostęp wygasł,
// możesz wrócić z cennika". Dawniej oba mówiły „wznów przed końcem okresu",
// także gdy okresu już nie było. Migawki pilnują pełnego brzmienia w obu
// językach i trzech rodzajach gramatycznych.
import { describe, expect, it } from "vitest";

import { txBody } from "@/lib/email-templates/tx-body";
import { TX_CANCELED_ENDED_CTA, txCopy } from "@/lib/email-templates/tx-copy";

const VARS = { planName: "Członek", accessUntil: "30.09.2026" };

describe("subscription_canceled - treść w trakcie i po końcu okresu", () => {
  it.each([
    ["pl", "male"],
    ["pl", "female"],
    ["pl", "unknown"],
    ["en", "unknown"],
  ] as const)("%s / %s: w trakcie okresu", (lang, gender) => {
    expect(
      txBody("subscription_canceled", lang, gender, { ...VARS, accessEnded: false }),
    ).toMatchSnapshot();
  });

  it.each([
    ["pl", "male"],
    ["pl", "female"],
    ["pl", "unknown"],
    ["en", "unknown"],
  ] as const)("%s / %s: po końcu dostępu", (lang, gender) => {
    expect(
      txBody("subscription_canceled", lang, gender, { ...VARS, accessEnded: true }),
    ).toMatchSnapshot();
  });

  it("po końcu dostępu treść NIE obiecuje wznowienia", () => {
    for (const lang of ["pl", "en"] as const) {
      const body = txBody("subscription_canceled", lang, "unknown", { ...VARS, accessEnded: true });
      const text = `${body.intro} ${body.extra}`;
      expect(text).not.toMatch(/wznow|resume/i);
    }
  });

  it("etykieta CTA po końcu dostępu różni się od „Wznów subskrypcję” w obu językach", () => {
    for (const lang of ["pl", "en"] as const) {
      expect(TX_CANCELED_ENDED_CTA[lang]).not.toBe(txCopy("subscription_canceled", lang).cta);
    }
    expect(TX_CANCELED_ENDED_CTA).toEqual({ pl: "Zobacz plany", en: "See plans" });
  });
});

import * as React from "react";

import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";

import { TEMPLATES } from "../registry";

describe("app email template registry", () => {
  it("rejestruje oba warianty potwierdzenia bezpłatnego RSVP", () => {
    expect(TEMPLATES["free-rsvp-pl"]?.displayName).toBe("Bezpłatne RSVP - PL");
    expect(TEMPLATES["free-rsvp-en"]?.displayName).toBe("Free RSVP - EN");
  });

  it.each(["free-rsvp-pl", "free-rsvp-en"])("renderuje %s z tematem", async (name) => {
    const entry = TEMPLATES[name];
    expect(entry?.previewData).toBeDefined();
    if (!entry?.previewData) return;

    const html = await render(React.createElement(entry.component, entry.previewData));
    const subject =
      typeof entry.subject === "function" ? entry.subject(entry.previewData) : entry.subject;

    expect(html).toContain("New European Strategies");
    expect(subject.length).toBeGreaterThan(8);
  });

  it("rejestruje pełen wymagany zestaw wiadomości aplikacji", () => {
    expect(Object.keys(TEMPLATES)).toEqual(
      expect.arrayContaining([
        "subscription-confirmed",
        "subscription-renewed",
        "subscription-canceled",
        "subscription-upgraded",
        "subscription-downgraded",
        "newsletter-confirmed",
      ]),
    );
  });
});

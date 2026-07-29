import { describe, expect, it } from "vitest";

import {
  AUTH_EMAIL_TYPES,
  renderAllAuthEmailPreviews,
} from "../auth-preview.server";

describe("renderAllAuthEmailPreviews", () => {
  it("renderuje wszystkie szablony po polsku z wołaczem", async () => {
    const previews = await renderAllAuthEmailPreviews("pl", "Marek", "unknown");
    expect(previews).toHaveLength(AUTH_EMAIL_TYPES.length);
    for (const p of previews) {
      expect(p.subject.length).toBeGreaterThan(5);
      expect(p.html).toContain("New European Strategies");
      expect(p.html).toContain("Marku");
      expect(p.text.length).toBeGreaterThan(50);
    }
  });

  it("renderuje wersje angielskie z angielskimi tematami", async () => {
    const previews = await renderAllAuthEmailPreviews("en", "Anna", "female");
    const signup = previews.find((p) => p.type === "signup");
    expect(signup?.subject).toContain("Confirm your email");
    expect(signup?.html).toContain("Hi Anna");
  });

  it("działa bez imienia (powitanie neutralne)", async () => {
    const previews = await renderAllAuthEmailPreviews("pl", null, "unknown");
    expect(previews[0]?.html).toContain("Dzień dobry");
  });
});

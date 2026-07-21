import { describe, it, expect } from "vitest";
import { buildOrgInviteEmail, escapeHtml } from "@/lib/organizations/inviteEmail";

describe("escapeHtml", () => {
  it("neutralizuje znaczniki i cudzysłowy", () => {
    expect(escapeHtml(`<img src=x onerror="x">'&`)).toBe(
      "&lt;img src=x onerror=&quot;x&quot;&gt;&#39;&amp;",
    );
  });
});

describe("buildOrgInviteEmail", () => {
  const base = {
    orgName: "Acme & Co",
    invitedEmail: "person@acme.test",
    lang: "pl" as const,
    origin: "https://neweuropeanstrategies.com/",
  };

  it("PL: temat z nazwą organizacji, CTA do huba członkostwa", () => {
    const { subject, html } = buildOrgInviteEmail(base);
    expect(subject).toContain("Acme & Co");
    expect(subject).toContain("Zaproszenie");
    // Trailing slash originu nie może dać podwójnego "//" w linku.
    expect(html).toContain('href="https://neweuropeanstrategies.com/profile/membership"');
    expect(html).toContain("Odbierz miejsce");
  });

  it("EN: pełne lustro językowe", () => {
    const { subject, html } = buildOrgInviteEmail({ ...base, lang: "en" });
    expect(subject).toContain("Invitation");
    expect(html).toContain("Claim your seat");
  });

  it("interpolacje są escapowane (nazwa organizacji i zapraszający)", () => {
    const { html } = buildOrgInviteEmail({
      ...base,
      orgName: `<script>alert(1)</script>`,
      inviterName: `"Mallory" <m@evil>`,
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;Mallory&quot;");
  });

  it("wariant bez zapraszającego używa formy bezosobowej", () => {
    const pl = buildOrgInviteEmail({ ...base, inviterName: null });
    expect(pl.html).toContain("Otrzymujesz zaproszenie");
    const withInviter = buildOrgInviteEmail({ ...base, inviterName: "Jan Kowalski" });
    expect(withInviter.html).toContain("Jan Kowalski zaprasza");
  });
});

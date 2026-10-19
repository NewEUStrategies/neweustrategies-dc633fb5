// `MfaRequiredNotice` - czego brakuje (drugi składnik), dlaczego (dane
// kontaktów CRM) i jeden przycisk do ustawień bezpieczeństwa konta.
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { MfaRequiredNotice } from "@/components/admin/revenue/molecules/MfaRequiredNotice";

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

async function renderInRouter(ui: ReactElement) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => ui }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

describe("MfaRequiredNotice", () => {
  it("komunikat nazwany tytułem, z powodem i odnośnikiem do /profile/security", async () => {
    await renderInRouter(<MfaRequiredNotice />);

    const notice = await screen.findByRole("status", { name: "Wymagane logowanie dwuetapowe" });
    expect(notice).toHaveTextContent("danych kontaktów z CRM");
    expect(
      within(notice).getByRole("link", { name: "Włącz logowanie dwuetapowe" }),
    ).toHaveAttribute("href", "/profile/security");
    expect(notice.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("wersja angielska", async () => {
    await i18n.changeLanguage("en");
    await renderInRouter(<MfaRequiredNotice />);

    const notice = await screen.findByRole("status", { name: "Two-step sign-in required" });
    expect(within(notice).getByRole("link", { name: "Turn on two-step sign-in" })).toHaveAttribute(
      "href",
      "/profile/security",
    );
  });

  it("nie ma naruszeń dostępności", async () => {
    const view = await renderInRouter(<MfaRequiredNotice />);
    await screen.findByRole("status");
    expect(summarize(await axeViolations(view.container))).toBe("");
  });
});

// Hero kariery: logo organizacji z ustawień systemu (theme_options.logo).
// Wariant jasny/ciemny przełącza klasa `.dark` (bez JS w momencie malowania),
// brak logo w systemie degraduje do tekstowej nazwy - nigdy do pustego H1.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { axeViolations, summarize } from "@/test/axe";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: "pl", changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn() },
}));

import { CareersHero } from "@/components/careers/organisms/CareersHero";

const SETTINGS_KEY = ["site_settings_public", "all"] as const;

function renderHero(settings: Record<string, unknown>) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(SETTINGS_KEY, Object.freeze(settings));
  const onSeeRoles = vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <CareersHero onSeeRoles={onSeeRoles} onOpenApplication={vi.fn()} />
    </QueryClientProvider>,
  );
  return { ...utils, onSeeRoles };
}

describe("CareersHero: logo z systemu", () => {
  it("renderuje oba warianty logo z przełącznikiem .dark", () => {
    renderHero({
      theme_options: { logo: { main: "/media/logo-light.svg", main_dark: "/media/logo-dark.svg" } },
    });
    const logos = screen.getAllByRole("img", { name: "careers.hero.titleAccent" });
    expect(logos).toHaveLength(2);
    expect(logos[0]).toHaveAttribute("src", "/media/logo-light.svg");
    expect(logos[0].className).toContain("dark:hidden");
    expect(logos[1]).toHaveAttribute("src", "/media/logo-dark.svg");
    expect(logos[1].className).toContain("dark:block");
  });

  it("jeden skonfigurowany wariant daje jeden <img> bez przełącznika", () => {
    renderHero({ theme_options: { logo: { main: "/media/logo.svg" } } });
    const logos = screen.getAllByRole("img", { name: "careers.hero.titleAccent" });
    expect(logos).toHaveLength(1);
    expect(logos[0].className).not.toContain("dark:");
  });

  it("bez logo w systemie H1 degraduje do tekstowej nazwy organizacji", () => {
    renderHero({});
    expect(screen.queryByRole("img", { name: "careers.hero.titleAccent" })).toBeNull();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toContain("careers.hero.titleAccent");
  });

  it("badge z licznikiem ról przewija do listy", () => {
    const { onSeeRoles } = renderHero({});
    fireEvent.click(screen.getByRole("button", { name: /careers\.hero\.badge/ }));
    expect(onSeeRoles).toHaveBeenCalledTimes(1);
  });

  it("nie ma naruszeń axe", async () => {
    const { container } = renderHero({
      theme_options: { logo: { main: "/media/logo-light.svg", main_dark: "/media/logo-dark.svg" } },
    });
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

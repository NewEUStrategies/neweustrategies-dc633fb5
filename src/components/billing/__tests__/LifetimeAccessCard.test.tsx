// Karta dostępu przyznanego POZA subskrypcją (`membership_grants`) - 0 z 4
// funkcji pokrytych do 18.08.2026.
//
// Dla ekspertów New European Strategies to dożywotni VIP nadawany razem
// z odznaką eksperta: nie ma tu ceny ani odnowienia, więc plan subskrypcyjny
// nie potrafiłby tego pokazać. Karta jest jedynym miejscem, gdzie taki klient
// widzi, CO MA i SKĄD.
//
// Reguła „które nadanie daje dostęp" (`activeGrants`) ma własny test
// w `lib/billing/__tests__/membership.test.ts` - tu sprawdzamy jej UŻYCIE:
// karta ma milczeć, gdy nie ma czego pokazać, i nie pokazywać nadania
// wygasłego ani odwołanego.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { isoFuture, isoPast, membershipGrant } from "@/test/billing/fixtures";
import type { MembershipGrantRow } from "@/lib/billing/membership";

const h = vi.hoisted(() => ({
  lang: { current: "pl" },
  grants: { current: [] as MembershipGrantRow[] },
  tier: { current: null as { key: string; name_pl: string; name_en: string } | null },
}));

vi.mock("react-i18next", async () => {
  const stubs = await import("@/test/reactStubs");
  return stubs.reactI18nextStub(() => h.lang.current);
});

// Reguła `activeGrants` NIE jest tu atrapą - jest przedmiotem użycia. Atrapą
// jest tylko odczyt z bazy (hook), bo to warstwa danych, nie reguła.
vi.mock("@/lib/billing/membership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/membership")>()),
  useMyGrants: () => ({ data: h.grants.current }),
}));

vi.mock("@/lib/billing/tiers", () => ({
  useCurrentTier: () => ({ data: h.tier.current }),
}));

import { LifetimeAccessCard } from "@/components/billing/LifetimeAccessCard";

const render = () => renderWithQueryClient(<LifetimeAccessCard />);

beforeEach(() => {
  h.lang.current = "pl";
  h.grants.current = [];
  h.tier.current = null;
});

describe("LifetimeAccessCard - kiedy karta w ogóle istnieje", () => {
  it("BEZ NADAŃ karta się nie renderuje (nie świeci pustym nagłówkiem)", async () => {
    const { container } = render();

    await waitFor(() => expect(container.textContent).toBe(""));
    expect(screen.queryByText("profile.planPage.grantTitle")).toBeNull();
  });

  it("NADANIE WYGASŁE nie wywołuje karty", async () => {
    h.grants.current = [membershipGrant({ expires_at: isoPast(1) })];
    const { container } = render();

    await waitFor(() => expect(container.textContent).toBe(""));
    expect(screen.queryByText("profile.planPage.grantTitle")).toBeNull();
  });

  it("NADANIE ODWOŁANE nie wywołuje karty, choćby było dożywotnie", async () => {
    h.grants.current = [membershipGrant({ expires_at: null, revoked_at: isoPast(1) })];
    const { container } = render();

    await waitFor(() => expect(container.textContent).toBe(""));
    expect(screen.queryByText("profile.planPage.grantTitle")).toBeNull();
  });

  it("aktywne nadanie pokazuje kartę z nagłówkiem", async () => {
    h.grants.current = [membershipGrant()];
    render();

    await waitFor(() => expect(screen.getByText("profile.planPage.grantTitle")).toBeTruthy());
    expect(screen.getByText("MEMBER")).toBeTruthy();
  });
});

describe("LifetimeAccessCard - co pokazuje o nadaniu", () => {
  it("nadanie bezterminowe jest opisane jako DOŻYWOTNIE, bez daty", async () => {
    h.grants.current = [membershipGrant({ expires_at: null })];
    render();

    await waitFor(() => expect(screen.getByText("profile.planPage.grantLifetime")).toBeTruthy());
    expect(screen.getByText("MEMBER")).toBeTruthy();
  });

  it("nadanie terminowe pokazuje DATĘ, nie słowo „dożywotni”", async () => {
    h.grants.current = [membershipGrant({ expires_at: isoFuture(30) })];
    render();

    await waitFor(() => expect(screen.getByText("MEMBER")).toBeTruthy());
    expect(screen.queryByText("profile.planPage.grantLifetime")).toBeNull();
  });

  it("nadanie eksperckie ma własny opis źródła", async () => {
    h.grants.current = [membershipGrant({ source: "expert" })];
    render();

    await waitFor(() => expect(screen.getByText("profile.planPage.grantExpert")).toBeTruthy());
    expect(screen.queryByText("profile.planPage.grantSource.expert")).toBeNull();
  });

  it("NOTATKA administratora wypiera ogólny opis źródła", async () => {
    h.grants.current = [membershipGrant({ source: "manual", note: "Prelegent Decision Lab 2026" })];
    render();

    await waitFor(() => expect(screen.getByText("Prelegent Decision Lab 2026")).toBeTruthy());
    expect(screen.queryByText("profile.planPage.grantSource.manual")).toBeNull();
  });

  // Uwaga na kształt wywołania: `t(klucz, grant.source)` używa POZYCYJNEJ,
  // starszej formy wartości zapasowej i18next - jedyne takie miejsce w tym
  // pliku (pozostałe podają `{ defaultValue }`). Skutek dla klienta: przy
  // braku klucza w słowniku zobaczy surową wartość enuma („donation"), a nie
  // etykietę. Ujednolicenie należy do kroku i18n; test dopasowuje się do stanu
  // faktycznego, żeby nie udawać, że tego kształtu tu nie ma.
  it("bez notatki opis idzie z klucza źródła", async () => {
    h.grants.current = [membershipGrant({ source: "donation", note: null })];
    render();

    await waitFor(() =>
      expect(screen.getByText(/profile\.planPage\.grantSource\.donation/)).toBeTruthy(),
    );
    expect(screen.queryByText("profile.planPage.grantExpert")).toBeNull();
  });

  it("nazwa warstwy z RPC wypiera techniczny klucz nadania", async () => {
    h.grants.current = [membershipGrant({ tier_key: "member" })];
    h.tier.current = { key: "member", name_pl: "Członek", name_en: "Member" };
    render();

    await waitFor(() => expect(screen.getByText("Członek")).toBeTruthy());
    expect(screen.queryByText("MEMBER")).toBeNull();
  });

  it("nazwa warstwy idzie za językiem interfejsu", async () => {
    h.lang.current = "en";
    h.grants.current = [membershipGrant({ tier_key: "member" })];
    h.tier.current = { key: "member", name_pl: "Członek", name_en: "Member" };
    render();

    await waitFor(() => expect(screen.getByText("Member")).toBeTruthy());
    expect(screen.queryByText("Członek")).toBeNull();
  });

  it("nadanie na INNĄ warstwę niż bieżąca pokazuje swój klucz, nie cudzą nazwę", async () => {
    h.grants.current = [membershipGrant({ tier_key: "vip" })];
    h.tier.current = { key: "member", name_pl: "Członek", name_en: "Member" };
    render();

    await waitFor(() => expect(screen.getByText("VIP")).toBeTruthy());
    expect(screen.queryByText("Członek")).toBeNull();
  });

  it("WIELE aktywnych nadań pokazuje się wszystkie, każde z własnym opisem", async () => {
    h.grants.current = [
      membershipGrant({ id: "g1", tier_key: "member", source: "expert", expires_at: null }),
      membershipGrant({
        id: "g2",
        tier_key: "pro",
        source: "donation",
        expires_at: isoFuture(60),
      }),
    ];
    render();

    await waitFor(() => expect(screen.getByText("MEMBER")).toBeTruthy());
    expect(screen.getByText("PRO")).toBeTruthy();
  });

  it("wygasłe nadanie NIE dołącza się do listy obok aktywnego", async () => {
    h.grants.current = [
      membershipGrant({ id: "aktywne", tier_key: "member", expires_at: null }),
      membershipGrant({ id: "wygasle", tier_key: "pro", expires_at: isoPast(1) }),
    ];
    render();

    await waitFor(() => expect(screen.getByText("MEMBER")).toBeTruthy());
    expect(screen.queryByText("PRO")).toBeNull();
  });
});

// MeterBanner: licznik meteringu nad artykułem odblokowanym "na licznik".
// Molekuła spina trzy czyste reguły warstwy dostępu (meterCounterVisible,
// latestMeterNumbers, formatMeterResetDate) z żywym stanem miesiąca
// (useMeterQuota) - reguły mają własne unit testy w lib/access, więc tu
// pilnujemy OKABLOWANIA: kiedy baner w ogóle istnieje, że liczby płyną ze
// scalenia zamrożonego stanu bytu z żywą quotą (a nie z jednego źródła),
// oraz że CTA prowadzą lejek anonim -> konto -> cennik.
//
// Mockowany jest wyłącznie hak zapytania (useMeterQuota) - czyste funkcje
// zostają PRAWDZIWE, bo to ich złożenie jest przedmiotem testu.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { meterQuota, meterState } from "@/test/paywall/fixtures";
import { translateKey as k } from "@/test/network/fixtures";
import { formatMeterResetDate, type MeterQuota } from "@/lib/access/metering";

const h = vi.hoisted(() => ({
  lang: "pl",
  session: null as { user: { id: string } } | null,
  quotaData: undefined as MeterQuota | null | undefined,
  quotaEnabled: [] as boolean[],
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/network/fixtures")).reactI18nextStub(() => h.lang),
);
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: h.session }) }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@/lib/access/metering", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/access/metering")>()),
  useMeterQuota: (enabled: boolean) => {
    h.quotaEnabled.push(enabled);
    return { data: h.quotaData };
  },
}));

import { MeterBanner } from "@/components/molecules/MeterBanner";

const banner = () => screen.getByTestId("meter-banner");

beforeEach(() => {
  h.lang = "pl";
  h.session = null;
  h.quotaData = undefined;
  h.quotaEnabled = [];
});

describe("MeterBanner - widoczność", () => {
  it("istnieje wyłącznie dla odblokowania na licznik (granted + show_counter + limit)", () => {
    expect(
      render(<MeterBanner meter={meterState({ granted: false })} />).container,
    ).toBeEmptyDOMElement();
    expect(
      render(<MeterBanner meter={meterState({ showCounter: false })} />).container,
    ).toBeEmptyDOMElement();
    // Uprawniony czytelnik (subskrypcja/zakup/organizacja): RPC daje limit 0.
    expect(
      render(<MeterBanner meter={meterState({ monthlyLimit: 0, remaining: 0 })} />).container,
    ).toBeEmptyDOMElement();
  });

  it("ukryty baner nie odpytuje żywej quoty (enabled=false w useMeterQuota)", () => {
    render(<MeterBanner meter={meterState({ granted: false })} />);
    expect(h.quotaEnabled).toEqual([false]);
  });

  it("widoczny: status polite z licznikiem, resztą i datą odnowienia", () => {
    render(<MeterBanner meter={meterState({ used: 1, monthlyLimit: 3, remaining: 2 })} />);
    expect(banner()).toHaveAttribute("role", "status");
    expect(banner()).toHaveAttribute("aria-live", "polite");
    expect(banner()).toHaveAttribute("data-meter-remaining", "2");
    expect(screen.getByText(k("paywall.meter.counter", { used: 1, limit: 3 }))).toBeInTheDocument();
    expect(screen.getByText(k("paywall.meter.remaining", { count: 2 }))).toBeInTheDocument();
    expect(
      screen.getByText(k("paywall.meter.resetsOn", { date: formatMeterResetDate("pl") })),
    ).toBeInTheDocument();
    expect(h.quotaEnabled).toEqual([true]);
  });
});

describe("MeterBanner - scalanie zamrożonego stanu z żywą quotą", () => {
  it("świeższa quota wygrywa: powrót do artykułu pokazuje bieżące zużycie", () => {
    // Czytelnik przeczytał w międzyczasie drugi artykuł - baner nie może
    // pokazywać snapshotu z chwili PIERWSZEGO odblokowania.
    h.quotaData = meterQuota({ used: 2, remaining: 1 });
    render(<MeterBanner meter={meterState({ used: 1, monthlyLimit: 3, remaining: 2 })} />);
    expect(screen.getByText(k("paywall.meter.counter", { used: 2, limit: 3 }))).toBeInTheDocument();
    expect(screen.getByText(k("paywall.meter.remaining", { count: 1 }))).toBeInTheDocument();
    expect(banner()).toHaveAttribute("data-meter-remaining", "1");
    // Ten sam merge zasila atom wskaźnika.
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "2");
  });

  it("zużycie jest monotoniczne - starsza quota nie cofa licznika", () => {
    h.quotaData = meterQuota({ used: 0, remaining: 3 });
    render(<MeterBanner meter={meterState({ used: 2, monthlyLimit: 3, remaining: 1 })} />);
    expect(screen.getByText(k("paywall.meter.counter", { used: 2, limit: 3 }))).toBeInTheDocument();
  });

  it("obniżony limit dosuwa prezentowane zużycie do skali", () => {
    h.quotaData = meterQuota({ monthlyLimit: 2, used: 3, remaining: 0 });
    render(<MeterBanner meter={meterState({ used: 3, monthlyLimit: 5, remaining: 2 })} />);
    // used > limit po zmianie admina: czytelnik widzi "2 z 2", nie "3 z 2".
    expect(screen.getByText(k("paywall.meter.counter", { used: 2, limit: 2 }))).toBeInTheDocument();
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "2");
  });
});

describe("MeterBanner - ostatni darmowy artykuł", () => {
  it("podbija tonację brand i mówi wprost, że to ostatni artykuł", () => {
    render(<MeterBanner meter={meterState({ used: 3, monthlyLimit: 3, remaining: 0 })} />);
    expect(screen.getByText(k("paywall.meter.lastOne"))).toBeInTheDocument();
    expect(screen.queryByText(/paywall\.meter\.remaining/)).not.toBeInTheDocument();
    expect(banner().className).toContain("border-brand/30");
    expect(banner()).toHaveAttribute("data-meter-remaining", "0");
  });

  it("przy zapasie limitu zostaje spokojna ramka", () => {
    render(<MeterBanner meter={meterState()} />);
    expect(banner().className).toContain("border-border");
    expect(screen.queryByText(k("paywall.meter.lastOne"))).not.toBeInTheDocument();
  });
});

describe("MeterBanner - lejek CTA", () => {
  it("anonim: rejestracja (wejście do puli konta) obok wyjścia na cennik", () => {
    render(<MeterBanner meter={meterState()} />);
    const signup = screen.getByRole("link", { name: k("paywall.meter.createAccount") });
    expect(signup).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: k("paywall.meter.seePlans") })).toHaveAttribute(
      "href",
      "/pricing",
    );
  });

  it("zalogowany: bez CTA rejestracji, cennik zostaje", () => {
    h.session = { user: { id: "user-me" } };
    render(<MeterBanner meter={meterState()} />);
    expect(
      screen.queryByRole("link", { name: k("paywall.meter.createAccount") }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: k("paywall.meter.seePlans") })).toBeInTheDocument();
  });
});

describe("MeterBanner - język daty odnowienia", () => {
  it("datę formatuje w języku czytelnika (UTC, parytet z okresem serwera)", () => {
    h.lang = "en";
    render(<MeterBanner meter={meterState()} />);
    expect(
      screen.getByText(k("paywall.meter.resetsOn", { date: formatMeterResetDate("en") })),
    ).toBeInTheDocument();
  });
});

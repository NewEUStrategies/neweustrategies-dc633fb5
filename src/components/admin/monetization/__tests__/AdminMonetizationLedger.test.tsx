// Panel monetyzacji (UI): stany zapytania, przełącznik środowiska,
// zakładki sekcji, maskowanie PII i pigułki statusów w PL/EN.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { listMonetizationLedger } = vi.hoisted(() => ({ listMonetizationLedger: vi.fn() }));
vi.mock("@/lib/admin/monetization/ledger.functions", () => ({ listMonetizationLedger }));

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import i18n from "@/lib/i18n";
import { ensureI18n } from "@/lib/i18n-admin-monetization";
import { AdminMonetizationLedger } from "@/components/admin/monetization/organisms/AdminMonetizationLedger";
import { EnvironmentBadge } from "@/components/admin/monetization/atoms/EnvironmentBadge";
import { LedgerStatusPill } from "@/components/admin/monetization/atoms/LedgerStatusPill";
import {
  donationTone,
  giftLinkTone,
  grantTone,
} from "@/components/admin/monetization/atoms/toneMap";

const FUTURE = "2099-01-01T00:00:00.000Z";
const PAST = "2020-01-01T00:00:00.000Z";

function payload(over: Record<string, unknown> = {}) {
  return {
    donations: [
      {
        id: "d1",
        amountCents: 12300,
        currency: "PLN",
        status: "paid",
        recurring: true,
        donorEmail: "anna.kowalska@example.com",
        environment: "live",
        createdAt: "2026-08-01T10:00:00.000Z",
        paidAt: "2026-08-01T10:01:00.000Z",
      },
      {
        id: "d2",
        amountCents: 500,
        currency: "PLN",
        status: "pending",
        recurring: false,
        donorEmail: null,
        environment: "sandbox",
        createdAt: "2026-08-02T10:00:00.000Z",
        paidAt: null,
      },
    ],
    grants: [
      {
        id: "g1",
        userId: "u1",
        tierKey: "pro",
        source: "donation",
        note: "wsparcie",
        sourceDonationId: "d1",
        startsAt: PAST,
        expiresAt: FUTURE,
        revokedAt: null,
        createdAt: PAST,
      },
      {
        id: "g2",
        userId: "u2",
        tierKey: "basic",
        source: "manual",
        note: null,
        sourceDonationId: null,
        startsAt: PAST,
        expiresAt: null,
        revokedAt: PAST,
        createdAt: PAST,
      },
    ],
    giftLinks: [
      {
        id: "l1",
        code: "abcdef123456",
        postId: "p1",
        createdAt: "2026-08-01T10:00:00.000Z",
        expiresAt: FUTURE,
        revokedAt: null,
        redemptionCount: 2,
        maxRedemptions: 5,
      },
    ],
    environment: "all",
    summary: {
      paidTotals: [{ currency: "PLN", amountCents: 12300, count: 1 }],
      donationCount: 2,
      pendingCount: 1,
      activeGrants: 1,
      activeGiftLinks: 1,
    },
    tenantResolved: true,
    ...over,
  };
}

beforeEach(async () => {
  ensureI18n();
  await i18n.changeLanguage("pl");
  listMonetizationLedger.mockReset();
  listMonetizationLedger.mockResolvedValue(payload());
});

describe("AdminMonetizationLedger", () => {
  it("pokazuje stan wczytywania, potem podsumowanie i wpłaty", async () => {
    renderWithQueryClient(<AdminMonetizationLedger />);
    expect(screen.getByText("Wczytywanie rejestru...")).toBeInTheDocument();
    expect(await screen.findByTestId("ledger-summary")).toBeInTheDocument();
    expect(screen.getByTestId("donations-table")).toBeInTheDocument();
    // Adres darczyńcy jest zamaskowany - panel to nie eksport bazy adresowej.
    expect(screen.getByText("an***@example.com")).toBeInTheDocument();
    expect(screen.queryByText("anna.kowalska@example.com")).not.toBeInTheDocument();
    expect(screen.getByText("Anonimowo")).toBeInTheDocument();
  });

  it("stan błędu daje komunikat i ponowną próbę", async () => {
    listMonetizationLedger.mockRejectedValue(new Error("boom"));
    renderWithQueryClient(<AdminMonetizationLedger />);
    expect(await screen.findByText("Nie udało się wczytać rejestru.")).toBeInTheDocument();
    listMonetizationLedger.mockResolvedValue(payload());
    fireEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    expect(await screen.findByTestId("ledger-summary")).toBeInTheDocument();
  });

  it("ostrzega, gdy domena nie rozstrzyga najemcy", async () => {
    listMonetizationLedger.mockResolvedValue(
      payload({ tenantResolved: false, donations: [], grants: [], giftLinks: [] }),
    );
    renderWithQueryClient(<AdminMonetizationLedger />);
    expect(
      await screen.findByText(
        "Ta domena nie jest przypisana do żadnego najemcy - rejestr jest pusty.",
      ),
    ).toBeInTheDocument();
  });

  it("zmiana środowiska odpytuje backend z nowym filtrem", async () => {
    renderWithQueryClient(<AdminMonetizationLedger />);
    await screen.findByTestId("ledger-summary");
    fireEvent.click(screen.getByRole("tab", { name: "Testowe" }));
    await waitFor(() =>
      expect(listMonetizationLedger).toHaveBeenLastCalledWith({
        data: { environment: "sandbox", limit: 50 },
      }),
    );
  });

  it("zakładki przełączają sekcje rejestru", async () => {
    renderWithQueryClient(<AdminMonetizationLedger />);
    await screen.findByTestId("donations-table");
    fireEvent.click(screen.getByRole("tab", { name: "Przydziały członkostwa" }));
    expect(await screen.findByTestId("grants-table")).toBeInTheDocument();
    expect(screen.getByText("Aktywny")).toBeInTheDocument();
    expect(screen.getByText("Cofnięty")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Linki prezentowe" }));
    expect(await screen.findByTestId("gift-links-table")).toBeInTheDocument();
    expect(screen.getByText("abcdef...")).toBeInTheDocument();
    expect(screen.getByText("2 / 5")).toBeInTheDocument();
  });

  it("puste sekcje mówią to wprost", async () => {
    listMonetizationLedger.mockResolvedValue(payload({ donations: [], grants: [], giftLinks: [] }));
    renderWithQueryClient(<AdminMonetizationLedger />);
    expect(await screen.findByText("Brak wierszy dla wybranego środowiska.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Przydziały członkostwa" }));
    expect(await screen.findByText("Brak wierszy dla wybranego środowiska.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Linki prezentowe" }));
    expect(await screen.findByText("Brak wierszy dla wybranego środowiska.")).toBeInTheDocument();
  });

  it("brak rozliczonych wpłat, link bez limitu i przydział bezterminowy", async () => {
    listMonetizationLedger.mockResolvedValue(
      payload({
        summary: {
          paidTotals: [],
          donationCount: 0,
          pendingCount: 0,
          activeGrants: 0,
          activeGiftLinks: 0,
        },
        giftLinks: [
          {
            id: "l2",
            code: "kod12",
            postId: "p2",
            createdAt: "2026-08-01T10:00:00.000Z",
            expiresAt: null,
            revokedAt: null,
            redemptionCount: 9,
            maxRedemptions: 0,
          },
        ],
      }),
    );
    renderWithQueryClient(<AdminMonetizationLedger />);
    expect(await screen.findByText("Brak rozliczonych wpłat")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Przydziały członkostwa" }));
    // Kolumna „Okres” to JEDNA komórka złożona z czterech węzłów tekstowych
    // („2020-01-01”, „ -”, „ ”, „Bezterminowo”) - JSX rozbija `{data} -{" "}{terminator}`
    // na osobne dzieci. Matcher tekstowy RTL nie ogląda węzłów, tylko ELEMENTY:
    // `getNodeText` skleja BEZPOŚREDNIE węzły tekstowe elementu, a `matches` dla
    // matchera-napisu robi RÓWNOŚĆ po normalizacji. Żaden element nie ma więc tekstu
    // równego samemu „Bezterminowo”: poprzednia asercja nie mogła trafić w ŻADNEJ
    // chwili i wypalała cały budżet `asyncUtilTimeout` (vitest.setup.ts: 5000 ms).
    // Zmierzone: 5057 ms na czerwono, wobec 1-402 ms pozostałych przypadków w tym
    // pliku - czyli cały koszt to wypalony timeout, nie praca.
    // Pytamy o całą komórkę - tak jak „2 / 5” wyżej i „9 / Bez limitu” niżej.
    expect(await screen.findByText(`${PAST.slice(0, 10)} - Bezterminowo`)).toBeInTheDocument();
    // Druga gałąź tego samego warunku: przydział Z datą końca pokazuje datę, a nie
    // etykietę. Bez tej pary test nie odróżniłby „etykieta zawsze” od „etykieta tylko
    // wtedy, gdy expiresAt === null”.
    expect(screen.getByText(`${PAST.slice(0, 10)} - ${FUTURE.slice(0, 10)}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Linki prezentowe" }));
    expect(await screen.findByText("kod12")).toBeInTheDocument();
    expect(screen.getByText("9 / Bez limitu")).toBeInTheDocument();
  });

  it("renderuje się po angielsku", async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    renderWithQueryClient(<AdminMonetizationLedger />);
    expect(await screen.findByText("Monetisation")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sandbox" })).toBeInTheDocument();
    await act(async () => {
      await i18n.changeLanguage("pl");
    });
  });

  it("nadanie bez darowizny źródłowej ma środowisko nieokreślone", async () => {
    renderWithQueryClient(<AdminMonetizationLedger />);
    await screen.findByTestId("donations-table");
    fireEvent.click(screen.getByRole("tab", { name: "Przydziały członkostwa" }));
    const badges = await screen.findAllByTestId("environment-badge");
    expect(badges.map((b) => b.getAttribute("data-environment"))).toEqual(["live", "unknown"]);
  });
});

describe("atomy rejestru", () => {
  it("znacznik środowiska niesie ton i etykietę", () => {
    render(<EnvironmentBadge environment="sandbox" label="Testowe" />);
    const badge = screen.getByTestId("environment-badge");
    expect(badge).toHaveAttribute("data-environment", "sandbox");
    expect(badge).toHaveTextContent("Testowe");
  });

  it("pigułka statusu niesie ton", () => {
    render(<LedgerStatusPill tone="negative" label="Cofnięty" />);
    expect(screen.getByTestId("ledger-status")).toHaveAttribute("data-tone", "negative");
  });

  it("mapowanie statusów na tony", () => {
    expect(grantTone("active")).toBe("positive");
    expect(grantTone("revoked")).toBe("negative");
    expect(grantTone("scheduled")).toBe("warning");
    expect(grantTone("expired")).toBe("neutral");
    expect(giftLinkTone("active")).toBe("positive");
    expect(giftLinkTone("revoked")).toBe("negative");
    expect(giftLinkTone("exhausted")).toBe("warning");
    expect(giftLinkTone("expired")).toBe("neutral");
    expect(donationTone("paid")).toBe("positive");
    expect(donationTone("pending")).toBe("warning");
    expect(donationTone("processing")).toBe("warning");
    expect(donationTone("failed")).toBe("negative");
    expect(donationTone("refunded")).toBe("negative");
    expect(donationTone("canceled")).toBe("negative");
    expect(donationTone("dziwny")).toBe("neutral");
  });
});

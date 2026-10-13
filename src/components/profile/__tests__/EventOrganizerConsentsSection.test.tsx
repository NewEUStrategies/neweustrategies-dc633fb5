// Sekcja „Zgody dla organizatora wydarzeń" na /profile/privacy (REG-14).
//
// CO TEN PLIK DOWODZI:
//   1. Stan z księgi: zgoda aktywna od daty / brak zgody, globalne wycofanie,
//      otwarty link DOI („czeka na potwierdzenie") i historia z kanałem dowodu.
//   2. Przyciski tylko dla tego, co da się wycofać (aktywne cele; „obie" tylko
//      przy dwóch aktywnych).
//   3. Wycofanie z SESJI: do serwera jadą WYŁĄCZNIE cele (bez klucza, bez
//      identyfikatora osoby, bez adresu) - i dopiero po potwierdzeniu w oknie;
//      po zapisie stan jest czytany ponownie.
//   4. Konto bez kartoteki uczestnika i awaria odczytu mają własne zdania.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import type { MyEventConsentState, MyEventConsentStateResult } from "@/lib/events/eventConsent";
import { axeViolations, summarize } from "@/test/axe";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const h = vi.hoisted(() => ({
  list: vi.fn<() => Promise<unknown>>(),
  withdraw: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-profile", () => ({ ensureI18n: () => undefined }));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: { name?: string }) =>
    fn.name === "withdrawEventConsents" ? h.withdraw : h.list,
}));
vi.mock("@/lib/events/eventConsent.functions", () => ({
  listMyEventConsents: { name: "listMyEventConsents" },
  withdrawEventConsents: { name: "withdrawEventConsents" },
}));

const { EventOrganizerConsentsSection } =
  await import("@/components/profile/privacy/EventOrganizerConsentsSection");

const K = "profile.privacy.eventConsents";

function state(over: Partial<MyEventConsentState> = {}): MyEventConsentStateResult {
  return {
    ok: true,
    state: {
      linked: true,
      email: "uczestnik@example.org",
      consents: {
        dataProcessingAt: "2026-09-01T10:00:00.000Z",
        marketingAt: "2026-09-02T10:00:00.000Z",
        partnerSharingAt: null,
        withdrawnAt: null,
      },
      openConfirmation: null,
      ledger: [
        {
          purpose: "marketing",
          status: "confirmed",
          evidence: "email_double_opt_in",
          createdAt: "2026-09-02T10:00:00.000Z",
          textVersion: 1,
          textLang: "pl",
          eventTitlePl: "Kongres CEE",
          eventTitleEn: "CEE Congress",
        },
      ],
      ...over,
    },
  };
}

beforeEach(() => {
  h.list.mockReset();
  h.withdraw.mockReset();
  h.withdraw.mockResolvedValue({ ok: true });
});

describe("EventOrganizerConsentsSection - zgody dla organizatora wydarzeń (REG-14)", () => {
  it("stan z księgi: aktywna od daty, brak zgody, historia z kanałem dowodu", async () => {
    h.list.mockResolvedValue(state());
    renderWithQueryClient(<EventOrganizerConsentsSection />);

    expect(await screen.findByText(`${K}.inactive`)).toBeInTheDocument();
    expect(screen.getByText(/profile\.privacy\.eventConsents\.activeSince\(date=/)).toBeInTheDocument();
    expect(
      screen.getByText(
        new RegExp(`${K}.purposes.marketing · ${K}.statuses.confirmed · ${K}.evidences.emailDoubleOptIn · Kongres CEE`.replace(/\./g, "\\.")),
      ),
    ).toBeInTheDocument();
    // Tylko aktywny cel ma przycisk; „obie" - dopiero przy dwóch aktywnych.
    expect(screen.getByRole("button", { name: `${K}.withdrawMarketing` })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `${K}.withdrawPartner` })).toBeNull();
    expect(screen.queryByRole("button", { name: `${K}.withdrawAll` })).toBeNull();
  });

  it("otwarty link DOI i globalne wycofanie mają własne zdania", async () => {
    h.list.mockResolvedValue(
      state({
        consents: {
          dataProcessingAt: null,
          marketingAt: null,
          partnerSharingAt: null,
          withdrawnAt: "2026-09-03T10:00:00.000Z",
        },
        openConfirmation: {
          purposes: ["marketing"],
          createdAt: "2026-09-04T10:00:00.000Z",
          expiresAt: "2026-09-11T10:00:00.000Z",
        },
      }),
    );
    renderWithQueryClient(<EventOrganizerConsentsSection />);

    expect(await screen.findByText(/eventConsents\.withdrawnAll\(date=/)).toBeInTheDocument();
    expect(screen.getByText(/eventConsents\.pending\(date=/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `${K}.withdrawMarketing` })).toBeNull();
  });

  it("wycofanie z sesji: tylko cele, po potwierdzeniu w oknie; stan czytany ponownie", async () => {
    h.list.mockResolvedValue(
      state({
        consents: {
          dataProcessingAt: null,
          marketingAt: "2026-09-02T10:00:00.000Z",
          partnerSharingAt: "2026-09-02T10:00:00.000Z",
          withdrawnAt: null,
        },
      }),
    );
    renderWithQueryClient(<EventOrganizerConsentsSection />);

    fireEvent.click(await screen.findByRole("button", { name: `${K}.withdrawAll` }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(h.withdraw).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: `${K}.confirm` }));

    expect(await screen.findByText(`${K}.done`)).toBeInTheDocument();
    expect(h.withdraw).toHaveBeenCalledWith({ data: { purposes: "all" } });
    await waitFor(() => expect(h.list).toHaveBeenCalledTimes(2));
  });

  it("konto bez kartoteki uczestnika: zdanie zamiast przycisków", async () => {
    h.list.mockResolvedValue(
      state({ linked: false, email: null, consents: null, openConfirmation: null, ledger: [] }),
    );
    renderWithQueryClient(<EventOrganizerConsentsSection />);

    expect(await screen.findByText(`${K}.notLinked`)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("awaria odczytu (także okno wdrożenia) - komunikat, bez przycisków", async () => {
    h.list.mockResolvedValue({ ok: false, reason: "unavailable" });
    renderWithQueryClient(<EventOrganizerConsentsSection />);

    expect(await screen.findByText(`${K}.loadError`)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("brak naruszeń axe", async () => {
    h.list.mockResolvedValue(state());
    const { container } = renderWithQueryClient(<EventOrganizerConsentsSection />);
    await screen.findByText(`${K}.inactive`);
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

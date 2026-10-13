// `/event-consent/confirm#token=…` - potwierdzenie zgód linkiem z maila
// (double opt-in, REG-02 / REG-14).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. SKANER POCZTY UDZIELA ZGODY. Wejście na stronę (GET) może wołać
//      WYŁĄCZNIE podgląd; potwierdzenie to osobny POST z przycisku. Gdyby
//      otwarcie linku potwierdzało, dowód zgody z art. 7 ust. 1 RODO byłby
//      fikcją - pierwszym „klikającym" jest skaner bezpieczeństwa.
//   2. TOKEN W ADRESIE ZAPYTANIA. Token przychodzi we FRAGMENCIE (`#token=`),
//      a strona wyciera go z paska adresu po odczycie (historia, zakładki).
//   3. STAN Z BAZY UDAWANY INACZEJ. open / already / expired / not_found mają
//      własne zdania; awaria nie udaje „link wygasł".
//   4. STRONA W WYSZUKIWARCE. `noindex, nofollow`, `no-referrer`, bez SSR.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import type {
  EventConsentConfirmResult,
  EventConsentPreviewResult,
} from "@/lib/events/eventConsent";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const h = vi.hoisted(() => ({
  preview: vi.fn<(input: { data: { token: string } }) => Promise<unknown>>(),
  confirm: vi.fn<(input: { data: { token: string } }) => Promise<unknown>>(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: { name?: string }) =>
    fn.name === "confirmEventConsent" ? h.confirm : h.preview,
}));
vi.mock("@/lib/events/eventConsent.functions", () => ({
  previewEventConsent: { name: "previewEventConsent" },
  confirmEventConsent: { name: "confirmEventConsent" },
}));

const { EventConsentConfirmPanel } =
  await import("@/components/events/registration/EventConsentConfirmPanel");
const { Route } = await import("@/routes/event-consent.confirm");

/** 24 bajty w base64url - kształt `_event_new_qr_token()`. */
const TOKEN = "Ab3d_Xy9-Qw1zEr4TyU7iOp2AsDf1gHj";

function previewOf(state: string): EventConsentPreviewResult {
  return {
    ok: true,
    preview: {
      state: state as "open",
      purposes: ["marketing", "partner_sharing"],
      lang: "pl",
      expiresAt: "2030-01-08T10:00:00.000Z",
      event: {
        slug: "kongres",
        titlePl: "Kongres CEE",
        titleEn: "CEE Congress",
        startsAt: "2030-06-10T08:00:00.000Z",
        timezone: "Europe/Warsaw",
      },
      texts: [
        { purpose: "marketing", body: "Chcę otrzymywać informacje o kolejnych wydarzeniach." },
        { purpose: "partner_sharing", body: "Zgadzam się na przekazanie danych partnerom." },
      ],
    },
  };
}

function openAt(hash: string) {
  window.history.replaceState(null, "", `/event-consent/confirm${hash}`);
  return renderWithQueryClient(<EventConsentConfirmPanel />);
}

beforeEach(() => {
  h.preview.mockReset();
  h.confirm.mockReset();
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("event-consent.confirm - metadane trasy", () => {
  it("bez SSR (token we fragmencie), `noindex, nofollow`, `no-referrer`", () => {
    const head = Route.options.head?.({} as never) as
      { meta: Array<Record<string, string>> } | undefined;
    const meta = head?.meta ?? [];
    expect(Route.options.ssr).toBe(false);
    expect(meta.find((entry) => entry.name === "robots")?.content).toBe("noindex, nofollow");
    expect(meta.find((entry) => entry.name === "referrer")?.content).toBe("no-referrer");
    expect(meta.find((entry) => "title" in entry)?.title).toMatch(/zgód/);
  });
});

describe("EventConsentConfirmPanel - GET pokazuje podgląd, przycisk potwierdza", () => {
  it("wejście woła WYŁĄCZNIE podgląd (token z fragmentu) i wyciera token z adresu", async () => {
    h.preview.mockResolvedValue(previewOf("open"));
    openAt(`#token=${TOKEN}`);

    expect(
      await screen.findByText("Chcę otrzymywać informacje o kolejnych wydarzeniach."),
    ).toBeInTheDocument();
    expect(screen.getByText("Zgadzam się na przekazanie danych partnerom.")).toBeInTheDocument();
    expect(screen.getByText("Kongres CEE")).toBeInTheDocument();
    expect(h.preview).toHaveBeenCalledWith({ data: { token: TOKEN } });
    expect(h.confirm).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(TOKEN);
  });

  it("przycisk wysyła potwierdzenie tym samym tokenem i pokazuje wynik", async () => {
    h.preview.mockResolvedValue(previewOf("open"));
    h.confirm.mockResolvedValue({
      ok: true,
      state: "confirmed",
      purposes: ["marketing", "partner_sharing"],
    } satisfies EventConsentConfirmResult);
    openAt(`#token=${TOKEN}`);

    fireEvent.click(
      await screen.findByRole("button", { name: "eventRegistration.consentConfirm.confirm" }),
    );

    expect(
      await screen.findByText("eventRegistration.consentConfirm.confirmedTitle"),
    ).toBeInTheDocument();
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(h.confirm).toHaveBeenCalledWith({ data: { token: TOKEN } });
    expect(
      screen.queryByRole("button", { name: "eventRegistration.consentConfirm.confirm" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["already", "eventRegistration.consentConfirm.alreadyTitle"],
    ["expired", "eventRegistration.consentConfirm.expiredTitle"],
    ["not_found", "eventRegistration.consentConfirm.notFoundTitle"],
  ])("podgląd w stanie %s: zdanie %s, bez przycisku potwierdzenia", async (state, title) => {
    h.preview.mockResolvedValue(previewOf(state));
    openAt(`#token=${TOKEN}`);

    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "eventRegistration.consentConfirm.confirm" }),
    ).not.toBeInTheDocument();
    expect(h.confirm).not.toHaveBeenCalled();
  });

  it("potwierdzenie po terminie (wyścig z wygaśnięciem) -> expired", async () => {
    h.preview.mockResolvedValue(previewOf("open"));
    h.confirm.mockResolvedValue({ ok: false, state: "expired" });
    openAt(`#token=${TOKEN}`);

    fireEvent.click(
      await screen.findByRole("button", { name: "eventRegistration.consentConfirm.confirm" }),
    );
    expect(
      await screen.findByText("eventRegistration.consentConfirm.expiredTitle"),
    ).toBeInTheDocument();
  });

  it("limit prób zostawia podgląd z komunikatem (można spróbować później)", async () => {
    h.preview.mockResolvedValue(previewOf("open"));
    h.confirm.mockResolvedValue({ ok: false, state: "rate_limited" });
    openAt(`#token=${TOKEN}`);

    fireEvent.click(
      await screen.findByRole("button", { name: "eventRegistration.consentConfirm.confirm" }),
    );
    expect(
      await screen.findByText("eventRegistration.consentConfirm.rateLimited"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "eventRegistration.consentConfirm.confirm" }),
    ).toBeInTheDocument();
  });

  it("brak tokenu albo zły kształt: not_found bez pytania serwera", async () => {
    openAt("#token=za-krotki");
    expect(
      await screen.findByText("eventRegistration.consentConfirm.notFoundTitle"),
    ).toBeInTheDocument();
    expect(h.preview).not.toHaveBeenCalled();
  });

  it("awaria podglądu NIE udaje wygasłego linku - jest stan błędu z ponowieniem", async () => {
    h.preview.mockResolvedValue({ ok: false, reason: "unavailable" });
    openAt(`#token=${TOKEN}`);

    expect(
      await screen.findByText("eventRegistration.consentConfirm.errorTitle"),
    ).toBeInTheDocument();
    h.preview.mockResolvedValue(previewOf("open"));
    fireEvent.click(screen.getByRole("button", { name: "eventRegistration.consentConfirm.retry" }));
    await waitFor(() => expect(h.preview).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole("button", { name: "eventRegistration.consentConfirm.confirm" }),
    ).toBeInTheDocument();
  });
});

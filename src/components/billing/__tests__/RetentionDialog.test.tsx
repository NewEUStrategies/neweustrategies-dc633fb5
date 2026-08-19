// Dialog retencyjny - ŚCIEŻKA REZYGNACJI. Najwyższe ryzyko konsekwencji
// w całym repozytorium: 0 z 21 funkcji pokrytych do 18.08.2026, a to jedyne
// miejsce, w którym płacący klient rezygnuje z subskrypcji.
//
// Rezygnacja zablokowana albo POZORNIE WYKONANA nie jest usterką wizualną -
// to ryzyko prawne (prawo konsumenckie) i reklamacyjne. Dlatego ten plik
// pilnuje przede wszystkim tego, czy da się DOJŚĆ DO KOŃCA:
//
//   1. ODRZUCENIE KONTROFERTY NIE MOŻE ZABLOKOWAĆ REZYGNACJI. Kontrofertka
//      rabatowa stoi na drodze wyjścia; test dowodzi, że „Zrezygnuj mimo to"
//      naprawdę woła anulowanie, a nie tylko zamyka okno.
//   2. ANKIETA JEST BEST-EFFORT. Zapis powodu odejścia to analityka. Jej awaria
//      NIE MOŻE zatrzymać rezygnacji - inaczej padnięty serwer analityki
//      trzyma klienta w płatnej subskrypcji.
//   3. OFERTA WYCZERPANA TO NADAL WYJŚCIE. Gdy kupon się nie należy
//      (`ok: false`), przycisk akceptacji znika - ale przycisk rezygnacji
//      musi zostać i działać.
//
// Asercje idą na KLUCZE i18n, nie na polski tekst (patrz `translateKey`):
// zmiana copy nie psuje testu, a rozjazd klucza owszem.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { retentionReasons, retentionSettings } from "@/test/billing/fixtures";
import type { RetentionReasonRow, RetentionSettingsRow } from "@/lib/retention/queries";

type OfferResult =
  | { ok: true; code: string; discountPct: number; discountPeriods: number; validUntil: string }
  | { ok: false; reason: string };

const h = vi.hoisted(() => ({
  lang: { current: "pl" },
  settings: {
    current: null as RetentionSettingsRow | null,
    isLoading: false,
  },
  reasons: { current: [] as RetentionReasonRow[], isLoading: false },
  submitFeedback: vi.fn(),
  acceptOffer: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  clipboard: vi.fn(),
}));

vi.mock("react-i18next", async () => {
  const stubs = await import("@/test/reactStubs");
  return stubs.reactI18nextStub(() => h.lang.current);
});

vi.mock("@/lib/i18n-retention", () => ({ ensureI18n: () => {} }));

vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

// `useServerFn` w produkcji owija server fn w wywołanie RPC; w teście
// przepuszczamy funkcję na wylot, a same server fn są atrapami niżej.
vi.mock("@tanstack/react-start", () => ({
  useServerFn: <T,>(fn: T) => fn,
}));

vi.mock("@/lib/retention/functions", () => ({
  submitRetentionFeedback: (arg: unknown) => h.submitFeedback(arg),
  acceptRetentionOffer: (arg: unknown) => h.acceptOffer(arg),
}));

vi.mock("@/lib/retention/queries", () => ({
  useRetentionSettings: () => ({
    data: h.settings.current,
    isLoading: h.settings.isLoading,
  }),
  useRetentionReasons: () => ({ data: h.reasons.current, isLoading: h.reasons.isLoading }),
  reasonLabel: (reason: RetentionReasonRow, lang: string) =>
    lang === "en" ? reason.label_en : reason.label_pl,
}));

vi.mock("sonner", () => ({
  toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) },
}));

import { RetentionDialog } from "@/components/billing/organisms/RetentionDialog";

const acceptedOffer: OfferResult = {
  ok: true,
  code: "STAY30",
  discountPct: 30,
  discountPeriods: 3,
  validUntil: "2026-09-01T00:00:00.000Z",
};

/**
 * Renderuje dialog w stanie otwartym. Zwraca szpiegów, o których cały plik
 * pyta: CZY wyszło żądanie anulowania i CZY okno zostało zamknięte - to dwa
 * różne fakty, a mylenie ich jest właśnie tym, na czym polega „pozorna
 * rezygnacja".
 */
function renderDialog(options: { cancel?: () => Promise<void> | void } = {}) {
  const onConfirmCancel = vi.fn(options.cancel ?? (() => Promise.resolve()));
  const onOpenChange = vi.fn();
  const view = renderWithQueryClient(
    <RetentionDialog
      open
      onOpenChange={onOpenChange}
      subscriptionId="sub-1"
      onConfirmCancel={onConfirmCancel}
    />,
  );
  return { ...view, onConfirmCancel, onOpenChange };
}

const clickKey = (key: string) => fireEvent.click(screen.getByText(key));

beforeEach(() => {
  h.lang.current = "pl";
  h.settings.current = retentionSettings();
  h.settings.isLoading = false;
  h.reasons.current = retentionReasons();
  h.reasons.isLoading = false;
  h.submitFeedback.mockReset().mockResolvedValue({ ok: true });
  h.acceptOffer.mockReset().mockResolvedValue(acceptedOffer);
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.clipboard.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: (text: string) => h.clipboard(text) },
  });
});

describe("RetentionDialog - krok ankiety", () => {
  it("pokazuje powody z katalogu oraz wariant „inny powód”", () => {
    renderDialog();

    expect(screen.getByText("Za drogo")).toBeTruthy();
    expect(screen.getByText("Nie korzystam")).toBeTruthy();
    expect(screen.getByText("retention.otherReason")).toBeTruthy();
  });

  it("etykiety powodów idą za językiem interfejsu", () => {
    h.lang.current = "en";
    renderDialog();

    expect(screen.getByText("Too expensive")).toBeTruthy();
    expect(screen.queryByText("Za drogo")).toBeNull();
  });

  it("w trakcie ładowania powodów pokazuje szkielet, nie pustą listę", () => {
    h.reasons.current = [];
    h.reasons.isLoading = true;
    renderDialog();

    expect(screen.queryByText("retention.otherReason")).toBeNull();
    expect(screen.getByText("retention.reasonHeading")).toBeTruthy();
  });

  it("„zostaję” zamyka okno i NIE wywołuje anulowania", () => {
    const { onConfirmCancel, onOpenChange } = renderDialog();

    clickKey("retention.keep");

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirmCancel).not.toHaveBeenCalled();
  });
});

describe("RetentionDialog - kontrofertka na drodze wyjścia", () => {
  it("przy dostępnej ofercie „kontynuuj” pokazuje ofertę i jeszcze NIE anuluje", async () => {
    const { onConfirmCancel } = renderDialog();

    clickKey("retention.continue");

    await waitFor(() => expect(screen.getByText("retention.offer.title")).toBeTruthy());
    expect(onConfirmCancel).not.toHaveBeenCalled();
  });

  it("oferta pokazuje procent, liczbę okresów i ważność Z USTAWIEŃ, nie z komponentu", async () => {
    h.settings.current = retentionSettings({
      discount_pct: 25,
      discount_periods: 2,
      coupon_valid_days: 7,
    });
    renderDialog();

    clickKey("retention.continue");

    await waitFor(() =>
      expect(screen.getByText('retention.offer.body {"pct":25,"periods":2}')).toBeTruthy(),
    );
    expect(screen.getByText('retention.offer.hint {"days":7}')).toBeTruthy();
  });

  // TO JEST TEST Z DEFINICJI UKOŃCZENIA.
  it("ODRZUCENIE OFERTY NIE BLOKUJE REZYGNACJI - anulowanie faktycznie wychodzi", async () => {
    const { onConfirmCancel } = renderDialog();

    clickKey("retention.continue");
    await waitFor(() => expect(screen.getByText("retention.offer.title")).toBeTruthy());
    clickKey("retention.offer.declineAndCancel");

    await waitFor(() => expect(onConfirmCancel).toHaveBeenCalledTimes(1));
    // Ankieta zapisuje, że oferta BYŁA pokazana - inaczej raport retencji
    // policzyłby to odejście jako „nie dostał oferty".
    expect(h.submitFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ offerShown: true }) }),
    );
  });

  it("bez włączonej oferty „kontynuuj” anuluje od razu (offerShown: false)", async () => {
    h.settings.current = retentionSettings({ enabled: false });
    const { onConfirmCancel } = renderDialog();

    clickKey("retention.continue");

    await waitFor(() => expect(onConfirmCancel).toHaveBeenCalledTimes(1));
    expect(h.submitFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ offerShown: false }) }),
    );
  });

  it("przy rabacie zerowym oferty nie ma - rezygnacja idzie prosto", async () => {
    h.settings.current = retentionSettings({ discount_pct: 0 });
    const { onConfirmCancel } = renderDialog();

    clickKey("retention.continue");

    await waitFor(() => expect(onConfirmCancel).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("retention.offer.title")).toBeNull();
  });

  it("oferta wyczerpana: znika przycisk akceptacji, ZOSTAJE wyjście z rezygnacją", async () => {
    h.acceptOffer.mockResolvedValue({ ok: false, reason: "already_redeemed" });
    const { onConfirmCancel } = renderDialog();

    clickKey("retention.continue");
    await waitFor(() => expect(screen.getByText("retention.offer.title")).toBeTruthy());
    clickKey('retention.offer.accept {"pct":30}');

    await waitFor(() => expect(screen.getByText("retention.offer.alreadyRedeemed")).toBeTruthy());
    expect(screen.queryByText('retention.offer.accept {"pct":30}')).toBeNull();

    clickKey("retention.offer.declineAndCancel");
    await waitFor(() => expect(onConfirmCancel).toHaveBeenCalledTimes(1));
  });

  it("awaria akceptacji oferty nie zamyka wyjścia - rezygnacja dalej możliwa", async () => {
    h.acceptOffer.mockRejectedValue(new Error("boom"));
    const { onConfirmCancel } = renderDialog();

    clickKey("retention.continue");
    await waitFor(() => expect(screen.getByText("retention.offer.title")).toBeTruthy());
    clickKey('retention.offer.accept {"pct":30}');

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("retention.errors.offer"));
    clickKey("retention.offer.declineAndCancel");
    await waitFor(() => expect(onConfirmCancel).toHaveBeenCalledTimes(1));
  });
});

describe("RetentionDialog - ankieta jest best-effort", () => {
  it("awaria zapisu powodu NIE blokuje rezygnacji", async () => {
    h.submitFeedback.mockRejectedValue(new Error("analityka padła"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    h.settings.current = retentionSettings({ enabled: false });
    const { onConfirmCancel } = renderDialog();

    clickKey("retention.continue");

    await waitFor(() => expect(onConfirmCancel).toHaveBeenCalledTimes(1));
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("wybrany powód i komentarz trafiają do ankiety", async () => {
    h.settings.current = retentionSettings({ enabled: false });
    renderDialog();

    fireEvent.click(screen.getByText("Nie korzystam"));
    fireEvent.change(screen.getByLabelText("retention.commentLabel"), {
      target: { value: "  za mało analiz  " },
    });
    clickKey("retention.continue");

    await waitFor(() => expect(h.submitFeedback).toHaveBeenCalled());
    expect(h.submitFeedback).toHaveBeenCalledWith({
      data: {
        subscriptionId: "sub-1",
        reasonId: "reason-unused",
        reasonLabel: "Nie korzystam",
        comment: "za mało analiz",
        offerShown: false,
      },
    });
  });

  it("puste pole komentarza nie wysyła pustego napisu", async () => {
    h.settings.current = retentionSettings({ enabled: false });
    renderDialog();

    fireEvent.change(screen.getByLabelText("retention.commentLabel"), {
      target: { value: "   " },
    });
    clickKey("retention.continue");

    await waitFor(() => expect(h.submitFeedback).toHaveBeenCalled());
    const payload = h.submitFeedback.mock.calls[0]?.[0] as { data: { comment?: string } };
    expect(payload.data.comment).toBeUndefined();
    // Brak wyboru = „inny powód”, więc `reasonId` musi zostać nullem.
    expect((payload as { data: { reasonId: string | null } }).data.reasonId).toBeNull();
  });
});

describe("RetentionDialog - przyjęta kontrofertka", () => {
  it("po akceptacji pokazuje kod kuponu i NIE anuluje subskrypcji", async () => {
    const { onConfirmCancel } = renderDialog();

    clickKey("retention.continue");
    await waitFor(() => expect(screen.getByText("retention.offer.title")).toBeTruthy());
    clickKey('retention.offer.accept {"pct":30}');

    await waitFor(() => expect(screen.getByText("STAY30")).toBeTruthy());
    expect(onConfirmCancel).not.toHaveBeenCalled();
  });

  it("kopiowanie kodu woła schowek i potwierdza", async () => {
    renderDialog();

    clickKey("retention.continue");
    await waitFor(() => expect(screen.getByText("retention.offer.title")).toBeTruthy());
    clickKey('retention.offer.accept {"pct":30}');
    await waitFor(() => expect(screen.getByText("STAY30")).toBeTruthy());
    clickKey("retention.accepted.copy");

    await waitFor(() => expect(h.clipboard).toHaveBeenCalledWith("STAY30"));
    expect(h.toastSuccess).toHaveBeenCalledWith("retention.accepted.copied");
  });

  it("brak uprawnień do schowka nie wywala ekranu - kod zostaje do przepisania", async () => {
    h.clipboard.mockRejectedValue(new Error("odmowa"));
    renderDialog();

    clickKey("retention.continue");
    await waitFor(() => expect(screen.getByText("retention.offer.title")).toBeTruthy());
    clickKey('retention.offer.accept {"pct":30}');
    await waitFor(() => expect(screen.getByText("STAY30")).toBeTruthy());
    clickKey("retention.accepted.copy");

    await waitFor(() => expect(h.clipboard).toHaveBeenCalled());
    expect(screen.getByText("STAY30")).toBeTruthy();
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("RetentionDialog - NIEUDANA rezygnacja nie może wyglądać jak udana", () => {
  // Zamknięcie okna jest dla klienta MOCNIEJSZYM sygnałem „zrobione" niż
  // znikający toast. Do 18.08.2026 dialog zamykał się identycznie po sukcesie
  // i po porażce, bo rodzic połykał wyjątek, a `onConfirmCancel` zawsze
  // rozwiązywał promise. Efekt: klient wychodził przekonany, że zrezygnował,
  // przy subskrypcji, która dalej była obciążana.
  it("okno ZOSTAJE otwarte, gdy anulowanie nie przeszło", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    h.settings.current = retentionSettings({ enabled: false });
    const { onOpenChange } = renderDialog({
      cancel: () => Promise.reject(new Error("provider_cancel_failed")),
    });

    clickKey("retention.continue");

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    consoleError.mockRestore();
  });

  it("komunikat mówi wprost, że subskrypcja jest nadal aktywna", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    h.settings.current = retentionSettings({ enabled: false });
    renderDialog({ cancel: () => Promise.reject(new Error("boom")) });

    clickKey("retention.continue");

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toBe("retention.errors.cancel");
    consoleError.mockRestore();
  });

  it("po nieudanej próbie MOŻNA ponowić rezygnację", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    h.settings.current = retentionSettings({ enabled: false });
    let attempt = 0;
    const { onConfirmCancel, onOpenChange } = renderDialog({
      cancel: () => {
        attempt += 1;
        return attempt === 1 ? Promise.reject(new Error("boom")) : Promise.resolve();
      },
    });

    clickKey("retention.continue");
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    clickKey("retention.continue");

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onConfirmCancel).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });

  it("udana rezygnacja NIE pokazuje komunikatu błędu i zamyka okno", async () => {
    h.settings.current = retentionSettings({ enabled: false });
    const { onOpenChange } = renderDialog();

    clickKey("retention.continue");

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("porażka po ODRZUCENIU OFERTY też nie zamyka okna", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { onOpenChange } = renderDialog({
      cancel: () => Promise.reject(new Error("boom")),
    });

    clickKey("retention.continue");
    await waitFor(() => expect(screen.getByText("retention.offer.title")).toBeTruthy());
    clickKey("retention.offer.declineAndCancel");

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    consoleError.mockRestore();
  });
});

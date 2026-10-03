// Dialog retencyjny - CYKL ŻYCIA OKNA i wyjścia poboczne.
//
// Podstawowy plik (`RetentionDialog.test.tsx`) dowodzi, że rezygnację da się
// dokończyć. Ten przypina to, co dzieje się WOKÓŁ niej:
//
//   1. OKNA NIE DA SIĘ ZAMKNĄĆ W TRAKCIE ANULOWANIA. Escape/kliknięcie obok,
//      gdy żądanie anulowania leci do operatora, zamknęłoby okno bez wyniku -
//      a zamknięcie jest dla klienta sygnałem „zrobione". Po bezczynności
//      Escape zamyka okno normalnie i NIE anuluje subskrypcji.
//   2. PONOWNE OTWARCIE ZACZYNA OD ANKIETY. Klient, który przyjął kontrofertę
//      albo zobaczył błąd, a potem wrócił, nie może zobaczyć starego kodu,
//      starego komunikatu porażki ani cudzego wyboru powodu.
//   3. WYJŚCIA POBOCZNE NIE ANULUJĄ. „Zmień plan na tańszy" i „Zamknij" po
//      przyjęciu oferty zamykają okno bez żądania anulowania i bez ankiety.
//   4. POWRÓT DO „INNY POWÓD" naprawdę zeruje wybór - raport retencji nie
//      może przypisać odejścia powodowi, który klient odznaczył.
//   5. BRAK DANYCH Z ZAPYTAŃ (wyłączone/niezaładowane) nie blokuje wyjścia.
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { retentionReasons, retentionSettings } from "@/test/billing/fixtures";
import { DZIEN, freezeClock, relativeIso } from "@/test/time";
import type { RetentionReasonRow, RetentionSettingsRow } from "@/lib/retention/queries";

freezeClock();

const h = vi.hoisted(() => ({
  settings: { current: undefined as RetentionSettingsRow | undefined },
  reasons: { current: undefined as RetentionReasonRow[] | undefined },
  submitFeedback: vi.fn(),
  acceptOffer: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/reactStubs")).reactI18nextStub());

vi.mock("@/lib/i18n-retention", () => ({ ensureI18n: () => {} }));

vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

// `useServerFn` w produkcji owija server fn w RPC - tu przepuszczamy na wylot.
vi.mock("@tanstack/react-start", () => ({ useServerFn: <T,>(fn: T) => fn }));

vi.mock("@/lib/retention/functions", () => ({
  submitRetentionFeedback: (arg: unknown) => h.submitFeedback(arg),
  acceptRetentionOffer: (arg: unknown) => h.acceptOffer(arg),
}));

vi.mock("@/lib/retention/queries", () => ({
  useRetentionSettings: () => ({ data: h.settings.current, isLoading: false }),
  useRetentionReasons: () => ({ data: h.reasons.current, isLoading: false }),
  reasonLabel: (reason: RetentionReasonRow, lang: string) =>
    lang === "en" ? reason.label_en : reason.label_pl,
}));

vi.mock("sonner", () => ({
  toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) },
}));

import { RetentionDialog } from "@/components/billing/organisms/RetentionDialog";

const ACCEPT = 'retention.offer.accept {"pct":30}';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Okno sterowane z zewnątrz (`open` jako prop), z rejestrem `onOpenChange`. */
function renderControlled(cancel: () => Promise<void> = () => Promise.resolve()) {
  const onConfirmCancel = vi.fn(cancel);
  const onOpenChange = vi.fn();
  const view = render(
    <RetentionDialog
      open
      onOpenChange={onOpenChange}
      subscriptionId="sub-1"
      onConfirmCancel={onConfirmCancel}
    />,
  );
  return { ...view, onConfirmCancel, onOpenChange };
}

/**
 * Rodzic jak w produkcji: trzyma `open` w stanie i otwiera okno ponownie
 * przyciskiem „anuluj subskrypcję". Tylko tak widać, czy stan dialogu
 * przeżywa zamknięcie.
 */
function Host({ onConfirmCancel }: { onConfirmCancel: () => Promise<void> }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        otwórz-ponownie
      </button>
      <RetentionDialog
        open={open}
        onOpenChange={setOpen}
        subscriptionId="sub-1"
        onConfirmCancel={onConfirmCancel}
      />
    </>
  );
}

const clickKey = (key: string) => fireEvent.click(screen.getByText(key));
const pressEscape = () =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

beforeEach(() => {
  h.settings.current = retentionSettings();
  h.reasons.current = retentionReasons();
  h.submitFeedback.mockReset().mockResolvedValue({ ok: true });
  h.acceptOffer.mockReset().mockResolvedValue({
    ok: true,
    code: "STAY30",
    discountPct: 30,
    discountPeriods: 3,
    validUntil: relativeIso(14 * DZIEN),
  });
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe("RetentionDialog - zamykanie okna", () => {
  it("Escape w spoczynku zamyka okno i NIE anuluje subskrypcji", () => {
    const { onOpenChange, onConfirmCancel } = renderControlled();

    pressEscape();

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirmCancel).not.toHaveBeenCalled();
    expect(h.submitFeedback).not.toHaveBeenCalled();
  });

  it("Escape W TRAKCIE anulowania jest ignorowany - okno czeka na wynik", async () => {
    h.settings.current = retentionSettings({ enabled: false });
    const pending = deferred();
    const { onOpenChange, onConfirmCancel } = renderControlled(() => pending.promise);

    clickKey("retention.continue");
    await waitFor(() => expect(onConfirmCancel).toHaveBeenCalledTimes(1));
    expect(screen.getByText("retention.continue").closest("button")).toBeDisabled();
    expect(screen.getByText("retention.keep").closest("button")).toBeDisabled();

    pressEscape();
    expect(onOpenChange).not.toHaveBeenCalled();

    pending.resolve();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onOpenChange).toHaveBeenCalledTimes(1);
  });
});

describe("RetentionDialog - ponowne otwarcie zaczyna od ankiety", () => {
  it("po przyjęciu oferty i zamknięciu nowe otwarcie nie pokazuje starego kodu", async () => {
    render(<Host onConfirmCancel={() => Promise.resolve()} />);

    fireEvent.click(screen.getByText("Nie korzystam"));
    fireEvent.change(screen.getByLabelText("retention.commentLabel"), {
      target: { value: "wracam za rok" },
    });
    clickKey("retention.continue");
    await waitFor(() => expect(screen.getByText("retention.offer.title")).toBeTruthy());
    clickKey(ACCEPT);
    await waitFor(() => expect(screen.getByText("STAY30")).toBeTruthy());
    expect(
      screen.getByText(/^retention\.accepted\.body \{"pct":30,"count":3,"date":".+"\}$/),
    ).toBeTruthy();

    clickKey("retention.accepted.close");
    await waitFor(() => expect(screen.queryByText("STAY30")).toBeNull());
    fireEvent.click(screen.getByText("otwórz-ponownie"));

    await waitFor(() => expect(screen.getByText("retention.title")).toBeTruthy());
    expect(screen.queryByText("STAY30")).toBeNull();
    expect(screen.getByLabelText("retention.commentLabel")).toHaveValue("");
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    // Ostatni wariant to „inny powód" - wybór klienta sprzed zamknięcia nie wraca.
    expect(radios.map((r) => r.checked)).toEqual([false, false, true]);
  });

  it("komunikat o nieudanym anulowaniu nie przeżywa zamknięcia okna", async () => {
    h.settings.current = retentionSettings({ enabled: false });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Host onConfirmCancel={() => Promise.reject(new Error("provider_cancel_failed"))} />);

    clickKey("retention.continue");
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    clickKey("retention.keep");
    await waitFor(() => expect(screen.queryByText("retention.title")).toBeNull());
    fireEvent.click(screen.getByText("otwórz-ponownie"));

    await waitFor(() => expect(screen.getByText("retention.title")).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
    consoleError.mockRestore();
  });

  it("odrzucona oferta (wyczerpana) po ponownym otwarciu znów pozwala ją przyjąć", async () => {
    h.acceptOffer.mockResolvedValueOnce({ ok: false, reason: "already_redeemed" });
    render(<Host onConfirmCancel={() => Promise.resolve()} />);

    clickKey("retention.continue");
    await waitFor(() => expect(screen.getByText("retention.offer.title")).toBeTruthy());
    clickKey(ACCEPT);
    await waitFor(() => expect(screen.getByText("retention.offer.alreadyRedeemed")).toBeTruthy());

    pressEscape();
    await waitFor(() => expect(screen.queryByText("retention.offer.title")).toBeNull());
    fireEvent.click(screen.getByText("otwórz-ponownie"));
    await waitFor(() => expect(screen.getByText("retention.title")).toBeTruthy());
    clickKey("retention.continue");

    await waitFor(() => expect(screen.getByText(ACCEPT)).toBeTruthy());
    expect(screen.queryByText("retention.offer.alreadyRedeemed")).toBeNull();
  });
});

describe("RetentionDialog - wyjścia poboczne nie anulują", () => {
  it("„zmień plan na tańszy” zamyka okno, prowadzi na cennik i NIE anuluje", async () => {
    const { onOpenChange, onConfirmCancel } = renderControlled();

    clickKey("retention.continue");
    await waitFor(() => expect(screen.getByText("retention.offer.title")).toBeTruthy());
    const link = screen.getByText("retention.offer.downgradeCta").closest("a")!;
    expect(link.getAttribute("href")).toBe("/pricing");
    fireEvent.click(link);

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirmCancel).not.toHaveBeenCalled();
    expect(h.submitFeedback).not.toHaveBeenCalled();
  });

  it("„zamknij” po przyjęciu oferty zamyka okno bez żądania anulowania", async () => {
    const { onOpenChange, onConfirmCancel } = renderControlled();

    clickKey("retention.continue");
    await waitFor(() => expect(screen.getByText("retention.offer.title")).toBeTruthy());
    clickKey(ACCEPT);
    await waitFor(() => expect(screen.getByText("STAY30")).toBeTruthy());
    clickKey("retention.accepted.close");

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirmCancel).not.toHaveBeenCalled();
    expect(h.acceptOffer).toHaveBeenCalledWith({
      data: { subscriptionId: "sub-1", reasonId: null, reasonLabel: "retention.otherReason" },
    });
  });
});

describe("RetentionDialog - wybór powodu", () => {
  it("powrót do „inny powód” zeruje wybór w ankiecie", async () => {
    h.settings.current = retentionSettings({ enabled: false });
    renderControlled();

    fireEvent.click(screen.getByText("Za drogo"));
    fireEvent.click(screen.getByText("retention.otherReason"));
    clickKey("retention.continue");

    await waitFor(() => expect(h.submitFeedback).toHaveBeenCalledTimes(1));
    expect(h.submitFeedback).toHaveBeenCalledWith({
      data: {
        subscriptionId: "sub-1",
        reasonId: null,
        reasonLabel: "retention.otherReason",
        comment: undefined,
        offerShown: false,
      },
    });
  });
});

describe("RetentionDialog - brak danych z zapytań nie blokuje wyjścia", () => {
  it("bez katalogu powodów i bez ustawień: tylko „inny powód” i rezygnacja od razu", async () => {
    h.reasons.current = undefined;
    h.settings.current = undefined;
    const { onConfirmCancel, onOpenChange } = renderControlled();

    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(screen.getByText("retention.otherReason")).toBeTruthy();
    clickKey("retention.continue");

    await waitFor(() => expect(onConfirmCancel).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("retention.offer.title")).toBeNull();
    expect(h.submitFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ offerShown: false }) }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

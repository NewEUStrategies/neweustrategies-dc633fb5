// Test komponentu bota demo: dowód, że podgląd renderuje się przez realny
// MessageList z pełnym UX - dymki obu stron (karta rozmówcy / gradient
// nadawcy), separatory dni, godziny wysłania, cykl potwierdzeń aż do
// "odczytano" oraz echo bota po wskaźniku "pisze...".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/lib/i18n-chat";
import { chatPl } from "@/lib/i18n-chat";
import { DemoBotChat } from "../DemoBotChat";

// MessageList używa hooków React Query (usePeerProfiles), więc podgląd musi
// być zamontowany pod providerem - jak w realnej aplikacji (__root.tsx).
function renderDemo() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DemoBotChat lang="pl" />
    </QueryClientProvider>,
  );
}

// happy-dom nie implementuje płynnego przewijania używanego przez MessageList.
beforeEach(() => {
  vi.useFakeTimers();
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => undefined);
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DemoBotChat", () => {
  it("renders the welcome message inside a real inbound bubble with a day separator", () => {
    renderDemo();

    // Powitanie bota widoczne i opakowane w kartę dymka (nie goły tekst).
    const welcome = screen.getByText(chatPl.chat.demoBot.welcome);
    const bubble = welcome.closest("div.rounded-\\[6px\\]");
    expect(bubble).not.toBeNull();
    expect(bubble?.className).toContain("bg-card");

    // Powitanie datowane na wczoraj -> separator dnia od pierwszego otwarcia.
    expect(screen.getByText(chatPl.chat.yesterday)).toBeTruthy();
  });

  it("runs the full send cycle: bubble, clock time, receipts up to read, bot echo", () => {
    renderDemo();

    const textarea = screen.getByLabelText(chatPl.chat.inputPlaceholder);
    fireEvent.change(textarea, { target: { value: "Test dymka" } });
    fireEvent.submit(textarea.closest("form") as HTMLFormElement);

    // Wiadomość pojawia się natychmiast (optymistycznie, status "wysyłanie").
    const sent = screen.getByText("Test dymka");
    expect(sent).toBeTruthy();
    expect(screen.getByTitle(chatPl.chat.receipt.pending)).toBeTruthy();

    // Po pełnym cyklu: dostarczono -> bot pisze -> echo + odczytano.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText(/Echo: Test dymka/)).toBeTruthy();
    expect(screen.getByTitle(chatPl.chat.receipt.read)).toBeTruthy();

    // Godzina wysłania renderuje się przy dymku (HH:MM).
    const meta = sent.closest("div.rounded-\\[6px\\]");
    expect(meta?.textContent ?? "").toMatch(/\d{1,2}:\d{2}/);

    // Znacznik "Wyświetlone" z awatarem pod ostatnią własną wiadomością.
    expect(screen.getByTitle(chatPl.chat.seen)).toBeTruthy();
  });

  it("separates today's messages from yesterday's welcome with a second day label", () => {
    renderDemo();
    const textarea = screen.getByLabelText(chatPl.chat.inputPlaceholder);
    fireEvent.change(textarea, { target: { value: "Dzisiejsza" } });
    fireEvent.submit(textarea.closest("form") as HTMLFormElement);
    expect(screen.getByText(chatPl.chat.today)).toBeTruthy();
    expect(screen.getByText(chatPl.chat.yesterday)).toBeTruthy();
  });
});

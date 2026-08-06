// Granica leniwego ładowania kasy (korekta 1 z audytu 2026-08-06).
//
// Modal osadzonego checkoutu ciągnie SDK operatora, a montowany jest w miejscach
// renderowanych KAŻDEMU czytelnikowi (paywall wpisu, formularz darowizny,
// przycisk biletu). Kontrakt jest więc twardy: dopóki nie ma sesji, moduł kasy
// nie może zostać nawet zaimportowany.
//
// Fabryka `vi.mock` wykonuje się przy PIERWSZYM imporcie modułu, więc licznik
// poniżej jest bezpośrednim dowodem, czy chunk został pobrany. Dlatego ten plik
// testuje wyłącznie tę jedną rzecz - drugi import w tym samym pliku nie
// odpaliłby fabryki po raz kolejny.
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ imports: 0 }));

vi.mock("@/components/checkout/EmbeddedCheckoutDialog", () => {
  h.imports += 1;
  return {
    EmbeddedCheckoutDialog: ({ clientSecret }: { clientSecret: string | null }) => (
      <div data-testid="dialog">{clientSecret}</div>
    ),
  };
});

import { LazyEmbeddedCheckoutDialog } from "@/components/checkout/LazyEmbeddedCheckoutDialog";

afterEach(cleanup);

describe("LazyEmbeddedCheckoutDialog", () => {
  it("nie importuje kasy bez sesji, a po jej otwarciu zostaje zamontowany", async () => {
    const onOpenChange = vi.fn();
    const view = render(
      <LazyEmbeddedCheckoutDialog clientSecret={null} onOpenChange={onOpenChange} />,
    );

    // 1. Zamknięty: zero DOM-u i zero pobranego kodu kasy.
    expect(h.imports).toBe(0);
    expect(view.container.innerHTML).toBe("");

    // 2. Sesja wróciła z serwera - dopiero teraz pobieramy chunk.
    view.rerender(
      <LazyEmbeddedCheckoutDialog clientSecret="cs_secret_1" onOpenChange={onOpenChange} />,
    );
    await waitFor(() => expect(screen.getByTestId("dialog")).toBeTruthy());
    expect(h.imports).toBe(1);
    expect(screen.getByTestId("dialog").textContent).toBe("cs_secret_1");

    // 3. Po zamknięciu modal ZOSTAJE zamontowany - inaczej Radix nie dograłby
    //    animacji wyjścia, a użytkownik zobaczyłby ucięcie w pół ruchu.
    view.rerender(<LazyEmbeddedCheckoutDialog clientSecret={null} onOpenChange={onOpenChange} />);
    expect(screen.getByTestId("dialog").textContent).toBe("");
    expect(h.imports).toBe(1);
  });
});

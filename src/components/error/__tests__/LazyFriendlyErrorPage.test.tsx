// LENIWA GRANICA EKRANU BŁĘDU (`LazyFriendlyErrorPage`).
//
// CZEGO TEN PLIK DOWODZI:
//   1. SSR strony błędu NADAL działa w całości: `React.lazy` renderuje się
//      w strumieniu, a po `allReady` dokument niesie prawdziwy ekran (nagłówek
//      i słownik awaryjny), nie sam fallback - i nigdy surowej treści wyjątku;
//   2. w przeglądarce pierwszy render to BEZSŁOWNA rezerwacja miejsca
//      (`aria-busy`), a ekran wchodzi po rozwiązaniu modułu;
//   3. gdy chunk ekranu NIE dojedzie, granica nie wypuszcza wyjątku do
//      nadrzędnej granicy (`__root`) - renderuje minimalną kartę ze słownika
//      awaryjnego i przyciskiem przeładowania.
//
// Atrapy jak w `FriendlyErrorPage.test.tsx` (router bez providera, beacon
// incydentów bez sieci). Zero sieci.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToReadableStream } from "react-dom/server";

const h = vi.hoisted(() => ({
  reports: [] as unknown[],
}));

vi.mock("@/lib/platform-error-reporting", () => ({
  reportPlatformError: (error: unknown) => {
    h.reports.push(error);
  },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    ...actual,
    Link: RouterLinkStub,
    useRouter: () => ({
      invalidate: () => Promise.resolve(),
      navigate: () => Promise.resolve(),
      history: { back: () => {} },
    }),
  };
});

import { errorCopy } from "@/lib/errorCopy";

async function renderSsr(element: React.ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
}

beforeEach(() => {
  h.reports.length = 0;
});

afterEach(() => {
  cleanup();
  vi.doUnmock("@/components/error/FriendlyErrorPage");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("LazyFriendlyErrorPage - SSR", () => {
  it("strumień serwerowy niesie PEŁNY ekran błędu po `allReady`, bez treści wyjątku", async () => {
    const { LazyFriendlyErrorPage } = await import("../LazyFriendlyErrorPage");
    const html = await renderSsr(<LazyFriendlyErrorPage error={new Error("TAJNY-STACK")} />);
    const copy = errorCopy();
    expect(html).toContain("<h1");
    expect(html).toContain(copy.generic.title);
    expect(html).not.toContain("TAJNY-STACK");
  });

  it("wariant `compact` przechodzi przez granicę do ekranu (ta sama treść, inny układ)", async () => {
    const { LazyFriendlyErrorPage } = await import("../LazyFriendlyErrorPage");
    const html = await renderSsr(
      <LazyFriendlyErrorPage error={{ status: 401 }} variant="compact" title="Panel" />,
    );
    expect(html).toContain("<h2");
    expect(html).toContain("Panel");
    expect(html).toContain(errorCopy().unauthorized.body);
  });
});

describe("LazyFriendlyErrorPage - przeglądarka", () => {
  it("najpierw bezsłowna rezerwacja miejsca, potem ekran po rozwiązaniu modułu", async () => {
    const { LazyFriendlyErrorPage } = await import("../LazyFriendlyErrorPage");
    const { container } = render(<LazyFriendlyErrorPage error={new Error("x")} />);
    const placeholder = container.querySelector('[aria-busy="true"]');
    expect(placeholder).not.toBeNull();
    // Fallback nie ma prawa nieść tekstu - słownik czyta dopiero ekran.
    expect(placeholder?.textContent).toBe("");
    await vi.dynamicImportSettled();
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeTruthy());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(errorCopy().generic.title);
  });

  it("nieudane pobranie chunku kończy się kartą awaryjną i przeładowaniem, nie pustą stroną", async () => {
    vi.doMock("@/components/error/FriendlyErrorPage", () => {
      throw new Error("ChunkLoadError: sieć leży");
    });
    const { LazyFriendlyErrorPage } = await import("../LazyFriendlyErrorPage");
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    // React loguje przechwycony wyjątek granicy - to oczekiwany szum tego testu.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<LazyFriendlyErrorPage error={new Error("x")} />);
    await vi.dynamicImportSettled();
    const alert = await screen.findByRole("alert");
    const copy = errorCopy();
    expect(alert.textContent).toContain(copy.errorTitle);
    fireEvent.click(screen.getByRole("button", { name: copy.tryAgain }));
    expect(reload).toHaveBeenCalledTimes(1);
    quiet.mockRestore();
    vi.unstubAllGlobals();
  });
});

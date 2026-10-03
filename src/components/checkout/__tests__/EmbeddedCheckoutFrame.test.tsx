// Leniwa ramka Stripe Embedded Checkout - `EmbeddedCheckoutFrame.tsx`.
//
// RYZYKO, KTÓRE TEN PLIK PINUJE. To jest ostatni krok zakupu: kupujący ma
// już sesję u operatora (`clientSecret`) i czeka na formularz karty.
//   1. SSR NIE MOŻE dotknąć SDK operatora - serwer renderuje wyłącznie
//      placeholder o kształcie formularza (bez skoku layoutu po hydratacji),
//      a `React.lazy` startuje dopiero w przeglądarce.
//   2. Po stronie klienta ramka dostaje DOKŁADNIE ten `clientSecret`, który
//      zwrócił serwer, i schemat kolorów bieżącego motywu (Stripe czyta go
//      tylko przy inicjalizacji - zmiana motywu musi przemontować ramkę).
//   3. Awaria ramki (SDK operatora rzuca, chunk nie dojechał) nie może
//      zostawić PUSTEGO miejsca w kasie ani wysypać całej strony: kupujący
//      widzi komunikat i przycisk przeładowania, a awaria trafia do
//      raportowania z tagiem `checkout_embedded_frame`.
//
// GRANICA ATRAP: SDK operatora (`@stripe/stripe-js` - skrypt z sieci Stripe,
// `@stripe/react-stripe-js` - ramka iframe) i token publikowalny w env.
// `StripeEmbeddedFrame`, `lib/stripe`, granica błędów, motyw i i18n biegną
// prawdziwe. SDK jest importowane wyłącznie przez `vi.mock` - statyczny import
// `@stripe/*` w drzewie `src` łamie bramkę `embeddedCheckoutLazyBoundary`.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";

const h = vi.hoisted(() => {
  // Token czytany przy ładowaniu `lib/stripe` - musi istnieć przed importami.
  vi.stubEnv("VITE_PAYMENTS_CLIENT_TOKEN", "pk_test_SyntetycznyTokenPublikowalny");
  return {
    stripeJs: { id: "stripe-js-atrapa" },
    loadStripe: vi.fn<(token: string) => Promise<unknown>>(),
    providerProps: [] as { stripe: unknown; options: { clientSecret: string } }[],
    providerMounts: 0,
    sdkError: null as Error | null,
  };
});

vi.mock("@stripe/stripe-js", () => ({ loadStripe: h.loadStripe }));

vi.mock("@stripe/react-stripe-js", async () => {
  const { useEffect } = await import("react");
  return {
    EmbeddedCheckoutProvider: ({
      stripe,
      options,
      children,
    }: {
      stripe: unknown;
      options: { clientSecret: string };
      children: React.ReactNode;
    }) => {
      h.providerProps.push({ stripe, options });
      useEffect(() => {
        h.providerMounts += 1;
      }, []);
      return (
        <div data-testid="stripe-provider" data-client-secret={options.clientSecret}>
          {children}
        </div>
      );
    },
    EmbeddedCheckout: () => {
      if (h.sdkError) throw h.sdkError;
      return <div data-testid="stripe-checkout-form" />;
    },
  };
});

import i18n from "@/lib/i18n";
import { ThemeProvider, useTheme } from "@/components/ThemeProvider";
import { EmbeddedCheckoutFrame } from "@/components/checkout/EmbeddedCheckoutFrame";

const SECRET = "cs_test_a1B2c3_secret_example";

function DarkModeSwitch() {
  const { setTheme } = useTheme();
  return (
    <button type="button" onClick={() => setTheme("dark")}>
      tryb ciemny
    </button>
  );
}

function mount(className?: string) {
  return render(
    <ThemeProvider>
      <DarkModeSwitch />
      <EmbeddedCheckoutFrame clientSecret={SECRET} className={className} />
    </ThemeProvider>,
  );
}

beforeAll(async () => {
  await i18n.changeLanguage("pl");
});

beforeEach(() => {
  h.loadStripe.mockReset().mockResolvedValue(h.stripeJs);
  h.providerProps.length = 0;
  h.providerMounts = 0;
  h.sdkError = null;
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.className = "";
  Reflect.deleteProperty(window, "__lovableEvents");
});

describe("EmbeddedCheckoutFrame - SSR", () => {
  it("serwer renderuje sam placeholder formularza i nie dotyka SDK operatora", () => {
    const html = renderToString(
      <ThemeProvider>
        <EmbeddedCheckoutFrame clientSecret={SECRET} className="min-h-[640px]" />
      </ThemeProvider>,
    );

    expect(html).toContain('data-testid="checkout-frame-skeleton"');
    // Klasa wołającego trafia do placeholdera - podmiana na ramkę nie przesuwa layoutu.
    expect(html).toContain('class="w-full space-y-4 min-h-[640px]"');
    expect(html).toContain("Ładowanie formularza płatności...");
    expect(html).not.toContain("stripe-embedded-frame");
    expect(html).not.toContain(SECRET);
    expect(h.loadStripe).not.toHaveBeenCalled();
  });

  it("placeholder bez klasy wołającego nie zostawia spacji w atrybucie class", () => {
    const html = renderToString(<EmbeddedCheckoutFrame clientSecret={SECRET} />);

    expect(html).toContain('class="w-full space-y-4"');
  });
});

// KOLEJNOŚĆ MA ZNACZENIE: `React.lazy` trzyma pobrany chunk na poziomie modułu,
// więc placeholder na kliencie widać wyłącznie przy PIERWSZYM renderze ramki
// w tym pliku - ten przypadek musi zostać pierwszym renderem klienckim.
describe("EmbeddedCheckoutFrame - przeglądarka", () => {
  it("najpierw placeholder, potem ramka operatora z sekretem sesji i jasnym schematem", async () => {
    mount("min-h-[640px]");

    // Placeholder bez klasy-sieroty: dokładnie klasa wołającego, bez spacji na końcu.
    const skeleton = screen.getByTestId("checkout-frame-skeleton");
    expect(skeleton).toHaveAttribute("class", "w-full space-y-4 min-h-[640px]");
    expect(skeleton).toHaveAttribute("role", "status");

    expect(await screen.findByTestId("stripe-checkout-form")).toBeInTheDocument();
    expect(screen.queryByTestId("checkout-frame-skeleton")).not.toBeInTheDocument();

    const frame = screen.getByTestId("stripe-embedded-frame");
    expect(frame).toHaveClass("min-h-[640px]");
    expect(frame.style.colorScheme).toBe("light");
    expect(screen.getByTestId("stripe-provider")).toHaveAttribute("data-client-secret", SECRET);
    expect(h.providerProps.at(-1)?.options).toEqual({ clientSecret: SECRET });
    // SDK ładowane tokenem publikowalnym z konfiguracji - jeden raz.
    await expect(h.providerProps.at(-1)?.stripe).resolves.toBe(h.stripeJs);
    expect(h.loadStripe).toHaveBeenCalledTimes(1);
    expect(h.loadStripe).toHaveBeenCalledWith("pk_test_SyntetycznyTokenPublikowalny");
  });

  it("przełączenie na tryb ciemny przemontowuje ramkę w ciemnym schemacie", async () => {
    mount();
    await screen.findByTestId("stripe-checkout-form");
    expect(h.providerMounts).toBe(1);
    // SDK pierwszej ramki już załadowane - dopiero wtedy liczymy pobrania.
    await h.providerProps.at(-1)?.stripe;
    const sdkLoads = h.loadStripe.mock.calls.length;

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "tryb ciemny" }));
    });

    expect(screen.getByTestId("stripe-embedded-frame").style.colorScheme).toBe("dark");
    // Stripe czyta schemat tylko przy inicjalizacji - bez przemontowania
    // biały formularz zostawałby na ciemnym tle.
    expect(h.providerMounts).toBe(2);
    expect(h.providerProps.at(-1)?.options).toEqual({ clientSecret: SECRET });
    // Przemontowanie ramki nie pobiera SDK operatora drugi raz.
    expect(h.loadStripe).toHaveBeenCalledTimes(sdkLoads);
  });
});

describe("EmbeddedCheckoutFrame - awaria ramki", () => {
  it("awaria SDK pokazuje komunikat z przeładowaniem i trafia do raportowania", async () => {
    const capture = vi.fn();
    Reflect.set(window, "__lovableEvents", { captureException: capture });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    h.sdkError = new Error("IntegrationError: Invalid client secret");

    mount();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Nie udało się wczytać formularza płatności. Odśwież stronę i spróbuj ponownie.",
    );
    // Komunikat ZAMIAST ramki - nie obok pustego placeholdera.
    expect(screen.queryByTestId("checkout-frame-skeleton")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stripe-checkout-form")).not.toBeInTheDocument();
    expect(capture).toHaveBeenCalledWith(
      h.sdkError,
      expect.objectContaining({ boundary: "checkout_embedded_frame" }),
      expect.objectContaining({ mechanism: "react_error_boundary" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Odśwież stronę" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

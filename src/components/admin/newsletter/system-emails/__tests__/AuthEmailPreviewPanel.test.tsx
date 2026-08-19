// Podgląd maili autoryzacyjnych i aplikacyjnych - OSTATNIE miejsce, w którym da
// się zobaczyć maila przed wysyłką do prawdziwego adresata.
//
// Panel zawsze coś pokazuje, więc jego pomyłki są ciche:
//   * bezimienna pozycja na liście to szablon, którego operator nie potrafi
//     wybrać (typ przychodzi z serwera jako zwykły napis, więc nowy typ musi
//     mieć awaryjny podpis);
//   * przełączenie zakresu bez przestawienia typu daje PUSTE okno - operator
//     czyta to jako awarię panelu;
//   * parametry personalizacji (imię, rodzaj gramatyczny, język) muszą trafić do
//     ZAPYTANIA; inaczej podgląd pokazuje maila, którego nikt nie dostanie.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const env = vi.hoisted(() => ({
  auth: [] as unknown[],
  app: [] as unknown[],
  calls: [] as { scope: "auth" | "app"; data: Record<string, unknown> }[],
}));

// Renderowanie szablonów robi serwer - atrapa. Żaden test nie wykonuje realnego
// żądania i żaden adres w danych nie jest prawdziwy.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return {
    ...actual,
    useServerFn:
      (fn: { scope?: "auth" | "app" }) => async (input: { data: Record<string, unknown> }) => {
        const scope = fn.scope === "app" ? "app" : "auth";
        env.calls.push({ scope, data: input.data });
        return scope === "auth" ? env.auth : env.app;
      },
  };
});
vi.mock("@/lib/auth-email-preview.functions", () => ({
  getAuthEmailPreviews: { scope: "auth" },
}));
vi.mock("@/lib/tx-email-preview.functions", () => ({
  getTxEmailPreviews: { scope: "app" },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import i18n from "@/lib/i18n";
import { toast } from "sonner";
import { AuthEmailPreviewPanel } from "@/components/admin/newsletter/system-emails/AuthEmailPreviewPanel";
import { TYPE_LABEL_KEYS } from "@/components/admin/newsletter/system-emails/authPreviewRules";

const P = (key: string) => i18n.t(`adminNewsletter.emailPreview.${key}`);
const typeLabel = (type: string) => i18n.t(TYPE_LABEL_KEYS[type]!);

function preview(type: string, overrides: Record<string, unknown> = {}) {
  return {
    type,
    lang: "pl" as const,
    subject: `Temat ${type}`,
    html: `<p>tresc ${type}</p>`,
    text: `tekst ${type}`,
    ...overrides,
  };
}

const AUTH = [preview("signup"), preview("recovery"), preview("magiclink")];
const APP = [preview("subscription_confirmed"), preview("subscription_renewed")];

async function mount() {
  const utils = renderWithQueryClient(<AuthEmailPreviewPanel />);
  if (env.auth.length > 0) await screen.findByText(typeLabel("signup"));
  return utils;
}

/** Ostatnie zapytanie o podgląd. */
function lastCall() {
  return env.calls.at(-1)!;
}

beforeAll(async () => {
  await i18n.changeLanguage("pl");
});

beforeEach(() => {
  env.auth = AUTH;
  env.app = APP;
  env.calls = [];
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
describe("lista szablonów", () => {
  it("pokazuje pozycję dla każdego szablonu z serwera, z tematem", async () => {
    await mount();

    expect(screen.getByText(typeLabel("recovery"))).toBeTruthy();
    expect(screen.getByText("Temat recovery")).toBeTruthy();
  });

  it("typ NIEZNANY słownikowi podpisuje się swoją nazwą, nie pustką", async () => {
    // Bezimienna pozycja to szablon, którego operator nie potrafi wybrać.
    env.auth = [preview("cos_nowego_z_serwera")];
    renderWithQueryClient(<AuthEmailPreviewPanel />);

    expect(await screen.findByText("cos_nowego_z_serwera")).toBeTruthy();
  });

  it("dopóki dane nie doszły, lista pokazuje szkielet, a nie pustkę", () => {
    const { container } = renderWithQueryClient(<AuthEmailPreviewPanel />);

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByText(typeLabel("signup"))).toBeNull();
  });

  it("wybór szablonu przestawia PODGLĄD, nie tylko podświetlenie", async () => {
    await mount();

    fireEvent.click(screen.getByText(typeLabel("recovery")));

    const frame = screen.getByTitle("email-preview-recovery-pl") as HTMLIFrameElement;
    expect(frame.getAttribute("srcdoc")).toContain("tresc recovery");
  });

  it("temat wybranego szablonu jest w nagłówku podglądu", async () => {
    await mount();

    fireEvent.click(screen.getByText(typeLabel("magiclink")));

    expect(screen.getAllByText("Temat magiclink").length).toBeGreaterThan(1);
    expect(screen.getByTitle("email-preview-magiclink-pl")).toBeTruthy();
  });

  it("bez danych nagłówek podglądu pokazuje kreskę", () => {
    env.auth = [];
    renderWithQueryClient(<AuthEmailPreviewPanel />);

    expect(screen.getByText("-")).toBeTruthy();
    expect(screen.getByText(P("copyHtml")).closest("button")).toHaveProperty("disabled", true);
  });
});

// ---------------------------------------------------------------------------
describe("zakres szablonów", () => {
  it("start jest na maILACH AUTORYZACYJNYCH", async () => {
    await mount();

    expect(lastCall().scope).toBe("auth");
    expect(screen.getByText(P("scopeAuth")).getAttribute("aria-pressed")).toBe("true");
  });

  it("zmiana zakresu pyta o INNY zestaw szablonów", async () => {
    await mount();

    fireEvent.click(screen.getByText(P("scopeApp")));

    await waitFor(() => expect(lastCall().scope).toBe("app"));
    expect(await screen.findByText(typeLabel("subscription_confirmed"))).toBeTruthy();
  });

  it("po zmianie zakresu aktywny jest typ Z TEGO zakresu - okno nie zostaje puste", async () => {
    // Zostawienie „signup" w zakresie aplikacyjnym dałoby puste okno podglądu.
    await mount();

    fireEvent.click(screen.getByText(P("scopeApp")));

    const frame = (await screen.findByTitle(
      "email-preview-subscription_confirmed-pl",
    )) as HTMLIFrameElement;
    expect(frame.getAttribute("srcdoc")).toContain("tresc subscription_confirmed");
  });

  it("powrót na zakres autoryzacyjny wraca do rejestracji - bez ponownego pytania serwera", async () => {
    // Zestaw autoryzacyjny jest już w pamięci zapytań, więc powrót ma być
    // natychmiastowy; liczy się to, CO widać, nie kolejny round-trip.
    await mount();
    fireEvent.click(screen.getByText(P("scopeApp")));
    await waitFor(() => expect(lastCall().scope).toBe("app"));
    const zapytania = env.calls.length;

    fireEvent.click(screen.getByText(P("scopeAuth")));

    expect(await screen.findByTitle("email-preview-signup-pl")).toBeTruthy();
    expect(env.calls.length).toBe(zapytania);
  });
});

// ---------------------------------------------------------------------------
describe("parametry personalizacji", () => {
  it("imię trafia do ZAPYTANIA, obcięte z brzegowych spacji", async () => {
    await mount();

    fireEvent.change(screen.getByLabelText(P("firstName")), { target: { value: "  Anna  " } });

    await waitFor(() => expect(lastCall().data.firstName).toBe("Anna"));
  });

  it("PUSTE imię znaczy „bez imienia”, a nie pusty napis w powitaniu", async () => {
    // Pusty napis dałby w mailu „Cześć ,” z osieroconym przecinkiem.
    await mount();

    fireEvent.change(screen.getByLabelText(P("firstName")), { target: { value: "   " } });

    await waitFor(() => expect(lastCall().data.firstName).toBeNull());
  });

  it("rodzaj gramatyczny trafia do zapytania", async () => {
    await mount();

    fireEvent.click(screen.getByText(P("genderFemale")));

    await waitFor(() => expect(lastCall().data.gender).toBe("female"));
  });

  it("język podglądu trafia do zapytania niezależnie od języka panelu", async () => {
    await mount();

    fireEvent.click(screen.getByText("EN"));

    await waitFor(() => expect(lastCall().data.lang).toBe("en"));
    expect(screen.getByText("EN").getAttribute("aria-pressed")).toBe("true");
  });
});

// ---------------------------------------------------------------------------
describe("ramka podglądu", () => {
  it("jest w PIASKOWNICY - podgląd nie wykonuje niczego z treści maila", async () => {
    await mount();

    const frame = screen.getByTitle("email-preview-signup-pl");
    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(frame.tagName).toBe("IFRAME");
  });

  it("telefon zwęża ramkę - o tym jest cały przełącznik", async () => {
    await mount();
    const frame = () => screen.getByTitle("email-preview-signup-pl") as HTMLIFrameElement;
    expect(frame().style.maxWidth).toBe("720px");

    fireEvent.click(screen.getByLabelText(P("deviceMobile")));

    expect(frame().style.maxWidth).toBe("390px");
  });

  it("powrót na komputer poszerza ramkę", async () => {
    await mount();
    fireEvent.click(screen.getByLabelText(P("deviceMobile")));

    fireEvent.click(screen.getByLabelText(P("deviceDesktop")));

    expect((screen.getByTitle("email-preview-signup-pl") as HTMLIFrameElement).style.maxWidth).toBe(
      "720px",
    );
  });

  it("przełącznik szerokości ma NAZWY dostępne - to same ikony", async () => {
    await mount();

    expect(screen.getByLabelText(P("deviceDesktop"))).toBeTruthy();
    expect(screen.getByLabelText(P("deviceMobile"))).toBeTruthy();
  });

  it("wersja tekstowa maila jest dostępna obok ramki", async () => {
    // Klienty poczty bez HTML-a dostają właśnie ją - musi dać się sprawdzić.
    await mount();

    expect(screen.getByText(P("plainText"))).toBeTruthy();
    expect(screen.getByText("tekst signup")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("kopiowanie HTML", () => {
  it("kopiuje HTML AKTYWNEGO szablonu i potwierdza to operatorowi", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    await mount();
    fireEvent.click(screen.getByText(typeLabel("recovery")));

    fireEvent.click(screen.getByText(P("copyHtml")));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("<p>tresc recovery</p>"));
    expect(toast.success).toHaveBeenCalledWith(P("copied"));
  });

  it("bez aktywnego szablonu kopiowanie jest zablokowane", () => {
    env.auth = [];
    renderWithQueryClient(<AuthEmailPreviewPanel />);

    expect(screen.getByText(P("copyHtml")).closest("button")).toHaveProperty("disabled", true);
    expect(toast.success).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("tłumaczenia", () => {
  it("etykiety panelu idą za językiem interfejsu", async () => {
    await i18n.changeLanguage("en");
    try {
      await mount();

      expect(screen.getByText(i18n.t("adminNewsletter.emailPreview.title"))).toBeTruthy();
      expect(screen.getByText(i18n.t("adminNewsletter.emailPreview.copyHtml"))).toBeTruthy();
    } finally {
      await i18n.changeLanguage("pl");
    }
  });
});

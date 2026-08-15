// Regresja: kanwa buildera rysowała dla widgetu `newsletter` statyczną atrapę,
// która honorowała 5 z 21 ustawień (tytuł, wariant, ikona, placeholder, CTA).
// Pozostałe 16 - showFirstName / showLastName / showCompany, komplet require*,
// wszystkie *Label i *Placeholder oraz customFields - były widoczne dopiero po
// publikacji. Atrapa zniknęła: kanwa i strona publiczna renderują ten sam
// <NewsletterForm/> z tą samą konfiguracją, a kanwa dodatkowo nie może wysłać
// zgłoszenia do bazy.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BuilderModeProvider } from "@/lib/content-model/editorCanvas";
import { WidgetView } from "@/components/builder/organisms/WidgetView";
import type { WidgetContent, WidgetNode } from "@/lib/builder/types";

const { subscribeSpy } = vi.hoisted(() => ({
  subscribeSpy: vi.fn(async () => ({ ok: true as const })),
}));

// Podział kodu (React.lazy) zamieniony na importy statyczne - bez tego pierwszy
// render leniwych widgetów (w tym kanwowego Editable) pokazuje fallback Suspense.
// Lustro eager jest kontraktowo identyczne z rejestrem.
vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

vi.mock("@/integrations/supabase/client", () => {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "not", "order", "range", "limit"]) b[m] = () => b;
  b.then = (r: (v: unknown) => unknown) => r({ data: [], error: null });
  return {
    supabase: {
      channel: () => {
        const ch: { on: () => typeof ch; subscribe: () => typeof ch } = {
          on: () => ch,
          subscribe: () => ch,
        };
        return ch;
      },
      removeChannel: () => {},
      from: () => b,
      rpc: async () => ({ data: [], error: null }),
    },
  };
});
vi.mock("@/lib/i18n-public", () => ({}));
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: () => subscribeSpy };
});
vi.mock("@/lib/newsletter.functions", () => ({ subscribeToNewsletter: {} }));
vi.mock("@/components/newsletter/NewsletterDocRenderer", () => ({
  NewsletterDocRenderer: () => null,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "pl" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/hooks/useNewsletterSettings", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useNewsletterSettings")>(
    "@/hooks/useNewsletterSettings",
  );
  return {
    ...actual,
    useNewsletterSettings: () => ({
      data: {
        ...actual.defaultNewsletterSettings(),
        enabled: true,
        mode: "inline",
        inline_doc: null,
      },
    }),
  };
});

afterEach(() => {
  cleanup();
  subscribeSpy.mockClear();
});

type Cfg = WidgetContent;

/** Pełna konfiguracja: wszystkie przełączniki, etykiety i pole dodatkowe. */
const FULL_CONFIG: Cfg = {
  variant: "card",
  title_pl: "Nasz newsletter",
  cta_pl: "Zapisz mnie",
  placeholder_pl: "jan@firma.pl",
  showFirstName: "1",
  showLastName: "1",
  showCompany: "1",
  requireFirstName: "1",
  requireLastName: "0",
  requireCompany: "1",
  requireEmail: "1",
  firstNameLabel_pl: "Imię redakcyjne",
  lastNameLabel_pl: "Nazwisko redakcyjne",
  companyLabel_pl: "Organizacja",
  emailLabel_pl: "Adres e-mail",
  firstNamePlaceholder_pl: "np. Jan",
  lastNamePlaceholder_pl: "np. Kowalski",
  companyPlaceholder_pl: "Nazwa firmy",
  customFields: [
    JSON.stringify({
      id: "branza",
      type: "text",
      labelPl: "Branża",
      placeholderPl: "np. energetyka",
      required: true,
    }),
  ],
};

async function renderWidget(content: Cfg, editable: boolean): Promise<HTMLElement> {
  const node: WidgetNode = { id: "nl-1", kind: "widget", type: "newsletter", content };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (
    <QueryClientProvider client={qc}>
      <WidgetView
        node={node}
        lang="pl"
        device="desktop"
        editable={editable}
        onContentChange={editable ? () => {} : undefined}
      />
    </QueryClientProvider>
  );
  const { container } = render(
    editable ? <BuilderModeProvider mode="light">{view}</BuilderModeProvider> : view,
  );
  // Formularz jest ładowany leniwie (React.lazy) - czekamy na realny chunk.
  await waitFor(() => expect(container.querySelector("form")).toBeTruthy());
  return container;
}

/** Odcisk palca pól formularza: co użytkownik faktycznie widzi. */
function fieldFingerprint(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("input, textarea, select")).map((el) => {
    const type = el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase();
    const name = el.getAttribute("name") ?? "";
    const placeholder = el.getAttribute("placeholder") ?? "";
    const required = el.hasAttribute("required") ? "required" : "optional";
    return `${type}|${name}|${placeholder}|${required}`;
  });
}

function labelTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("label")).map((el) => el.textContent ?? "");
}

describe("newsletter: parytet kanwa <-> strona publiczna", () => {
  it("ten sam config daje ten sam zestaw pól po obu stronach", async () => {
    const canvas = await renderWidget(FULL_CONFIG, true);
    const canvasFields = fieldFingerprint(canvas);
    const canvasLabels = labelTexts(canvas);
    cleanup();

    const publicView = await renderWidget(FULL_CONFIG, false);
    expect(fieldFingerprint(publicView)).toEqual(canvasFields);
    expect(labelTexts(publicView)).toEqual(canvasLabels);
  });

  it("kanwa pokazuje ustawienia, których atrapa nie honorowała", async () => {
    const canvas = await renderWidget(FULL_CONFIG, true);
    const placeholders = fieldFingerprint(canvas).join("\n");

    // showFirstName / showLastName / showCompany + ich placeholdery.
    expect(placeholders).toContain("np. Jan");
    expect(placeholders).toContain("np. Kowalski");
    expect(placeholders).toContain("Nazwa firmy");
    // customFields.
    expect(canvas.querySelector('[name="custom_branza"]')).toBeTruthy();
    // *Label.
    const labels = labelTexts(canvas);
    expect(labels).toContain("Imię redakcyjne");
    expect(labels).toContain("Nazwisko redakcyjne");
    expect(labels).toContain("Organizacja");
    expect(labels).toContain("Adres e-mail");
    expect(labels).toContain("Branża");
    // require*: wymagane pola mają atrybut, niewymagane nie.
    const inputs = Array.from(canvas.querySelectorAll<HTMLInputElement>('input[type="text"]'));
    const byPlaceholder = (p: string) => inputs.find((el) => el.placeholder === p);
    expect(byPlaceholder("np. Jan")?.required).toBe(true);
    expect(byPlaceholder("np. Kowalski")?.required).toBe(false);
    expect(byPlaceholder("Nazwa firmy")?.required).toBe(true);
  });

  it("wariant inline też idzie przez wspólny komponent", async () => {
    const cfg: Cfg = { ...FULL_CONFIG, variant: "inline" };
    const canvas = await renderWidget(cfg, true);
    const canvasFields = fieldFingerprint(canvas);
    cleanup();
    const publicView = await renderWidget(cfg, false);
    expect(fieldFingerprint(publicView)).toEqual(canvasFields);
  });
});

describe("newsletter: placeholder e-maila działa po obu stronach", () => {
  it("stare pole `placeholder` zasila publiczny formularz", async () => {
    const publicView = await renderWidget(
      { variant: "card", placeholder_pl: "jan@firma.pl" },
      false,
    );
    const email = publicView.querySelector<HTMLInputElement>('input[type="email"]');
    expect(email?.getAttribute("placeholder")).toBe("jan@firma.pl");
  });

  it("nowe pole `emailPlaceholder` wygrywa nad starym", async () => {
    const publicView = await renderWidget(
      { variant: "card", placeholder_pl: "stare", emailPlaceholder_pl: "nowe@firma.pl" },
      false,
    );
    const email = publicView.querySelector<HTMLInputElement>('input[type="email"]');
    expect(email?.getAttribute("placeholder")).toBe("nowe@firma.pl");
  });

  it("kanwa widzi ten sam placeholder co strona publiczna", async () => {
    const canvas = await renderWidget({ variant: "card", placeholder_pl: "jan@firma.pl" }, true);
    const email = canvas.querySelector<HTMLInputElement>('input[type="email"]');
    expect(email?.getAttribute("placeholder")).toBe("jan@firma.pl");
  });
});

describe("newsletter: tryb podglądu nie wysyła zgłoszenia", () => {
  async function submitWith(editable: boolean) {
    const container = await renderWidget(FULL_CONFIG, editable);
    const email = container.querySelector<HTMLInputElement>('input[type="email"]');
    const form = container.querySelector("form");
    expect(email).toBeTruthy();
    expect(form).toBeTruthy();
    fireEvent.change(email as HTMLInputElement, { target: { value: "jan@firma.pl" } });
    const texts = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="text"]'));
    for (const el of texts) fireEvent.change(el, { target: { value: "x" } });
    fireEvent.submit(form as HTMLFormElement);
    return container;
  }

  it("kanwa: submit nie dobija do serwera", async () => {
    await submitWith(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(subscribeSpy).not.toHaveBeenCalled();
  });

  it("strona publiczna: submit nadal wysyła", async () => {
    await submitWith(false);
    await waitFor(() => expect(subscribeSpy).toHaveBeenCalledTimes(1));
  });
});

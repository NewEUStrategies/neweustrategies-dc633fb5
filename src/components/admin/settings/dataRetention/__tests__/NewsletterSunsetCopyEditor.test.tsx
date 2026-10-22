// Edytor treści prośby o potwierdzenie subskrypcji (wygaszanie, I9d-Y1) -
// RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Wzorzec pól newslettera: PL/EN przełącznikiem, puste pole = treść
//      domyślna (placeholder pokazuje, co wyjdzie), licznik znaków.
//   2. Zapis wspólnym mutatorem z tokenem CAS; „Przywróć domyślne" czyści
//      wyłącznie edytowany język.
//   3. Limit odrzuca, nie przycina: pole ponad limit blokuje zapis
//      z komunikatem przy polu, a do serwera nic nie idzie.
//   4. Podgląd to render serwera z treścią SZKICU (także niezapisaną).
//   5. Konflikt (inna karta zapisała): szkic zostaje, kolejny zapis niesie
//      token nowszej wersji - świadome nadpisanie, nie pętla konfliktów.
//   6. Odmowa roli i brak naruszeń axe.
//
// SŁOWNIK PRAWDZIWY (`realT`), funkcje serwerowe atrapowane - przedmiotem
// dowodu jest edytor (render maila przypina `newsletterSunsetRender.test.ts`).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
  get: vi.fn(),
  save: vi.fn(),
  preview: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.("pl"), i18n: { language: "pl" }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/privacy/newsletterSunset.functions", () => ({
  getNewsletterSunsetCopy: () => h.get(),
  saveNewsletterSunsetCopy: (input: unknown) => h.save(input),
  previewNewsletterSunsetEmail: (input: unknown) => h.preview(input),
  getDataRetentionNewsletterDue: vi.fn(),
  excludeNewsletterSubscriber: vi.fn(),
  includeNewsletterSubscriber: vi.fn(),
}));

import { toast } from "sonner";
import { realT } from "@/test/i18nReal";
import axe from "axe-core";
import { summarize } from "@/test/axe";
import NewsletterSunsetCopyEditor from "@/components/admin/settings/dataRetention/NewsletterSunsetCopyEditor";
import {
  sunsetCopyDirty,
  sunsetCopyOverLimit,
} from "@/components/admin/settings/dataRetention/sunsetCopyRules";
import "@/lib/i18n-admin-data-retention";
import {
  NEWSLETTER_SUNSET_DEFAULT_COPY,
  NEWSLETTER_SUNSET_EMPTY_OVERRIDES,
  type NewsletterSunsetCopyOverrides,
} from "@/lib/privacy/newsletterSunset";

h.fixedT = realT;

const TENANT = "11111111-1111-4111-8111-111111111111";
const TOKEN = "2026-10-21T10:00:00.000000+00:00";
const TOKEN_NEWER = "2026-10-21T10:05:00.000000+00:00";

function overrides(
  pl: Partial<NewsletterSunsetCopyOverrides["pl"]> = {},
  en: Partial<NewsletterSunsetCopyOverrides["en"]> = {},
): NewsletterSunsetCopyOverrides {
  return {
    pl: { ...NEWSLETTER_SUNSET_EMPTY_OVERRIDES.pl, ...pl },
    en: { ...NEWSLETTER_SUNSET_EMPTY_OVERRIDES.en, ...en },
  };
}

function ready(value: NewsletterSunsetCopyOverrides, updatedAt: string | null = TOKEN) {
  return { state: "ready", data: { overrides: value, updatedAt } };
}

let qc: QueryClient;

function mount() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NewsletterSunsetCopyEditor tenantId={TENANT} />
    </QueryClientProvider>,
  );
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

beforeEach(() => {
  for (const fn of [h.get, h.save, h.preview]) fn.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  h.get.mockResolvedValue(ready(overrides({ subject: "Własny temat" })));
  h.preview.mockImplementation(async (input: { data: { lang: string } }) => ({
    ok: true,
    data: {
      subject: `Temat podglądu ${input.data.lang}`,
      html: `<p>Mail ${input.data.lang}</p>`,
      text: "Mail",
    },
  }));
  h.save.mockImplementation(
    async (input: { data: { overrides: NewsletterSunsetCopyOverrides } }) => ({
      ok: true,
      data: { overrides: input.data.overrides, updatedAt: TOKEN_NEWER },
    }),
  );
});

afterEach(() => {
  cleanup();
  qc?.clear();
});

describe("edytor treści prośby - pola i język", () => {
  it("PL: wartości z bazy, placeholder = treść domyślna, licznik; EN: pola drugiego języka", async () => {
    mount();
    expect((await screen.findByLabelText("Temat")).getAttribute("value")).toBe("Własny temat");
    expect(screen.getByText("12 z 150 znaków")).toBeTruthy();
    expect(field("Nagłówek").getAttribute("placeholder")).toBe(
      NEWSLETTER_SUNSET_DEFAULT_COPY.pl.heading,
    );
    expect(screen.getByRole("button", { name: "PL" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(field("Temat").value).toBe("");
    expect(field("Temat").getAttribute("placeholder")).toBe(
      NEWSLETTER_SUNSET_DEFAULT_COPY.en.subject,
    );
    expect(screen.getByText(/Zmienne: \{firstName\}, \{daysLeft\}, \{deleteDate\}/)).toBeTruthy();
  });

  it("zapis: wspólny mutator z tokenem CAS, po zapisie brak zmian do zapisania", async () => {
    mount();
    await screen.findByLabelText("Temat");
    const save = screen.getByRole("button", { name: "Zapisz treść" });
    expect(save.hasAttribute("disabled")).toBe(true);
    fireEvent.change(field("Wstęp"), { target: { value: "Nowy wstęp NES." } });
    expect(screen.getByText("Niezapisane zmiany")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Zapisz treść" }));
    await waitFor(() =>
      expect(h.save).toHaveBeenCalledWith({
        data: {
          overrides: overrides({ subject: "Własny temat", intro: "Nowy wstęp NES." }),
          expectedUpdatedAt: TOKEN,
        },
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Zapisano treść prośby."));
    await waitFor(() => expect(screen.queryByText("Niezapisane zmiany")).toBeNull());
    expect(screen.getByRole("button", { name: "Zapisz treść" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("pole ponad limit: komunikat przy polu, zapis zablokowany, nic nie idzie do serwera", async () => {
    mount();
    await screen.findByLabelText("Przycisk");
    fireEvent.change(field("Przycisk"), { target: { value: "x".repeat(41) } });
    expect(
      screen.getByText("Za długie: 41 z 40 znaków - skróć, treść nie zostanie przycięta."),
    ).toBeTruthy();
    expect(field("Przycisk").getAttribute("aria-invalid")).toBe("true");
    expect(field("Przycisk").value).toHaveLength(41);
    const save = screen.getByRole("button", { name: "Zapisz treść" });
    expect(save.hasAttribute("disabled")).toBe(true);
    fireEvent.click(save);
    expect(h.save).not.toHaveBeenCalled();
  });

  it("„Przywróć domyślne” czyści wyłącznie edytowany język", async () => {
    h.get.mockResolvedValue(
      ready(overrides({ subject: "Własny temat" }, { subject: "Own subject" })),
    );
    mount();
    await screen.findByLabelText("Temat");
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(field("Temat").value).toBe("Own subject");
    fireEvent.click(screen.getByRole("button", { name: "Przywróć domyślne" }));
    expect(field("Temat").value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "PL" }));
    expect(field("Temat").value).toBe("Własny temat");
    fireEvent.click(screen.getByRole("button", { name: "Zapisz treść" }));
    await waitFor(() =>
      expect(h.save).toHaveBeenCalledWith({
        data: { overrides: overrides({ subject: "Własny temat" }), expectedUpdatedAt: TOKEN },
      }),
    );
  });
});

describe("edytor treści prośby - podgląd i współbieżność", () => {
  it("podgląd: render serwera z treścią szkicu w ramce z tytułem; odświeżenie po zmianie", async () => {
    mount();
    const frame = await screen.findByTitle("Podgląd maila z prośbą o potwierdzenie");
    expect(frame.getAttribute("srcdoc")).toBe("<p>Mail pl</p>");
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(screen.getByText("Temat: Temat podglądu pl")).toBeTruthy();
    expect(h.preview).toHaveBeenCalledWith({
      data: { lang: "pl", overrides: overrides({ subject: "Własny temat" }) },
    });
    fireEvent.change(field("Nagłówek"), { target: { value: "Zostań z nami" } });
    fireEvent.click(screen.getByRole("button", { name: "Odśwież podgląd" }));
    await waitFor(() =>
      expect(h.preview).toHaveBeenLastCalledWith({
        data: {
          lang: "pl",
          overrides: overrides({ subject: "Własny temat", heading: "Zostań z nami" }),
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    await waitFor(() =>
      expect(
        screen.getByTitle("Podgląd maila z prośbą o potwierdzenie").getAttribute("srcdoc"),
      ).toBe("<p>Mail en</p>"),
    );
  });

  it("błąd podglądu: komunikat, bez pętli ponowień", async () => {
    h.preview.mockResolvedValue({ ok: false, error: "failed", reason: null });
    mount();
    expect(await screen.findByText("Nie udało się przygotować podglądu.")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.preview).toHaveBeenCalledTimes(1);
  });

  it("konflikt zapisu: szkic zostaje, komunikat; kolejny zapis niesie token nowszej wersji", async () => {
    h.get
      .mockResolvedValueOnce(ready(overrides({ subject: "Własny temat" })))
      .mockResolvedValue(ready(overrides({ subject: "Temat z innej karty" }), TOKEN_NEWER));
    h.save.mockResolvedValueOnce({ ok: false, error: "conflict", reason: "stale_write" });
    mount();
    await screen.findByLabelText("Temat");
    fireEvent.change(field("Temat"), { target: { value: "Mój temat" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz treść" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Twoje zmiany zostały w edytorze"),
      ),
    );
    expect(field("Temat").value).toBe("Mój temat");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Zapisz treść" }).hasAttribute("disabled")).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Zapisz treść" }));
    await waitFor(() =>
      expect(h.save).toHaveBeenLastCalledWith({
        data: { overrides: overrides({ subject: "Mój temat" }), expectedUpdatedAt: TOKEN_NEWER },
      }),
    );
  });

  it("odmowa roli: komunikat zamiast pól", async () => {
    h.get.mockResolvedValue({ state: "forbidden" });
    mount();
    expect(await screen.findByText("Treść prośby zmienia wyłącznie administrator.")).toBeTruthy();
    expect(screen.queryByLabelText("Temat")).toBeNull();
  });

  it("brak naruszeń axe (etykiety pól, grupa języka, ramka podglądu)", async () => {
    const { container } = mount();
    await screen.findByTitle("Podgląd maila z prośbą o potwierdzenie");
    fireEvent.change(field("Przycisk"), { target: { value: "x".repeat(41) } });
    // Reguły jak `@/test/axe`, ale bez wchodzenia do ramki podglądu: happy-dom
    // nie ma okna ramki (axe rzuca), a treść maila przypina test renderu.
    // Sama ramka (tytuł - `frame-title`) jest sprawdzana.
    const { violations } = await axe.run(container as HTMLElement, {
      iframes: false,
      rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
    });
    expect(violations, summarize(violations)).toEqual([]);
    const group = screen.getByRole("group", { name: "Język treści" });
    expect(within(group).getAllByRole("button")).toHaveLength(2);
  });
});

describe("reguły edytora (czyste)", () => {
  it("znacznik zmian i lista pól ponad limit obejmują oba języki", () => {
    const base = overrides();
    expect(sunsetCopyDirty(base, overrides())).toBe(false);
    expect(sunsetCopyDirty(overrides({}, { note: "x" }), base)).toBe(true);
    expect(sunsetCopyOverLimit(overrides({}, { eyebrow: "e".repeat(41) }))).toEqual([
      { lang: "en", field: "eyebrow" },
    ]);
    // Punkty kodowe jak `char_length`: 40 emoji to 40 znaków, nie 80.
    expect(sunsetCopyOverLimit(overrides({ cta: "🙂".repeat(40) }))).toEqual([]);
  });
});

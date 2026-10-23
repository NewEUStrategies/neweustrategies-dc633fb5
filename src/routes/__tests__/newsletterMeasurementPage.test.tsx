// Strona linków pomiaru otwarć i kliknięć (I9d-Y2, I9d-Y2b) - prawdziwa
// trasa w routerze pamięciowym, prawdziwy słownik PL/EN, treść OSOBNEJ zgody
// na pomiar z jednego źródła i axe.
//
// Reguła nadrzędna: DECYZJA NIE MOŻE WYKONAĆ SIĘ SAMA. Wejście na stronę
// tylko SPRAWDZA token (GET), zapis leci dopiero po kliknięciu (POST) -
// a ponowienie po błędzie sprawdzenia nigdy nie zapisze zgody osobie, która
// nie zobaczyła jej treści.
//
// I9d-Y2b (R1.19): ekran zgody pokazuje treść w języku SUBSKRYBENTA z GET
// (`lang`), nie w języku z adresu - baza zapisze treść w tym języku.
// Odpowiedź `confirm` bez `lang` = błąd z ponowieniem sprawdzenia, bez
// przycisku zgody.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import i18n from "@/lib/i18n";
import { renderRoute, routeHead } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { newsletterConsentPlain } from "@/lib/newsletter/consentText";
import { measurementConsentPlain } from "@/lib/newsletter/measurementConsentText";
import { Route as MeasurementRoute } from "@/routes/newsletter.measurement";

const h = vi.hoisted(() => ({ requestUrl: "" }));
vi.mock("@/lib/seo/request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/seo/request")>()),
  getRequestUrl: () => h.requestUrl,
}));

const pl = i18n.getFixedT("pl");
const en = i18n.getFixedT("en");
const API = "/api/public/newsletter/measurement";

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function mount(search: string) {
  window.history.replaceState({}, "", `/newsletter/measurement${search}`);
  return renderRoute({
    route: MeasurementRoute,
    path: "/newsletter/measurement",
    initialEntry: `/newsletter/measurement${search}`,
  });
}

function postBody(index: number): Record<string, unknown> {
  const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
  expect(url).toBe(API);
  expect(init.method).toBe("POST");
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("„Nie mierz moich otwarć i kliknięć”", () => {
  it('bez tokenu: „nieprawidłowy link" i ZERO zapytań', async () => {
    await mount("");
    expect(await screen.findByText(pl("newsletterMeasurement.invalidTitle"))).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("wejście tylko SPRAWDZA token (GET) - wycofanie dopiero po kliknięciu (POST)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, action: "withdraw", consent: true }));
    await mount("?token=wsabc");
    const button = await screen.findByRole("button", {
      name: pl("newsletterMeasurement.withdrawBtn"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${API}?token=wsabc`);
    expect((fetchMock.mock.calls[0][1] as RequestInit | undefined)?.method).toBeUndefined();
    // Treść mówi, że newsletter zostaje.
    expect(screen.getByText(pl("newsletterMeasurement.withdrawBody"))).toBeTruthy();

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, action: "withdraw" }));
    fireEvent.click(button);
    expect(await screen.findByText(pl("newsletterMeasurement.withdrawnTitle"))).toBeTruthy();
    expect(postBody(1)).toEqual({ token: "wsabc", channel: "email_footer" });
  });

  it("link ze strony preferencji zapisuje kanał `preferences`", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, action: "withdraw", consent: true }));
    await mount("?token=wsabc&via=preferences");
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, action: "withdraw", already: true }));
    fireEvent.click(
      await screen.findByRole("button", { name: pl("newsletterMeasurement.withdrawBtn") }),
    );
    expect(await screen.findByText(pl("newsletterMeasurement.alreadyOffTitle"))).toBeTruthy();
    expect(postBody(1)).toEqual({ token: "wsabc", channel: "preferences" });
  });

  it("bez zgody na pomiar: od razu „pomiar jest wyłączony”, bez przycisku i bez zapisu", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, action: "withdraw", consent: false }));
    await mount("?token=wsabc");
    expect(await screen.findByText(pl("newsletterMeasurement.alreadyOffTitle"))).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("język odbiorcy z linku (`lang=en`)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, action: "withdraw", consent: true }));
    await mount("?token=wsabc&lang=en");
    expect(
      await screen.findByRole("button", { name: en("newsletterMeasurement.withdrawBtn") }),
    ).toBeTruthy();
    expect(screen.getByText(en("newsletterMeasurement.withdrawTitle"))).toBeTruthy();
  });

  it("awaria zapisu (500): błąd i ponowienie tym samym tokenem (POST)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, action: "withdraw", consent: true }));
    await mount("?token=wsabc");
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: "update_failed" }, 500));
    fireEvent.click(
      await screen.findByRole("button", { name: pl("newsletterMeasurement.withdrawBtn") }),
    );
    const retry = await screen.findByRole("button", {
      name: pl("newsletterMeasurement.retryBtn"),
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, action: "withdraw" }));
    fireEvent.click(retry);
    expect(await screen.findByText(pl("newsletterMeasurement.withdrawnTitle"))).toBeTruthy();
    expect(postBody(2)).toEqual({ token: "wsabc", channel: "email_footer" });
  });
});

describe("„Zgadzam się na pomiar”", () => {
  it("pokazuje DOKŁADNIE treść OSOBNEJ zgody na pomiar z jednego źródła; zapis dopiero po kliknięciu", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, action: "confirm", lang: "pl" }));
    const { container } = await mount("?token=cabc");
    const button = await screen.findByRole("button", {
      name: pl("newsletterMeasurement.grantBtn"),
    });
    expect(container.textContent).toContain(measurementConsentPlain("pl"));
    // Treść zgody na newsletter (wariant (b)) nie jest treścią zgody na pomiar.
    expect(container.textContent).not.toContain(newsletterConsentPlain("pl"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, action: "confirm" }));
    fireEvent.click(button);
    expect(await screen.findByText(pl("newsletterMeasurement.grantedTitle"))).toBeTruthy();
    expect(postBody(1)).toEqual({ token: "cabc", channel: "email_footer" });
    // Kliknięty przycisk zniknął - fokus na nagłówku wyniku (WCAG 2.4.3).
    const heading = screen.getByRole("heading", {
      name: pl("newsletterMeasurement.grantedTitle"),
    });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it("wynik bez kliknięcia (od razu po wejściu) NIE przesuwa fokusu i nie jest celem fokusu", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: "expired" }, 410));
    await mount("?token=cabc");
    const heading = await screen.findByRole("heading", {
      name: pl("newsletterMeasurement.expiredTitle"),
    });
    expect(document.activeElement).not.toBe(heading);
    expect(heading.hasAttribute("tabindex")).toBe(false);
  });

  it("EN: treść zgody po angielsku (język subskrybenta z GET)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, action: "confirm", lang: "en" }));
    const { container } = await mount("?token=cabc&lang=en");
    await screen.findByRole("button", { name: en("newsletterMeasurement.grantBtn") });
    expect(container.textContent).toContain(measurementConsentPlain("en"));
  });

  it("R1.19: język SUBSKRYBENTA z GET wygrywa z `lang` z adresu - treść i napisy w języku zapisu", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, action: "confirm", lang: "pl" }));
    const { container } = await mount("?token=cabc&lang=en");
    await screen.findByRole("button", { name: pl("newsletterMeasurement.grantBtn") });
    expect(container.textContent).toContain(measurementConsentPlain("pl"));
    expect(container.textContent).not.toContain(measurementConsentPlain("en"));
    expect(container.querySelector("[aria-live]")?.getAttribute("lang")).toBe("pl");
  });

  it("R1.19: odpowiedź `confirm` bez języka subskrybenta = błąd z ponowieniem GET, bez przycisku zgody", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, action: "confirm" }));
    const { container } = await mount("?token=cabc");
    const retry = await screen.findByRole("button", {
      name: pl("newsletterMeasurement.retryBtn"),
    });
    expect(screen.queryByRole("button", { name: pl("newsletterMeasurement.grantBtn") })).toBeNull();
    expect(container.textContent).not.toContain(measurementConsentPlain("pl"));

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, action: "confirm", lang: "pl" }));
    fireEvent.click(retry);
    await screen.findByRole("button", { name: pl("newsletterMeasurement.grantBtn") });
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit | undefined)?.method).toBeUndefined();
    }
  });

  it("błąd SPRAWDZENIA: ponowienie robi znowu GET, nigdy POST (zgoda bez treści)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await mount("?token=cabc");
    const retry = await screen.findByRole("button", {
      name: pl("newsletterMeasurement.retryBtn"),
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, action: "confirm", lang: "pl" }));
    fireEvent.click(retry);
    await screen.findByRole("button", { name: pl("newsletterMeasurement.grantBtn") });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit | undefined)?.method).toBeUndefined();
    }
  });

  it("wygasła prośba: komunikat bez przycisku", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: "expired" }, 410));
    await mount("?token=cabc");
    expect(await screen.findByText(pl("newsletterMeasurement.expiredTitle"))).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("brak naruszeń axe na ekranach decyzji", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, action: "confirm", lang: "pl" }));
    const grant = await mount("?token=cabc");
    await screen.findByRole("button", { name: pl("newsletterMeasurement.grantBtn") });
    let violations = await axeViolations(grant.container);
    expect(violations, summarize(violations)).toEqual([]);
    cleanup();

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, action: "withdraw", consent: true }));
    const withdraw = await mount("?token=wsabc");
    await screen.findByRole("button", { name: pl("newsletterMeasurement.withdrawBtn") });
    violations = await axeViolations(withdraw.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("nagłówek dokumentu (chunk startowy)", () => {
  function meta(entries: Record<string, unknown>[] | undefined, name: string): string {
    const found = (entries ?? []).find((entry) => entry.name === name)?.content;
    if (typeof found !== "string") throw new Error(`brak meta ${name}`);
    return found;
  }

  it("tytuł i opis w języku z linku, noindex", () => {
    h.requestUrl = "/newsletter/measurement?token=wsabc&lang=en";
    let head = routeHead(MeasurementRoute);
    let title = String(head.meta?.find((entry) => "title" in entry)?.title);
    expect(title.startsWith(`${en("newsletterMeasurement.metaTitle")} - `)).toBe(true);
    expect(meta(head.meta, "description")).toBe(en("newsletterMeasurement.metaDescription"));
    expect(meta(head.meta, "robots")).toBe("noindex, nofollow");

    h.requestUrl = "/newsletter/measurement?token=wsabc";
    head = routeHead(MeasurementRoute);
    title = String(head.meta?.find((entry) => "title" in entry)?.title);
    expect(title.startsWith(`${pl("newsletterMeasurement.metaTitle")} - `)).toBe(true);
  });
});

// Strona „Chcę dalej otrzymywać" (wygaszanie newslettera, I9d-Y1) - prawdziwa
// trasa w routerze pamięciowym, prawdziwy słownik PL/EN i axe.
//
// Reguła nadrzędna jak przy wypisie: DECYZJA NIE MOŻE WYKONAĆ SIĘ SAMA.
// Skanery linków pobierają adres z maila w tle, więc wejście na stronę tylko
// SPRAWDZA token (GET), a potwierdzenie leci dopiero po kliknięciu (POST).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import i18n from "@/lib/i18n";
import { renderRoute } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { keepStateOf } from "@/lib/privacy/newsletterKeep";
import { Route as KeepRoute } from "@/routes/newsletter.keep";

const pl = i18n.getFixedT("pl");
const en = i18n.getFixedT("en");

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function mount(search: string) {
  window.history.replaceState({}, "", `/newsletter/keep${search}`);
  return renderRoute({
    route: KeepRoute,
    path: "/newsletter/keep",
    initialEntry: `/newsletter/keep${search}`,
  });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('strona „Chcę dalej otrzymywać"', () => {
  it('bez tokenu: „nieprawidłowy link" i ZERO zapytań', async () => {
    await mount("");
    expect(await screen.findByText(pl("newsletterKeep.invalidTitle"))).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("wejście tylko SPRAWDZA token (GET) - potwierdzenie dopiero po kliknięciu (POST)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await mount("?token=kabc");
    const button = await screen.findByRole("button", { name: pl("newsletterKeep.confirmBtn") });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/public/newsletter/keep?token=kabc");
    expect((fetchMock.mock.calls[0][1] as RequestInit | undefined)?.method).toBeUndefined();

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    fireEvent.click(button);
    expect(await screen.findByText(pl("newsletterKeep.okTitle"))).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/public/newsletter/keep");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ token: "kabc" });
  });

  it("język subskrybenta z linku (`lang=en`) - napisy po angielsku", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await mount("?token=kabc&lang=en");
    expect(
      await screen.findByRole("button", { name: en("newsletterKeep.confirmBtn") }),
    ).toBeTruthy();
    expect(screen.getByText(en("newsletterKeep.title"))).toBeTruthy();
  });

  it("link wygasły: komunikat bez przycisku potwierdzenia", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: "expired" }, 410));
    await mount("?token=kabc");
    expect(await screen.findByText(pl("newsletterKeep.expiredTitle"))).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("awaria zapisu (500): błąd i ponowienie tym samym tokenem", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await mount("?token=kabc");
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: "update_failed" }, 500));
    fireEvent.click(await screen.findByRole("button", { name: pl("newsletterKeep.confirmBtn") }));
    const retry = await screen.findByRole("button", { name: pl("newsletterKeep.retryBtn") });
    expect(screen.getByText(pl("newsletterKeep.errorBody"))).toBeTruthy();
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, already: true }));
    fireEvent.click(retry);
    expect(await screen.findByText(pl("newsletterKeep.alreadyTitle"))).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });

  it("brak naruszeń axe na ekranie potwierdzenia", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const { container } = await mount("?token=kabc");
    await screen.findByRole("button", { name: pl("newsletterKeep.confirmBtn") });
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("odpowiedź endpointu -> stan strony", () => {
  it.each([
    [200, { ok: true }, "ok"],
    [200, { ok: true, already: true }, "already"],
    [409, { ok: false, error: "inactive" }, "inactive"],
    [404, { ok: false, error: "not_found" }, "gone"],
    [410, { ok: false, error: "expired" }, "expired"],
    [400, { ok: false, error: "invalid_token" }, "invalid"],
    [429, { ok: false, error: "rate_limited" }, "rateLimited"],
    [429, {}, "rateLimited"],
    [500, { ok: false, error: "update_failed" }, "error"],
  ] as const)("%i %j -> %s", (status, body, expected) => {
    expect(keepStateOf(status, body)).toBe(expected);
  });
});

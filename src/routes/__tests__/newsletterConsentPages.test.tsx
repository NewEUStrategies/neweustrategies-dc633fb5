// Strony zgody: potwierdzenie zapisu i dwie strony wypisu.
//
// To są jedyne ekrany, jakie widzi odbiorca po kliknięciu w link z maila -
// i jedyny dowód, że jego decyzja została przyjęta. Stały na 0%, mimo że
// niosą regułę, której złamanie kosztuje zgodność z wytycznymi dla nadawców
// masowych: WYPIS NIE MOŻE WYKONAĆ SIĘ SAM. Klienty pocztowe i skanery
// antywirusowe pobierają linki z wiadomości w tle, więc pierwszy GET tylko
// SPRAWDZA token, a wypis następuje dopiero po kliknięciu przycisku. Test
// pilnuje tego wprost: po samym wejściu na stronę nie leci żadne POST.
//
// Asercje celują w KLUCZE i18n (atrapa `t` zwraca klucz), nie w treść - dzięki
// temu zmiana copy nie psuje testu, a zmiana zachowania psuje.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ requestUrl: "" }));

// `head()` czyta język z ADRESU żądania (prefiks /en), nie z języka
// interfejsu - inaczej tytuł strony rozjeżdżałby się z jej treścią.
vi.mock("@/lib/seo/request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/seo/request")>()),
  getRequestUrl: () => h.requestUrl,
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.email ? `${key}:${String(opts.email)}` : key,
  }),
}));

import { renderRoute } from "@/test/routeHarness";
import { Route as ConfirmRoute } from "@/routes/newsletter.confirm";
import { Route as UnsubscribeRoute } from "@/routes/newsletter.unsubscribe";
import { Route as LegacyUnsubscribeRoute } from "@/routes/unsubscribe";

let fetchMock: ReturnType<typeof vi.fn>;

/** Odpowiedź JSON dla atrapy `fetch`. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setSearch(search: string): void {
  window.history.replaceState({}, "", search || "/");
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  setSearch("/");
  h.requestUrl = "";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// POTWIERDZENIE ZAPISU
// ---------------------------------------------------------------------------
describe("strona potwierdzenia zapisu", () => {
  async function mount(search = "?token=abc123") {
    setSearch(`/newsletter/confirm${search}`);
    return renderRoute({
      route: ConfirmRoute,
      path: "/newsletter/confirm",
      initialEntry: "/newsletter/confirm",
    });
  }

  it("bez tokenu pokazuje błąd i NIE pyta serwera", async () => {
    await mount("");

    expect(await screen.findByText("newsletter.confirmPage.errorTitle")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("na starcie pokazuje stan ładowania", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    await mount();

    expect(screen.getByText("newsletter.confirmPage.loading")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("potwierdzenie pokazuje sukces i woła endpoint z tokenem", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await mount("?token=abc123");

    expect(await screen.findByText("newsletter.confirmPage.okTitle")).toBeTruthy();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("token=abc123");
  });

  it("token wymagający eskapowania jest kodowany w adresie", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await mount("?token=a%2Bb%20c");

    await screen.findByText("newsletter.confirmPage.okTitle");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("token=a%2Bb%20c");
  });

  it("ponowne kliknięcie pokazuje „już potwierdzone”, nie błąd", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, already: true }));
    await mount();

    expect(await screen.findByText("newsletter.confirmPage.alreadyTitle")).toBeTruthy();
    expect(screen.queryByText("newsletter.confirmPage.okTitle")).toBeNull();
  });

  it("token wygasły ma WŁASNY komunikat, inny niż ogólny błąd", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: "expired" }, 410));
    await mount();

    expect(await screen.findByText("newsletter.confirmPage.expiredTitle")).toBeTruthy();
    expect(screen.getByText("newsletter.confirmPage.expiredBody")).toBeTruthy();
  });

  it("inny błąd serwera pokazuje jego powód", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: "not_found" }, 404));
    await mount();

    expect(await screen.findByText("newsletter.confirmPage.errorTitle")).toBeTruthy();
    expect(screen.getByText("not_found")).toBeTruthy();
  });

  it("odpowiedź bez treści nie zostawia użytkownika bez komunikatu", async () => {
    fetchMock.mockResolvedValue(new Response("nie json", { status: 500 }));
    await mount();

    expect(await screen.findByText("newsletter.confirmPage.errorTitle")).toBeTruthy();
    expect(screen.getByText("HTTP 500")).toBeTruthy();
  });

  it("awaria sieci też kończy się czytelnym stanem", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    await mount();

    expect(await screen.findByText("newsletter.confirmPage.errorTitle")).toBeTruthy();
    expect(screen.getByText("offline")).toBeTruthy();
  });

  it("strona jest wyłączona z indeksowania (token w adresie)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const { meta } = await mount();

    const robots = meta().find((m) => m.name === "robots");
    expect(robots?.content).toContain("noindex");
    expect(robots?.content).toContain("nofollow");
  });

  it("tytuł idzie za językiem ADRESU, nie za językiem interfejsu", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    h.requestUrl = "https://example.test/newsletter/confirm";
    const pl = await mount();
    const plTitle = pl.meta().find((m) => typeof m.title === "string")?.title;
    cleanup();

    h.requestUrl = "https://example.test/en/newsletter/confirm";
    const en = await mount();
    const enTitle = en.meta().find((m) => typeof m.title === "string")?.title;

    expect(String(plTitle)).toContain("potwierdzony");
    expect(String(enTitle)).toContain("confirmed");
  });
});

// ---------------------------------------------------------------------------
// WYPIS Z NEWSLETTERA
// ---------------------------------------------------------------------------
describe("strona wypisu z newslettera", () => {
  async function mount(search = "?token=abc123") {
    setSearch(`/newsletter/unsubscribe${search}`);
    return renderRoute({
      route: UnsubscribeRoute,
      path: "/newsletter/unsubscribe",
      initialEntry: "/newsletter/unsubscribe",
    });
  }

  it("bez tokenu pokazuje nieprawidłowy link i nie pyta serwera", async () => {
    await mount("");

    expect(await screen.findByText("newsletter.unsubscribePage.invalidTitle")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("WEJŚCIE na stronę tylko SPRAWDZA token - nie wypisuje", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, email: "a***a@example.test" }));
    await mount();

    await screen.findByText("newsletter.unsubscribePage.title");
    // Skaner w kliencie pocztowym pobiera link sam - wypis nie może się wtedy
    // wykonać. Dlatego pierwszy strzał jest GET-em, a POST-a nie ma wcale.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).not.toMatchObject({ method: "POST" });
  });

  it("pokazuje zamaskowany adres, gdy serwer go poda", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, email: "a***a@example.test" }));
    await mount();

    expect(
      await screen.findByText("newsletter.unsubscribePage.bodyWithEmail:a***a@example.test"),
    ).toBeTruthy();
    expect(screen.queryByText("newsletter.unsubscribePage.body")).toBeNull();
  });

  it("bez adresu pokazuje treść ogólną", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await mount();

    expect(await screen.findByText("newsletter.unsubscribePage.body")).toBeTruthy();
  });

  it("adres już wypisany pomija przycisk potwierdzenia", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, already: true }));
    await mount();

    expect(await screen.findByText("newsletter.unsubscribePage.alreadyTitle")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each(["invalid_token", "not_found"])("token %s daje stan „nieprawidłowy”", async (error) => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, error }, 404));
    await mount();

    expect(await screen.findByText("newsletter.unsubscribePage.invalidTitle")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("inny błąd walidacji pokazuje powód", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: "server_down" }, 500));
    await mount();

    expect(await screen.findByText("newsletter.unsubscribePage.errorTitle")).toBeTruthy();
    expect(screen.getByText("server_down")).toBeTruthy();
  });

  it("awaria sieci przy SPRAWDZANIU tokenu nie udaje ważnego linku", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    await mount();

    expect(await screen.findByText("newsletter.unsubscribePage.errorTitle")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("KLIKNIĘCIE przycisku wysyła POST z tokenem i kończy wypis", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    await mount("?token=abc123");

    fireEvent.click(await screen.findByRole("button"));

    expect(await screen.findByText("newsletter.unsubscribePage.okTitle")).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/public/newsletter/unsubscribe");
    expect(JSON.parse(String(init.body))).toEqual({ token: "abc123" });
  });

  it("w trakcie wypisu przycisk pokazuje pracę i jest zablokowany", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockReturnValueOnce(new Promise(() => {}));
    await mount();

    fireEvent.click(await screen.findByRole("button"));

    await waitFor(() => {
      expect(screen.getByText("newsletter.unsubscribePage.working")).toBeTruthy();
    });
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
  });

  it("odmowa przy potwierdzaniu pokazuje powód, nie fałszywy sukces", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: false, error: "token_used" }, 409));
    await mount();

    fireEvent.click(await screen.findByRole("button"));

    expect(await screen.findByText("newsletter.unsubscribePage.errorTitle")).toBeTruthy();
    expect(screen.getByText("token_used")).toBeTruthy();
  });

  it("awaria sieci przy potwierdzaniu również nie udaje sukcesu", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockRejectedValueOnce(new Error("offline"));
    await mount();

    fireEvent.click(await screen.findByRole("button"));

    expect(await screen.findByText("newsletter.unsubscribePage.errorTitle")).toBeTruthy();
    expect(screen.getByText("offline")).toBeTruthy();
  });

  it("strona wypisu też jest wyłączona z indeksowania", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const { meta } = await mount();

    expect(meta().find((m) => m.name === "robots")?.content).toContain("noindex");
  });

  it("tytuł strony wypisu też ma wariant angielski", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    h.requestUrl = "https://example.test/en/newsletter/unsubscribe";
    const { meta } = await mount();

    const title = String(meta().find((m) => typeof m.title === "string")?.title);
    expect(title).toContain("Unsubscribe");
    expect(title).not.toContain("Wypisz");
  });
});

// ---------------------------------------------------------------------------
// WYPIS Z POCZTY SYSTEMOWEJ (starsza strona /unsubscribe)
// ---------------------------------------------------------------------------
describe("strona wypisu z poczty systemowej", () => {
  async function mount(search = "?token=abc123") {
    setSearch(`/unsubscribe${search}`);
    return renderRoute({
      route: LegacyUnsubscribeRoute,
      path: "/unsubscribe",
      initialEntry: "/unsubscribe",
    });
  }

  it("bez tokenu od razu mówi o nieprawidłowym linku", async () => {
    await mount("");

    expect(await screen.findByText("Link jest nieprawidłowy lub wygasł")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ważny token pokazuje przycisk potwierdzenia, ale NIE wypisuje", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ valid: true }));
    await mount();

    expect(await screen.findByText("Potwierdź rezygnację")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).not.toMatchObject({ method: "POST" });
  });

  it("token już zużyty pokazuje stan końcowy bez przycisku", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ valid: false, reason: "already_unsubscribed" }));
    await mount();

    expect(await screen.findByText("Preferencje zostały zapisane")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("odpowiedź błędu to nieprawidłowy link", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "Invalid or expired token" }, 404));
    await mount();

    expect(await screen.findByText("Link jest nieprawidłowy lub wygasł")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("kliknięcie potwierdzenia wysyła POST i pokazuje sukces", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ valid: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }));
    await mount("?token=abc123");

    fireEvent.click(await screen.findByRole("button"));

    expect(await screen.findByText("Preferencje zostały zapisane")).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/email/unsubscribe");
    expect(JSON.parse(String(init.body))).toEqual({ token: "abc123" });
  });

  it("odpowiedź 200 bez `success` traktujemy jak wypis już wykonany", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ valid: true }))
      .mockResolvedValueOnce(jsonResponse({ success: false }));
    await mount();

    fireEvent.click(await screen.findByRole("button"));

    expect(await screen.findByText("Preferencje zostały zapisane")).toBeTruthy();
  });

  it("odmowa serwera przy potwierdzaniu wraca do stanu nieprawidłowego linku", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ valid: true }))
      .mockResolvedValueOnce(jsonResponse({ error: "nope" }, 500));
    await mount();

    fireEvent.click(await screen.findByRole("button"));

    expect(await screen.findByText("Link jest nieprawidłowy lub wygasł")).toBeTruthy();
  });

  it("awaria sieci przy potwierdzaniu nie udaje sukcesu", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ valid: true }))
      .mockRejectedValueOnce(new Error("offline"));
    await mount();

    fireEvent.click(await screen.findByRole("button"));

    expect(await screen.findByText("Link jest nieprawidłowy lub wygasł")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("przerwane sprawdzanie (odmontowanie) nie ustawia stanu błędu", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    fetchMock.mockRejectedValue(abortError);
    await mount();

    // Stan zostaje „sprawdzamy" - przerwanie żądania to nie awaria linku.
    expect(await screen.findByText("Sprawdzamy link")).toBeTruthy();
    expect(screen.queryByText("Link jest nieprawidłowy lub wygasł")).toBeNull();
  });
});

// Karta zgody na pomiar na stronie potwierdzenia double opt-in (I9d-Y2b,
// D1 wariant (b), D2) - prawdziwa trasa `/newsletter/confirm` w routerze
// pamięciowym, prawdziwy słownik nakładki pomiaru, leniwa karta i axe
// w jasnym i ciemnym motywie.
//
// CO TEN PLIK DOWODZI.
//   1. Wejście na stronę zapisuje WYŁĄCZNIE potwierdzenie zapisu (GET) -
//      decyzja o pomiarze tylko po kliknięciu (POST JSON `{ token, decision,
//      m }` na tę samą trasę). Sekret skrzynki `m` z adresu strony jedzie
//      w GET i w POST; bez niego karty nie ma (przegląd R1, sql-r1-1).
//   2. Karta pokazuje DOKŁADNIE treść, którą baza zapisze (pole pomiaru,
//      język subskrybenta z odpowiedzi GET), i dwa równorzędne przyciski.
//   3. Każdy wynik POST ma własny ekran w regionie `aria-live`; błędy
//      przejściowe (sieć, 5xx, limit) ponawiają TĘ SAMĄ decyzję.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import i18n from "@/lib/i18n";
import "@/lib/i18n-newsletter-measurement";
import { measurementConsentPlain } from "@/lib/newsletter/measurementConsentText";
import { renderRoute } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { Route as ConfirmRoute } from "@/routes/newsletter.confirm";

const pl = i18n.getFixedT("pl");
const en = i18n.getFixedT("en");
const API = "/api/public/newsletter/confirm";
const TOKEN = "abcdef0123456789abcdef";
// Sekret skrzynki z maila DOI: `d` + 72 znaki szesnastkowe (kształt).
const SECRET = `d${"0123456789abcdef".repeat(4)}${"ab".repeat(4)}`;

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function mountWithCard(lang: "pl" | "en" = "pl") {
  fetchMock.mockResolvedValueOnce(
    jsonResponse({ ok: true, measurement: "offer", measurementLang: lang }),
  );
  window.history.replaceState({}, "", `/newsletter/confirm?token=${TOKEN}&m=${SECRET}`);
  const view = await renderRoute({
    route: ConfirmRoute,
    path: "/newsletter/confirm",
    initialEntry: "/newsletter/confirm",
  });
  const t = lang === "pl" ? pl : en;
  await screen.findByRole("button", { name: t("newsletterMeasurement.grantBtn") });
  return view;
}

function grantButton(t = pl) {
  return screen.getByRole("button", { name: t("newsletterMeasurement.grantBtn") });
}
function declineButton(t = pl) {
  return screen.getByRole("button", { name: t("newsletterMeasurement.declineBtn") });
}

function postBody(index: number): Record<string, unknown> {
  const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
  expect(url).toBe(API);
  expect(init.method).toBe("POST");
  expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

const card = () => document.querySelector<HTMLElement>("section[aria-live='polite']");

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.classList.remove("dark");
});

describe("karta zgody na pomiar na stronie potwierdzenia", () => {
  it("pokazuje treść pola pomiaru, dwa przyciski i NIC nie zapisuje bez kliknięcia", async () => {
    await mountWithCard();
    expect(card()?.textContent).toContain(measurementConsentPlain("pl"));
    expect(card()?.getAttribute("lang")).toBe("pl");
    expect(
      screen.getByRole("heading", { name: pl("newsletterMeasurement.grantTitle") }),
    ).toBeTruthy();
    expect(screen.getByText(pl("newsletterMeasurement.doiLead"))).toBeTruthy();
    expect(grantButton()).toBeTruthy();
    expect(declineButton()).toBeTruthy();
    // Jedno wywołanie: GET potwierdzenia z tokenem DOI i sekretem skrzynki.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API}?token=${TOKEN}&m=${SECRET}`);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.method).toBeUndefined();
  });

  it.each([
    ["bez sekretu skrzynki", `/newsletter/confirm?token=${TOKEN}`],
    ["sekret w złym kształcie", `/newsletter/confirm?token=${TOKEN}&m=zly`],
  ])("%s: GET bez `m` i bez karty, nawet gdy odpowiedź mówi `offer`", async (_case, href) => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, measurement: "offer", measurementLang: "pl" }),
    );
    window.history.replaceState({}, "", href);
    await renderRoute({
      route: ConfirmRoute,
      path: "/newsletter/confirm",
      initialEntry: "/newsletter/confirm",
    });
    expect(await screen.findByText(pl("newsletter.confirmPage.okTitle"))).toBeTruthy();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API}?token=${TOKEN}`);
    expect(screen.queryByRole("button", { name: pl("newsletterMeasurement.grantBtn") })).toBeNull();
    expect(card()).toBeNull();
  });

  it("EN: karta w języku treści zgody subskrybenta", async () => {
    await mountWithCard("en");
    expect(card()?.textContent).toContain(measurementConsentPlain("en"));
    expect(card()?.getAttribute("lang")).toBe("en");
    expect(declineButton(en)).toBeTruthy();
  });

  it("„Zgadzam się” wysyła POST z tokenem i decyzją `grant` i pokazuje zapis zgody", async () => {
    await mountWithCard();
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, result: "granted" }));
    fireEvent.click(grantButton());
    expect(await screen.findByText(pl("newsletterMeasurement.grantedTitle"))).toBeTruthy();
    expect(postBody(1)).toEqual({ token: TOKEN, decision: "grant", m: SECRET });
    expect(screen.queryByRole("button", { name: pl("newsletterMeasurement.grantBtn") })).toBeNull();
  });

  it("„Nie zgadzam się” wysyła decyzję `decline` i mówi, że pomiar zostaje wyłączony", async () => {
    await mountWithCard();
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, result: "declined" }));
    fireEvent.click(declineButton());
    expect(await screen.findByText(pl("newsletterMeasurement.declinedTitle"))).toBeTruthy();
    expect(screen.getByText(pl("newsletterMeasurement.declinedBody"))).toBeTruthy();
    expect(postBody(1)).toEqual({ token: TOKEN, decision: "decline", m: SECRET });
  });

  it.each([
    [{ ok: true, result: "already" }, 200, "alreadyDecidedTitle"],
    [{ ok: false, error: "invalid_token" }, 400, "invalidTitle"],
    [{ ok: false, error: "inactive" }, 409, "inactiveTitle"],
    [{ ok: false, error: "none" }, 422, "expiredTitle"],
  ] as const)("wynik %j (HTTP %i) -> ekran %s bez ponowienia", async (body, status, key) => {
    await mountWithCard();
    fetchMock.mockResolvedValueOnce(jsonResponse(body, status));
    fireEvent.click(grantButton());
    expect(await screen.findByText(pl(`newsletterMeasurement.${key}`))).toBeTruthy();
    expect(screen.queryByRole("button", { name: pl("newsletterMeasurement.retryBtn") })).toBeNull();
  });

  it("limit prób (429): komunikat i ponowienie TEJ SAMEJ decyzji", async () => {
    await mountWithCard();
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: "rate_limited" }, 429));
    fireEvent.click(declineButton());
    expect(await screen.findByText(pl("newsletterMeasurement.rateLimitedBody"))).toBeTruthy();

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, result: "declined" }));
    fireEvent.click(screen.getByRole("button", { name: pl("newsletterMeasurement.retryBtn") }));
    expect(await screen.findByText(pl("newsletterMeasurement.declinedTitle"))).toBeTruthy();
    expect(postBody(2)).toEqual({ token: TOKEN, decision: "decline", m: SECRET });
  });

  it("awaria sieci i nieznany kształt odpowiedzi: błąd z ponowieniem", async () => {
    await mountWithCard();
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(grantButton());
    expect(await screen.findByText(pl("newsletterMeasurement.errorBody"))).toBeTruthy();

    fetchMock.mockResolvedValueOnce(new Response("nie json", { status: 500 }));
    fireEvent.click(screen.getByRole("button", { name: pl("newsletterMeasurement.retryBtn") }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(await screen.findByText(pl("newsletterMeasurement.errorBody"))).toBeTruthy();
    expect(postBody(2)).toEqual({ token: TOKEN, decision: "grant", m: SECRET });
  });

  it("po decyzji fokus przechodzi na nagłówek wyniku - kliknięty przycisk znika (WCAG 2.4.3)", async () => {
    await mountWithCard();
    const grant = grantButton();
    grant.focus();
    expect(document.activeElement).toBe(grant);
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, result: "granted" }));
    fireEvent.click(grant);
    const heading = await screen.findByRole("heading", {
      name: pl("newsletterMeasurement.grantedTitle"),
    });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    // Cel fokusu programowego, nie przystanek w kolejce Tab.
    expect(heading.getAttribute("tabindex")).toBe("-1");
    expect(heading.tagName).toBe("H2");
  });

  it("ponowienie po błędzie także przenosi fokus na nagłówek nowego wyniku", async () => {
    await mountWithCard();
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(declineButton());
    const errorHeading = await screen.findByRole("heading", {
      name: pl("newsletterMeasurement.errorTitle"),
    });
    await waitFor(() => expect(document.activeElement).toBe(errorHeading));

    const retry = screen.getByRole("button", { name: pl("newsletterMeasurement.retryBtn") });
    retry.focus();
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, result: "declined" }));
    fireEvent.click(retry);
    const declined = await screen.findByRole("heading", {
      name: pl("newsletterMeasurement.declinedTitle"),
    });
    await waitFor(() => expect(document.activeElement).toBe(declined));
  });

  it("w trakcie zapisu oba przyciski są zablokowane i mówią o pracy", async () => {
    await mountWithCard();
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(grantButton());
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: pl("newsletterMeasurement.working") }),
      ).toHaveLength(2),
    );
    for (const button of screen.getAllByRole("button", {
      name: pl("newsletterMeasurement.working"),
    })) {
      expect(button).toBeDisabled();
    }
  });

  it.each(["light", "dark"] as const)("karta bez naruszeń axe (motyw %s)", async (theme) => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    await mountWithCard();
    let violations = await axeViolations(card() as HTMLElement);
    expect(violations, summarize(violations)).toEqual([]);

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, result: "granted" }));
    fireEvent.click(grantButton());
    await screen.findByText(pl("newsletterMeasurement.grantedTitle"));
    violations = await axeViolations(card() as HTMLElement);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

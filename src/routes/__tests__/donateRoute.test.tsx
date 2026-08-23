// Publiczna trasa `/donate`: kontrakt adresu powrotnego z płatności i nagłówek.
//
// CO TEN PLIK DOWODZI.
//   1. Że `?status=thanks` - JEDYNY parametr, jaki Stripe dokleja po powrocie
//      z płatności - przełącza stronę na podziękowanie, i że robi to WYŁĄCZNIE
//      dokładna wartość `thanks`. Gdyby walidator przepuszczał wariant („Thanks",
//      „thanks/", spacje), darczyńca po udanej wpłacie zobaczyłby formularz
//      wpłaty jeszcze raz - i część ludzi zapłaciłaby drugi raz.
//   2. Że `validateSearch` przycina wartość do 32 znaków i odrzuca każdy typ
//      nie-string. To jest jedyna bariera między adresem URL a stanem strony:
//      przez `status` nie przechodzi ani obiekt, ani tablica, ani ładunek
//      dłuższy niż 32 znaki.
//   3. Że nagłówek trasy zmienia język razem z adresem i że NIE ustawia
//      `robots: noindex` - strona darowizny ma być indeksowana.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Samego formularza (`DonationForm`) - ma własne
// testy; tutaj jest podmieniony atrapą, bo przedmiotem dowodu jest ROZGAŁĘZIENIE
// trasy, a nie renderowanie pól wpłaty. Autorytetu dostępu nie dotyczy: trasa
// jest publiczna z definicji.
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-donate", () => ({ ensureI18n: () => undefined }));
vi.mock("@/components/donations/DonationForm", () => ({
  DonationForm: () => <form data-testid="formularz-wplaty" />,
}));

const requestUrl = vi.hoisted(() => ({ value: "" }));
vi.mock("@/lib/seo/request", () => ({ getRequestUrl: () => requestUrl.value }));

import { renderRoute, routeHead, routeSearchValidator } from "@/test/routeHarness";
import { Route } from "@/routes/donate";

describe("/donate - kontrakt adresu powrotnego z płatności", () => {
  const validate = routeSearchValidator(Route);

  it("`?status=thanks` przechodzi przez walidator nietknięte", () => {
    expect(validate({ status: "thanks" })).toEqual({ status: "thanks" });
  });

  it("brak parametru daje `undefined`, nie pusty napis", () => {
    // Rozróżnienie ma znaczenie: `""` jest wartością, `undefined` jest jej
    // brakiem, a komponent porównuje przez `===` z `"thanks"`.
    expect(validate({})).toEqual({ status: undefined });
  });

  it.each([
    ["obiekt", { status: { toString: () => "thanks" } }],
    ["tablica", { status: ["thanks"] }],
    ["liczba", { status: 1 }],
    ["null", { status: null }],
    ["boolean", { status: true }],
  ])("%s w `status` jest ODRZUCANY - do stanu strony trafia undefined", (_opis, raw) => {
    expect(validate(raw)).toEqual({ status: undefined });
  });

  it("wartość dłuższa niż 32 znaki jest PRZYCINANA, nie odrzucana", () => {
    const dlugie = "t".repeat(200);
    const wynik = validate({ status: dlugie });
    expect(wynik.status).toHaveLength(32);
    expect(wynik.status).toBe("t".repeat(32));
  });

  it("dokładnie 32 znaki przechodzą bez zmiany - granica jest włączna", () => {
    const rowno = "x".repeat(32);
    expect(validate({ status: rowno })).toEqual({ status: rowno });
  });

  it("nadmiarowe parametry adresu są ODRZUCANE - walidator zwraca tylko `status`", () => {
    // Istotne dla trasy płatniczej: `?amount=1&session_id=...` doklejone przez
    // kogokolwiek nie staje się częścią stanu strony.
    expect(validate({ status: "thanks", amount: "999", session_id: "cs_test_x" })).toEqual({
      status: "thanks",
    });
  });
});

describe("/donate - co widzi darczyńca", () => {
  it("bez parametru renderuje FORMULARZ wpłaty, nie podziękowanie", async () => {
    await renderRoute({ route: Route, path: "/donate", initialEntry: "/donate" });
    expect(screen.getByTestId("formularz-wplaty")).toBeTruthy();
    expect(screen.queryByText("donate.thanksTitle")).toBeNull();
  });

  it("`?status=thanks` renderuje PODZIĘKOWANIE i chowa formularz", async () => {
    await renderRoute({
      route: Route,
      path: "/donate",
      initialEntry: "/donate?status=thanks",
    });
    expect(screen.getByText("donate.thanksTitle")).toBeTruthy();
    expect(screen.queryByTestId("formularz-wplaty")).toBeNull();
  });

  it("podziękowanie prowadzi z powrotem na stronę główną", async () => {
    // Bez tego linku darczyńca kończy w ślepym zaułku po udanej płatności.
    await renderRoute({
      route: Route,
      path: "/donate",
      initialEntry: "/donate?status=thanks",
    });
    const link = screen.getByText("donate.backHome").closest("a");
    expect(link?.getAttribute("href")).toBe("/");
  });

  it.each(["Thanks", "THANKS", "thanks ", " thanks", "thanks/", "thank", "success", "paid"])(
    "`?status=%s` NIE jest podziękowaniem - darczyńca widzi formularz jeszcze raz",
    async (status) => {
      // To jest opis stanu FAKTYCZNEGO, nie postulat. Porównanie jest ścisłe
      // (`status === "thanks"`), więc każdy wariant zapisu wraca na formularz.
      // Ryzyko jest realne: człowiek, który właśnie zapłacił i widzi formularz
      // wpłaty, ma powód sądzić, że płatność nie przeszła.
      await renderRoute({
        route: Route,
        path: "/donate",
        initialEntry: `/donate?status=${encodeURIComponent(status)}`,
      });
      expect(screen.getByTestId("formularz-wplaty")).toBeTruthy();
    },
  );
});

describe("/donate - nagłówek strony", () => {
  it("adres polski daje polski tytuł i opis", () => {
    requestUrl.value = "https://przyklad.example/donate";
    const head = routeHead(Route);
    const tytul = head.meta?.find((m) => "title" in m)?.title;
    expect(String(tytul)).toContain("Darowizna");
  });

  it("adres z prefiksem `/en` daje angielski tytuł", () => {
    requestUrl.value = "https://przyklad.example/en/donate";
    const head = routeHead(Route);
    const tytul = head.meta?.find((m) => "title" in m)?.title;
    expect(String(tytul)).toContain("Donate");
  });

  it("brak adresu żądania (render po stronie klienta) NIE wywraca nagłówka", () => {
    // `getRequestUrl()` zwraca pusty napis poza SSR; `|| "/donate"` jest
    // jedyną rzeczą, która trzyma wtedy `activeLang` i adres kanoniczny.
    requestUrl.value = "";
    expect(() => routeHead(Route)).not.toThrow();
    const head = routeHead(Route);
    expect(head.meta?.length ?? 0).toBeGreaterThan(0);
  });

  it("strona darowizny NIE jest wykluczona z indeksowania", () => {
    // Odwrotnie niż panel: `/donate` ma być znajdowana w wyszukiwarce.
    // Gdyby ktoś skopiował tu nagłówek z `admin.*`, zbiórka zniknęłaby z Google
    // i nikt by tego nie zauważył przez miesiące.
    requestUrl.value = "https://przyklad.example/donate";
    const head = routeHead(Route);
    const robots = head.meta?.find((m) => m.name === "robots");
    expect(robots?.content ?? "").not.toContain("noindex");
  });

  it("nagłówek niesie adres kanoniczny", () => {
    requestUrl.value = "https://przyklad.example/donate";
    const head = routeHead(Route);
    const canonical = head.links?.find((l) => l.rel === "canonical");
    expect(canonical?.href).toBeTruthy();
  });
});

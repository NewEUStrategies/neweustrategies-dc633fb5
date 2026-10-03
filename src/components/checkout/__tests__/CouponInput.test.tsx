// Pole kuponu B2B na stronie kasy planu: `src/components/checkout/CouponInput.tsx`.
//
// CO TEN PLIK DOWODZI.
//   1. JEDNO PYTANIE NARAZ (20261001100000). Kazde sprawdzenie kodu zjada probe
//      z limitu (IP i konto), wiec Enter wysyla JEDNO pytanie, przytrzymany
//      Enter (autopowtorzenie klawisza) nie wysyla kolejnych, a drugi Enter
//      w trakcie pytania nie dubluje go. Pole tekstowe nie jest wylaczane na
//      czas pytania - drugi Enter zatrzymuje WYLACZNIE straznik w refie.
//      Po odpowiedzi nowy Enter to nowa decyzja i pyta znowu.
//   2. SUKCES pokazuje etykiete rabatu i oddaje rodzicowi kod znormalizowany.
//   3. ODMOWA LIMITU I AWARIA MAJA WLASNE ZDANIA, nie „nie ma takiego kuponu" -
//      to brak orzeczenia o kodzie, a rodzic dostaje `null` (bez rabatu).
//
// ATRAPUJEMY WYLACZNIE GRANICE: funkcje serwerowa `previewPlanCoupon`.
// `useValidateCoupon`, normalizacja kodu, mapa kluczy bledow i etykieta rabatu
// biegna prawdziwe. Kontrakt samego hooka (pusty i za dlugi kod bez sieci,
// przekazanie planu i kwoty) ma `src/hooks/__tests__/useValidateCoupon.test.ts`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import type { ValidateCouponResult } from "@/lib/billing/coupons";
import { moneyPattern } from "@/test/billing/fixtures";

type PreviewArg = {
  data: { code: string; planId: string | null; amountCents: number; currency: string };
};
type Applied = { code: string; result: ValidateCouponResult } | null;

const h = vi.hoisted(() => ({
  preview: vi.fn<(arg: PreviewArg) => Promise<ValidateCouponResult | null>>(),
  onChange: vi.fn<(payload: Applied) => void>(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/billing/couponPreview.functions", () => ({
  previewPlanCoupon: (arg: PreviewArg) => h.preview(arg),
}));

import { CouponInput } from "@/components/checkout/CouponInput";

const PLAN = "11111111-1111-1111-1111-111111111111";
const AMOUNT = 49_900;

function odmowa(error: NonNullable<ValidateCouponResult["error"]>): ValidateCouponResult {
  return {
    ok: false,
    error,
    coupon_id: null,
    discount_cents: 0,
    final_cents: AMOUNT,
    label: null,
    discount_kind: null,
    discount_percent: null,
  };
}

const RABAT_10: ValidateCouponResult = {
  ok: true,
  error: null,
  coupon_id: null,
  discount_cents: 4_990,
  final_cents: 44_910,
  label: null,
  discount_kind: "percent",
  discount_percent: 10,
};

/** Odpowiedz serwera, ktora test wypuszcza recznie - pytanie wisi „w drodze". */
function wstrzymana(): { release: (value: ValidateCouponResult) => Promise<void> } {
  let resolve: (value: ValidateCouponResult) => void = () => undefined;
  h.preview.mockImplementationOnce(
    () =>
      new Promise<ValidateCouponResult>((r) => {
        resolve = r;
      }),
  );
  return {
    release: async (value) => {
      await act(async () => {
        resolve(value);
      });
    },
  };
}

function kupon() {
  return render(
    <CouponInput planId={PLAN} amountCents={AMOUNT} currency="PLN" onChange={h.onChange} />,
  );
}

const pole = (): HTMLElement => screen.getByRole("textbox", { name: "coupon.title" });

function wpisz(value: string): void {
  fireEvent.change(pole(), { target: { value } });
}

/** Enter wcisniety swiezo (`repeat: false`) albo autopowtorzenie trzymanego klawisza. */
function enter(repeat = false): void {
  fireEvent.keyDown(pole(), { key: "Enter", repeat });
}

beforeEach(() => {
  h.preview.mockReset();
  h.preview.mockResolvedValue(odmowa("not_found"));
  h.onChange.mockReset();
});

describe("jedno pytanie naraz (limit prob kodow, 20261001100000)", () => {
  it("Enter wysyla JEDNO pytanie ze znormalizowanym kodem", async () => {
    kupon();
    wpisz("  rabat-10 ");
    enter();

    expect(await screen.findByText("coupon.error.notFound")).toBeInTheDocument();
    expect(h.preview).toHaveBeenCalledTimes(1);
    expect(h.preview.mock.lastCall?.[0]).toEqual({
      data: { code: "RABAT-10", planId: PLAN, amountCents: AMOUNT, currency: "PLN" },
    });
  });

  it("przytrzymany Enter (autopowtorzenie) nie wysyla kolejnych pytan", async () => {
    kupon();
    wpisz("rabat-10");
    enter();
    expect(await screen.findByText("coupon.error.notFound")).toBeInTheDocument();

    // Pierwsza odpowiedz juz przyszla, wiec straznik w refie jest zwolniony -
    // zostaje tylko rozpoznanie autopowtorzenia klawisza.
    enter(true);
    enter(true);
    enter(true);
    await act(async () => {});

    expect(h.preview).toHaveBeenCalledTimes(1);
  });

  it("drugi Enter w trakcie pytania nie dubluje go, a po odpowiedzi nowy Enter pyta znowu", async () => {
    const pierwsze = wstrzymana();
    kupon();
    wpisz("rabat-10");

    enter();
    enter();
    // Przycisk stoi wylaczony, ale pole tekstowe nie - drugi Enter zatrzymal
    // straznik w refie, nie stan przycisku.
    expect(pole()).not.toBeDisabled();
    expect(h.preview).toHaveBeenCalledTimes(1);

    await pierwsze.release(odmowa("not_found"));
    expect(screen.getByText("coupon.error.notFound")).toBeInTheDocument();

    enter();
    expect(h.preview).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("coupon.error.notFound")).toBeInTheDocument();
  });

  it("przycisk jest wylaczony, dopoki pytanie jest w drodze", async () => {
    const pierwsze = wstrzymana();
    kupon();
    wpisz("rabat-10");
    const przycisk = screen.getByRole("button");

    fireEvent.click(przycisk);
    expect(przycisk).toBeDisabled();
    // Enter w polu w tej samej chwili tez nie wysyla drugiej proby z limitu.
    enter();
    expect(h.preview).toHaveBeenCalledTimes(1);

    await pierwsze.release(odmowa("not_found"));
    expect(screen.getByRole("button", { name: "coupon.apply" })).not.toBeDisabled();
  });
});

describe("wynik sprawdzenia kodu", () => {
  it("sukces pokazuje kod i etykiete rabatu, a rodzic dostaje kod znormalizowany", async () => {
    h.preview.mockResolvedValue(RABAT_10);
    kupon();
    wpisz("rabat-10");
    enter();

    expect(await screen.findByText("-10%")).toBeInTheDocument();
    expect(screen.getByText("RABAT-10")).toBeInTheDocument();
    expect(screen.getByText(/49,90\s*zł/)).toBeInTheDocument();
    expect(h.onChange).toHaveBeenCalledTimes(1);
    expect(h.onChange).toHaveBeenLastCalledWith({ code: "RABAT-10", result: RABAT_10 });
    // Po sukcesie pole znika - nie ma czym wyslac kolejnego pytania.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("odmowa limitu mowi rateLimited, NIE notFound, a rodzic dostaje null", async () => {
    h.preview.mockResolvedValue(odmowa("rate_limited"));
    kupon();
    wpisz("rabat-10");
    enter();

    expect(await screen.findByText("coupon.error.rateLimited")).toBeInTheDocument();
    expect(screen.queryByText("coupon.error.notFound")).not.toBeInTheDocument();
    expect(h.onChange).toHaveBeenCalledTimes(1);
    expect(h.onChange).toHaveBeenLastCalledWith(null);
  });

  it("zerwane pytanie do serwera to technicalError, NIE notFound, a rodzic dostaje null", async () => {
    h.preview.mockRejectedValue(new Error("Failed to fetch"));
    kupon();
    wpisz("rabat-10");
    enter();

    expect(await screen.findByText("coupon.error.technicalError")).toBeInTheDocument();
    expect(screen.queryByText("coupon.error.notFound")).not.toBeInTheDocument();
    expect(h.onChange).toHaveBeenCalledTimes(1);
    expect(h.onChange).toHaveBeenLastCalledWith(null);
  });

  it("rabat kwotowy pokazuje kwote w walucie planu, a nie procent", async () => {
    const rabat: ValidateCouponResult = {
      ...RABAT_10,
      discount_kind: "fixed",
      discount_percent: null,
      discount_cents: 1_250,
      final_cents: AMOUNT - 1_250,
    };
    h.preview.mockResolvedValue(rabat);
    kupon();
    wpisz("minus-12");
    enter();

    expect(await screen.findByText("MINUS-12")).toBeInTheDocument();
    // Etykieta i oszczednosc to ta sama kwota 12,50 zl - etykieta ze znakiem minus.
    const etykieta = screen.getByText(
      (tekst) => tekst.startsWith("-") && moneyPattern(1_250).test(tekst),
    );
    expect(etykieta.textContent).toMatch(/zł/);
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(h.onChange).toHaveBeenLastCalledWith({ code: "MINUS-12", result: rabat });
  });

  it("po awarii ten sam kod mozna sprawdzic ponownie - straznik nie zostaje zamkniety", async () => {
    h.preview.mockRejectedValueOnce(new Error("Failed to fetch"));
    kupon();
    wpisz("rabat-10");
    enter();
    expect(await screen.findByText("coupon.error.technicalError")).toBeInTheDocument();

    h.preview.mockResolvedValueOnce(RABAT_10);
    enter();

    expect(await screen.findByText("-10%")).toBeInTheDocument();
    expect(h.preview).toHaveBeenCalledTimes(2);
    expect(h.onChange).toHaveBeenLastCalledWith({ code: "RABAT-10", result: RABAT_10 });
  });
});

describe("zdjecie kuponu i klawisze inne niz Enter", () => {
  it("zdjecie zastosowanego kuponu oddaje rodzicowi null i przywraca puste pole", async () => {
    h.preview.mockResolvedValue(RABAT_10);
    kupon();
    wpisz("rabat-10");
    enter();
    expect(await screen.findByText("-10%")).toBeInTheDocument();

    // Po sukcesie jedynym przyciskiem jest „zdejmij kupon".
    fireEvent.click(screen.getByRole("button", { name: "coupon.remove" }));

    // Rodzic MUSI dostac null - inaczej kasa wyslalaby kod, ktory kupujacy zdjal,
    // i pobrala kwote po rabacie, ktorego juz nie widac.
    expect(h.onChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByText("-10%")).not.toBeInTheDocument();
    expect(pole()).toHaveValue("");
    expect(screen.getByRole("button", { name: "coupon.apply" })).toBeDisabled();
    // Zdjecie kuponu nie zjada proby z limitu kodow.
    expect(h.preview).toHaveBeenCalledTimes(1);
  });

  it("przycisk zdjecia kuponu ma dostepna nazwe - czytnik ekranu nie slyszy samego „przycisk”", async () => {
    // Przycisk jest sama ikona X obok kwoty rabatu. Bez nazwy kupujacy
    // korzystajacy z czytnika ekranu nie wie, ze ten przycisk zdejmuje rabat.
    h.preview.mockResolvedValue(RABAT_10);
    kupon();
    wpisz("rabat-10");
    enter();
    expect(await screen.findByText("-10%")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "coupon.remove" })).toBeInTheDocument();
  });

  it("pisanie kodu (klawisze inne niz Enter) nie wysyla pytania do serwera", async () => {
    kupon();
    wpisz("rabat");
    fireEvent.keyDown(pole(), { key: "a" });
    fireEvent.keyDown(pole(), { key: "Tab" });
    await act(async () => {});

    expect(h.preview).not.toHaveBeenCalled();
    expect(h.onChange).not.toHaveBeenCalled();
  });
});

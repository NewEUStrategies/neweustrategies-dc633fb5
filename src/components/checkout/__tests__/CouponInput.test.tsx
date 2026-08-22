// Pole kodu kuponu na checkoucie - JEDYNY produkcyjny konsument
// `useValidateCoupon`, i jedyne miejsce, w którym klient widzi, czy jego kod
// zadziałał.
//
// PO CO OSOBNY PLIK. `routes/__tests__/checkoutPlanRoute.test.tsx` renderuje ten
// komponent, ale MOCKUJE `@/hooks/useValidateCoupon` - czyli mija dokładnie tę
// warstwę, która rozstrzyga o kwocie. Tamtego mocka nie ruszamy (test trasy ma
// dowodzić sklejenia trasy). Tutaj atrapą jest WYŁĄCZNIE klient Supabase, więc
// hook walidacji biegnie prawdziwy i test przechodzi przez pełną ścieżkę
// kod -> RPC -> werdykt -> to, co widzi klient.
//
// CO TEN PLIK DOWODZI.
//   1. UDANY KUPON POKAZUJE KWOTĘ OSZCZĘDNOŚCI I ODDAJE ŁADUNEK RODZICOWI.
//      Rodzic dopina `{ code, result }` do `createCheckoutOrder`, więc `onChange`
//      z niepełnym ładunkiem znaczy „rabat pokazany klientowi, ale nienaliczony".
//   2. ODMOWA WOŁA `onChange(null)` - rodzic MUSI stracić poprzedni rabat.
//      Gdyby odmowa zostawiała stary ładunek, klient zobaczyłby błąd i zapłacił
//      mniej (albo odwrotnie: zapłacił z rabatem, którego kupon już nie daje).
//   3. `clear()` KASUJE STAN I ŁADUNEK (linie 48-50, dziś niepokryte). Po
//      wyczyszczeniu wraca pole wpisywania, a rodzic wie, że rabatu nie ma.
//   4. AWARIA ODCZYTU NIE POKAZUJE RABATU. Błąd RPC daje `not_found`
//      z `final_cents === amountCents`, więc klient widzi komunikat, a nie
//      obniżoną kwotę.
//   5. DEFEKT: HANDLER ENTERA NIE JEST ZABEZPIECZONY PRZED PODWÓJNĄ WYSYŁKĄ
//      (`it.fails`). Przycisk ma `disabled={loading || !code.trim()}`
//      (CouponInput.tsx:106), a handler klawisza (98-103) nie sprawdza ani
//      `loading`, ani `code.trim()`. Trzymany Enter wysyła N równoległych
//      walidacji tego samego kodu; hook trzyma `loading` jako pojedynczy boolean
//      bez licznika i bez przerywania poprzedniego żądania, więc o wyniku
//      decyduje kolejność odpowiedzi, a nie kolejność wysyłki.
//   6. `coupon.error.emptyCode` JEST KLUCZEM MARTWYM Z PUNKTU WIDZENIA UI.
//      Komponent robi `if (!norm) return;` (34-35) PRZED wywołaniem `validate`,
//      więc ścieżka `empty_code` w hooku - jedyny producent tego powodu - nie ma
//      jak zapalić komunikatu. Test dokumentuje to wprost; klucz i18n istnieje
//      i jest tłumaczony, a nikt go nie zobaczy.
//   7. `result` I `reset` Z HOOKA NIE MAJĄ KONSUMENTA. Komponent destrukturyzuje
//      wyłącznie `{ validate, loading }` i trzyma własny stan `applied`. To jest
//      test strukturalny, nie behawioralny - dokumentuje, że połowa publicznej
//      powierzchni hooka jest nieużywana.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Zachowania samego hooka
// (`hooks/__tests__/useValidateCoupon.test.tsx`: sentinel planu, `finally`,
// stabilność `useCallback`, pusty zbiór wierszy) ani arytmetyki rabatu
// (`billing/__tests__/couponMoney.test.ts`).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ValidateCouponResult } from "@/lib/billing/coupons";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

const db = await vi.hoisted(async () => {
  const { supabaseRpcStub } = await import("@/test/supabase");
  return { rpc: supabaseRpcStub() };
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (name: string, args?: Record<string, unknown>) => db.rpc.rpc(name, args) },
}));

import { CouponInput } from "@/components/checkout/CouponInput";

const RPC = "validate_b2b_coupon";

function okRow(over: Partial<ValidateCouponResult> = {}): ValidateCouponResult {
  return {
    ok: true,
    error: null,
    coupon_id: "33333333-3333-4333-8333-333333333333",
    discount_cents: 2000,
    final_cents: 8000,
    label: "-20%",
    discount_kind: "percent",
    discount_percent: 20,
    ...over,
  };
}

function mount(onChange = vi.fn()) {
  const utils = render(
    <CouponInput
      planId="22222222-2222-4222-8222-222222222222"
      amountCents={10000}
      currency="PLN"
      onChange={onChange}
    />,
  );
  return { ...utils, onChange };
}

/** Pole kodu - `aria-label` jest tym samym kluczem, co tytuł sekcji. */
const field = () => screen.getByLabelText("coupon.title");
/** Przycisk „zastosuj". */
const applyButton = () => screen.getByRole("button", { name: "coupon.apply" });

beforeEach(() => {
  db.rpc.reset();
});

describe("CouponInput: udany kupon", () => {
  it("pokazuje kod, etykietę rabatu i kwotę oszczędności", async () => {
    db.rpc.setData(RPC, [okRow()]);
    mount();

    fireEvent.change(field(), { target: { value: "wiosna24" } });
    fireEvent.click(applyButton());

    // Kod jest pokazany ZNORMALIZOWANY - tak, jak poleciał do bazy.
    await waitFor(() => expect(screen.getByText("WIOSNA24")).toBeTruthy());
    expect(screen.getByText("-20%")).toBeTruthy();
    expect(screen.getByText("coupon.savings")).toBeTruthy();
  });

  it("oddaje rodzicowi PEŁNY ładunek: kod ORAZ werdykt", async () => {
    // Rodzic dopina oba pola do `createCheckoutOrder`. Ładunek bez `result`
    // znaczy „rabat pokazany, ale nienaliczony".
    const row = okRow({ discount_cents: 1500, final_cents: 8500 });
    db.rpc.setData(RPC, [row]);
    const { onChange } = mount();

    fireEvent.change(field(), { target: { value: "kod15" } });
    fireEvent.click(applyButton());

    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ code: "KOD15", result: row }));
  });

  it("po zastosowaniu pole wpisywania znika - nie da się zastosować drugiego kodu obok", async () => {
    db.rpc.setData(RPC, [okRow()]);
    mount();
    fireEvent.change(field(), { target: { value: "kod" } });
    fireEvent.click(applyButton());

    await waitFor(() => expect(screen.getByText("KOD")).toBeTruthy());
    expect(screen.queryByLabelText("coupon.title")).toBeNull();
  });
});

describe("CouponInput: odmowa i awaria", () => {
  it("odmowa bazy pokazuje komunikat z mapy `COUPON_ERROR_I18N_KEY`", async () => {
    db.rpc.setData(RPC, [
      okRow({ ok: false, error: "limit_reached", discount_cents: 0, final_cents: 10000 }),
    ]);
    mount();

    fireEvent.change(field(), { target: { value: "zuzyty" } });
    fireEvent.click(applyButton());

    await waitFor(() => expect(screen.getByText("coupon.error.limitReached")).toBeTruthy());
  });

  it("odmowa woła `onChange(null)` - rodzic MUSI stracić poprzedni rabat", async () => {
    db.rpc.setData(RPC, [okRow({ ok: false, error: "expired" })]);
    const { onChange } = mount();

    fireEvent.change(field(), { target: { value: "stary" } });
    fireEvent.click(applyButton());

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null));
  });

  it("odmowa NIE pokazuje kwoty oszczędności", async () => {
    db.rpc.setData(RPC, [okRow({ ok: false, error: "inactive", discount_cents: 0 })]);
    mount();
    fireEvent.change(field(), { target: { value: "nieaktywny" } });
    fireEvent.click(applyButton());

    await waitFor(() => expect(screen.getByText("coupon.error.inactive")).toBeTruthy());
    expect(screen.queryByText("coupon.savings")).toBeNull();
  });

  it("AWARIA odczytu pokazuje `notFound`, a nie obniżoną kwotę", async () => {
    // Ścieżka `catch` w hooku buduje `not_found` z `final_cents === amountCents`.
    // Dla klienta znaczy to „kod nie zadziałał", nie „masz rabat".
    db.rpc.setError(RPC, "statement timeout", "57014");
    const { onChange } = mount();

    fireEvent.change(field(), { target: { value: "kod" } });
    fireEvent.click(applyButton());

    await waitFor(() => expect(screen.getByText("coupon.error.notFound")).toBeTruthy());
    expect(onChange).toHaveBeenCalledWith(null);
    expect(screen.queryByText("coupon.savings")).toBeNull();
  });

  it.each([
    ["not_yet_valid", "coupon.error.notYetValid"],
    ["plan_not_eligible", "coupon.error.planNotEligible"],
    ["currency_mismatch", "coupon.error.currencyMismatch"],
    ["invalid_amount", "coupon.error.invalidAmount"],
  ])("powód %s mapuje się na klucz %s", async (reason, key) => {
    db.rpc.setData(RPC, [okRow({ ok: false, error: reason as ValidateCouponResult["error"] })]);
    mount();
    fireEvent.change(field(), { target: { value: "kod" } });
    fireEvent.click(applyButton());
    await waitFor(() => expect(screen.getByText(key)).toBeTruthy());
  });
});

describe("CouponInput: czyszczenie zastosowanego kuponu", () => {
  it("`clear()` przywraca pole wpisywania i zeruje ładunek rodzica", async () => {
    // Ciało `clear` (CouponInput.tsx:48-50) było dotąd niepokryte.
    db.rpc.setData(RPC, [okRow()]);
    const { onChange } = mount();

    fireEvent.change(field(), { target: { value: "kod" } });
    fireEvent.click(applyButton());
    await waitFor(() => expect(screen.getByText("KOD")).toBeTruthy());

    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(screen.getByLabelText("coupon.title")).toBeTruthy());
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("po wyczyszczeniu pole jest PUSTE - stary kod nie zostaje", async () => {
    db.rpc.setData(RPC, [okRow()]);
    mount();
    fireEvent.change(field(), { target: { value: "kod" } });
    fireEvent.click(applyButton());
    await waitFor(() => expect(screen.getByText("KOD")).toBeTruthy());

    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(screen.getByLabelText("coupon.title")).toBeTruthy());
    expect((field() as HTMLInputElement).value).toBe("");
  });
});

describe("CouponInput: przycisk „zastosuj” i pusty kod", () => {
  it("przycisk jest WYŁĄCZONY dla pustego pola", () => {
    mount();
    expect((applyButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("przycisk jest WYŁĄCZONY dla pola z samymi spacjami", () => {
    mount();
    fireEvent.change(field(), { target: { value: "   " } });
    expect((applyButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("kliknięcie przy samych spacjach NIE strzela do bazy", () => {
    // Podwójna obrona: `disabled` na przycisku i `if (!norm) return` w `apply`.
    mount();
    fireEvent.change(field(), { target: { value: "   " } });
    fireEvent.click(applyButton());
    expect(db.rpc.calls).toHaveLength(0);
  });

  it("KLUCZ MARTWY: `coupon.error.emptyCode` jest nieosiągalny z interfejsu", () => {
    // Ścieżka `empty_code` w hooku to JEDYNY producent tego powodu, a komponent
    // wychodzi przed wywołaniem `validate` (`if (!norm) return`). Klucz istnieje
    // w słowniku i jest przetłumaczony w obu językach - i nikt go nie zobaczy.
    // Test dokumentuje stan faktyczny; usunięcie klucza albo usunięcie
    // wczesnego `return` to decyzja produktowa, nie defekt do naprawy tutaj.
    mount();
    fireEvent.change(field(), { target: { value: "  " } });
    fireEvent.click(applyButton());
    expect(screen.queryByText("coupon.error.emptyCode")).toBeNull();
  });
});

describe("CouponInput: wysyłka Enterem", () => {
  it("Enter na niepustym kodzie wysyła walidację", async () => {
    // Ciało handlera klawisza (CouponInput.tsx:99-101) było dotąd niepokryte.
    db.rpc.setData(RPC, [okRow()]);
    mount();
    fireEvent.change(field(), { target: { value: "enterkod" } });
    fireEvent.keyDown(field(), { key: "Enter" });

    await waitFor(() => expect(screen.getByText("ENTERKOD")).toBeTruthy());
    expect(db.rpc.calls).toHaveLength(1);
  });

  it("inny klawisz niż Enter nie wysyła niczego", () => {
    mount();
    fireEvent.change(field(), { target: { value: "kod" } });
    fireEvent.keyDown(field(), { key: "a" });
    fireEvent.keyDown(field(), { key: "Tab" });
    expect(db.rpc.calls).toHaveLength(0);
  });

  it.fails(
    "DEFEKT: trzymany Enter MA wysłać jedną walidację, a wysyła tyle, ile było naciśnięć - " +
      "handler klawisza nie sprawdza ani `loading`, ani pustego kodu",
    async () => {
      // Oczekiwanie: handler Entera ma tę samą obronę, co przycisk
      // (`disabled={loading || !code.trim()}`). Produkcja woła `void apply()`
      // bezwarunkowo, a hook trzyma `loading` jako pojedynczy boolean bez
      // licznika i bez przerywania poprzedniego żądania - o wyniku decyduje
      // więc kolejność ODPOWIEDZI, nie kolejność wysyłki.
      db.rpc.setData(RPC, [okRow()]);
      mount();
      fireEvent.change(field(), { target: { value: "kod" } });
      fireEvent.keyDown(field(), { key: "Enter" });
      fireEvent.keyDown(field(), { key: "Enter" });
      fireEvent.keyDown(field(), { key: "Enter" });

      await waitFor(() => expect(screen.getByText("KOD")).toBeTruthy());
      expect(db.rpc.calls).toHaveLength(1);
    },
  );

  it("STAN FAKTYCZNY: trzy naciśnięcia Entera dają trzy wywołania RPC", async () => {
    // Sprzężony z `it.fails` powyżej - po naprawie oba trzeba usunąć razem.
    db.rpc.setData(RPC, [okRow()]);
    mount();
    fireEvent.change(field(), { target: { value: "kod" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    fireEvent.keyDown(field(), { key: "Enter" });
    fireEvent.keyDown(field(), { key: "Enter" });

    await waitFor(() => expect(screen.getByText("KOD")).toBeTruthy());
    expect(db.rpc.calls.length).toBeGreaterThan(1);
  });

  it("Enter na PUSTYM polu nie strzela do bazy - ratuje go `if (!norm) return`", () => {
    // Handler nie sprawdza pustego kodu, ale `apply` sprawdza. To jedyna
    // obrona dla tej ścieżki - i dlatego jej usunięcie byłoby regresją.
    mount();
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(db.rpc.calls).toHaveLength(0);
  });
});

describe("CouponInput: powierzchnia hooka bez konsumenta", () => {
  it("komponent czyta z hooka WYŁĄCZNIE `validate` i `loading`", async () => {
    // Dowód strukturalny: `result` i `reset` - połowa publicznej powierzchni
    // `useValidateCoupon` - nie mają w produkcji żadnego konsumenta. Komponent
    // trzyma własny stan `applied`, więc werdykt żyje w dwóch miejscach naraz.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/components/checkout/CouponInput.tsx", "utf8");

    // Asercja dotyczy WYŁĄCZNIE listy destrukturyzowanej z hooka. Nazwa
    // `result` występuje w pliku także jako zmienna lokalna (`const result =
    // await validate(...)`) i jako pole stanu (`applied.result`), więc szukanie
    // jej w całym źródle dowodziłoby czegoś innego.
    const destructured = /const\s*\{([^}]*)\}\s*=\s*useValidateCoupon\(/.exec(src)?.[1] ?? "";
    const names = destructured
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

    expect(names).toEqual(["validate", "loading"]);
    expect(names).not.toContain("result");
    expect(names).not.toContain("reset");
  });
});

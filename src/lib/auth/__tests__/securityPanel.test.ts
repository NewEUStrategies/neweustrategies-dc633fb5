// Decyzje panelu bezpieczeństwa konta: hasło, adres e-mail, kod TOTP, widok czynników.
//
// CO TEN PLIK DOWODZI. Cztery grupy reguł wyprowadzone z `/profile/security`
// (537 linii, zero wykonanych funkcji). Każda z nich rozstrzyga coś, czego
// pomyłka kosztuje dostęp do konta albo jego bezpieczeństwo:
//
//   1. ZMIANA HASŁA - kolejność zastrzeżeń. Panel sprawdzający najpierw długość
//      pokazuje „hasło za krótkie" osobie, której realnym problemem jest wygasła
//      sesja; ta poprawia hasło do skutku i nie dowiaduje się, co jest nie tak.
//   2. ZMIANA ADRESU E-MAIL - kształt adresu i wymóg hasła. Zmiana adresu to
//      przejęcie konta w jednym kroku, jeśli nie stoi za nią potwierdzenie hasłem.
//   3. KOD TOTP - normalizacja wklejenia. Aplikacje pokazują kod z odstępem, a
//      menedżery haseł wklejają go ze spacją; odrzucenie takiego wklejenia jako
//      „nieprawidłowy kod" jest błędem panelu, nie użytkownika.
//   4. WIDOK CZYNNIKÓW - CZTERY stany, nie dwa. To jest najważniejsza pozycja
//      w pliku: panel czytał listę jako `factors.length > 0 ? włączone
//      : wyłączone`, więc przy NIEUDANYM odczycie mówił osobie z aktywnym 2FA,
//      że drugiego składnika nie ma.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - MECHANIKI DRUGIEGO SKŁADNIKA: `lib/auth/mfa.ts` (wyzwanie, weryfikacja,
//   podniesienie sesji do aal2, `toQrDataUri`) stoi na 100% i ma własny plik
//   testowy. Tutaj są wyłącznie decyzje PANELU o tym, co wolno wysłać.
// - OCHRONY PRZED ODGADYWANIEM: `lib/auth/bruteforce.functions.ts` - 100/100/100.
// - SKLEJENIA TRASY: render, wywołania klienta Supabase i czyszczenie pól po
//   sukcesie są w `src/routes/__tests__/profileSecurityRoute.test.tsx`.
// - REGUŁ SIŁY HASŁA: `PasswordStrengthMeter` liczy siłę i ma własne testy;
//   panel wymaga wyłącznie minimalnej długości (ta sama liczba, co `minLength`).
import { describe, expect, it } from "vitest";
import type { Factor } from "@supabase/supabase-js";
import {
  MIN_PASSWORD_LENGTH,
  emailChangeProblem,
  emailProblemKey,
  factorRemovalProblem,
  factorsView,
  isCompleteMfaCode,
  isLastFactor,
  mfaStatusKey,
  normalizeEmail,
  normalizeMfaCode,
  passwordChangeProblem,
  passwordProblemKey,
} from "@/lib/auth/securityPanel";

const EMAIL = "osoba@example.com";

/** Poprawny wniosek o zmianę hasła - baza dla każdego przypadku negatywnego. */
function passwordInput(patch: Partial<Parameters<typeof passwordChangeProblem>[0]> = {}) {
  return {
    current: "stare-haslo",
    next: "nowe-haslo",
    confirm: "nowe-haslo",
    email: EMAIL,
    ...patch,
  };
}

/** Czynnik TOTP w kształcie, w jakim zwraca go `listFactors().totp`. */
function factor(id: string): Factor {
  return {
    id,
    friendly_name: "Aplikacja",
    factor_type: "totp",
    status: "verified",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("zmiana hasła", () => {
  it("poprawny wniosek nie ma zastrzeżeń", () => {
    expect(passwordChangeProblem(passwordInput())).toBeNull();
  });

  it.each([[null], [undefined], [""]])(
    "brak adresu z sesji (%j) wychodzi PIERWSZY, przed wszystkimi innymi",
    (email) => {
      // Cała treść tego testu: przy wygasłej sesji użytkownik ma usłyszeć
      // „zaloguj się ponownie", a nie „hasło za krótkie" - bo poprawianie hasła
      // nie zbliża go do celu ani o krok.
      const problem = passwordChangeProblem(
        passwordInput({ email, next: "x", confirm: "y", current: "" }),
      );
      expect(problem).toBe("noEmail");
      expect(passwordProblemKey(problem!)).toBe("profile.security.sessionExpired");
    },
  );

  it("brak obecnego hasła jest zastrzeżeniem osobnym od pustego nowego", () => {
    const problem = passwordChangeProblem(passwordInput({ current: "" }));
    expect(problem).toBe("currentMissing");
    expect(passwordProblemKey(problem!)).toBe("profile.security.currentRequired");
  });

  it.each([
    ["", "puste"],
    ["1234567", "siedem znaków"],
  ])("nowe hasło %j (%s) jest za krótkie", (next) => {
    expect(passwordChangeProblem(passwordInput({ next, confirm: next }))).toBe("tooShort");
  });

  it("hasło o dokładnie minimalnej długości przechodzi - granica jest włączna", () => {
    const next = "a".repeat(MIN_PASSWORD_LENGTH);
    expect(passwordChangeProblem(passwordInput({ next, confirm: next }))).toBeNull();
  });

  it("minimalna długość to ta sama liczba, którą wymusza pole formularza", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });

  it("potwierdzenie różne od nowego hasła jest odrzucone", () => {
    const problem = passwordChangeProblem(passwordInput({ confirm: "nowe-haslo-x" }));
    expect(problem).toBe("mismatch");
    expect(passwordProblemKey(problem!)).toBe("profile.security.mismatch");
  });

  it("literówka w potwierdzeniu jest ważniejsza niż zgodność ze starym hasłem", () => {
    // Kolejność: najpierw „powtórz poprawnie", potem „wybierz inne". Odwrotna
    // kolejność każe użytkownikowi wymyślać nowe hasło, choć wystarczy poprawić
    // literówkę w drugim polu.
    expect(
      passwordChangeProblem(passwordInput({ next: "stare-haslo", confirm: "stare-hasło" })),
    ).toBe("mismatch");
  });

  it("NOWE HASŁO RÓWNE OBECNEMU jest odrzucone", () => {
    // Supabase przyjmuje taką zmianę bez błędu: użytkownik widzi „hasło
    // zmienione", pozostałe sesje lecą, a sekret jest ten sam co przed wyciekiem,
    // którym się przestraszył - a to jedyny powód, dla którego ktoś to robi.
    const problem = passwordChangeProblem(
      passwordInput({ current: "to-samo-haslo", next: "to-samo-haslo", confirm: "to-samo-haslo" }),
    );
    expect(problem).toBe("sameAsCurrent");
    expect(passwordProblemKey(problem!)).toBe("profile.security.sameAsCurrent");
  });

  it("hasło różniące się wielkością litery NIE jest tym samym hasłem", () => {
    // Hasła są wrażliwe na wielkość znaków - inaczej niż adresy e-mail niżej.
    expect(
      passwordChangeProblem(
        passwordInput({ current: "haslo123", next: "Haslo123", confirm: "Haslo123" }),
      ),
    ).toBeNull();
  });

  it("każde zastrzeżenie ma KLUCZ i18n, nie gotowy tekst", () => {
    const problems = [
      "noEmail",
      "currentMissing",
      "tooShort",
      "mismatch",
      "sameAsCurrent",
    ] as const;
    for (const problem of problems) {
      expect(passwordProblemKey(problem)).toMatch(/^profile\.security\.[a-zA-Z]+$/);
    }
    // Klucze muszą być RÓŻNE - jeden komunikat na pięć powodów nie mówi nic.
    expect(new Set(problems.map(passwordProblemKey)).size).toBe(problems.length);
  });
});

describe("zmiana adresu e-mail", () => {
  it("poprawny wniosek nie ma zastrzeżeń", () => {
    expect(
      emailChangeProblem({ next: "nowy@example.org", password: "haslo", current: EMAIL }),
    ).toBeNull();
  });

  it.each([
    ["", "puste"],
    ["osoba", "bez znaku @"],
    ["osoba@", "bez domeny"],
    ["osoba@example", "domena bez kropki"],
    ["osoba @example.com", "spacja w części lokalnej"],
    ["@example.com", "bez części lokalnej"],
  ])("adres %j (%s) jest odrzucony", (next) => {
    expect(emailChangeProblem({ next, password: "haslo", current: EMAIL })).toBe("invalid");
  });

  it.each(["osoba+tag@example.org", "osoba.nazwisko@dzial.example.org", "o@example.museum"])(
    "adres realnie działający %j przechodzi",
    (next) => {
      // Nadmiernie ciasny wzorzec odrzuca adresy, które istnieją - a dowodem
      // istnienia adresu jest kliknięcie w link, nie wyrażenie regularne.
      expect(emailChangeProblem({ next, password: "haslo", current: EMAIL })).toBeNull();
    },
  );

  it("brak hasła blokuje zmianę - to jest zapora przed przejęciem konta", () => {
    const problem = emailChangeProblem({ next: "nowy@example.org", password: "", current: EMAIL });
    expect(problem).toBe("needPassword");
    expect(emailProblemKey(problem!)).toBe("profile.security.email.needPassword");
  });

  it("kształt adresu sprawdza się PRZED hasłem", () => {
    // Odwrotna kolejność każe wpisać hasło, żeby dowiedzieć się o literówce
    // w adresie - czyli wystawia hasło przy wniosku, który i tak nie przejdzie.
    expect(emailChangeProblem({ next: "osoba", password: "", current: EMAIL })).toBe("invalid");
  });

  it("adres identyczny z obecnym jest odrzucony", () => {
    const problem = emailChangeProblem({ next: EMAIL, password: "haslo", current: EMAIL });
    expect(problem).toBe("sameAsCurrent");
    expect(emailProblemKey(problem!)).toBe("profile.security.email.sameAsCurrent");
  });

  it.each([
    ["OSOBA@EXAMPLE.COM", "inna wielkość znaków"],
    ["  osoba@example.com  ", "otoczony spacjami"],
  ])("adres %j (%s) też jest obecnym adresem", (next) => {
    // Wysłanie linku potwierdzającego na własny adres wygląda jak awaria,
    // a różnica w wielkości znaków nie tworzy nowej skrzynki u żadnego dostawcy.
    expect(emailChangeProblem({ next, password: "haslo", current: EMAIL })).toBe("sameAsCurrent");
  });

  it("brak obecnego adresu nie blokuje zmiany - nie ma z czym porównywać", () => {
    expect(
      emailChangeProblem({ next: "nowy@example.org", password: "haslo", current: null }),
    ).toBeNull();
    expect(
      emailChangeProblem({ next: "nowy@example.org", password: "haslo", current: undefined }),
    ).toBeNull();
  });

  it("normalizacja obcina spacje - do serwera jedzie to, co sprawdziła walidacja", () => {
    expect(normalizeEmail("  nowy@example.org \n")).toBe("nowy@example.org");
  });

  it("każde zastrzeżenie ma osobny klucz i18n", () => {
    const problems = ["invalid", "needPassword", "sameAsCurrent"] as const;
    expect(new Set(problems.map(emailProblemKey)).size).toBe(problems.length);
  });
});

describe("kod TOTP", () => {
  it.each([
    ["123456", "123456", "czysty kod"],
    ["123 456", "123456", "kod z odstępem, jak pokazuje aplikacja"],
    [" 123456 ", "123456", "wklejony ze spacjami"],
    ["12-34-56", "123456", "wklejony z myślnikami"],
    ["1234567890", "123456", "obcięty do sześciu cyfr"],
    ["abc123def456", "123456", "z literami do wyrzucenia"],
    ["", "", "puste zostaje puste"],
    ["abcdef", "", "same litery dają pustkę, nie wyjątek"],
  ])("normalizacja %j → %j (%s)", (raw, expected) => {
    expect(normalizeMfaCode(raw)).toBe(expected);
  });

  it.each([
    ["123456", true],
    ["12345", false],
    ["1234567", false],
    ["", false],
    ["12345a", false],
  ])("kompletność kodu %j = %s", (code, expected) => {
    expect(isCompleteMfaCode(code)).toBe(expected);
  });

  it("kod znormalizowany z wklejenia jest kompletny - to jest sens normalizacji", () => {
    expect(isCompleteMfaCode(normalizeMfaCode("123 456"))).toBe(true);
  });
});

describe("widok listy czynników - cztery stany, nie dwa", () => {
  it("odczyt w locie to `loading`", () => {
    expect(factorsView({ loading: true, failed: false, factors: [] })).toEqual({ kind: "loading" });
  });

  it("odczyt w locie wygrywa nad wcześniejszą awarią - najpierw poczekaj", () => {
    expect(factorsView({ loading: true, failed: true, factors: [] }).kind).toBe("loading");
  });

  it("AWARIA ODCZYTU to `unknown`, NIE `empty` - i to jest cała treść testu", () => {
    // Panel czytał to jako `factors.length > 0 ? włączone : wyłączone`, więc
    // nieudany odczyt mówił osobie z aktywnym drugim składnikiem, że go nie ma.
    // Taka osoba albo konfiguruje 2FA po raz drugi, albo przestaje mu wierzyć.
    const view = factorsView({ loading: false, failed: true, factors: [] });
    expect(view).toEqual({ kind: "unknown" });
    expect(mfaStatusKey(view)).toBe("profile.security.mfa.statusUnknown");
    expect(mfaStatusKey(view)).not.toBe(
      mfaStatusKey(factorsView({ loading: false, failed: false, factors: [] })),
    );
  });

  it("awaria odczytu NIE zeruje listy, jeśli coś już było wczytane", () => {
    // Odczyt odświeżający, który padł, nie może zabrać z ekranu czynnika,
    // o którym wiemy, że istnieje.
    const view = factorsView({ loading: false, failed: true, factors: [factor("f1")] });
    expect(view.kind).toBe("unknown");
  });

  it("pusta lista po UDANYM odczycie to `empty`", () => {
    const view = factorsView({ loading: false, failed: false, factors: [] });
    expect(view).toEqual({ kind: "empty" });
    expect(mfaStatusKey(view)).toBe("profile.security.mfa.statusDisabled");
  });

  it("lista z czynnikami to `list` i niesie je dalej", () => {
    const view = factorsView({
      loading: false,
      failed: false,
      factors: [factor("f1"), factor("f2")],
    });
    expect(view.kind).toBe("list");
    if (view.kind !== "list") throw new Error("test: widok miał być listą");
    expect(view.factors.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(mfaStatusKey(view)).toBe("profile.security.mfa.statusEnabled");
  });

  it("stan oczekiwania nie twierdzi, że 2FA jest wyłączone", () => {
    // Migotanie „Wyłączone → Włączone" przy każdym wejściu na stronę jest
    // fałszywą informacją o bezpieczeństwie konta, nawet jeśli trwa 200 ms.
    expect(mfaStatusKey(factorsView({ loading: true, failed: false, factors: [] }))).toBe(
      "profile.security.mfa.statusUnknown",
    );
  });

  it("cztery stany dają trzy RÓŻNE komunikaty statusu", () => {
    const keys = [
      mfaStatusKey({ kind: "loading" }),
      mfaStatusKey({ kind: "unknown" }),
      mfaStatusKey({ kind: "empty" }),
      mfaStatusKey({ kind: "list", factors: [factor("f1")] }),
    ];
    expect(new Set(keys).size).toBe(3);
  });
});

describe("usunięcie czynnika", () => {
  const base = { factorId: "f1", password: "haslo", email: EMAIL, factorCount: 2 };

  it("kompletny wniosek nie ma zastrzeżeń", () => {
    expect(factorRemovalProblem(base)).toBeNull();
  });

  it("bez wybranego czynnika nie ma czego usuwać", () => {
    expect(factorRemovalProblem({ ...base, factorId: null })).toBe("noFactor");
  });

  it("bez adresu z sesji nie da się potwierdzić tożsamości", () => {
    expect(factorRemovalProblem({ ...base, email: null })).toBe("noEmail");
  });

  it("bez hasła wniosek nie jedzie - zdjęcie 2FA wymaga potwierdzenia", () => {
    expect(factorRemovalProblem({ ...base, password: "" })).toBe("needPassword");
  });

  it.each([
    [0, true],
    [1, true],
    [2, false],
    [5, false],
  ])("przy %i czynnikach ostatni = %s", (factorCount, expected) => {
    // Usunięcie OSTATNIEGO czynnika zdejmuje z konta całą warstwę ochrony -
    // potwierdzenie musi to powiedzieć wprost, a nie tym samym zdaniem, co
    // usunięcie jednej z trzech aplikacji.
    expect(isLastFactor({ factorCount })).toBe(expected);
  });
});

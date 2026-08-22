// KONTO WŁASNE: USUNIĘCIE I ZMIANA ADRESU LOGOWANIA (`src/lib/account.functions.ts`).
//
// CO TEN PLIK DOWODZI - co konkretnie się psuje, gdy to przestanie działać:
//
//  1. TOŻSAMOŚĆ WOŁAJĄCEGO. Obie funkcje działają WYŁĄCZNIE na koncie, które
//     wynika z tokenu sesji. Gdyby którakolwiek zaczęła czytać identyfikator
//     albo adres z wejścia, dowolny zalogowany użytkownik kasowałby cudze
//     konto (nieodwracalnie) albo przestawiał cudzy adres logowania na swój -
//     czyli przejmował konto w jednym żądaniu. Dowodzimy tego dwoma
//     niezależnymi sposobami: walidator ZDEJMUJE nadmiarowe pola z wejścia,
//     a handler wywołuje wszystkie trzy kroki usuwania z identyfikatorem
//     z kontekstu, nie z podstawionego wejścia.
//
//  2. RE-UWIERZYTELNIENIE PRZED NIEODWRACALNĄ AKCJĄ. Bez potwierdzenia hasłem
//     przejęty token (np. z cudzej niezamkniętej przeglądarki) wystarcza do
//     skasowania konta albo do zabrania adresu logowania. Dowodzimy, że każda
//     ścieżka bez poprawnego hasła kończy się PRZED pierwszym zapisem.
//
//  3. KOLEJNOŚĆ KROKÓW USUWANIA I AWARIA KROKU N. Kolejność (hasło -> pieniądze
//     -> dowody księgowe -> `deleteUser`) jest kontraktem: odwrócenie jej
//     zostawia albo obciążaną kartę bez konta, albo dziurę w dowodach z art. 74
//     ust. 2 uor. Dowodzimy kolejności ORAZ tego, co dokładnie zostaje zrobione,
//     gdy padnie krok drugi, trzeci i czwarty.
//
//  4. RODO / HIGIENA KOMUNIKATÓW. Żaden komunikat błędu nie może nieść hasła
//     ani adresu e-mail - te napisy trafiają do logów i do interfejsu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
//  - `src/__tests__/accountDeletionRetention.invariant.test.ts` - statyczna
//    bramka migracji (FK `ON DELETE SET NULL`, anonimizatory, trigger na
//    `auth.users`) i STATYCZNE sprawdzenie kolejności kroków po treści pliku.
//    Tutaj kolejność jest dowodzona WYKONANIEM, nie `indexOf` w źródle.
//  - `src/components/profile/__tests__/DataRightsSection.test.tsx` - formularz
//    usuwania konta (potwierdzenie, komunikat o liczbie zachowanych dowodów).
//  - `src/routes/__tests__/profileSecurityRoute.test.tsx` - sklejenie trasy
//    `/profile/security` z `changeMyEmail`.
//  - `src/lib/auth/__tests__/securityPanel.test.ts` - reguły walidacji panelu
//    (kształt adresu, wymóg hasła) po stronie klienta.
//  - autoryzacji jako takiej: atrapa `createServerFn` NIE uruchamia middleware,
//    więc plik dowodzi wyłącznie, że funkcja DEKLARUJE `requireSupabaseAuth`
//    i że handler bierze tożsamość z kontekstu. Kto się dostanie do funkcji,
//    pilnuje bramka `check:authz-snapshot` i pgTAP.
//  - anulowania subskrypcji u operatora i samej anonimizacji dowodów - te
//    moduły (`accountClosure.server`, `accountingRetention.server`) mają własne
//    testy; tutaj są atrapami, bo przedmiotem dowodu jest ICH KOLEJNOŚĆ.
import { describe, it, expect, vi, beforeEach } from "vitest";

import { callServerFn, type ServerFnContext } from "@/test/serverFn";
import { asServerFn, serverFnMiddlewareNames, validateServerFnInput } from "@/test/serverFnHarness";

/** Konto wołającego. UUID-y stałe - determinizm zamiast losowania. */
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_EMAIL = "wlasciciel@example.com";
/** Konto OFIARY - identyfikator, którym próbujemy się podszyć z wejścia. */
const VICTIM_ID = "22222222-2222-4222-8222-222222222222";
const VICTIM_EMAIL = "ofiara@example.org";
const NEW_EMAIL = "nowy.adres@example.com";
const PASSWORD = "poprawne-haslo-testowe";

const h = vi.hoisted(() => ({
  /** Kolejność faktycznie wykonanych kroków - serce dowodu z punktu 3. */
  steps: [] as string[],
  signIn: vi.fn(),
  updateUser: vi.fn(),
  closeBilling: vi.fn(),
  retain: vi.fn(),
  deleteUser: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});

// Middleware jest tu ATRAPĄ z nazwą, żeby test mógł dowieść, że funkcja
// deklaruje uwierzytelnienie. Prawdziwy moduł tworzy klienta Supabase przy
// imporcie, co w teście jednostkowym nie ma czego uwierzytelnić.
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));

vi.mock("@/lib/billing/accountClosure.server", () => ({
  closeBillingForUser: (userId: string, email: string | null) => {
    h.steps.push("closeBilling");
    return h.closeBilling(userId, email);
  },
}));

vi.mock("@/lib/billing/accountingRetention.server", () => ({
  retainAccountingEvidence: (userId: string) => {
    h.steps.push("retainEvidence");
    return h.retain(userId);
  },
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        deleteUser: (userId: string) => {
          h.steps.push("deleteUser");
          return h.deleteUser(userId);
        },
      },
    },
  },
}));

const { deleteMyAccount, changeMyEmail } = await import("@/lib/account.functions");

/** Klient z kontekstu middleware - w produkcji związany z bearerem wołającego. */
function supabaseForCaller() {
  return {
    auth: {
      signInWithPassword: (args: { email: string; password: string }) => {
        h.steps.push("reauth");
        return h.signIn(args);
      },
      updateUser: (args: { email?: string }) => {
        h.steps.push("updateUser");
        return h.updateUser(args);
      },
    },
  };
}

function ctx(patch: Partial<ServerFnContext> = {}): ServerFnContext {
  return {
    supabase: supabaseForCaller(),
    userId: OWNER_ID,
    claims: { sub: OWNER_ID, email: OWNER_EMAIL },
    ...patch,
  };
}

/** Przechwytuje odrzucenie i oddaje błąd - bez tego asercja na treści ucieka. */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (caught) {
    return caught instanceof Error ? caught : new Error(String(caught));
  }
  throw new Error("test: oczekiwano odrzucenia, a wywołanie przeszło");
}

/** Klucze zwalidowanego wejścia - strażnik runtime zamiast rzutowania typu. */
function keysOf(value: unknown): string[] {
  return value !== null && typeof value === "object" ? Object.keys(value).sort() : [];
}

/** Wszystkie argumenty, jakie poszły do atrap - do asercji „nigdzie nie ma X”. */
function everyRecordedArgument(): string {
  return JSON.stringify([
    h.signIn.mock.calls,
    h.updateUser.mock.calls,
    h.closeBilling.mock.calls,
    h.retain.mock.calls,
    h.deleteUser.mock.calls,
  ]);
}

beforeEach(() => {
  h.steps.length = 0;
  h.signIn.mockReset();
  h.updateUser.mockReset();
  h.closeBilling.mockReset();
  h.retain.mockReset();
  h.deleteUser.mockReset();

  h.signIn.mockResolvedValue({ data: { user: { id: OWNER_ID } }, error: null });
  h.updateUser.mockResolvedValue({ data: { user: { id: OWNER_ID } }, error: null });
  h.closeBilling.mockResolvedValue({ canceled: 1, failed: [] });
  h.retain.mockResolvedValue({
    orders: { retained: 2, discarded: 0 },
    purchases: { retained: 3, discarded: 1 },
    retainedTotal: 5,
  });
  h.deleteUser.mockResolvedValue({ data: { user: null }, error: null });
});

describe("obudowa funkcji serwerowych konta", () => {
  it("obie funkcje deklarują uwierzytelnienie sesją", () => {
    // To jedyne miejsce, w którym handler dostaje `userId` i `claims`. Bez tego
    // middleware kontekst byłby pusty, a nie „anonimowy” - czyli funkcja
    // działałaby na `undefined` jako identyfikatorze konta.
    expect(serverFnMiddlewareNames(deleteMyAccount)).toEqual(["requireSupabaseAuth"]);
    expect(serverFnMiddlewareNames(changeMyEmail)).toEqual(["requireSupabaseAuth"]);
  });

  it("obie funkcje są POST-em, nie GET-em", () => {
    // Nieodwracalna akcja pod GET-em daje się wywołać zwykłym odsyłaczem
    // albo prefetchem przeglądarki.
    expect(asServerFn(deleteMyAccount).method).toBe("POST");
    expect(asServerFn(changeMyEmail).method).toBe("POST");
  });
});

describe("deleteMyAccount - tożsamość wołającego", () => {
  it("walidator ZDEJMUJE z wejścia identyfikator konta i adres e-mail", () => {
    // Gdyby schemat przepuszczał nadmiarowe pola, dopisanie do handlera
    // `data.userId` byłoby jedną linijką od katastrofy. Zod zostawia tylko
    // hasło, więc cudzy identyfikator NIE MA JAK dojechać do handlera.
    const parsed = validateServerFnInput(deleteMyAccount, {
      password: PASSWORD,
      userId: VICTIM_ID,
      email: VICTIM_EMAIL,
    });
    expect(keysOf(parsed)).toEqual(["password"]);
  });

  it("podszycie się pod cudze konto NIE przechodzi - kasowane jest konto z sesji", async () => {
    await callServerFn(
      deleteMyAccount,
      { password: PASSWORD, userId: VICTIM_ID, email: VICTIM_EMAIL },
      ctx(),
    );

    // Wszystkie trzy nieodwracalne kroki dotyczą konta z tokenu.
    expect(h.closeBilling).toHaveBeenCalledWith(OWNER_ID, OWNER_EMAIL);
    expect(h.retain).toHaveBeenCalledWith(OWNER_ID);
    expect(h.deleteUser).toHaveBeenCalledWith(OWNER_ID);
    // I nigdzie - w żadnym argumencie - nie pojawia się konto ofiary.
    expect(everyRecordedArgument()).not.toContain(VICTIM_ID);
    expect(everyRecordedArgument()).not.toContain(VICTIM_EMAIL);
  });

  it("re-uwierzytelnienie idzie na adres z TOKENU, nie na adres z wejścia", async () => {
    await callServerFn(deleteMyAccount, { password: PASSWORD, email: VICTIM_EMAIL }, ctx());

    expect(h.signIn).toHaveBeenCalledWith({ email: OWNER_EMAIL, password: PASSWORD });
  });

  it("kasowany jest identyfikator z kontekstu, bez kontroli krzyżowej z claims.sub", async () => {
    // ŚWIADOMY OPIS RZECZYWISTOŚCI, nie życzenie: handler czyta `userId`
    // i `claims.email` z tego samego kontekstu, ale ich nie porównuje.
    // W produkcji `requireSupabaseAuth` ustawia oba z JEDNEGO zestawu
    // zweryfikowanych claimów, więc rozjechać się nie mogą. Test przypina tę
    // zależność, żeby ewentualna przyszła zmiana middleware nie przeszła cicho.
    await callServerFn(
      deleteMyAccount,
      { password: PASSWORD },
      ctx({ userId: VICTIM_ID, claims: { sub: OWNER_ID, email: OWNER_EMAIL } }),
    );

    expect(h.signIn).toHaveBeenCalledWith({ email: OWNER_EMAIL, password: PASSWORD });
    expect(h.deleteUser).toHaveBeenCalledWith(VICTIM_ID);
  });
});

describe("deleteMyAccount - re-uwierzytelnienie zamyka drogę przed pierwszym zapisem", () => {
  it("brak adresu w tokenie przerywa PRZED anulowaniem subskrypcji", async () => {
    const error = await rejection(
      callServerFn(deleteMyAccount, { password: PASSWORD }, ctx({ claims: { sub: OWNER_ID } })),
    );

    expect(error.message).toBe("Nie można potwierdzić tożsamości konta.");
    expect(h.steps).toEqual([]);
  });

  it("adres w tokenie, który nie jest napisem, jest traktowany jak jego brak", async () => {
    // `claims` to worek JSON-a z tokenu. Liczba w polu `email` nie jest
    // adresem, na który da się zalogować - traktowanie jej jak adresu
    // skończyłoby się próbą re-uwierzytelnienia na `123`.
    const error = await rejection(
      callServerFn(
        deleteMyAccount,
        { password: PASSWORD },
        ctx({ claims: { sub: OWNER_ID, email: 123 } }),
      ),
    );

    expect(error.message).toBe("Nie można potwierdzić tożsamości konta.");
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it("pusty adres w tokenie też przerywa (napis pusty to nie tożsamość)", async () => {
    const error = await rejection(
      callServerFn(
        deleteMyAccount,
        { password: PASSWORD },
        ctx({ claims: { sub: OWNER_ID, email: "" } }),
      ),
    );

    expect(error.message).toBe("Nie można potwierdzić tożsamości konta.");
    expect(h.steps).toEqual([]);
  });

  it("złe hasło zatrzymuje usuwanie na kroku pierwszym", async () => {
    h.signIn.mockResolvedValue({ data: { user: null }, error: new Error("Invalid credentials") });

    const error = await rejection(callServerFn(deleteMyAccount, { password: "zle" }, ctx()));

    expect(error.message).toBe("Nieprawidłowe hasło.");
    // Kluczowe: sama próba re-uwierzytelnienia była, ale NIC dalej.
    expect(h.steps).toEqual(["reauth"]);
  });

  it("RODO: komunikat złego hasła nie niesie ani hasła, ani adresu", async () => {
    // Ten napis trafia do logu serwera i na ekran. Hasło w logu to naruszenie
    // niezależne od tego, czy było poprawne; adres to dana osobowa.
    h.signIn.mockResolvedValue({ data: { user: null }, error: new Error("Invalid credentials") });

    const error = await rejection(callServerFn(deleteMyAccount, { password: PASSWORD }, ctx()));

    expect(error.message).not.toContain(PASSWORD);
    expect(error.message).not.toContain(OWNER_EMAIL);
  });
});

describe("deleteMyAccount - kolejność kroków i awaria kroku N", () => {
  it("szczęśliwa ścieżka wykonuje kroki w umówionej kolejności", async () => {
    await callServerFn(deleteMyAccount, { password: PASSWORD }, ctx());

    // Odwrócenie tej listy to konkretna szkoda: „deleteUser” przed
    // „retainEvidence” zabiera dowody księgowe (nie ma już czego anonimizować),
    // a przed „closeBilling” zostawia u operatora płatną subskrypcję bez konta.
    expect(h.steps).toEqual(["reauth", "closeBilling", "retainEvidence", "deleteUser"]);
  });

  it("zwraca liczby zachowanych dowodów - obowiązek informacyjny liczbą, nie ogólnikiem", async () => {
    const result = await callServerFn(deleteMyAccount, { password: PASSWORD }, ctx());

    expect(result).toEqual({
      ok: true,
      retainedEvidence: 5,
      retainedOrders: 2,
      retainedPurchases: 3,
    });
  });

  it("awaria anulowania subskrypcji zostawia konto NIETKNIĘTE", async () => {
    // Nie da się odtworzyć konta po `deleteUser`, więc jeśli operator odmówił
    // anulowania, jedyne bezpieczne wyjście to nie kasować niczego.
    h.closeBilling.mockRejectedValue(new Error("account closure: subscription cancel failed"));

    const error = await rejection(callServerFn(deleteMyAccount, { password: PASSWORD }, ctx()));

    expect(error.message).toContain("subscription cancel failed");
    expect(h.steps).toEqual(["reauth", "closeBilling"]);
    expect(h.retain).not.toHaveBeenCalled();
    expect(h.deleteUser).not.toHaveBeenCalled();
  });

  it("awaria anonimizacji dowodów zostawia konto - dowodów nie da się odtworzyć", async () => {
    h.retain.mockRejectedValue(new Error("accounting retention: evidence anonymisation failed"));

    const error = await rejection(callServerFn(deleteMyAccount, { password: PASSWORD }, ctx()));

    expect(error.message).toContain("evidence anonymisation failed");
    expect(h.steps).toEqual(["reauth", "closeBilling", "retainEvidence"]);
    expect(h.deleteUser).not.toHaveBeenCalled();
  });

  it("awaria ostatniego kroku: konto zostaje, ale subskrypcja i dowody są JUŻ ruszone", async () => {
    // ŚWIADOMY OPIS RZECZYWISTOŚCI. Kolejność jest celowa (najpierw pieniądze),
    // więc stan połowiczny po awarii `deleteUser` jest z założenia „bezpieczną
    // stroną”: lepiej żywe konto bez subskrypcji niż subskrypcja bez konta.
    // Test przypina ten stan, żeby przyszła zmiana kolejności nie przeszła
    // cicho - a to, czego w tym stanie brakuje, opisuje `it.fails` niżej.
    h.deleteUser.mockResolvedValue({
      data: { user: null },
      error: { message: "auth service unavailable" },
    });

    const error = await rejection(callServerFn(deleteMyAccount, { password: PASSWORD }, ctx()));

    expect(error.message).toBe("Nie udało się usunąć konta: auth service unavailable");
    expect(h.steps).toEqual(["reauth", "closeBilling", "retainEvidence", "deleteUser"]);
    expect(h.closeBilling).toHaveBeenCalledTimes(1);
    expect(h.retain).toHaveBeenCalledTimes(1);
  });

  // DEFEKT - src/lib/account.functions.ts:67-70.
  // CO: gdy `deleteUser` zwróci błąd, handler rzuca komunikat złożony wyłącznie
  // z „Nie udało się usunąć konta” i surowej treści błędu operatora auth.
  // Nie ma w nim ani słowa o tym, że kroki 2 i 3 zostały już wykonane
  // i są nieodwracalne: subskrypcja anulowana u operatora ZE SKUTKIEM
  // NATYCHMIASTOWYM, uprawnienia odebrane, a `user_purchases` /
  // `payment_orders` pozbawione powiązania z osobą.
  // KONSEKWENCJA DLA UŻYTKOWNIKA: czyta „nie udało się” i rozumie to jako
  // „nic się nie stało, konto jest jak było”. W rzeczywistości stracił
  // opłacony dostęp i powiązanie z własnymi zakupami, a konto dalej istnieje.
  // Nie ma też żadnego śladu tej sytuacji (brak logu, brak wpisu audytowego),
  // więc obsługa nie ma z czego jej odtworzyć.
  it.fails("DEFEKT: komunikat awarii nie mówi o już anulowanej subskrypcji", async () => {
    h.deleteUser.mockResolvedValue({
      data: { user: null },
      error: { message: "auth service unavailable" },
    });

    const error = await rejection(callServerFn(deleteMyAccount, { password: PASSWORD }, ctx()));

    expect(error.message).toMatch(/subskrypcj|anulowan/i);
  });
});

describe("deleteMyAccount - walidacja wejścia odcina zapytania do bazy", () => {
  it("puste hasło jest odrzucane przed jakimkolwiek krokiem", async () => {
    await expect(callServerFn(deleteMyAccount, { password: "" }, ctx())).rejects.toThrow();
    expect(h.steps).toEqual([]);
  });

  it("hasło dłuższe niż 200 znaków jest odrzucane (limit wejścia, nie bazy)", async () => {
    await expect(
      callServerFn(deleteMyAccount, { password: "x".repeat(201) }, ctx()),
    ).rejects.toThrow();
    expect(h.steps).toEqual([]);
  });

  it("brak pola hasła jest odrzucany", async () => {
    await expect(callServerFn(deleteMyAccount, {}, ctx())).rejects.toThrow();
    expect(h.steps).toEqual([]);
  });
});

describe("changeMyEmail - tożsamość wołającego", () => {
  it("walidator zostawia tylko nowy adres i hasło", () => {
    const parsed = validateServerFnInput(changeMyEmail, {
      email: NEW_EMAIL,
      password: PASSWORD,
      userId: VICTIM_ID,
    });
    expect(keysOf(parsed)).toEqual(["email", "password"]);
  });

  it("re-uwierzytelnia BIEŻĄCY adres z tokenu, a zmienia adres podany na wejściu", async () => {
    // Gdyby re-uwierzytelnienie szło na adres z wejścia, wystarczyłoby podać
    // własny adres i własne hasło, żeby przestawić adres CUDZEGO konta.
    const result = await callServerFn(
      changeMyEmail,
      { email: NEW_EMAIL, password: PASSWORD, userId: VICTIM_ID },
      ctx(),
    );

    expect(h.signIn).toHaveBeenCalledWith({ email: OWNER_EMAIL, password: PASSWORD });
    expect(h.updateUser).toHaveBeenCalledWith({ email: NEW_EMAIL });
    expect(result).toEqual({ ok: true });
    expect(everyRecordedArgument()).not.toContain(VICTIM_ID);
  });

  it("zmiana adresu nie dotyka rozliczeń ani klucza serwisowego", async () => {
    // Ta funkcja nie ma prawa kasować ani anonimizować czegokolwiek -
    // pomyłka w imporcie zrobiłaby z niej drugą ścieżkę usuwania konta.
    await callServerFn(changeMyEmail, { email: NEW_EMAIL, password: PASSWORD }, ctx());

    expect(h.steps).toEqual(["reauth", "updateUser"]);
    expect(h.closeBilling).not.toHaveBeenCalled();
    expect(h.deleteUser).not.toHaveBeenCalled();
  });
});

describe("changeMyEmail - ścieżki odmowy", () => {
  it("brak adresu w tokenie przerywa przed wysłaniem żądania zmiany", async () => {
    const error = await rejection(
      callServerFn(
        changeMyEmail,
        { email: NEW_EMAIL, password: PASSWORD },
        ctx({ claims: { sub: OWNER_ID } }),
      ),
    );

    expect(error.message).toBe("Nie można potwierdzić tożsamości konta.");
    expect(h.steps).toEqual([]);
  });

  it("adres w tokenie, który nie jest napisem, jest traktowany jak jego brak", async () => {
    const error = await rejection(
      callServerFn(
        changeMyEmail,
        { email: NEW_EMAIL, password: PASSWORD },
        ctx({ claims: { sub: OWNER_ID, email: null } }),
      ),
    );

    expect(error.message).toBe("Nie można potwierdzić tożsamości konta.");
    expect(h.updateUser).not.toHaveBeenCalled();
  });

  it("złe hasło zatrzymuje zmianę adresu logowania", async () => {
    h.signIn.mockResolvedValue({ data: { user: null }, error: new Error("Invalid credentials") });

    const error = await rejection(
      callServerFn(changeMyEmail, { email: NEW_EMAIL, password: "zle" }, ctx()),
    );

    expect(error.message).toBe("Nieprawidłowe hasło.");
    expect(h.steps).toEqual(["reauth"]);
  });

  it("odmowa operatora wraca jako jego własny komunikat, bez doklejania adresu", async () => {
    // ŚWIADOMY OPIS RZECZYWISTOŚCI: komunikat dostawcy leci do UI dosłownie.
    // Bywa on informacyjny („adres już zajęty”), czyli zalogowany użytkownik
    // może nim sprawdzać, czy dany adres istnieje w systemie. To jednak
    // decyzja o treści komunikatu, nie błąd tego handlera - handler ma
    // OBOWIĄZEK nie dokładać do niego danych osobowych, i tego tu dowodzimy.
    h.updateUser.mockResolvedValue({
      data: { user: null },
      error: { message: "A user with this email address has already been registered" },
    });

    const error = await rejection(
      callServerFn(changeMyEmail, { email: NEW_EMAIL, password: PASSWORD }, ctx()),
    );

    expect(error.message).toBe("A user with this email address has already been registered");
    expect(error.message).not.toContain(NEW_EMAIL);
    expect(error.message).not.toContain(PASSWORD);
  });
});

describe("changeMyEmail - walidacja wejścia", () => {
  it.each([
    ["adres bez małpy", { email: "nie-adres", password: PASSWORD }],
    ["adres pusty", { email: "", password: PASSWORD }],
    [
      "adres dłuższy niż 320 znaków",
      { email: `${"a".repeat(320)}@example.com`, password: PASSWORD },
    ],
    ["brak hasła", { email: NEW_EMAIL, password: "" }],
    ["hasło dłuższe niż 200 znaków", { email: NEW_EMAIL, password: "x".repeat(201) }],
    ["puste wejście", {}],
  ])("odrzuca wejście: %s - bez żadnego żądania do Supabase", async (_label, input) => {
    await expect(callServerFn(changeMyEmail, input, ctx())).rejects.toThrow();
    expect(h.steps).toEqual([]);
  });
});

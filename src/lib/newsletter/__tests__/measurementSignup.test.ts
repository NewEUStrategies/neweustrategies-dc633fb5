// Deklaracja osobnego pola pomiaru przy zapisie -> prośba do właściciela
// skrzynki (I9d-Y2b): pomocnicy wspólni dla `newsletter.functions.ts`
// i `contact.functions.ts`.
//
// Co tu ma się nie zepsuć:
//   1. ponowne zapisy nie rozdmuchują `consents` (stara deklaracja znika,
//      reszta pozycji zostaje w tej samej kolejności i bez zmian);
//   2. prośba NIGDY nie psuje formularza: błąd, wyjątek, brak id i obcy
//      kształt wyniku dają `null` i wpis w logu bez adresu e-mail;
//   3. nazwa RPC i argument są stałe (bramka kontraktu TS <-> SQL).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MEASUREMENT_SIGNUP_REQUEST_RESULTS,
  measurementSignupRequestResultOf,
  requestMeasurementAfterSignup,
  withMeasurementDeclaration,
} from "../measurementSignup.server";

const SUB = "5a5a5a5a-0000-4000-8000-00000000a001";
const DECLARATION = { key: "email_measurement_declared", text: "t", received_at: "now" };

let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  warnSpy.mockRestore();
});

describe("withMeasurementDeclaration", () => {
  it("zastępuje WSZYSTKIE wcześniejsze deklaracje (także inny zapis klucza), reszta bez zmian", () => {
    const current = [
      { key: "newsletter", text: "a" },
      { key: " Email_Measurement_Declared ", text: "stara 1" },
      "pozycja-napis",
      { key: "email_measurement_declared", text: "stara 2" },
      { key: "rodo", text: "b" },
    ];
    expect(withMeasurementDeclaration(current, DECLARATION)).toEqual([
      { key: "newsletter", text: "a" },
      "pozycja-napis",
      { key: "rodo", text: "b" },
      DECLARATION,
    ]);
    // Wejście bez mutacji.
    expect(current).toHaveLength(5);
  });

  it("`consents` spoza tablicy (NULL, obiekt) -> sama nowa deklaracja", () => {
    expect(withMeasurementDeclaration(null, DECLARATION)).toEqual([DECLARATION]);
    expect(withMeasurementDeclaration({ key: "x" }, DECLARATION)).toEqual([DECLARATION]);
  });
});

describe("requestMeasurementAfterSignup", () => {
  function client(result: unknown) {
    return { rpc: vi.fn(async () => result) };
  }

  it("woła `newsletter_measurement_request_signup` z id subskrybenta i oddaje wynik", async () => {
    const admin = client({ data: { result: "requested" }, error: null });
    expect(await requestMeasurementAfterSignup(admin, SUB, "newsletter")).toBe("requested");
    expect(admin.rpc).toHaveBeenCalledWith("newsletter_measurement_request_signup", {
      p_subscriber: SUB,
    });
  });

  it("brak id: bez RPC, `null` i log", async () => {
    const admin = client({ data: null, error: null });
    expect(await requestMeasurementAfterSignup(admin, undefined, "contact")).toBeNull();
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "[contact] measurement request skipped: subscriber id missing",
    );
  });

  it("błąd, wyjątek i obcy kształt -> `null` (formularz działa dalej)", async () => {
    expect(
      await requestMeasurementAfterSignup(
        client({ data: null, error: { message: "boom" } }),
        SUB,
        "newsletter",
      ),
    ).toBeNull();
    const throwing = { rpc: vi.fn(async () => Promise.reject(new Error("reset"))) };
    expect(await requestMeasurementAfterSignup(throwing, SUB, "newsletter")).toBeNull();
    expect(
      await requestMeasurementAfterSignup(
        client({ data: { result: "maybe" }, error: null }),
        SUB,
        "newsletter",
      ),
    ).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(3);
  });

  it("`none` przy deklaracji przyjętej przez TS = ostrzeżenie o rozjeździe TS <-> SQL", async () => {
    expect(
      await requestMeasurementAfterSignup(
        client({ data: { result: "none" }, error: null }),
        SUB,
        "newsletter",
      ),
    ).toBe("none");
    expect(warnSpy).toHaveBeenCalledWith(
      "[newsletter] measurement declaration not recognised by the database",
    );
  });

  it("parser wyniku: znane wyniki przechodzą, reszta -> `null`", () => {
    for (const result of MEASUREMENT_SIGNUP_REQUEST_RESULTS) {
      expect(measurementSignupRequestResultOf({ result })).toBe(result);
    }
    for (const data of [null, [], "requested", { result: "REQUESTED" }, {}]) {
      expect(measurementSignupRequestResultOf(data)).toBeNull();
    }
  });
});

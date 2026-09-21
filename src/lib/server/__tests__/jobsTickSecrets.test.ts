// STAŁOCZASOWE PORÓWNANIE SEKRETU CRONA: `secretsEqual` z `jobsTick.server.ts`.
//
// PO CO TEN PLIK ISTNIEJE. `secretsEqual` jest JEDYNĄ bramką publicznej,
// nieuwierzytelnionej trasy `POST /api/public/jobs-tick`, za którą stoi cała
// praca wychodząca aplikacji: kampanie newslettera, dren kolejek pocztowych,
// push, digesty, przypomnienia. Czyli prawdziwa poczta, prawdziwe pieniądze
// i prawdziwe RODO. Helper jest napisany poprawnie (`node:crypto`
// `timingSafeEqual` po równości długości) i do 04.09.2026 miał ZERO wykonań
// w całej suicie: wszystkie CZTERY pliki, które wołają ten moduł, atrapują go
// (`-jobs-tick.test.ts`, `-preview-secrets.test.ts`, `-preview-render.test.ts`,
// `queue/-process.test.ts`).
//
// Ten brak jest nazwany wprost w nagłówku `-jobs-tick.test.ts` (zastrzeżenie
// Z3): tamten plik zamyka PREMISĘ swojego dowodu statycznie (sprawdza, że
// helper ma strażnik długości przed `timingSafeEqual`, czyli że atrapa go nie
// upiększa) i kończy zdaniem „Brakujący dowód: test jednostkowy przy samym
// helperze". To jest ten plik.
//
// DLACZEGO NIE DA SIĘ TEGO DOŁOŻYĆ W TEŚCIE TRASY. `jobsTick.server` ciągnie
// GÓRNYMI importami dren kolejek pocztowych, kampanie newslettera, dyspozytor
// powiadomień i log przebiegów. `importActual` w teście trasy zamieniłby go
// w test całej maszyny wysyłkowej. Tutaj atrapujemy DOKŁADNIE te cztery
// granice i nic więcej - `secretsEqual` jest PRAWDZIWE, `@/lib/jobs/scheduler`
// (moduł bez ani jednego importu) też.
//
// CO JEST PRZEDMIOTEM DOWODU. Jedna linia:
//
//     return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
//
// Strażnik długości NIE jest optymalizacją - `timingSafeEqual` RZUCA
// `RangeError` na buforach różnej długości, więc ten `&&` jest jedyną rzeczą,
// która stoi między nami a wyjątkiem 500 na publicznej trasie. Sekret innej
// długości MUSI dać 401, nie 500. Dowodzimy tego razem z premisą: test
// pokazuje, że `timingSafeEqual` faktycznie rzuca, więc strażnik jest nośny,
// a nie ozdobny.
//
// CZEGO TEN PLIK NIE UDAJE. Nie jest testem STAŁOCZASOWOŚCI - pomiar czasu
// w środowisku testowym z JIT-em i GC daje szum, nie dowód, a test oparty na
// zegarze byłby chwiejny i fałszywie uspokajający. Stałoczasowość jest tu
// dowodzona STRUKTURALNIE (użycie `timingSafeEqual` z `node:crypto` zamiast
// `===`) - i tak samo robi to zastrzeżenie w `-jobs-tick.test.ts`.
//
// SEKRETY. Generowane losowo w teście (`node:crypto`), nigdy nie logowane
// i nigdy nie zapisywane. Wariant „zły sekret" ma DOKŁADNIE tę samą długość
// co dobry, żeby odmowa nie mogła brać się z długości bufora.
import { describe, expect, it, vi } from "vitest";
import { randomBytes, timingSafeEqual } from "node:crypto";

// --- atrapy GÓRNYCH importów modułu ticku -----------------------------------
// Nie są przedmiotem dowodu; są warunkiem, żeby dało się zaimportować moduł,
// w którym mieszka helper. Każda z nich ma własny test przy swoim module.

vi.mock("@/lib/email/queueDrain.server", () => ({
  drainEmailQueues: vi.fn(async () => ({ claimed: 0, sent: 0, failed: 0 })),
}));
vi.mock("@/lib/newsletter-campaigns.functions", () => ({
  tickNewsletterCampaigns: vi.fn(async () => ({ fired: 0, continued: 0, sent: 0 })),
}));
vi.mock("@/lib/notifications/dispatch.server", () => ({
  processDigests: vi.fn(async () => ({ claimed: 0, sent: 0 })),
  processPushJobs: vi.fn(async () => ({ claimed: 0, sent: 0 })),
  runCrmTaskReminders: vi.fn(async () => 0),
  runEventReminders: vi.fn(async () => 0),
}));
vi.mock("@/lib/server/jobScheduler.server", () => ({
  recordJobRun: vi.fn(async () => undefined),
}));

import { secretsEqual } from "../jobsTick.server";

/** Sekret w kształcie, w jakim żyje w `job_runner_settings.secret`. */
function secret(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

/**
 * Napis tej samej DŁUGOŚCI co wzorzec, ale o innej treści. Różnica długości
 * jest osobną ścieżką (niżej) - tutaj chodzi o to, żeby odmowa brała się
 * z TREŚCI, a nie z rozmiaru bufora.
 */
function sameLengthDifferent(source: string): string {
  const flipped = source[0] === "0" ? "1" : "0";
  return flipped + source.slice(1);
}

describe("premisa: strażnik długości jest NOŚNY, nie ozdobny", () => {
  it("`timingSafeEqual` RZUCA na buforach różnej długości", () => {
    // Gdyby `node:crypto` tego nie robiło, warunek `bufA.length === bufB.length`
    // byłby martwym kodem, a cały dowód niżej - pustą ceremonią. Sprawdzamy
    // więc PRAWDĘ o zależności, a nie życzenie autora testu.
    expect(() => timingSafeEqual(Buffer.from("ab"), Buffer.from("abc"))).toThrow();
  });
});

describe("secretsEqual: równa długość, równa treść", () => {
  it("ten sam sekret daje `true`", async () => {
    const s = secret();
    await expect(secretsEqual(s, s)).resolves.toBe(true);
  });

  it("dwie NIEZALEŻNE kopie tej samej treści dają `true` (porównanie po wartości)", async () => {
    // `timingSafeEqual` porównuje bajty, nie tożsamość referencji - gdyby ktoś
    // podmienił to na `bufA === bufB`, ten przypadek by się zapalił.
    const s = secret();
    await expect(secretsEqual(String(s), `${s}`)).resolves.toBe(true);
  });

  it("dwa PUSTE napisy dają `true` - równe bufory zerowej długości", async () => {
    // Nie jest to zaproszenie do pustego sekretu: trasa odrzuca brak nagłówka
    // OSOBNO (`if (!provided) return 401`) PRZED wywołaniem helpera. Ten
    // przypadek przypina kontrakt samego helpera, żeby zmiana zachowania na
    // pustych wejściach była decyzją, nie wypadkiem.
    await expect(secretsEqual("", "")).resolves.toBe(true);
  });
});

describe("secretsEqual: równa długość, RÓŻNA treść", () => {
  it("różnica na PIERWSZYM bajcie daje `false`", async () => {
    const good = secret();
    const bad = sameLengthDifferent(good);
    expect(bad).toHaveLength(good.length);
    await expect(secretsEqual(bad, good)).resolves.toBe(false);
  });

  it("różnica na OSTATNIM bajcie daje `false` - brak wczesnego wyjścia", async () => {
    // Porównanie z wczesnym wyjściem (`===` albo pętla z `break`) też zwróciłoby
    // tu `false`, więc ten przypadek nie dowodzi stałoczasowości. Dowodzi
    // POPRAWNOŚCI na najtrudniejszej pozycji: sekret różniący się wyłącznie
    // ostatnim znakiem nie może przejść.
    const good = secret();
    const last = good[good.length - 1] === "0" ? "1" : "0";
    const bad = good.slice(0, -1) + last;
    expect(bad).toHaveLength(good.length);
    await expect(secretsEqual(bad, good)).resolves.toBe(false);
  });

  it("dwa niezależne losowe sekrety tej samej długości dają `false`", async () => {
    const a = secret();
    const b = secret();
    expect(a).toHaveLength(b.length);
    await expect(secretsEqual(a, b)).resolves.toBe(false);
  });
});

describe("secretsEqual: RÓŻNA długość - 401, a nie 500", () => {
  it("krótszy sekret daje `false` BEZ RZUTU", async () => {
    // To jest ta jedna gałąź, która stoi między nami a wyjątkiem 500 na
    // publicznej trasie. Bez `bufA.length === bufB.length` `timingSafeEqual`
    // rzuciłby `RangeError`, handler nie ma `try`, więc odpowiedzią byłoby 500
    // - czyli oracle dla atakującego („inna długość wygląda inaczej") plus
    // fałszywy alarm w monitoringu.
    const good = secret();
    await expect(secretsEqual(good.slice(0, 8), good)).resolves.toBe(false);
  });

  it("dłuższy sekret daje `false` BEZ RZUTU", async () => {
    const good = secret();
    await expect(secretsEqual(good + "deadbeef", good)).resolves.toBe(false);
  });

  it("pusty podany przy niepustym oczekiwanym daje `false` BEZ RZUTU", async () => {
    await expect(secretsEqual("", secret())).resolves.toBe(false);
  });

  it("niepusty podany przy PUSTYM oczekiwanym daje `false` BEZ RZUTU", async () => {
    // Realny stan: `job_runner_settings` rodzi się z `secret=''`. Trasa
    // bramkuje to też przez `enabled`, ale helper nie może na tym polegać.
    await expect(secretsEqual(secret(), "")).resolves.toBe(false);
  });
});

describe("secretsEqual: długość liczy się w BAJTACH, nie w znakach", () => {
  it("napisy o równej liczbie ZNAKÓW, ale różnej liczbie BAJTÓW dają `false` bez rzutu", async () => {
    // `Buffer.from("ą")` to DWA bajty w UTF-8. Gdyby strażnik porównywał
    // `a.length` (znaki) zamiast `bufA.length` (bajty), te dwa wejścia
    // przeszłyby strażnik i `timingSafeEqual` rzuciłby `RangeError` - czyli
    // 500 na publicznej trasie z wejścia, które atakujący w pełni kontroluje.
    await expect(secretsEqual("ą", "a")).resolves.toBe(false);
    await expect(secretsEqual("ąbc", "abcd")).resolves.toBe(false);
  });

  it("napisy o RÓWNEJ liczbie bajtów i różnej treści dają `false`", async () => {
    // "ą" = 2 bajty, "aa" = 2 bajty: strażnik przepuszcza, decyduje treść.
    await expect(secretsEqual("ą", "aa")).resolves.toBe(false);
  });

  it("identyczna treść wielobajtowa daje `true`", async () => {
    await expect(secretsEqual("zażółć-gęślą", "zażółć-gęślą")).resolves.toBe(true);
  });
});

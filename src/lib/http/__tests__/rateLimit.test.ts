import { describe, it, expect } from "vitest";
import {
  tickBucket,
  createRateLimiter,
  clientIpFromHeaders,
  rateLimitIpSubject,
} from "@/lib/http/rateLimit";

const OPTS = { capacity: 3, refillPerSec: 1 };

describe("tickBucket", () => {
  it("allows a fresh key and seeds it with capacity-1 tokens", () => {
    const { bucket, allowed } = tickBucket(undefined, 1_000, OPTS);
    expect(allowed).toBe(true);
    expect(bucket.tokens).toBe(2);
    expect(bucket.updatedAt).toBe(1_000);
  });

  it("denies once the bucket is empty within the same instant", () => {
    const b = tickBucket(undefined, 0, { capacity: 1, refillPerSec: 1 }).bucket; // tokens 0
    const second = tickBucket(b, 0, { capacity: 1, refillPerSec: 1 });
    expect(second.allowed).toBe(false);
    expect(second.bucket.tokens).toBeLessThan(1);
  });

  it("refills over elapsed time and allows again", () => {
    const empty = { tokens: 0, updatedAt: 0 };
    const after2s = tickBucket(empty, 2_000, OPTS); // +2 tokens
    expect(after2s.allowed).toBe(true);
    expect(after2s.bucket.tokens).toBeCloseTo(1, 5);
  });

  it("never refills above capacity", () => {
    const full = { tokens: 3, updatedAt: 0 };
    const later = tickBucket(full, 100_000, OPTS);
    expect(later.bucket.tokens).toBeLessThanOrEqual(OPTS.capacity);
  });
});

describe("createRateLimiter", () => {
  it("throttles a single key after its burst, independently per key", () => {
    const rl = createRateLimiter({ capacity: 2, refillPerSec: 0 });
    expect(rl.check("a", 0)).toBe(true);
    expect(rl.check("a", 0)).toBe(true);
    expect(rl.check("a", 0)).toBe(false); // burst exhausted, no refill
    expect(rl.check("b", 0)).toBe(true); // a different key has its own bucket
  });
});

describe("clientIpFromHeaders - kto naprawdę dzwoni", () => {
  // Za Cloudflare `x-forwarded-for` jest listą, do której KLIENT dopisuje
  // własny prefiks, a Cloudflare dokleja adres połączenia na KOŃCU. Pierwszy
  // wpis jest więc deklaracją klienta, nie adresem - kubełek po nim kluczowany
  // rotował się jednym nagłówkiem. Adresy z zakresów dokumentacyjnych
  // (RFC 5737), żeby żaden prawdziwy nie trafił do logów testu.
  const CF = "203.0.113.7";
  const REAL = "198.51.100.2";
  const KLAMSTWO_KLIENTA = "1.2.3.4";
  const OGON = "203.0.113.9";

  it("`cf-connecting-ip` WYGRYWA z `x-forwarded-for` niosącym inny adres", () => {
    const h = new Headers({
      "cf-connecting-ip": CF,
      "x-forwarded-for": `${KLAMSTWO_KLIENTA}, 10.0.0.1`,
    });
    expect(clientIpFromHeaders(h)).toBe(CF);
  });

  it("sam `x-forwarded-for` daje OSTATNI wpis, bo tylko ogon pochodzi od proxy", () => {
    const h = new Headers({ "x-forwarded-for": `${KLAMSTWO_KLIENTA}, ${OGON}` });
    expect(clientIpFromHeaders(h)).toBe(OGON);
  });

  it("rotacja prefiksu XFF NIE zmienia kubełka, dopóki ogon jest ten sam", () => {
    // To jest cały sens poprawki: atakujący dopisuje dowolny prefiks, a podmiot
    // limitu zostaje bez zmian.
    const a = clientIpFromHeaders(new Headers({ "x-forwarded-for": `9.9.9.9, ${OGON}` }));
    const b = clientIpFromHeaders(new Headers({ "x-forwarded-for": `8.8.8.8, ${OGON}` }));
    expect(a).toBe(b);
    expect(a).toBe(OGON);
  });

  it("`x-real-ip` wchodzi, gdy nie ma Cloudflare, i bije `x-forwarded-for`", () => {
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": REAL }))).toBe(REAL);
    expect(
      clientIpFromHeaders(new Headers({ "x-real-ip": REAL, "x-forwarded-for": KLAMSTWO_KLIENTA })),
    ).toBe(REAL);
  });

  it("puste i białoznakowe wpisy są odrzucane na KAŻDYM kroku", () => {
    // `x-forwarded-for: " "` dawało wcześniej pusty string udający adres -
    // a ten schodził dalej jako „brak adresu" i znosił kubełek IP w całości.
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": " " }))).toBe("unknown");
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": " , , " }))).toBe("unknown");
    expect(clientIpFromHeaders(new Headers({ "cf-connecting-ip": "   " }))).toBe("unknown");
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "  " }))).toBe("unknown");
  });

  it("białe znaki wokół wybranego wpisu są obcinane", () => {
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": `10.0.0.1 ,  ${OGON}  ` }))).toBe(
      OGON,
    );
  });

  it("bez żadnego nagłówka oddaje stałą, nigdy pusty string", () => {
    const ip = clientIpFromHeaders(new Headers());
    expect(ip).toBe("unknown");
    expect(ip).not.toBe("");
  });

  it("puste XFF schodzi na `x-real-ip`, a nie udaje adresu", () => {
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": " ", "x-real-ip": REAL }))).toBe(
      REAL,
    );
  });
});

describe("rateLimitIpSubject - cienki alias, nie druga precedencja", () => {
  it("oddaje DOKŁADNIE to samo, co `clientIpFromHeaders`", () => {
    const przypadki = [
      new Headers({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4" }),
      new Headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" }),
      new Headers({ "x-real-ip": "198.51.100.2" }),
      new Headers({ "x-forwarded-for": " " }),
      new Headers(),
    ];
    for (const h of przypadki) {
      expect(rateLimitIpSubject(h)).toBe(clientIpFromHeaders(h));
    }
  });

  it("NIGDY nie zwraca wartości pustej - „unknown” jest legalnym WSPÓLNYM kubełkiem", () => {
    expect(rateLimitIpSubject(new Headers())).toBe("unknown");
    expect(rateLimitIpSubject(new Headers({ "x-forwarded-for": " " }))).toBe("unknown");
    expect(rateLimitIpSubject(new Headers({ "x-forwarded-for": " " }))).not.toBe("");
  });
});

// Test bramki „kto dzwoni ma jedną definicję".
//
// KAŻDY PRZYPADEK ODWZOROWUJE REALNY KSZTAŁT Z REPOZYTORIUM - plik, z którego
// pochodzi, stoi w komentarzu. Przypadek syntetyczny dowiódłby tylko, że
// wyrażenie działa na wymyślonym wejściu, a bramka i tak zgubiłaby zapis
// rozbity na kilka linii, bo dokładnie tak wyglądał on w `contact.functions.ts`
// i `impersonation.functions.ts`.
import { describe, expect, it } from "vitest";
import {
  CANONICAL_MODULE,
  CLIENT_IP_ALLOWLIST,
  clientIpSourceFailed,
  isScannable,
  renderClientIpSourceReport,
  scanClientIpSource,
  scanSource,
  type ClientIpAllowEntry,
  type ScannedSource,
} from "../clientIpSource";

function source(file: string, ...lines: string[]): ScannedSource {
  return { file, source: lines.join("\n") };
}

const NONE: readonly ClientIpAllowEntry[] = [];

function scan(src: ScannedSource, allow: readonly ClientIpAllowEntry[] = NONE) {
  return scanClientIpSource([src], allow);
}

describe("isScannable", () => {
  it("bierze produkcyjne .ts/.tsx z src/, pomija kanoniczny moduł i testy", () => {
    expect(isScannable("src/lib/contact.functions.ts")).toBe(true);
    expect(isScannable("src/routes/api/public/related-click.ts")).toBe(true);
    expect(isScannable("src/components/Foo.tsx")).toBe(true);

    // Jedyne miejsce, w którym nazwa nagłówka WOLNO stać - to jest definicja.
    expect(isScannable(CANONICAL_MODULE)).toBe(false);
    // Test MUSI móc ustawić nagłówek, żeby udowodnić, który wpis bierze kod.
    expect(isScannable("src/lib/http/__tests__/rateLimit.test.ts")).toBe(false);
    expect(isScannable("src/routes/api/public/-fx-rate.test.ts")).toBe(false);
    // Bramka i jej własny test cytują nazwę z konieczności.
    expect(isScannable("src/lib/ci/clientIpSource.ts")).toBe(false);
    expect(isScannable("src/lib/ci/__tests__/clientIpSource.test.ts")).toBe(false);
    // Poza `src/` i poza TypeScriptem bramka nie sięga.
    expect(isScannable("e2e/boot.spec.ts")).toBe(false);
    expect(isScannable("src/styles.css")).toBe(false);
  });
});

describe("wykrywanie odczytu", () => {
  it("1. kształt SPRZED poprawki z `contact.functions.ts:295-297` OBLEWA", () => {
    const src = source(
      "src/lib/contact.functions.ts",
      "const req = getRequest();",
      'const fwd = req.headers.get("x-forwarded-for");',
      'const fwdFirst = fwd ? (fwd.split(",")[0]?.trim() ?? null) : null;',
      'clientIp = req.headers.get("cf-connecting-ip") ?? fwdFirst ?? req.headers.get("x-real-ip");',
    );
    const report = scan(src);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].line).toBe(2);
    expect(report.violations[0].file).toBe("src/lib/contact.functions.ts");
  });

  it("2. zapis rozbity na kilka linii (kształt `experiment-event.ts:33-37`) OBLEWA", () => {
    const src = source(
      "src/routes/api/public/experiment-event.ts",
      "function viewerHashFrom(req: Request): string {",
      "  const ip =",
      '    req.headers.get("cf-connecting-ip") ??',
      '    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??',
      '    req.headers.get("x-real-ip") ??',
      '    "0.0.0.0";',
      "}",
    );
    expect(scan(src).violations).toHaveLength(1);
  });

  it("3. kształt PO poprawce (`rateLimitIpSubject`) przechodzi", () => {
    const src = source(
      "src/lib/contact.functions.ts",
      'import { rateLimitIpSubject } from "@/lib/http/rateLimit";',
      "const subject = rateLimitIpSubject(req.headers);",
      'clientIp = subject === "unknown" ? null : subject;',
    );
    const report = scan(src);
    expect(report.violations).toEqual([]);
    expect(report.stats.scannedFiles).toBe(1);
  });

  it("4. wielkość liter nie ratuje - `X-Forwarded-For` też OBLEWA", () => {
    const src = source(
      "src/routes/api/public/track.ts",
      'const ip = req.headers.get("X-Forwarded-For");',
    );
    expect(scan(src).violations).toHaveLength(1);
  });

  it("5. plik bez nazwy nagłówka nie generuje pracy ani trafień", () => {
    const src = source(
      "src/lib/comments/guest.functions.ts",
      "const subject = rateLimitIpSubject(req.headers);",
    );
    expect(scanSource(src.file, src.source)).toEqual([]);
  });
});

describe("maskowanie komentarzy", () => {
  it("6. wzmianka WYŁĄCZNIE w komentarzu to dokumentacja, nie odczyt", () => {
    // Dokładnie ten kształt stoi w `newsletter.functions.ts:284` i w nagłówku
    // `rateSubject.server.ts` - bramka nie może wywracać się na zdaniu, które
    // wyjaśnia, czego pilnuje.
    const src = source(
      "src/lib/newsletter.functions.ts",
      "// Per-IP cap. Fail CLOSED on unknown IP (shared bucket) so stripping or",
      "// rotating the x-forwarded-for header cannot bypass the limit.",
      "const subject = rateLimitIpSubject(req.headers);",
    );
    expect(scan(src).violations).toEqual([]);
  });

  it("7. komentarz blokowy /** */ cytujący nazwę też nie liczy się", () => {
    const src = source(
      "src/lib/server/rateSubject.server.ts",
      "/**",
      " * `cf-connecting-ip` wygrywa z `x-forwarded-for`, bo za Cloudflare tylko",
      " * on jest nagłówkiem, którego klient nie podrobi.",
      " */",
      "export function requestRateSubject(headers: Headers): string {",
      '  return hashedRateSubject("ip", clientIpFromHeaders(headers));',
      "}",
    );
    expect(scan(src).violations).toEqual([]);
  });

  it("8. ZAKOMENTOWANY odczyt nie jest kodem - ale odkomentowany OBLEWA", () => {
    const zakomentowany = source(
      "src/lib/foo.server.ts",
      '// const ip = headers.get("x-forwarded-for");',
      "const ip = clientIpFromHeaders(headers);",
    );
    expect(scan(zakomentowany).violations).toEqual([]);

    const zywy = source("src/lib/foo.server.ts", 'const ip = headers.get("x-forwarded-for");');
    expect(scan(zywy).violations).toHaveLength(1);
  });
});

describe("allowlista i tryby awarii", () => {
  it("9. wpis imienny zwalnia plik i liczy się w statystyce", () => {
    const src = source(
      "src/lib/admin/impersonation.functions.ts",
      'const forwarded = headers.get("x-forwarded-for");',
    );
    const allow: ClientIpAllowEntry[] = [
      {
        file: "src/lib/admin/impersonation.functions.ts",
        reason: "Adres idzie wyłącznie do wiersza audytu - przepięcie w osobnym commicie.",
      },
    ];
    const report = scan(src, allow);
    expect(report.violations).toEqual([]);
    expect(report.stats.allowlisted).toBe(1);
    expect(clientIpSourceFailed(report)).toBe(false);
  });

  it("10. wpis, któremu nic już nie odpowiada, OBLEWA - allowlista ma się kurczyć", () => {
    const src = source("src/lib/foo.server.ts", "const ip = clientIpFromHeaders(headers);");
    const allow: ClientIpAllowEntry[] = [
      { file: "src/lib/skasowany.ts", reason: "Plik po refaktorze - nie ma już czego zwalniać." },
    ];
    const report = scan(src, allow);
    expect(report.violations).toEqual([]);
    expect(report.staleAllowlist).toEqual(["src/lib/skasowany.ts"]);
    expect(clientIpSourceFailed(report)).toBe(true);
  });

  it("11. pusty zestaw źródeł OBLEWA - bramka, która nic nie widzi, nie jest zielona", () => {
    const report = scanClientIpSource([], NONE);
    expect(report.stats.scannedFiles).toBe(0);
    expect(clientIpSourceFailed(report)).toBe(true);
    expect(renderClientIpSourceReport(report)).toContain("ANI JEDNEGO");
  });

  it("12. raport: zielony podaje zasięg, czerwony `plik:linia` i sposób naprawy", () => {
    const ok = source("src/lib/foo.server.ts", "const ip = clientIpFromHeaders(headers);");
    const zielony = renderClientIpSourceReport(scan(ok));
    expect(zielony).toContain("1 plików");
    expect(zielony).toContain(CANONICAL_MODULE);

    const zle = source("src/lib/zle.server.ts", 'const ip = headers.get("x-forwarded-for");');
    const czerwony = renderClientIpSourceReport(scan(zle));
    expect(czerwony).toContain("src/lib/zle.server.ts:1");
    expect(czerwony).toContain("clientIpFromHeaders");
  });
});

describe("13. allowlista repozytorium - każdy wpis z pisanym powodem", () => {
  // Bez tego można by wpisać plik bez uzasadnienia, a wtedy allowlista
  // przestaje być długiem do spłacenia i staje się cichym zwolnieniem.
  it("ma unikalne ścieżki i niepusty powód w każdym wpisie", () => {
    const sciezki = CLIENT_IP_ALLOWLIST.map((e) => e.file);
    expect(new Set(sciezki).size).toBe(sciezki.length);
    for (const entry of CLIENT_IP_ALLOWLIST) {
      expect(entry.reason.trim().length).toBeGreaterThan(40);
      expect(isScannable(entry.file)).toBe(true);
    }
  });
});

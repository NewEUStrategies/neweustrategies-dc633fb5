// Bramka defektu K6 (audyt 12.08, moduł Kluby): `fetchClubLinkPreview`
// i `embedClubQuery` stały otwarte dla anonima, a blokada SSRF podglądu linku
// opierała się na LITERALNEJ nazwie hosta - domena wskazująca na 127.0.0.1
// przechodziła przez nią bez zatrzymania.
//
// DWIE WARSTWY TESTU, BO DWIE RÓŻNE RZECZY MOGĄ SIĘ ZEPSUĆ:
//
//   1. DECYZJA (runtime, z zamockowanym resolverem). Podgląd oddaje teraz
//      rozstrzygnięcie wspólnej bramce `assertPublicHttpUrl`, więc ta bramka
//      musi odrzucać NAZWĘ rozwiązywaną na adres prywatny - a nie tylko literał
//      w adresie. Sąsiedni test bramki (`lib/http/__tests__/egressGuard.test.ts`)
//      celowo trzyma się ścieżek bez DNS-u; tu jest dołożona ścieżka Z DNS-em,
//      bo to ona zamyka obejście z tego defektu.
//   2. PODŁĄCZENIE (statycznie, z treści źródła). `createServerFn` nie da się
//      wywołać bez kontekstu żądania frameworka, a znikającym elementem jest tu
//      pojedyncze ogniwo deklaracji (`.middleware`, `failClosed`, delegacja do
//      bramki): jego usunięcie wraca do stanu przed naprawą, nie zmieniając
//      niczego, co widzi test wywołujący kod.
import { describe, expect, it, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dns = vi.hoisted(() => ({ answers: new Map<string, readonly string[]>() }));

vi.mock("node:dns/promises", () => ({
  default: {
    lookup: async (host: string) => {
      const found = dns.answers.get(host);
      if (!found) throw new Error(`ENOTFOUND ${host}`);
      return found.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    },
  },
}));

/** Ta sama droga, którą idzie `resolveClubPreviewTarget`: wynik albo `null`. */
async function previewTarget(raw: string): Promise<URL | null> {
  const { assertPublicHttpUrl } = await import("@/lib/http/egressGuard.server");
  try {
    return await assertPublicHttpUrl(raw);
  } catch {
    return null;
  }
}

describe("bramka egress podglądu linku klubowego", () => {
  beforeEach(() => {
    dns.answers.clear();
  });

  it("przepuszcza normalny adres https rozwiązywany na adres publiczny", async () => {
    dns.answers.set("example.com", ["93.184.216.34"]);
    const target = await previewTarget("https://example.com/analiza?utm=1");
    expect(target?.hostname).toBe("example.com");
    expect(target?.pathname).toBe("/analiza");
  });

  it("odrzuca NAZWĘ rozwiązywaną na loopback - to jest obejście listy nazw", async () => {
    dns.answers.set("podglad.napastnik.example", ["127.0.0.1"]);
    expect(await previewTarget("https://podglad.napastnik.example/")).toBeNull();
  });

  it("odrzuca nazwę wskazującą na metadane chmury", async () => {
    dns.answers.set("metadane.napastnik.example", ["169.254.169.254"]);
    expect(await previewTarget("https://metadane.napastnik.example/latest/meta-data/")).toBeNull();
  });

  it("odrzuca nazwę z choćby jedną odpowiedzią DNS w zakresie prywatnym", async () => {
    dns.answers.set("split.napastnik.example", ["93.184.216.34", "10.0.0.7"]);
    expect(await previewTarget("https://split.napastnik.example/")).toBeNull();
  });

  it("odrzuca literalne adresy prywatne, metadata i loopback bez pytania DNS-u", async () => {
    for (const raw of [
      "https://169.254.169.254/latest/meta-data/",
      "https://127.0.0.1/",
      "https://10.0.0.1/",
      "https://192.168.1.10/",
      "https://[::1]/",
    ]) {
      expect(await previewTarget(raw), raw).toBeNull();
    }
  });

  it("odrzuca localhost i sufiksy sieci wewnętrznej", async () => {
    for (const raw of ["https://localhost/", "https://svc.internal/", "https://db.local/"]) {
      expect(await previewTarget(raw), raw).toBeNull();
    }
  });

  it("odrzuca schematy poza https i wejście nieparsowalne", async () => {
    for (const raw of [
      "http://example.com/",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "nie-adres",
    ]) {
      expect(await previewTarget(raw), raw).toBeNull();
    }
  });

  it("przy awarii DNS-u nie zgaduje (fail-closed)", async () => {
    expect(await previewTarget("https://nieistnieje.example/")).toBeNull();
  });
});

const SOURCES: Readonly<Record<string, string>> = {
  "linkPreview.functions.ts": readFileSync(
    join(process.cwd(), "src/lib/clubs/linkPreview.functions.ts"),
    "utf8",
  ),
  "clubSemantic.functions.ts": readFileSync(
    join(process.cwd(), "src/lib/clubs/clubSemantic.functions.ts"),
    "utf8",
  ),
};

describe("server fn klubowe wychodzące na zewnątrz: konto + limit", () => {
  it("nie da się ich wywołać anonimowo - requireSupabaseAuth jest w łańcuchu", () => {
    for (const [file, source] of Object.entries(SOURCES)) {
      expect(source, `${file}: bez middleware anonim woła to wprost`).toMatch(
        /\.middleware\(\[requireSupabaseAuth\]\)/,
      );
    }
  });

  it("mają limit żądań per konto, fail-closed", () => {
    for (const [file, source] of Object.entries(SOURCES)) {
      expect(source, `${file}: brak kubełka per konto`).toMatch(
        /rateLimit\(\{[\s\S]*?subjectId:\s*context\.userId/,
      );
      expect(source, `${file}: awaria licznika nie może otwierać kosztu ani egressu`).toMatch(
        /failClosed:\s*true/,
      );
    }
  });

  it("podgląd linku idzie przez wspólną bramkę egress i nie podąża za przekierowaniem", () => {
    const source = SOURCES["linkPreview.functions.ts"];
    expect(source, "własna lista nazw hostów była do obejścia przez DNS").toContain(
      "assertPublicHttpUrl",
    );
    expect(source, "30x na publicznym adresie mógłby odbić na 169.254.169.254").toContain(
      'redirect: "manual"',
    );
  });
});

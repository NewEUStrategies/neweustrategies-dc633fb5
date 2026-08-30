// Landing cross-promo drugiej platformy NES (/quiz -> nes-quiz.com).
//
// Finding "head() zahardkodowany po polsku" wracał w trzech kolejnych wydaniach
// audytu, więc obok testu buildera stoi statyczna bramka na samą trasę: opis i OG
// muszą iść za językiem renderu, a canonical/og:url/hreflang muszą powstawać w
// `buildContentHead`, nie z ręcznie sklejonej listy meta.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { platformLandingJsonLd } from "@/lib/seo/jsonld";
import { QUIZ_PLATFORM_URL } from "@/lib/quiz/platform";

const ORIGIN = "https://neweuropeanstrategies.com";
const PLATFORM = "https://nes-quiz.com";
const QUIZ_ROUTE = readFileSync(join(process.cwd(), "src/routes/quiz.tsx"), "utf8");
const QUIZ_PLATFORM_SOURCE = readFileSync(join(process.cwd(), "src/lib/quiz/platform.ts"), "utf8");

const input = {
  origin: ORIGIN,
  path: "/quiz",
  name: "EuroChallenge Quiz",
  description: "Opis landingu quizu.",
  platformUrl: PLATFORM,
  platformName: "EuroChallenge Quiz",
};

describe("platformLandingJsonLd", () => {
  it("opisuje landing jako WebPage pod adresem wariantu językowego", () => {
    const pl = platformLandingJsonLd({ ...input, lang: "pl" });
    expect(pl["@type"]).toBe("WebPage");
    expect(pl.url).toBe(`${ORIGIN}/quiz`);
    expect(pl["@id"]).toBe(`${ORIGIN}/quiz#webpage`);
    expect(pl.inLanguage).toBe("pl");
    expect(pl.description).toBe("Opis landingu quizu.");

    const en = platformLandingJsonLd({ ...input, lang: "en" });
    expect(en.url).toBe(`${ORIGIN}/en/quiz`);
    expect(en.inLanguage).toBe("en");
  });

  it("kredytuje promowaną platformę przez mainEntity, nie przez canonical", () => {
    const graph = platformLandingJsonLd({ ...input, lang: "pl" });
    const app = graph.mainEntity as Record<string, unknown>;
    expect(app["@type"]).toBe("WebApplication");
    expect(app.url).toBe(PLATFORM);
    expect(app.applicationCategory).toBe("EducationalApplication");
    expect(app.publisher).toEqual({ "@id": `${ORIGIN}/#organization` });
    // Węzeł strony zostaje pod adresem NES - markup nie przenosi tożsamości
    // landingu na obcą domenę.
    expect(graph.url).toBe(`${ORIGIN}/quiz`);
    expect(graph.significantLink).toBe(PLATFORM);
  });

  it("wiąże stronę z encjami serwisu i degraduje bez origin", () => {
    const withOrigin = platformLandingJsonLd({ ...input, lang: "pl" });
    expect(withOrigin.isPartOf).toEqual({ "@id": `${ORIGIN}/#website` });
    expect(withOrigin.publisher).toEqual({ "@id": `${ORIGIN}/#organization` });

    // Render kliencki bez znanego origin: żadnych węzłów "/#website" wiszących
    // na pustym prefiksie, ale link do platformy zostaje absolutny.
    const noOrigin = platformLandingJsonLd({ ...input, origin: "", lang: "pl" });
    expect(noOrigin.isPartOf).toBeUndefined();
    expect(noOrigin.publisher).toBeUndefined();
    expect(noOrigin.url).toBe("/quiz");
    expect((noOrigin.mainEntity as Record<string, unknown>).url).toBe(PLATFORM);
  });

  it("pomija puste description", () => {
    const graph = platformLandingJsonLd({ ...input, description: "   ", lang: "pl" });
    expect("description" in graph).toBe(false);
  });
});

describe("trasa /quiz - kontrakt dwujęzycznego head()", () => {
  it("rozstrzyga język renderu przez activeLang", () => {
    expect(QUIZ_ROUTE).toMatch(/activeLang\(/);
  });

  it("buduje meta przez buildContentHead (canonical + og:url + hreflang)", () => {
    expect(QUIZ_ROUTE).toMatch(/buildContentHead\(/);
  });

  it("ma opis w obu językach", () => {
    expect(QUIZ_ROUTE).toContain("Sprawdź swoją wiedzę");
    expect(QUIZ_ROUTE).toContain("Test your knowledge");
  });

  it("nie zawiera już ręcznie sklejonych og:title/og:description", () => {
    expect(QUIZ_ROUTE).not.toMatch(/property:\s*"og:(title|description)"/);
  });

  it("emituje JSON-LD landingu z kredytem dla nes-quiz.com", () => {
    // Adres platformy NIE MIESZKA już w pliku trasy: rozdzielacz tras TanStack
    // przenosi komponent do osobnego kawałka i re-eksportuje wartości modułowe
    // używane po obu stronach granicy `head()`/komponent, przez co stała w
    // pliku trasy wywracała bundle kliencki („does not provide an export named
    // 'QUIZ_PLATFORM_URL'") i zostawiała serwis bez hydracji. Dlatego pilnujemy
    // tu OBU końców kontraktu - trasa musi karmić `platformLandingJsonLd`
    // stałą z `lib/quiz/platform`, a ta stała musi nadal wskazywać nes-quiz.com.
    expect(QUIZ_ROUTE).toMatch(/platformLandingJsonLd\(/);
    expect(QUIZ_ROUTE).toMatch(
      /import\s*\{[^}]*QUIZ_PLATFORM_URL[^}]*\}\s*from\s*"@\/lib\/quiz\/platform"/,
    );
    expect(QUIZ_ROUTE).toMatch(/platformUrl:\s*QUIZ_PLATFORM_URL/);
    expect(QUIZ_PLATFORM_URL).toBe(PLATFORM);
    expect(QUIZ_PLATFORM_SOURCE).toContain("https://nes-quiz.com");
  });
});

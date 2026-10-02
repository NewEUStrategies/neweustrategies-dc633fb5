// CO DOWODZI TEN PLIK: polityka STAREGO podpisu webhooka refresh-og-image
// (`src/lib/seo/ogRefreshLegacySignature.ts`) - czy podpis nad samym slugiem
// jeszcze przechodzi. Funkcja jest czysta (zegar i env podaje wołający), więc
// dowód jest tabelaryczny i NIE czyta zegara procesu: chwile liczone są od
// stałej wygaszenia, a nie od „teraz". Skutek polityki na trasie (401,
// komunikat, ślad w logu, nietknięta ścieżka ze znacznikiem czasu) dowodzi
// `src/routes/api/public/-hooks.refresh-og-image.test.ts` - tutaj go nie
// dublujemy.
//
// CZEGO ŚWIADOMIE NIE MA: testu-zapalnika „padnij po dacie wygaszenia" na
// PRAWDZIWYM zegarze. Taki test jest dokładnie tą klasą defektu, której pilnuje
// bramka `check:clock-freeze` (`src/lib/ci/clockFreeze.ts`): czerwień w dniu, w
// którym diff jest pusty. Nie jest też potrzebny - po terminie gałąź zamyka się
// SAMA (fail-closed), więc „zapomniana faza 2" nie zostawia już wiecznego
// tokenu, a jedynie martwy kod odmowy.
import { describe, expect, it } from "vitest";

import {
  OG_REFRESH_LEGACY_REJECTED_ERROR,
  OG_REFRESH_LEGACY_SIGNATURE_SUNSET_ISO,
  OG_REFRESH_LEGACY_SIGNATURE_SUNSET_MS,
  ogRefreshLegacyPolicy,
} from "@/lib/seo/ogRefreshLegacySignature";

const SUNSET = OG_REFRESH_LEGACY_SIGNATURE_SUNSET_MS;
const DOBA = 24 * 60 * 60 * 1000;

describe("stała wygaszenia", () => {
  it("to pełna północ UTC 1 stycznia 2027 - ISO i milisekundy opisują tę samą chwilę", () => {
    expect(SUNSET).toBe(Date.UTC(2027, 0, 1, 0, 0, 0, 0));
    expect(new Date(SUNSET).toISOString()).toBe(OG_REFRESH_LEGACY_SIGNATURE_SUNSET_ISO);
  });

  it("komunikat odmowy mówi wołającemu, CO zmienić (nagłówek i treść podpisu)", () => {
    expect(OG_REFRESH_LEGACY_REJECTED_ERROR).toContain("x-og-timestamp");
    expect(OG_REFRESH_LEGACY_REJECTED_ERROR).toContain("<timestamp>.<slug>");
  });
});

describe("ogRefreshLegacyPolicy - termin", () => {
  it.each([
    ["dzień przed terminem", SUNSET - DOBA],
    ["milisekunda przed terminem", SUNSET - 1],
  ])("%s: faza 1 trwa (accept)", (_opis, now) => {
    expect(ogRefreshLegacyPolicy(now, undefined)).toBe("accept");
  });

  it.each([
    ["dokładnie w chwili terminu", SUNSET],
    ["milisekunda po terminie", SUNSET + 1],
    ["rok po terminie", SUNSET + 365 * DOBA],
  ])("%s: stary podpis wygasł (sunset)", (_opis, now) => {
    expect(ogRefreshLegacyPolicy(now, undefined)).toBe("sunset");
  });

  it("zegar oddający NaN kończy się odmową, nie przepuszczeniem (fail-closed)", () => {
    expect(ogRefreshLegacyPolicy(Number.NaN, undefined)).toBe("sunset");
  });
});

describe("ogRefreshLegacyPolicy - wyłącznik w env", () => {
  it.each([["off"], ["OFF"], [" off "], ["0"], ["false"], ["False"]])(
    "wartość %j kończy fazę 1 PRZED terminem (disabled)",
    (value) => {
      expect(ogRefreshLegacyPolicy(SUNSET - DOBA, value)).toBe("disabled");
    },
  );

  it("wyłącznik ma pierwszeństwo także po terminie - powód odmowy w logu jest dokładny", () => {
    expect(ogRefreshLegacyPolicy(SUNSET + DOBA, "off")).toBe("disabled");
  });

  it.each([
    ["brak zmiennej", undefined],
    ["null", null],
    ["pusty napis", ""],
    ["on", "on"],
    ["1", "1"],
    ["literówka", "of"],
  ])("%s NIE wyłącza fazy 1 przed terminem (accept)", (_opis, value) => {
    expect(ogRefreshLegacyPolicy(SUNSET - DOBA, value)).toBe("accept");
  });

  it.each([["on"], ["1"], ["true"]])(
    "wartość %j NIE przedłuża fazy 1 po terminie - przedłużenia przez env nie ma",
    (value) => {
      expect(ogRefreshLegacyPolicy(SUNSET + 1, value)).toBe("sunset");
    },
  );
});

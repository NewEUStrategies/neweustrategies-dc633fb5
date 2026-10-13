// Klucz samoobsługi w adresach - kryterium audytu REG-17 „brak token= w logach
// dostępu".
//
// Klucz `manage_token` jest poświadczeniem: kto go zna, odwołuje zgłoszenie.
// Zapytanie (`?token=`) przeglądarka wysyła na serwer - trafia do logów
// dostępu serwera i CDN, do nagłówka `Referer`, a adres powrotu z kasy do
// dostawcy płatności. Fragment (`#token=`) nigdzie nie wychodzi. Ten plik
// pilnuje, że:
//   1. KAŻDY budowniczy odnośnika (mail potwierdzenia, przycisk „kopiuj",
//      ekran potwierdzenia, bilet gościa grupy) daje fragment;
//   2. w kodzie produkcyjnym nie ma ani jednego adresu strony zarządzania
//      składanego z kluczem w zapytaniu (skan statyczny `src/`);
//   3. adres powrotu z kasy jest BEZ klucza, a klucz czeka w `sessionStorage`
//      karty - tylko dla tego wydarzenia, 2 godziny, zużywany przy odczycie,
//      odporny na magazyn, który rzuca (tryb prywatny).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MANAGE_RETURN_STASH_KEY,
  MANAGE_RETURN_STASH_TTL_MS,
  manageFragment,
  manageLinkPath,
  managePagePath,
  readManageFragment,
  readTicketFragment,
  stashManageTokenForReturn,
  takeStashedManageToken,
  ticketLinkPath,
} from "@/lib/events/manageToken";
import { buildRegistrationNotice } from "@/lib/events/registrationNotify.server";

/** 24 bajty base64url - kształt `_event_new_qr_token()`. */
const TOKEN = "Ab3d_Xy9-Qw1zEr4TyU7iOp2AsDf1gHj";
const QR = "Zq7w_Er2-Ty5uIo8pAs1dFg4hJk6lZx0";
const NOW = Date.parse("2026-10-13T10:00:00.000Z");

describe("REG-17: odnośnik samoobsługi niesie klucz WE FRAGMENCIE", () => {
  it("`manageLinkPath` daje `#token=` i ani jednego `?`", () => {
    const path = manageLinkPath("kongres", TOKEN);
    expect(path).toBe(`/events/kongres/manage#token=${TOKEN}`);
    expect(path).not.toContain("?");
    // Część wysyłana na serwer (przed `#`) nie zawiera klucza.
    expect(path.split("#")[0]).toBe(managePagePath("kongres"));
    expect(path.split("#")[0]).not.toContain(TOKEN);
  });

  it("adres powrotu z kasy to sama strona - bez klucza", () => {
    expect(managePagePath("kongres 2026")).toBe("/events/kongres%202026/manage");
    expect(managePagePath("kongres")).not.toContain("token");
  });

  it.each(["received", "approved", "promoted"] as const)(
    "mail `%s`: przycisk prowadzi na fragment, a nie na zapytanie",
    (notice) => {
      const row = { status: "approved", event_slug: "kongres", event_title_pl: "Kongres" };
      const content = buildRegistrationNotice(notice, row, TOKEN);
      expect(content.ctaPath).toBe(`/events/kongres/manage#token=${TOKEN}`);
      expect(content.ctaPath).not.toContain("?token=");
    },
  );

  it("bilet z kodem QR jest bez zmian: `#t=…&m=…` (kod i klucz gościa we fragmencie)", () => {
    const path = ticketLinkPath("kongres", QR, TOKEN);
    expect(path).toBe(`/events/kongres/ticket#t=${QR}&m=${TOKEN}`);
    expect(readTicketFragment(path.split("#")[1])).toEqual({ qrToken: QR, manageToken: TOKEN });
  });

  it("`readManageFragment` czyta `#token=` i `token=`, odrzuca zły kształt i obce klucze", () => {
    expect(readManageFragment(`#${manageFragment(TOKEN)}`)).toBe(TOKEN);
    expect(readManageFragment(`token=${TOKEN}`)).toBe(TOKEN);
    expect(readManageFragment(`#token=%20${TOKEN}%20`)).toBe(TOKEN);
    expect(readManageFragment("#token=ABC")).toBeNull();
    expect(readManageFragment(`#t=${TOKEN}`)).toBeNull();
    expect(readManageFragment("")).toBeNull();
  });
});

/** Pliki `.ts`/`.tsx` kodu produkcyjnego w `src/` (bez testów i atrap testowych). */
function productionSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "test") continue;
      out.push(...productionSources(path));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.startsWith("-")) {
      out.push(path);
    }
  }
  return out;
}

/** Treść bez komentarzy liniowych i blokowych - liczy się KOD, nie opis historii. */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("REG-17: STATYCZNIE - w `src/` nie ma odnośnika samoobsługi z kluczem w zapytaniu", () => {
  const SRC = join(process.cwd(), "src");
  const files = productionSources(SRC);

  it("skan widzi kod produkcyjny (kontrola, że nie przechodzi na pustej liście)", () => {
    const names = files.map((file) => relative(SRC, file));
    expect(names).toContain("lib/events/manageToken.ts");
    expect(names).toContain("lib/events/registrationNotify.server.ts");
    expect(names).toContain("components/events/registration/RegistrationManagePanel.tsx");
  });

  it("żaden plik nie składa `/manage?token=` ani `/manage?…token` w kodzie", () => {
    const offenders = files.filter((file) => {
      const code = codeOnly(readFileSync(file, "utf8"));
      return /\/manage\?(?:[^"'`\s]*&)?token=/.test(code) || /manage\$\{[^}]*\}\?token=/.test(code);
    });
    expect(offenders.map((file) => relative(SRC, file))).toEqual([]);
  });

  it("budowniczy w `manageToken.ts` nie składa zapytania z kluczem", () => {
    const code = codeOnly(readFileSync(join(SRC, "lib/events/manageToken.ts"), "utf8"));
    expect(code).not.toContain("?token=");
    expect(code).not.toMatch(/\?\$\{/);
  });

  it("każdy plik, który mówi o stronie `/manage` z kluczem, korzysta z `manageLinkPath`", () => {
    // Odnośnik z kluczem ma JEDNO źródło. Ręcznie sklejony adres
    // `/events/${slug}/manage…` z kluczem obok omija regułę fragmentu.
    const handBuilt = files.filter((file) => {
      if (file.endsWith(join("lib", "events", "manageToken.ts"))) return false;
      const code = codeOnly(readFileSync(file, "utf8"));
      return /\/events\/\$\{[^}]+\}\/manage[^"'`]*\$\{/.test(code);
    });
    expect(handBuilt.map((file) => relative(SRC, file))).toEqual([]);
  });
});

describe("REG-17: klucz na powrót z kasy (`sessionStorage`, 2 h, to wydarzenie, jeden odczyt)", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it("odłożony klucz wraca dla tego samego wydarzenia - i znika po odczycie", () => {
    stashManageTokenForReturn("kongres", TOKEN, NOW);
    expect(window.sessionStorage.getItem(MANAGE_RETURN_STASH_KEY)).not.toBeNull();
    expect(takeStashedManageToken("kongres", NOW + 60_000)).toBe(TOKEN);
    expect(window.sessionStorage.getItem(MANAGE_RETURN_STASH_KEY)).toBeNull();
    expect(takeStashedManageToken("kongres", NOW + 60_000)).toBeNull();
  });

  it("inne wydarzenie nie dostaje klucza (i pozycja i tak znika)", () => {
    stashManageTokenForReturn("kongres", TOKEN, NOW);
    expect(takeStashedManageToken("forum", NOW)).toBeNull();
    expect(window.sessionStorage.getItem(MANAGE_RETURN_STASH_KEY)).toBeNull();
  });

  it("po 2 godzinach klucz przepada", () => {
    stashManageTokenForReturn("kongres", TOKEN, NOW);
    expect(takeStashedManageToken("kongres", NOW + MANAGE_RETURN_STASH_TTL_MS + 1)).toBeNull();
    stashManageTokenForReturn("kongres", TOKEN, NOW);
    expect(takeStashedManageToken("kongres", NOW + MANAGE_RETURN_STASH_TTL_MS)).toBe(TOKEN);
  });

  it("klucz o złym kształcie nie jest odkładany; pozycja zepsuta nie wraca", () => {
    stashManageTokenForReturn("kongres", "ABC", NOW);
    expect(window.sessionStorage.getItem(MANAGE_RETURN_STASH_KEY)).toBeNull();
    window.sessionStorage.setItem(MANAGE_RETURN_STASH_KEY, "{nie json");
    expect(takeStashedManageToken("kongres", NOW)).toBeNull();
    window.sessionStorage.setItem(
      MANAGE_RETURN_STASH_KEY,
      JSON.stringify({ slug: "kongres", token: "ABC", at: NOW }),
    );
    expect(takeStashedManageToken("kongres", NOW)).toBeNull();
  });

  it("magazyn, którego metody RZUCAJĄ (pełny, tryb prywatny), nie wywraca strony", () => {
    const throwing = {
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
      removeItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
    };
    vi.spyOn(window, "sessionStorage", "get").mockReturnValue(throwing as unknown as Storage);
    expect(() => stashManageTokenForReturn("kongres", TOKEN, NOW)).not.toThrow();
    expect(takeStashedManageToken("kongres", NOW)).toBeNull();
  });

  it("magazyn, którego SAM DOSTĘP rzuca (zablokowane dane witryny), nie wywraca strony", () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(() => stashManageTokenForReturn("kongres", TOKEN, NOW)).not.toThrow();
    expect(takeStashedManageToken("kongres", NOW)).toBeNull();
  });
});

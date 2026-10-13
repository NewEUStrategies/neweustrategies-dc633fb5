// Tabela „wynik -> ton, nagłówek, zdanie" (OPS-04, OPS-08, recenzja R2).
//
// CO PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. `denied_already_inside` i `code_superseded` pokazują „Nieznany wynik" -
//      operator nie odróżni odmowy ponownego wejścia ani wymienionego kodu od
//      awarii systemu.
//   2. PONOWNE WEJŚCIE (polityka `allow`) wygląda jak zwykłe „Wpuść" - nikt
//      nie widzi, że ten sam kod przeszedł już przez bramkę.
//   3. Kod zastąpiony bez powodu i chwili („wydano nowy identyfikator 10:01")
//      kończy się telefonem do biura.
import { describe, expect, it } from "vitest";

import i18n from "@/lib/i18n";
import { ensureI18n } from "@/lib/i18n-event-scanner";
import {
  scanContextHint,
  scanTitleKey,
  scanTone,
  supersededHint,
  type ScanVerdict,
} from "@/lib/events/scannerOutcomeView";

ensureI18n();

const when = (iso: string) => `[${iso}]`;
const verdict = (over: Partial<ScanVerdict> = {}): ScanVerdict => ({
  outcome: "granted",
  admit: true,
  reentry: false,
  ...over,
});

describe("ton wyniku - tabela, nie łańcuch warunków", () => {
  it.each([
    ["zgoda", verdict(), "granted"],
    ["PONOWNE wejście (allow) - osobny ton", verdict({ reentry: true }), "reentry"],
    ["powtórzone piknięcie", verdict({ outcome: "repeat" }), "warning"],
    [
      "powtórzenie przy ponownym wejściu nadal jest powtórzeniem",
      verdict({ outcome: "repeat", reentry: true }),
      "warning",
    ],
    ["kod zastąpiony - bursztyn", verdict({ outcome: "code_superseded", admit: false }), "warning"],
    ["nieznany kod", verdict({ outcome: "unknown_code", admit: false }), "warning"],
    ["kod z innego wydarzenia", verdict({ outcome: "wrong_event", admit: false }), "warning"],
    [
      "już w środku - czerwień",
      verdict({ outcome: "denied_already_inside", admit: false, reentry: true }),
      "denied",
    ],
    ["brak miejsc", verdict({ outcome: "denied_capacity", admit: false }), "denied"],
  ] as const)("%s", (_opis, input, tone) => {
    expect(scanTone(input)).toBe(tone);
  });
});

describe("nagłówek - każdy wynik ma własne słowa (PL i EN)", () => {
  it.each(["pl", "en"])("%s: nowe wyniki nie są „Nieznany wynik”", async (lang) => {
    await i18n.changeLanguage(lang);
    const unknown = i18n.t("eventScanner.outcomes.unknown");
    for (const input of [
      verdict({ outcome: "denied_already_inside", admit: false }),
      verdict({ outcome: "code_superseded", admit: false }),
      verdict({ reentry: true }),
    ]) {
      const key = scanTitleKey(input);
      expect(i18n.exists(key)).toBe(true);
      expect(i18n.t(key)).not.toBe(unknown);
    }
    expect(scanTitleKey(verdict({ reentry: true }))).toBe("eventScanner.outcomes.grantedReentry");
    expect(scanTitleKey(verdict())).toBe("eventScanner.outcomes.granted");
    await i18n.changeLanguage("pl");
  });
});

describe("zdanie z kontekstem", () => {
  it("kod zastąpiony: poświadczenie × powód × chwila - każda para ma zdanie w PL i EN", () => {
    for (const credential of ["ticket", "badge"] as const) {
      for (const reason of ["reissued", "revoked", "invalidated"] as const) {
        const hint = supersededHint(
          { credential, reason, supersededAt: "2026-10-12T08:01:02Z" },
          when,
        );
        expect(hint).toEqual({
          key: `eventScanner.superseded.${credential}.${reason}`,
          params: { when: "[2026-10-12T08:01:02Z]" },
        });
        for (const lng of ["pl", "en"]) {
          expect(i18n.exists(hint.key, { lng })).toBe(true);
          expect(i18n.t(hint.key, { ...hint.params, lng })).toContain("[2026-10-12T08:01:02Z]");
        }
      }
    }
  });

  it("kod zastąpiony bez kompletu danych (stoisko, kiosk, stara baza) - zdanie ogólne", () => {
    const generic = { key: "eventScanner.outcomeHints.codeSuperseded", params: {} };
    expect(supersededHint(null, when)).toEqual(generic);
    expect(
      supersededHint(
        { credential: "badge", reason: null, supersededAt: "2026-10-12T08:00:00Z" },
        when,
      ),
    ).toEqual(generic);
    expect(
      supersededHint({ credential: "badge", reason: "reissued", supersededAt: null }, when),
    ).toEqual(generic);
  });

  it("już w środku: chwila poprzedniego wejścia; bez niej - podpowiedź ogólna wyniku", () => {
    const base = {
      ...verdict({ outcome: "denied_already_inside", admit: false, reentry: true }),
      superseded: null,
    };
    expect(scanContextHint({ ...base, reentryPreviousAt: "2026-10-12T09:30:00Z" }, when)).toEqual({
      key: "eventScanner.outcomeHints.deniedAlreadyInsideAt",
      params: { when: "[2026-10-12T09:30:00Z]" },
    });
    expect(scanContextHint({ ...base, reentryPreviousAt: null }, when)).toBeNull();
  });

  it("ponowne wejście: zdanie z chwilą poprzedniego wejścia", () => {
    const base = { ...verdict({ reentry: true }), superseded: null };
    expect(scanContextHint({ ...base, reentryPreviousAt: "2026-10-12T09:30:00Z" }, when)).toEqual({
      key: "eventScanner.outcomeHints.grantedReentryAt",
      params: { when: "[2026-10-12T09:30:00Z]" },
    });
    expect(scanContextHint({ ...base, reentryPreviousAt: null }, when)?.key).toBe(
      "eventScanner.outcomeHints.grantedReentry",
    );
  });

  it("zwykła zgoda i zwykła odmowa nie mają zdania z kontekstem", () => {
    expect(
      scanContextHint({ ...verdict(), reentryPreviousAt: null, superseded: null }, when),
    ).toBeNull();
    expect(
      scanContextHint(
        {
          ...verdict({ outcome: "denied_capacity", admit: false }),
          reentryPreviousAt: null,
          superseded: null,
        },
        when,
      ),
    ).toBeNull();
  });
});

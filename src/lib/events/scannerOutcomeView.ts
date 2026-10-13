// Wynik skanu -> ton banera, nagłówek i zdanie z kontekstem. TABELA, nie
// łańcuch warunków rozsiany po panelach.
//
// JEDNO ŹRÓDŁO DLA BAZY I DLA DECYZJI OFFLINE. Odpowiedź `event_checkin_record`
// i decyzja z listy offline (`decideOffline`) mówią tym samym językiem: ten
// sam wynik ma ten sam kolor, tę samą ikonę i ten sam nagłówek - operator nie
// uczy się dwóch słowników.
//
// TONY (`ScanOutcomeBanner`): zielony „wpuść", NIEBIESKI „wpuść ponownie - ta
// osoba już weszła" (polityka `allow`, OPS-08), czerwony „nie wpuszczaj",
// bursztynowy „to nie jest zwykła odmowa, przeczytaj" (nieznany kod, kod
// z innego wydarzenia, kod ZASTĄPIONY - OPS-04 - i powtórzone piknięcie).
// Każdy ton ma własną ikonę i nagłówek - kolor nie jest jedynym nośnikiem.
//
// KONTEKST JEST CZĘŚCIĄ ODPOWIEDZI. Odmowa `denied_already_inside` bez godziny
// wejścia i kod zastąpiony bez powodu („wydano nowy identyfikator", „zwrot
// biletu") kończą się telefonem do biura - dlatego zdanie pod nagłówkiem niesie
// chwilę poprzedniego wejścia albo powód i chwilę zastąpienia.
import type { SupersededInfo } from "@/lib/events/scannerApi";
import { scanOutcomeKey } from "@/lib/events/scannerErrors";

export type ScanTone = "granted" | "reentry" | "denied" | "warning" | "neutral";

/** Werdykt w kształcie wspólnym dla odpowiedzi bazy i decyzji offline. */
export interface ScanVerdict {
  outcome: string;
  admit: boolean;
  /** Osoba była już w środku punktu (OPS-08). */
  reentry: boolean;
}

/** Ton wpuszczenia: domyślnie zielony, ponowne wejście - niebieski. */
const ADMITTED_TONE: Readonly<Partial<Record<string, ScanTone>>> = {
  repeat: "warning",
};

/** Ton odmowy: domyślnie czerwony. */
const REFUSED_TONE: Readonly<Partial<Record<string, ScanTone>>> = {
  unknown_code: "warning",
  wrong_event: "warning",
  code_superseded: "warning",
};

export function scanTone(verdict: ScanVerdict): ScanTone {
  if (verdict.admit) {
    return ADMITTED_TONE[verdict.outcome] ?? (verdict.reentry ? "reentry" : "granted");
  }
  return REFUSED_TONE[verdict.outcome] ?? "denied";
}

function isReentryGrant(verdict: ScanVerdict): boolean {
  return verdict.admit && verdict.reentry && verdict.outcome === "granted";
}

/** Klucz nagłówka - ponowne wejście ma własny, reszta idzie słownikiem wyników. */
export function scanTitleKey(verdict: ScanVerdict): string {
  return isReentryGrant(verdict)
    ? "eventScanner.outcomes.grantedReentry"
    : scanOutcomeKey(verdict.outcome);
}

/** Zdanie pod nagłówkiem: klucz i parametry (daty już sformatowane). */
export interface ScanHint {
  key: string;
  params: Record<string, string>;
}

/**
 * Powód zastąpienia kodu po ludzku: poświadczenie (bilet albo identyfikator)
 * × powód (dodruk/ponowne wydanie, zwrot/anulowanie, unieważnienie zgubionego)
 * z chwilą. Niepełne dane - zdanie ogólne „poproś o aktualny".
 */
export function supersededHint(
  info: SupersededInfo | null,
  when: (iso: string) => string,
): ScanHint {
  if (
    info === null ||
    info.credential === null ||
    info.reason === null ||
    info.supersededAt === null
  ) {
    return { key: "eventScanner.outcomeHints.codeSuperseded", params: {} };
  }
  return {
    key: `eventScanner.superseded.${info.credential}.${info.reason}`,
    params: { when: when(info.supersededAt) },
  };
}

/**
 * Zdanie z kontekstem dla wyników, które go mają (kod zastąpiony, osoba
 * w środku, ponowne wejście). `null` = panel bierze ogólną podpowiedź wyniku.
 */
export function scanContextHint(
  verdict: ScanVerdict & {
    reentryPreviousAt: string | null;
    superseded: SupersededInfo | null;
  },
  when: (iso: string) => string,
): ScanHint | null {
  if (verdict.outcome === "code_superseded") return supersededHint(verdict.superseded, when);
  const previous = verdict.reentryPreviousAt;
  if (verdict.outcome === "denied_already_inside") {
    return previous === null
      ? null
      : {
          key: "eventScanner.outcomeHints.deniedAlreadyInsideAt",
          params: { when: when(previous) },
        };
  }
  if (isReentryGrant(verdict)) {
    return previous === null
      ? { key: "eventScanner.outcomeHints.grantedReentry", params: {} }
      : { key: "eventScanner.outcomeHints.grantedReentryAt", params: { when: when(previous) } };
  }
  return null;
}

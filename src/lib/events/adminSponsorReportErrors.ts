// Odmowy bazy w raporcie dla sponsorów -> zdanie po ludzku.
//
// TA SAMA MECHANIKA, CO W PANELU SPONSORÓW (`adminSponsorErrors.ts`): klucz
// siedzi w głowie komunikatu plpgsql (`too_many_links: a sponsor may have at
// most 10 active links`), a liczby z ogona wchodzą do interpolacji jako
// `{count, total}` - plpgsql nie ma innego kanału na parametry wyjątku.
//
// NIEZNANY KLUCZ NIE UDAJE ZNANEGO: wracamy do `unknown`, żeby organizator nie
// czytał `22023` ani „violates check constraint". Listę kodów i ich obecność
// w obu językach pilnuje `eventErrorMapsI18n.gate.test.ts`.
import i18n from "@/lib/i18n";
import { ensureSponsorReportI18n } from "@/lib/i18n-admin-event-sponsor-report";

const PREFIX = "adminEventSponsorReport.errors.";

function camel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_all, chr: string) => chr.toUpperCase());
}

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "";
}

export type AdminSponsorReportErrorParams = Record<string, number>;

export interface AdminSponsorReportFailure {
  /** Pełny klucz i18n - zawsze istnieje, w najgorszym razie `...unknown`. */
  key: string;
  params: AdminSponsorReportErrorParams;
}

function paramsOf(tail: string): AdminSponsorReportErrorParams {
  const numbers = tail.match(/\d+/g) ?? [];
  const out: AdminSponsorReportErrorParams = {};
  if (numbers[0] !== undefined) out.count = Number(numbers[0]);
  if (numbers[1] !== undefined) out.total = Number(numbers[1]);
  return out;
}

export function adminSponsorReportFailure(error: unknown): AdminSponsorReportFailure {
  ensureSponsorReportI18n();
  const message = messageOf(error);
  const separator = message.indexOf(":");
  const head = (separator === -1 ? message : message.slice(0, separator)).trim();
  const tail = separator === -1 ? "" : message.slice(separator + 1);

  if (!/^[a-z][a-z0-9_]*$/.test(head)) return { key: `${PREFIX}unknown`, params: {} };

  const candidate = `${PREFIX}${camel(head)}`;
  if (!i18n.exists(candidate)) return { key: `${PREFIX}unknown`, params: {} };
  return { key: candidate, params: paramsOf(tail) };
}

/** Gotowe zdanie dla toasta - komponent nie musi znać prefiksu ani parametrów. */
export function adminSponsorReportErrorMessage(error: unknown): string {
  const failure = adminSponsorReportFailure(error);
  return i18n.t(failure.key, failure.params);
}

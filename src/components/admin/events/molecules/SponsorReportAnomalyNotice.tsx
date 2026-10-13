// Molekuła: ostrzeżenie o ANOMALIACH POMIARU w raporcie dla sponsorów (OPS-09).
//
// PO CO. Baza liczy ruch z jednego adresu ponad limit sesji i ruch bez ważnej
// sesji serwera do kubełka adresu (raz na adres i dzień do unikalnych), a paczki
// ponad limit zapytań odrzuca. Raport jest już skorygowany - ale organizator
// pokazuje te liczby sponsorowi i rozlicza nimi pakiet, więc musi wiedzieć, że
// część ruchu odfiltrowano, ile i z ilu źródeł. Bez anomalii molekuła nie
// rysuje nic.
//
// TON OSTRZEŻENIA, NIE BLOKADY (jak `EventCloneNotices`): `role="status"`, bo
// to informacja do przeczytania we własnym tempie, a nie błąd zatrzymujący pracę.
import { useTranslation } from "react-i18next";

import { AlertTriangle } from "@/lib/lucide-shim";
import {
  ADMIN_ANOMALY_LABEL_KEYS,
  type SponsorExposureAnomalyLine,
} from "@/lib/events/sponsorExposureAnomalies";
import { formatNumber, uiLang } from "@/lib/i18n/format";
import { ensureSponsorReportI18n } from "@/lib/i18n-admin-event-sponsor-report";

export function SponsorReportAnomalyNotice({
  lines,
}: {
  lines: readonly SponsorExposureAnomalyLine[];
}) {
  ensureSponsorReportI18n();
  const { t, i18n } = useTranslation();
  if (lines.length === 0) return null;
  const lang = uiLang(i18n.language);
  return (
    <section
      role="status"
      className="space-y-1.5 rounded-md border border-brand/60 bg-brand/60 p-3 dark:bg-brand/20"
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {t("adminEventSponsorReport.anomalies.title")}
      </p>
      <ul className="list-disc space-y-0.5 pl-5 text-xs leading-snug">
        {lines.map((line) => (
          <li key={line.reason}>
            {t(ADMIN_ANOMALY_LABEL_KEYS[line.reason], {
              hits: formatNumber(line.hits, lang),
              sources: formatNumber(line.sources, lang),
            })}
          </li>
        ))}
      </ul>
      <p className="text-xs leading-snug">{t("adminEventSponsorReport.anomalies.hint")}</p>
    </section>
  );
}

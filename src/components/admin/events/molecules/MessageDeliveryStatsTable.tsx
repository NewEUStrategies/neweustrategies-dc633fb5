// Molekuła: DZIENNIK DORĘCZEŃ wiadomości wydarzenia (panel „Komunikacja").
//
// LICZBY Z JEDNEGO DZIENNIKA. Przypomnienia (tor A), oferty i przekazania
// (tor B) oraz ankieta i certyfikat (tor C) zapisują KAŻDĄ próbę wysyłki
// w `event_message_deliveries`; `admin_event_message_delivery_stats` liczy je
// per rodzaj i kanał. Tabela nie zna żadnego toru - etykiety rodzaju, kanału
// i stanu biorą się z jawnych map `participantDeliveryKinds.ts`, więc nowy
// rodzaj bez etykiety nie przejdzie bramki kluczy.
//
// „OSTATNIA WYSYŁKA" W STREFIE WYDARZENIA (EB-912, `MIGRATED`), ze skrótem
// strefy obok - godzina w strefie przeglądarki organizatora rozjeżdżałaby się
// z godzinami przypomnień, które uczestnicy dostają w strefie wydarzenia.
import { useTranslation } from "react-i18next";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DELIVERY_CHANNEL_LABEL_KEYS,
  DELIVERY_KIND_LABEL_KEYS,
  DELIVERY_STATUSES,
  DELIVERY_STATUS_LABEL_KEYS,
} from "@/lib/events/participantDeliveryKinds";
import type { MessageDeliveryStats } from "@/lib/events/participantSettingsApi";
import { formatEventDateTime, eventTimeZoneLabel } from "@/lib/events/timezone";
import { uiLang } from "@/lib/i18n/format";
import { ensureI18n as ensureAdminEventParticipantI18n } from "@/lib/i18n-admin-event-participant";

export function MessageDeliveryStatsTable({
  stats,
  timezone,
}: {
  stats: MessageDeliveryStats;
  /** Strefa wydarzenia (`events.timezone`). */
  timezone: string | null;
}) {
  ensureAdminEventParticipantI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);

  if (stats.rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("adminEventParticipant.communications.deliveries.empty")}
      </p>
    );
  }

  const lastSent =
    stats.lastSentAt === null
      ? ""
      : `${formatEventDateTime(stats.lastSentAt, timezone, lang)} ${eventTimeZoneLabel(
          stats.lastSentAt,
          timezone,
          lang,
        )}`.trim();

  return (
    <div className="space-y-3">
      <Table>
        <caption className="sr-only">
          {t("adminEventParticipant.communications.deliveries.caption")}
        </caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">
              {t("adminEventParticipant.communications.deliveries.columns.kind")}
            </TableHead>
            <TableHead scope="col">
              {t("adminEventParticipant.communications.deliveries.columns.channel")}
            </TableHead>
            {DELIVERY_STATUSES.map((status) => (
              <TableHead key={status} scope="col" className="text-right">
                {t(DELIVERY_STATUS_LABEL_KEYS[status])}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {stats.rows.map((row) => (
            <TableRow key={`${row.kind}:${row.channel}`}>
              <TableCell>{t(DELIVERY_KIND_LABEL_KEYS[row.kind])}</TableCell>
              <TableCell>{t(DELIVERY_CHANNEL_LABEL_KEYS[row.channel])}</TableCell>
              {DELIVERY_STATUSES.map((status) => (
                <TableCell key={status} className="text-right tabular-nums">
                  {row[status]}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {lastSent === "" ? null : (
        <p className="text-xs text-muted-foreground">
          {t("adminEventParticipant.communications.deliveries.lastSent", { date: lastSent })}
        </p>
      )}
    </div>
  );
}

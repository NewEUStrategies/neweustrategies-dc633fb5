// Organizm: ekran giełdy spotkań 1-1 - wybór wydarzenia plus cztery zakładki.
//
// WYDARZENIE WYBIERA SIĘ TUTAJ, BO GIEŁDA ZAWSZE DOTYCZY JEDNEGO WYDARZENIA.
// Trasa jest jedna (`/admin/events/meetings`), a nie jedna na wydarzenie: żaden
// z czterech ekranów nie ma sensu bez kontekstu, a osobne adresy per wydarzenie
// zmusiłyby organizatora do wracania na listę przy każdej zmianie kontekstu.
//
// DOMYŚLNIE PIERWSZE NADCHODZĄCE WYDARZENIE, nie pierwsze w bazie. Organizator
// wchodzi tu w tygodniu poprzedzającym kongres; pokazanie mu archiwum sprzed
// dwóch lat oznaczałoby, że pierwsze, co widzi, to pusta giełda.
//
// KOLEJNOŚĆ ZAKŁADEK ODPOWIADA KOLEJNOŚCI PRACY: najpierw stoliki (bez nich
// giełda nie ma gdzie sadzać ludzi), potem siatka i reguła, potem lista spotkań,
// a statystyki na końcu - są odpowiedzią, a nie konfiguracją.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { MeetingTablesPanel } from "@/components/admin/events/organisms/MeetingTablesPanel";
import { MeetingSettingsPanel } from "@/components/admin/events/organisms/MeetingSettingsPanel";
import { MeetingsListPanel } from "@/components/admin/events/organisms/MeetingsListPanel";
import { MeetingStatsPanel } from "@/components/admin/events/organisms/MeetingStatsPanel";
import { useAdminEventsList } from "@/lib/events/useAdminEvents";
import { uiLang, formatDateShort } from "@/lib/i18n/format";
import type { AdminEventListRow } from "@/lib/events/eventsListApi";

function eventTitle(row: AdminEventListRow, lang: "pl" | "en"): string {
  return lang === "en" ? row.title_en || row.title_pl : row.title_pl || row.title_en;
}

export function MeetingsManager() {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  // Zegar zamrożony na montaż: hook listy trzyma go w kluczu cache, a nowy
  // `Date` w każdym renderze dawałby nowe zapytanie bez końca.
  const [now] = useState(() => new Date());
  const listQ = useAdminEventsList({ size: 50 }, now);
  const [eventId, setEventId] = useState<string | null>(null);

  const events = useMemo(() => listQ.data ?? [], [listQ.data]);

  useEffect(() => {
    if (eventId !== null || events.length === 0) return;
    const upcoming = events.find((row) => new Date(row.starts_at).getTime() >= now.getTime());
    setEventId((upcoming ?? events[0]).id);
  }, [events, eventId, now]);

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <Label htmlFor="meetings-event">{t("adminEventMeetings.nav.section")}</Label>
        <Select value={eventId ?? ""} onValueChange={setEventId}>
          <SelectTrigger id="meetings-event" className="max-w-xl">
            <SelectValue placeholder={t("adminEventMeetings.nav.section")} />
          </SelectTrigger>
          <SelectContent>
            {events.map((row) => (
              <SelectItem key={row.id} value={row.id}>
                {`${eventTitle(row, lang)} · ${formatDateShort(row.starts_at, i18n.language)}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {eventId === null ? null : (
        <Tabs defaultValue="tables" className="space-y-4">
          <TabsList className="tabs-scroller">
            <TabsTrigger value="tables">{t("adminEventMeetings.nav.tables")}</TabsTrigger>
            <TabsTrigger value="settings">{t("adminEventMeetings.nav.settings")}</TabsTrigger>
            <TabsTrigger value="meetings">{t("adminEventMeetings.nav.meetings")}</TabsTrigger>
            <TabsTrigger value="stats">{t("adminEventMeetings.nav.stats")}</TabsTrigger>
          </TabsList>

          {/* `key` na wydarzeniu: zmiana kontekstu ma zresetować szkice formularzy,
              a nie przepisać stan poprzedniego wydarzenia na nowe. */}
          <TabsContent value="tables">
            <MeetingTablesPanel key={eventId} eventId={eventId} />
          </TabsContent>
          <TabsContent value="settings">
            <MeetingSettingsPanel key={eventId} eventId={eventId} />
          </TabsContent>
          <TabsContent value="meetings">
            <MeetingsListPanel key={eventId} eventId={eventId} />
          </TabsContent>
          <TabsContent value="stats">
            <MeetingStatsPanel key={eventId} eventId={eventId} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

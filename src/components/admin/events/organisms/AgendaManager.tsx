// Organizm: ekran AGENDY wydarzenia - wybór wydarzenia plus zakładki podmodułu.
//
// TEN SAM WZORZEC, CO ZAPISY I GIEŁDA: jedna trasa, wydarzenie wybierane w
// środku. Sesje, ścieżki i sale opisują JEDNO wydarzenie, a organizator zmienia
// kontekst częściej niż widok.
//
// KOLEJNOŚĆ ZAKŁADEK ODPOWIADA KOLEJNOŚCI PRACY: sesje to ekran codzienny,
// ścieżki i sale ustawia się raz, a kolizje czyta się przed publikacją programu.
//
// STREFA WYDARZENIA IDZIE W DÓŁ Z WYBRANEGO WIERSZA. Godziny sesji wpisuje się w
// strefie wydarzenia - bez tego organizator w innej strefie wpisuje własne
// popołudnie w cudzy poranek.
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
import { AgendaSessionsPanel } from "@/components/admin/events/organisms/AgendaSessionsPanel";
import { AgendaTracksPanel } from "@/components/admin/events/organisms/AgendaTracksPanel";
import { AgendaRoomsPanel } from "@/components/admin/events/organisms/AgendaRoomsPanel";
import { AgendaConflictsPanel } from "@/components/admin/events/organisms/AgendaConflictsPanel";
import { useAdminEventsList } from "@/lib/events/useAdminEvents";
import { eventTimeZone } from "@/lib/events/timezone";
import { formatDateShort, uiLang } from "@/lib/i18n/format";
import type { AdminEventListRow } from "@/lib/events/eventsListApi";

function eventTitle(row: AdminEventListRow, lang: "pl" | "en"): string {
  return lang === "en" ? row.title_en || row.title_pl : row.title_pl || row.title_en;
}

export function AgendaManager() {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  // Zegar zamrożony na montaż - hook listy trzyma go w kluczu cache.
  const [now] = useState(() => new Date());
  const listQ = useAdminEventsList({ size: 50 }, now);
  const [eventId, setEventId] = useState<string | null>(null);

  const events = useMemo(() => listQ.data ?? [], [listQ.data]);

  useEffect(() => {
    if (eventId !== null || events.length === 0) return;
    const upcoming = events.find((row) => new Date(row.starts_at).getTime() >= now.getTime());
    setEventId((upcoming ?? events[0]).id);
  }, [events, eventId, now]);

  const selected = events.find((row) => row.id === eventId) ?? null;
  const timeZoneLabel = selected === null ? eventTimeZone({}) : eventTimeZone(selected);

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <Label htmlFor="agenda-event">{t("adminEventAgenda.nav.sectionTitle")}</Label>
        <Select value={eventId ?? ""} onValueChange={setEventId}>
          <SelectTrigger id="agenda-event" className="max-w-xl">
            <SelectValue placeholder={t("adminEventAgenda.nav.sectionTitle")} />
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
        <Tabs defaultValue="sessions" className="space-y-4">
          <TabsList
            className="tabs-scroller"
            aria-label={t("adminEventAgenda.nav.sectionsNavLabel")}
          >
            <TabsTrigger value="sessions">{t("adminEventAgenda.nav.sessions")}</TabsTrigger>
            <TabsTrigger value="tracks">{t("adminEventAgenda.nav.tracks")}</TabsTrigger>
            <TabsTrigger value="rooms">{t("adminEventAgenda.nav.rooms")}</TabsTrigger>
            <TabsTrigger value="conflicts">{t("adminEventAgenda.nav.conflicts")}</TabsTrigger>
          </TabsList>

          {/* `key` na wydarzeniu: zmiana kontekstu resetuje szkice formularzy,
              zamiast przepisywać stan poprzedniego wydarzenia na nowe. */}
          <TabsContent value="sessions">
            <AgendaSessionsPanel key={eventId} eventId={eventId} timeZoneLabel={timeZoneLabel} />
          </TabsContent>
          <TabsContent value="tracks">
            <AgendaTracksPanel key={eventId} eventId={eventId} />
          </TabsContent>
          <TabsContent value="rooms">
            <AgendaRoomsPanel key={eventId} eventId={eventId} />
          </TabsContent>
          <TabsContent value="conflicts">
            <AgendaConflictsPanel key={eventId} eventId={eventId} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

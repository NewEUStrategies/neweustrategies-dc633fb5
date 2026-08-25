// Organizm: ekran ON-SITE wydarzenia - wybór wydarzenia plus zakładki podmodułu.
//
// TEN SAM WZORZEC, CO AGENDA, ZAPISY I SPONSORZY: jedna trasa, wydarzenie
// wybierane w środku. Odprawa, punkty kontrolne i urządzenia opisują JEDNO
// wydarzenie, a organizator zmienia kontekst częściej niż widok.
//
// KOLEJNOŚĆ ZAKŁADEK ODPOWIADA KOLEJNOŚCI DNIA: najpierw stanowisko odprawy (to
// ekran, na którym stoi się cały dzień), potem dziennik i statystyki (to, o co
// pyta się w trakcie), a konfiguracja punktów, urządzeń i identyfikatorów na
// końcu, bo ustawia się ją raz - przed otwarciem drzwi.
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
import { OnsiteDeskPanel } from "@/components/admin/events/organisms/OnsiteDeskPanel";
import { OnsiteLogPanel } from "@/components/admin/events/organisms/OnsiteLogPanel";
import { OnsiteStatsPanel } from "@/components/admin/events/organisms/OnsiteStatsPanel";
import { OnsiteCheckpointsPanel } from "@/components/admin/events/organisms/OnsiteCheckpointsPanel";
import { OnsiteDevicesPanel } from "@/components/admin/events/organisms/OnsiteDevicesPanel";
import { OnsiteBadgesPanel } from "@/components/admin/events/organisms/OnsiteBadgesPanel";
import { OnsiteLeadsPanel } from "@/components/admin/events/organisms/OnsiteLeadsPanel";
import { useAdminEventsList } from "@/lib/events/useAdminEvents";
import { formatDateShort, uiLang } from "@/lib/i18n/format";
import type { AdminEventListRow } from "@/lib/events/eventsListApi";

function eventTitle(row: AdminEventListRow, lang: "pl" | "en"): string {
  return lang === "en" ? row.title_en || row.title_pl : row.title_pl || row.title_en;
}

export function OnsiteManager() {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  // Zegar zamrożony na montaż - hook listy trzyma go w kluczu cache.
  const [now] = useState(() => new Date());
  const listQ = useAdminEventsList({ size: 50 }, now);
  const [eventId, setEventId] = useState<string | null>(null);

  const events = useMemo(() => listQ.data ?? [], [listQ.data]);

  useEffect(() => {
    if (eventId !== null || events.length === 0) return;
    // Na miejscu pracuje się na wydarzeniu, które trwa albo zaraz się zacznie -
    // dlatego domyślnie najbliższe, nie pierwsze z listy.
    const upcoming = events.find((row) => new Date(row.starts_at).getTime() >= now.getTime());
    setEventId((upcoming ?? events[0]).id);
  }, [events, eventId, now]);

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <Label htmlFor="onsite-event">{t("adminEventOnsite.nav.sectionTitle")}</Label>
        <Select value={eventId ?? ""} onValueChange={setEventId}>
          <SelectTrigger id="onsite-event" className="max-w-xl">
            <SelectValue placeholder={t("adminEventOnsite.nav.sectionTitle")} />
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
        <Tabs defaultValue="desk" className="space-y-4">
          <TabsList
            className="tabs-scroller"
            aria-label={t("adminEventOnsite.nav.sectionsNavLabel")}
          >
            <TabsTrigger value="desk">{t("adminEventOnsite.nav.desk")}</TabsTrigger>
            <TabsTrigger value="log">{t("adminEventOnsite.nav.log")}</TabsTrigger>
            <TabsTrigger value="stats">{t("adminEventOnsite.nav.stats")}</TabsTrigger>
            <TabsTrigger value="checkpoints">{t("adminEventOnsite.nav.checkpoints")}</TabsTrigger>
            <TabsTrigger value="devices">{t("adminEventOnsite.nav.devices")}</TabsTrigger>
            <TabsTrigger value="badges">{t("adminEventOnsite.nav.badges")}</TabsTrigger>
            <TabsTrigger value="leads">{t("adminEventOnsite.nav.leads")}</TabsTrigger>
          </TabsList>

          {/* `key` na wydarzeniu: zmiana kontekstu resetuje szkice formularzy i
              wybrany punkt kontrolny, zamiast przepisywać je na nowe wydarzenie. */}
          <TabsContent value="desk">
            <OnsiteDeskPanel key={eventId} eventId={eventId} />
          </TabsContent>
          <TabsContent value="log">
            <OnsiteLogPanel key={eventId} eventId={eventId} />
          </TabsContent>
          <TabsContent value="stats">
            <OnsiteStatsPanel key={eventId} eventId={eventId} />
          </TabsContent>
          <TabsContent value="checkpoints">
            <OnsiteCheckpointsPanel key={eventId} eventId={eventId} />
          </TabsContent>
          <TabsContent value="devices">
            <OnsiteDevicesPanel key={eventId} eventId={eventId} />
          </TabsContent>
          <TabsContent value="badges">
            <OnsiteBadgesPanel key={eventId} eventId={eventId} />
          </TabsContent>
          <TabsContent value="leads">
            <OnsiteLeadsPanel key={eventId} eventId={eventId} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// Organizm: ekran SPONSORÓW wydarzenia - wybór wydarzenia plus zakładki.
//
// TEN SAM WZORZEC, CO AGENDA I ZAPISY: jedna trasa, wydarzenie wybierane w
// środku, bo poziomy i przypięcia opisują JEDNO wydarzenie.
//
// KOLEJNOŚĆ ZAKŁADEK ODPOWIADA KOLEJNOŚCI PRACY: poziomy ustawia się raz przed
// sprzedażą, firmy dopina się przez cały czas - dlatego firmy są domyślne.
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
import { SponsorTiersPanel } from "@/components/admin/events/organisms/SponsorTiersPanel";
import { SponsorsListPanel } from "@/components/admin/events/organisms/SponsorsListPanel";
import { useAdminEventsList } from "@/lib/events/useAdminEvents";
import { formatDateShort, uiLang } from "@/lib/i18n/format";
import type { AdminEventListRow } from "@/lib/events/eventsListApi";

function eventTitle(row: AdminEventListRow, lang: "pl" | "en"): string {
  return lang === "en" ? row.title_en || row.title_pl : row.title_pl || row.title_en;
}

export function SponsorsManager() {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
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
        <Label htmlFor="sponsors-event">{t("adminEventSponsors.nav.sectionTitle")}</Label>
        <Select value={eventId ?? ""} onValueChange={setEventId}>
          <SelectTrigger id="sponsors-event" className="max-w-xl">
            <SelectValue placeholder={t("adminEventSponsors.nav.sectionTitle")} />
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
        <Tabs defaultValue="sponsors" className="space-y-4">
          <TabsList
            className="tabs-scroller"
            aria-label={t("adminEventSponsors.nav.sectionsNavLabel")}
          >
            <TabsTrigger value="sponsors">{t("adminEventSponsors.nav.sponsors")}</TabsTrigger>
            <TabsTrigger value="tiers">{t("adminEventSponsors.nav.tiers")}</TabsTrigger>
          </TabsList>

          {/* `key` na wydarzeniu: zmiana kontekstu resetuje szkice formularzy. */}
          <TabsContent value="sponsors">
            <SponsorsListPanel key={eventId} eventId={eventId} />
          </TabsContent>
          <TabsContent value="tiers">
            <SponsorTiersPanel key={eventId} eventId={eventId} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

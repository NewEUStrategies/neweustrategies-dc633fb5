// Organizm: ekran GRUP I ZGÓD wydarzenia - wybór wydarzenia plus zakładki.
//
// TEN SAM WZORZEC, CO SPONSORZY, AGENDA I ZAPISY: jedna trasa, wydarzenie
// wybierane w środku, bo grupy i zgody opisują JEDNO wydarzenie.
//
// KOLEJNOŚĆ ZAKŁADEK ODPOWIADA KOLEJNOŚCI PRACY: grupy ustawia się przed
// sprzedażą biletów, zgody przed otwarciem zapisów, a członkostwa dodatkowe
// dopina się przez cały czas.
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
import { EventGroupsPanel } from "@/components/admin/events/organisms/EventGroupsPanel";
import { EventTermsPanel } from "@/components/admin/events/organisms/EventTermsPanel";
import { GroupMembersPanel } from "@/components/admin/events/organisms/GroupMembersPanel";
import { useAdminEventsList } from "@/lib/events/useAdminEvents";
import { formatDateShort, uiLang } from "@/lib/i18n/format";
import type { AdminEventListRow } from "@/lib/events/eventsListApi";

function eventTitle(row: AdminEventListRow, lang: "pl" | "en"): string {
  return lang === "en" ? row.title_en || row.title_pl : row.title_pl || row.title_en;
}

export function TermsGroupsManager() {
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
        <Label htmlFor="terms-event">{t("adminEventTerms.nav.sectionTitle")}</Label>
        <Select value={eventId ?? ""} onValueChange={setEventId}>
          <SelectTrigger id="terms-event" className="max-w-xl">
            <SelectValue placeholder={t("adminEventTerms.nav.sectionTitle")} />
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
        <Tabs defaultValue="groups" className="space-y-4">
          <TabsList className="tabs-scroller" aria-label={t("adminEventTerms.nav.sectionsNavLabel")}>
            <TabsTrigger value="groups">{t("adminEventTerms.nav.groups")}</TabsTrigger>
            <TabsTrigger value="members">{t("adminEventTerms.nav.members")}</TabsTrigger>
            <TabsTrigger value="terms">{t("adminEventTerms.nav.terms")}</TabsTrigger>
          </TabsList>

          {/* `key` na wydarzeniu: zmiana kontekstu resetuje szkice formularzy. */}
          <TabsContent value="groups">
            <EventGroupsPanel key={eventId} eventId={eventId} />
          </TabsContent>
          <TabsContent value="members">
            <GroupMembersPanel key={eventId} eventId={eventId} />
          </TabsContent>
          <TabsContent value="terms">
            <EventTermsPanel key={eventId} eventId={eventId} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

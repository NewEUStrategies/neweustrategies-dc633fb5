// Organizm: ekran zapisów wydarzenia - wybór wydarzenia plus zakładki podmodułu.
//
// TEN SAM WZORZEC, CO GIEŁDA SPOTKAŃ: jedna trasa, wydarzenie wybierane w środku.
// Bilety i formularz zapisu opisują JEDNO wydarzenie, a organizator zmienia
// kontekst częściej niż widok - osobny adres per wydarzenie zmuszałby go do
// powrotu na listę przy każdej zmianie.
//
// KOLEJNOŚĆ ZAKŁADEK ODPOWIADA KOLEJNOŚCI PRACY: najpierw bilety (nadają pulę
// miejsc i grupę), potem pola formularza, o które pytamy przy zapisie.
//
// ZGŁOSZENIA STOJĄ NA PIERWSZEJ ZAKŁADCE, bo to ekran pracy codziennej: bilety i
// pola formularza ustawia się raz przed wydarzeniem, a decyzje podejmuje się
// codziennie aż do dnia wydarzenia.
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
import { EventTicketsPanel } from "@/components/admin/events/organisms/EventTicketsPanel";
import { RegistrationFieldsPanel } from "@/components/admin/events/organisms/RegistrationFieldsPanel";
import { RegistrationsListPanel } from "@/components/admin/events/organisms/RegistrationsListPanel";
import { useAdminEventsList } from "@/lib/events/useAdminEvents";
import { formatDateShort, uiLang } from "@/lib/i18n/format";
import type { AdminEventListRow } from "@/lib/events/eventsListApi";

function eventTitle(row: AdminEventListRow, lang: "pl" | "en"): string {
  return lang === "en" ? row.title_en || row.title_pl : row.title_pl || row.title_en;
}

export function RegistrationsManager() {
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

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <Label htmlFor="registrations-event">
          {t("adminEventRegistration.nav.sectionTitle")}
        </Label>
        <Select value={eventId ?? ""} onValueChange={setEventId}>
          <SelectTrigger id="registrations-event" className="max-w-xl">
            <SelectValue placeholder={t("adminEventRegistration.nav.sectionTitle")} />
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
        <Tabs defaultValue="registrations" className="space-y-4">
          <TabsList className="tabs-scroller">
            <TabsTrigger value="registrations">
              {t("adminEventRegistration.nav.registrations")}
            </TabsTrigger>
            <TabsTrigger value="tickets">{t("adminEventRegistration.nav.tickets")}</TabsTrigger>
            <TabsTrigger value="form">{t("adminEventRegistration.nav.form")}</TabsTrigger>
          </TabsList>

          {/* `key` na wydarzeniu: zmiana kontekstu resetuje szkice formularzy,
              zamiast przepisywać stan poprzedniego wydarzenia na nowe. */}
          <TabsContent value="registrations">
            <RegistrationsListPanel key={eventId} eventId={eventId} />
          </TabsContent>
          <TabsContent value="tickets">
            <EventTicketsPanel key={eventId} eventId={eventId} />
          </TabsContent>
          <TabsContent value="form">
            <RegistrationFieldsPanel key={eventId} eventId={eventId} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

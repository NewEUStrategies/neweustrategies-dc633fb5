// Rama STUDIA WYDARZENIA: pasek gorny + wlasny sidebar + tresc + podglad.
//
// RAMA WCZYTUJE WYDARZENIE RAZ i oddaje je sekcjom przez `Outlet` z kontekstem
// podgladu. Kazda sekcja pytajaca o wiersz osobno dawalaby tyle odpowiedzi, ile
// ekranow - a te po zapisie rozjezdzaja sie w czasie: nazwa w naglowku sidebara
// musialaby odswiezac sie inaczej niz to samo pole w formularzu.
//
// BRAMKA ROLI JEST W BAZIE, TU STOI TYLKO ZDANIE. Kazde RPC studia ma asercje
// roli w tenancie, wiec autor bez uprawnien dostanie odmowe niezaleznie od
// tego, co pokaze ekran; komunikat istnieje po to, zeby odmowa nie wygladala
// jak awaria.
//
// STUDIO NIE UZYWA `AdminShell`. To jest cala idea: na czas pracy nad jednym
// wydarzeniem lewy pas nalezy do wydarzenia, a nie do panelu.
//
// TOZSAMOSC WYDARZENIA ODDAJE SIDEBAROWI RAMA. Nazwa w jezyku interfejsu
// i termin w strefie wydarzenia licza sie TU, raz, bo tu jest wiersz - sidebar
// dostaje gotowe napisy i nie musi znac ani `uiLang`, ani stref czasowych.
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Loader2 } from "@/lib/lucide-shim";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { eventStudioSectionFromPath } from "@/lib/events/eventStudioNav";
import { formatEventDateTime } from "@/lib/events/timezone";
import { eventBrandingFromJson } from "@/lib/events/eventBrandingDraft";
import { asEventFormat } from "@/lib/events/eventTypes";
import { adminEventStudioErrorMessage } from "@/lib/events/adminEventStudioErrors";
import { useAdminEventDetail, useSetEventStatus } from "@/lib/events/useAdminEventDetail";
import type { EventStatus } from "@/lib/events/eventDetailApi";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";
import { uiLang } from "@/lib/i18n/format";
import { EventStudioSidebar } from "@/components/admin/events/studio/EventStudioSidebar";
import { EventStudioTopBar } from "@/components/admin/events/studio/EventStudioTopBar";
import { EventStudioPreview } from "@/components/admin/events/studio/EventStudioPreview";
import {
  EMPTY_EVENT_PREVIEW,
  EventStudioPreviewProvider,
  type EventPreviewModel,
} from "@/components/admin/events/studio/EventStudioPreviewContext";

function asStatus(value: string): EventStatus {
  return value === "published" || value === "cancelled" ? value : "draft";
}

export function EventStudioShell({
  eventId,
  pathname,
  children,
}: {
  eventId: string;
  pathname: string;
  children: ReactNode;
}) {
  ensureAdminEventsI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const { isAdmin, roles } = useAuth();
  const canWrite = isAdmin || roles.includes("editor");

  const detailQ = useAdminEventDetail(canWrite ? eventId : "");
  const setStatus = useSetEventStatus(eventId);
  const [previewOpen, setPreviewOpen] = useState(true);

  const row = detailQ.data ?? null;
  const activeSection = eventStudioSectionFromPath(pathname);

  // Podklad podgladu to stan ZAPISANY; szkic ekranu naklada sie na niego
  // w kontekscie, wiec sekcja, ktora nic nie wnosi, nadal pokazuje prawde.
  const base = useMemo<EventPreviewModel>(() => {
    if (row === null) return EMPTY_EVENT_PREVIEW;
    const address = [
      row.street_address,
      [row.postal_code, row.city].filter((part) => part !== null && part !== "").join(" "),
      row.region,
      row.country,
    ]
      .filter((part) => part !== null && part !== "")
      .join(", ");
    return {
      ...EMPTY_EVENT_PREVIEW,
      titlePl: row.title_pl ?? "",
      titleEn: row.title_en ?? "",
      slug: row.slug ?? "",
      startsAt: row.starts_at ?? "",
      endsAt: row.ends_at ?? "",
      timezone: row.timezone ?? "",
      format: asEventFormat(row.format),
      coverUrl: row.cover_url ?? "",
      videoPlatform: row.video_header_platform ?? "",
      videoId: row.video_header_id ?? "",
      locationName: row.location ?? "",
      addressLine: address,
      descriptionPl: row.description_pl ?? "",
      descriptionEn: row.description_en ?? "",
      hashtag: row.social_hashtag ?? "",
      languages: row.languages ?? [],
      supportEmail: row.support_email ?? "",
      status: row.status ?? "draft",
      branding: eventBrandingFromJson(row.branding),
      pagesDisplayMode: row.pages_display_mode === "grid" ? "grid" : "list",
    };
  }, [row]);

  if (!canWrite) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
            {t("adminEvents.list.adminOnly")}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (detailQ.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  if (row === null) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
            {t("adminEvents.studio.errors.notFound")}
          </CardContent>
        </Card>
      </div>
    );
  }

  const status = asStatus(row.status ?? "draft");
  const title = lang === "en" ? row.title_en || row.title_pl : row.title_pl || row.title_en;
  // TERMIN LICZY RAMA, NIE SIDEBAR. Data w naglowku sidebara musi byc w strefie
  // WYDARZENIA, a nie przegladarki - organizator w innej strefie inaczej czyta
  // „9:00" jako swoja godzine i planuje odprawe o zlej porze. Wydarzenie bez
  // daty dostaje zdanie „bez terminu": pusty wiersz wyglada jak blad wczytania.
  const startsAtLabel =
    formatEventDateTime(row.starts_at, row.timezone, lang) || t("adminEvents.list.row.noDate");
  // Szkic nie ma strony publicznej - odnosnik do niej prowadzilby na 404.
  const publicHref = status === "published" && row.slug !== "" ? `/events/${row.slug}` : null;

  const changeStatus = (next: EventStatus) => {
    setStatus.mutate(next, {
      onSuccess: () => toast.success(t(`adminEvents.studio.toasts.status.${next}`)),
      onError: (error) => toast.error(adminEventStudioErrorMessage(error)),
    });
  };

  return (
    <div className="admin-compact flex min-h-screen flex-col bg-muted/30">
      <EventStudioTopBar
        status={status}
        isBusy={setStatus.isPending}
        previewOpen={previewOpen}
        onTogglePreview={() => setPreviewOpen((value) => !value)}
        onStatusChange={changeStatus}
      />
      <EventStudioPreviewProvider base={base}>
        <div className="flex min-h-0 flex-1">
          <EventStudioSidebar
            eventId={eventId}
            eventTitle={title}
            startsAtLabel={startsAtLabel}
            activeSection={activeSection}
            publicHref={publicHref}
          />
          <main className="min-w-0 flex-1 pb-80">{children}</main>
        </div>
        <EventStudioPreview
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          publicHref={publicHref}
        />
      </EventStudioPreviewProvider>
    </div>
  );
}

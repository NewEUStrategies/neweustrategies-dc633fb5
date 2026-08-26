// Gorny pasek STUDIA WYDARZENIA.
//
// PASEK NALEZY DO AKCJI, NIE DO TOZSAMOSCI. Zostaja w nim dwie rzeczy: w jakim
// stanie jest wydarzenie (szkic / opublikowane / odwolane) i co moge z nim
// zrobic teraz (podglad, publikacja). Publikacja jest jedyna akcja nieodwracalna
// z punktu widzenia uczestnika, wiec stoi osobno, po prawej.
//
// NAZWY WYDARZENIA TU NIE MA - i to jest decyzja, nie przeoczenie. Nazwa
// i termin przeniosly sie do naglowka sidebara, bo tam stoja we wzorcu
// (`‹ Back to the community` · nazwa · data · `Open event`), a pasek gorny
// wzorca ma wylacznie logo, plakietke planu, `Preview event`, `Publish event`
// i konto. Zostawienie nazwy tutaj znaczyloby ten sam napis dwa razy na jednym
// ekranie, kilkadziesiat pikseli od siebie - a wtedy przestaje sie go czytac
// w obu miejscach. Odnosnik po lewej zostaje, bo prowadzi do STUDIA jako
// modulu (i jest jedynym wyjsciem, gdy sidebar jest przewiniety).
//
// STATUS JEST PRZELACZNIKIEM, NIE PLAKIETKA. Odwolanie wydarzenia i cofniecie
// go do szkicu to czynnosci rzadkie, ale musza byc osiagalne bez szukania -
// dlatego chip stanu otwiera menu, zamiast tylko informowac.
//
// PUBLIKACJA NIE PYTA O ZGODE DRUGI RAZ, gdy nie ma o co pytac: warunki
// (oba tytuly, termin) sprawdza baza i odmawia nazwanym bledem. Ekran nie
// powtarza tej reguly, tylko pokazuje jej wynik.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronDown, Loader2, Play } from "@/lib/lucide-shim";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { EventStatus } from "@/lib/events/eventDetailApi";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

const STATUS_LABEL_KEYS: Record<EventStatus, string> = {
  draft: "adminEvents.list.status.draft",
  published: "adminEvents.list.status.published",
  cancelled: "adminEvents.list.status.cancelled",
};

export function EventStudioTopBar({
  status,
  isBusy,
  previewOpen,
  onTogglePreview,
  onStatusChange,
}: {
  status: EventStatus;
  isBusy: boolean;
  previewOpen: boolean;
  onTogglePreview: () => void;
  onStatusChange: (status: EventStatus) => void;
}) {
  ensureAdminEventsI18n();
  const { t } = useTranslation();
  const [statusOpen, setStatusOpen] = useState(false);

  const pick = (next: EventStatus) => {
    setStatusOpen(false);
    onStatusChange(next);
  };

  return (
    <header className="sticky top-0 z-30 flex h-[3.25rem] items-center gap-3 border-b border-border bg-card px-3">
      <Link
        to="/admin/events/list"
        className="flex items-center gap-2 text-sm font-semibold text-foreground"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand/10 text-brand">
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="hidden sm:inline">{t("adminEvents.studio.topBar.studio")}</span>
      </Link>

      <Popover open={statusOpen} onOpenChange={setStatusOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                status === "published" && "bg-emerald-500",
                status === "draft" && "bg-amber-500",
                status === "cancelled" && "bg-destructive",
              )}
              aria-hidden="true"
            />
            {t(STATUS_LABEL_KEYS[status])}
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-1">
          {(["draft", "published", "cancelled"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => pick(value)}
              disabled={value === status}
              className={cn(
                "flex w-full items-center rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted",
                value === status && "font-medium text-muted-foreground",
              )}
            >
              {t(STATUS_LABEL_KEYS[value])}
            </button>
          ))}
        </PopoverContent>
      </Popover>

      {/* Rozpiera pasek: akcje maja stac po PRAWEJ, tak jak we wzorcu. */}
      <span className="flex-1" aria-hidden="true" />

      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 text-xs"
        aria-pressed={previewOpen}
        onClick={onTogglePreview}
      >
        <Play className="h-3.5 w-3.5" aria-hidden="true" />
        {t("adminEvents.studio.topBar.preview")}
      </Button>

      <Button
        size="sm"
        className="h-8 text-xs"
        disabled={isBusy || status === "published"}
        onClick={() => onStatusChange("published")}
      >
        {isBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
        {t("adminEvents.studio.topBar.publish")}
      </Button>
    </header>
  );
}

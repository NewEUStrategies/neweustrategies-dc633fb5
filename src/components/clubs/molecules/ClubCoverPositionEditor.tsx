// Dostosowanie pionowej pozycji cover photo bez uploadu nowego pliku.
//
// Dostępne dla prowadzących klub (`can_moderate`) i administracji. Slider 0–100
// przekłada się na `object-position: center <Y>%` obrazka - 0 to góra, 100 to dół.
// Zmiana jest zapisywana dopiero przyciskiem "Zapisz", ale podgląd aktualizuje
// się na żywo.
//
// PODGLĄD W PROPORCJACH STRONY, NIE W STAŁEJ 4:1. Pierwsza wersja rysowała
// ramkę `padding-top: 25%`, a pas nagłówka ma od `sm` stałą wysokość przy
// płynnej szerokości - jego proporcja chodzi od ~2.6:1 do ~7.4:1. Na desktopie
// podgląd pokazywał więc więcej zdjęcia niż strona, a dla pliku 4:1 (dokładnie
// tego, który zaleca podpowiedź) suwak w podglądzie nie ruszał niczego. Teraz:
//   * ramka główna ma proporcję pasa zmierzoną w chwili otwarcia (`frameRef`),
//     czyli to, co widzi osoba ustawiająca kadr na swoim ekranie,
//   * pod nią stoją miniatury pozostałych powierzchni (bramka i minisite na
//     telefonie i komputerze, kafel katalogu) - ten sam kadr, ich proporcje.
"use client";

import { useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
// Nakładka słownika klubów rejestruje klucze efektem ubocznym importu - bez
// tej linii tłumaczenia edytora zależałyby od tego, czy inny moduł w chunku
// przypadkiem ją wciągnął (bramka check:i18n-overlay-imports).
import "@/lib/i18n-club";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MoveVertical } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import {
  CLUB_COVER_HUB_FALLBACK_RATIO,
  CLUB_COVER_PREVIEW_FRAMES,
  clubCoverObjectPosition,
  measureFrameRatio,
  normalizeClubCoverPositionY,
} from "@/lib/clubs/coverFrame";
import { setClubCoverPosition } from "@/lib/clubs/coverPosition.functions";
import { ensureClubI18n } from "@/lib/i18n-club";
import { cn } from "@/lib/utils";

/** Ramka podglądu: zdjęcie przycięte tak, jak przytnie je dana powierzchnia. */
function PreviewFrame({
  src,
  ratio,
  objectPosition,
  testId,
  className,
}: {
  src: string;
  ratio: number;
  objectPosition: string;
  testId: string;
  className?: string;
}) {
  return (
    <div
      className={cn("relative w-full overflow-hidden rounded-lg bg-muted", className)}
      style={{ aspectRatio: String(ratio) }}
      data-testid={testId}
    >
      <img
        src={src}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        style={{ objectPosition }}
        loading="eager"
        decoding="async"
      />
    </div>
  );
}

export function ClubCoverPositionEditor({
  clubId,
  coverImageUrl,
  positionY,
  frameRef,
  canEdit,
  onChanged,
  className,
}: {
  clubId: string;
  coverImageUrl: string | null;
  positionY: number;
  /** Pas okładki na stronie - jego proporcja wyznacza ramkę główną podglądu. */
  frameRef?: RefObject<HTMLElement | null>;
  canEdit: boolean;
  onChanged: () => void;
  className?: string;
}) {
  // Bez tego wiązania nakładka `i18n-club` wchodziła do chunka tylko przypadkiem
  // - razem z innym komponentem klubu. Gdy edytor renderował się sam, nagłówek
  // pokazywał surowe `club.hub.identity.cover.position.*` zamiast napisów.
  ensureClubI18n();
  const { t } = useTranslation();
  const save = useServerFn(setClubCoverPosition);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(() => normalizeClubCoverPositionY(positionY));
  const [pageRatio, setPageRatio] = useState(CLUB_COVER_HUB_FALLBACK_RATIO);
  const [busy, setBusy] = useState(false);

  if (!canEdit || typeof coverImageUrl !== "string" || coverImageUrl.trim() === "") {
    return null;
  }

  const handleOpen = (next: boolean) => {
    setOpen(next);
    if (next) {
      setValue(normalizeClubCoverPositionY(positionY));
      setPageRatio(measureFrameRatio(frameRef?.current));
    }
  };

  const handleSave = async () => {
    setBusy(true);
    try {
      await save({ data: { clubId, positionY: value } });
      toast.success(t("club.hub.identity.cover.position.saved"));
      setOpen(false);
      onChanged();
    } catch {
      toast.error(t("club.hub.identity.cover.position.failed"));
    } finally {
      setBusy(false);
    }
  };

  const objectPosition = clubCoverObjectPosition(value);

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className={cn("h-8 rounded-lg bg-background/80 px-2.5 text-xs backdrop-blur", className)}
          aria-label={t("club.hub.identity.cover.position.open")}
          title={t("club.hub.identity.cover.position.open")}
        >
          <MoveVertical className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {t("club.hub.identity.cover.position.label")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("club.hub.identity.cover.position.title")}</DialogTitle>
          <DialogDescription>{t("club.hub.identity.cover.position.hint")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <figure className="space-y-1.5">
            <PreviewFrame
              src={coverImageUrl}
              ratio={pageRatio}
              objectPosition={objectPosition}
              testId="cover-preview-page"
            />
            <figcaption className="text-xs text-muted-foreground">
              {t("club.hub.identity.cover.position.preview.page")}
            </figcaption>
          </figure>

          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{t("club.hub.identity.cover.position.top")}</span>
              <span className="font-medium tabular-nums text-foreground">{value}%</span>
              <span>{t("club.hub.identity.cover.position.bottom")}</span>
            </div>
            <Slider
              value={[value]}
              min={0}
              max={100}
              step={1}
              onValueChange={(values) => setValue(normalizeClubCoverPositionY(values[0]))}
              thumbProps={{ "aria-label": t("club.hub.identity.cover.position.slider") }}
            />
          </div>

          <div className="grid grid-cols-3 items-end gap-3">
            {CLUB_COVER_PREVIEW_FRAMES.map((frame) => (
              <figure key={frame.key} className="space-y-1.5">
                <PreviewFrame
                  src={coverImageUrl}
                  ratio={frame.ratio}
                  objectPosition={objectPosition}
                  testId={`cover-preview-${frame.key}`}
                  className="rounded-md"
                />
                <figcaption className="text-[11px] leading-tight text-muted-foreground">
                  {t(`club.hub.identity.cover.position.preview.${frame.key}`)}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
            {t("club.hub.identity.cover.position.cancel")}
          </Button>
          <Button type="button" size="sm" disabled={busy} onClick={() => void handleSave()}>
            {busy ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : null}
            {t("club.hub.identity.cover.position.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Dostosowanie pionowej pozycji cover photo w ramce 4:1 bez uploadu nowego pliku.
//
// Dostępne dla prowadzących klub (`can_moderate`) i administracji. Slider 0–100
// przekłada się na `object-position: center <Y>%` obrazka - 0 to góra, 100 to dół.
// Zmiana jest zapisywana dopiero przyciskiem "Zapisz", ale podgląd aktualizuje
// się na żywo, żeby użytkownik widział kadrowanie w tej samej proporcji co strona.
"use client";

import { useState } from "react";
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
import { setClubCoverPosition } from "@/lib/clubs/coverPosition.functions";
import { ensureClubI18n } from "@/lib/i18n-club";
import { cn } from "@/lib/utils";

export function ClubCoverPositionEditor({
  clubId,
  coverImageUrl,
  positionY,
  canEdit,
  onChanged,
  className,
}: {
  clubId: string;
  coverImageUrl: string | null;
  positionY: number;
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
  const [value, setValue] = useState(positionY);
  const [busy, setBusy] = useState(false);

  if (!canEdit || typeof coverImageUrl !== "string" || coverImageUrl.trim() === "") {
    return null;
  }

  const handleOpen = (next: boolean) => {
    setOpen(next);
    if (next) setValue(positionY);
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

  const objectPosition = `center ${value}%`;

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
          {/* Podgląd w tej samej proporcji 4:1 co okładka na stronie. */}
          <div className="relative w-full overflow-hidden rounded-lg" style={{ paddingTop: "25%" }}>
            <img
              src={coverImageUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              style={{ objectPosition }}
              loading="eager"
              decoding="async"
            />
          </div>

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
              onValueChange={(values) => setValue(values[0] ?? 50)}
              thumbProps={{ "aria-label": t("club.hub.identity.cover.position.slider") }}
            />
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

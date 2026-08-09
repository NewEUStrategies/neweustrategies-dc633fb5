// Edycja okładki NA MIEJSCU - w nagłówku klubu, bez wycieczki do admina.
//
// Kto widzi: prowadzenie klubu (`can_moderate`) i administracja. Reszta nie
// dostaje wyszarzonego przycisku, tylko nie widzi go wcale - przycisk, który
// zawsze kończy się błędem uprawnień, jest gorszy niż jego brak.
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  CLUB_COVER_ACCEPT_ATTR,
  CLUB_COVER_MAX_BYTES,
  checkClubCoverFile,
  setClubCover,
  uploadClubCover,
} from "@/lib/clubs/coverApi";
import { cn } from "@/lib/utils";

export function ClubCoverEditor({
  clubId,
  hasCover,
  onChanged,
  className,
}: {
  clubId: string;
  hasCover: boolean;
  /** Wywoływane po udanym zapisie - odświeżenie danych klubu należy do rodzica. */
  onChanged: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = () => {
    if (busy) return;
    inputRef.current?.click();
  };

  const handleFile = async (file: File) => {
    const rejection = checkClubCoverFile(file);
    if (rejection !== null) {
      toast.error(
        rejection.kind === "mime"
          ? t("club.hub.identity.cover.badType")
          : t("club.hub.identity.cover.tooLarge", {
              max: Math.round(CLUB_COVER_MAX_BYTES / (1024 * 1024)),
            }),
      );
      return;
    }
    setBusy(true);
    try {
      await uploadClubCover({ clubId, file });
      toast.success(t("club.hub.identity.cover.saved"));
      onChanged();
    } catch {
      toast.error(t("club.hub.identity.cover.failed"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await setClubCover({ clubId, url: null });
      toast.success(t("club.hub.identity.cover.removed"));
      onChanged();
    } catch {
      toast.error(t("club.hub.identity.cover.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <input
        ref={inputRef}
        type="file"
        accept={CLUB_COVER_ACCEPT_ATTR}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset wartości: bez tego wybranie TEGO SAMEGO pliku po nieudanym
          // zapisie nie wyemitowałoby zdarzenia `change`.
          event.target.value = "";
          if (file) void handleFile(file);
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="h-8 rounded-lg bg-background/80 px-2.5 text-xs backdrop-blur"
        disabled={busy}
        onClick={pick}
      >
        {busy ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <ImagePlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        )}
        {hasCover ? t("club.hub.identity.cover.change") : t("club.hub.identity.cover.add")}
      </Button>
      {hasCover ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 rounded-lg bg-background/60 px-2 text-xs backdrop-blur"
          disabled={busy}
          onClick={() => void remove()}
          aria-label={t("club.hub.identity.cover.remove")}
          title={t("club.hub.identity.cover.remove")}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}

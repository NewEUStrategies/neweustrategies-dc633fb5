// Wejscie "Zglos" przy wpisie klubowym.
//
// Osobny plik od samego dialogu, i to jest cala jego racja bytu: `lazy()`
// dzieli chunk wylacznie po granicy MODULU, wiec dopoki przycisk i dialog
// mieszkaly razem, dynamiczny import wracal do tego samego pliku i nic nie
// dzielil. Radix Dialog wchodzi do grafu KAZDEJ odslony watku (przycisk stoi
// przy watku i przy kazdej odpowiedzi), a otwiera sie raz na wiele tysiecy
// odslon - to jest dokladnie ta proporcja, dla ktorej repo trzyma
// `lazyBlockViews`.
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ClubReactionTarget } from "@/lib/clubs/types";
import { ensureClubI18n } from "@/lib/i18n-club";

const ClubReportDialogLazy = lazy(() =>
  import("./ClubReportDialog").then((m) => ({ default: m.ClubReportDialog })),
);

export function ClubReportButton({
  targetType,
  targetId,
  className,
}: {
  targetType: ClubReactionTarget;
  targetId: string;
  className?: string;
}) {
  ensureClubI18n();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className={`h-7 px-2 text-xs text-muted-foreground hover:text-destructive ${className ?? ""}`}
        onClick={() => setOpen(true)}
        aria-label={t("club.report.title")}
      >
        <Flag className="mr-1 h-3 w-3" aria-hidden="true" />
        {t("club.report.action")}
      </Button>
      {/* Dialog montuje sie dopiero po otwarciu: trzydziesci odpowiedzi na
          ekranie to trzydziesci uspionych dialogow, gdyby bylo inaczej. */}
      {open ? (
        <Suspense fallback={null}>
          <ClubReportDialogLazy
            targetType={targetType}
            targetId={targetId}
            open={open}
            onOpenChange={setOpen}
          />
        </Suspense>
      ) : null}
    </>
  );
}

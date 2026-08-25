// Molekuła: gwiazdka „zapamiętaj wydarzenie".
//
// STAN PRZYCISKU MIESZKA W NAGŁÓWKU, NIE TUTAJ. `event_page_header` oddaje
// `is_bookmarked` w tym samym wywołaniu, co reszta strony - osobne zapytanie
// o samą gwiazdkę dawałoby drugą chwilę w czasie i migotanie po hydracji.
//
// OPTYMISTYCZNIE, ALE Z POWROTEM. Gwiazdka przełącza się od razu (to jest cała
// jej wartość - jeden klik i lecimy dalej), a odmowa z bazy cofa ją i mówi,
// czego zabrakło. Bez cofnięcia uczestnik zostałby z gwiazdką, której nikt
// nie zapisał.
//
// GOŚĆ WIDZI PRZYCISK. `event_bookmark_toggle` wymaga sesji, więc gość dostaje
// podpowiedź „zaloguj się" zamiast zniknięcia kontrolki - ukryty przycisk nie
// zachęca do założenia konta, a to jest tu jedyny sens bramki.
import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useEventBookmark } from "@/lib/events/usePublicEvent";
import { publicEventErrorMessage } from "@/lib/events/publicEventErrors";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

export function EventBookmarkButton({
  eventSlug,
  isBookmarked,
  className,
}: {
  eventSlug: string;
  isBookmarked: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const bookmark = useEventBookmark();
  const [optimistic, setOptimistic] = useState(isBookmarked);

  // Prawda przyjeżdża z nagłówka - po unieważnieniu zapytania stan lokalny
  // musi się jej podporządkować, inaczej dwie karty tej samej strony pokazują
  // dwie różne gwiazdki.
  useEffect(() => {
    setOptimistic(isBookmarked);
  }, [isBookmarked]);

  const signedIn = user !== null;
  const label = optimistic ? t("eventFront.bookmarks.remove") : t("eventFront.bookmarks.add");

  const onClick = () => {
    if (!signedIn) {
      toast.info(t("eventFront.bookmarks.signInHint"));
      return;
    }
    const next = !optimistic;
    setOptimistic(next);
    bookmark.mutate(
      { eventSlug, state: next },
      {
        onSuccess: (result) => {
          setOptimistic(result.bookmarked);
          toast.success(
            result.bookmarked
              ? t("eventFront.bookmarks.addedToast")
              : t("eventFront.bookmarks.removedToast"),
          );
        },
        onError: (error) => {
          setOptimistic(!next);
          toast.error(publicEventErrorMessage(error));
        },
      },
    );
  };

  return (
    <Button
      type="button"
      variant={optimistic ? "secondary" : "outline"}
      size="sm"
      aria-pressed={optimistic}
      disabled={bookmark.isPending}
      onClick={onClick}
      className={cn("gap-2", className)}
    >
      <Star className={cn("h-4 w-4", optimistic && "fill-current")} aria-hidden="true" />
      {label}
    </Button>
  );
}

// Pasek "N nowych odpowiedzi - pokaz".
//
// Sticky NAD lista, nie pod nia: czytelnik deliberacji czyta z gory na dol,
// wiec informacja o nowej tresci ma byc tam, gdzie wroci, a nie tam, gdzie
// wlasnie jest. `aria-live="polite"` czyta komunikat, kiedy uzytkownik skonczy
// biezaca fraze - `assertive` przerywalby lekture w polowie zdania, czyli
// zrobilby to samo, przed czym ten pasek chroni.
import { useTranslation } from "react-i18next";
import { ArrowDownToLine } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ClubNewRepliesBar({
  count,
  onReveal,
  className,
}: {
  count: number;
  onReveal: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  if (count <= 0) return null;

  return (
    <div
      aria-live="polite"
      className={`sticky top-2 z-10 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 backdrop-blur ${className ?? ""}`}
    >
      <span className="text-sm font-medium">{t("club.newReplies", { count })}</span>
      <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" onClick={onReveal}>
        <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden="true" />
        {t("club.newRepliesShow")}
      </Button>
    </div>
  );
}

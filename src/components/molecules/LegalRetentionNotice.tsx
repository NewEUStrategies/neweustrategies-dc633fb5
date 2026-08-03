// Nota retencyjna: co ZOSTAJE po usunięciu konta i na jakiej podstawie.
//
// Prawo do usunięcia danych (art. 17 RODO) nie sięga dokumentacji, którą
// musimy przechowywać z mocy prawa - art. 17 ust. 3 lit. b RODO to wyłącza, a
// art. 74 ust. 2 ustawy o rachunkowości wyznacza 5-letni okres. Skoro więc
// część danych zostaje, użytkownik musi się o tym dowiedzieć PRZED kliknięciem,
// a nie z odpowiedzi na wniosek o dostęp - to obowiązek przejrzystości
// (art. 12-13 RODO). Baza realizuje ten wyjątek anonimizacją zamówień
// (migracja 20260803090002), a ten komponent go nazywa.
//
// Molekuła: ikona + treść w tonacji ostrzegawczej, bez własnych kolorów -
// wyłącznie tokeny semantyczne, więc wygląda spójnie w każdym motywie i na
// każdej powierzchni (karta „strefa niebezpieczna", dialog potwierdzenia).
import { ScrollText } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface LegalRetentionNoticeProps {
  /** `compact` dla dialogu (mniejszy tekst, bez tła), `card` dla sekcji strony. */
  variant?: "card" | "compact";
  className?: string;
}

export function LegalRetentionNotice({ variant = "card", className }: LegalRetentionNoticeProps) {
  const { t } = useTranslation();
  const compact = variant === "compact";

  return (
    <aside
      data-testid="legal-retention-notice"
      className={[
        "flex gap-3 rounded-[5px] text-left",
        compact ? "px-0 py-1" : "border border-border bg-muted/40 px-4 py-3",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span
        aria-hidden="true"
        className={[
          "grid shrink-0 place-items-center rounded-full bg-muted text-muted-foreground",
          compact ? "h-7 w-7" : "h-9 w-9",
        ].join(" ")}
      >
        <ScrollText className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
      </span>
      <div className={compact ? "grid gap-1 text-xs" : "grid gap-1 text-sm"}>
        <p className="font-medium text-foreground">{t("profile.security.danger.retentionTitle")}</p>
        <p className="text-muted-foreground">{t("profile.security.danger.retentionBody")}</p>
        <p className="text-muted-foreground">{t("profile.security.danger.retentionBasis")}</p>
      </div>
    </aside>
  );
}

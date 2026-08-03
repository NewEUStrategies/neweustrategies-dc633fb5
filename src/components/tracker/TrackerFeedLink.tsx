// Atom: wejście do kanału RSS trackera (/tracker/rss.xml).
//
// Świadomie zwykły <a>, nie <Link>: celem jest dokument XML obsługiwany przez
// server handler trasy, więc nawigacja klienta TanStacka nie ma tu czego
// wyrenderować. `hrefLang` + prefiks języka trzymają parytet PL/EN, a tytuł
// mówi wprost, co czytelnik dostanie - autodiscovery w <head> obsługuje
// czytniki, ten link obsługuje człowieka.
import { useTranslation } from "react-i18next";
import { Rss } from "lucide-react";
import { localizedPath } from "@/lib/i18n/localePath";
import { cn } from "@/lib/utils";

interface TrackerFeedLinkProps {
  className?: string;
}

export function TrackerFeedLink({ className }: TrackerFeedLinkProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const href = localizedPath("/tracker/rss.xml", lang);
  return (
    <a
      href={href}
      hrefLang={lang}
      type="application/rss+xml"
      className={cn(
        "inline-flex items-center gap-1.5 text-primary transition-colors hover:underline",
        className,
      )}
      title={t("tracker.feed.title")}
    >
      <Rss className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {t("tracker.feed.link")}
    </a>
  );
}

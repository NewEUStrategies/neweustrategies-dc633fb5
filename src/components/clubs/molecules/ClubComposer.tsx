// Kompozytor na szczycie strumienia - wejście do rozmowy.
//
// PO CO. Założenie tematu było przyciskiem w nagłówku, obok sześciu innych
// przycisków. W strumieniu społecznościowym miejsce, w którym się PISZE, jest
// pierwszą rzeczą pod nagłówkiem i wygląda jak pole, a nie jak link - bo to
// jedyny sposób, żeby napisanie czegoś wyglądało na czynność oczekiwaną,
// a nie na funkcję administracyjną.
//
// To NIE jest formularz. Pełny kompozytor (tytuł, treść, dział, kotwica,
// anonimowość) żyje na /new i tam zostaje - dublowanie go tutaj oznaczałoby
// dwa miejsca do utrzymania i dwa zestawy walidacji. To jest wyzwalacz, który
// przenosi do /new z JUŻ WYBRANYM rodzajem wątku.
//
// KTO GO NIE WIDZI. Osoba bez prawa założenia tematu (`can_post_thread`).
// Pole tekstowe, które po kliknięciu mówi "nie wolno", jest gorsze niż jego
// brak - dlatego zamiast niego pokazujemy zdanie o tym, kto tu pisze.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { HelpCircle, MessageSquarePlus, PenLine, Scale, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { HUB_SURFACE } from "@/components/clubs/atoms/ClubHubPrimitives";
import type { ClubThreadKind } from "@/lib/clubs/types";

/** Skróty rodzajów. Trzy, nie sześć: to ma być zachęta, nie droplista. */
const SHORTCUTS: ReadonlyArray<{ kind: ClubThreadKind; icon: LucideIcon }> = [
  { kind: "discussion", icon: MessageSquarePlus },
  { kind: "question", icon: HelpCircle },
  { kind: "position", icon: Scale },
];

export function ClubComposer({
  clubSlug,
  canPost,
  whoCanPost,
  className,
}: {
  clubSlug: string;
  canPost: boolean;
  /** Z `clubs.who_can_post` - zdanie o tym, kto zakłada tematy w tym klubie. */
  whoCanPost: string;
  className?: string;
}) {
  const { t } = useTranslation();

  if (!canPost) {
    return (
      <p className={cn(HUB_SURFACE, "px-4 py-3 text-sm text-muted-foreground", className)}>
        {t(`club.hub.composer.closed.${whoCanPost === "members" ? "members" : "moderators"}`)}
      </p>
    );
  }

  return (
    <div className={cn(HUB_SURFACE, "p-3", className)}>
      <Link
        to="/club/$clubSlug/new"
        params={{ clubSlug }}
        className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        <PenLine className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{t("club.hub.composer.placeholder")}</span>
      </Link>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {SHORTCUTS.map(({ kind, icon: Icon }) => (
          <Link
            key={kind}
            to="/club/$clubSlug/new"
            params={{ clubSlug }}
            search={{ kind }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t(`club.kind.${kind}`)}
          </Link>
        ))}
      </div>
    </div>
  );
}

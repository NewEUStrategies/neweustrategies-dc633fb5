// Molekuła: zwarta karta linku - w kompozytorze (z „×") i pod komentarzem.
//
// DLACZEGO ZWARTA, A NIE JAK POD WPISEM. Pod wpisem podgląd jest treścią
// i sięga krawędzi karty (`LinkAttachmentCard`, obraz 1.91:1). Komentarz jest
// dopowiedzeniem w dymku - pełnoszeroki obraz zrobiłby z niego drugi wpis.
// Tu obraz jest kwadratową miniaturą po lewej, a obok stoi serwis i PEŁNY
// tytuł (zawija się, nie ucina). Opis zostaje poza kartą - tak samo jak pod
// wpisem, gdzie żyje w dymku.
//
// TA SAMA KARTA W OBU MIEJSCACH. Autor widzi w kompozytorze dokładnie to, co
// po wysyłce zobaczą czytelnicy - migawka zapisana przy komentarzu ma te same
// pięć pól, z których rysuje się podgląd.
//
// OGŁOSZENIE DLA CZYTNIKA EKRANU stoi OSOBNO (`ClubComposerLinkStatus`) i jest
// zamontowane zawsze. Region `aria-live` wstawiony do DOM-u razem ze swoją
// treścią nie jest odczytywany, a karta pojawia się dopiero, gdy autor wpisze
// adres - więc region w samej karcie milczał przy wczytywaniu i znikał razem
// ze szkieletem, zanim przyszła gotowa migawka.
//
// BEZPIECZEŃSTWO. Migawka przychodzi już znormalizowana (`parseClubLinkSnapshot`
// / `clubLinkSnapshotFromPreview`: tylko https, długości jak w RPC), a link
// wychodzący dostaje `rel="nofollow ugc noopener noreferrer"` - to treść
// członków, jak każdy adres w `ClubInlineText`.
import { useTranslation } from "react-i18next";
import { Link2, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { ClubLinkSnapshot } from "@/lib/clubs/postTypes";
import { cn } from "@/lib/utils";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const FRAME = "flex min-w-0 items-stretch overflow-hidden rounded-lg border border-border/70";

function Thumb({ image }: { image: string | null }) {
  if (image === null) {
    return (
      <span
        aria-hidden="true"
        className="grid w-12 shrink-0 place-items-center border-r border-border/60 bg-secondary text-muted-foreground"
      >
        <Link2 className="h-4 w-4" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="relative w-[4.5rem] shrink-0 self-stretch bg-secondary">
      <img
        src={image}
        alt=""
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
      />
    </span>
  );
}

function Lines({ snapshot, interactive }: { snapshot: ClubLinkSnapshot; interactive: boolean }) {
  return (
    <span className="flex min-h-[4.5rem] min-w-0 flex-1 flex-col justify-center gap-0.5 px-3 py-2">
      <span className="block text-xs leading-4 text-muted-foreground [overflow-wrap:anywhere]">
        {snapshot.siteName ?? hostOf(snapshot.url)}
      </span>
      <span
        className={cn(
          "block text-sm font-semibold leading-5 text-foreground [overflow-wrap:anywhere]",
          interactive && "group-hover/link:underline",
        )}
      >
        {snapshot.title ?? snapshot.url}
      </span>
    </span>
  );
}

/** Karta linku pod komentarzem - cała jest odnośnikiem do źródła. */
export function ClubLinkSnapshotCard({
  snapshot,
  className,
}: {
  snapshot: ClubLinkSnapshot;
  className?: string;
}) {
  return (
    <a
      href={snapshot.url}
      target="_blank"
      rel="nofollow ugc noopener noreferrer"
      data-testid="club-comment-link-card"
      className={cn(
        FRAME,
        "group/link bg-card transition-colors hover:border-primary/40 hover:bg-secondary/60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <Thumb image={snapshot.image} />
      <Lines snapshot={snapshot} interactive />
    </a>
  );
}

/**
 * Karta linku w kompozytorze: wczytywanie (szkielet) albo gotowa migawka,
 * zawsze z „×". Ogłoszenie dla czytnika ekranu - `ClubComposerLinkStatus`.
 */
export function ClubComposerLinkCard({
  url,
  snapshot,
  loading,
  onDismiss,
  className,
}: {
  url: string;
  snapshot: ClubLinkSnapshot | null;
  loading: boolean;
  onDismiss: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t("club.comments.link.label")}
      aria-busy={loading || undefined}
      data-testid="club-composer-link-card"
      data-url={url}
      className={cn(FRAME, "club-feed-picker-in relative bg-card", className)}
    >
      {loading || snapshot === null ? (
        <span className="flex min-h-[4.5rem] min-w-0 flex-1 items-center gap-3 px-3 py-2">
          <Skeleton className="h-12 w-12 shrink-0 rounded-md" />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-xs leading-4 text-muted-foreground">
              {t("club.comments.link.loading")}
            </span>
            <Skeleton className="h-3.5 w-3/4" />
          </span>
        </span>
      ) : (
        <>
          <Thumb image={snapshot.image} />
          <Lines snapshot={snapshot} interactive={false} />
        </>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("club.comments.link.dismiss")}
        data-testid="club-composer-link-dismiss"
        className="m-1 grid h-7 w-7 shrink-0 place-items-center self-start rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Stan podglądu linku w kompozytorze - tyle, ile potrzebuje ogłoszenie. */
export interface ClubComposerLinkState {
  url: string | null;
  loading: boolean;
  snapshot: ClubLinkSnapshot | null;
}

/**
 * Region statusu podglądu linku - ZAWSZE zamontowany obok kompozytora.
 *
 * Czytnik ekranu słyszy, że podgląd się wczytuje, a potem - że jest gotowy
 * i co pojedzie z treścią (serwis i tytuł). Bez adresu w szkicu region jest
 * pusty, ale stoi w DOM-ie: dopiero zmiana treści ISTNIEJĄCEGO regionu jest
 * ogłaszana.
 */
export function ClubComposerLinkStatus({ link }: { link: ClubComposerLinkState | null }) {
  const { t } = useTranslation();
  const message =
    link === null || link.url === null
      ? ""
      : link.loading || link.snapshot === null
        ? t("club.comments.link.loading")
        : t("club.comments.link.ready", {
            site: link.snapshot.siteName ?? hostOf(link.snapshot.url),
            title: link.snapshot.title ?? link.snapshot.url,
          });
  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      data-testid="club-composer-link-status"
    >
      {message}
    </span>
  );
}

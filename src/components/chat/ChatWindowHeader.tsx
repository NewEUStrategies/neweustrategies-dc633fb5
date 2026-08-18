// Molekuła: nagłówek okna rozmowy w obu wariantach powierzchni.
//
//   variant="page" - pasek nad prawym panelem trasy /messages (z powrotem na
//                    listę na mobile, przyciski w rzędzie, tło card/blur),
//   variant="dock" - belka pływającego okna w prawym dolnym rogu.
//
// Do tej pory oba paski żyły jako dwa niezależne bloki JSX na końcu
// `ChatWindow`, po ~60 linii każdy, i już się rozjechały: wariant dokowany
// zgubił plakietkę „przypięte", a jego avatar liczył presence inaczej
// (`!isGroup && peerOnline` vs `peerOnline`). Jedna molekuła z jawnym
// `variant` sprawia, że różnice są WIDOCZNE i policzalne, a nie przypadkowe.
//
// Podtytuł dostajemy jako DESKRYPTOR (`HeaderSubtitle` z `lib/chat/thread`),
// nie jako gotowy napis - odmiana liczebników („2 uczestnicy" vs „5
// uczestników") należy do słownika PL/EN, a nie do logiki wątku.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, BellOff, Pin } from "lucide-react";
import type { HeaderSubtitle } from "@/lib/chat/thread";
import { cn } from "@/lib/utils";
import { ChatAvatar } from "./ChatAvatar";

export interface ChatWindowHeaderProps {
  variant: "dock" | "page";
  /** Nazwa rozmówcy (wątek bezpośredni) albo tytuł kręgu. */
  name: string;
  avatarUrl: string | null;
  /** Slug profilu publicznego - avatar staje się linkiem do /author/$slug. */
  slug: string | null;
  isGroup: boolean;
  /** Presence rozmówcy; w kręgu zawsze bez kropki (liczba online jest w podtytule). */
  peerOnline: boolean;
  subtitle: HeaderSubtitle;
  muted: boolean;
  pinned: boolean;
  /** Wariant "page" na mobile: powrót do listy rozmów. */
  onBack?: () => void;
  /** Krąg: kliknięcie tożsamości otwiera informacje o kręgu. */
  onOpenGroupInfo: () => void;
  /** Rząd akcji (szukaj / media / menu / minimalizuj / zamknij) - slot organizmu. */
  actions: ReactNode;
}

const CHROME_CLASS: Record<ChatWindowHeaderProps["variant"], string> = {
  page: "flex items-center gap-1.5 border-b border-border/60 bg-card/80 px-2.5 py-2 backdrop-blur supports-[backdrop-filter]:bg-card/70 sm:gap-2.5 sm:px-4 sm:py-3",
  dock: "flex items-center gap-1.5 border-b border-border/60 bg-background px-3 py-2 shadow-sm",
};

/** Plakietki stanu rozmowy - wyciszenie i przypięcie, w tej kolejności. */
function StateBadges({
  muted,
  pinned,
  size,
  mutedLabel,
  pinnedLabel,
}: {
  muted: boolean;
  pinned: boolean;
  size: string;
  mutedLabel: string;
  pinnedLabel: string;
}) {
  return (
    <>
      {muted && (
        <BellOff className={cn(size, "shrink-0 text-muted-foreground")} aria-label={mutedLabel} />
      )}
      {pinned && (
        <Pin className={cn(size, "shrink-0 text-muted-foreground")} aria-label={pinnedLabel} />
      )}
    </>
  );
}

export function ChatWindowHeader(props: ChatWindowHeaderProps) {
  const { t } = useTranslation();
  const { variant, name, avatarUrl, slug, isGroup, peerOnline, subtitle, muted, pinned } = props;

  const subtitleText =
    subtitle.kind === "group"
      ? `${t("chat.group.members", { count: subtitle.members })}${
          subtitle.online > 0 ? ` · ${t("chat.group.online", { count: subtitle.online })}` : ""
        }`
      : subtitle.online
        ? t("chat.online")
        : t("chat.offline");

  const badgeSize = variant === "dock" ? "h-3.5 w-3.5" : "h-3 w-3";
  const badges = (
    <StateBadges
      muted={muted}
      // Wariant dokowany nie pokazuje przypięcia: belka ma 420 px i rząd akcji
      // z pięcioma przyciskami, więc plakietka wypychałaby nazwę rozmówcy.
      pinned={variant === "page" && pinned}
      size={badgeSize}
      mutedLabel={t("chat.menu.mutedBadge")}
      pinnedLabel={t("chat.menu.pinnedBadge")}
    />
  );

  const identity =
    variant === "dock" ? (
      <>
        <ChatAvatar
          name={name}
          avatarUrl={avatarUrl}
          online={!isGroup && peerOnline}
          size="md"
          to={slug ? `/author/${slug}` : undefined}
        />
        <div className="min-w-0 flex-1 pl-0.5">
          <div className="flex items-center gap-1 truncate text-[14px] font-semibold leading-tight">
            <span className="truncate">{name}</span>
            {badges}
          </div>
          <div className="text-[11px] leading-tight text-muted-foreground">{subtitleText}</div>
        </div>
      </>
    ) : isGroup ? (
      <button
        type="button"
        onClick={props.onOpenGroupInfo}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[6px] text-left transition-colors hover:bg-muted/40"
        aria-haspopup="dialog"
        aria-label={t("chat.group.info")}
        title={t("chat.group.info")}
      >
        {/* Krąg nigdy nie ma sluga (to profil OSOBY), więc avatar świadomie
            nie dostaje `to` - link w środku przycisku otwierającego dialog
            byłby zresztą zagnieżdżoną kontrolką. */}
        <ChatAvatar name={name} avatarUrl={avatarUrl} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 truncate text-sm font-semibold">
            <span className="truncate">{name}</span>
            {badges}
          </span>
          <span className="block text-[11px] text-muted-foreground">{subtitleText}</span>
        </span>
      </button>
    ) : (
      <>
        {/* Wariant „page" też linkuje do profilu publicznego. Organizm przed
            refaktorem tego nie robił (linkował TYLKO dock), więc z /messages
            nie dało się przejść na profil rozmówcy - a z tego samego wątku
            w oknie dokowanym owszem. Ta sama tożsamość, ta sama akcja. */}
        <ChatAvatar
          name={name}
          avatarUrl={avatarUrl}
          online={peerOnline}
          size="sm"
          to={slug ? `/author/${slug}` : undefined}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 truncate text-sm font-semibold">
            <span className="truncate">{name}</span>
            {badges}
          </div>
          <div className="text-[11px] text-muted-foreground">{subtitleText}</div>
        </div>
      </>
    );

  const chrome = (
    <>
      {variant === "page" && props.onBack && (
        <button
          type="button"
          onClick={props.onBack}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
          aria-label={t("chat.messages")}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </button>
      )}
      {identity}
      {props.actions}
    </>
  );

  if (variant === "dock") return <header className={CHROME_CLASS.dock}>{chrome}</header>;
  return <div className={CHROME_CLASS.page}>{chrome}</div>;
}

import { AppLink } from "@/components/atoms/AppLink";
import { safeImageUrl } from "@/lib/sanitize";

type Lang = "pl" | "en";

export interface AuthorInlineProps {
  name: string;
  /** Public avatar URL; when empty a muted placeholder is rendered. */
  avatarUrl?: string | null;
  /** Optional profile link. */
  href?: string | null;
  lang?: Lang;
  /** Show avatar image left of the name. */
  showAvatar?: boolean;
  /** Font size for the author name in px. Default: 12 (matches the site-wide widget default). */
  fontSizePx?: number;
  /** Avatar size in px. Default: 20 (matches the site-wide widget default). */
  avatarSizePx?: number;
  /** Border radius for the avatar in px. Default: 6. */
  avatarRadiusPx?: number;
  className?: string;
  /** Called when the avatar image fails to load. */
  onAvatarError?: () => void;
}

/**
 * Standard inline author chip used across builder widgets.
 *
 * Defaults (font 12 px, avatar 20 px, radius 6 px) are the project-wide widget
 * baseline. Widgets that expose their own size overrides can pass custom
 * values; everything else falls back to the same single source of truth.
 */
export function AuthorInline({
  name,
  avatarUrl,
  href,
  lang = "pl",
  showAvatar = true,
  fontSizePx = 12,
  avatarSizePx = 20,
  avatarRadiusPx = 6,
  className = "",
  onAvatarError,
}: AuthorInlineProps) {
  const safeName = name.trim();
  if (!safeName) return null;

  const safeAvatar = safeImageUrl(avatarUrl ?? undefined);
  const style: React.CSSProperties = {
    fontSize: `${fontSizePx}px`,
    lineHeight: 1.35,
  };
  const avatarStyle: React.CSSProperties = {
    width: avatarSizePx,
    height: avatarSizePx,
    borderRadius: avatarRadiusPx,
  };

  const avatar = showAvatar ? (
    safeAvatar ? (
      <img
        src={safeAvatar}
        alt=""
        width={avatarSizePx}
        height={avatarSizePx}
        loading="lazy"
        decoding="async"
        className="shrink-0 object-cover"
        style={avatarStyle}
        onError={onAvatarError}
      />
    ) : (
      <span aria-hidden className="shrink-0 bg-muted" style={avatarStyle} />
    )
  ) : null;

  const inner = (
    <>
      {avatar}
      <span className="truncate" style={style} data-typography-exempt>
        {safeName}
      </span>
    </>
  );

  const baseCls = `inline-flex min-w-0 items-center gap-1.5 font-medium text-muted-foreground transition-colors hover:text-primary ${className}`;

  if (href) {
    return (
      <AppLink href={href} className={baseCls} style={style} data-typography-exempt>
        {inner}
      </AppLink>
    );
  }

  return (
    <span className={baseCls} style={style} data-typography-exempt>
      {inner}
    </span>
  );
}

/**
 * Localized label used above the author name in author cards.
 * Kept next to AuthorInline so cards stay consistent.
 */
export function authorLabel(lang: Lang): string {
  return lang === "en" ? "Author" : "Autor";
}

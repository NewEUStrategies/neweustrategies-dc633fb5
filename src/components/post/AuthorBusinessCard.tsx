// Wizytówka autora materiału - renderowana w sidebarze wpisu,
// między widgetem odsłuchu a spisem treści. Premium, kompaktowy,
// w pełni responsywny i bilingualny (PL/EN).
import { AppLink } from "@/components/atoms/AppLink";
import { BrandIcon } from "@/components/atoms/BrandIcon";
import { XIcon } from "@/components/atoms/XIcon";
import { Facebook, Linkedin, Globe, Mail, User as UserIcon, Check, Plus } from "@/lib/lucide-shim";
import { Instagram } from "lucide-react";
import { safeUrl } from "@/lib/sanitize";
import { useFollows, useToggleFollow } from "@/hooks/useFollows";
import { useAuth } from "@/hooks/useAuth";
import { usePersonalizedSettings } from "@/hooks/usePersonalizedSettings";
import { openLoginPopup } from "@/lib/loginPopupBus";
import { toast } from "sonner";

type Lang = "pl" | "en";

interface SocialItem {
  key: string;
  url: string;
  label: string;
  Fallback: React.ComponentType<{ className?: string }>;
}

const L = {
  pl: {
    about: "O autorze",
    viewProfile: "Zobacz profil",
    email: "E-mail",
    follow: "Obserwuj autora",
    following: "Obserwujesz",
    followHint: "Otrzymuj powiadomienia o nowych publikacjach",
    followError: "Nie udało się zaktualizować obserwacji",
  },
  en: {
    about: "About the author",
    viewProfile: "View profile",
    email: "Email",
    follow: "Follow author",
    following: "Following",
    followHint: "Get notified about new publications",
    followError: "Could not update follow state",
  },
} as const;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

export interface AuthorBusinessCardProps {
  lang: Lang;
  name: string | null;
  authorId?: string | null;
  avatarUrl?: string | null;
  href?: string | null;
  jobTitle?: string | null;
  company?: string | null;
  /** @deprecated bio nie jest już wyświetlany w karcie */
  bio?: string | null;
  email?: string | null;
  xUrl?: string | null;
  linkedinUrl?: string | null;
  facebookUrl?: string | null;
  instagramUrl?: string | null;
  websiteUrl?: string | null;
  spotifyUrl?: string | null;
  customSocials?: Array<{ label: string; url: string; iconUrl?: string }> | null;
}

export function AuthorBusinessCard({
  lang,
  name,
  authorId,
  avatarUrl,
  href,
  jobTitle,
  company,
  email,
  xUrl,
  linkedinUrl,
  facebookUrl,
  instagramUrl,
  websiteUrl,
  spotifyUrl,
  customSocials,
}: AuthorBusinessCardProps) {
  const t = L[lang];
  const displayName = name?.trim() || (lang === "en" ? "Author" : "Autor");
  const fallbackInitials = initials(displayName);
  const hasMeta = Boolean(jobTitle || company);

  const { user } = useAuth();
  const personalized = usePersonalizedSettings();
  const { data: follows } = useFollows();
  const toggleFollow = useToggleFollow();
  // "Follow author" powinien być gated jedynie flagą kontekstową dla nagłówka
  // autora - `personalized.enabled` reguluje sekcje rekomendacji, nie samą
  // relację obserwacji, która ma sens także przy wyłączonej personalizacji.
  const canFollow = Boolean(authorId) && personalized.followInAuthorHeader !== false;
  const isFollowing = canFollow
    ? (follows ?? []).some((f) => f.target_type === "author" && f.target_id === authorId)
    : false;

  const handleFollow = () => {
    if (!authorId) return;
    if (!user) {
      openLoginPopup({
        title: personalized.restrictedTitle,
        description: personalized.restrictedDescription,
      });
      return;
    }
    toggleFollow.mutate(
      { targetType: "author", targetId: authorId, on: !isFollowing },
      { onError: () => toast.error(t.followError) },
    );
  };

  const socials: SocialItem[] = [
    { key: "x", url: xUrl ?? "", label: "X", Fallback: XIcon },
    { key: "linkedin", url: linkedinUrl ?? "", label: "LinkedIn", Fallback: Linkedin },
    { key: "facebook", url: facebookUrl ?? "", label: "Facebook", Fallback: Facebook },
    { key: "instagram", url: instagramUrl ?? "", label: "Instagram", Fallback: Instagram },
    { key: "website", url: websiteUrl ?? "", label: "Website", Fallback: Globe },
  ].filter((s) => Boolean(s.url));

  const hasCustom = (customSocials ?? []).length > 0;
  const hasAnySocial = socials.length > 0 || hasCustom || Boolean(email);

  return (
    <aside
      className="rounded-[6px] border border-border/70 bg-background/95 p-4 shadow-[0_8px_30px_-10px_rgba(0,0,0,0.18)] backdrop-blur-xl"
      aria-label={t.about}
    >
      <div className="flex items-start gap-3">
        {avatarUrl ? (
          <AppLink href={href || "#"} className="relative shrink-0" aria-label={displayName}>
            <img
              src={avatarUrl}
              alt={displayName}
              loading="lazy"
              decoding="async"
              className="h-14 w-14 rounded-[6px] object-cover ring-2 ring-border/60 shadow-sm transition-transform duration-300 hover:scale-[1.03]"
            />
          </AppLink>
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[6px] bg-muted ring-2 ring-border/60 shadow-sm">
            {fallbackInitials ? (
              <span className="font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
                {fallbackInitials}
              </span>
            ) : (
              <UserIcon className="h-6 w-6 text-muted-foreground" aria-hidden />
            )}
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="min-w-0 text-sm font-semibold leading-tight text-foreground">
            {href ? (
              <AppLink href={href} className="hover:text-[color:var(--brand)] hover:underline">
                {displayName}
              </AppLink>
            ) : (
              displayName
            )}
          </h3>
          {hasMeta && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {[jobTitle, company].filter(Boolean).join(" · ")}
            </p>
          )}
          {href && (
            <AppLink
              href={href}
              className="mt-1 inline-flex items-center gap-1 self-start text-[11px] font-medium text-[color:var(--brand)] hover:underline"
            >
              {t.viewProfile}
              <span aria-hidden>→</span>
            </AppLink>
          )}
        </div>
      </div>

      {canFollow && (
        <div className="mt-3">
          <button
            type="button"
            onClick={handleFollow}
            aria-pressed={isFollowing}
            aria-label={isFollowing ? t.following : t.follow}
            title={t.followHint}
            disabled={toggleFollow.isPending}
            className={[
              "group inline-flex w-full items-center justify-center gap-1.5 rounded-[6px] px-3 py-1.5 text-xs font-semibold transition-all duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand)]/40",
              isFollowing
                ? "border border-[color:var(--brand)]/40 bg-[color:var(--brand)]/10 text-[color:var(--brand)] hover:bg-[color:var(--brand)]/15"
                : "border border-transparent bg-[color:var(--brand)] text-[color:var(--brand-foreground,white)] hover:opacity-90",
              toggleFollow.isPending ? "opacity-70" : "",
            ].join(" ")}
          >
            {isFollowing ? (
              <Check className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Plus
                className="h-3.5 w-3.5 transition-transform duration-200 group-hover:rotate-90"
                aria-hidden
              />
            )}
            <span>{isFollowing ? t.following : t.follow}</span>
          </button>
        </div>
      )}

      {hasAnySocial && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {socials.map(({ key, url, label, Fallback }) => (
            <a
              key={key}
              href={safeUrl(url) || "#"}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={label}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] border border-border/70 bg-muted/50 text-foreground/80 transition-colors hover:border-[color:var(--brand)]/50 hover:text-[color:var(--brand)]"
            >
              <BrandIcon name={key} fallback={Fallback} className="h-3.5 w-3.5" alt={label} />
            </a>
          ))}
          {email && (
            <a
              href={`mailto:${email}`}
              aria-label={t.email}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] border border-border/70 bg-muted/50 text-foreground/80 transition-colors hover:border-[color:var(--brand)]/50 hover:text-[color:var(--brand)]"
            >
              <Mail className="h-3.5 w-3.5" />
            </a>
          )}
          {(customSocials ?? []).map((s, i) => {
            const url = safeUrl(s.url);
            if (!url) return null;
            return (
              <a
                key={`custom-${i}`}
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={s.label}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] border border-border/70 bg-muted/50 text-foreground/80 transition-colors hover:border-[color:var(--brand)]/50 hover:text-[color:var(--brand)]"
              >
                {s.iconUrl ? (
                  <img
                    src={s.iconUrl}
                    alt={s.label}
                    className="h-3.5 w-3.5 object-contain"
                    loading="lazy"
                  />
                ) : (
                  <Globe className="h-3.5 w-3.5" />
                )}
              </a>
            );
          })}
        </div>
      )}
    </aside>
  );
}

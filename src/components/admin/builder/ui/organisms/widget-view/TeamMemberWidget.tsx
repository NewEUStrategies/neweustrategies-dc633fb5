// Widget "Team member" - kafelek osoby (portret + etykieta programu + imię +
// stanowisko) z modalem po kliknięciu (bio, kontakt, social media). Ikony
// social pobierane są z biblioteki (icon_library) z fallbackiem do Lucide.
import { useState, type CSSProperties } from "react";
import type { WidgetNode } from "@/lib/builder/types";
import { safeImageUrl, safeUrl, sanitizeHtml } from "@/lib/sanitize";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { BrandIcon } from "@/components/atoms/BrandIcon";
import { XIcon } from "@/components/atoms/XIcon";
import { Facebook, Linkedin, Globe, User as UserIcon } from "@/lib/lucide-shim";
import { Instagram, Youtube } from "lucide-react";
import { getStr, type Lang } from "./frame";

type SocialKey = "x" | "facebook" | "linkedin" | "instagram" | "youtube" | "website";

const SOCIAL_FALLBACK: Record<SocialKey, React.ComponentType<{ className?: string }>> = {
  x: XIcon,
  facebook: Facebook,
  linkedin: Linkedin,
  instagram: Instagram,
  youtube: Youtube,
  website: Globe,
};

const SOCIAL_LABEL: Record<SocialKey, string> = {
  x: "X",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  youtube: "YouTube",
  website: "Website",
};

function localized(c: Record<string, unknown>, key: string, lang: Lang): string {
  const v =
    (c[`${key}_${lang}`] as unknown) ??
    (c[`${key}_pl`] as unknown) ??
    (c[`${key}_en`] as unknown) ??
    c[key];
  return typeof v === "string" ? v : "";
}

export function TeamMemberWidget({
  node,
  lang,
  editable,
}: {
  node: WidgetNode;
  lang: Lang;
  editable?: boolean;
}) {
  const c = (node.content ?? {}) as WidgetContent;
  const cRaw = c as unknown as Record<string, unknown>;
  const [open, setOpen] = useState(false);

  const photo = safeImageUrl(getStr(c, "photo") || getStr(c, "image"));
  const name = getStr(c, "name");
  const position = localized(c, "position", lang);
  const programLabel = localized(c, "programLabel", lang);
  const bio = sanitizeHtml(localized(c, "bio", lang));
  const email = getStr(c, "email");
  const phone = getStr(c, "phone");
  const overlayAlpha = Math.min(1, Math.max(0, Number(c.overlayAlpha) || 0.55));
  const accent = getStr(c, "accentColor") || "var(--brand)";

  const socials: Array<{ key: SocialKey; url: string }> = (
    ["x", "facebook", "linkedin", "instagram", "youtube", "website"] as SocialKey[]
  )
    .map((key) => ({ key, url: safeUrl(getStr(c, key)) }))
    .filter((s) => Boolean(s.url));

  const cardStyle: CSSProperties = {
    backgroundImage: photo ? `url("${photo}")` : undefined,
    backgroundSize: "cover",
    backgroundPosition: "center",
  };

  const openModal = () => {
    if (editable) return; // podczas edycji nie otwieramy modala – właściwości ustawia się z boku
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        aria-label={name || "Team member"}
        className="cms-team-member group relative block w-full overflow-hidden rounded-xl border border-border/40 bg-[color:var(--surface-2,#0b1220)] text-white text-left aspect-[3/4] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-[color:var(--brand)]/60"
        style={cardStyle}
        data-team-member-id={node.id}
      >
        {/* Gradient overlay - zapewnia czytelność podpisów niezależnie od zdjęcia */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: `linear-gradient(180deg, rgba(0,0,0,${overlayAlpha * 0.55}) 0%, rgba(0,0,0,0) 40%, rgba(0,0,0,${overlayAlpha}) 100%)`,
          }}
        />
        {!photo && (
          <span
            aria-hidden
            className="absolute inset-0 flex items-center justify-center text-white/30"
          >
            <UserIcon className="h-16 w-16" />
          </span>
        )}
        {programLabel && (
          <span className="absolute inset-x-0 top-4 text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-white/85">
            {programLabel}
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 p-4 text-center">
          {name && (
            <span className="block font-display text-lg font-bold uppercase leading-tight tracking-wide">
              {name}
            </span>
          )}
          {position && (
            <span
              className="mt-1 block text-xs font-semibold uppercase tracking-widest"
              style={{ color: accent }}
            >
              {position}
            </span>
          )}
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
          <DialogTitle className="sr-only">{name || "Team member"}</DialogTitle>
          <DialogDescription className="sr-only">
            {position || (lang === "pl" ? "Karta osoby" : "Team member card")}
          </DialogDescription>
          <div className="grid gap-0 md:grid-cols-[minmax(220px,300px)_1fr]">
            <div
              className="relative aspect-[3/4] w-full bg-[color:var(--surface-2,#0b1220)] text-white"
              style={cardStyle}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                  background: `linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0) 40%, rgba(0,0,0,${overlayAlpha}) 100%)`,
                }}
              />
              {programLabel && (
                <span className="absolute inset-x-0 top-4 text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-white/85">
                  {programLabel}
                </span>
              )}
              <span className="absolute inset-x-0 bottom-0 p-4 text-center">
                {name && (
                  <span className="block font-display text-lg font-bold uppercase leading-tight tracking-wide">
                    {name}
                  </span>
                )}
                {position && (
                  <span
                    className="mt-1 block text-xs font-semibold uppercase tracking-widest"
                    style={{ color: accent }}
                  >
                    {position}
                  </span>
                )}
              </span>
            </div>
            <div className="flex flex-col gap-4 p-6">
              <header>
                <h2 className="cms-post-title text-2xl font-bold text-foreground">{name}</h2>
                {position && (
                  <p className="mt-1 text-sm text-muted-foreground">{position}</p>
                )}
              </header>

              {(phone || email) && (
                <dl className="grid gap-2 text-sm">
                  {phone && (
                    <div className="flex items-center gap-3">
                      <dt className="w-16 font-medium text-muted-foreground">
                        {lang === "pl" ? "Telefon" : "Phone"}:
                      </dt>
                      <dd>
                        <a href={`tel:${phone}`} className="hover:text-[color:var(--brand)]">
                          {phone}
                        </a>
                      </dd>
                    </div>
                  )}
                  {email && (
                    <div className="flex items-center gap-3">
                      <dt className="w-16 font-medium text-muted-foreground">Email:</dt>
                      <dd>
                        <a href={`mailto:${email}`} className="hover:text-[color:var(--brand)]">
                          {email}
                        </a>
                      </dd>
                    </div>
                  )}
                </dl>
              )}

              {socials.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {socials.map(({ key, url }) => {
                    const Fallback = SOCIAL_FALLBACK[key];
                    return (
                      <a
                        key={key}
                        href={url}
                        target="_blank"
                        rel="noreferrer noopener"
                        aria-label={SOCIAL_LABEL[key]}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted/60 text-foreground/80 transition-colors hover:border-[color:var(--brand)]/50 hover:text-[color:var(--brand)]"
                      >
                        <BrandIcon
                          name={key}
                          fallback={Fallback}
                          className="h-4 w-4"
                          alt={SOCIAL_LABEL[key]}
                        />
                      </a>
                    );
                  })}
                </div>
              )}

              {bio && (
                <div
                  className="cms-post-content prose prose-sm max-w-none text-sm leading-relaxed text-foreground/90"
                  dangerouslySetInnerHTML={{ __html: bio }}
                />
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

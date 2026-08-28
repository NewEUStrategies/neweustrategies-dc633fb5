// WSPÓLNY SZKIELET PROFILU (public + event builder/preview).
//
// Publiczny profil (`/profile`) i profil uczestnika wydarzenia (event builder,
// preview, `/events/$slug/me`) MUSZĄ wyglądać identycznie - to ta sama osoba
// i ten sam język wizualny. Zamiast dublować markup, oba miejsca składają
// widok z tych samych atomów: okładka + nachodzący awatar, wiersz nazwy z
// odznaką, linia „firma • stanowisko", pigułki meta, zakładki i karty sekcji.
//
// Komponenty są czysto prezentacyjne (bez pobierania danych), dzięki czemu
// nadają się zarówno do trybu edycji, jak i podglądu.
import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Okładka + nachodzący awatar (kwadrat 6px) + mini-ikony social. */
export function ProfileHeroFrame({
  coverUrl,
  avatarUrl,
  fullName,
  coverActions,
  avatarOverlay,
  socials,
  emptyCoverLabel,
  emptyCoverHint,
}: {
  coverUrl?: string | null;
  avatarUrl?: string | null;
  fullName: string;
  /** Akcje w prawym górnym rogu okładki (np. „Wgraj tło", „Podgląd jak gość"). */
  coverActions?: ReactNode;
  /** Warstwa na awatarze (np. przycisk zmiany zdjęcia w trybie edycji). */
  avatarOverlay?: ReactNode;
  socials?: ReactNode;
  emptyCoverLabel?: string;
  emptyCoverHint?: string;
}) {
  return (
    <section className="relative">
      <div className="relative h-40 w-full overflow-hidden rounded-[6px] border border-border bg-gradient-to-br from-muted/70 via-muted/30 to-background sm:h-52">
        {coverUrl ? (
          <img src={coverUrl} alt="" aria-hidden="true" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center gap-1 text-center">
            {emptyCoverLabel ? (
              <span className="text-xs font-medium text-muted-foreground">{emptyCoverLabel}</span>
            ) : null}
            {emptyCoverHint ? (
              <span className="text-[11px] text-muted-foreground/70">{emptyCoverHint}</span>
            ) : null}
          </div>
        )}
        {coverActions ? (
          <div className="absolute right-2.5 top-2.5 z-10 flex flex-wrap items-center gap-1.5">
            {coverActions}
          </div>
        ) : null}
      </div>

      <div className="absolute -bottom-10 left-1/2 z-20 -translate-x-1/2 sm:-bottom-12">
        <div className="relative h-28 w-28 rounded-[10px] bg-gradient-to-br from-primary/60 via-primary/20 to-transparent p-[3px] shadow-[0_10px_30px_-10px_color-mix(in_oklab,var(--primary)_45%,transparent)] sm:h-32 sm:w-32">
          <div className="relative h-full w-full overflow-hidden rounded-[7px] bg-background ring-[3px] ring-background">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={fullName}
                className="h-full w-full rounded-[7px] object-cover"
              />
            ) : (
              <span className="grid h-full w-full place-items-center rounded-[7px] bg-gradient-to-br from-muted to-muted/40 text-2xl font-semibold text-muted-foreground">
                {fullName.trim().slice(0, 1).toUpperCase() || "?"}
              </span>
            )}
            {avatarOverlay}
          </div>
          {socials ? (
            <div className="absolute -bottom-1.5 -right-1.5 z-10 flex items-center gap-1">
              {socials}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** Blok tożsamości pod okładką - odpowiednik sekcji z `/profile`. */
export function ProfileIdentityBlock({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-[6px] border border-border bg-card px-5 pb-5 pt-16 sm:px-6 sm:pt-20">
      {children}
    </section>
  );
}

export function ProfileNameRow({ name, badge }: { name: string; badge?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 text-center sm:justify-start sm:text-left">
      <h1 className="text-[26px] font-bold leading-[1.1] tracking-tight sm:text-[32px]">{name}</h1>
      {badge}
    </div>
  );
}

/** Linia „logo firmy + nazwa • stanowisko". */
export function ProfileIdentityLine({
  companyLogoUrl,
  companyName,
  companyHref,
  jobTitle,
}: {
  companyLogoUrl?: string | null;
  companyName?: string | null;
  companyHref?: string | null;
  jobTitle?: string | null;
}) {
  if (!companyName && !jobTitle) return null;
  const company = companyName ? (
    <span className="inline-flex max-w-full items-center gap-1.5 align-middle text-[13px] font-medium leading-[1.2] text-foreground">
      {companyLogoUrl ? (
        <img
          src={companyLogoUrl}
          alt=""
          aria-hidden="true"
          className="h-11 w-20 shrink-0 self-center object-contain"
          loading="lazy"
          decoding="async"
        />
      ) : null}
      {companyHref ? (
        <a
          href={companyHref}
          target="_blank"
          rel="noreferrer noopener"
          className="min-w-0 leading-[1.2] hover:text-primary"
        >
          {companyName}
        </a>
      ) : (
        <span className="min-w-0 leading-[1.2]">{companyName}</span>
      )}
    </span>
  ) : null;

  return (
    <div className="mt-0.5 flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5 text-[13px] leading-[1.2] sm:justify-start">
      {company}
      {company && jobTitle ? (
        <span className="inline-flex items-center text-[13px] leading-none text-muted-foreground/60">
          •
        </span>
      ) : null}
      {jobTitle ? (
        <span className="inline-flex items-center text-[13px] font-medium leading-[1.2] text-foreground">
          {jobTitle}
        </span>
      ) : null}
    </div>
  );
}

export function ProfileMetaRow({ children }: { children: ReactNode }) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
      {children}
    </div>
  );
}

export function ProfileMetaPill({
  icon,
  children,
  href,
}: {
  icon?: ReactNode;
  children: ReactNode;
  href?: string;
}) {
  const className =
    "inline-flex items-center gap-1.5 rounded-[6px] border border-border bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-foreground";
  const inner = (
    <>
      {icon ? <span className="text-primary [&_svg]:h-3 [&_svg]:w-3">{icon}</span> : null}
      <span className="max-w-[200px] truncate sm:max-w-[280px]">{children}</span>
    </>
  );
  if (href) {
    return (
      <a href={href} className={cn(className, "transition-colors hover:bg-muted/60")}>
        {inner}
      </a>
    );
  }
  return <span className={className}>{inner}</span>;
}

export interface ProfileTabItem {
  key: string;
  label: string;
}

/** Nawigacja zakładek - identyczna z `/profile` (podkreślenie 2px). */
export function ProfileTabsNav({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: readonly ProfileTabItem[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <nav
      className={cn(
        "sticky top-0 z-10 rounded-[6px] border border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80",
        className,
      )}
    >
      <div className="tabs-scroller flex items-center gap-0.5 px-2">
        {tabs.map((item) => {
          const isActive = item.key === active;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onChange(item.key)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "relative shrink-0 px-3 py-2.5 text-xs font-medium transition-colors",
                isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
              {isActive && (
                <span
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/** Karta sekcji - nagłówek 11px uppercase z ikoną w kolorze primary. */
export function ProfileSectionCard({
  icon,
  title,
  action,
  children,
  id,
  className,
}: {
  icon?: ReactNode;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section
      {...(id ? { id } : {})}
      className={cn("scroll-mt-24 rounded-[6px] border border-border bg-card p-4", className)}
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/70">
          {icon ? <span className="text-primary">{icon}</span> : null}
          {title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}

/** Wiersz kontaktu - kwadratowa ikona 6px + treść. */
export function ProfileContactRow({
  icon,
  ariaLabel,
  children,
}: {
  icon: ReactNode;
  ariaLabel: string;
  children: ReactNode;
}) {
  return (
    <li
      className="flex min-w-0 items-center gap-3 py-2 first:pt-0 last:pb-0"
      aria-label={ariaLabel}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-muted/70 text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

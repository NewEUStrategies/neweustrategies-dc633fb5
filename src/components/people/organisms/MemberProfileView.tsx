// Organizm: profil członka społeczności (/people/<slug>).
import { Link } from "@tanstack/react-router";
import { BadgeCheck, Briefcase, Globe, Linkedin, MapPin, PenLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MemberProfile } from "@/lib/profile/memberProfile";
import { MessageOrConnectButton } from "@/components/network/MessageOrConnectButton";
import { ensureI18n } from "@/lib/i18n-member-profile";

ensureI18n();

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toLocaleUpperCase("pl-PL");
}

function safeHttps(url: string | null): string | null {
  if (url === null) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function MemberProfileView({
  profile,
  lang,
}: {
  profile: MemberProfile;
  lang: "pl" | "en";
}) {
  const { t } = useTranslation();
  const bio = lang === "en" ? profile.bio_en : profile.bio_pl;
  const role = [profile.job_title, profile.company].filter(Boolean).join(" - ");
  const linkedin = safeHttps(profile.linkedin_url);
  const website = safeHttps(profile.website_url);

  return (
    <article data-member-profile={profile.slug} className="mx-auto w-full max-w-3xl space-y-6">
      <header className="flex flex-col gap-4 rounded-[6px] border border-border bg-card p-5 sm:flex-row sm:items-center">
        {profile.avatar_url !== null ? (
          <img
            src={profile.avatar_url}
            alt=""
            aria-hidden="true"
            className="h-20 w-20 shrink-0 rounded-full object-cover ring-1 ring-border"
          />
        ) : (
          <span
            aria-hidden="true"
            className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-primary/10 text-xl font-semibold text-primary"
          >
            {initials(profile.display_name)}
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
            <span className="truncate">{profile.display_name}</span>
            {profile.verified ? (
              <BadgeCheck
                className="h-5 w-5 shrink-0 text-primary"
                aria-label={t("memberProfile.verified")}
              />
            ) : null}
          </h1>
          {role !== "" ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Briefcase className="h-3.5 w-3.5" aria-hidden="true" />
              {role}
            </p>
          ) : null}
          {profile.location !== null ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              {profile.location}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {profile.is_self ? (
            <Link
              to="/profile/edit"
              className="inline-flex items-center gap-1.5 rounded-[4px] border border-border px-3 py-1.5 text-sm hover:bg-muted"
            >
              <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
              {t("memberProfile.editProfile")}
            </Link>
          ) : (
            <MessageOrConnectButton userId={profile.id} displayName={profile.display_name} />
          )}
          {profile.is_author ? (
            <Link
              to="/author/$slug"
              params={{ slug: profile.slug }}
              data-member-author-link
              className="inline-flex items-center rounded-[4px] bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {t("memberProfile.authorProfile")}
            </Link>
          ) : null}
        </div>
      </header>

      {bio !== null && bio.trim() !== "" ? (
        <section className="rounded-[6px] border border-border bg-card p-5">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("memberProfile.about")}
          </h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">{bio}</p>
        </section>
      ) : null}

      {profile.specialization !== null || linkedin !== null || website !== null ? (
        <section className="grid gap-4 rounded-[6px] border border-border bg-card p-5 sm:grid-cols-2">
          {profile.specialization !== null ? (
            <div>
              <h2 className="mb-1 text-sm font-semibold text-muted-foreground">
                {t("memberProfile.specialization")}
              </h2>
              <p className="text-sm text-foreground">{profile.specialization}</p>
            </div>
          ) : null}
          {linkedin !== null || website !== null ? (
            <div>
              <h2 className="mb-1 text-sm font-semibold text-muted-foreground">
                {t("memberProfile.links")}
              </h2>
              <ul className="space-y-1 text-sm">
                {linkedin !== null ? (
                  <li>
                    <a
                      href={linkedin}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex items-center gap-1.5 text-primary hover:underline"
                    >
                      <Linkedin className="h-3.5 w-3.5" aria-hidden="true" />
                      LinkedIn
                    </a>
                  </li>
                ) : null}
                {website !== null ? (
                  <li>
                    <a
                      href={website}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex items-center gap-1.5 text-primary hover:underline"
                    >
                      <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("memberProfile.website")}
                    </a>
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
    </article>
  );
}

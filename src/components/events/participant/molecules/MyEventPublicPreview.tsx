// Molekuła: „ZOBACZ, JAK WIDZĄ CIĘ INNI" - karta profilu uczestnika dokładnie
// w takim kształcie, w jakim trafia do katalogu wydarzenia.
//
// TA KARTA KŁAMAĆ NIE MOŻE. Renderujemy z tego samego rekordu, który czyta
// `event_attendees`, i honorujemy przełączniki widoczności: e-mail i telefon
// pokazujemy WYŁĄCZNIE, gdy właściciel je włączył. Dzięki temu podgląd jest
// weryfikacją zgody, a nie ozdobnikiem.
import { useTranslation } from "react-i18next";
import { Globe, Mail, Phone } from "lucide-react";

import { Facebook, Instagram, Linkedin, Youtube } from "@/lib/lucide-shim";
import { XIcon } from "@/components/atoms/XIcon";
import { uiLang } from "@/lib/i18n/format";
import { SOCIAL_KEYS, type MyEventProfile, type SocialKey } from "@/lib/events/myEventProfileApi";

const SOCIAL_ICON: Record<SocialKey, typeof Globe> = {
  linkedin: Linkedin,
  x: XIcon,
  facebook: Facebook,
  instagram: Instagram,
  youtube: Youtube,
  website: Globe,
};

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border px-4 py-4 sm:px-5">
      <h4 className="text-sm font-semibold tracking-tight">{title}</h4>
      <div className="mt-2 text-sm text-muted-foreground">{children}</div>
    </section>
  );
}

export function MyEventPublicPreview({ profile }: { profile: MyEventProfile }) {
  const { t, i18n } = useTranslation();
  const en = uiLang(i18n.language) === "en";

  const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
  const bio = (en ? profile.bioEn : profile.bioPl) ?? profile.bioPl ?? profile.bioEn;
  const seeking = (en ? profile.seekingEn : profile.seekingPl) ?? null;
  const offering = (en ? profile.offeringEn : profile.offeringPl) ?? null;
  const socials = SOCIAL_KEYS.filter((key) => (profile.socialLinks[key] ?? "").trim() !== "");
  const email = profile.emailVisible ? profile.email : null;
  const phone = profile.phoneVisible ? profile.phone : null;
  const tags = [profile.industry, profile.specialization].filter(
    (value): value is string => value !== null && value.trim() !== "",
  );

  return (
    <div className="overflow-hidden rounded-[6px] border border-border bg-card">
      <div className="flex flex-col items-center gap-3 px-4 py-6 text-center sm:px-5">
        {profile.photoUrl !== null ? (
          <img
            src={profile.photoUrl}
            alt={name}
            className="h-24 w-24 rounded-[6px] border border-border object-cover"
          />
        ) : (
          <div className="grid h-24 w-24 place-items-center rounded-[6px] border border-border bg-muted text-lg font-semibold text-muted-foreground">
            {name.slice(0, 1).toUpperCase() || "?"}
          </div>
        )}
        <div className="space-y-0.5">
          <p className="text-lg font-semibold tracking-tight">
            {name === "" ? t("eventMe.publicPreview.noName") : name}
          </p>
          {profile.jobTitle !== null && <p className="text-sm">{profile.jobTitle}</p>}
          {profile.companyText !== null && (
            <p className="text-sm text-muted-foreground">{profile.companyText}</p>
          )}
        </div>
        {tags.length > 0 && (
          <ul className="flex flex-wrap justify-center gap-1.5">
            {tags.map((tag) => (
              <li
                key={tag}
                className="rounded-[6px] border border-border px-2 py-0.5 text-xs text-muted-foreground"
              >
                {tag}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Row title={t("eventMe.publicPreview.about")}>
        {bio !== null && bio.trim() !== "" ? (
          <p className="whitespace-pre-line">{bio}</p>
        ) : (
          <p className="italic">{t("eventMe.publicPreview.empty")}</p>
        )}
      </Row>

      {(seeking !== null || offering !== null) && (
        <Row title={t("eventMe.publicPreview.match")}>
          <dl className="grid gap-3 sm:grid-cols-2">
            {seeking !== null && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide">
                  {t("eventMe.fields.seeking")}
                </dt>
                <dd className="mt-1 whitespace-pre-line">{seeking}</dd>
              </div>
            )}
            {offering !== null && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide">
                  {t("eventMe.fields.offering")}
                </dt>
                <dd className="mt-1 whitespace-pre-line">{offering}</dd>
              </div>
            )}
          </dl>
        </Row>
      )}

      <Row title={t("eventMe.sections.social")}>
        {socials.length === 0 ? (
          <p className="italic">{t("eventMe.publicPreview.empty")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {socials.map((key) => {
              const Icon = SOCIAL_ICON[key];
              const href = profile.socialLinks[key] ?? "";
              return (
                <li key={key}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-[6px] border border-border text-foreground transition-colors hover:bg-muted"
                    aria-label={t(`eventMe.social.${key}`)}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </Row>

      <Row title={t("eventMe.sections.contact")}>
        <ul className="space-y-1.5">
          <li className="flex items-center gap-2">
            <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
            {email !== null ? (
              <a className="underline-offset-2 hover:underline" href={`mailto:${email}`}>
                {email}
              </a>
            ) : (
              <span className="italic">{t("eventMe.publicPreview.contactHidden")}</span>
            )}
          </li>
          <li className="flex items-center gap-2">
            <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
            {phone !== null ? (
              <a className="underline-offset-2 hover:underline" href={`tel:${phone}`}>
                {phone}
              </a>
            ) : (
              <span className="italic">{t("eventMe.publicPreview.contactHidden")}</span>
            )}
          </li>
        </ul>
      </Row>
    </div>
  );
}

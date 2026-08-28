// Molekuła: „ZOBACZ, JAK WIDZĄ CIĘ INNI" - karta profilu uczestnika dokładnie
// w takim kształcie, w jakim trafia do katalogu wydarzenia.
//
// TA KARTA KŁAMAĆ NIE MOŻE. Renderujemy z tego samego rekordu, który czyta
// `event_attendees`, i honorujemy przełączniki widoczności: e-mail i telefon
// pokazujemy WYŁĄCZNIE, gdy właściciel je włączył. Dzięki temu podgląd jest
// weryfikacją zgody, a nie ozdobnikiem.
import { useTranslation } from "react-i18next";
import { Mail, Phone } from "lucide-react";

import { uiLang } from "@/lib/i18n/format";
import { type MyEventProfile } from "@/lib/events/myEventProfileApi";
import { useCompanyBrand } from "@/lib/crm/useCompanyBrand";
import { EventSocialLinks } from "@/components/events/participant/atoms/EventSocialLinks";
import {
  EventPersonActions,
  type EventPersonActionsProps,
} from "@/components/events/participant/molecules/EventPersonActions";

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border px-4 py-4 sm:px-5">
      <h4 className="text-sm font-semibold tracking-tight">{title}</h4>
      <div className="mt-2 text-sm text-muted-foreground">{children}</div>
    </section>
  );
}

export interface MyEventPublicPreviewProps {
  profile: MyEventProfile;
  /** Akcje networkingowe - gdy podane, karta pokazuje pasek kontaktu. */
  actions?: Omit<EventPersonActionsProps, "displayName" | "displayAvatar"> | null;
}

export function MyEventPublicPreview({ profile, actions = null }: MyEventPublicPreviewProps) {
  const { t, i18n } = useTranslation();
  const en = uiLang(i18n.language) === "en";

  const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
  const bio = (en ? profile.bioEn : profile.bioPl) ?? profile.bioPl ?? profile.bioEn;
  const seeking = (en ? profile.seekingEn : profile.seekingPl) ?? null;
  const offering = (en ? profile.offeringEn : profile.offeringPl) ?? null;
  const hasSocials = Object.values(profile.socialLinks).some(
    (value) => (value ?? "").trim() !== "",
  );
  const email = profile.emailVisible ? profile.email : null;
  const phone = profile.phoneVisible ? profile.phone : null;
  const brand = useCompanyBrand(profile.companyText);
  const companyLogo = brand.data?.logoUrl ?? null;
  const companyWebsite = brand.data?.website ?? null;
  const industry = profile.industry ?? brand.data?.industry ?? null;

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
            <span className="inline-flex items-center justify-center gap-2 text-sm text-muted-foreground">
              {companyLogo !== null && (
                <img
                  src={companyLogo}
                  alt=""
                  aria-hidden="true"
                  className="h-6 w-6 rounded-[6px] border border-border bg-background object-contain"
                />
              )}
              {companyWebsite === null ? (
                profile.companyText
              ) : (
                <a
                  href={companyWebsite}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline-offset-2 hover:underline"
                >
                  {profile.companyText}
                </a>
              )}
            </span>
          )}
        </div>

        {actions !== null && (
          <EventPersonActions
            {...actions}
            displayName={name === "" ? t("eventMe.publicPreview.noName") : name}
            displayAvatar={profile.photoUrl}
            className="justify-center"
          />
        )}
      </div>

      {(industry !== null || profile.specialization !== null) && (
        <Row title={t("eventMe.publicPreview.professional")}>
          <dl className="grid gap-3 sm:grid-cols-2">
            {industry !== null && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide">
                  {t("eventMe.fields.industry")}
                </dt>
                <dd className="mt-1">{industry}</dd>
              </div>
            )}
            {profile.specialization !== null && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide">
                  {t("eventMe.fields.specialization")}
                </dt>
                <dd className="mt-1">{profile.specialization}</dd>
              </div>
            )}
          </dl>
        </Row>
      )}

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
        {hasSocials ? (
          <EventSocialLinks links={profile.socialLinks} />
        ) : (
          <p className="italic">{t("eventMe.publicPreview.empty")}</p>
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

// Molekuła: „ZOBACZ, JAK WIDZĄ CIĘ INNI" - karta profilu uczestnika dokładnie
// w takim kształcie, w jakim trafia do katalogu wydarzenia.
//
// TA KARTA KŁAMAĆ NIE MOŻE. Renderujemy z tego samego rekordu, który czyta
// `event_attendees`, i honorujemy przełączniki widoczności: e-mail i telefon
// pokazujemy WYŁĄCZNIE, gdy właściciel je włączył. Dzięki temu podgląd jest
// weryfikacją zgody, a nie ozdobnikiem.
//
// WYGLĄD = PROFIL PUBLICZNY. Składamy widok z tych samych atomów co `/profile`
// (`@/components/profile/shell/ProfileShell`), więc uczestnik widzi w event
// builderze i w podglądzie dokładnie ten sam język wizualny co na stronie.
import { useTranslation } from "react-i18next";
import { Activity, Award, Briefcase, Compass, Mail, MapPin, Phone, Share2 } from "lucide-react";

import { uiLang } from "@/lib/i18n/format";
import { type MyEventProfile } from "@/lib/events/myEventProfileApi";
import { useCompanyBrand } from "@/lib/crm/useCompanyBrand";
import { EventSocialLinks } from "@/components/events/participant/atoms/EventSocialLinks";
import { EventGroupTags } from "@/components/events/participant/atoms/EventGroupTags";
import type { AttendeeGroupTag } from "@/lib/events/publicEventApi";
import {
  ProfileContactRow,
  ProfileHeroFrame,
  ProfileIdentityBlock,
  ProfileIdentityLine,
  ProfileMetaPill,
  ProfileMetaRow,
  ProfileNameRow,
  ProfileSectionCard,
} from "@/components/profile/shell/ProfileShell";
import { IntentBulletList } from "./IntentBulletList";
import {
  EventPersonActions,
  type EventPersonActionsProps,
} from "@/components/events/participant/molecules/EventPersonActions";
import { ensureI18n as ensureCartI18n } from "@/lib/i18n-cart";

ensureCartI18n();

export interface MyEventPublicPreviewProps {
  profile: MyEventProfile;
  /** Akcje networkingowe - gdy podane, karta pokazuje pasek kontaktu. */
  actions?: Omit<EventPersonActionsProps, "displayName" | "displayAvatar"> | null;
  /** Grupy z „Grupy i uprawnienia" - etykieta przepustki właściciela karty. */
  groups?: readonly AttendeeGroupTag[];
}

export function MyEventPublicPreview({
  profile,
  actions = null,
  groups = [],
}: MyEventPublicPreviewProps) {
  const { t, i18n } = useTranslation();
  const en = uiLang(i18n.language) === "en";

  const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
  const displayName = name === "" ? t("eventMe.publicPreview.noName") : name;
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
    <div className="space-y-4">
      <ProfileHeroFrame avatarUrl={profile.photoUrl} fullName={displayName} />

      <ProfileIdentityBlock>
        <ProfileNameRow name={displayName} />
        <ProfileIdentityLine
          companyLogoUrl={companyLogo}
          companyName={profile.companyText}
          companyHref={companyWebsite}
          jobTitle={profile.jobTitle}
        />

        <EventGroupTags
          groups={groups}
          lang={en ? "en" : "pl"}
          className="mt-2 justify-center sm:justify-start"
        />

        <ProfileMetaRow>
          {profile.specialization !== null && (
            <ProfileMetaPill icon={<Award />}>{profile.specialization}</ProfileMetaPill>
          )}
          {industry !== null && <ProfileMetaPill icon={<Briefcase />}>{industry}</ProfileMetaPill>}
          {email !== null && (
            <ProfileMetaPill icon={<Mail />} href={`mailto:${email}`}>
              {email}
            </ProfileMetaPill>
          )}
          {phone !== null && (
            <ProfileMetaPill icon={<MapPin />} href={`tel:${phone}`}>
              {phone}
            </ProfileMetaPill>
          )}
        </ProfileMetaRow>

        {actions !== null && (
          <div className="mt-3">
            <EventPersonActions
              {...actions}
              displayName={displayName}
              displayAvatar={profile.photoUrl}
              className="justify-center sm:justify-start"
            />
          </div>
        )}
      </ProfileIdentityBlock>

      <ProfileSectionCard
        icon={<Activity className="h-3.5 w-3.5" />}
        title={t("eventMe.publicPreview.about")}
      >
        {bio !== null && bio.trim() !== "" ? (
          <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">{bio}</p>
        ) : (
          <p className="text-sm italic text-muted-foreground/70">
            {t("eventMe.publicPreview.empty")}
          </p>
        )}
      </ProfileSectionCard>

      {(seeking !== null || offering !== null) && (
        <ProfileSectionCard
          icon={<Compass className="h-3.5 w-3.5" />}
          title={t("eventMe.publicPreview.match")}
        >
          <dl className="grid gap-3 sm:grid-cols-2">
            {seeking !== null && (
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t("eventMe.fields.seeking")}
                </dt>
                <dd className="mt-1 text-sm text-foreground/90">
                  <IntentBulletList text={seeking} />
                </dd>
              </div>
            )}
            {offering !== null && (
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t("eventMe.fields.offering")}
                </dt>
                <dd className="mt-1 text-sm text-foreground/90">
                  <IntentBulletList text={offering} />
                </dd>
              </div>
            )}
          </dl>
        </ProfileSectionCard>
      )}

      <ProfileSectionCard
        icon={<Mail className="h-3.5 w-3.5" />}
        title={t("eventMe.sections.contact")}
      >
        <ul className="divide-y divide-border/60">
          <ProfileContactRow
            icon={<Mail className="h-4 w-4" />}
            ariaLabel={t("eventMe.fields.email")}
          >
            {email !== null ? (
              <a
                className="truncate text-sm text-foreground/90 hover:text-primary"
                href={`mailto:${email}`}
              >
                {email}
              </a>
            ) : (
              <span className="text-sm italic text-muted-foreground/70">
                {t("eventMe.publicPreview.contactHidden")}
              </span>
            )}
          </ProfileContactRow>
          <ProfileContactRow
            icon={<Phone className="h-4 w-4" />}
            ariaLabel={t("eventMe.fields.phone")}
          >
            {phone !== null ? (
              <a
                className="truncate text-sm text-foreground/90 hover:text-primary"
                href={`tel:${phone}`}
              >
                {phone}
              </a>
            ) : (
              <span className="text-sm italic text-muted-foreground/70">
                {t("eventMe.publicPreview.contactHidden")}
              </span>
            )}
          </ProfileContactRow>
        </ul>
      </ProfileSectionCard>

      <ProfileSectionCard
        icon={<Share2 className="h-3.5 w-3.5" />}
        title={t("eventMe.sections.social")}
      >
        {hasSocials ? (
          <EventSocialLinks links={profile.socialLinks} />
        ) : (
          <p className="text-sm italic text-muted-foreground/70">
            {t("eventMe.publicPreview.empty")}
          </p>
        )}
      </ProfileSectionCard>
    </div>
  );
}

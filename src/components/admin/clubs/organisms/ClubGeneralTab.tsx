// Organizm: zakładka "Ogólne" edytora klubu.
//
// Slug ma osobne ostrzeżenie przy zmianie, bo to jedyne pole w tym formularzu,
// którego edycja psuje coś poza formularzem - istniejące linki do klubu.
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CoverImagePicker } from "@/components/admin/CoverImagePicker";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ClubTopicSelect } from "@/components/clubs/molecules/ClubTopicSelect";
import { ClubEnumSelect } from "../molecules/ClubEnumSelect";
import { ClubLayoutPicker } from "../molecules/ClubLayoutPicker";
import { CLUB_STATUSES, type ClubLayout, type ClubStatus } from "@/lib/clubs/types";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

export interface ClubGeneralDraft {
  slug: string;
  namePl: string;
  nameEn: string;
  taglinePl: string;
  taglineEn: string;
  descriptionPl: string;
  descriptionEn: string;
  rulesPl: string;
  rulesEn: string;
  policyArea: string;
  status: ClubStatus;
  cover: string;
  layout: ClubLayout;
}

interface ClubGeneralTabProps {
  draft: ClubGeneralDraft;
  /** Slug zapisany w bazie - do wykrycia, czy użytkownik go właśnie zmienia. */
  persistedSlug: string;
  onChange: (patch: Partial<ClubGeneralDraft>) => void;
  disabled?: boolean;
}

export function ClubGeneralTab({ draft, persistedSlug, onChange, disabled }: ClubGeneralTabProps) {
  ensureAdminClubsI18n();
  const { t } = useTranslation();
  const slugChanged = draft.slug !== persistedSlug && persistedSlug.length > 0;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="club-name-pl">{t("adminClubs.fields.namePl")}</Label>
              <Input
                id="club-name-pl"
                value={draft.namePl}
                disabled={disabled}
                maxLength={120}
                onChange={(e) => onChange({ namePl: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="club-name-en">{t("adminClubs.fields.nameEn")}</Label>
              <Input
                id="club-name-en"
                value={draft.nameEn}
                disabled={disabled}
                maxLength={120}
                onChange={(e) => onChange({ nameEn: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="club-slug">{t("adminClubs.fields.slug")}</Label>
            <Input
              id="club-slug"
              value={draft.slug}
              disabled={disabled}
              // Normalizujemy w locie zamiast walidować po zapisie: CHECK w bazie
              // odrzuca wszystko poza [a-z0-9-], więc lepiej nie pozwolić wpisać
              // czegoś, co i tak zostanie odrzucone.
              onChange={(e) =>
                onChange({
                  slug: e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9-]+/g, "-")
                    .replace(/-{2,}/g, "-"),
                })
              }
            />
            <p className="text-xs text-muted-foreground">{t("adminClubs.fields.slugHint")}</p>
            {slugChanged ? (
              <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t("adminClubs.fields.slugHint")}
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="club-tagline-pl">{t("adminClubs.fields.taglinePl")}</Label>
              <Input
                id="club-tagline-pl"
                value={draft.taglinePl}
                disabled={disabled}
                maxLength={200}
                onChange={(e) => onChange({ taglinePl: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="club-tagline-en">{t("adminClubs.fields.taglineEn")}</Label>
              <Input
                id="club-tagline-en"
                value={draft.taglineEn}
                disabled={disabled}
                maxLength={200}
                onChange={(e) => onChange({ taglineEn: e.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <ClubTopicSelect
              id="club-policy-area"
              label={t("adminClubs.fields.policyArea")}
              hint={t("club.topic.hint")}
              value={draft.policyArea}
              disabled={disabled}
              onChange={(topic) => onChange({ policyArea: topic ?? "" })}
            />
            <ClubEnumSelect
              id="club-status"
              label={t("adminClubs.fields.status")}
              value={draft.status}
              options={CLUB_STATUSES}
              i18nPrefix="club.status"
              onChange={(status) => onChange({ status })}
              disabled={disabled}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="space-y-1.5">
            <Label htmlFor="club-desc-pl">{t("adminClubs.fields.descriptionPl")}</Label>
            <Textarea
              id="club-desc-pl"
              rows={4}
              value={draft.descriptionPl}
              disabled={disabled}
              onChange={(e) => onChange({ descriptionPl: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="club-desc-en">{t("adminClubs.fields.descriptionEn")}</Label>
            <Textarea
              id="club-desc-en"
              rows={4}
              value={draft.descriptionEn}
              disabled={disabled}
              onChange={(e) => onChange({ descriptionEn: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="club-rules-pl">{t("adminClubs.fields.rulesPl")}</Label>
            <Textarea
              id="club-rules-pl"
              rows={3}
              value={draft.rulesPl}
              disabled={disabled}
              onChange={(e) => onChange({ rulesPl: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="club-rules-en">{t("adminClubs.fields.rulesEn")}</Label>
            <Textarea
              id="club-rules-en"
              rows={3}
              value={draft.rulesEn}
              disabled={disabled}
              onChange={(e) => onChange({ rulesEn: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">{t("adminClubs.fields.rulesHint")}</p>
          </div>
        </CardContent>
      </Card>

      {/* --- prezentacja: okładka i układ ---
          Oba pola istniały w bazie od pierwszej migracji i nie miały ŻADNEJ
          kontrolki, więc klub wyglądał zawsze tak samo, a `cover_image_url`
          było martwą kolumną. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("adminClubs.presentation")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <CoverImagePicker
            label={t("adminClubs.fields.cover")}
            value={draft.cover}
            onChange={(cover) => onChange({ cover })}
            folder="clubs"
          />
          <div className="space-y-2">
            <div>
              <Label>{t("adminClubs.layout.label")}</Label>
              <p className="text-xs text-muted-foreground">{t("adminClubs.layout.hint")}</p>
            </div>
            <ClubLayoutPicker
              value={draft.layout}
              onChange={(layout) => onChange({ layout })}
              disabled={disabled}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

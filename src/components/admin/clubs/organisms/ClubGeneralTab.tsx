// Organizm: zakładka „Ogólne" edytora klubu - KOMPOZYCJA, nie formularz.
//
// Reguły tej zakładki mieszkają poza nią i mają własne testy:
//   - tabela pól (klucz łatki, `id`, klucz etykiety, limit znaków, wiersze)
//     oraz wybór „przepisz albo znormalizuj" - `lib/clubs/adminClubFormFields`;
//   - normalizacja sluga i wykrycie jego zmiany - `lib/clubs/adminClubEditor`.
//
// Slug ma osobne ostrzeżenie przy zmianie, bo to jedyne pole w tym formularzu,
// którego edycja psuje coś poza formularzem - istniejące linki do klubu.
//
// Zostaje tu WYŁĄCZNIE sklejenie: która grupa pól w której karcie, co trafia
// do `onChange` z kontrolek nietekstowych (obszar, status, okładka, układ)
// i kiedy pod slugiem zapala się ostrzeżenie.
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CoverImagePicker } from "@/components/admin/CoverImagePicker";
import { Label } from "@/components/ui/label";
import { ClubTopicSelect } from "@/components/clubs/molecules/ClubTopicSelect";
import { ClubEnumSelect } from "@/components/clubs/molecules/ClubEnumSelect";
import { ClubLayoutPicker } from "../molecules/ClubLayoutPicker";
import { ClubFormTextField } from "../molecules/ClubFormTextField";
import { CLUB_STATUSES } from "@/lib/clubs/types";
import { isClubSlugChanged, type ClubGeneralDraftValues } from "@/lib/clubs/adminClubEditor";
import {
  CLUB_SLUG_CHANGED_WARNING_KEY,
  clubGeneralFieldsIn,
  clubGeneralTextPatch,
  type ClubGeneralTextField,
} from "@/lib/clubs/adminClubFormFields";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

/**
 * Kształt wersji roboczej. JEDNO źródło z `lib/clubs/adminClubEditor` - ten sam
 * kształt składa `toClubGeneralDraft` i rozkłada `clubEditorPayload`, więc
 * dwie osobne definicje znaczyłyby dwa kształty, które muszą się zgadzać
 * z pamięci autora.
 */
export type ClubGeneralDraft = ClubGeneralDraftValues;

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
  const slugChanged = isClubSlugChanged(draft.slug, persistedSlug);

  /** Pole tekstowe z deskryptora. Ostrzeżenie dostaje wyłącznie slug. */
  const textField = (field: ClubGeneralTextField) => (
    <ClubFormTextField
      key={field.key}
      field={field}
      value={draft[field.key]}
      disabled={disabled}
      warningKey={field.key === "slug" && slugChanged ? CLUB_SLUG_CHANGED_WARNING_KEY : undefined}
      onValueChange={(value) => onChange(clubGeneralTextPatch(field.key, value))}
    />
  );

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            {clubGeneralFieldsIn("identity").map(textField)}
          </div>

          {clubGeneralFieldsIn("slug").map(textField)}

          <div className="grid gap-4 sm:grid-cols-2">
            {clubGeneralFieldsIn("tagline").map(textField)}
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
          {clubGeneralFieldsIn("body").map(textField)}
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

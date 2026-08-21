// Organizm: zakładka „Dostęp" edytora klubu - KOMPOZYCJA droplistów i podglądu.
//
// Sześć droplistów plus ŻYWY PODGLĄD ZDANIA. Podgląd jest tu sednem, nie
// ozdobą: administrator ustawiający widoczność, politykę wstępu, próg planu
// i tryb atrybucji musi w głowie złożyć ich iloczyn, a właśnie w tym miejscu
// powstają kluby publiczne, które miały być zamknięte.
//
// Reguły są poza organizmem i mają własne testy:
//   - zdania podglądu i ostrzeżenia o kombinacjach - `lib/clubs/accessSentence`;
//   - wejście podglądu, słownik etykiet i warunek emisji progu planu -
//     `lib/clubs/adminClubAccessPreview`;
//   - odwzorowanie ranga <-> plan - `lib/clubs/planTiers`.
//
// Zostaje tu sklejenie: które pole emituje który klucz łatki i to, że podgląd
// dostaje ZŁOŻONE zdania oraz WYKRYTE ostrzeżenia.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { ClubEnumSelect } from "@/components/clubs/molecules/ClubEnumSelect";
import { ClubFormAccessPreview } from "../molecules/ClubFormAccessPreview";
import { buildAccessSentences, detectAccessWarnings } from "@/lib/clubs/accessSentence";
import {
  CLUB_ACCESS_I18N,
  clubAccessSentenceInput,
  clubAccessSentenceLabels,
  clubMinTierPatch,
} from "@/lib/clubs/adminClubAccessPreview";
import { CLUB_PLAN_TIERS, planTierFromRank, type ClubPlanTier } from "@/lib/clubs/planTiers";
import { type ClubAccessDraftValues } from "@/lib/clubs/adminClubEditor";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";
import {
  CLUB_ATTRIBUTION_MODES,
  CLUB_JOIN_POLICIES,
  CLUB_MODERATION_MODES,
  CLUB_POST_POLICIES,
  CLUB_VISIBILITIES,
} from "@/lib/clubs/types";

/**
 * Kształt wersji roboczej. JEDNO źródło z `lib/clubs/adminClubEditor` - ten sam
 * kształt składa `toClubAccessDraft` i rozkłada `clubEditorPayload`.
 */
export type ClubAccessDraft = ClubAccessDraftValues;

interface ClubAccessTabProps {
  draft: ClubAccessDraft;
  onChange: (patch: Partial<ClubAccessDraft>) => void;
  disabled?: boolean;
}

export function ClubAccessTab({ draft, onChange, disabled }: ClubAccessTabProps) {
  ensureAdminClubsI18n();
  const { t } = useTranslation();

  const sentenceInput = useMemo(() => clubAccessSentenceInput(draft), [draft]);

  // Etykiety zdania biorą się z tych samych PREFIKSÓW, co podpowiedzi pod
  // droplistami - jedno źródło tłumaczeń dla pola i dla jego opisu.
  const sentences = useMemo(
    () =>
      buildAccessSentences(
        sentenceInput,
        clubAccessSentenceLabels(draft.minTierRank, (key) => t(key)),
      ),
    [sentenceInput, draft.minTierRank, t],
  );

  const warnings = useMemo(() => detectAccessWarnings(sentenceInput), [sentenceInput]);

  /**
   * Próg planu emituje się TYLKO przy realnej zmianie rangi - wybór pozycji,
   * która już się wyświetla, mógłby cicho obniżyć próg spoza słownika.
   */
  const applyMinTier = (tier: ClubPlanTier) => {
    const patch = clubMinTierPatch(tier, draft.minTierRank);
    if (patch !== null) onChange(patch);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardContent className="grid gap-5 p-5 sm:grid-cols-2">
          <ClubEnumSelect
            id="club-visibility"
            label={t("adminClubs.fields.visibility")}
            value={draft.visibility}
            options={CLUB_VISIBILITIES}
            i18nPrefix={CLUB_ACCESS_I18N.visibility}
            hintPrefix={CLUB_ACCESS_I18N.visibilityHint}
            onChange={(visibility) => onChange({ visibility })}
            disabled={disabled}
          />

          <ClubEnumSelect
            id="club-join-policy"
            label={t("adminClubs.fields.joinPolicy")}
            value={draft.joinPolicy}
            options={CLUB_JOIN_POLICIES}
            i18nPrefix={CLUB_ACCESS_I18N.joinPolicy}
            onChange={(joinPolicy) => onChange({ joinPolicy })}
            disabled={disabled}
          />

          <ClubEnumSelect
            id="club-min-tier"
            label={t("adminClubs.fields.minTier")}
            value={planTierFromRank(draft.minTierRank)}
            options={CLUB_PLAN_TIERS}
            i18nPrefix={CLUB_ACCESS_I18N.planTier}
            hintPrefix={CLUB_ACCESS_I18N.planTierHint}
            onChange={(tier) => applyMinTier(tier)}
            disabled={disabled}
          />

          <ClubEnumSelect
            id="club-attribution"
            label={t("adminClubs.fields.attributionMode")}
            value={draft.attributionMode}
            options={CLUB_ATTRIBUTION_MODES}
            i18nPrefix={CLUB_ACCESS_I18N.attribution}
            hintPrefix={CLUB_ACCESS_I18N.attributionHint}
            onChange={(attributionMode) => onChange({ attributionMode })}
            disabled={disabled}
          />

          <ClubEnumSelect
            id="club-who-can-post"
            label={t("adminClubs.fields.whoCanPost")}
            value={draft.whoCanPost}
            options={CLUB_POST_POLICIES}
            i18nPrefix={CLUB_ACCESS_I18N.whoCanPost}
            onChange={(whoCanPost) => onChange({ whoCanPost })}
            disabled={disabled}
          />

          <ClubEnumSelect
            id="club-moderation"
            label={t("adminClubs.fields.moderationMode")}
            value={draft.moderationMode}
            options={CLUB_MODERATION_MODES}
            i18nPrefix={CLUB_ACCESS_I18N.moderation}
            onChange={(moderationMode) => onChange({ moderationMode })}
            disabled={disabled}
          />
        </CardContent>
      </Card>

      <ClubFormAccessPreview sentences={sentences} warnings={warnings} />
    </div>
  );
}

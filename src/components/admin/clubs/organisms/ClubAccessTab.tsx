// Organizm: zakładka "Dostęp" edytora klubu.
//
// Cztery droplisty plus ŻYWY PODGLĄD ZDANIA. Podgląd jest tu sednem, nie
// ozdobą: administrator ustawiający widoczność, politykę wstępu, próg planu
// i tryb atrybucji musi w głowie złożyć ich iloczyn, a właśnie w tym miejscu
// powstają kluby publiczne, które miały być zamknięte.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Eye } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClubEnumSelect } from "../molecules/ClubEnumSelect";
import {
  buildAccessSentences,
  detectAccessWarnings,
  type AccessSentenceInput,
} from "@/lib/clubs/accessSentence";
import { CLUB_PLAN_TIERS, planTierFromRank, rankFromPlanTier } from "@/lib/clubs/planTiers";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";
import {
  CLUB_ATTRIBUTION_MODES,
  CLUB_JOIN_POLICIES,
  CLUB_MODERATION_MODES,
  CLUB_POST_POLICIES,
  CLUB_VISIBILITIES,
  type ClubAttributionMode,
  type ClubJoinPolicy,
  type ClubModerationMode,
  type ClubPostPolicy,
  type ClubVisibility,
} from "@/lib/clubs/types";

export interface ClubAccessDraft {
  visibility: ClubVisibility;
  joinPolicy: ClubJoinPolicy;
  minTierRank: number;
  attributionMode: ClubAttributionMode;
  whoCanPost: ClubPostPolicy;
  moderationMode: ClubModerationMode;
}

interface ClubAccessTabProps {
  draft: ClubAccessDraft;
  onChange: (patch: Partial<ClubAccessDraft>) => void;
  disabled?: boolean;
}

export function ClubAccessTab({ draft, onChange, disabled }: ClubAccessTabProps) {
  ensureAdminClubsI18n();
  const { t } = useTranslation();

  // Etykiety zdania biorą się z tych samych kluczy, co droplisty - jedno
  // źródło tłumaczeń dla pola i dla jego opisu.
  const sentenceInput: AccessSentenceInput = useMemo(
    () => ({
      visibility: draft.visibility,
      joinPolicy: draft.joinPolicy,
      attributionMode: draft.attributionMode,
      whoCanPost: draft.whoCanPost,
      minTierRank: draft.minTierRank,
    }),
    [draft],
  );

  const sentences = useMemo(() => {
    const dict = <T extends string>(prefix: string, keys: readonly T[]): Record<T, string> => {
      const out = {} as Record<T, string>;
      for (const key of keys) out[key] = t(`${prefix}.${key}`);
      return out;
    };
    return buildAccessSentences(sentenceInput, {
      visibility: dict("club.visibilityHint", CLUB_VISIBILITIES),
      joinPolicy: dict("club.joinPolicy", CLUB_JOIN_POLICIES),
      attribution: dict("club.attributionHint", CLUB_ATTRIBUTION_MODES),
      whoCanPost: dict("club.whoCanPost", CLUB_POST_POLICIES),
      tierRequired: t(`club.planTierHint.${planTierFromRank(draft.minTierRank)}`),
      tierNone: t("adminClubs.accessPreviewNoTier"),
    });
  }, [sentenceInput, draft.minTierRank, t]);

  const warnings = useMemo(() => detectAccessWarnings(sentenceInput), [sentenceInput]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardContent className="grid gap-5 p-5 sm:grid-cols-2">
          <ClubEnumSelect
            id="club-visibility"
            label={t("adminClubs.fields.visibility")}
            value={draft.visibility}
            options={CLUB_VISIBILITIES}
            i18nPrefix="club.visibility"
            hintPrefix="club.visibilityHint"
            onChange={(visibility) => onChange({ visibility })}
            disabled={disabled}
          />

          <ClubEnumSelect
            id="club-join-policy"
            label={t("adminClubs.fields.joinPolicy")}
            value={draft.joinPolicy}
            options={CLUB_JOIN_POLICIES}
            i18nPrefix="club.joinPolicy"
            onChange={(joinPolicy) => onChange({ joinPolicy })}
            disabled={disabled}
          />

          <ClubEnumSelect
            id="club-min-tier"
            label={t("adminClubs.fields.minTier")}
            value={planTierFromRank(draft.minTierRank)}
            options={CLUB_PLAN_TIERS}
            i18nPrefix="club.planTier"
            hintPrefix="club.planTierHint"
            // Wyświetlana wartość powstaje z `planTierFromRank`, które rangę
            // spoza słownika degraduje w dół. Wybór TEJ SAMEJ pozycji, która
            // już się wyświetla, zapisałby wtedy próg NIŻSZY od istniejącego,
            // wyglądając przy tym jak brak zmiany. Emitujemy więc tylko realną
            // zmianę rangi - słownik pokrywa dziś cały katalog, ale ranga
            // z ręcznego grantu (np. 35) nadal może w nim nie istnieć.
            onChange={(tier) => {
              const nextRank = rankFromPlanTier(tier);
              if (nextRank !== draft.minTierRank) onChange({ minTierRank: nextRank });
            }}
            disabled={disabled}
          />

          <ClubEnumSelect
            id="club-attribution"
            label={t("adminClubs.fields.attributionMode")}
            value={draft.attributionMode}
            options={CLUB_ATTRIBUTION_MODES}
            i18nPrefix="club.attribution"
            hintPrefix="club.attributionHint"
            onChange={(attributionMode) => onChange({ attributionMode })}
            disabled={disabled}
          />

          <ClubEnumSelect
            id="club-who-can-post"
            label={t("adminClubs.fields.whoCanPost")}
            value={draft.whoCanPost}
            options={CLUB_POST_POLICIES}
            i18nPrefix="club.whoCanPost"
            onChange={(whoCanPost) => onChange({ whoCanPost })}
            disabled={disabled}
          />

          <ClubEnumSelect
            id="club-moderation"
            label={t("adminClubs.fields.moderationMode")}
            value={draft.moderationMode}
            options={CLUB_MODERATION_MODES}
            i18nPrefix="club.moderation"
            onChange={(moderationMode) => onChange({ moderationMode })}
            disabled={disabled}
          />
        </CardContent>
      </Card>

      {/* Podgląd jest sticky: administrator przewijając droplisty ma go stale
          w polu widzenia, bo inaczej skutek zmiany widać dopiero po scrollu. */}
      <div className="space-y-3 lg:sticky lg:top-24 lg:self-start">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Eye className="h-4 w-4" />
              {t("adminClubs.accessPreviewTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {sentences.map((sentence) => (
                <li key={sentence} className="flex gap-2 text-muted-foreground">
                  <span
                    aria-hidden="true"
                    className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary"
                  />
                  <span>{sentence}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {warnings.length > 0 ? (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4" />
                {t("adminClubs.accessWarning.title")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-xs text-amber-800 dark:text-amber-200">
                {warnings.map((w) => (
                  <li key={w}>{t(`adminClubs.accessWarning.${w}`)}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

// Organizm: kampania zapraszająca na segment (ścieżka D z V2 §3).
//
// CZEGO TU NIE BYŁO. Specyfikacja zna cztery ścieżki zapraszania; trzy miały
// interfejs, czwarta miała tabelę reguł (`club_segment_rules`) i RPC podglądu
// (`admin_club_segment_preview`) - i ani jednego wołającego. Podgląd bez
// wykonania to licznik mówiący „wyślę 137 zaproszeń" bez przycisku, a tabela
// istniejąca po to, „żeby kampanię dało się powtórzyć", opisywała kampanię,
// której nie dało się przeprowadzić ani raz.
//
// PODGLĄD JEST OBOWIĄZKOWY, nie opcjonalny. Zaproszenie masowe jest operacją
// nieodwracalną wobec cudzych skrzynek, więc przycisk wysyłki włącza się
// dopiero, gdy baza policzyła, ilu ludzi to realnie dotknie. Cztery liczby
// sumują się do `matched` (A27 liczy je z jednego odsiewu), więc administrator
// widzi nie tylko „ile pójdzie", ale i „dlaczego reszta nie".
//
// REGUŁA JEST DANYMI, nie formularzem: `ClubSegmentRule` odpowiada gałęziom
// `club_segment_candidate_ids`, a `isClubSegmentRuleComplete` pilnuje, żeby
// niedokończona reguła nie poszła do bazy jako pusty zbiór z komunikatem
// o sukcesie.
//
// RESPONSYWNOŚĆ: jedna kolumna do sm, dwie wyżej - ten sam grid, co w pozostałych
// panelach zakładki, żeby trzy karty pod sobą nie miały trzech różnych rytmów.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized, type LocaleCode } from "@/lib/i18n/pickLocalized";
import { toast } from "sonner";
import { Send, Users2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClubEnumSelect } from "../molecules/ClubEnumSelect";
import {
  ClubAnchorPicker,
  type ClubAnchorValue,
} from "@/components/clubs/molecules/ClubAnchorPicker";
import { useAdminClubs, useClubSegmentPreview, useInviteClubSegment } from "@/lib/clubs/useClubs";
import {
  CLUB_SEGMENT_KINDS,
  isClubSegmentRuleComplete,
  type ClubMemberRole,
  type ClubSegmentKind,
  type ClubSegmentRule,
} from "@/lib/clubs/types";
import { PROFILE_BADGE_CATALOG, PROFILE_BADGE_KINDS } from "@/lib/profile/badgeCatalog";

/** Role możliwe do nadania kampanią. `lead` celowo poza listą - prowadzącego
 *  wyznacza się imiennie, nie masowo. */
const CAMPAIGN_ROLES = ["moderator", "member", "observer"] as const;
type CampaignRole = (typeof CAMPAIGN_ROLES)[number];

export function ClubSegmentCampaign({ clubId }: { clubId: string }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [kind, setKind] = useState<ClubSegmentKind>("badge");
  const [badge, setBadge] = useState<string>(PROFILE_BADGE_KINDS[0]);
  const [specialization, setSpecialization] = useState("");
  const [otherClubId, setOtherClubId] = useState("");
  const [anchor, setAnchor] = useState<ClubAnchorValue | null>(null);
  const [role, setRole] = useState<CampaignRole>("member");
  const [message, setMessage] = useState("");

  // Lista klubów do reguły `other_club`. Bez limitu 50 z domyślnego filtra:
  // reguła „członkowie innego klubu" musi widzieć KAŻDY klub, także pięćdziesiąty
  // pierwszy - inaczej najstarsze kluby tenanta byłyby nieosiągalne.
  const clubsQ = useAdminClubs({ limit: 200 });
  const otherClubs = (clubsQ.data?.rows ?? []).filter((c) => c.id !== clubId);

  const rule = useMemo<ClubSegmentRule>(() => {
    switch (kind) {
      case "badge":
        return { kind, badge };
      case "specialization":
        return { kind, value: specialization.trim() };
      case "other_club":
        return { kind, club_id: otherClubId };
      case "policy_follow":
        return { kind, item_id: anchor?.anchorId ?? "" };
      case "event_rsvp":
        return { kind, event_id: anchor?.anchorId ?? "" };
    }
  }, [kind, badge, specialization, otherClubId, anchor]);

  const complete = isClubSegmentRuleComplete(rule);
  const previewQ = useClubSegmentPreview({ clubId, rule, enabled: complete });
  const sendM = useInviteClubSegment(clubId);

  const preview = previewQ.data ?? null;
  const canSend = complete && preview !== null && preview.will_send > 0 && !sendM.isPending;

  const send = () => {
    if (!canSend) return;
    sendM.mutate(
      { rule, role: role as ClubMemberRole, message: message.trim() || null, saveRule: true },
      {
        onSuccess: (invited) => {
          toast.success(t("adminClubs.segment.sent", { count: invited }));
          setMessage("");
        },
        onError: () => toast.error(t("adminClubs.segment.failed")),
      },
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users2 className="h-4 w-4" aria-hidden="true" />
          {t("adminClubs.segment.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">{t("adminClubs.segment.hint")}</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <ClubEnumSelect
            id="club-segment-kind"
            label={t("adminClubs.segment.kindLabel")}
            value={kind}
            options={CLUB_SEGMENT_KINDS}
            i18nPrefix="adminClubs.segment.kind"
            hintPrefix="adminClubs.segment.kindHint"
            onChange={(next) => {
              setKind(next);
              // Kotwica jest współdzielona przez dwie reguły o RÓŻNYCH typach
              // encji, więc przy zmianie rodzaju musi zniknąć - inaczej wybór
              // wydarzenia zostałby wysłany jako identyfikator aktu prawnego.
              setAnchor(null);
            }}
            disabled={sendM.isPending}
          />

          {kind === "badge" ? (
            <div className="space-y-1.5">
              <Label htmlFor="club-segment-badge">{t("adminClubs.segment.badgeLabel")}</Label>
              <Select value={badge} onValueChange={setBadge} disabled={sendM.isPending}>
                <SelectTrigger id="club-segment-badge">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROFILE_BADGE_KINDS.map((key) => (
                    <SelectItem key={key} value={key}>
                      {PROFILE_BADGE_CATALOG[key].label[lang]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {kind === "specialization" ? (
            <div className="space-y-1.5">
              <Label htmlFor="club-segment-spec">{t("adminClubs.segment.specLabel")}</Label>
              <Input
                id="club-segment-spec"
                value={specialization}
                disabled={sendM.isPending}
                onChange={(e) => setSpecialization(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("adminClubs.segment.specHint")}</p>
            </div>
          ) : null}

          {kind === "other_club" ? (
            <div className="space-y-1.5">
              <Label htmlFor="club-segment-club">{t("adminClubs.segment.clubLabel")}</Label>
              <Select
                value={otherClubId}
                onValueChange={setOtherClubId}
                disabled={sendM.isPending || clubsQ.isPending}
              >
                <SelectTrigger id="club-segment-club">
                  <SelectValue placeholder={t("adminClubs.segment.clubLabel")} />
                </SelectTrigger>
                <SelectContent>
                  {otherClubs.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {pickLocalized(c, "name", lang)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {kind === "policy_follow" || kind === "event_rsvp" ? (
            <ClubAnchorPicker
              value={anchor}
              onChange={setAnchor}
              disabled={sendM.isPending}
              anchorType={kind === "policy_follow" ? "eu_policy_item" : "event"}
              fieldLabel={
                kind === "policy_follow"
                  ? t("adminClubs.segment.policyLabel")
                  : t("adminClubs.segment.eventLabel")
              }
            />
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
          <ClubEnumSelect
            id="club-segment-role"
            label={t("adminClubs.columns.role")}
            value={role}
            options={CAMPAIGN_ROLES}
            i18nPrefix="club.role"
            onChange={setRole}
            disabled={sendM.isPending}
          />
          <div className="space-y-1.5">
            <Label htmlFor="club-segment-message">{t("adminClubs.invitations.messageLabel")}</Label>
            <Textarea
              id="club-segment-message"
              rows={2}
              maxLength={500}
              value={message}
              disabled={sendM.isPending}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
        </div>

        {/* Podgląd stoi MIĘDZY regułą a przyciskiem, nie pod nim: liczba, którą
            trzeba przewinąć, żeby zobaczyć, nie chroni przed niczym. */}
        {complete ? (
          previewQ.isError ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {t("adminClubs.segment.previewFailed")}
            </p>
          ) : previewQ.isPending ? (
            <div className="h-16 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
          ) : preview !== null ? (
            <div
              className="grid gap-2 rounded-lg border border-border/60 bg-muted/30 p-3 sm:grid-cols-4"
              aria-live="polite"
            >
              <PreviewCell label={t("adminClubs.segment.matched")} value={preview.matched} />
              <PreviewCell
                label={t("adminClubs.segment.alreadyMember")}
                value={preview.already_member}
              />
              <PreviewCell label={t("adminClubs.segment.blocked")} value={preview.blocked} />
              <PreviewCell
                label={t("adminClubs.segment.willSend")}
                value={preview.will_send}
                emphasis
              />
            </div>
          ) : null
        ) : (
          <p className="text-xs text-muted-foreground">{t("adminClubs.segment.incomplete")}</p>
        )}

        <Button onClick={send} disabled={!canSend}>
          <Send className="mr-2 h-4 w-4" aria-hidden="true" />
          {preview !== null && preview.will_send > 0
            ? t("adminClubs.segment.sendCount", { count: preview.will_send })
            : t("adminClubs.segment.send")}
        </Button>
      </CardContent>
    </Card>
  );
}

function PreviewCell({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={
          emphasis === true
            ? "text-lg font-semibold tabular-nums text-primary"
            : "text-lg font-semibold tabular-nums"
        }
      >
        {value}
      </p>
    </div>
  );
}

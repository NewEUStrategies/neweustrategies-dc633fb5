// Organizm: kampania zapraszająca na segment (ścieżka D z V2 §3).
//
// CZEGO TU NIE BYŁO. Specyfikacja zna cztery ścieżki zapraszania; trzy miały
// interfejs, czwarta miała tabelę reguł (`club_segment_rules`) i RPC podglądu
// (`admin_club_segment_preview`) - i ani jednego wołającego. Podgląd bez
// wykonania to licznik mówiący „wyślę 137 zaproszeń” bez przycisku, a tabela
// istniejąca po to, „żeby kampanię dało się powtórzyć”, opisywała kampanię,
// której nie dało się przeprowadzić ani raz.
//
// PODGLĄD JEST OBOWIĄZKOWY, nie opcjonalny. Zaproszenie masowe jest operacją
// nieodwracalną wobec cudzych skrzynek, więc przycisk wysyłki włącza się
// dopiero, gdy baza policzyła, ilu ludzi to realnie dotknie. Cztery liczby
// sumują się do `matched` (A27 liczy je z jednego odsiewu), więc administrator
// widzi nie tylko „ile pójdzie”, ale i „dlaczego reszta nie”.
//
// ORGANIZM JEST KOMPOZYCJĄ. Budowa segmentu, wybór pola dla rodzaju reguły,
// bramka wysyłki, stan podglądu i payload mutacji mieszkają w
// `lib/clubs/adminSegment` (`ClubSegmentRule` odpowiada gałęziom
// `club_segment_candidate_ids`, a `isClubSegmentRuleComplete` pilnuje, żeby
// niedokończona reguła nie poszła do bazy jako pusty zbiór z komunikatem
// o sukcesie). Cztery liczby podglądu rysuje molekuła
// `ClubCatalogSegmentPreview`. Tutaj zostaje SKLEJENIE: co idzie do mutacji
// i co administrator widzi po odpowiedzi.
//
// BRAMKA WYSYŁKI JEST W JEDNYM MIEJSCU: `canSendClubSegment` steruje atrybutem
// `disabled` przycisku, więc nie ma drugiej, rozjeżdżalnej kopii tego warunku
// w ciele obsługi kliknięcia.
//
// RESPONSYWNOŚĆ: jedna kolumna do sm, dwie wyżej - ten sam grid, co w pozostałych
// panelach zakładki, żeby trzy karty pod sobą nie miały trzech różnych rytmów.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
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
import { ClubEnumSelect } from "@/components/clubs/molecules/ClubEnumSelect";
import {
  ClubAnchorPicker,
  type ClubAnchorValue,
} from "@/components/clubs/molecules/ClubAnchorPicker";
import { ClubCatalogSegmentPreview } from "@/components/admin/clubs/molecules/ClubCatalogSegmentPreview";
import { useAdminClubs, useClubSegmentPreview, useInviteClubSegment } from "@/lib/clubs/useClubs";
import { CLUB_SEGMENT_KINDS, type ClubSegmentKind } from "@/lib/clubs/types";
import {
  CLUB_SEGMENT_CAMPAIGN_ROLES,
  canSendClubSegment,
  clubSegmentAnchorField,
  clubSegmentField,
  clubSegmentOtherClubs,
  clubSegmentPreviewView,
  clubSegmentRule,
  clubSegmentSendLabel,
  clubSegmentSendVars,
  isClubSegmentDraftComplete,
  type ClubSegmentCampaignRole,
  type ClubSegmentDraft,
} from "@/lib/clubs/adminSegment";
import { PROFILE_BADGE_CATALOG, PROFILE_BADGE_KINDS } from "@/lib/profile/badgeCatalog";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

export function ClubSegmentCampaign({ clubId }: { clubId: string }) {
  ensureAdminClubsI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [kind, setKind] = useState<ClubSegmentKind>("badge");
  const [badge, setBadge] = useState<string>(PROFILE_BADGE_KINDS[0]);
  const [specialization, setSpecialization] = useState("");
  const [otherClubId, setOtherClubId] = useState("");
  const [anchor, setAnchor] = useState<ClubAnchorValue | null>(null);
  const [role, setRole] = useState<ClubSegmentCampaignRole>("member");
  const [message, setMessage] = useState("");

  // Lista klubów do reguły `other_club`. Bez limitu 50 z domyślnego filtra:
  // reguła „członkowie innego klubu” musi widzieć KAŻDY klub, także pięćdziesiąty
  // pierwszy - inaczej najstarsze kluby tenanta byłyby nieosiągalne.
  const clubsQ = useAdminClubs({ limit: 200 });
  const otherClubs = clubSegmentOtherClubs(clubsQ.data?.rows ?? [], clubId);

  const draft = useMemo<ClubSegmentDraft>(
    () => ({
      kind,
      badge,
      specialization,
      otherClubId,
      // Kotwica jest współdzielona przez dwie reguły o RÓŻNYCH typach encji,
      // więc jej brak znaczy pustą wartość reguły, a nie brak klucza.
      anchorId: anchor?.anchorId ?? "",
    }),
    [kind, badge, specialization, otherClubId, anchor],
  );

  const rule = useMemo(() => clubSegmentRule(draft), [draft]);
  const complete = isClubSegmentDraftComplete(draft);
  const previewQ = useClubSegmentPreview({ clubId, rule, enabled: complete });
  const sendM = useInviteClubSegment(clubId);

  const preview = previewQ.data ?? null;
  const canSend = canSendClubSegment({ complete, preview, isPending: sendM.isPending });
  const previewView = clubSegmentPreviewView({
    complete,
    isError: previewQ.isError,
    isPending: previewQ.isPending,
    preview,
  });
  const sendLabel = clubSegmentSendLabel(preview);
  const field = clubSegmentField(kind);
  const anchorField = clubSegmentAnchorField(kind);

  const changeKind = (next: ClubSegmentKind) => {
    setKind(next);
    // Kotwica jest współdzielona przez dwie reguły o RÓŻNYCH typach encji,
    // więc przy zmianie rodzaju musi zniknąć - inaczej wybór wydarzenia
    // zostałby wysłany jako identyfikator aktu prawnego.
    setAnchor(null);
  };

  const send = () => {
    sendM.mutate(clubSegmentSendVars({ rule, role, message }), {
      onSuccess: (invited) => {
        toast.success(t("adminClubs.segment.sent", { count: invited }));
        setMessage("");
      },
      onError: () => toast.error(t("adminClubs.segment.failed")),
    });
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
            onChange={changeKind}
            disabled={sendM.isPending}
          />

          {field === "badge" ? (
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

          {field === "specialization" ? (
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

          {field === "other_club" ? (
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

          {anchorField === null ? null : (
            <ClubAnchorPicker
              value={anchor}
              onChange={setAnchor}
              disabled={sendM.isPending}
              anchorType={anchorField.anchorType}
              fieldLabel={t(anchorField.labelKey)}
            />
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
          <ClubEnumSelect
            id="club-segment-role"
            label={t("adminClubs.columns.role")}
            value={role}
            options={CLUB_SEGMENT_CAMPAIGN_ROLES}
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
        {previewView.state === "incomplete" ? (
          <p className="text-xs text-muted-foreground">{t("adminClubs.segment.incomplete")}</p>
        ) : previewView.state === "failed" ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {t("adminClubs.segment.previewFailed")}
          </p>
        ) : previewView.state === "loading" ? (
          <div className="h-16 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
        ) : previewView.state === "counts" ? (
          <ClubCatalogSegmentPreview
            cells={previewView.cells.map((cell) => ({
              id: cell.id,
              label: t(cell.labelKey),
              value: cell.value,
              emphasis: cell.emphasis,
            }))}
          />
        ) : null}

        <Button onClick={send} disabled={!canSend}>
          <Send className="mr-2 h-4 w-4" aria-hidden="true" />
          {sendLabel.count === null
            ? t(sendLabel.key)
            : t(sendLabel.key, { count: sendLabel.count })}
        </Button>
      </CardContent>
    </Card>
  );
}

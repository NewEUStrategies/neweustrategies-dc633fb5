// Edycja DANYCH klubu przez prowadzacego.
//
// Formularz celowo nie ma widocznosci, statusu ani progu planu: te trzy pola
// zmienia wylacznie administracja platformy (`admin_club_upsert`), a droplista,
// ktorej `club_update_settings` nie czyta, oddawalaby prowadzacemu wybor
// odrzucany dopiero przy zapisie - czyli po stracie tego, co wpisal.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useUpdateClubSettings } from "@/lib/clubs/useClubs";
import {
  CLUB_JOIN_POLICIES,
  CLUB_POST_POLICIES,
  toClubSaveError,
  type ClubJoinPolicy,
  type ClubPostPolicy,
} from "@/lib/clubs/types";
import { ensureClubI18n } from "@/lib/i18n-club";

/** Minimalny odczyt klubu, ktory ten formularz potrzebuje. */
export interface ClubSettingsSeed {
  id: string;
  name_pl: string;
  name_en: string | null;
  tagline_pl: string | null;
  tagline_en: string | null;
  description_pl: string | null;
  description_en: string | null;
  rules_pl: string | null;
  rules_en: string | null;
  policy_area: string | null;
  who_can_post: string | null;
  join_policy: string | null;
}

function asPostPolicy(value: string | null): ClubPostPolicy {
  return (CLUB_POST_POLICIES as readonly string[]).includes(value ?? "")
    ? (value as ClubPostPolicy)
    : "moderators";
}

function asJoinPolicy(value: string | null): ClubJoinPolicy {
  return (CLUB_JOIN_POLICIES as readonly string[]).includes(value ?? "")
    ? (value as ClubJoinPolicy)
    : "request";
}

export function ClubSettingsDialog({
  club,
  open,
  onOpenChange,
}: {
  club: ClubSettingsSeed;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  ensureClubI18n();
  const { t } = useTranslation();
  const save = useUpdateClubSettings(club.id);

  const [namePl, setNamePl] = useState(club.name_pl);
  const [nameEn, setNameEn] = useState(club.name_en ?? "");
  const [taglinePl, setTaglinePl] = useState(club.tagline_pl ?? "");
  const [taglineEn, setTaglineEn] = useState(club.tagline_en ?? "");
  const [descriptionPl, setDescriptionPl] = useState(club.description_pl ?? "");
  const [descriptionEn, setDescriptionEn] = useState(club.description_en ?? "");
  const [rulesPl, setRulesPl] = useState(club.rules_pl ?? "");
  const [rulesEn, setRulesEn] = useState(club.rules_en ?? "");
  const [policyArea, setPolicyArea] = useState(club.policy_area ?? "");
  const [whoCanPost, setWhoCanPost] = useState<ClubPostPolicy>(asPostPolicy(club.who_can_post));
  const [joinPolicy, setJoinPolicy] = useState<ClubJoinPolicy>(asJoinPolicy(club.join_policy));

  const submit = () => {
    const name = namePl.trim();
    if (name.length === 0) {
      toast.error(t("adminClubs.create.error.missing_fields"));
      return;
    }
    save.mutate(
      {
        patch: {
          name_pl: name,
          name_en: nameEn.trim() || undefined,
          tagline_pl: taglinePl.trim() || null,
          tagline_en: taglineEn.trim() || null,
          description_pl: descriptionPl.trim() || null,
          description_en: descriptionEn.trim() || null,
          rules_pl: rulesPl.trim() || null,
          rules_en: rulesEn.trim() || null,
          policy_area: policyArea.trim() || null,
          who_can_post: whoCanPost,
          join_policy: joinPolicy,
        },
      },
      {
        onSuccess: (changed) => {
          onOpenChange(false);
          // `false` znaczy "baza nie miala co zmienic" - to inna informacja niż
          // "zapisano", więc nie udajemy sukcesu zapisu.
          if (changed) toast.success(t("club.settings.done"));
          else toast.info(t("club.settings.noChanges"));
        },
        onError: (error) => toast.error(t(`adminClubs.create.error.${toClubSaveError(error)}`)),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("club.settings.title")}</DialogTitle>
          <DialogDescription>{t("club.settings.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="club-settings-name">{t("club.settings.nameLabel")}</Label>
              <Input
                id="club-settings-name"
                value={namePl}
                maxLength={120}
                disabled={save.isPending}
                onChange={(e) => setNamePl(e.target.value)}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="club-settings-name-en">{t("club.settings.nameEnLabel")}</Label>
              <Input
                id="club-settings-name-en"
                value={nameEn}
                maxLength={120}
                disabled={save.isPending}
                onChange={(e) => setNameEn(e.target.value)}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="club-settings-tagline">{t("club.settings.taglineLabel")}</Label>
              <Input
                id="club-settings-tagline"
                value={taglinePl}
                maxLength={200}
                disabled={save.isPending}
                onChange={(e) => setTaglinePl(e.target.value)}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="club-settings-tagline-en">{t("club.settings.taglineEnLabel")}</Label>
              <Input
                id="club-settings-tagline-en"
                value={taglineEn}
                maxLength={200}
                disabled={save.isPending}
                onChange={(e) => setTaglineEn(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="club-settings-desc">{t("club.settings.descriptionLabel")}</Label>
              <Textarea
                id="club-settings-desc"
                rows={3}
                value={descriptionPl}
                maxLength={4000}
                disabled={save.isPending}
                onChange={(e) => setDescriptionPl(e.target.value)}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="club-settings-desc-en">{t("club.settings.descriptionEnLabel")}</Label>
              <Textarea
                id="club-settings-desc-en"
                rows={3}
                value={descriptionEn}
                maxLength={4000}
                disabled={save.isPending}
                onChange={(e) => setDescriptionEn(e.target.value)}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="club-settings-rules">{t("club.settings.rulesLabel")}</Label>
              <Textarea
                id="club-settings-rules"
                rows={3}
                value={rulesPl}
                maxLength={4000}
                disabled={save.isPending}
                onChange={(e) => setRulesPl(e.target.value)}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="club-settings-rules-en">{t("club.settings.rulesEnLabel")}</Label>
              <Textarea
                id="club-settings-rules-en"
                rows={3}
                value={rulesEn}
                maxLength={4000}
                disabled={save.isPending}
                onChange={(e) => setRulesEn(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="club-settings-policy">{t("club.settings.policyAreaLabel")}</Label>
              <Input
                id="club-settings-policy"
                value={policyArea}
                maxLength={120}
                disabled={save.isPending}
                onChange={(e) => setPolicyArea(e.target.value)}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="club-settings-post">{t("club.settings.whoCanPostLabel")}</Label>
              <Select
                value={whoCanPost}
                onValueChange={(v) => setWhoCanPost(v as ClubPostPolicy)}
                disabled={save.isPending}
              >
                <SelectTrigger id="club-settings-post" className="rounded-[6px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLUB_POST_POLICIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`club.settings.postPolicy.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="club-settings-join">{t("club.settings.joinPolicyLabel")}</Label>
              <Select
                value={joinPolicy}
                onValueChange={(v) => setJoinPolicy(v as ClubJoinPolicy)}
                disabled={save.isPending}
              >
                <SelectTrigger id="club-settings-join" className="rounded-[6px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLUB_JOIN_POLICIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`club.settings.joinPolicyOption.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button
            variant="outline"
            className="rounded-[6px]"
            disabled={save.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("club.settings.cancel")}
          </Button>
          <Button className="rounded-[6px]" disabled={save.isPending} onClick={submit}>
            {t("club.settings.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

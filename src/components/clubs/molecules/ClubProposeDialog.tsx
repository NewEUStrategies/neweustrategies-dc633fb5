// Zgloszenie NOWEGO klubu przez czlonka.
//
// Dlaczego nie formularz administracyjny: `admin_club_upsert` jest admin-only,
// a czlonek ma prawo tylko ZAPROPONOWAC klub. Adres (slug), widocznosc i status
// swiadomie nie sa polami tego formularza - liczy je i pilnuje baza
// (`club_propose`), zeby zglaszajacy nie mogl sam opublikowac klubu.
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
import { useProposeClub } from "@/lib/clubs/useClubs";
import { toClubSaveError } from "@/lib/clubs/types";
import { ensureClubI18n } from "@/lib/i18n-club";

export function ClubProposeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  ensureClubI18n();
  const { t } = useTranslation();
  const propose = useProposeClub();
  const [namePl, setNamePl] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [policyArea, setPolicyArea] = useState("");
  const [motivation, setMotivation] = useState("");

  const reset = () => {
    setNamePl("");
    setNameEn("");
    setTagline("");
    setDescription("");
    setPolicyArea("");
    setMotivation("");
  };

  const submit = () => {
    const name = namePl.trim();
    if (name.length === 0) {
      toast.error(t("club.propose.nameRequired"));
      return;
    }
    propose.mutate(
      {
        name_pl: name,
        name_en: nameEn.trim() || null,
        tagline_pl: tagline.trim() || null,
        description_pl: description.trim() || null,
        policy_area: policyArea.trim() || null,
        motivation: motivation.trim() || null,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          reset();
          toast.success(t("club.propose.done"));
        },
        // Komunikat rozdziela limit dobowy od awarii - to dwa rozne nastepne
        // kroki dla zglaszajacego, wiec nie moga miec jednego zdania.
        onError: (error) => toast.error(t(`adminClubs.create.error.${toClubSaveError(error)}`)),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("club.propose.title")}</DialogTitle>
          <DialogDescription>{t("club.propose.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="club-propose-name">{t("club.propose.nameLabel")}</Label>
              <Input
                id="club-propose-name"
                value={namePl}
                maxLength={120}
                disabled={propose.isPending}
                onChange={(e) => setNamePl(e.target.value)}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="club-propose-name-en">{t("club.propose.nameEnLabel")}</Label>
              <Input
                id="club-propose-name-en"
                value={nameEn}
                maxLength={120}
                disabled={propose.isPending}
                onChange={(e) => setNameEn(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="club-propose-tagline">{t("club.propose.taglineLabel")}</Label>
            <Input
              id="club-propose-tagline"
              value={tagline}
              maxLength={200}
              disabled={propose.isPending}
              onChange={(e) => setTagline(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="club-propose-description">{t("club.propose.descriptionLabel")}</Label>
            <Textarea
              id="club-propose-description"
              rows={3}
              value={description}
              maxLength={2000}
              disabled={propose.isPending}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="club-propose-policy">{t("club.propose.policyAreaLabel")}</Label>
            <Input
              id="club-propose-policy"
              value={policyArea}
              maxLength={120}
              disabled={propose.isPending}
              onChange={(e) => setPolicyArea(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="club-propose-motivation">{t("club.propose.motivationLabel")}</Label>
            <Textarea
              id="club-propose-motivation"
              rows={3}
              value={motivation}
              maxLength={1000}
              disabled={propose.isPending}
              onChange={(e) => setMotivation(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button
            variant="outline"
            className="rounded-[6px]"
            disabled={propose.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("club.propose.cancel")}
          </Button>
          <Button className="rounded-[6px]" disabled={propose.isPending} onClick={submit}>
            {t("club.propose.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

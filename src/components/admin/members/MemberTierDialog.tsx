// Molekuła: ręczna zmiana planu członka. Nadanie zapisuje się w bazie i ma
// pierwszeństwo przed subskrypcją, więc działa bez operatora płatności.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  revokeMemberTier,
  setMemberTier,
  type MemberDirectoryRow,
} from "@/lib/admin/membersDirectory.functions";

const FOREVER = "__forever__";
const DURATIONS = [1, 3, 6, 12, 24] as const;

interface Props {
  member: MemberDirectoryRow | null;
  tiers: { key: string; name: string }[];
  onOpenChange: (open: boolean) => void;
}

export function MemberTierDialog({ member, tiers, onOpenChange }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const grantFn = useServerFn(setMemberTier);
  const revokeFn = useServerFn(revokeMemberTier);

  const [tierKey, setTierKey] = useState<string>(member?.tierKey ?? "");
  const [months, setMonths] = useState<string>("12");
  const [note, setNote] = useState<string>("");

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-members"] });
    if (member) {
      void queryClient.invalidateQueries({ queryKey: ["admin-member-billing", member.userId] });
    }
  };

  const grant = useMutation({
    mutationFn: async () => {
      if (!member) return;
      await grantFn({
        data: {
          userId: member.userId,
          tierKey: tierKey || member.tierKey,
          months: months === FOREVER ? null : Number(months),
          note: note.trim() ? note.trim() : null,
        },
      });
    },
    onSuccess: () => {
      toast.success(t("adminMembers.grant.success"));
      invalidate();
      onOpenChange(false);
    },
    onError: () => toast.error(t("adminMembers.grant.error")),
  });

  const revoke = useMutation({
    mutationFn: async () => {
      if (!member?.grantId) return;
      await revokeFn({ data: { grantId: member.grantId } });
    },
    onSuccess: () => {
      toast.success(t("adminMembers.grant.revoked"));
      invalidate();
      onOpenChange(false);
    },
    onError: () => toast.error(t("adminMembers.grant.error")),
  });

  return (
    <Dialog open={member !== null} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[6px] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("adminMembers.grant.title")}</DialogTitle>
          <DialogDescription>{t("adminMembers.grant.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="member-tier">{t("adminMembers.grant.tier")}</Label>
            <Select value={tierKey} onValueChange={setTierKey}>
              <SelectTrigger id="member-tier" className="rounded-[6px]">
                <SelectValue placeholder={t("adminMembers.grant.tier")} />
              </SelectTrigger>
              <SelectContent>
                {tiers.map((tier) => (
                  <SelectItem key={tier.key} value={tier.key}>
                    {tier.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="member-months">{t("adminMembers.grant.months")}</Label>
            <Select value={months} onValueChange={setMonths}>
              <SelectTrigger id="member-months" className="rounded-[6px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATIONS.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {t("adminMembers.grant.monthsOption", { count: value })}
                  </SelectItem>
                ))}
                <SelectItem value={FOREVER}>{t("adminMembers.grant.forever")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="member-note">{t("adminMembers.grant.note")}</Label>
            <Input
              id="member-note"
              className="rounded-[6px]"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {member?.grantId ? (
            <Button
              type="button"
              variant="outline"
              className="rounded-[6px]"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate()}
            >
              {t("adminMembers.grant.revoke")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              className="rounded-[6px]"
              onClick={() => onOpenChange(false)}
            >
              {t("adminMembers.grant.cancel")}
            </Button>
            <Button
              type="button"
              className="rounded-[6px]"
              disabled={grant.isPending}
              onClick={() => grant.mutate()}
            >
              {t("adminMembers.grant.submit")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Molekuła: okno „nowy segment odbiorców".
//
// Klucz segmentu wchodzi do URL-i i do `membership_tiers.audience_key`, więc
// walidacja formatu i kolizji siedzi w regule (`audienceKeyValid`), a okno
// jedynie ją stosuje: dopóki klucz jest zły albo zajęty, przycisk „utwórz"
// pozostaje wyłączony.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LabeledField } from "@/components/admin/pricing/atoms/LabeledField";
import { audienceKeyValid } from "@/lib/admin/pricingDrafts";

export function NewAudienceDialog({
  existingKeys,
  onCreate,
  isPending,
}: {
  existingKeys: string[];
  onCreate: (v: { key: string; name_pl: string; name_en: string }) => void;
  isPending: boolean;
}) {
  const { t } = useTranslation();
  const ta = (k: string) => t(`adminPricing.${k}`);
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [namePl, setNamePl] = useState("");
  const [nameEn, setNameEn] = useState("");

  const keyOk = audienceKeyValid(key, existingKeys);
  const canSubmit = keyOk && namePl.trim().length > 0 && nameEn.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onCreate({ key, name_pl: namePl, name_en: nameEn });
    setOpen(false);
    setKey("");
    setNamePl("");
    setNameEn("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {ta("audiences.new")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{ta("audiences.new")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <LabeledField label={ta("audiences.key")} hint={ta("audiences.keyHint")}>
            {(field) => (
              <Input
                {...field}
                value={key}
                onChange={(e) => setKey(e.target.value.toLowerCase())}
                placeholder="media"
                className="font-mono"
              />
            )}
          </LabeledField>
          <div className="grid grid-cols-2 gap-2">
            <LabeledField label={ta("audiences.namePl")}>
              {(field) => (
                <Input {...field} value={namePl} onChange={(e) => setNamePl(e.target.value)} />
              )}
            </LabeledField>
            <LabeledField label={ta("audiences.nameEn")}>
              {(field) => (
                <Input {...field} value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
              )}
            </LabeledField>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {ta("audiences.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSubmit || isPending}>
            {ta("audiences.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

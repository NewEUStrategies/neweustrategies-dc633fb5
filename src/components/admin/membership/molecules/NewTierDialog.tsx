// Molekuła: okno „nowa warstwa członkostwa".
//
// Klucz warstwy wchodzi do `access_plans.tier_key`, więc format i kolizję
// sprawdza wspólna reguła (`slugKeyValid`) - ta sama, która pilnuje kluczy
// segmentów cennika. Ranga jest podpowiadana jako „ostatnia + 10", żeby nowa
// warstwa domyślnie stawała na końcu drabinki, a nie w jej środku.
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
import { FloatingInput } from "@/components/ui/floating-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { slugKeyValid } from "@/lib/keyFormat";

export function NewTierDialog({
  existingKeys,
  suggestedRank,
  onCreate,
  isPending,
}: {
  existingKeys: string[];
  suggestedRank: number;
  onCreate: (v: { key: string; rank: number; name_pl: string; name_en: string }) => void;
  isPending: boolean;
}) {
  const { t } = useTranslation();
  const tm = (k: string) => t(`adminMembership.${k}`);
  const [open, setOpen] = useState(false);

  const [key, setKey] = useState("");
  const [rank, setRank] = useState(suggestedRank);
  const [namePl, setNamePl] = useState("");
  const [nameEn, setNameEn] = useState("");

  const keyOk = slugKeyValid(key, existingKeys);
  const canSubmit = keyOk && namePl.trim().length > 0 && nameEn.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onCreate({ key, rank, name_pl: namePl, name_en: nameEn });
    setOpen(false);
    setKey("");
    setRank(suggestedRank + 10);
    setNamePl("");
    setNameEn("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setRank(suggestedRank);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {tm("newTierDialog.title")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tm("newTierDialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">{tm("newTierDialog.key")}</Label>
            <Input
              value={key}
              onChange={(e) => setKey(e.target.value.toLowerCase())}
              placeholder="patron"
              className="font-mono"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{tm("newTierDialog.keyHint")}</p>
          </div>
          <div>
            <Label className="text-xs">{tm("fields.rank")}</Label>
            <Input
              type="number"
              min={0}
              value={rank}
              onChange={(e) => setRank(Number(e.target.value) || 0)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{tm("newTierDialog.rankHint")}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <FloatingInput
              label="Nazwa PL"
              value={namePl}
              onChange={(e) => setNamePl(e.target.value)}
            />
            <FloatingInput
              label="Name EN"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {tm("newTierDialog.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSubmit || isPending}>
            {tm("newTierDialog.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// UI primitives lokalne dla tej strony - spójne z /admin/paywall (KPI, sekcje,
// grupy pól). Nie eksportowane - używane wyłącznie tutaj.

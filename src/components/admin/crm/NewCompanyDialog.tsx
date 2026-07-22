// Dialog "Nowa firma" - formularz tworzenia rekordu crm_companies.
// Wcześniej przycisk na liście firm był `disabled`: firmy powstawały tylko
// przez synchronizację profil↔firma / import, mimo że polityka RLS INSERT
// (tenant + created_by) istnieje. Ten dialog domyka lukę UI.
//
// tenant_id i created_by rozwiązuje SERWEROWO createCrmCompany (klient ich nie
// dotyka - doktryna tenant_id). Po sukcesie unieważnia listę firm i (opcjonalnie)
// nawiguje do karty nowej firmy.
import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";

import { createCrmCompany } from "@/lib/crm-companies.functions";
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
  DialogTrigger,
} from "@/components/ui/dialog";

type Lang = "pl" | "en";

interface NewCompanyDialogProps {
  lang: Lang;
  /** Wołane po utworzeniu firmy z jej id (np. nawigacja do karty). */
  onCreated?: (id: string) => void;
}

interface FieldForm {
  name: string;
  domain: string;
  country: string;
  branch: string;
  city: string;
  address: string;
  postal_code: string;
  website: string;
  phone: string;
}

const EMPTY: FieldForm = {
  name: "",
  domain: "",
  country: "",
  branch: "",
  city: "",
  address: "",
  postal_code: "",
  website: "",
  phone: "",
};

export function NewCompanyDialog({ lang, onCreated }: NewCompanyDialogProps) {
  const t = (pl: string, en: string): string => (lang === "pl" ? pl : en);
  const qc = useQueryClient();
  const createFn = useServerFn(createCrmCompany);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FieldForm>(EMPTY);

  const set = (key: keyof FieldForm) => (e: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const mutation = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          name: form.name.trim(),
          domain: form.domain.trim() || undefined,
          country: form.country.trim() || undefined,
          branch: form.branch.trim() || undefined,
          city: form.city.trim() || undefined,
          address: form.address.trim() || undefined,
          postal_code: form.postal_code.trim() || undefined,
          website: form.website.trim() || undefined,
          phone: form.phone.trim() || undefined,
        },
      }),
    onSuccess: async (res) => {
      toast.success(t("Firma utworzona", "Company created"));
      await qc.invalidateQueries({ queryKey: ["admin", "crm-companies"] });
      setForm(EMPTY);
      setOpen(false);
      if (res?.id) onCreated?.(res.id);
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("duplicate_name")) {
        toast.error(
          t("Firma o tej nazwie już istnieje.", "A company with this name already exists."),
        );
      } else {
        toast.error(t("Nie udało się utworzyć firmy.", "Failed to create the company."));
      }
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || mutation.isPending) return;
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !mutation.isPending && setOpen(v)}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8 gap-1.5 text-[12px]">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t("Nowa firma", "New company")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Nowa firma", "New company")}</DialogTitle>
          <DialogDescription>
            {t(
              "Dodaj firmę do CRM. Tylko nazwa jest wymagana - resztę uzupełnisz później.",
              "Add a company to the CRM. Only the name is required - fill in the rest later.",
            )}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="nc-name">
              {t("Nazwa", "Name")} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="nc-name"
              value={form.name}
              onChange={set("name")}
              required
              autoFocus
              maxLength={200}
              placeholder={t("np. New European Strategies", "e.g. New European Strategies")}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="nc-domain">{t("Domena", "Domain")}</Label>
              <Input
                id="nc-domain"
                value={form.domain}
                onChange={set("domain")}
                maxLength={200}
                placeholder="example.org"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nc-website">{t("Strona WWW", "Website")}</Label>
              <Input
                id="nc-website"
                value={form.website}
                onChange={set("website")}
                maxLength={300}
                placeholder="https://example.org"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nc-branch">{t("Branża", "Industry")}</Label>
              <Input id="nc-branch" value={form.branch} onChange={set("branch")} maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nc-country">{t("Kraj", "Country")}</Label>
              <Input
                id="nc-country"
                value={form.country}
                onChange={set("country")}
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nc-city">{t("Miasto", "City")}</Label>
              <Input id="nc-city" value={form.city} onChange={set("city")} maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nc-postal">{t("Kod pocztowy", "Postal code")}</Label>
              <Input
                id="nc-postal"
                value={form.postal_code}
                onChange={set("postal_code")}
                maxLength={20}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="nc-address">{t("Adres", "Address")}</Label>
              <Input
                id="nc-address"
                value={form.address}
                onChange={set("address")}
                maxLength={300}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="nc-phone">{t("Telefon", "Phone")}</Label>
              <Input id="nc-phone" value={form.phone} onChange={set("phone")} maxLength={60} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={mutation.isPending}
            >
              {t("Anuluj", "Cancel")}
            </Button>
            <Button type="submit" disabled={!form.name.trim() || mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {t("Utwórz firmę", "Create company")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

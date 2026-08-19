// Dialog "Porozmawiajmy" dla ofert bez samoobsługowego checkoutu (korporacje,
// partnerstwa, grupy akademickie). Zgłoszenie idzie istniejącą, bezpieczną
// ścieżką Contact Center (submitContactMessage: zapis + auto-reply +
// powiadomienie admina) - zero nowych endpointów, pełna międzymodułowość.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { submitContactMessage } from "@/lib/contact.functions";
import { tierName, type MembershipTierRow } from "@/lib/billing/tiers";

const EMAIL_RE = /.+@.+\..+/;

export function ContactSalesDialog({
  open,
  onOpenChange,
  tier,
  lang,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tier: MembershipTierRow | null;
  lang: string;
}) {
  const { t } = useTranslation();
  const submit = useServerFn(submitContactMessage);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);

  const subject = tier
    ? t("pricing.contactDialog.subject", { tier: tierName(tier, lang) })
    : t("pricing.contactDialog.subjectGeneric");
  const canSubmit =
    !sending &&
    name.trim().length > 0 &&
    EMAIL_RE.test(email.trim()) &&
    message.trim().length > 0 &&
    consent;

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSending(true);
    try {
      const pageUrl = typeof window !== "undefined" ? window.location.href : "/pricing";
      await submit({
        data: {
          name: name.trim(),
          email: email.trim(),
          company: company.trim() || undefined,
          subject,
          message: message.trim(),
          consent: true,
          lang: lang === "en" ? "en" : "pl",
          source: "pricing",
          formId: "pricing-contact-sales",
          formName: "Pricing - contact sales",
          pageUrl,
        },
      });
      toast.success(t("pricing.contactDialog.success"));
      setName("");
      setEmail("");
      setCompany("");
      setMessage("");
      setConsent(false);
      onOpenChange(false);
    } catch {
      toast.error(t("pricing.contactDialog.error"));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !sending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("pricing.contactDialog.title")}</DialogTitle>
          <DialogDescription>{subject}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="pricing-contact-name" className="text-xs">
                {t("pricing.contactDialog.name")}
              </Label>
              <Input
                id="pricing-contact-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required
              />
            </div>
            <div>
              <Label htmlFor="pricing-contact-email" className="text-xs">
                {t("pricing.contactDialog.email")}
              </Label>
              <Input
                id="pricing-contact-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
          </div>
          <div>
            <Label htmlFor="pricing-contact-company" className="text-xs">
              {t("pricing.contactDialog.company")}
            </Label>
            <Input
              id="pricing-contact-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              autoComplete="organization"
            />
          </div>
          <div>
            <Label htmlFor="pricing-contact-message" className="text-xs">
              {t("pricing.contactDialog.message")}
            </Label>
            <Textarea
              id="pricing-contact-message"
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("pricing.contactDialog.messagePlaceholder")}
              required
            />
          </div>
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={consent}
              onCheckedChange={(value) => setConsent(value === true)}
              className="mt-0.5"
              aria-label={t("pricing.contactDialog.consent")}
            />
            <span>{t("pricing.contactDialog.consent")}</span>
          </label>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={sending}
              onClick={() => onOpenChange(false)}
            >
              {t("pricing.contactDialog.cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {sending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              {t("pricing.contactDialog.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

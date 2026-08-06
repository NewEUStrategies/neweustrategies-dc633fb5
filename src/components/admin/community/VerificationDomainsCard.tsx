// Panel katalogu zaufanych domen + ręczne uruchomienie przeglądu weryfikacji.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, ShieldCheck, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { confirmDialog } from "@/lib/appDialogs";
import { ProfileBadge } from "@/components/atoms/ProfileBadge";
import type { BadgeLocale } from "@/lib/profile/badgeCatalog";
import {
  deleteVerificationDomain,
  fetchVerificationDomains,
  isValidVerificationDomain,
  normalizeDomainInput,
  runOrgVerificationSweep,
  upsertVerificationDomain,
} from "@/lib/admin/verificationDomains";

interface Props {
  language: BadgeLocale;
  tenantId: string | null | undefined;
}

export function VerificationDomainsCard({ language, tenantId }: Props) {
  const isPl = language === "pl";
  const qc = useQueryClient();
  const [domain, setDomain] = useState("");
  const [note, setNote] = useState("");
  const [requireConfirmed, setRequireConfirmed] = useState(true);

  const q = useQuery({
    queryKey: ["admin-verification-domains", tenantId ?? "none"],
    queryFn: fetchVerificationDomains,
    enabled: !!tenantId,
    staleTime: 30_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-verification-domains"] });
    qc.invalidateQueries({ queryKey: ["admin-badges"] });
    qc.invalidateQueries({ queryKey: ["profile-badges"] });
  };

  const addM = useMutation({
    mutationFn: () =>
      upsertVerificationDomain({
        domain,
        badge: "verified",
        note: note || undefined,
        requireEmailConfirmed: requireConfirmed,
      }),
    onSuccess: () => {
      setDomain("");
      setNote("");
      invalidate();
      toast.success(isPl ? "Domena zapisana" : "Domain saved");
    },
    onError: () => toast.error(isPl ? "Nie udało się zapisać domeny" : "Could not save the domain"),
  });

  const toggleM = useMutation({
    mutationFn: (input: { domain: string; active: boolean; requireEmailConfirmed: boolean }) =>
      upsertVerificationDomain({
        domain: input.domain,
        badge: "verified",
        active: input.active,
        requireEmailConfirmed: input.requireEmailConfirmed,
      }),
    onSuccess: () => invalidate(),
    onError: () => toast.error(isPl ? "Nie udało się zmienić domeny" : "Could not update the domain"),
  });

  const deleteM = useMutation({
    mutationFn: deleteVerificationDomain,
    onSuccess: () => {
      invalidate();
      toast.success(isPl ? "Domena usunięta" : "Domain removed");
    },
    onError: () => toast.error(isPl ? "Nie udało się usunąć domeny" : "Could not remove the domain"),
  });

  const sweepM = useMutation({
    mutationFn: runOrgVerificationSweep,
    onSuccess: (result) => {
      invalidate();
      toast.success(
        isPl
          ? `Sprawdzono ${result.checked} profili - nadano ${result.granted}, cofnięto ${result.revoked}`
          : `Checked ${result.checked} profiles - granted ${result.granted}, revoked ${result.revoked}`,
      );
    },
    onError: () => toast.error(isPl ? "Przegląd nie powiódł się" : "The review failed"),
  });

  const normalized = normalizeDomainInput(domain);
  const canAdd = isValidVerificationDomain(normalized) && !addM.isPending;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            {isPl ? "Weryfikacja domenowa" : "Domain verification"}
          </CardTitle>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {isPl
              ? "Konto z potwierdzonym adresem w zaufanej domenie automatycznie otrzymuje odznakę „Zweryfikowany”. Zmiana adresu cofa wyłącznie nadania automatyczne."
              : "An account with a confirmed address in a trusted domain automatically receives the “Verified” badge. Changing the address only revokes automatic grants."}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => sweepM.mutate()}
          disabled={sweepM.isPending}
        >
          <RefreshCw
            className={`mr-1 h-4 w-4 ${sweepM.isPending ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          {isPl ? "Uruchom przegląd" : "Run review"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder={isPl ? "domena.pl" : "domain.com"}
            aria-label={isPl ? "Domena e-mail" : "Email domain"}
          />
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder={isPl ? "Notatka (opcjonalnie)" : "Note (optional)"}
            aria-label={isPl ? "Notatka do domeny" : "Domain note"}
          />
          <div className="flex items-center justify-between gap-3 rounded-[6px] border border-border px-3">
            <span className="text-xs text-muted-foreground">
              {isPl ? "Wymagaj potwierdzenia e-mail" : "Require email confirmation"}
            </span>
            <Switch
              checked={requireConfirmed}
              onCheckedChange={setRequireConfirmed}
              aria-label={isPl ? "Wymagaj potwierdzenia e-mail" : "Require email confirmation"}
            />
          </div>
        </div>
        <Button onClick={() => addM.mutate()} disabled={!canAdd}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          {isPl ? "Dodaj domenę" : "Add domain"}
        </Button>

        {(q.data ?? []).length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {isPl ? "Brak zaufanych domen" : "No trusted domains"}
          </p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-[6px] border border-border">
            {(q.data ?? []).map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{row.domain}</span>
                    <ProfileBadge badge={row.badge} language={language} />
                    {!row.require_email_confirmed && (
                      <Badge variant="outline">
                        {isPl ? "Bez potwierdzenia e-mail" : "No email confirmation"}
                      </Badge>
                    )}
                  </div>
                  {row.note && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">{row.note}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={row.active}
                    onCheckedChange={(active) =>
                      toggleM.mutate({
                        domain: row.domain,
                        active,
                        requireEmailConfirmed: row.require_email_confirmed,
                      })
                    }
                    aria-label={
                      isPl ? `Domena aktywna: ${row.domain}` : `Domain active: ${row.domain}`
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={isPl ? "Usuń domenę" : "Remove domain"}
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: isPl ? "Usunąć domenę?" : "Remove domain?",
                        description: isPl
                          ? `${row.domain} - nowe konta nie będą już weryfikowane automatycznie.`
                          : `${row.domain} - new accounts will no longer be verified automatically.`,
                        confirmLabel: isPl ? "Usuń" : "Remove",
                        destructive: true,
                      });
                      if (ok) deleteM.mutate(row.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

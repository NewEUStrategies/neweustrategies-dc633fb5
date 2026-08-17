// Dialog wyboru organizacji dla wpisu: wyszukiwanie w katalogu CRM plus
// przejście do formularza zakładania brakującej (OrganizationCreateForm).
// Jedna powierzchnia, dwa tryby - wzorzec z components/profile/CompanyPickerDialog.
//
// DLACZEGO RPC, A NIE `listCrmCompanies` / `createCrmCompany`. Te funkcje
// serwerowe stoją za `requireCrmStaff` (admin / editor / super_admin), a wpisy
// pisze TAKŻE rola `author` - dla niej „wybierz z listy" nie działałoby wcale.
// Zdjęcie middleware'u nic by nie dało: polityki RLS na `crm_companies`
// (crm_companies_staff_read / _insert) wymagają dokładnie tych samych rol.
// Właściwą ścieżką są istniejące funkcje SECURITY DEFINER, ZAWĘŻONE DO NAJEMCY
// i nadane roli `authenticated`:
//   * search_companies_public - oddaje tylko pola prezentacyjne, BEZ leadów
//     i BEZ pipeline'u, więc autor nie dostaje wglądu w dane sprzedażowe
//     (przywilej najmniejszy, nie „wpuśćmy autora do CRM");
//   * create_company_self_service - ustawia tenant_id i created_by PO STRONIE
//     BAZY, więc klient nie ma czym wskazać obcego najemcy.
// Migracja 20260817090000 dołożyła do obu obsługę `logo_url` - wcześniej katalog
// nie umiał ani zwrócić logo, ani go zapisać.
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Building2, Check, Loader2, Plus, Search } from "lucide-react";
import { z } from "zod";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { OrganizationCreateForm } from "./OrganizationCreateForm";
import {
  ORGANIZATION_SEARCH_LIMIT,
  organizationRowSchema,
  organizationSearchKey,
  type OrganizationRow,
  type OrganizationSelection,
} from "./organizationDirectory";
import "@/lib/i18n-admin-post-panes";

export function OrganizationPickerDialog({
  open,
  onOpenChange,
  currentId,
  currentName,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentId: string | null;
  currentName: string | null;
  onSelect: (selection: OrganizationSelection) => void;
}) {
  const { t } = useTranslation();
  const { tenantId } = useAuth();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"search" | "create">("search");
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery(currentName ?? "");
    setMode("search");
    const id = window.setTimeout(() => searchRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [open, currentName]);

  const trimmed = query.trim();
  const search = useQuery({
    queryKey: organizationSearchKey(tenantId, trimmed),
    enabled: open && !!tenantId,
    staleTime: 30_000,
    queryFn: async (): Promise<OrganizationRow[]> => {
      const { data, error } = await supabase.rpc("search_companies_public", {
        _query: trimmed,
        _limit: ORGANIZATION_SEARCH_LIMIT,
      });
      if (error) throw error;
      const parsed = z.array(organizationRowSchema).safeParse(data ?? []);
      if (!parsed.success) {
        console.error("search_companies_public parse error", parsed.error);
        return [];
      }
      return parsed.data;
    },
  });

  const results = search.data ?? [];
  // Zależność to `search.data`, nie `results`: `?? []` tworzy nową tablicę przy
  // każdym renderze, więc memo z `results` nic by nie zapamiętywało.
  const exactMatch = useMemo(
    () => (search.data ?? []).some((r) => r.name.trim().toLowerCase() === trimmed.toLowerCase()),
    [search.data, trimmed],
  );

  const pick = (row: OrganizationRow): void => {
    onSelect({
      id: row.id,
      name: row.name.trim(),
      logoUrl: row.logo_url?.trim() || null,
      website: row.website?.trim() || null,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-border px-5 pb-3 pt-5">
          <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold">
            <Building2 className="h-4 w-4 text-primary" aria-hidden="true" />
            {mode === "create"
              ? t("adminPostPanes.organization.dialogCreateTitle")
              : t("adminPostPanes.organization.dialogPickTitle")}
          </DialogTitle>
          <DialogDescription className="text-[12px] text-muted-foreground">
            {mode === "create"
              ? t("adminPostPanes.organization.dialogCreateDesc")
              : t("adminPostPanes.organization.dialogPickDesc")}
          </DialogDescription>
        </DialogHeader>

        {mode === "create" ? (
          <OrganizationCreateForm
            initialName={trimmed}
            onBack={() => setMode("search")}
            onCancel={() => onOpenChange(false)}
            onCreated={(selection) => {
              onSelect(selection);
              onOpenChange(false);
            }}
          />
        ) : (
          <div className="flex flex-col">
            <div className="border-b border-border px-5 py-3">
              <div className="relative">
                <Search
                  className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("adminPostPanes.organization.searchPlaceholder")}
                  className="h-9 rounded-md pl-9 text-[13px]"
                  autoComplete="off"
                  aria-label={t("adminPostPanes.organization.searchPlaceholder")}
                />
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto py-1">
              {search.isLoading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                </div>
              ) : search.isError ? (
                <div className="px-5 py-6 text-center text-[12px] text-destructive">
                  {t("adminPostPanes.organization.searchFailed")}
                </div>
              ) : results.length === 0 ? (
                <div className="px-5 py-6 text-center text-[12px] text-muted-foreground">
                  {trimmed
                    ? t("adminPostPanes.organization.noMatches")
                    : t("adminPostPanes.organization.startTyping")}
                </div>
              ) : (
                <ul className="py-1">
                  {results.map((row) => {
                    const active = row.id === currentId;
                    const meta = [row.city, row.country, row.branch].filter(Boolean).join(" · ");
                    return (
                      <li key={row.id}>
                        <button
                          type="button"
                          onClick={() => pick(row)}
                          aria-current={active ? "true" : undefined}
                          className={cn(
                            "flex w-full items-center gap-3 px-5 py-2 text-left transition-colors hover:bg-muted/70",
                            active && "bg-muted/50",
                          )}
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
                            {row.logo_url ? (
                              <img
                                src={row.logo_url}
                                alt=""
                                className="h-full w-full object-contain"
                              />
                            ) : (
                              <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-foreground">
                              {row.name}
                            </span>
                            {meta && (
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {meta}
                              </span>
                            )}
                          </span>
                          {active && (
                            <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {trimmed && !exactMatch && !search.isLoading && (
              <button
                type="button"
                onClick={() => setMode("create")}
                className="flex items-center gap-2 border-t border-border px-5 py-2.5 text-left text-[13px] font-medium text-primary transition-colors hover:bg-primary/5"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span className="min-w-0 truncate">
                  {t("adminPostPanes.organization.createNamed", { name: trimmed })}
                </span>
              </button>
            )}

            <DialogFooter className="flex-row justify-end gap-2 border-t border-border bg-muted/30 px-5 py-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-[12px]"
                onClick={() => onOpenChange(false)}
              >
                {t("common.cancel")}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

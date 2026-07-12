// /admin/community/badges — katalog odznak + ręczne przyznawanie/odbieranie.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Award, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BADGE_CATALOG,
  fetchBadges,
  grantBadge,
  revokeBadge,
} from "@/lib/admin/community";

export const Route = createFileRoute("/admin/community/badges")({
  head: () => ({ meta: [{ title: "Badges · Community · Admin" }] }),
  component: BadgesAdmin,
});

function BadgesAdmin() {
  const { i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const qc = useQueryClient();
  const [userId, setUserId] = useState("");
  const [badgeKey, setBadgeKey] = useState(BADGE_CATALOG[0]?.key ?? "verified");
  const [note, setNote] = useState("");

  const q = useQuery({
    queryKey: ["admin-badges"],
    queryFn: fetchBadges,
    staleTime: 30_000,
  });

  const grantM = useMutation({
    mutationFn: () => grantBadge(userId.trim(), badgeKey, note.trim() || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-badges"] });
      setUserId("");
      setNote("");
      toast.success(isPl ? "Przyznano" : "Granted");
    },
    onError: (err: Error) => toast.error(err.message || (isPl ? "Błąd" : "Failed")),
  });

  const revokeM = useMutation({
    mutationFn: revokeBadge,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-badges"] });
      toast.success(isPl ? "Odebrano" : "Revoked");
    },
    onError: () => toast.error(isPl ? "Błąd" : "Failed"),
  });

  const labelFor = (key: string) => {
    const entry = BADGE_CATALOG.find((b) => b.key === key);
    if (!entry) return key;
    return isPl ? entry.labelPl : entry.labelEn;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Award className="w-4 h-4" />
        <h2 className="text-lg font-semibold">{isPl ? "Odznaki" : "Badges"}</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{isPl ? "Przyznaj odznakę" : "Grant badge"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input
              placeholder="user_id (UUID)"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            />
            <Select value={badgeKey} onValueChange={setBadgeKey}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {BADGE_CATALOG.map((b) => (
                  <SelectItem key={b.key} value={b.key}>
                    {isPl ? b.labelPl : b.labelEn}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder={isPl ? "Notatka (opcjonalnie)" : "Note (optional)"}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <Button
            onClick={() => grantM.mutate()}
            disabled={!userId.trim() || grantM.isPending}
          >
            <Plus className="w-4 h-4 mr-1" />
            {isPl ? "Przyznaj" : "Grant"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isPl ? "Ostatnio przyznane" : "Recently granted"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {(q.data ?? []).length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">
              {isPl ? "Brak odznak" : "No badges"}
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {(q.data ?? []).map((b) => (
                <li key={b.id} className="p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge>{labelFor(b.badge)}</Badge>
                      <span className="text-xs text-muted-foreground font-mono truncate">
                        {b.user_id}
                      </span>
                    </div>
                    {b.note && <div className="text-xs text-muted-foreground mt-1">{b.note}</div>}
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {new Date(b.created_at).toLocaleString()}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm(isPl ? "Odebrać?" : "Revoke?")) revokeM.mutate(b.id);
                    }}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

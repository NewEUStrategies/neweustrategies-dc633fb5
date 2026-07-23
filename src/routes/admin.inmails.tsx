import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAdminInmails, useResolveInmail, type InMailRow } from "@/lib/chat/useInmails";
import { ensureI18n as ensureInmailI18n } from "@/lib/i18n-inmail";

export const Route = createFileRoute("/admin/inmails")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Zapytania do ekspertów - Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminInmails,
});

const STATUSES = ["pending", "approved", "declined", "answered", "cancelled"] as const;

function AdminInmails() {
  ensureInmailI18n();
  const { t } = useTranslation();
  const [status, setStatus] = useState<string>("pending");
  const q = useAdminInmails(status === "all" ? null : status);
  const resolve = useResolveInmail();

  async function act(row: InMailRow, action: "approve" | "decline" | "answered") {
    try {
      const res = await resolve.mutateAsync({ inmailId: row.id, action });
      toast.success(t(`inmail.status.${res?.status ?? action}`));
    } catch (e) {
      toast.error(t("inmail.error.generic"));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-bold uppercase italic tracking-tight text-foreground">
          {t("inmail.admin.title")}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">{t("inmail.admin.subtitle")}</p>
      </header>

      <div className="flex items-center gap-3">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("inmail.admin.filter")}
        </label>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-56 rounded-[6px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("inmail.admin.filterAll")}</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`inmail.status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {t("inmail.admin.countTotal", { count: q.data?.length ?? 0 })}
        </span>
      </div>

      <div className="overflow-hidden rounded-[6px] border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("inmail.fields.subject")}</TableHead>
              <TableHead>{t("inmail.status.pending")}</TableHead>
              <TableHead className="text-right">-</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(q.data ?? []).map((row) => (
              <TableRow key={row.id}>
                <TableCell className="max-w-md">
                  <p className="truncate text-sm font-semibold">{row.subject}</p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{row.reason}</p>
                </TableCell>
                <TableCell>
                  <span className="rounded-[6px] border border-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                    {t(`inmail.status.${row.status}`)}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {row.status === "pending" && (
                    <div className="flex justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-[6px]"
                        onClick={() => act(row, "decline")}
                      >
                        {t("inmail.actions.decline")}
                      </Button>
                      <Button
                        size="sm"
                        className="rounded-[6px]"
                        onClick={() => act(row, "approve")}
                      >
                        {t("inmail.actions.approve")}
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {(q.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-xs text-muted-foreground">
                  {t("inmail.box.empty")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

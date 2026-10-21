// Treść napraw CRM: osoba z zespołu (admin, redaktor) - ta sama lista co
// wybór właściciela w CRM (`crmStaffUsersQueryOptions`, granica personelu
// sprawdzana też przez serwer). Dla zadań bez osoby wybór pojawia się
// wyłącznie przy rozwiązaniu „pozostałe wskazanej osobie".
import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { FormSelect } from "@/components/atoms/FormSelect";
import { Label } from "@/components/ui/label";
import type {
  AssignOwnerPayload,
  AssignTasksPayload,
  QuickFixBodyProps,
} from "@/lib/admin/revenue/quickFixes";
import { crmStaffUsersQueryOptions } from "@/lib/crm/leadMutations";
import { ensureI18n } from "@/lib/i18n-admin-revenue-diagnostics";

type StaffPayload = AssignOwnerPayload | AssignTasksPayload;

function isOwnerPayload(value: StaffPayload): value is AssignOwnerPayload {
  return "ownerId" in value;
}

export default function StaffPickerBody({
  value,
  onChange,
  disabled,
}: QuickFixBodyProps<StaffPayload>) {
  ensureI18n();
  const { t } = useTranslation();
  const id = useId();
  const owner = isOwnerPayload(value);
  const staff = useQuery({ ...crmStaffUsersQueryOptions(), enabled: owner || value.useFallback });
  if (!owner && !value.useFallback) return null;

  const selected = owner ? value.ownerId : value.fallbackAssigneeId;
  const choose = (next: string) => {
    const person = next === "" ? null : next;
    onChange(owner ? { ...value, ownerId: person } : { ...value, fallbackAssigneeId: person });
  };

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{t("adminRevenue.fix.body.staff")}</Label>
      {staff.isPending ? (
        <p className="m-0 text-sm text-muted-foreground">{t("adminRevenue.fix.body.staffLoading")}</p>
      ) : (staff.data ?? []).length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">{t("adminRevenue.fix.body.staffEmpty")}</p>
      ) : (
        <FormSelect
          id={id}
          value={selected ?? ""}
          onValueChange={choose}
          options={(staff.data ?? []).map((user) => ({ value: user.id, label: user.label }))}
          placeholder={t("adminRevenue.fix.body.staffPlaceholder")}
          disabled={disabled}
        />
      )}
    </div>
  );
}

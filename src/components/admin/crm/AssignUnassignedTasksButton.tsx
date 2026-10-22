// Akcja listy CRM „Przypisz zadania bez osoby" (I9, Z-S7-02 / P24).
//
// JEDEN PISARZ. Zapis idzie tym samym server fn modułu CRM
// (`assignUnassignedCrmTasks`, S4: bramka `requireCrmStaff`, RLS najemcy),
// który hub woła jako szybką naprawę reguły `crm.tasks_unassigned` - CRM nie
// ma własnego `.update()` na `crm_tasks`. Manifest synchronizacji wskazuje
// ten eksport jako pisarza bytu `crm_task`.
//
// TYLKO WŁAŚCICIEL LEADA. Z listy CRM akcja przypisuje zadania właścicielom
// leadów; zadań leadów bez właściciela nie rusza (wskazanie osoby to decyzja
// - dialog naprawy w Diagnostyce huba ma do tego wybór osoby z zespołu).
// Wynik mówi, ile przypisano i ile zostało.
//
// POTWIERDZENIE PRZED ZAPISEM, bo przypisania nie da się cofnąć zbiorczo.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/lib/appDialogs";
import { assignUnassignedCrmTasks } from "@/lib/crm-tasks.functions";
import { crmKeys } from "@/lib/crm/keys";
import { ensureI18n } from "@/lib/i18n-admin-crm-tasks";

const K = "adminCrmTasks.assignUnassigned";

export function AssignUnassignedTasksButton() {
  ensureI18n();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const assign = useMutation({
    mutationFn: () => assignUnassignedCrmTasks({ data: { fallback_assignee_id: null } }),
    onSuccess: (result) => {
      // Zadania i licznik follow-upów listy (`crmKeys.tasksAll()`) oraz karty
      // leadów (osoba przy zadaniu) - te same prefiksy co mutatory zadań.
      void qc.invalidateQueries({ queryKey: crmKeys.tasksAll() });
      void qc.invalidateQueries({ queryKey: crmKeys.leadsAll() });
      const assigned = result.assigned_to_owner + result.assigned_to_fallback;
      if (assigned > 0) toast.success(t(`${K}.assigned`, { count: assigned }));
      else if (result.remaining === 0) toast.info(t(`${K}.none`));
      if (result.remaining > 0) toast.warning(t(`${K}.remaining`, { count: result.remaining }));
    },
    onError: () => toast.error(t(`${K}.failed`)),
  });

  const run = async () => {
    const ok = await confirmDialog({
      title: t(`${K}.confirmTitle`),
      description: t(`${K}.confirmBody`),
      confirmLabel: t(`${K}.confirm`),
      cancelLabel: t(`${K}.cancel`),
    });
    if (ok) assign.mutate();
  };

  return (
    <Button variant="outline" size="sm" onClick={() => void run()} disabled={assign.isPending}>
      <UserCheck className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
      {t(`${K}.action`)}
    </Button>
  );
}

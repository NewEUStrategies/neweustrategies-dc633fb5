// Reguły obszaru „CRM i leady" (SPEC §5.7; P24, Z-S4-13).
//
// Naprawy CRM idą WYŁĄCZNIE przez server fn S4 (`assignUnassignedCrmTasks`,
// `bulkUpdateCrmLeads`) - kolumny cyklu życia i konta z klienta to 42501
// (Z-S4-13), więc `leads_without_user_id` prowadzi do CRM bez dialogu.
import { areaFacts, ev, finding, OK, UNKNOWN } from "../facts";
import type { RevenueCheck } from "../registry";

const OWNER = { to: "/admin/crm" } as const;

export const CRM_CHECKS = [
  {
    // P24: zadanie z automatu bez osoby nie ma do kogo wysłać przypomnienia.
    // Po terminie (`due_at` minął) follow-up już przepadł.
    id: "crm.auto_tasks_without_assignee",
    area: "crm",
    severity: "warning",
    evaluate(facts) {
      const tasks = areaFacts(facts, "crm")?.autoTasksUnassigned;
      if (tasks?.open === undefined || tasks.overdue === undefined) return UNKNOWN;
      if (tasks.open === 0) return OK;
      return finding(tasks.overdue > 0 ? "error" : "warn", {
        count: tasks.open,
        evidence: ev("autoTasksUnassigned", { count: tasks.open, overdue: tasks.overdue }),
      });
    },
    fix: { kind: "dialog", dialog: "crm_assign_tasks" },
    owner: OWNER,
    snoozable: true,
  },
  {
    id: "crm.qualified_without_owner",
    area: "crm",
    severity: "info",
    evaluate(facts) {
      const leads = areaFacts(facts, "crm")?.qualifiedWithoutOwner;
      if (leads?.mqlSql === undefined || leads.opportunity === undefined) return UNKNOWN;
      if (leads.mqlSql + leads.opportunity === 0) return OK;
      // Szansa sprzedaży bez opiekuna to otwarta rozmowa, której nikt nie prowadzi.
      return finding(leads.opportunity > 0 ? "error" : "warn", {
        count: leads.mqlSql + leads.opportunity,
        refs: leads.refs,
        evidence: ev("qualifiedWithoutOwner", {
          count: leads.mqlSql + leads.opportunity,
          opportunity: leads.opportunity,
        }),
      });
    },
    fix: { kind: "dialog", dialog: "crm_assign_owner" },
    owner: OWNER,
    snoozable: true,
  },
  {
    id: "crm.leads_without_user_id",
    area: "crm",
    severity: "info",
    evaluate(facts) {
      const leads = areaFacts(facts, "crm")?.withoutUserId;
      if (leads?.registered === undefined || leads.customer === undefined) return UNKNOWN;
      if (leads.registered + leads.customer === 0) return OK;
      // Klient bez powiązanego konta nie dostanie zmian etapu z billingu.
      return finding(leads.customer > 0 ? "error" : "warn", {
        count: leads.registered + leads.customer,
        evidence: ev("leadsWithoutAccount", {
          registered: leads.registered,
          customer: leads.customer,
        }),
      });
    },
    fix: { kind: "link", to: "/admin/crm" },
    owner: OWNER,
    snoozable: true,
  },
] as const satisfies readonly RevenueCheck[];

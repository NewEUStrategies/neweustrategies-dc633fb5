// Hook w osobnym pliku (nie w atoms.tsx z komponentami) - react-refresh
// wymaga, by plik eksportował wyłącznie komponenty.
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-workflows";
import type { WorkflowActionKey } from "@/lib/admin/workflows";

/** Zlokalizowana nazwa akcji z katalogu silnika. */
export function useActionName(): (action: WorkflowActionKey) => string {
  const { t } = useTranslation();
  return (action) => t(`adminWorkflows.actions.${action}.name`);
}

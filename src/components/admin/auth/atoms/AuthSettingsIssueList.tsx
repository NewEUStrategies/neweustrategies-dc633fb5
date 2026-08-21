// ATOM: lista zastrzeżeń do kombinacji ustawień logowania.
//
// Dostaje GOTOWE zastrzeżenia z `lib/authSettingsRules` i tłumaczy ich klucze.
// Reguła, która decyduje, CZY zastrzeżenie powstaje, nie mieszka tutaj - atom
// nie ocenia ustawień, tylko je pokazuje.
//
// Blokujące i ostrzegające różnią się KOLOREM i ROLĄ dostępności: blokada jedzie
// jako `role="alert"` (czytnik ekranu ogłasza ją od razu, bo bez niej zapis nie
// przejdzie), ostrzeżenie jako zwykły tekst pomocniczy.
import { useTranslation } from "react-i18next";
import type { AuthSettingsIssue } from "@/lib/authSettingsRules";

export function AuthSettingsIssueList({ issues }: { issues: readonly AuthSettingsIssue[] }) {
  const { t } = useTranslation();
  if (issues.length === 0) return null;
  return (
    <ul className="space-y-1.5" data-testid="auth-settings-issues">
      {issues.map((issue) => {
        const blocking = issue.severity === "blocking";
        return (
          <li key={issue.id} data-issue-id={issue.id} data-issue-severity={issue.severity}>
            {/*
              `role="alert"` siedzi na WNĘTRZU, nie na `<li>`: rola alertu na
              elemencie listy zabiera liście jej semantykę (axe: `list`
              i `aria-allowed-role`), więc czytnik przestaje ogłaszać „lista,
              3 elementy" - a przy trzech zastrzeżeniach naraz to jest ta
              informacja, której operator potrzebuje najbardziej.
            */}
            <div
              role={blocking ? "alert" : undefined}
              className={
                blocking
                  ? "rounded-md border border-destructive/50 bg-destructive/10 p-2.5 text-xs text-destructive"
                  : "rounded-md border border-dashed border-border bg-muted/40 p-2.5 text-xs text-muted-foreground"
              }
            >
              {t(issue.messageKey)}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

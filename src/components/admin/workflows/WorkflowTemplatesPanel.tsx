// Katalog gotowych przepisów cross-module (workflow_templates) z instalacją
// przez RPC install_workflow_template. Nazwy/opisy są dwujęzyczne w danych
// (name_pl/name_en), więc lokalizacja idzie z wiersza, nie ze słownika.
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-workflows";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, DownloadCloud, Loader2, PackageOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  installWorkflowTemplate,
  type WorkflowDefinitionRow,
  type WorkflowTemplateRow,
} from "@/lib/admin/workflows";
import { EventTypeChip, StepChips } from "./atoms";

interface WorkflowTemplatesPanelProps {
  templates: WorkflowTemplateRow[];
  definitions: WorkflowDefinitionRow[];
  loading: boolean;
}

export function WorkflowTemplatesPanel({
  templates,
  definitions,
  loading,
}: WorkflowTemplatesPanelProps) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === "en";
  const qc = useQueryClient();

  // Szablon uznajemy za zainstalowany, gdy w tenancie istnieje definicja
  // z tym template_key (niezależnie od enabled - instalacja re-aktywuje).
  const installedKeys = new Set(
    definitions.map((d) => d.template_key).filter((key): key is string => key !== null),
  );

  const install = useMutation({
    mutationFn: (key: string) => installWorkflowTemplate(key),
    onSuccess: () => {
      toast.success(t("adminWorkflows.templates.installedToast"));
      void qc.invalidateQueries({ queryKey: ["admin", "workflow-definitions"] });
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(t("adminWorkflows.common.error", { message }));
    },
  });

  if (!loading && templates.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <PackageOpen className="h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">{t("adminWorkflows.templates.empty")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-muted-foreground">
        {t("adminWorkflows.templates.intro")}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {templates.map((template) => {
          const installed = installedKeys.has(template.key);
          const installing = install.isPending && install.variables === template.key;
          return (
            <Card key={template.key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {isEn ? template.name_en : template.name_pl}
                </CardTitle>
                <CardDescription>
                  {isEn ? template.description_en : template.description_pl}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t("adminWorkflows.templates.trigger")}
                  </span>
                  <EventTypeChip type={template.trigger_event_type} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t("adminWorkflows.templates.steps")}
                  </span>
                  <StepChips steps={template.steps} />
                </div>
              </CardContent>
              <CardFooter>
                {installed ? (
                  <Badge
                    variant="outline"
                    className="gap-1 border-emerald-500/30 bg-emerald-500/10 font-normal text-emerald-600 dark:text-emerald-400"
                  >
                    <CheckCircle2 className="h-3 w-3" aria-hidden />
                    {t("adminWorkflows.templates.installed")}
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => install.mutate(template.key)}
                    disabled={install.isPending}
                  >
                    {installing ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <DownloadCloud className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                    )}
                    {t("adminWorkflows.templates.install")}
                  </Button>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

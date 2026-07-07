// /admin/newsletter/overview - KPI, logika, tryb, dual preview.
import { createFileRoute } from "@tanstack/react-router";
import { OverviewPanel } from "@/components/admin/newsletter/OverviewPanel";

export const Route = createFileRoute("/admin/newsletter/overview")({ component: OverviewPanel });

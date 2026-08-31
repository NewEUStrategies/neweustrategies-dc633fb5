// Trasa panelu reklam - cienkie opakowanie organizmu.
// Cala zawartosc panelu mieszka w `@/components/admin/ads` (atoms / molecules /
// organisms), bo w pliku trasy byla nieosiagalna dla testow inaczej niz przez
// montowanie 800 linii naraz.
import { createFileRoute } from "@tanstack/react-router";
import { AdsAdmin } from "@/components/admin/ads/organisms/AdsAdmin";

export const Route = createFileRoute("/admin/ads")({ component: AdsAdmin });

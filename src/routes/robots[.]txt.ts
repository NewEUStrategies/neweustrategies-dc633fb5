// Dynamiczne robots.txt.
// - Na hostach kanonicznych (marka albo domena tenanta): indeksowanie dozwolone,
//   ogłoszone sitemapy i redakcyjna polityka crawlerów AI.
// - Na hostach niekanonicznych tego wdrożenia (aliasy warstwy hostingu, domeny
//   historyczne z `LEGACY_HOST_SUFFIXES`, podglądy edytora): pełny zakaz, żeby
//   wyszukiwarki wyrzuciły z indeksu adresy aliasu, a nie trzymały duplikatu.
// - Na hostach nieznanych: bezpieczny domyślny zakaz (fail-closed).
//
// UWAGA WDROŻENIOWA (audyt 2026-08-06): ta trasa MUSI pozostać jedynym źródłem
// /robots.txt. Plik `public/robots.txt` trafiał do `.output/public/`, które
// wrangler wiąże jako `assets`, a warstwa assetów odpowiada PRZED workerem -
// przez to trasa była na produkcji nieosiągalna i każdy host (także alias
// hostingu) dostawał statyczne `Allow: /`. Plik został usunięty, a przed
// powrotem chronią dwie bariery: bramka CI `check:public-assets` (żaden plik z
// `public/` nie może przesłonić trasy) i `assets.run_worker_first` w konfiguracji
// nitro/wranglera (worker wygrywa dla powierzchni maszynowych).
//
// Cała logika (klasyfikacja hosta, tenant, ustawienia, nagłówki) żyje w
// `robotsRequest.server.ts` i `lib/seo/robots.ts` - tu zostaje samo wiązanie
// żądania z odpowiedzią.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { robotsHeaders } from "@/lib/seo/robots";
import { planRobotsTxt } from "@/lib/server/robotsRequest.server";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async () => {
        const plan = await planRobotsTxt(getRequest());
        return new Response(plan.body, { headers: robotsHeaders(plan) });
      },
    },
  },
});

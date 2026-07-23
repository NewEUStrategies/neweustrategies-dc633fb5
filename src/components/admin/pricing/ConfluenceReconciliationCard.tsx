// Referencja TYLKO dla panelu admina (nie publiczna): uzgodnienie świadczeń z
// modelu subskrypcji w Confluence ze stanem na żywej platformie + rekomendowany
// próg docelowy. Pomaga redakcji zdecydować, gdzie osadzić lub czy wycofać
// świadczenie - nie jest to komunikat sprzedażowy, więc żyje pod bramką staff.
// Dane są statyczną notą redakcyjną (bilingual inline), nie konfiguracją CMS.
import { useTranslation } from "react-i18next";
import { BookMarked, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Row {
  benefit: { pl: string; en: string };
  origin: { pl: string; en: string };
  platform: { pl: string; en: string };
  target: { pl: string; en: string };
}

const ROWS: Row[] = [
  {
    benefit: {
      pl: "Karta członkowska VIP (fiz./cyfrowa)",
      en: "VIP membership card (physical/digital)",
    },
    origin: { pl: "Roczny", en: "Annual" },
    platform: { pl: "Osadzone w katalogu (VIP)", en: "Placed in the catalogue (VIP)" },
    target: { pl: "VIP / President's Circle", en: "VIP / President's Circle" },
  },
  {
    benefit: { pl: "Prawo zgłoszenia tematu badawczego", en: "Right to propose a research topic" },
    origin: { pl: "Roczny", en: "Annual" },
    platform: { pl: "Osadzone (VIP, Partner Generalny)", en: "Placed (VIP, General Partner)" },
    target: { pl: "VIP i Partner Generalny", en: "VIP and General Partner" },
  },
  {
    benefit: {
      pl: "Udział w panelu recenzenckim publikacji",
      en: "Seat on the publication review panel",
    },
    origin: { pl: "Roczny", en: "Annual" },
    platform: { pl: "Osadzone (Partner Generalny)", en: "Placed (General Partner)" },
    target: { pl: "VIP / Kadra Akademicka", en: "VIP / Academic Faculty" },
  },
  {
    benefit: {
      pl: "Priorytet na wizyty studyjne (UE/ONZ/NATO)",
      en: "Priority for study visits (EU/UN/NATO)",
    },
    origin: { pl: "Roczny", en: "Annual" },
    platform: { pl: "Brak - do decyzji", en: "None - to decide" },
    target: { pl: "VIP / President's Circle", en: "VIP / President's Circle" },
  },
  {
    benefit: {
      pl: "Indywidualna sesja mentoringowa „Career Path”",
      en: "Individual „Career Path” mentoring session",
    },
    origin: { pl: "Roczny", en: "Annual" },
    platform: { pl: "Osadzone (VIP)", en: "Placed (VIP)" },
    target: { pl: "VIP; osobno Akademia", en: "VIP; Academy separately" },
  },
  {
    benefit: { pl: "Roczny Zjazd / Summit dla VIP", en: "Annual VIP Summit" },
    origin: { pl: "Roczny", en: "Annual" },
    platform: { pl: "Osadzone (VIP); Decision Lab w B2B", en: "Placed (VIP); Decision Lab in B2B" },
    target: { pl: "VIP + President's Circle", en: "VIP + President's Circle" },
  },
  {
    benefit: {
      pl: "Pakiet materiałów drukowanych (co pół roku)",
      en: "Printed materials pack (every six months)",
    },
    origin: { pl: "Roczny", en: "Annual" },
    platform: { pl: "Osadzone (VIP)", en: "Placed (VIP)" },
    target: { pl: "VIP", en: "VIP" },
  },
  {
    benefit: { pl: "Status „Ambasadora” think-tanku", en: "Think-tank „Ambassador” status" },
    origin: { pl: "Roczny (opcja)", en: "Annual (optional)" },
    platform: { pl: "Brak - do decyzji", en: "None - to decide" },
    target: { pl: "VIP, po weryfikacji zaangażowania", en: "VIP, after engagement verification" },
  },
  {
    benefit: { pl: "Narzędzia cytowania (APA, Chicago)", en: "Citation tools (APA, Chicago)" },
    origin: { pl: "Miesięczny", en: "Monthly" },
    platform: {
      pl: "Boks „Cytuj tę analizę” (istnieje) + benefit Plus",
      en: "„Cite this analysis” box (exists) + Plus benefit",
    },
    target: { pl: "Plus (i Kadra Akademicka)", en: "Plus (and Academic Faculty)" },
  },
  {
    benefit: {
      pl: "Panel „Analiza Tygodnia” (mapy, wykresy)",
      en: "„Analysis of the Week” panel (maps, charts)",
    },
    origin: { pl: "Miesięczny", en: "Monthly" },
    platform: {
      pl: "Benefit Plus (do produkcji redakcyjnej)",
      en: "Plus benefit (pending editorial production)",
    },
    target: { pl: "Plus", en: "Plus" },
  },
  {
    benefit: { pl: "Cykl „Learning Path” (listy lektur)", en: "„Learning Path” (reading lists)" },
    origin: { pl: "Miesięczny", en: "Monthly" },
    platform: {
      pl: "Benefit Plus (do produkcji redakcyjnej)",
      en: "Plus benefit (pending editorial production)",
    },
    target: { pl: "Plus", en: "Plus" },
  },
  {
    benefit: {
      pl: "Pełne materiały audio-wideo (podcast, wywiady)",
      en: "Full audio-video (podcast, interviews)",
    },
    origin: { pl: "Miesięczny", en: "Monthly" },
    platform: {
      pl: "Podcast/wywiady na platformie + benefit Plus",
      en: "Podcast/interviews on the platform + Plus benefit",
    },
    target: { pl: "Plus (dopisane wprost)", en: "Plus (stated explicitly)" },
  },
];

const CONFLUENCE_URL = "https://neweuropeanstrategies.atlassian.net/wiki/spaces/NES/pages/52363266";

export function ConfluenceReconciliationCard({ lang }: { lang: "pl" | "en" }) {
  const { t } = useTranslation();
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BookMarked className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("adminMembership.confluence.title", {
            defaultValue: L(
              "Uzgodnienie z modelem Confluence (referencja)",
              "Reconciliation with the Confluence model (reference)",
            ),
          })}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {t("adminMembership.confluence.hint", {
            defaultValue: L(
              "Warstwa analityczna, widoczna tylko dla zespołu. Świadczenia z modelu subskrypcji w Confluence a stan na platformie i rekomendowany próg docelowy.",
              "An analytical layer, visible to staff only. Confluence subscription-model benefits vs the live platform and the recommended target tier.",
            ),
          })}
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{L("Świadczenie z Confluence", "Confluence benefit")}</TableHead>
                <TableHead>{L("Pierwotny próg", "Original tier")}</TableHead>
                <TableHead>{L("Odpowiednik na platformie", "Platform equivalent")}</TableHead>
                <TableHead>{L("Rekomendowany próg docelowy", "Recommended target tier")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROWS.map((row, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">
                    {lang === "pl" ? row.benefit.pl : row.benefit.en}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {lang === "pl" ? row.origin.pl : row.origin.en}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {lang === "pl" ? row.platform.pl : row.platform.en}
                  </TableCell>
                  <TableCell className="font-medium">
                    {lang === "pl" ? row.target.pl : row.target.en}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <a
          href={CONFLUENCE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          {L("Model subskrypcji (Confluence)", "Subscription model (Confluence)")}
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </CardContent>
    </Card>
  );
}

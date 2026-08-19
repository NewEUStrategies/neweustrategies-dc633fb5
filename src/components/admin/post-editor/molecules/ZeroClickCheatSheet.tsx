// Molekuła: ściągawka projektowania wpisu pod zero-click. Statyczna wiedza
// redakcyjna - szkielet wpisu, reguła po regule (rób / nie rób), ślad marki,
// podział na treść „pod cytowanie" i „pod klik" oraz miary sukcesu.
//
// Domyślnie zwinięta: to materiał do przeczytania raz i wracania do niego przy
// wątpliwości, a nie stały element, który ma zajmować górę panelu.
import { useTranslation } from "react-i18next";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { ZeroClickCheckId } from "@/lib/seo/zeroClick";
// Jak wyżej: ściągawka JEST tekstem, więc słownik musi wejść razem z nią.
import "@/lib/i18n-admin-zero-click";

/** Kolejność reguł = kolejność pracy redaktora, ta sama co w checkliście. */
const RULE_IDS: readonly ZeroClickCheckId[] = [
  "lead",
  "questionHeadings",
  "faq",
  "faqAnswerLength",
  "takeaways",
  "scannable",
];

function Bullets({ keys }: { keys: readonly string[] }) {
  const { t } = useTranslation();
  return (
    <ul className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
      {keys.map((key) => (
        <li key={key} className="flex gap-2">
          <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-brand" aria-hidden="true" />
          <span>{t(key)}</span>
        </li>
      ))}
    </ul>
  );
}

function Panel({ introKey, keys }: { introKey: string; keys: readonly string[] }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground leading-relaxed">{t(introKey)}</p>
      <Bullets keys={keys} />
    </div>
  );
}

export function ZeroClickCheatSheet() {
  const { t } = useTranslation();
  return (
    <Accordion type="multiple" className="w-full">
      <AccordionItem value="skeleton">
        <AccordionTrigger className="py-3 text-sm">
          {t("adminZeroClick.skeleton.title")}
        </AccordionTrigger>
        <AccordionContent>
          <Panel
            introKey="adminZeroClick.skeleton.intro"
            keys={[
              "adminZeroClick.skeleton.s1",
              "adminZeroClick.skeleton.s2",
              "adminZeroClick.skeleton.s3",
              "adminZeroClick.skeleton.s4",
              "adminZeroClick.skeleton.s5",
              "adminZeroClick.skeleton.s6",
              "adminZeroClick.skeleton.s7",
            ]}
          />
        </AccordionContent>
      </AccordionItem>

      {RULE_IDS.map((id) => (
        <AccordionItem key={id} value={`rule-${id}`}>
          <AccordionTrigger className="py-3 text-sm">
            {t(`adminZeroClick.rules.${id}.title`)}
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t(`adminZeroClick.rules.${id}.body`)}
              </p>
              <p className="text-xs leading-relaxed">
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">✓ </span>
                {t(`adminZeroClick.rules.${id}.do`)}
              </p>
              <p className="text-xs leading-relaxed">
                <span className="font-semibold text-amber-600 dark:text-amber-400">✕ </span>
                {t(`adminZeroClick.rules.${id}.dont`)}
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}

      <AccordionItem value="breadcrumbs">
        <AccordionTrigger className="py-3 text-sm">
          {t("adminZeroClick.breadcrumbs.title")}
        </AccordionTrigger>
        <AccordionContent>
          <Panel
            introKey="adminZeroClick.breadcrumbs.intro"
            keys={[
              "adminZeroClick.breadcrumbs.b1",
              "adminZeroClick.breadcrumbs.b2",
              "adminZeroClick.breadcrumbs.b3",
            ]}
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="balance">
        <AccordionTrigger className="py-3 text-sm">
          {t("adminZeroClick.balance.title")}
        </AccordionTrigger>
        <AccordionContent>
          <Panel
            introKey="adminZeroClick.balance.intro"
            keys={[
              "adminZeroClick.balance.b1",
              "adminZeroClick.balance.b2",
              "adminZeroClick.balance.b3",
            ]}
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="metrics" className="border-b-0">
        <AccordionTrigger className="py-3 text-sm">
          {t("adminZeroClick.metrics.title")}
        </AccordionTrigger>
        <AccordionContent>
          <Panel
            introKey="adminZeroClick.metrics.intro"
            keys={[
              "adminZeroClick.metrics.m1",
              "adminZeroClick.metrics.m2",
              "adminZeroClick.metrics.m3",
              "adminZeroClick.metrics.m4",
            ]}
          />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

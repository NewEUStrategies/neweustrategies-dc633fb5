// FAQ cennika: treść z bazy (pricing_faq_items, globalne + segmentowe),
// prezentacja i animacja DOKŁADNIE jak dotychczas (Radix Accordion,
// animate-accordion-up/down). Dodatkowo emituje schema.org FAQPage (JSON-LD)
// dla widocznych pytań - deterministycznie, więc bezpiecznie dla hydracji.
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { safeJsonLd } from "@/lib/seo/jsonld";
import type { PricingFaqItemRow } from "@/lib/pricing/queries";
import { faqAnswer, faqQuestion } from "@/lib/pricing/selectors";

export function PricingFaq({
  items,
  lang,
  title,
}: {
  items: PricingFaqItemRow[];
  lang: string;
  title: string;
}) {
  if (items.length === 0) return null;

  const jsonLd = safeJsonLd({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: faqQuestion(item, lang),
      acceptedAnswer: { "@type": "Answer", text: faqAnswer(item, lang) },
    })),
  });

  return (
    <section className="mx-auto mt-20 max-w-3xl">
      <h2 className="mb-6 text-center text-2xl font-bold tracking-tight">{title}</h2>
      <Accordion
        type="single"
        collapsible
        className="rounded-xl border border-border"
        defaultValue={`faq-${items[0].id}`}
      >
        {items.map((item) => (
          <AccordionItem key={item.id} value={`faq-${item.id}`} className="px-5 last:border-b-0">
            <AccordionTrigger className="text-base font-medium">
              {faqQuestion(item, lang)}
            </AccordionTrigger>
            <AccordionContent>{faqAnswer(item, lang)}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
    </section>
  );
}

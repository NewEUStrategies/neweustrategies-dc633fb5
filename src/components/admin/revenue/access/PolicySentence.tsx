// Molekuła: polityka dostępu w jednym zdaniu (SPEC §6.1 `PolicySentence`
// `{ facts: AccessPolicyFacts }`).
//
// Zdanie składa `describeAccessPolicy` (`lib/admin/revenue/policySentence.ts`)
// z części ze słownika zakładek - liczebniki odmienia i18next, komponent
// tylko tłumaczy i łączy. Bez własnej logiki: test zdania mierzy funkcję,
// test komponentu - że każda część trafia na ekran w obu językach.
import { useTranslation } from "react-i18next";

import { describeAccessPolicy, type AccessPolicyFacts } from "@/lib/admin/revenue/policySentence";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";

export interface PolicySentenceProps {
  facts: AccessPolicyFacts;
}

export function PolicySentence({ facts }: PolicySentenceProps) {
  ensureI18n();
  const { t } = useTranslation();
  const text = describeAccessPolicy(facts)
    .map((part) => t(part.key, part.params))
    .join(" ");
  return (
    <p data-testid="policy-sentence" className="m-0 text-sm leading-relaxed">
      {text}
    </p>
  );
}

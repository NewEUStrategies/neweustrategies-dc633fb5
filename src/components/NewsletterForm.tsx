import { useTranslation } from "react-i18next";

export function NewsletterForm() {
  const { t } = useTranslation();
  const inputCls =
    "w-full bg-transparent border-b border-white/20 py-4 text-white placeholder:text-white/50 focus:outline-none focus:border-brand transition";

  return (
    <section className="bg-[oklch(0.16_0.02_260)] text-white py-20">
      <div className="max-w-[1400px] mx-auto px-4 lg:px-8 grid lg:grid-cols-[1fr_2fr] gap-12">
        <div>
          <h2 className="font-display text-3xl lg:text-4xl font-bold leading-tight">
            {t("newsletter.title")}
          </h2>
          <p className="mt-4 text-white/70 max-w-sm">{t("newsletter.sub")}</p>
        </div>
        <form className="space-y-2" onSubmit={(e) => e.preventDefault()}>
          <div className="grid sm:grid-cols-2 gap-x-6">
            <input className={inputCls} placeholder={t("newsletter.name")} />
            <input className={inputCls} placeholder={t("newsletter.surname")} />
            <input className={inputCls} placeholder={t("newsletter.position")} />
            <input className={inputCls} placeholder={t("newsletter.company")} />
            <input className={inputCls} placeholder={t("newsletter.linkedin")} />
            <input className={inputCls} type="email" placeholder={t("newsletter.email")} />
            <input className={inputCls} placeholder={t("newsletter.phone")} />
            <select className={inputCls + " text-white/50"}>
              <option className="text-black">{t("newsletter.list")}</option>
            </select>
          </div>
          <div className="pt-6 flex flex-col sm:flex-row sm:items-center gap-4">
            <button className="bg-brand hover:bg-brand/90 text-brand-foreground font-bold px-8 py-3 rounded transition">
              {t("newsletter.subscribe")}
            </button>
            <label className="text-sm text-white/70 flex items-center gap-2">
              <input type="checkbox" className="accent-brand" />
              {t("newsletter.terms")} <span className="text-brand">{t("newsletter.termsLink")}</span>
            </label>
          </div>
        </form>
      </div>
    </section>
  );
}

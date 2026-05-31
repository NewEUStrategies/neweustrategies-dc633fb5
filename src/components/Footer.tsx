import { useTranslation } from "react-i18next";
import { useSiteSetting } from "@/lib/useSiteSetting";
import logo from "@/assets/logo.png";

type FooterColumn = {
  title_pl: string;
  title_en: string;
  links: { label_pl: string; label_en: string; url: string }[];
};

type FooterSettings = {
  mission_pl: string;
  mission_en: string;
  contact_email: string;
  contact_phone: string;
  contact_address: string;
  columns: FooterColumn[];
  copyright_pl: string;
  copyright_en: string;
};

export function Footer() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language ?? "pl";
  const isPl = lang.startsWith("pl");

  const cfg = useSiteSetting<FooterSettings>("footer", {
    mission_pl: "", mission_en: "",
    contact_email: "office@neweuropeanstrategies.com",
    contact_phone: "(+48) 784 880 318",
    contact_address: "Tytusa Chałubińskiego 8, 00-613, Warsaw",
    columns: [],
    copyright_pl: "Wszelkie prawa zastrzeżone",
    copyright_en: "All rights reserved",
  });

  const mission = (isPl ? cfg.mission_pl : cfg.mission_en) || t("footer.mission");
  const copyright = isPl ? cfg.copyright_pl : cfg.copyright_en;

  const defaultColumns: FooterColumn[] = [
    {
      title_pl: t("footer.knowUs"), title_en: t("footer.knowUs"),
      links: [
        { label_pl: t("footer.about"), label_en: t("footer.about"), url: "#" },
        { label_pl: t("footer.contact"), label_en: t("footer.contact"), url: "#" },
        { label_pl: t("footer.joinNewsletter"), label_en: t("footer.joinNewsletter"), url: "#" },
        { label_pl: t("footer.support"), label_en: t("footer.support"), url: "#" },
      ],
    },
    {
      title_pl: t("footer.workWithUs"), title_en: t("footer.workWithUs"),
      links: [
        { label_pl: t("footer.advertise"), label_en: t("footer.advertise"), url: "#" },
        { label_pl: t("footer.events"), label_en: t("footer.events"), url: "#" },
        { label_pl: t("footer.projects"), label_en: t("footer.projects"), url: "#" },
        { label_pl: t("footer.privacy"), label_en: t("footer.privacy"), url: "#" },
      ],
    },
  ];
  const columns = cfg.columns?.length ? cfg.columns : defaultColumns;

  return (
    <footer className="bg-[oklch(0.13_0.02_260)] text-white/80">
      <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-16 grid md:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr] gap-10">
        <div>
          <div className="flex items-center gap-3 mb-6">
            <img src={logo} alt="" className="w-12 h-12" width={48} height={48} />
            <div className="font-display leading-tight">
              <div className="font-bold text-white">New European</div>
              <div className="font-bold text-brand">Strategies</div>
            </div>
          </div>
          <p className="text-sm leading-relaxed mb-6">{mission}</p>
          <div className="text-sm space-y-1">
            {cfg.contact_email && <div><span className="text-white/50">{t("footer.contactLabel")}:</span><span> {cfg.contact_email}</span></div>}
            {cfg.contact_phone && <div><span className="text-white/50">{t("footer.phoneLabel")}:</span><span> {cfg.contact_phone}</span></div>}
            {cfg.contact_address && <div><span className="text-white/50">{t("footer.addressLabel")}:</span><span> {cfg.contact_address}</span></div>}
          </div>
        </div>
        {columns.slice(0, 2).map((col, i) => (
          <div key={i}>
            <h4 className="text-white font-display text-lg mb-4 border-b border-white/10 pb-2">
              {isPl ? col.title_pl : col.title_en}
            </h4>
            <ul className="space-y-3 text-sm font-semibold tracking-wide">
              {col.links.map((link, j) => (
                <li key={j} className="hover:text-brand">
                  <a href={link.url || "#"}>{isPl ? link.label_pl : link.label_en}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10 py-5 text-center text-xs text-white/50">
        © {new Date().getFullYear()} New European Strategies. {copyright}.
      </div>
    </footer>
  );
}

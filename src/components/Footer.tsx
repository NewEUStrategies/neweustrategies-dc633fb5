import { useTranslation } from "react-i18next";
import logo from "@/assets/logo.png";

export function Footer() {
  const { t } = useTranslation();
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
          <p className="text-sm leading-relaxed mb-2">{t("footer.mission")}</p>
          <p className="text-sm leading-relaxed mb-2">{t("footer.forum")}</p>
          <p className="text-sm leading-relaxed mb-6">{t("footer.vision")}</p>
          <div className="text-sm space-y-1">
            <div><span className="text-white/50">{t("footer.contactLabel")}:</span><span> office@neweuropeanstrategies.com</span></div>
            <div><span className="text-white/50">{t("footer.phoneLabel")}:</span><span> (+48) 784 880 318</span></div>
            <div><span className="text-white/50">{t("footer.addressLabel")}:</span><span> Tytusa Chałubińskiego 8, 00-613, Warsaw</span></div>
          </div>
        </div>
        <div>
          <h4 className="text-white font-display text-lg mb-4 border-b border-white/10 pb-2">{t("footer.knowUs")}</h4>
          <ul className="space-y-3 text-sm font-semibold tracking-wide">
            <li className="hover:text-brand cursor-pointer">{t("footer.about")}</li>
            <li className="hover:text-brand cursor-pointer">{t("footer.contact")}</li>
            <li className="hover:text-brand cursor-pointer">{t("footer.joinNewsletter")}</li>
            <li className="hover:text-brand cursor-pointer">{t("footer.support")}</li>
          </ul>
        </div>
        <div>
          <h4 className="text-white font-display text-lg mb-4 border-b border-white/10 pb-2">{t("footer.workWithUs")}</h4>
          <ul className="space-y-3 text-sm font-semibold tracking-wide">
            <li className="hover:text-brand cursor-pointer">{t("footer.advertise")}</li>
            <li className="hover:text-brand cursor-pointer">{t("footer.events")}</li>
            <li className="hover:text-brand cursor-pointer">{t("footer.projects")}</li>
            <li className="hover:text-brand cursor-pointer">{t("footer.privacy")}</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 py-5 text-center text-xs text-white/50">
        © {new Date().getFullYear()} New European Strategies. {t("footer.rights")}.
      </div>
    </footer>
  );
}

import Link from "next/link";
import { useExtracted } from "next-intl";
import { SiGithub } from "@icons-pack/react-simple-icons";
import { Star } from "lucide-react";
import { Button } from "../../components/ui/button";
import { RybbitTextLogo } from "../../components/RybbitLogo";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";

interface FooterProps {
  disabled?: boolean;
}

// Rybbit's footer layout, adapted for MetriBee. See frontend/third-party/NOTICE.md.
export function Footer({ disabled = false }: FooterProps) {
  const t = useExtracted();
  if (disabled) return null;

  const project = "https://github.com/nexmoe/MetriBee";
  const website = "https://metribee.com";
  const linkClass =
    "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-950 dark:focus-visible:ring-neutral-300";
  const groups = [
    {
      title: t("Website"),
      links: [
        { label: t("Official website"), href: `${website}/` },
        { label: t("Features"), href: `${website}/#features` },
        { label: t("Compare"), href: `${website}/#compare` },
        { label: t("FAQ"), href: `${website}/#faq` },
        { label: t("Changelog"), href: `${website}/changelog/` },
        { label: t("Press Kit"), href: `${website}/press-kit/` },
      ],
    },
    {
      title: t("Project"),
      links: [
        { label: "GitHub", href: project },
        { label: t("Releases"), href: `${project}/releases` },
        { label: t("Report an issue"), href: `${project}/issues` },
        { label: t("License"), href: `${project}/blob/main/LICENSE` },
      ],
    },
  ];

  return (
    <footer className="w-full shrink-0 border-t border-neutral-200 dark:border-neutral-850 bg-neutral-50 dark:bg-neutral-900">
      <div className="max-w-[1100px] mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-8">
          <div className="space-y-4">
            <Link
              href={`${website}/`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("Official website")}
              className="inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-950 dark:focus-visible:ring-neutral-300"
            >
              <RybbitTextLogo width={140} height={28} />
            </Link>
            <div className="space-y-3">
              <div className="text-sm text-neutral-600 dark:text-neutral-200">
                {t("Liking MetriBee? Star the project on GitHub!")}
              </div>
              <a href={project} target="_blank" rel="noopener noreferrer">
                <Button>
                  <Star className="w-5 h-5" />
                  {t("Star on GitHub")}
                </Button>
              </a>
            </div>
            <div className="flex gap-4">
              <a
                href={project}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="MetriBee GitHub"
                className={linkClass}
              >
                <SiGithub className="w-5 h-5" />
              </a>
            </div>
          </div>
          {groups.map((group) => (
            <div key={group.title} className="space-y-4">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
                {group.title}
              </h3>
              <ul className="space-y-2 text-sm">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={linkClass}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="pt-8 border-t border-neutral-200 dark:border-neutral-800">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4 text-sm text-neutral-500 dark:text-neutral-400">
              <span>© {new Date().getFullYear()} MetriBee</span>
              <a
                href={`${project}/releases/tag/v${process.env.NEXT_PUBLIC_APP_VERSION}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-neutral-700 dark:hover:text-neutral-300"
              >
                v{process.env.NEXT_PUBLIC_APP_VERSION}
              </a>
            </div>
            <div className="flex items-center gap-4">
              <LanguageSwitcher />
              <span className="text-sm text-neutral-500 dark:text-neutral-400">
                {t("Made with ❤️ by")}{" "}
                <a
                  href="https://nexmoe.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClass}
                >
                  Nexmoe 🐝
                </a>
              </span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

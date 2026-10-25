"use client";

import { switchLocale, locales } from "../../../adapter/navigation";

import { useLocale, useExtracted } from "next-intl";
import { CountryFlag } from "../app/[site]/components/shared/icons/CountryFlag";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

const LOCALE_OPTIONS = [
  { value: "en", label: "English", country: "US" },
  { value: "de", label: "Deutsch", country: "DE" },
  { value: "fr", label: "Français", country: "FR" },
  { value: "zh", label: "简体中文", country: "CN" },
  { value: "es", label: "Español", country: "ES" },
  { value: "pl", label: "Polski", country: "PL" },
  { value: "it", label: "Italiano", country: "IT" },
  { value: "ko", label: "한국어", country: "KR" },
  { value: "pt", label: "Português", country: "BR" },
  { value: "ja", label: "日本語", country: "JP" },
  { value: "cs", label: "Čeština", country: "CZ" },
  { value: "uk", label: "Українська", country: "UA" },
] as const;

export function LanguageSwitcher() {
  const t = useExtracted();
  const currentLocale = useLocale();

  const options = LOCALE_OPTIONS.filter((option) =>
    locales.includes(option.value)
  );
  if (options.length < 2) return null;

  function handleLocaleChange(locale: string) {
    switchLocale(locale);
  }

  return (
    <Select value={currentLocale} onValueChange={handleLocaleChange}>
      <SelectTrigger
        aria-label={t("Language")}
        className="w-auto text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <span className="flex items-center gap-2">
              <CountryFlag country={option.country} className="w-4" />
              {option.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

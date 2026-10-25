import { useExtracted } from "next-intl";
import { useEffect } from "react";

export const useSetPageTitle = (title: string) => {
  const t = useExtracted();
  const translated = t(title);
  useEffect(() => {
    if (title) document.title = `${translated} · MetriBee`;
  }, [title, translated]);
};

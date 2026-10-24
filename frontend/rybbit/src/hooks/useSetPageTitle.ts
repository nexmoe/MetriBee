import { useEffect } from "react";

export const useSetPageTitle = (title: string) => {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
};

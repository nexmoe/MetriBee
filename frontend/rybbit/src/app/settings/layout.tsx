"use client";

import { StandardPage } from "../../components/StandardPage";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <StandardPage>
      <div className="flex-1 overflow-auto mt-4">{children}</div>
    </StandardPage>
  );
}

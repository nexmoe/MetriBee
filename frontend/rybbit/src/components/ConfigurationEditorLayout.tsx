"use client";

import type { ReactNode } from "react";
import { DialogTitle } from "./ui/dialog";

// Extracted from Rybbit's FunnelForm so funnel and widget editors share the same shell.
export function ConfigurationEditorLayout({
  title,
  actions,
  builder,
  previewTitle,
  previewActions,
  preview,
}: {
  title: ReactNode;
  actions: ReactNode;
  builder: ReactNode;
  previewTitle: ReactNode;
  previewActions?: ReactNode;
  preview: ReactNode;
}) {
  return (
    <>
      <div className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-neutral-150 px-4 dark:border-neutral-850 md:px-6">
        <DialogTitle className="min-w-0 truncate text-base font-semibold tracking-tight">
          {title}
        </DialogTitle>
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto lg:grid lg:grid-cols-[440px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[500px_minmax(0,1fr)]">
        <div className="border-b border-neutral-150 dark:border-neutral-850 lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="space-y-5 p-4 md:p-5">{builder}</div>
        </div>
        <div className="flex min-h-[320px] flex-col lg:min-h-0 lg:overflow-y-auto">
          <div className="sticky top-0 z-10 flex h-12 shrink-0 items-center justify-between border-b border-neutral-150 bg-background px-4 dark:border-neutral-850 md:px-6">
            <span className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
              {previewTitle}
            </span>
            {previewActions}
          </div>
          <div className="flex flex-1 flex-col px-4 pb-4 md:px-6">
            {preview}
          </div>
        </div>
      </div>
    </>
  );
}

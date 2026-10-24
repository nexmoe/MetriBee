"use client";
import { Button } from "@/components/ui/button";
import { canGoBack, canGoForward, goBack, goForward, useStore } from "@/lib/store";
import { FilterParameter } from "@rybbit/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Filters } from "./Filters/Filters";

import { DateSelector } from "../../../../components/DateSelector/DateSelector";
import { MobileSidebar } from "../Sidebar/MobileSidebar";
import { NewFilterButton } from "./Filters/NewFilterButton";
import { LiveUserCount } from "../../../../../../adapter/realtime/LiveUserCount";
import { ShareExportButton } from "./ShareExportButton";
import { ReportFreshness } from "../../../../../../adapter/overview/ReportFreshness";
import { usePathname } from "next/navigation";

export function SubHeader({ availableFilters }: { availableFilters?: FilterParameter[] }) {
  const { time, setTime, site } = useStore();
  const pathname = usePathname();
  const calendarOnly = pathname.endsWith("/retention") || pathname.endsWith("/funnels");

  return (
    <div>
      <div className="flex gap-2 justify-between">
        <div className="flex items-center gap-2">
          <MobileSidebar />
          <div className="hidden items-center gap-2 md:flex">
            <NewFilterButton availableFilters={availableFilters} />
            <ReportFreshness site={site} className="shrink-0" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LiveUserCount />
          <ShareExportButton />
          <DateSelector time={time} setTime={setTime} pastMinutesEnabled={!calendarOnly} />
          <div className="flex items-center">
            <Button
              variant="secondary"
              size="icon"
              onClick={goBack}
              disabled={!canGoBack(time)}
              className="rounded-r-none h-8 w-8"
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              onClick={goForward}
              disabled={!canGoForward(time)}
              className="rounded-l-none -ml-px h-8 w-8"
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      </div>
      <div>
        <div className="mt-3 flex items-center gap-2 md:hidden">
          <NewFilterButton availableFilters={availableFilters} />
          <ReportFreshness site={site} className="shrink-0" />
        </div>
        <div className="mt-2">
          <Filters availableFilters={availableFilters} />
        </div>
      </div>
    </div>
  );
}

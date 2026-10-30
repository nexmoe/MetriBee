"use client";

import { Button } from "../../../components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "../../../components/ui/sheet";

import { Menu } from "lucide-react";
import { useExtracted } from "next-intl";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { AppSidebar } from "../../../components/AppSidebar";
import { NavigationSidebar } from "../../../components/sidebar/NavigationSidebar";

export function MobileSidebar() {
  const t = useExtracted();
  return (
    <div className="md:hidden flex items-center gap-2">
      <Sheet>
        <SheetTrigger asChild>
          <Button size="icon" variant="outline">
            <Menu />
          </Button>
        </SheetTrigger>
        <VisuallyHidden>
          <SheetHeader>
            <SheetTitle>{t("MetriBee Sidebar")}</SheetTitle>
          </SheetHeader>
        </VisuallyHidden>
        <SheetContent side="left" className="p-0 w-[240px] flex gap-0" showClose={false}>
          <AppSidebar />
          <NavigationSidebar />
        </SheetContent>
      </Sheet>
    </div>
  );
}

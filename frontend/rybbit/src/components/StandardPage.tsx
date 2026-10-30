import { Footer } from "../app/components/Footer";
import { AppSidebar } from "./AppSidebar";
import { cn } from "../lib/utils";

export function StandardPage({
  children,
  showSidebar = true,
  fullWidth = false,
  showFooter = true,
}: {
  children: React.ReactNode;
  showSidebar?: boolean;
  fullWidth?: boolean;
  showFooter?: boolean;
}) {
  if (!showFooter) return (
    <div className="h-full flex w-full">
      {showSidebar && <AppSidebar />}
      <main className="flex flex-col items-center p-4 w-full h-dvh overflow-y-auto">
        <div className={cn("w-full", fullWidth ? "max-w-full" : "max-w-6xl")}>{children}</div>
      </main>
    </div>
  );
  return (
    <div className="h-full flex w-full">
      {showSidebar && <AppSidebar />}
      <main className="relative flex flex-col items-center w-full h-dvh overflow-y-auto">
        <div className={cn("w-full flex-1 p-4", fullWidth ? "max-w-full" : "max-w-6xl")}>{children}</div>
        <Footer />
      </main>
    </div>
  );
}

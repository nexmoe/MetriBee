import { Footer } from "../app/components/Footer";
import { AppSidebar } from "./AppSidebar";
import { cn } from "../lib/utils";

export function StandardPage({
  children,
  showSidebar = true,
  fullWidth = false,
}: {
  children: React.ReactNode;
  showSidebar?: boolean;
  fullWidth?: boolean;
}) {
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

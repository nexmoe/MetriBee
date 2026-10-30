"use client";
// MetriBee workspace destinations with Rybbit's shared account avatar/menu.
import { useExtracted } from "../adapter/extracted";
import {
  Home,
  Activity,
  Globe,
  Gauge,
  Plug,
  Shield,
  LogOut,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppSidebar as AccountSidebar, UserMenu } from '../rybbit/src/components/AccountSidebar';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../rybbit/src/components/ui/tooltip";
import { cn } from "../rybbit/src/lib/utils";
import { PrivacyToggle } from "../adapter/privacy/Privacy";
import { authClient } from "../rybbit/src/lib/auth";
import { Button } from "../rybbit/src/components/ui/button";
import { actualHref } from "../adapter/navigation";

export function AppSidebar() {
  const t = useExtracted();
  const pathname = usePathname();
  const { data: session } = authClient.useSession();
  if (pathname.startsWith('/settings') || pathname.startsWith('/admin')) return <AccountSidebar />;
  return (
    <div className="flex flex-col items-center justify-between h-dvh w-[45px] shrink-0 p-2 py-3 bg-neutral-50 dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-850 gap-3">
      <div className="flex flex-col items-center gap-2">
        <Link
          href="/"
          aria-label={t("MetriBee home")}
          className="mb-2 mt-1 text-neutral-950 dark:text-neutral-50"
        >
          <img
            src="/metribee/mark.svg"
            alt=""
            width={32}
            height={25}
            className="dark:invert"
          />
        </Link>
        {(
          [
            ["/", "Home", Home],
            ["/realtime", "Realtime overview", Activity],
            ["/globe", "Globe", Globe],
            ["/quota", "API quota", Gauge],
            ["/setup", "GA4 connection", Plug],
          ] as const
        )
          .filter(
            ([href]) => href !== "/setup" || session?.user.role === "admin"
          )
          .map(([href, label, Icon]) => {
            const active =
              pathname === href ||
              (href === "/globe" && pathname.endsWith("/globe"));
            return (
              <Tooltip key={href}>
                <TooltipTrigger asChild>
                  <Link
                    href={href}
                    aria-label={t(label)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "p-1 rounded-md transition-colors flex items-center justify-center",
                      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-950 dark:focus-visible:ring-neutral-300",
                      active
                        ? "bg-neutral-150 text-neutral-900 dark:bg-neutral-800 dark:text-white"
                        : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-150 dark:hover:bg-neutral-800/80"
                    )}
                  >
                    <Icon className="w-5 h-5" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{t(label)}</TooltipContent>
              </Tooltip>
            );
          })}
      </div>
      <div className="flex flex-col items-center gap-2">
        {session?.user.role === "admin" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/admin"
                aria-label={t("Admin")}
                className="p-1 text-neutral-500"
              >
                <Shield className="size-5" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{t("Admin")}</TooltipContent>
          </Tooltip>
        )}
        {session?.session.impersonatedBy && (
          <Button
            size="icon"
            variant="ghost"
            onClick={async () => {
              await authClient.admin.stopImpersonating();
              location.assign(actualHref("/admin"));
            }}
            aria-label={t("Stop impersonating")}
          >
            <LogOut className="size-4" />
          </Button>
        )}
        <PrivacyToggle />
        {session?.user && (
          <UserMenu
            name={session.user.name}
            email={session.user.email}
            image={session.user.image}
          />
        )}
      </div>
    </div>
  );
}

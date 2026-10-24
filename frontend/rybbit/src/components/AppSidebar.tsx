"use client";
// Original Rybbit rail, logo, tooltip and icon treatment; GA4 workspace destinations.
import { Home, Activity, Globe, Gauge, Plug, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { RybbitLogo } from './RybbitLogo';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { cn } from '../lib/utils';
import { PrivacyToggle } from '../../../adapter/privacy/Privacy';
export function AppSidebar() {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  return <div className="flex flex-col items-center justify-between h-dvh w-[45px] shrink-0 p-2 py-3 bg-neutral-50 dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-850 gap-3">
    <div className="flex flex-col items-center gap-2"><Link href="/" aria-label="Home" className="mb-2 mt-1"><RybbitLogo width={24} height={18}/></Link>
      {([['/', 'Home', Home], ['/realtime', 'Realtime overview', Activity], ['/globe', 'Globe', Globe], ['/quota', 'API quota', Gauge], ['/setup', 'GA4 connection', Plug]] as const).map(([href,label,Icon]) => {
        const active = pathname === href || (href === '/globe' && pathname.endsWith('/globe'));
        return <Tooltip key={href}><TooltipTrigger asChild><Link href={href} aria-label={label} aria-current={active ? 'page' : undefined} className={cn('p-1 rounded-md transition-colors flex items-center justify-center','focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-950 dark:focus-visible:ring-neutral-300',active ? 'bg-neutral-150 text-neutral-900 dark:bg-neutral-800 dark:text-white' : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-150 dark:hover:bg-neutral-800/80')}><Icon className="w-5 h-5"/></Link></TooltipTrigger><TooltipContent side="right">{label}</TooltipContent></Tooltip>;
      })}
    </div>
    <div className="flex flex-col items-center gap-2">
      <PrivacyToggle />
      <Tooltip><TooltipTrigger asChild><button type="button" aria-label="Toggle theme" className="p-1 rounded-md text-neutral-600 dark:text-neutral-400 hover:bg-neutral-150 dark:hover:bg-neutral-800" onClick={()=>setTheme(resolvedTheme==='dark'?'light':'dark')}>{resolvedTheme==='dark'?<Moon className="w-5 h-5"/>:<Sun className="w-5 h-5"/>}</button></TooltipTrigger><TooltipContent side="right">Theme</TooltipContent></Tooltip>
    </div>
  </div>;
}

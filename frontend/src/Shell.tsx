import { useEffect, useState, type ReactNode } from 'react';
import { Activity, ArrowDownToLine, BarChart3, BookOpen, CalendarDays, ChartColumnDecreasing, Check, ChevronDown, Code2, File, Globe2, LayoutDashboard, Menu, Moon, MousePointerClick, RefreshCw, Search, Settings, Split, Sun, AppWindow } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { context, useWorkspace, api } from '@/lib/api';
import Link, { navigate, updateParams, useLocation } from '@/lib/router';
import { cn, number } from '@/lib/utils';

const NAV = [
  { path: '/analytics', name: 'Main', icon: LayoutDashboard, section: '' },
  { path: '/analytics/pages', name: 'Pages', icon: File, section: 'Traffic' },
  { path: '/globe', name: 'Globe', icon: Globe2, section: '' },
  { path: '/events', name: 'Events', icon: MousePointerClick, section: 'Behavior' },
  { path: '/journeys', name: 'Journeys', icon: Split, section: 'Conversion' },
  { path: '/retention', name: 'Retention', icon: ChartColumnDecreasing, section: '' },
];
const RANGE_NAMES: Record<string, string> = { today: 'Today', '7d': 'Last 7 days', '28d': 'Last 28 days', '30d': 'Last 30 days', '90d': 'Last 90 days' };
export function Shell({ children }: { children: ReactNode }) {
  useLocation();
  const { property, propertyId, range } = useWorkspace();
  const client = useQueryClient();
  const [mobile, setMobile] = useState(false), [palette, setPalette] = useState(false), [query, setQuery] = useState('');
  const [theme, setTheme] = useState(() => document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  const title = NAV.find(item => item.path === location.pathname)?.name || 'Analytics';
  const supported = location.pathname === '/journeys' ? ['today', '7d', '28d', '30d'] : location.pathname === '/retention' ? ['7d', '30d', '90d'] : Object.keys(RANGE_NAMES);
  const effectiveRange = supported.includes(range) ? range : '30d';
  const live = useQuery({ queryKey: ['live'], queryFn: ({ signal }) => api<{ data: { propertyId: string; activeUsers: number }[] }>('/api/realtime-all', signal), staleTime: 60000, refetchInterval: 60000, retry: false });
  const liveCount = live.data?.data.find(p => String(p.propertyId) === propertyId)?.activeUsers;
  const link = (path: string) => `${path}?${new URLSearchParams({ prop: propertyId, range: effectiveRange })}`;
  useEffect(() => { document.title = `${title} · ${property?.site || 'GA4 Dashboard'}`; }, [title, property?.site]);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark'); document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('pb_theme', theme); } catch { /* Storage can be disabled. */ }
  }, [theme]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPalette(v => !v); } };
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  }, []);
  const sidebar = <Sidebar.Root>
    <div className="border-b border-neutral-150 p-3 dark:border-neutral-800">
      <Select value={propertyId} onValueChange={value => { navigate(`${location.pathname}?${new URLSearchParams({ prop: value, range: effectiveRange })}`); setMobile(false); }}>
        <SelectTrigger aria-label="Select property" className="h-9 w-full bg-transparent px-2 text-sm"><div className="flex min-w-0 items-center gap-2"><img src={`/api/favicon/${propertyId}`} alt="" className="h-4 w-4 rounded-sm"/><span className="truncate">{property?.domain || property?.site || 'Select property'}</span></div></SelectTrigger>
        <SelectContent>{context.properties.map(p => <SelectItem key={p.id} value={String(p.id)}><span title={p.site}>{p.domain || p.site}</span></SelectItem>)}</SelectContent>
      </Select>
      <button className="mt-2 hidden w-full items-center justify-between rounded border border-neutral-150 px-2 py-1.5 text-xs text-neutral-500 md:flex dark:border-neutral-800" onClick={() => setPalette(true)}><span className="flex items-center gap-2"><Search className="h-3 w-3"/>Jump to…</span><span className="text-[10px]">⌘K</span></button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-1">
      {NAV.map(({ path, name, icon: Icon, section }, i) => <div key={path}>{section && <Sidebar.SectionHeader>{section}</Sidebar.SectionHeader>}<div className={cn(i === 0 && 'mt-2')} onClick={() => setMobile(false)}><Sidebar.Item label={name} href={link(path)} icon={<Icon className="h-4 w-4"/>} active={location.pathname === path}/></div></div>)}
    </div>
    <div className="border-t border-neutral-150 p-3 dark:border-neutral-800"><Sidebar.Item label="All properties" href="/" icon={<AppWindow className="h-4 w-4"/>}/><Sidebar.Item label="Connection settings" href="/setup" icon={<Settings className="h-4 w-4"/>}/><p className="px-3 pt-3 text-[11px] text-neutral-500">Google Analytics 4{context.demo && <span className="ml-2">· Demo data</span>}</p></div>
  </Sidebar.Root>;
  return <div className="min-h-dvh bg-background text-foreground">
    <aside className="fixed inset-y-0 left-0 z-40 flex w-12 flex-col items-center border-r border-neutral-150 bg-neutral-50 py-3 dark:border-neutral-850 dark:bg-neutral-900" aria-label="Application">
      <a href="/" aria-label="GA4 Dashboard home" className="mb-5 text-neutral-950 dark:text-white"><BarChart3 className="h-6 w-6"/></a>
      <Tooltip><TooltipTrigger asChild><a href="/sites" aria-label="All properties" className="rounded p-2 text-neutral-500 hover:bg-neutral-150 dark:hover:bg-neutral-800"><AppWindow className="h-4 w-4"/></a></TooltipTrigger><TooltipContent side="right">All properties</TooltipContent></Tooltip>
      <Tooltip><TooltipTrigger asChild><a href="/setup" aria-label="Setup" className="rounded p-2 text-neutral-500 hover:bg-neutral-150 dark:hover:bg-neutral-800"><BookOpen className="h-4 w-4"/></a></TooltipTrigger><TooltipContent side="right">Connection & setup</TooltipContent></Tooltip>
      <div className="mt-auto"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="smIcon" aria-label="Appearance and settings"><Settings className="h-4 w-4"/></Button></DropdownMenuTrigger><DropdownMenuContent side="right" align="end"><DropdownMenuItem onSelect={() => setTheme('light')}><Sun className="mr-2 h-4 w-4"/>Light theme{theme === 'light' && <Check className="ml-auto h-3 w-3"/>}</DropdownMenuItem><DropdownMenuItem onSelect={() => setTheme('dark')}><Moon className="mr-2 h-4 w-4"/>Dark theme{theme === 'dark' && <Check className="ml-auto h-3 w-3"/>}</DropdownMenuItem><DropdownMenuSeparator/><DropdownMenuItem asChild><a href="https://github.com/nexmoe/MetriBee"><Code2 className="mr-2 h-4 w-4"/>UI source & licenses</a></DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
    </aside>
    <aside className="fixed inset-y-0 left-12 z-30 hidden md:flex [&>div]:h-full" aria-label="Analytics navigation">{sidebar}</aside>
    <div className="ml-12 min-w-0 md:ml-[272px]">
      <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2"><Button className="md:hidden" size="smIcon" variant="ghost" aria-label="Open navigation" onClick={() => setMobile(true)}><Menu className="h-4 w-4"/></Button><h1 className="text-sm font-medium">{title}</h1>{context.demo && <span className="rounded border border-neutral-150 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:border-neutral-800">Demo data</span>}</div>
        <div className="flex items-center gap-2">
          <span className="mr-1 flex items-center gap-1.5 text-xs tabular-nums" title="Active users in the last 30 minutes"><i className="h-2.5 w-2.5 rounded-full bg-emerald-500"/>{number(liveCount)}</span>
          <Button size="smIcon" variant="outline" aria-label="Export current report" title="Export CSV" onClick={() => window.dispatchEvent(new Event('ga4:export'))}><ArrowDownToLine className="h-4 w-4"/></Button>
          <Select value={effectiveRange} onValueChange={value => updateParams({ range: value, start: null, end: null, offset: null })}><SelectTrigger aria-label="Date range" className="h-8 w-auto min-w-32 gap-2 bg-white text-xs dark:bg-neutral-900"><CalendarDays className="h-3.5 w-3.5"/><SelectValue/></SelectTrigger><SelectContent>{supported.map(value => <SelectItem key={value} value={value}>{RANGE_NAMES[value]}</SelectItem>)}</SelectContent></Select>
          <Button size="smIcon" variant="outline" aria-label="Refresh reports" title="Refresh reports" onClick={() => { client.invalidateQueries({ queryKey: ['report'] }); }}><RefreshCw className="h-3.5 w-3.5"/></Button>
        </div>
      </header>
      <main id="workspace-content" className="space-y-3 px-4 pb-12">{children}</main>
    </div>
    <Dialog open={mobile} onOpenChange={setMobile}><DialogContent className="fixed inset-y-0 left-12 right-auto top-0 m-0 h-dvh w-64 translate-x-0 translate-y-0 rounded-none border-0 p-0 [&>div:nth-child(2)]:w-full"><DialogHeader className="sr-only"><DialogTitle>Analytics navigation</DialogTitle><DialogDescription>Choose a property and report.</DialogDescription></DialogHeader>{sidebar}</DialogContent></Dialog>
    <Dialog open={palette} onOpenChange={setPalette}><DialogContent className="gap-0 p-0 sm:max-w-lg"><DialogHeader className="sr-only"><DialogTitle>Jump to a page or property</DialogTitle><DialogDescription>Search all reports and connected GA4 properties.</DialogDescription></DialogHeader><div className="border-b border-neutral-150 p-3 dark:border-neutral-800"><Input autoFocus placeholder="Search pages and properties…" aria-label="Search pages and properties" value={query} onChange={e => setQuery(e.target.value)}/></div><div className="max-h-96 overflow-y-auto p-2">{NAV.filter(item => item.name.toLowerCase().includes(query.toLowerCase())).map(item => <button key={item.path} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={() => { navigate(link(item.path)); setPalette(false); }}><item.icon className="h-4 w-4"/>{item.name}</button>)}{context.properties.filter(p => (p.site + ' ' + p.domain).toLowerCase().includes(query.toLowerCase())).map(p => <button key={p.id} className="flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={() => { navigate(`${location.pathname}?prop=${p.id}&range=${effectiveRange}`); setPalette(false); }}><span>{p.site}</span><span className="text-xs text-neutral-500">{p.domain}</span></button>)}</div></DialogContent></Dialog>
  </div>;
}

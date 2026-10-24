import { Component, Suspense, lazy, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Shell } from './Shell';
import { useLocation } from '@/lib/router';
import { context } from '@/lib/api';
import { Empty, LoadingReport } from '@/components/Report';
const OverviewPage = lazy(() => import('./pages/Overview').then(module => ({ default: module.OverviewPage })));
const PagesPage = lazy(() => import('./pages/Pages').then(module => ({ default: module.PagesPage })));
const EventsPage = lazy(() => import('./pages/Events').then(module => ({ default: module.EventsPage })));
const JourneysPage = lazy(() => import('./pages/Journeys').then(module => ({ default: module.JourneysPage })));
const RetentionPage = lazy(() => import('./pages/Retention').then(module => ({ default: module.RetentionPage })));
import './app/globals.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } } });
class Boundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() { return this.state.error ? <div className="p-10"><h1 className="text-lg font-medium">This report could not be displayed</h1><button className="mt-4 underline" onClick={() => location.reload()}>Reload the page</button></div> : this.props.children; }
}
function App() {
  const locationKey = useLocation();
  const path = locationKey.split('?')[0].split('#')[0];
  const Screen = ({ '/analytics': OverviewPage, '/analytics/pages': PagesPage, '/events': EventsPage, '/journeys': JourneysPage, '/retention': RetentionPage } as const)[path as '/analytics'] || OverviewPage;
  return <Shell>{context.properties.length ? <Suspense fallback={<LoadingReport rows={12}/>}><Screen key={path}/></Suspense> : <Empty title="No GA4 properties connected"><a href="/setup" className="underline">Open connection settings</a></Empty>}</Shell>;
}
createRoot(document.getElementById('root')!).render(<Boundary><QueryClientProvider client={queryClient}><MotionConfig reducedMotion="user"><TooltipProvider delayDuration={200}><App/></TooltipProvider></MotionConfig></QueryClientProvider></Boundary>);

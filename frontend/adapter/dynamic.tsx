import { lazy, Suspense, type ComponentType } from 'react';
export default function dynamic<T extends object>(loader: () => Promise<{ default: ComponentType<T> } | ComponentType<T>>, options?: { loading?: ComponentType; ssr?: boolean }) {
  const Component = lazy(async () => { const module = await loader(); return { default: 'default' in module ? module.default : module }; });
  return function Dynamic(props: T) { return <Suspense fallback={options?.loading ? <options.loading/> : null}><Component {...props}/></Suspense>; };
}

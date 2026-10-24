import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: '/ui/',
  plugins: [{ name: 'rybbit-message-runtime', enforce: 'pre', transform(code, id) {
    if (!id.includes('/rybbit/src/') || !code.includes('useExtracted')) return;
    const rewritten = code.replace(/import\s*\{([^}]*\buseExtracted\b[^}]*)\}\s*from\s*["']next-intl["'];?/g, (_, names: string) => {
      const remaining = names.split(',').map(name => name.trim()).filter(name => name !== 'useExtracted').join(', ');
      return `import { useExtracted } from ${JSON.stringify(fileURLToPath(new URL('./adapter/extracted.ts', import.meta.url)))};${remaining ? `\nimport { ${remaining} } from 'next-intl';` : ''}`;
    });
    return { code: rewritten, map: null };
  } }, tailwindcss()],
  define: { 'process.env.NEXT_PUBLIC_APP_VERSION': '"2.9.1"', 'process.env.NEXT_PUBLIC_BACKEND_URL': '""', 'process.env.NEXT_PUBLIC_CLOUD': '"false"', 'process.env.NEXT_PUBLIC_DEPLOYMENT': '""', 'process.env.NEXT_PUBLIC_LITE_DASHBOARD': '"false"' },
  resolve: { alias: {
    'next/font/google': fileURLToPath(new URL('./adapter/font.ts', import.meta.url)),
    '@rybbit/shared/dist/filters': fileURLToPath(new URL('./rybbit/shared/filters.ts', import.meta.url)),
    'next/navigation': fileURLToPath(new URL('./adapter/navigation.tsx', import.meta.url)),
    'next/link': fileURLToPath(new URL('./adapter/link.tsx', import.meta.url)),
    'next/image': fileURLToPath(new URL('./adapter/image.tsx', import.meta.url)),
    'next/dynamic': fileURLToPath(new URL('./adapter/dynamic.tsx', import.meta.url)),
    '@rybbit/shared': fileURLToPath(new URL('./rybbit/shared/index.ts', import.meta.url)),
    '@': fileURLToPath(new URL('./rybbit/src', import.meta.url))
  } },
  build: { outDir: '../public/ui', emptyOutDir: true, manifest: true, sourcemap: false,
    commonjsOptions: { include: [/node_modules/, /lib\/homeViews\.js$/, /public\/js\/homeAccounts\.js$/] },
    rollupOptions: { onwarn(warning, defaultHandler) { if (warning.code === "MODULE_LEVEL_DIRECTIVE" && warning.message.includes("use client")) return; defaultHandler(warning); } } },
});


import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Pre-transform the hottest modules on dev-server startup instead of
    // lazily on first navigation. The frontend restructure (feature-based
    // layout + per-entity services/hooks/utils) split what used to be a
    // handful of files into many smaller ones — great for production
    // bundling/code-splitting, but it means Vite's on-demand dev-server
    // transform now has more individual ES module requests to serve the
    // first time a route like Application Detail is opened after a
    // restart. Warming these up removes that first-navigation delay; it
    // has no effect on `vite build` (which already bundles everything).
    warmup: {
      clientFiles: [
        './src/features/applications/ApplicationDetailPage.jsx',
        './src/features/applications/tabs/*.jsx',
        './src/features/applications/shared.jsx',
        './src/features/cps/*.jsx',
        './src/features/ping-test/*.jsx',
        './src/services/*.js',
        './src/hooks/*.js',
        './src/utils/*.js',
        './src/components/ui/*.jsx',
        './src/components/shared/*.jsx',
        './src/context/*.jsx',
      ],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        // Extend proxy timeout to handle long-running ping tests
        // (worst case: 12 paths × 30s each = 6 min; plus client 95s safety cutoff)
        proxyTimeout: 120000,   // 2 minutes — covers 95s client timeout + backend overhead
        timeout: 120000,
      }
    }
  },
  build: {
    sourcemap: false
  },
  optimizeDeps: {
    exclude: ['@remix-run/router']
  }
});
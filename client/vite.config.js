import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const rawBase = env.VITE_APP_BASE || '/';
  const base = rawBase === '/' ? '/' : `/${rawBase.replace(/^\/+|\/+$/g, '')}/`;

  return {
    base,
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        [`${base}api`]: {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
  };
});

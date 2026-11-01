import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the build works from any folder (e.g. GitHub Pages /lift-log/).
  base: './',
  server: { host: true, port: 5173 },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // TMA обычно раздаётся с подпути (GitHub Pages / CDN) — относительные пути безопаснее.
  base: './',
  server: {
    host: true, // чтобы можно было прокинуть туннель (cloudflared/ngrok) и открыть в Telegram
    port: 5173,
  },
  build: {
    target: 'es2020',
  },
});

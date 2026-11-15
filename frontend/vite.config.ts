import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, headers: { 'Referrer-Policy': 'no-referrer' } },
  preview: { headers: { 'Referrer-Policy': 'no-referrer' } },
});

// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import svgr from 'vite-plugin-svgr';

export default defineConfig({
  plugins: [react(), tailwindcss(), svgr()],
  server: {
    host: '0.0.0.0', // ✅ GCP 외부에서 접근 가능하게 함
    port: 5173,       // (선택) 포트 명시적으로 지정
  },
});

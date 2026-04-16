import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/ui/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        pretendToBeVisual: true,
      },
    },
    setupFiles: ['./tests/ui/setup.ts'],
    css: true,
    clearMocks: true,
    restoreMocks: true,
  },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import eslint from 'vite-plugin-eslint2';
// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), eslint({ lintInWorker: true, lintDirtyOnly: true })],
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/src/components/Molecule3DThreePanel.tsx')) return 'viewer3d-panel';
          if (id.includes('/src/components/Molecule3DViewerControls.tsx')) return 'viewer3d-panel';
          if (id.includes('/src/components/Molecule3DConformerStrip.tsx')) return 'viewer3d-panel';
          if (id.includes('/src/components/Molecule3DThree.tsx')) return 'viewer3d-engine';
          if (id.includes('/src/hooks/useMolecule3DData.ts')) return 'viewer3d-data';
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/konva/') || id.includes('/react-konva/')) return 'konva';
          if (id.includes('/@rdkit/rdkit/')) return 'rdkit';
          if (id.includes('/react/') || id.includes('/react-dom/')) return 'react';
          if (id.includes('/@tauri-apps/')) return 'tauri';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**', '**/public/rdkit/**'] },
  },
}));

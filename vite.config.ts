import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  root: 'assets',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  plugins: [viteSingleFile()],
});

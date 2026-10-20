import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// eslint-disable-next-line import/no-default-export
export default defineConfig({
  build: {
    target: 'es2022',
    rolldownOptions: {
      input: {
        holder: resolve(import.meta.dirname, 'index.html'),
        approver: resolve(import.meta.dirname, 'approver.html'),
      },
    },
  },
});

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// eslint-disable-next-line import/no-default-export
export default defineConfig({
  build: {
    target: 'es2022',
    rolldownOptions: {
      input: {
        holder: fileURLToPath(new URL('./index.html', import.meta.url)),
        approver: fileURLToPath(new URL('./approver.html', import.meta.url)),
      },
    },
  },
});

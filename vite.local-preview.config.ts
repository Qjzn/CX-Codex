import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: false,
    rollupOptions: {
      input: {
        localPreview: "local-preview.html",
      },
    },
  },
});

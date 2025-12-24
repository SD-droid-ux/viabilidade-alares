import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  server: {
    host: "0.0.0.0",
    port: 5174,
    strictPort: false,
    allowedHosts: [
      "8471a0be-4ab3-4dfd-93ef-b8758b605ad0-00-22dqv1n0zpez.kirk.replit.dev",
      ".replit.dev",
      ".repl.co",
    ],
    proxy: {
      "/api": {
        target: process.env.VITE_API_URL || "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  // Configuração para produção
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
  },
});

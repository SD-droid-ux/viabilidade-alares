import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [
    svelte({
    })
  ],
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
  // Configuração para produção (ultra-otimizada)
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    minify: 'esbuild', // esbuild é mais rápido que terser e já vem com Vite
    target: 'es2015', // Otimizar para browsers modernos
    cssMinify: true, // Minificar CSS também
    cssCodeSplit: true, // Code splitting para CSS
    reportCompressedSize: false, // Desabilitar relatório de tamanho (acelera build)
    // Aumentar limites para evitar travamentos em builds grandes
    chunkSizeWarningLimit: 2000, // Aumentar limite de warning
    // Configurar timeouts maiores para builds pesados
    buildTimeout: 300000, // 5 minutos de timeout
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Separar node_modules em chunks menores para melhor cache
          if (id.includes('node_modules')) {
            if (id.includes('@googlemaps')) {
              return 'google-maps';
            }
            if (id.includes('xlsx') || id.includes('html2canvas')) {
              return 'utils';
            }
            if (id.includes('svelte')) {
              return 'svelte-vendor';
            }
            // Agrupar outras dependências menores
            return 'vendor';
          }
        },
        // Otimizar nomes de arquivos para melhor cache
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
      // Otimizações adicionais para evitar travamentos
      maxParallelFileOps: 5, // Limitar operações paralelas
    },
    // Tree-shaking agressivo
    treeshake: {
      moduleSideEffects: false,
      preset: 'smallest', // Usar preset menor para reduzir tamanho do bundle
    },
  },
});

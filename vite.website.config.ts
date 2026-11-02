import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  root: resolve(import.meta.dirname, "website"),
  publicDir: resolve(import.meta.dirname, "public"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 3001,
    strictPort: true,
  },
  build: {
    outDir: resolve(import.meta.dirname, "dist-website"),
    emptyOutDir: true,
  },
})

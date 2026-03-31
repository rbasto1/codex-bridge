import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const BROWSER_PORT = Number(process.env.BROWSER_PORT ?? 4094);
const SERVER_PORT = Number(process.env.SERVER_PORT ?? process.env.PORT ?? 4095);
const ALLOWED_HOSTS = process.env.ALLOWED_HOSTS?.split(",")
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [react()],
  server: {
    port: BROWSER_PORT,
    allowedHosts: ALLOWED_HOSTS,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${SERVER_PORT}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist/client",
  },
});

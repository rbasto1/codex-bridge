import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const BROWSER_PORT = Number(process.env.BROWSER_PORT ?? 4094);
const SERVER_PORT = Number(process.env.SERVER_PORT ?? process.env.PORT ?? 4095);

export default defineConfig({
  plugins: [react()],
  server: {
    port: BROWSER_PORT,
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

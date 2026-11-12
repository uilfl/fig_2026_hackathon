import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

const DEV_PORT = 8080;

export default defineConfig(({ command }) => ({
  plugins: [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
      server: { entry: "server" },
      importProtection: { behavior: "error", client: { files: ["**/server/**"], specifiers: ["server-only"] } },
    }),
    // Deploy adapter, build only. Cloudflare Workers, as before; change `preset` to retarget.
    ...(command === "build" ? [nitro({ preset: "cloudflare-module", cloudflare: { nodeCompat: true, deployConfig: true } })] : []),
    react(),
  ],
  css: { transformer: "lightningcss" },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  optimizeDeps: { include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"], ignoreOutdatedRequests: true },
  server: { host: "::", port: DEV_PORT },
}));

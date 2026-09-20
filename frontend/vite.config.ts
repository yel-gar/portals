/// <reference types="vitest/config" />
import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import typegpu from "unplugin-typegpu/vite";

export default defineConfig({
  plugins: [react(), typegpu()],
  server: {
    host: true,
    port: Number(process.env.VITE_DEV_PORT ?? 5173),
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    // antd is intentionally one long-lived vendor chunk; keep the warning quiet.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) {
            return undefined;
          }
          // TypeGPU (and its runtime deps) are pulled in only by the dynamic
          // import inside the fire panels — keep them out of the eagerly
          // loaded vendor chunk so browsers without WebGPU never fetch them.
          if (/(^|\/)node_modules\/(typegpu|tsover-runtime|typed-binary|tinyest)\//.test(id)) {
            return undefined;
          }
          if (id.includes("antd") || id.includes("@ant-design")) {
            return "antd";
          }
          if (id.includes("@tanstack")) {
            return "query";
          }
          if (id.includes("react")) {
            return "react";
          }
          return "vendor";
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts", "./src/test/server.ts"],
    css: false,
    // Playwright specs live in e2e/ and must never run under vitest.
    exclude: [...configDefaults.exclude, "e2e/**"],
    env: {
      // Deterministic backend origin: tests talk to MSW handlers by path,
      // while this keeps `websocketUrl`/`BACKEND_URL` stable across machines.
      VITE_BACKEND_URL: "http://localhost:8000",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**"],
      // Plumbing/entry points with no meaningful unit-test surface: the app
      // root (wired in main.tsx), global styles, and pure type definitions.
      exclude: [
        "src/test/**",
        "src/main.tsx",
        "src/vite-env.d.ts",
        "src/App.tsx",
        "src/app.css",
        "src/api/types.ts",
      ],
    },
  },
});

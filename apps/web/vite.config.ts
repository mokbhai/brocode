import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

const port = Number(process.env.PORT ?? 5733);
const sourcemapEnv = process.env.T3CODE_WEB_SOURCEMAP?.trim().toLowerCase();
const useTauriEntry = process.env.T3CODE_TAURI_ENTRY === "1";
const desktopTauriEntry = fileURLToPath(new URL("../desktop-tauri/src/main.ts", import.meta.url));
const webEntry = fileURLToPath(new URL("./src/main.tsx", import.meta.url));

const buildSourcemap =
  sourcemapEnv === "0" || sourcemapEnv === "false"
    ? false
    : sourcemapEnv === "hidden"
      ? "hidden"
      : true;

export default defineConfig({
  plugins: [
    {
      name: "brocode-tauri-entry",
      transformIndexHtml(html) {
        if (!useTauriEntry) return html;

        return html.replace(`src="/src/main.tsx"`, `src="/@fs/${desktopTauriEntry}"`);
      },
    },
    tanstackRouter(),
    react(),
    babel({
      // We need to be explicit about the parser options after moving to @vitejs/plugin-react v6.0.0
      // This is because the babel plugin only automatically parses typescript and jsx based on relative paths (e.g. "**/*.ts")
      // whereas the previous version of the plugin parsed all files with a .ts extension.
      // This is causing our packages/ directory to fail to parse, as they are not relative to the CWD.
      parserOpts: { plugins: ["typescript", "jsx"] },
      presets: [reactCompilerPreset()],
    }),
    tailwindcss(),
  ],
  optimizeDeps: {
    include: [
      "@pierre/diffs",
      "@pierre/diffs/react",
      "@pierre/diffs/worker/worker.js",
      "react-icons/gr",
    ],
  },
  define: {
    // In dev mode, tell the web app where the WebSocket server lives
    "import.meta.env.VITE_WS_URL": JSON.stringify(process.env.VITE_WS_URL ?? ""),
    "import.meta.env.APP_VERSION": JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "brocode-web-entry": webEntry,
    },
    tsconfigPaths: true,
  },
  server: {
    port,
    strictPort: true,
    fs: {
      allow: ["../.."],
    },
    hmr: {
      // Explicit config so Vite's HMR WebSocket connects reliably
      // inside Electron's BrowserWindow. Vite 8 uses console.debug for
      // connection logs — enable "Verbose" in DevTools to see them.
      protocol: "ws",
      host: "localhost",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: buildSourcemap,
  },
});

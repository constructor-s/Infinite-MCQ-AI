import { defineConfig } from "vitest/config";
import { loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { VitePWA } from "vite-plugin-pwa";
import generateHandler from "./api/questions/generate";
import modelsHandler from "./api/models";

function localApi(): Plugin {
  return {
    name: "iworld-local-api",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url?.split("?")[0];
        const handler = pathname === "/api/questions/generate" ? generateHandler : pathname === "/api/models" ? modelsHandler : undefined;
        if (!handler) return next();
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const headers = new Headers();
          for (const [key, value] of Object.entries(request.headers)) {
            // HTTPS may use HTTP/2. Its pseudo-headers (`:method`, `:path`,
            // etc.) are transport metadata and are not valid Web Headers.
            if (key.startsWith(":")) continue;
            if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
            else if (value !== undefined) headers.set(key, value);
          }
          const body = chunks.length ? Buffer.concat(chunks) : undefined;
          const webRequest = new Request(`http://localhost${request.url}`, {
            method: request.method,
            headers,
            body,
            duplex: body ? "half" : undefined
          } as RequestInit);
          const result = await handler(webRequest);
          response.statusCode = result.status;
          result.headers.forEach((value, key) => response.setHeader(key, value));
          response.end(Buffer.from(await result.arrayBuffer()));
        } catch (error) {
          server.config.logger.error(error instanceof Error ? error.message : String(error));
          response.statusCode = 500;
          response.end(JSON.stringify({ error: { code: "LOCAL_API_ERROR", message: "Local API failed" } }));
        }
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));
  return {
  plugins: [
    react(),
    basicSsl(),
    localApi(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "IWorld",
        short_name: "IWorld",
        description: "AI-generated MCCQE clinical reasoning practice",
        theme_color: "#f7f6f2",
        background_color: "#f7f6f2",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }
        ]
      },
      workbox: {
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,svg}"]
      }
    })
  ],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    clearMocks: true
  }
  };
});

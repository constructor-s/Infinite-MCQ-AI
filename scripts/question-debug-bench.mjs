import { createServer, loadEnv } from "vite";

/**
 * Callable Node entry point for the TypeScript debug bench.
 * GEMINI_API_KEY may be set in the shell or in the project's .env.local file.
 */
export async function runQuestionDebugBench(request) {
  const configuredKey = process.env.GEMINI_API_KEY || loadEnv("development", process.cwd(), "").GEMINI_API_KEY;
  if (configuredKey) process.env.GEMINI_API_KEY = configuredKey;

  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: "custom",
    logLevel: "error"
  });

  try {
    const bench = await server.ssrLoadModule("/src/server/questionDebugBench.ts");
    return await bench.runQuestionDebugBench(request);
  } finally {
    await server.close();
  }
}

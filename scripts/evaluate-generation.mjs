// Run only on demand. This invokes the configured Gemini model through the app's
// existing API and writes a review artifact; it never marks an item clinically valid.
import { readFile, writeFile } from "node:fs/promises";
import { request } from "node:https";
import http from "node:http";

const [baseUrl = "https://localhost:5173", output = "/tmp/iworld-generation-evaluation.json", only] = process.argv.slice(2);
const evaluation = JSON.parse(await readFile(new URL("../curriculum/evaluation.json", import.meta.url), "utf8"));
const endpoint = new URL("/api/questions/generate", baseUrl);
if (!["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)) throw new Error("Use a local development server");

function post(body) {
  return new Promise((resolve, reject) => {
    const send = endpoint.protocol === "https:" ? request : http.request;
    const req = send(endpoint, { method: "POST", rejectUnauthorized: false,
      headers: { "Content-Type": "application/json", Accept: "application/json" }, timeout: 65_000 }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => {
        try { resolve({ status: response.statusCode, body: JSON.parse(text) }); } catch { reject(new Error("Non-JSON response from local API")); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("Evaluation request timed out")));
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

const previous = await readFile(output, "utf8").then(JSON.parse).catch(() => undefined);
const reusable = previous?.evaluationVersion === evaluation.version ? previous.results.filter((result) => result.status === 200 &&
  evaluation.cases.some((item) => item.id === result.id && JSON.stringify(item.request) === JSON.stringify(result.assignment))) : [];
const report = { evaluationVersion: evaluation.version, generatedAt: new Date().toISOString(), rubric: evaluation.rubric, clinicalReviewStatus: "not_reviewed", results: reusable };
for (const item of evaluation.cases) {
  if (only && !only.split(",").includes(item.id)) continue;
  if (report.results.some((result) => result.id === item.id)) { console.log(`Reusing ${item.id}`); continue; }
  console.log(`Generating ${item.id}`);
  const result = await post(item.request).catch((error) => ({ status: 0, body: { error: { message: error.message } } }));
  report.results.push({ id: item.id, assignment: item.request, ...result });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(`${item.id}: ${result.status}${result.body.error ? ` ${result.body.error.code ?? result.body.error.message}` : ""}`);
  if (result.status !== 200) { process.exitCode = 1; break; }
}
console.log(`Saved ${report.results.length} items for manual review to ${output}`);

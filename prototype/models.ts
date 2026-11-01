// Lists the models available to a provider's API key.
// Usage: node prototype/models.ts [xai|openai]

import { loadEnv, loadProvider } from "./env.ts";

loadEnv();
const provider = loadProvider(process.argv[2] ?? "xai");
const response = await fetch(`${provider.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${provider.apiKey}` },
});
const text = await response.text();
if (!response.ok) {
    console.error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    process.exit(1);
}

const ids: string[] = (JSON.parse(text).data ?? []).map((model: { id: string }) => model.id);
console.log(ids.sort().join("\n"));

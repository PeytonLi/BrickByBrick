import { expandIntent } from "../../packages/inference/src/intent";
async function main() {
  try {
    console.log("Calling expandIntent...");
    const result = await expandIntent("a model good at React responsive design");
    console.log("SUCCESS");
    console.log("domain_framing:", JSON.stringify(result.config.domain_framing));
    console.log("framework:", JSON.stringify(result.config.framework));
    console.log("sample_titles:", JSON.stringify(result.sample_titles));
  } catch(e) {
    console.log("ERROR:", e instanceof Error ? e.message : String(e));
  }
}
main();

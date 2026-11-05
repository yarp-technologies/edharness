import { existsSync } from "node:fs";

const helper = new URL("../../opened-init/scripts/opened-init.mjs", import.meta.url);
if (!existsSync(helper)) {
  console.error("Install the opened-init skill alongside opened-api to initialize the Opened key.");
  process.exitCode = 1;
} else {
  await import(helper.href);
}

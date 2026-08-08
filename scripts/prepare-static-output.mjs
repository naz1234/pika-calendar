import { readFile, writeFile } from "node:fs/promises";

const outputPath = new URL("../dist/client/index.html", import.meta.url);
const html = await readFile(outputPath, "utf8");
const viewportPattern = /<meta name="viewport" content="([^"]*)"\s*\/?>/i;
const match = html.match(viewportPattern);

if (!match) {
  throw new Error("The exported page is missing its viewport metadata.");
}

const content = match[1].includes("viewport-fit=cover")
  ? match[1]
  : `${match[1]}, viewport-fit=cover`;
const updated = html.replace(viewportPattern, `<meta name="viewport" content="${content}"/>`);

await writeFile(outputPath, updated, "utf8");

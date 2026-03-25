import { build } from "esbuild";
import { cpSync, mkdirSync } from "fs";

await build({
  entryPoints: ["src/claudet.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "dist/claudet.cjs",
  banner: {
    js: [
      "#!/usr/bin/env node",
      'var __import_meta_url = require("url").pathToFileURL(__filename).href;',
    ].join("\n"),
  },
  define: { "import.meta.url": "__import_meta_url" },
});

mkdirSync("dist/templates", { recursive: true });
cpSync("src/templates", "dist/templates", { recursive: true });

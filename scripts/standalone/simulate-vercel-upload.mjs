// Simulates what Vercel uploads for the standalone deploy branch: copies the
// repo's tracked + untracked (non-gitignored) files into a temp directory,
// applies scripts/standalone/.vercelignore with git's own ignore matching
// (same syntax), and prints the destination. Used by the standalone e2e
// checks to build exactly what the deploy would receive.
//
//   node scripts/standalone/simulate-vercel-upload.mjs <destDir>
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dest = resolve(process.argv[2] || mkdtempSync(join(tmpdir(), "hub-upload-")));
const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 << 20 });

// Repo files as the deploy branch would have them (vercel.json/.vercelignore come from the templates).
const repoFiles = git(["ls-files", "-co", "--exclude-standard"], ROOT).split("\n").filter(Boolean)
  .filter((f) => f !== "vercel.json" && f !== ".vercelignore");

// Stage them in a scratch git repo whose .gitignore is the .vercelignore, then ask git what survives.
const scratch = mkdtempSync(join(tmpdir(), "hub-ignore-"));
git(["init", "-q"], scratch);
for (const f of [...repoFiles, "vercel.json"]) {
  mkdirSync(dirname(join(scratch, f)), { recursive: true });
  writeFileSync(join(scratch, f), "");
}
// Written last: the repo's own .gitignore is among the staged files.
copyFileSync(join(ROOT, "scripts/standalone/.vercelignore"), join(scratch, ".gitignore"));
const kept = git(["ls-files", "-o", "--exclude-standard"], scratch).split("\n").filter(Boolean).filter((f) => f !== ".gitignore");
rmSync(scratch, { recursive: true, force: true });

rmSync(dest, { recursive: true, force: true });
for (const f of kept) {
  mkdirSync(dirname(join(dest, f)), { recursive: true });
  const src = f === "vercel.json" ? "scripts/standalone/vercel.json" : f;
  copyFileSync(join(ROOT, src), join(dest, f));
}
console.log(JSON.stringify({ dest, files: kept.sort() }));

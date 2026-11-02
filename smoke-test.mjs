// 静态检查：资源齐全、脚本语法正确、页面脚本引用的元素都存在。
// 算法和统计的测试在 tests/ 里。

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(directory, "index.html"), "utf8");
const sourceFiles = fs
  .readdirSync(path.join(directory, "src"))
  .filter((name) => name.endsWith(".js"))
  .map((name) => path.join("src", name));

for (const asset of ["styles.css", "recruiting.js", "src/main.js", "manifest.webmanifest", "icon.svg"]) {
  if (!fs.existsSync(path.join(directory, asset))) {
    throw new Error(`缺少静态资源：${asset}`);
  }
}

for (const file of ["recruiting.js", "scripts/serve.mjs", "electron/main.mjs", "electron/preload.cjs", ...sourceFiles]) {
  execFileSync(process.execPath, ["--check", path.join(directory, file)], { stdio: "inherit" });
}

for (const file of sourceFiles) {
  const source = fs.readFileSync(path.join(directory, file), "utf8");
  for (const match of source.matchAll(/document\.querySelector\("#([^"]+)"\)/g)) {
    if (!html.includes(`id="${match[1]}"`)) {
      throw new Error(`${file} 引用了不存在的页面元素：#${match[1]}`);
    }
  }
}

console.log(`Smoke test passed（${sourceFiles.length} 个页面模块）。`);

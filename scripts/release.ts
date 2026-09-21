#!/usr/bin/env bun

type PackageJson = {
  version: string;
  [key: string]: unknown;
};

const root = new URL("..", import.meta.url);
const packagePath = new URL("package.json", root);
const tauriConfigPath = new URL("src-tauri/tauri.conf.json", root);
const cargoPath = new URL("src-tauri/Cargo.toml", root);
const cargoLockPath = new URL("src-tauri/Cargo.lock", root);
const changelogPath = new URL("changelog.md", root);

function fail(message: string): never {
  console.error(`发布失败：${message}`);
  process.exit(1);
}

function git(args: string[]): string {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd: root.pathname,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (!result.success) {
    const error = new TextDecoder().decode(result.stderr).trim();
    fail(error || `git ${args.join(" ")} 执行失败`);
  }

  return new TextDecoder().decode(result.stdout).trim();
}

function optionalGit(args: string[]): string | undefined {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd: root.pathname,
    stdout: "pipe",
    stderr: "pipe",
  });

  return result.success ? new TextDecoder().decode(result.stdout).trim() : undefined;
}

function parseVersion(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    fail(`版本号必须是 SemVer 三段格式，当前值为 ${version}`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function nextVersion(current: string, requested: string): string {
  const [major, minor, patch] = parseVersion(current);
  if (/^\d+\.\d+\.\d+$/.test(requested)) return requested;

  switch (requested) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      fail(`请传入 patch、minor、major 或完整版本号（例如 1.2.3），收到 ${requested}`);
  }
}

function releaseNotes(): string[] {
  const range = optionalGit(["describe", "--tags", "--abbrev=0"]);

  const commits = git(
    range
      ? ["log", `${range}..HEAD`, "--pretty=format:%s (%h)", "--no-merges"]
      : ["log", "-20", "--pretty=format:%s (%h)", "--no-merges"],
  );

  return commits ? commits.split("\n").map((commit) => `- ${commit}`) : ["- 版本号更新。"];
}

const [requested] = process.argv.slice(2);
if (!requested || requested.startsWith("-")) {
  console.error("用法：bun run release -- patch|minor|major|<version>");
  process.exit(1);
}

if (git(["status", "--porcelain"])) {
  fail("工作区存在未提交改动，请先提交或暂存后再发布。");
}

const packageJson = JSON.parse(await Bun.file(packagePath).text()) as PackageJson;
const version = nextVersion(packageJson.version, requested);
const date = new Date().toISOString().slice(0, 10);

packageJson.version = version;
await Bun.write(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

const tauriConfig = JSON.parse(await Bun.file(tauriConfigPath).text()) as { version?: string };
tauriConfig.version = version;
await Bun.write(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`);

const cargo = await Bun.file(cargoPath).text();
const updatedCargo = cargo.replace(/^(version\s*=\s*")[^"]+("\s*$)/m, `$1${version}$2`);
if (updatedCargo === cargo) {
  fail("无法在 src-tauri/Cargo.toml 中找到 package.version。");
}
await Bun.write(cargoPath, updatedCargo);

const cargoLock = await Bun.file(cargoLockPath).text();
const updatedCargoLock = cargoLock.replace(
  /(\[\[package\]\]\nname = "octopus"\nversion = ")[^"]+("\n)/,
  `$1${version}$2`,
);
if (updatedCargoLock === cargoLock) {
  fail("无法在 src-tauri/Cargo.lock 中找到 octopus 包版本。");
}
await Bun.write(cargoLockPath, updatedCargoLock);

const changelog = await Bun.file(changelogPath).exists()
  ? await Bun.file(changelogPath).text()
  : "# 更新日志\n\n所有重要变更都会记录在这里。\n";
const entry = [`## [${version}] - ${date}`, "", "### 变更", ...releaseNotes(), ""].join("\n");
const changelogBody = changelog.replace(/^# 更新日志\s*/, "").trim();
const firstRelease = changelogBody.search(/^## \[/m);
const preamble = (firstRelease === -1 ? changelogBody : changelogBody.slice(0, firstRelease)).trim();
const previousReleases = (firstRelease === -1 ? "" : changelogBody.slice(firstRelease)).trim();
const changelogSections = [preamble, entry.trim(), previousReleases].filter(Boolean);
await Bun.write(changelogPath, `# 更新日志\n\n${changelogSections.join("\n\n")}\n`);

git([
  "add",
  "package.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "changelog.md",
]);
git(["commit", "-m", `chore(release): v${version}`]);
const tag = `v${version}`;
git(["tag", "-a", tag, "-m", tag]);
git(["push", "--set-upstream", "origin", "HEAD", "--follow-tags"]);

console.log(`已发布 ${tag}，版本文件、changelog.md 和发布标签已推送到远端。`);

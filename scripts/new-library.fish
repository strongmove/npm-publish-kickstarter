#!/usr/bin/env fish

set -l owner (read -P "GitHub owner/org for package scope [your-org]: " ; or echo "your-org")
set -l package_name (read -P "Package name (without scope) [my-library]: " ; or echo "my-library")
set -l repo_name (read -P "Repository name [my-library]: " ; or echo "$package_name")
set -l codename (read -P "Codename [atlas]: " ; or echo "atlas")
set -l description (read -P "Short package description [A minimal TypeScript library]: " ; or echo "A minimal TypeScript library")

set -l package_scope "@$owner"
set -l scope_name "$package_scope/$package_name"

node -e '
const fs = require("fs");
const pkgPath = "package.json";
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const owner = process.argv[1];
const packageName = process.argv[2];
const repoName = process.argv[3];
const codename = process.argv[4];
const description = process.argv[5];

pkg.name = `@${owner}/${packageName}`;
pkg.description = description;
pkg.keywords = ["typescript", "library", packageName, repoName, codename];
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

const readme = [
  `# ${codename} — \`@${owner}/${packageName}\``,
  "",
  description,
  "",
  "## Quick start",
  "",
  "```bash",
  `npm install @${owner}/${packageName}`,
  "```",
  "",
  "## Publishing",
  "",
  "This package is configured for GitHub Packages. Publish with a GitHub Actions workflow or by creating a tag like `v0.1.0` and running `npm publish`.",
  "",
  "## Repository",
  "",
  `Repository name: ${repoName}`,
  "",
].join("\n");
fs.writeFileSync("README.md", readme + "\n");

fs.writeFileSync(".npmrc", `@${owner}:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n`);

const publishPath = ".github/workflows/publish.yml";
const publish = fs.readFileSync(publishPath, "utf8");
const updatedPublish = publish.replace(/scope: "@[^"]+"/, `scope: "@${owner}"`);
fs.writeFileSync(publishPath, updatedPublish);
' "$owner" "$package_name" "$repo_name" "$codename" "$description"

printf "\nUpdated package metadata:\n"
printf "  scope: %s\n" "$package_scope"
printf "  name: %s\n" "$package_name"
printf "  repo: %s\n" "$repo_name"
printf "  codename: %s\n" "$codename"
printf "  description: %s\n" "$description"
printf "\nNext steps:\n"
printf "  npm install\n"
printf "  npm run build\n"
printf "\n"

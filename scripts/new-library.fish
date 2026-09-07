#!/usr/bin/env fish

function prompt_for_value -a prompt default_value
    set -l value
    read -P "$prompt [$default_value]: " value
    if test -z "$value"
        echo "$default_value"
    else
        echo "$value"
    end
end

function ensure_command -a command_name
    if not command -q "$command_name"
        echo "Missing required command: $command_name" >&2
        exit 1
    end
end

function resolve_github_token
    if test -n "$GITHUB_TOKEN"
        echo "$GITHUB_TOKEN"
        return 0
    end

    if test -n "$NODE_AUTH_TOKEN"
        echo "$NODE_AUTH_TOKEN"
        return 0
    end

    set -l token (prompt_for_value "GitHub personal access token for npm.pkg.github.com" "")
    if test -z "$token"
        echo "A GitHub token is required to publish packages to GitHub Packages." >&2
        exit 1
    end

    echo "$token"
end

function validate_github_token -a token
    if not command -q curl
        echo "curl not found; skipping GitHub token validation." >&2
        return 0
    end

    set -l auth_header "Authorization: Bearer $token"
    set -l response (curl -fsSL \
        -H "$auth_header" \
        -H "Accept: application/vnd.github+json" \
        https://api.github.com/user 2>/dev/null)

    if test $status -ne 0
        echo "GitHub token validation failed. Check that the token is valid and still active." >&2
        exit 1
    end

    set -l username (printf '%s\n' "$response" | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).login || ''" 2>/dev/null)
    if test -z "$username"
        echo "GitHub token validation failed. The token did not return a valid user account." >&2
        exit 1
    end

    printf "GitHub token validated for %s.\n" "$username"
end

function write_npmrc -a owner token
    printf '%s\n' "@$owner:registry=https://npm.pkg.github.com" \
        "//npm.pkg.github.com/:_authToken=$token" > .npmrc
end

function update_project_files -a owner package_name repo_name codename description
    set -l keyword_inputs typescript library github-packages "$package_name" "$repo_name" "$codename"

    node -e '
const fs = require("fs");
const pkgPath = "package.json";
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const owner = process.argv[1];
const packageName = process.argv[2];
const repoName = process.argv[3];
const codename = process.argv[4];
const description = process.argv[5];
const keywordValues = process.argv.slice(6);

const filteredKeywords = keywordValues
  .map((value) => String(value).trim())
  .filter(Boolean)
  .map((value) => value.toLowerCase());

pkg.name = `@${owner}/${packageName}`;
pkg.description = description;
pkg.keywords = [...new Set(filteredKeywords)];
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

const publishPath = ".github/workflows/publish.yml";
const publish = fs.readFileSync(publishPath, "utf8");
const updatedPublish = publish.replace(/scope: "@[^\"]+"/, `scope: "@${owner}"`);
fs.writeFileSync(publishPath, updatedPublish);
' "$owner" "$package_name" "$repo_name" "$codename" "$description" $keyword_inputs
end

function print_summary -a owner package_name repo_name codename description
    printf "\nUpdated package metadata:\n"
    printf "  scope: %s\n" "@$owner"
    printf "  name: %s\n" "$package_name"
    printf "  repo: %s\n" "$repo_name"
    printf "  codename: %s\n" "$codename"
    printf "  description: %s\n" "$description"
    printf "\nNext steps:\n"
    printf "  npm install\n"
    printf "  npm run build\n"
    printf "\n"
end

function main
    ensure_command node

    set -l owner (prompt_for_value "GitHub owner/org for package scope" "your-org")
    set -l package_name (prompt_for_value "Package name (without scope)" "my-library")
    set -l repo_name (prompt_for_value "Repository name" "$package_name")
    set -l codename (prompt_for_value "Codename" "atlas")
    set -l description (prompt_for_value "Short package description" "A minimal TypeScript library")

    set -l token (resolve_github_token)
    validate_github_token "$token"

    write_npmrc "$owner" "$token"
    update_project_files "$owner" "$package_name" "$repo_name" "$codename" "$description"
    print_summary "$owner" "$package_name" "$repo_name" "$codename" "$description"
end

main $argv

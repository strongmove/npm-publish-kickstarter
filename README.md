# npm-publish-kickstarter

A minimal TypeScript library starter configured for publishing packages to GitHub Packages.

## Overview

This repository is intentionally stripped down to the minimum useful structure for a private or public GitHub-hosted npm package. It includes:

- a TypeScript entry point
- a basic build setup
- GitHub Actions publishing to GitHub Packages
- a Fish script to scaffold a new package from prompts

## Quick start

```bash
npm install
npm run build
```

## Publish to GitHub Packages

1. Replace `@your-org` in `.npmrc` and the GitHub Actions workflow with your GitHub owner or organization.
2. Create a tag like `v0.1.0`.
3. Push the tag to trigger GitHub Actions.
4. Ensure the repository has package permissions enabled for GitHub Packages.

```bash
npm publish
```

## Customize a new library

Run the interactive setup script:

```fish
fish scripts/new-library.fish
```

It will ask for:

- GitHub owner or organization
- package name
- repository name
- codename
- description

Then it updates the package metadata and publishing configuration to match your new library.

## Files

- `src/index.ts` — minimal library entry point
- `scripts/new-library.fish` — interactive project initializer
- `.github/workflows/publish.yml` — GitHub Actions publish workflow
- `.npmrc` — runtime registry configuration for GitHub Packages

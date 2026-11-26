#!/usr/bin/env node
// The Node client: a GitHub repository through the GitHub API, or a local directory; stdout and
// stderr, or the web view. Nothing is stored.
import { AtlasError } from './core/errors.ts';
import { run } from './commands.ts';
import { openGitHub, parseGitHubUrl } from './core/github.ts';
import { openDirectory } from './local.ts';
import { serveWeb } from './web.ts';

const token = process.env.GITHUB_TOKEN || undefined;
const open = (input: string) => (parseGitHubUrl(input) ? openGitHub(input, { fetch, token }) : openDirectory(input));

process.exitCode = await run(process.argv.slice(2), {
  open,
  serve: async (port) => {
    try {
      return (await serveWeb({ open, github: { fetch, token }, port })).url;
    } catch (error) {
      throw new AtlasError(`Cannot start the web view on port ${port}: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
  print: (text) => console.log(text),
  error: (text) => console.error(text),
});

// The real model: `claude -p`, the prompt on stdin, the answer on stdout.
import { spawn } from 'node:child_process';
import { AtlasError } from './core/errors.ts';
import type { Model } from './core/cluster.ts';

export const claude: Model = (prompt) =>
  new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('error', (error) => reject(new AtlasError(`Cannot run claude -p: ${error.message}`)));
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new AtlasError(`claude -p failed (exit ${code}): ${err.trim()}`))));
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });

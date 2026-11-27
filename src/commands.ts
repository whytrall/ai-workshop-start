// The skill-atlas commands. The same code serves the Node CLI and the browser
// terminal: everything that differs between them comes in through the context.
import { AtlasError } from './core/errors.ts';
import { skillLink, type Repository, type Skill } from './core/model.ts';
import { scan, type Source } from './core/scan.ts';

export type Context = {
  /** Opens what the user asked to scan. */
  open(input: string): Promise<Source>;
  print(text: string): void;
  /** Errors and warnings. */
  error(text: string): void;
  /** Starts the web view on this port and returns its URL; only where a server can run. */
  serve?(port: number): Promise<string>;
};

const usage = `Usage: skill-atlas <command>

  scan <GitHub URL | directory>   find every SKILL.md in a repository and print it
  web [port]                      open the web view, on http://127.0.0.1:8000/ by default
  help                            show this help`;

/** Runs one command; returns its exit code. */
export async function run(args: string[], context: Context): Promise<number> {
  const [command = 'help', ...rest] = args;
  try {
    if (command === 'scan') await scanCommand(rest, context);
    else if (command === 'web') await webCommand(rest, context);
    else if (command === 'help') context.print(usage);
    else throw new AtlasError(`Unknown command: ${command}\n\n${usage}`);
    return 0;
  } catch (error) {
    if (!(error instanceof AtlasError)) throw error;
    context.error(error.message);
    return 1;
  }
}

async function scanCommand(args: string[], context: Context) {
  if (args.length !== 1) throw new AtlasError('Usage: skill-atlas scan <GitHub URL | directory>');
  const result = await scan(await context.open(args[0]));
  printRepository(result.repository, result.skills, context);
  for (const warning of result.warnings) context.error(printable(`warning: ${warning}`));
}

async function webCommand(args: string[], context: Context) {
  if (args.length > 1 || (args[0] !== undefined && !/^\d+$/.test(args[0]))) throw new AtlasError('Usage: skill-atlas web [port]');
  const port = Number(args[0] ?? 8000);
  if (port > 65535) throw new AtlasError(`Not a port: ${port}`);
  if (!context.serve) throw new AtlasError('The web view runs only from the command line: ./skill-atlas web');
  context.print(`Skill Atlas on ${await context.serve(port)} · Ctrl+C to stop`);
}

/** `<owner>/<repo> · N skills`, then each skill's name, first sentence and link. */
function printRepository(repository: Repository, skills: Skill[], context: Context) {
  // What a scanned repository says reaches the terminal only as text, never as escape sequences.
  const print = (text: string) => context.print(printable(text));
  print(`${repository.id} · ${skills.length} ${skills.length === 1 ? 'skill' : 'skills'}`);
  for (const skill of skills) {
    print(skill.description ? `${skill.name} — ${firstSentence(skill.description)}` : skill.name);
    print(`  ${skillLink(repository, skill)}`);
    if (skill.copies.length > 0) print(`  also in ${skill.copies.join(', ')}`);
  }
}

/** Control characters (C0, DEL, C1: ESC, BEL, CSI…) shown escaped, as `\x1b`, so they cannot drive the terminal. */
function printable(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

function firstSentence(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return /^.*?[.!?](?=\s|$)/.exec(line)?.[0] ?? line;
}

import { type Document, isAlias, isScalar, parseDocument } from 'yaml';

/** What a SKILL.md says about itself. */
export type ParsedSkill = {
  /** Missing when the front matter has no name. */
  name?: string;
  description: string;
  /** The other front matter keys. */
  properties: Record<string, unknown>;
  /** The Markdown after the front matter. */
  body: string;
  warning?: string;
};

/**
 * Reads the YAML front matter between the leading `---` lines and the body
 * after it. Only a `---` at column 0 closes the front matter, as in YAML; an
 * indented one belongs to the value around it. Malformed front matter is not
 * fatal: the skill keeps its directory name and gets a warning.
 */
export function parseSkill(text: string): ParsedSkill {
  const lines = text.split(/\r?\n/);
  if (lines[0].trim() !== '---') return fallback('no front matter', text);
  const end = lines.findIndex((line, index) => index > 0 && line.trimEnd() === '---');
  if (end < 0) return fallback('front matter without a closing ---', text);
  const body = lines.slice(end + 1).join('\n');
  // The leading newline keeps YAML's line numbers equal to the file's.
  const document = parseDocument(`\n${lines.slice(1, end).join('\n')}`);
  const [error] = document.errors;
  if (error) return malformed(error, body);
  let data: unknown;
  try {
    // Throws on front matter that parses but cannot be built, like an alias bomb.
    data = document.toJS();
  } catch (error) {
    return malformed(error instanceof Error ? error : new Error(String(error)), body);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return fallback('front matter is not a mapping', body);
  }
  const { name, description, ...properties } = data as Record<string, unknown>;
  return {
    name: asText(document, 'name', name) || undefined,
    description: asText(document, 'description', description),
    properties,
    body: trim(body),
  };
}

function malformed(error: Error, body: string): ParsedSkill {
  return fallback(`malformed front matter: ${error.message.split('\n')[0].replace(/:$/, '')}`, body);
}

function fallback(reason: string, body: string): ParsedSkill {
  return { description: '', properties: {}, body: trim(body), warning: `${reason}; using the directory name` };
}

/**
 * Text as is; a number as written in the file (`1.10`, not `1.1`; `0x1F`,
 * not `31`); anything else is not text.
 */
function asText(document: Document, key: string, value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value !== 'number') return '';
  let node: unknown = document.get(key, true);
  if (isAlias(node)) node = node.resolve(document);
  const source = isScalar(node) ? node.source : undefined;
  return (typeof source === 'string' ? source : String(value)).trim();
}

/** Without the blank lines around it; the first line keeps its indentation. */
function trim(body: string): string {
  return body.replace(/^(?:[ \t]*\n)+/, '').trimEnd();
}

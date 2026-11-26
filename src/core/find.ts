/** A skill found in a repository: its home SKILL.md, its name and its copies in other roots. */
export type SkillFile = { path: string; name: string; copies: string[] };

/** Where agents keep a repository's own skills. */
export const SKILL_ROOTS = ['.agents/skills', '.claude/skills', '.github/skills', 'agent/skills'];

/**
 * The project skills among the files: `<root>/<name>/SKILL.md`, one folder under a skill root.
 * The same name in several roots is one skill: its home is the first path in order, and the
 * other paths are its copies.
 */
export function findSkills(paths: string[]): SkillFile[] {
  const byName = new Map<string, string[]>();
  for (const path of paths) {
    const root = SKILL_ROOTS.find((root) => path.startsWith(`${root}/`));
    if (!root) continue;
    const [name, file, ...rest] = path.slice(root.length + 1).split('/');
    if (file !== 'SKILL.md' || rest.length > 0 || !name) continue;
    byName.set(name, [...(byName.get(name) ?? []), path]);
  }
  return [...byName].map(([name, found]) => {
    const [home, ...copies] = found.sort();
    return { path: home, name, copies };
  });
}

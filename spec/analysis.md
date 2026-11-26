# Repository analysis
## Input
A **GitHub repository** URL, or a local directory
## Output
Every project skill: **name**, **description**, **link**
## What a project skill is
A **project skill** is a file `<root>/<name>/SKILL.md`, where `<root>` is one of `.agents/skills`, `.claude/skills`, `.github/skills`, `agent/skills`, and `<name>` is one folder under it. Anything else is not a project skill.
- **Exactly this shape**: one folder under a root, then `SKILL.md`. Not deeper (`.claude/skills/x/examples/SKILL.md`), not shallower (`.claude/skills/SKILL.md`), not in another folder (`docs/skills/x/SKILL.md`, `tests/x/SKILL.md`, `skills/x/SKILL.md`), not at the repository root.
- **The file name is exact**: `skill.md`, `SKILL.MD` and `SKILL.md.bak` are not skills.
- **Copies are one skill**: the same `<name>` in several roots is one skill. Its home is the first of its paths in order, and the others are its copies, listed as `also in` ([cli.md](cli.md)).
- **Not the project's files**: a symbolic link, even one to a `SKILL.md`, is not a skill.
- **Name**: the front matter's `name` (trimmed; a number counts as text), else the folder's name. An empty name, or one that is not text (a list, a mapping, a boolean), gives the folder's name, with no warning.
- **Description**: the front matter's `description`. Without one, the skill has no description and is printed by name alone.
- **Path with spaces or symbols**: the link keeps the path, percent-encoded.
- **Order**: by name, then by path.
## Architecture
Core: fetch → find → parse. CLI: a *thin client*.
Skill: id = `repo:path`, name, description, commit, copies
## Details
- **GitHub API**, no clone; *under 5 s* for intellij-community
- The name: front matter, else the folder
- The link pins the *scanned commit*
- Malformed front matter, or none at all, → a *warning*, the scan goes on; the folder's name is used
- A `SKILL.md` listed but missing at the scanned commit → a *warning*, skipped
- GitHub's tree too large to list at once → only the four roots are read, with a *warning*. The same rule applies to what is read. `GITHUB_TOKEN` searches the whole repository and applies the same rule.
- Unreachable repository → a clear message, exit code 1

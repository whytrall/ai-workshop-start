// Skills clustering: a model groups the skills by topic; the shared words are counted here.
import { AtlasError } from './errors.ts';
import { sortSkills, type Skill } from './model.ts';

/** Asks a model: a prompt in, its text answer out. The CLI's is `claude -p`; tests replay a recording. */
export type Model = (prompt: string) => Promise<string>;

export type Cluster = {
  title: string;
  /** What the model says the cluster is about. */
  topics: string[];
  /** The cluster's skills, in the order of `scan`. */
  skills: Skill[];
  /** Words in the name or description of at least two of the cluster's skills, most common first. */
  sharedWords: string[];
};

export type Clustering = { clusters: Cluster[]; warnings: string[] };

export const UNCLUSTERED = 'Unclustered';

/** The prompt: the skills, and the JSON shape the answer must have. */
export function clusterPrompt(skills: Skill[]): string {
  const list = skills.map((skill) => `- ${skill.name}: ${skill.description.replace(/\s+/g, ' ').trim() || '(no description)'}`).join('\n');
  return `Group these agent skills into clusters of related skills. Every skill belongs to exactly one cluster.
Answer with JSON only, no other text, in this shape:
{"clusters": [{"title": "<short title>", "topics": ["<topic>", ...], "skills": ["<skill name>", ...]}]}

Skills:
${list}`;
}

/** Clusters the skills with the model's answer. A bad answer is an error; a slightly wrong one, a warning. */
export async function clusterSkills(skills: Skill[], model: Model): Promise<Clustering> {
  if (skills.length === 0) return { clusters: [], warnings: [] };
  const answer = await model(clusterPrompt(skills));
  const raw = parseAnswer(answer);
  const byName = new Map<string, Skill[]>();
  for (const skill of skills) {
    const matches = byName.get(skill.name) ?? [];
    matches.push(skill);
    byName.set(skill.name, matches);
  }
  const placed = new Set<string>();
  const warnings: string[] = [];
  const clusters: Cluster[] = [];
  for (const entry of raw) {
    const members: Skill[] = [];
    for (const name of entry.skills) {
      const matches = byName.get(name);
      if (!matches) warnings.push(`the model named an unknown skill: ${name}`);
      else if (matches.every((skill) => placed.has(skill.id))) warnings.push(`the model put ${name} in several clusters; kept in the first`);
      else {
        for (const skill of matches) {
          if (!placed.has(skill.id)) {
            placed.add(skill.id);
            members.push(skill);
          }
        }
      }
    }
    if (members.length > 0) clusters.push(makeCluster(entry.title, entry.topics, members));
  }
  const left = skills.filter((skill) => !placed.has(skill.id));
  if (left.length > 0) {
    warnings.push(`the model left out: ${left.map((skill) => skill.name).join(', ')}`);
    clusters.push(makeCluster(UNCLUSTERED, [], left));
  }
  return { clusters, warnings };
}

function makeCluster(title: string, topics: string[], members: Skill[]): Cluster {
  return {
    title,
    topics,
    skills: sortSkills(members),
    sharedWords: sharedWords(members),
  };
}

const STOP_WORDS = new Set(
  'the and for with this that these those from into use used using when you your are not any all can has have its our their them then than also but per via about each every only such will should must may more most other some what which who how why where while out off over under until upon one two'.split(' '),
);

/** Words (3+ letters, no stop words) found in the name or description of 2+ of the skills. */
export function sharedWords(skills: Skill[]): string[] {
  const counts = new Map<string, number>();
  for (const skill of skills) {
    const words = new Set(`${skill.name} ${skill.description}`.toLowerCase().match(/\p{L}{3,}/gu)?.filter((word) => !STOP_WORDS.has(word)));
    for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([word]) => word);
}

type RawCluster = { title: string; topics: string[]; skills: string[] };

/** The JSON of the answer, maybe in a code fence or after a line of chat. */
function parseAnswer(answer: string): RawCluster[] {
  const start = answer.indexOf('{');
  const end = answer.lastIndexOf('}');
  let data: unknown;
  try {
    data = JSON.parse(answer.slice(start, end + 1));
  } catch {
    throw new AtlasError('The model did not answer with JSON');
  }
  const clusters = (data as { clusters?: unknown } | null)?.clusters;
  if (!Array.isArray(clusters)) throw new AtlasError('The model\'s answer has no "clusters" list');
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
  return clusters.map((cluster: Record<string, unknown>, index) => ({
    title: typeof cluster?.title === 'string' && cluster.title.trim() ? cluster.title.trim() : `Cluster ${index + 1}`,
    topics: strings(cluster?.topics),
    skills: strings(cluster?.skills),
  }));
}

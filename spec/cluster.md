# Skills clustering
`./skill-atlas cluster <GitHub URL | directory>`: scans like `scan` ([analysis.md](analysis.md)), then groups the skills by topic.
## How
- The skills' names and descriptions go to a model in one prompt: `claude -p`, the prompt on stdin. It answers with JSON: `{"clusters": [{"title", "topics": [...], "skills": [names]}]}`; text around the JSON (a code fence, a line of chat) is ignored.
- **Shared words** are not the model's: the words of 3+ letters, minus common English words, found in the name or description of at least two skills of the cluster; most common first, then alphabetical.
- Nothing is stored. Tests replay a recorded answer (`tests/recordings/`); they never run a model.
## Output
```
JetBrains/kotlin · 6 skills in 2 clusters
Build tooling · 4 skills
  topics: gradle, api
  skills: a, b, c, d
  shared words: gradle, plugin
```
- Clusters in the model's order; skills sorted by name; `topics` and `shared words` lines only when not empty
- A skill the model left out → the cluster *Unclustered*, with a *warning*
- An unknown skill name in the answer → ignored, a *warning*; a skill in several clusters → kept in the first, a *warning*
- Warnings (these, and the scan's) go to *stderr*
- No skills → no clusters, the model is not asked
- An answer that is not JSON or has no `clusters` list, or `claude` failing or missing → a clear message, exit code 1

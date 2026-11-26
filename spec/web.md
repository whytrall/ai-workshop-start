# Web view
`./skill-atlas web [port]` serves the result as a web page, on `http://127.0.0.1:8000/` by default.
Like the CLI, a *thin client*: each request scans **at once**; *nothing is stored*.

## Pages
- `/`: the form, at the top: a GitHub URL or a directory, as for `scan`; and a search of the skills
- `/?repo=<GitHub URL | directory>`: the form, then the result
- `/?repo=<…>&q=<text>`: the form, then only the skills that match the search
- Anything else → *404*, a page saying so

## The result
- `<owner>/<repo> · N skills`, linked to the repository; the scanned commit
- A table, sorted by **name** as in [analysis.md](analysis.md): each skill's name, linked to its file; its *full* description, or *(no description)*; `also in <paths>` for copies
- Warnings in a box under the table, as `scan` prints them to stderr
- No skills → *No skills here... yet!*
- Unreachable repository, or not a URL or a directory → the message, in an error box, status *400*
- All text is HTML-escaped

## Search
- A skill matches when its **name** or its **description** contains the text, ignoring case; the text is trimmed and taken literally, not as a pattern
- The matching skills, in the same order, numbered from 1; above them, `M of N skills match "<text>"` and a link to show all
- Every match in a name or a description is highlighted, in a `<mark>`
- No skill matches → *No skills match "<text>"*; the warnings are still shown
- An empty search shows every skill; a search without `repo` is the home page
- The field keeps the text searched for

## The look
A homepage from the early 2000s: starfield background, tables for layout, WordArt title, a marquee, *Under construction*, a blinking warning, a webring, *Best viewed in Netscape Navigator*.
The counter in the footer counts the skills on the page, the matching ones when searching — there are no visits to count.
Everything is embedded: the page loads nothing else, and has no scripts.

## Server
- Local only: it listens on `127.0.0.1`, since it can read this machine's directories
- Port `0` takes any free port; the printed URL has the real one
- A port in use → a clear message, exit code 1

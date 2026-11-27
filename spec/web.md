# Web view
`./skill-atlas web [port]` serves the result as a web page, on `http://127.0.0.1:8000/` by default.
Like the CLI, a *thin client*: each request scans **at once**; *nothing is stored*.

## Pages
- `/`: the form, at the top: a GitHub URL or a directory, as for `scan`; and a search of the skills
- `/?repo=<GitHub URL | directory>`: the form, then the result
- `/org`: the organization form, one field — a GitHub organization's name, or its `https://github.com/<org>` URL
- `/org?org=<organization>`: the organization page ([below](#the-organization-page))
- `/?repo=<…>&q=<text>`: the form, then only the skills that match the search
- Anything else → *404*, a page saying so

## The result
- `<owner>/<repo> · N skills`, linked to the repository; the scanned commit
- A table, sorted by **name** as in [analysis.md](analysis.md): each skill's name, linked to its file; its *full* description, or *(no description)*; `also in <paths>` for copies
- Warnings in a box under the table, as `scan` prints them to stderr
- No skills → *No skills here... yet!*
- Unreachable repository, or not a URL or a directory → the message, in an error box, status *400*
- All text is HTML-escaped

## The organization page
- `<org> · N repositories`, linked to the organization; then every repository it lists, by name, each linked to its own result (`/?repo=<its URL>`)
- At the top, a **progress bar**: `<done> of <N> scanned (<percent>%)`, then `- done!`
- **All scans happen in parallel**, each as `scan` scans one repository; one repository's failure does not stop the others
- Near each repository, *scanning...* with a spinner, then **OK!** with its skills (and warnings) counted, or **FAILED** with the message
- When every scan is done: `Done! N repositories scanned: X OK, Y failed · Z skills`, and the failures in full in a box; the counter counts all the skills found
- No repositories → *No repositories here... yet!*
- Not an organization's name, or no such organization → the message, in an error box, status *400*
- Still no scripts: the page is sent **as the scans finish**, on one response. The list comes first; each finished scan then adds a style that moves the bar and turns its repository's indicator. Nothing is stored. Text in those styles is CSS-escaped.
- Once the page is closed, nothing more is asked of GitHub

### GitHub's rate limits
All organization scans of one server share one limiter, since GitHub's limits are the same for all of them:
- At most *8* requests in flight at once
- A budget per rate-limit resource (`core`, `search`, `code_search`), from GitHub's `x-ratelimit-*` headers; parallel scans spend it together, never beyond it
- A spent budget whose reset is *at most 65 s* away (code search: 10 a minute with `GITHUB_TOKEN`), or `retry-after`, or a *secondary rate limit* (a minute) → the requests wait, then go on; a request is retried at most twice
- A spent budget whose reset is further away (without a token: 60 an hour) → the requests are *not sent*, and their repositories fail with `GitHub rate limit reached; not sent, try again at <time> (GITHUB_TOKEN raises the limit)`## Search
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
- Only `GET` and `HEAD`; any other method → *405*, with `Allow: GET, HEAD`
- `HEAD` → the page's status and headers, **without scanning**: there is no body to serve, so nothing is read and nothing is asked of GitHub. *200* for `/` and `/org`, whatever they are asked to scan; *404* for anything else
- A port in use → a clear message, exit code 1

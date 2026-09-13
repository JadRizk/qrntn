# Serving the viewer

> **A plan, dated 2026-09-13, built the same day.** Like
> [`READING.md`](READING.md), this is a decision made before the work, with
> the facts it rests on measured and cited beside it so a reader can disagree
> with the evidence rather than with the conclusion. The *Decided* and *Still
> open* sections below were edited as the work landed and now record what was
> built. Where it and the code disagree, the code is right and this is a
> defect.

`qrntn view` today picks a new port every run, prints an address nobody can
remember, and leaves the reader to copy it into a browser. This decides four
things about how the viewer is reached: a fixed port, a `localhost` URL, a
browser opened on start, and — because the first of those makes it necessary —
a check on the `Host` header. It also decides one thing the viewer will *not*
be: a daemon, and says why.

## What `view` does today

Measured on `main` at `b216aab`, before this work; the line numbers are that tree's.

| Fact | Where |
|---|---|
| Port is `0` — the system picks — unless `--port <n>` | `commands/view.mjs:162–173` |
| Bound to `127.0.0.1`; the printed URL is `http://127.0.0.1:<n>/` | `view.mjs:349–350` |
| No browser is opened. *"The URL is printed; opening it is the reader's act"* | `view.mjs:20–21`, and the same sentence in `CHANGELOG.md:66` |
| A busy port is refused with exit 2 and *"pick another with --port, or none to let the system choose"* | `view.mjs:330–338` |
| The graph is exported once at start into a temp dir and served as a snapshot; *"re-run to re-export"* | `view.mjs:188–242`, `view.mjs:359` |
| The server never reads the `Host` header. It checks method, normalises the path, and answers | `view.mjs:250–326` |
| Every response carries `Cache-Control: no-store`, `nosniff`, `no-referrer`; HTML carries the CSP. There is no `Server` header, so nothing identifies the process from outside | `view.mjs:279–290` |
| The suite spawns `view` with piped stdio, waits on the last printed line, and eight of its runs pass `--port` — the rest rely on the system picking | `view.test.mjs:300–340` |
| `mutate.mjs` runs every mutant against the whole suite **in parallel** | `mutate.mjs:66` |
| The self-test names the `LOCAL, ONLY` comment as a mutant site, verbatim | `view.self-test.mjs:139` |
| The reading room (this branch) puts the full text of every held skill into `graph.json` | `READING.md` §"How the bytes reach the browser" |

The last row is what turns a convenience question into a threat-model one.
Before this branch, a page that could read `/data/graph.json` learned names and
edges. After it, it learns every byte of every skill in the library.

## What the field does

Not from memory. Each row is what the tool's own documentation or advisory
says, checked 2026-09-13.

| Tool | Default port | Port busy | Browser | Host check |
|---|---|---|---|---|
| Vite | `5173` — moved off `3000` *"to avoid conflicts with Express, Rails, Next.js"* | tries the next port; `strictPort: true` to refuse instead | `server.open`; honours `BROWSER` and `BROWSER_ARGS`; uses the `open` package | **Yes, since 6.0.9 (Jan 2025)** — `server.allowedHosts`; `localhost`, `*.localhost` and IP literals always allowed; blocked hosts get **403**; skipped under HTTPS |
| Next.js | `3000` | tries the next port | opens nothing | **Yes, since 15.2.3** — `allowedDevOrigins`; unlisted origins get **403**, having previously only warned |
| Jupyter | `8888` | tries the next port | opens by default; `--no-browser` | token in the URL, plus a host check |
| Create React App / Netlify CLI / Expo | — | — | opens by default; `BROWSER=none` disables, `BROWSER=<name>` picks | — |
| `cargo doc` | — | — | only with `--open` | — |
| Chrome 142+ (Oct 2025) | — | — | — | a **public → loopback** fetch now prompts for *Local Network Access*; loopback → loopback is unaffected |

Two things follow.

**The Host check is no longer optional.** The attack Vite's advisory
(GHSA-vg6x-rcgg-rjx6, CVE-2025-24010) describes is exactly the one a fixed
port invites: a page on `evil.example` whose DNS flips to `127.0.0.1` after
the browser has loaded it; its `fetch('http://evil.example:<port>/data/graph.json')`
is same-origin as far as the browser is concerned, and the response is
readable. Neither the CSP nor CORS defends against it — the CSP governs what
*our* page loads, and there is no cross-origin request for CORS to refuse. The
random port today is a partial defence by obscurity; the fixed port removes it.
Chrome's Local Network Access prompt is a second, browser-specific line, not a
replacement: Firefox and Safari have nothing equivalent, and a user can click
*allow*. Vite and Next both landed the same fix within two months of each other
and both chose 403. That is the convention now.

**Opening the browser is the convention, gated three ways.** By default, off
by flag, off by `BROWSER=none`. Nothing in the field opens a browser when its
output is being piped, and nothing here should either.

## Decided

**1. A fixed default port.** `--port` keeps its meaning; `--port 0` becomes the
way to say *let the system choose*. The number is the one open choice below.
The rule for choosing it: unassigned at IANA, not a known default of any
common dev server (`3000`, `4000`, `4173`, `4200`, `4321`, `4983`, `5000`,
`5173`, `5555`, `6006`, `8000`, `8080`, `8081`, `8888`, `9000`, `9323`), not on
Chrome's restricted-port list, and not `5000` or `7000`, which macOS's AirPlay
receiver holds.

**2. A busy port is refused, as today — but the refusal knows whether the
squatter is us.** On `EADDRINUSE`, one `HEAD /` to `127.0.0.1:<port>`. If the
answer carries `Server: qrntn-view/<version>`, the message is *"another
`qrntn view` is already serving on <port> — <url> · stop it there and re-run to
re-export, or `--port 0` for a second"*. If not, the message is today's. Exit
stays 2 in both cases: this process exported nothing and served nothing, and
the one already running may be serving a graph older than the tree. Vite's
*try the next port* is the wrong model here — a viewer whose URL moves when you
already have it open in another tab is the problem this plan exists to fix.

**3. The `Host` header is checked.** Before the path is looked at: a request
whose `Host` is not `localhost:<port>`, `127.0.0.1:<port>` or `[::1]:<port>`
(each with the bound port, or none) is answered **403** with a one-line body
naming the rule. A request with no `Host` at all is 400. The check lives in
`handle()` beside the method check, gets its own mutant in the self-test, and
its own row in `THREATS.md`. This lands **first**, on its own, because it is
correct even if nothing else in this plan ships.

**4. The printed URL says `localhost`.** `http://localhost:<port>/` in the
human output; the JSON line keeps `url` as the address actually bound and
gains nothing. The server still binds `127.0.0.1` only: browsers resolve
`localhost` to both loopbacks and try both, so nothing changes for them; a
client that resolves it to `::1` alone is the one case that breaks, and the
JSON line is there for clients. No custom hostname. `qrntn.localhost` works in
Chrome and Firefox, which resolve `*.localhost` internally, and not reliably in
Safari or from a shell; an `/etc/hosts` entry is the tool editing system
configuration with `sudo`, which it will not do. The port is the alias.

**5. The browser is opened on start.** Unless any of: `--no-open`; `--json`;
`BROWSER=none`; stdout is not a TTY *and* `BROWSER` is unset — an explicit
`BROWSER` is an instruction, and a test's recorder is one. The opener is the
platform's own —
`open` on darwin, `xdg-open` on linux (falling back to `wslview` and then
`cmd.exe /c start` when `/proc/version` names Microsoft), `cmd /c start "" <url>`
on win32 — spawned detached with `stdio: 'ignore'` and `unref()`, so Ctrl-C
on `view` never reaches the browser and the browser's output never blocks the
server. `BROWSER=<command>` runs that command with the URL instead, which is
the CRA/Vite convention and, as it happens, the way to test this without a
browser. A failure to open is a dim line under the URL, never an exit: the URL
is still printed, and the reader can still act. The comment at `view.mjs:20`
and the sentence at `CHANGELOG.md:66` are rewritten, and the self-test mutant
at `view.self-test.mjs:139` moves with them.

**6. Not a daemon.** Neither a detached process with a pidfile nor a launchd /
systemd registration.

- The graph is a snapshot exported at start. A long-lived server serves the
  library as it was when the server began; the reading room shows *the exact
  bytes a decision was recorded against, each marked as matching its ledger
  hash* — a stale daemon quietly doing that against a tree that has since
  changed is the failure `THREATS.md` is built to prevent. Making it honest
  means a file watcher, invalidation and re-export, which is a different
  program.
- A permanent loopback server holding every skill's text is a standing target;
  the one-shot server is a target only while a reader is reading.
- `SURFACE.md` holds `view` to *plain Node, zero dependencies, no system
  config*. Service registration is platform-specific config with an
  uninstall path to maintain.

What removes the friction is 1 + 2: the URL never changes, and running
`qrntn view` again is either a re-export or a pointer to the one already up.
If the remaining pain is *I have to keep a terminal open*, `--detach` with a
pidfile is the smallest next step, and it is not in this plan.

## Settled as built

Open when the plan was written; each took the recommendation.

| Question | Answer |
|---|---|
| The port number | `7768` — `q r n t` on a telephone keypad; inside IANA's unassigned block `7748–7776` (registry checked 2026-09-13); on nobody's default list |
| 403 or 421 for a bad `Host` | **403.** 421 *Misdirected Request* is the exact status, but Vite and Next chose 403, browsers and proxies treat it plainly, and matching the field is worth more than the semantics |
| Should a collision with another `qrntn view` open the browser to it | **No.** It may be serving a stale graph; say so and stop. The reader can click the URL |
| `Server` header or a private `X-Qrntn-View` | **`Server`.** It is the header for this; the value `qrntn-view/<version>` is one string, read from `package.json` beside `commands/`, and the bare name when the file is deployed alone |
| Bind `::1` as well | **Not now.** A second `createServer` for one edge case; revisit if a real client hits it |

Two things the plan did not foresee, found by the self-test:

- `--json` never reaches the opener at all — its branch prints and returns
  first — so a `!JSON_OUT` term in the opener's gate was dead code the
  mutation harness could not kill. The term went; the mutant now removes the
  `return`, and the suite catches that.
- *"`BROWSER=none` leaves the browser alone"* is not the same assertion as
  *"a browser called `none` was never attempted"*: the second fails to start
  and prints the could-not-open line, and the recorder sees nothing either
  way. The suite now asserts the line is absent too.

## What changes, file by file

| File | Change |
|---|---|
| `commands/view.mjs` | default port constant; `--port 0` semantics; `--no-open` flag in `FLAGS`; Host check in `handle()`; `Server` header in `send()`; probe on `EADDRINUSE`; `openBrowser(url)`; `localhost` in the printed URL; the header comment |
| `commands/view.test.mjs` | **every** `serve()` and `runSync()` that listens passes `--port 0` — the parallel mutation run (`mutate.mjs:66`) would otherwise have suites fighting over the default. One test asserts the default from `--help` and the JSON `port`, run alone. New: `Host` allowed × 3, refused × 2 (`evil.example:<port>`, `127.0.0.1:<other-port>`), absent → 400; `Server` header present; collision with a running `qrntn view` names the URL; `BROWSER=<script that records argv>` receives exactly the URL; `BROWSER=none`, `--no-open`, `--json` each receive nothing. The suite itself sets `BROWSER=none` in the spawn env as belt and braces; piped stdio is the belt |
| `commands/view.self-test.mjs` | mutants: remove the Host check (suite must notice); allow any host; drop the `Server` header; open regardless of `--json`; the moved comment at `:139` |
| `docs/THREATS.md:82` | the `view` row: Host check, the rebinding it stops, the opener and what it is handed (a loopback URL, nothing else) |
| `docs/SURFACE.md:51` | `view` opens a browser via the platform opener; still zero dependencies |
| `docs/DEVELOPING.md` | one line: suites that serve pass `--port 0`, and why |
| `README.md:20`, `:66` | the URL is fixed and the browser opens |
| `CHANGELOG.md` | under the next version: the four decisions and the one refusal, with the CVE named |
| `docs/SERVING.md` | this file |

Also touched, found in the sweep: `smoke.mjs` and `commands/qrntn.test.mjs`
each start `view` once and now pass `--port 0`.

Not touched: `nexus/` (the viewer's build is unchanged), `.claude/launch.json`
(`vite dev` is a different server with its own `allowedHosts` default),
`bin/qrntn.mjs` (exit codes keep their meanings).

## Order

1. **Host check** + `Server` header, tests, self-test mutants, `THREATS.md`
   row. Ships alone.
2. **Fixed port** + `--port 0` + collision probe, tests (with the `--port 0`
   sweep of the existing suite).
3. **`localhost` URL.** Trivial once 1 allows it.
4. **Open the browser**, gated, tests via `BROWSER=<script>`.
5. Docs and changelog.

Each step is a commit the suite passes on its own; 1 is the one that is a
security fix and gets the `🐛`. As built, 1 and 2–4 are two commits: the check
alone, then the rest, because the port and the opener share one usage text
and one set of mutants.

## Related

- [`READING.md`](READING.md) — what the served bytes now contain
- [`THREATS.md`](THREATS.md) — the `view` row this amends
- [`SURFACE.md`](SURFACE.md) — why `view` is plain Node and stays so
- Vite advisory GHSA-vg6x-rcgg-rjx6 / CVE-2025-24010 and the fix commit
  `bd896fb` — the attack, and the field's answer to it
- Next.js `allowedDevOrigins` — the same answer, two months later
- Chrome *Local Network Access* (142, October 2025) — the browser-side line

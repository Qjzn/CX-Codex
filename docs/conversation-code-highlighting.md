# Conversation code highlighting

The shared rich-text surface uses highlight.js 11.12.0 (BSD-3-Clause) solely for code coloring. It replaces the need to maintain an ad-hoc syntax tokenizer; it does not replace Markdown parsing, sanitization, message state or the transcript projection. Its license ships in `dist/third-party-notices/highlight.js.txt`.

- Core plus 11 explicit grammars: JavaScript, TypeScript, JSON, Bash, PowerShell, Python, XML/HTML, CSS, SQL, diff and YAML. Aliases are normalized; unknown or unlabeled fences remain plain text. No automatic language detection, CDN, WASM or server process.
- One lazy Worker; one active job, at most 64 pending jobs, maximum 20,000 characters per job. Superseded pending jobs are canceled. A 3-second Worker load/computation deadline disables enhancement for the current page on failure; an idle Worker terminates after 10 seconds. Active cancellation discards the result but lets that bounded computation finish.
- Text appears before coloring. Only span/class markup survives sanitization, and the final text must equal the source exactly. Applying a result requires a live, still-current node and no active selection inside it. Copying always uses the Markdown token's raw code.
- Main thread imports only the small language map and scheduler; the syntax engine and grammar payload must remain in a separate Worker asset. Build evidence records its compressed size. No message text is persisted or retained in a cross-thread highlight cache.

Removal path: remove the post-render highlighting watch/client/Worker/engine and color rules; remove the dependency and notice. The existing sanitized plain-code renderer and copy contract remain functional. No data migration or state-machine change is needed.

Reference API: [highlight.js core](https://highlightjs.readthedocs.io/en/latest/api.html). Installed Codex 26.901.6511.0 was inspected read-only: its shared code snippet also displays raw code first and dynamically enhances it, with bounded update scheduling. CX owns its implementation and does not copy that private bundle.

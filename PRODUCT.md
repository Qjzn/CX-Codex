# Product

## Register

product

## Users

CX-Codex serves developers and power users who already run OpenAI Codex locally and want a stable browser, mobile, Android, LAN, or remote self-hosted entrypoint. They usually work from Windows, Windows Server, Android, or a folded/tablet viewport and need to keep long coding-agent sessions readable and recoverable.

## Product Purpose

The product turns local Codex into a durable web and mobile workbench without replacing the native Codex runtime. Success means users can scan projects and threads quickly, understand what Codex is doing, inspect returned outputs safely, and resume work from desktop or mobile without losing context.

## Brand Personality

Compact, practical, trustworthy. The interface should feel close to a serious developer tool: quiet, dense enough for repeated use, Chinese-first, and clear about runtime state.

## Anti-references

Do not make the product feel like a marketing page, generic SaaS dashboard, decorative AI chat clone, or heavy glass/gradient interface. Avoid hiding important agent state behind vague Markdown blobs, but also avoid dumping raw JSON as the primary reading experience.

## Design Principles

- Prefer Codex desktop parity when behavior or presentation exists there.
- Make long-running agent state visible through structured status, tool, command, file, code, diff, and raw-payload affordances.
- Keep the sidebar scannable: title first, then useful preview and state, with stable row height and no jitter.
- Preserve mobile and foldable ergonomics before adding visual density.
- Treat security and local-path handling as product UX, not implementation detail.

## Accessibility & Inclusion

Default to readable contrast, keyboard-operable controls, reduced visual noise, and stable layouts. Motion should communicate state, not decoration. Important output should remain available as selectable text and not require color alone to understand status.

# Domain Docs

How engineering skills should consume this repository's domain documentation when exploring the codebase.

## Before Exploring, Read These

- `CONTEXT.md` at the repository root, or
- `CONTEXT-MAP.md` at the repository root if it exists: it points at one `CONTEXT.md` per context.
- `docs/adr/`: read ADRs that touch the area being changed. In multi-context repositories, also check `src/<context>/docs/adr/` for context-scoped decisions.

If any of these files do not exist, proceed silently. The `/domain-modeling` skill creates them lazily when terms or decisions are resolved.

## File Structure

This is a single-context repository:

```text
/
├── CONTEXT.md
├── docs/adr/
└── src/
```

## Use the Glossary's Vocabulary

When output names a domain concept, use the term defined in `CONTEXT.md`. Do not drift to synonyms the glossary explicitly avoids.

If a needed concept is absent from the glossary, reconsider the term or note the gap for `/domain-modeling`.

## Flag ADR Conflicts

If output contradicts an existing ADR, surface it explicitly rather than silently overriding it.

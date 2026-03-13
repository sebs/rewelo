# ADR-001: Zen of TypeScript

## Status

Accepted

## Context

We need a shared set of guiding principles for how we write TypeScript in this project. Rather than an exhaustive style guide, we adopt a philosophical baseline that steers design decisions, code reviews, and trade-offs.

## Decision

We adopt the following as our north star, adapted from the Zen of Python for TypeScript:

```
Beautiful is better than ugly.
Explicit is better than implicit.
Simple is better than complex.
Complex is better than complicated.
Flat is better than nested.
Sparse is better than dense.
Readability counts.
Special cases aren't special enough to break the rules.
Although practicality beats purity.
Errors should never pass silently.
Unless explicitly silenced.
In the face of ambiguity, refuse the temptation to guess.
There should be one-- and preferably only one --obvious way to do it.
Now is better than never.
Although never is often better than *right* now.
If the implementation is hard to explain, it's a bad idea.
If the implementation is easy to explain, it may be a good idea.
Namespaces are one honking great idea -- let's do more of those!
```

### What this means for TypeScript specifically

- **Explicit is better than implicit** -- use explicit return types on public functions, avoid `any`, prefer named exports over default exports.
- **Simple is better than complex** -- prefer plain functions over classes when there is no state. Avoid inheritance; use composition.
- **Flat is better than nested** -- use early returns to reduce nesting. Prefer `Promise` chains or `async/await` over nested callbacks.
- **Errors should never pass silently** -- never swallow exceptions with empty `catch` blocks. Type errors narrowly. Use `Result` patterns where appropriate.
- **Unless explicitly silenced** -- if you must ignore an error, leave a comment explaining why.
- **Readability counts** -- optimise for the reader, not the writer. Code is read far more often than it is written.
- **Namespaces are one honking great idea** -- use modules, schemas, and scoped packages to organise code. Avoid dumping everything into a single flat namespace.

## Consequences

- All code reviews measure against these principles.
- When two approaches are equivalent in correctness, we pick the one that better aligns with these tenets.
- We accept that practicality beats purity -- pragmatic trade-offs are welcome when documented.

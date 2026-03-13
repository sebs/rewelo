# ADR-002: Test Pyramid

## Status

Accepted

## Context

We need a testing strategy that gives us fast feedback, high confidence, and maintainable tests. The classic test pyramid provides a proven model for balancing these concerns.

## Decision

We follow the test pyramid. Unit tests form the foundation; integration and end-to-end tests are used sparingly and only where unit tests cannot provide sufficient coverage.

```
        /  E2E  \          few, slow, fragile
       /----------\
      / Integration \      some, moderate speed
     /----------------\
    /    Unit Tests     \  many, fast, stable
   /____________________\
```

### Guidelines

1. **Maximise unit tests** -- the vast majority of tests should be unit tests. They are fast, isolated, and cheap to write and maintain.
2. **Push logic down** -- design code so that business logic lives in pure functions that are trivial to unit test. Keep I/O at the edges.
3. **Integration tests for boundaries** -- use integration tests only for verifying that components work together correctly (e.g. DuckDB queries against a real database).
4. **E2E tests as smoke tests** -- a small number of end-to-end tests to verify critical user-facing flows. These are not the primary safety net.
5. **No mocks when avoidable** -- prefer dependency injection of real (lightweight) implementations over mocking. When mocks are necessary, mock at the boundary, not deep in the call stack.

## Consequences

- New features should ship with unit tests covering the core logic.
- Slow or flaky tests are treated as bugs.
- Test count distribution should roughly follow the pyramid shape: many unit, some integration, few E2E.

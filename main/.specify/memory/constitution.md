<!--
Sync Impact Report
Version change: unversioned template -> 1.0.0 (initial adoption)
Modified principles:
- Principle 1 -> I. Clear, Consistent Code
- Principle 2 -> II. Simplicity and Explicit Design
- Principle 3 -> III. Tests Define Behavior
- Principle 4 -> IV. Risk-Based Test Coverage
- Principle 5 -> V. Maintainable Change
Added sections: Additional Constraints; Development Workflow
Removed sections: None
Follow-up TODO: Confirm the original ratification date.
-->
# quickanswer Constitution

## Core Principles

### I. Clear, Consistent Code
Code MUST use descriptive names, consistent formatting, and the conventions established by
the surrounding project. Functions and modules MUST have focused responsibilities; duplicated
logic MUST be consolidated when doing so clarifies behavior without creating a less clear
abstraction. Rationale: readable code reduces review effort and prevents avoidable defects.

### II. Simplicity and Explicit Design
Implementations MUST use the simplest design that satisfies verified requirements. New
dependencies, indirection, configuration options, and abstractions MUST have a concrete present
use case; speculative extensibility is not sufficient justification. Non-obvious decisions and
constraints MUST be documented where maintainers will encounter them. Rationale: unnecessary
complexity increases the cost and risk of every later change.

### III. Tests Define Behavior
New or changed behavior MUST have automated tests at the narrowest practical level. Bug fixes
MUST include a regression test that fails before the fix when feasible. Tests MUST assert
observable outcomes rather than implementation details, and MUST be repeatable without reliance
on uncontrolled external state. Rationale: executable expectations make behavior safer to
change and easier to understand.

### IV. Risk-Based Test Coverage
Tests MUST cover relevant success paths, boundary conditions, and failure handling. Changes at
module, service, or external-system boundaries MUST include integration or contract coverage;
critical user workflows MUST have end-to-end coverage where the project supports it. Tests
SHOULD avoid mocking the behavior or contract they are intended to verify. Rationale: matching
test scope to change risk catches defects that isolated unit tests cannot.

### V. Maintainable Change
Changes MUST remain localized to the responsibility being modified and preserve existing public
contracts unless a breaking change is explicitly required and documented. Related tests and
documentation MUST be updated with behavior or interface changes. Before adding a shared helper
or changing a public interface, contributors MUST check existing usage and explain any migration
impact in the change description. Rationale: explicit, bounded changes make future maintenance
and review safer.

## Additional Constraints

The project does not mandate a language, framework, or testing library through this constitution.
Contributors MUST follow the repository's existing toolchain and conventions. Dependencies MUST
be added only for a documented need, and externally visible errors or invalid inputs MUST be
handled deliberately rather than silently ignored.

## Development Workflow

Every change MUST receive review for correctness, clarity, scope, and alignment with these
principles. Before a change is considered complete, contributors MUST run the relevant automated
tests and any repository-provided formatting, lint, or type-check commands. Failures MUST be
fixed or explicitly reported with their impact; tests MUST NOT be weakened or removed merely to
make a check pass. Reviewers MUST request missing behavioral tests or justification for material
complexity before approval.

## Governance

This constitution governs project development practices. Amendments MUST be made through a
reviewable change that records the reason, affected principles, and migration impact where
applicable. Changes that remove or materially redefine a principle require a MAJOR version bump;
new principles or materially expanded requirements require a MINOR bump; clarifications that do
not change obligations require a PATCH bump. All changes and reviews MUST check compliance with
this constitution. When a principle conflicts with a repository-specific constraint, the change
MUST document the conflict and resolve it through an approved amendment or an explicit exception
in the change review.

**Version**: 1.0.0 | **Ratified**: TODO(RATIFICATION_DATE): Original adoption date unknown | **Last Amended**: 2026-11-03

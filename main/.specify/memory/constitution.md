<!--
Sync Impact Report
Version change: 1.0.0 -> 1.1.0
Modified principles: None
Added principles: VI. Design-First with PlantUML
Added sections: None
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

### VI. Design-First with PlantUML
圖表 MUST 作為 AI 規劃與開發者檢視設計的視覺化依據：

- 規格制定階段（`speckit.specify`）：MUST 使用 PlantUML 語法建立組件圖
	（Component Diagram）、類別圖（Class Diagram）及時序圖（Sequence Diagram），
	並將 `.puml` 檔案儲存在 `./diagrams/`。
- 產物生成：建立檔案後，MUST 使用 PlantUML CLI（例如
	`java -jar plantuml.jar "./diagrams/*.puml"`）將所有 `.puml` 轉換為 PNG，
	並將圖片儲存在同一目錄。
- 規劃階段（`speckit.plan`）：MUST 以這些圖表作為產生應用程式架構與組件的主要藍圖。
- 實作階段（`speckit.implement`）：程式碼生成完成後，MUST 執行驗證，確保最終
	程式碼與圖表完全一致。

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

**Version**: 1.1.0 | **Ratified**: TODO(RATIFICATION_DATE): Original adoption date unknown | **Last Amended**: 2026-11-13

# Launch Rescue

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Confirmed: a presenter demonstrating GitHub Copilot agentic and dynamic workflows to 2,500 attendees.

Assumption for this delivery: a mixed developer and engineering-lead audience, a 25-minute session, a large projected display, and an approximately eight-minute interactive demo.

## Product Purpose

Make Dynamic Workflow orchestration and Agentic Workflow reasoning unmistakably different in the demo itself, with paced feature stops, relevant code, actual inputs and outputs, and a separate human decision.

## Positioning

A synthetic conference ticket launch fails in different ways. Executable checks reveal evidence, the workflow conditionally adds specialists, and an independent check gates a local release candidate.

## Operating Context

The project is a Windows-hosted Git repository with a public source distribution. Node.js and GitHub Copilot CLI 1.0.94-3 are installed. The pinned SDK 1.0.19 supplies a version-matched 1.0.95 runtime for the tested stage launcher. The demo must remain local, portable, resettable, and useful without a network connection.

## Capabilities and Constraints

- The offline rehearsal performs real computations on synthetic data. Its workers are ordinary JavaScript functions, not language-model agents.
- The native extension uses Copilot's documented experimental dynamic-workflow API. Its live mode uses actual workflow-owned agents, subject to authentication, plan eligibility, permissions, model availability, and usage charges.
- Use GPT-6.1 Sol with max reasoning for analysis, and Claude Sonnet 5.5 with high reasoning for independent review, as explicitly requested.
- All repairs are bounded choices evaluated by deterministic checks. Never execute generated code.
- Never deploy, send messages, create remote issues or pull requests, or access production systems.
- A local approval checkpoint demonstrates a human decision; it is not a security sandbox.
- Preserve the distinction between Copilot dynamic workflows and the separate GitHub Agentic Workflows project.
- Describe public-preview functionality and approximate AI-credit limits accurately.
- The guided feature walkthrough is enabled by default in the standalone demo. Teaching continuation must never count as final draft approval.

## Evidence on Hand

Official GitHub documentation and official SDK source were retrieved on 2026-10-10. Twenty primary sources are recorded in `sources\research.json`. Actual native model and checkpoint evidence is stored under `evidence\`. The 2,500-attendee scenario and all operational data are synthetic; no customer claims or performance benchmarks are implied.

## Product Principles

1. Show evidence rather than theatrical success messages.
2. Let the selected failure change the execution graph.
3. Make failure and uncertainty visible.
4. Separate repeatable orchestration from variable model judgment.
5. Give the presenter a dependable fallback without misrepresenting it as AI.

## Accessibility & Inclusion

Assumptions for the large-room use case: readable projected text, keyboard-operated controls, visible focus, reduced-motion support, meaningful non-color status labels, and layouts that remain usable on a narrow screen.

---
name: Launch Rescue
description: Evidence-driven workflow execution for a large-room demonstration.
colors:
  light-background: "#f7f4ef"
  light-surface: "#ffffff"
  light-text: "#242424"
  light-accent: "#b11f4b"
  dark-background: "#3d3b3a"
  dark-surface: "#292929"
  dark-text: "#dedede"
  dark-secondary-text: "#b0b0b0"
  dark-accent: "#fd8ea1"
  dark-accent-foreground: "#1a1a1a"
  dark-success: "#4ade80"
  dark-danger: "#f87171"
typography:
  display:
    fontFamily: '"Segoe UI", Aptos, Calibri, sans-serif'
    fontSize: "clamp(40px, 4.5vw, 78px)"
    fontWeight: 750
    lineHeight: 1.04
    letterSpacing: "-0.035em"
  body:
    fontFamily: '"Segoe UI", Aptos, Calibri, sans-serif'
    fontSize: "16px"
    lineHeight: 1.5
  code:
    fontFamily: 'Consolas, "Courier New", Courier, monospace'
  caption-small:
    fontSize: "12px"
  caption:
    fontSize: "13px"
  utility:
    fontSize: "14px"
  secondary:
    fontSize: "15px"
  control:
    fontSize: "17px"
  stage-label:
    fontSize: "18px"
  action:
    fontSize: "19px"
  narrative:
    fontSize: "20px"
  callout:
    fontSize: "21px"
  graph-title:
    fontSize: "22px"
  section:
    fontSize: "23px"
  brand:
    fontSize: "24px"
  compact-count:
    fontSize: "32px"
  count:
    fontSize: "38px"
  compact-display:
    fontSize: "42px"
  stage-display:
    fontSize: "54px"
rounded:
  legend: "2px"
  status: "5px"
  control: "10px"
  panel: "16px"
spacing:
  compact: "8px"
  standard: "16px"
  section: "24px"
components:
  dark-primary-button:
    backgroundColor: "{colors.dark-accent}"
    textColor: "{colors.dark-accent-foreground}"
    rounded: "{rounded.control}"
    padding: "10px 18px"
---

# Design system: Launch Rescue

## Overview

**Creative north star: “The execution trace.”**

The actual process is the visual centerpiece. Code, specialist work, checks, and a human gate occupy causal lanes. A new evidence branch appears only when execution requires it. The identity is Clawpilot charcoal and warm paper with one rose accent, not a generic dashboard of agent avatars.

This record describes the shipped implementation. Design documentation was recorded by the lead from the final CSS and graph code; independent Sonnet visual review covered the rendered deck and demo.

## Colors

Use the exact `--cp-*` theme variables in `demo\index.html` for every component color. Charcoal supports the projected stage view; warm paper supports the light reading view. Rose marks active routes and primary actions. Success and failure remain explicit words as well as colored outlines.

Do not add a second brand accent, glowing edges, or gradients. Do not use status colors as the only status signal.

## Typography

Segoe UI is the browser workhorse, with Aptos and Calibri fallbacks. Consolas is for source, IDs, commands, and quantities—not decorative technical copy. The PowerPoint uses Aptos Display, Aptos, and Consolas.

The regular display heading ranges from 40 to 78 pixels; stage mode prioritizes the trace and controls instead of the large introduction. Graph titles and acceptance labels use distinct sizes and weights. Secondary body copy uses the stronger secondary-text token in dark mode.

The recorded ramp includes the shipped 12–24-pixel caption, control, graph, and section roles plus 32/38-pixel counts and 42/54-pixel compact display roles. Small utility copy belongs to secondary controls and non-stage details, not the projected decision hierarchy. These are observed values, not additional visual changes or waived defects.

## Layout

Two definitions anchor the page: Dynamic Workflow orchestration and Agentic Workflow reasoning. A feature-proof panel sits beside the desktop trace and exposes the selected feature, benefit, code excerpt, input, output, and prompt. The trace has six causal columns; the adaptive branch occupies a third row.

At narrower widths, the proof stacks below the trace and the graph scrolls within its own accessible region. Stage mode keeps the teaching continuation visible within 1920×1080 and focuses on the proof during a guided stop. Measured outcomes return for the separate final human review; longer proof content can scroll inside its keyboard-focusable region.

## Elevation & Depth

The system is flat. Tonal surfaces and fine borders create structure; no glass or decorative shadows are needed. A route wire encodes a real dependency rather than decoration.

## Shapes

Controls and graph nodes use approximately 10-pixel rounding. Larger graph and review regions use 16-pixel rounding. Status badges are compact rectangles with an explicit label.

## Components

Scenario controls show the selected input and lock while a run is active, paused, or at approval. Native mode is a read-only observer. Primary actions use rose; disabled actions use normal disabled affordances and unambiguous wording.

Graph nodes are keyboard-inspectable, with explicit kind and status. The inspector displays the model/worker distinction and repair evidence provenance. The approval gate treats offline browser approval and native terminal review as separate controls.

A plain-language summary explains the cause and next step. Guided stops pause execution, not just its animation. The proof distinguishes actual model responses from JavaScript substitutes and native prompt previews. **Continue walkthrough** and native **NEXT** never approve a draft. The separate final approval remains explicit.

## Do's and Don'ts

- Keep the graph driven by execution events.
- Show baseline and current measurements without claiming performance benchmarks.
- Keep completed native runs visibly labeled as completed.
- Preserve the code / worker / agent / gate distinctions.
- Keep all theme behavior local and use the canonical theme tokens.
- Never turn the offline workers into fake Copilot agents.

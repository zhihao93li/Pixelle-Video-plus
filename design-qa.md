# High-fidelity generation demo QA

## Scope

- Reference: `apps/production-template-demo/public/demo/selected-split-canvas-reference.png`
- Implementation: `apps/production-template-demo/src/components/HighFidelityGenerationDemo.tsx`
- Route: `http://127.0.0.1:5173/#/demo/studio`
- Desktop viewport: `1440 x 1024`
- Tablet viewport: `820 x 900`
- Mobile viewport: `390 x 844`
- Reference state: script entered, generation not started, advanced settings collapsed
- Implementation state: current project and active generation recipe loaded, sample script entered, generation not started, advanced settings collapsed

## Comparison evidence

- Full desktop implementation: `apps/production-template-demo/design-qa-artifacts/demo-desktop-final.png`
- Full desktop side-by-side: `apps/production-template-demo/design-qa-artifacts/comparison-desktop-final.png`
- Focused storyboard side-by-side: `apps/production-template-demo/design-qa-artifacts/comparison-storyboard-final.png`
- Tablet viewport: `apps/production-template-demo/design-qa-artifacts/demo-tablet-pass-1.png`
- Mobile viewport, top: `apps/production-template-demo/design-qa-artifacts/demo-mobile-pass-1.png`
- Mobile viewport, preview: `apps/production-template-demo/design-qa-artifacts/demo-mobile-preview-pass-1.png`

## Fidelity review

- Layout and spacing: desktop split canvas, sidebar, header, editor, storyboard, style summary, and collapsed advanced settings preserve the selected direction's hierarchy and density. Tablet stacks the storyboard below the editor without horizontal overflow. Mobile replaces the sidebar with a bottom navigation and keeps the primary action visible.
- Typography: the project Geist stack, restrained size scale, compact labels, and relaxed script line height preserve the reference hierarchy without introducing a separate demo-only type system.
- Color and surfaces: existing semantic tokens provide the off-white canvas, subtle borders, restrained teal primary state, and low-elevation surfaces. No decorative gradients, blobs, or generic dashboard card styling were introduced.
- Imagery: three generated 4:3 photographic assets match the reference subjects and are cropped consistently. No placeholders, CSS art, inline SVG illustrations, or stretched screenshots are used.
- Icons: all visible controls use the existing Lucide icon family with consistent stroke weight and alignment.
- Copy: project, recipe, turnaround, style defaults, and BGM choices come from current application data. The reference's fictional rich-text controls were intentionally replaced by the product's real paragraph/line/sentence split modes.

## Interaction and state verification

- Current project selector and recipe selector render from live local APIs.
- Script editing updates the character count and the three storyboard captions.
- Paragraph, line, and sentence split modes update the storyboard preview.
- Style sheet opens, exposes real frame template, voice, speed, and BGM inputs, and closes through Apply.
- Advanced settings expand and expose title and BGM playback mode.
- Primary CTA is enabled and is wired to the real template-task API; it was not clicked during QA to avoid creating a real generation task.
- Workbench, generation, library, and settings links point to existing application routes.
- Task progress, completion, error, and library handoff states are implemented in the component.
- Browser console errors: none.
- Browser console warnings: none.

## Accessibility and resilience

- Semantic banner, main, complementary navigation, articles, headings, radios, buttons, labels, and image alternative text are present.
- Focus-visible treatments are retained from the product component system.
- Controls remain usable at desktop, tablet, and mobile widths; measured document width equals viewport width at mobile and tablet, with no horizontal overflow.
- Sticky mobile header and bottom navigation preserve access to generation and primary navigation while scrolling.

## Findings and iteration history

- Pass 1: no P0, P1, or P2 visual or functional defects found in the combined desktop comparison.
- Focused storyboard pass: subject, crop, hierarchy, dividers, duration labels, and text density are consistent with the selected direction; no actionable mismatch found.
- Responsive pass: no overlap, clipping, broken wrapping, unusable controls, or horizontal overflow found at `820 x 900` or `390 x 844`.
- Intentional data differences from the reference are limited to real current project/recipe values and real product controls.

final result: passed

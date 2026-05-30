---
name: command-deck-design
description: Use this skill to generate well-branded interfaces and assets for Command Deck, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.
If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.
If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Quick reference
- **Product:** Command Deck — a calm, single-user weekly planning dashboard (Structured-inspired), built for a home server and read on phone / PC / iPad.
- **Type:** Fraunces (display serif) + Spline Sans (body), both on Google Fonts.
- **Palette (cool / denim-blue scheme):** slate ink `#20242e`, paper `#eef1f6`, card `#fbfcfe`, line `#dde2ec`; accent denim `#2f5d9e` (soft `#eef3fa`).
- **Categories:** Work `#2f5d9e` · Training `#5b96cf` · Home `#6f9e6a` · Social `#b07ec2` · Birthday `#d96a8a` — each used as a small dot + 12% soft block fill.
- **Feel:** soft, low, cool-tinted shadows; generous rounding (cards 22px); gentle ease motion; emoji + unicode (✓ ×) for iconography — no icon set.

## Files
- `README.md` — full product context, content fundamentals, visual foundations, iconography.
- `colors_and_type.css` — all tokens as CSS custom properties + semantic type classes.
- `preview/` — design-system specimen cards (colors, type, spacing, components, brand).
- `ui_kits/command-deck/` — interactive, high-fidelity recreation of the dashboard + reusable JSX components.

Start from `colors_and_type.css` for tokens and lift components from `ui_kits/command-deck/`.

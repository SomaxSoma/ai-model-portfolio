# 2. Design system

**This product is built on the bound Website Design System (`DesignSystem_61a5ce`).** Do not re-create its components or re-type its colour values. Load its bundle and compose.

## How to consume it

```html
<link rel="stylesheet" href="<ds>/tokens/fonts.css">
<link rel="stylesheet" href="<ds>/tokens/colors.css">
<link rel="stylesheet" href="<ds>/tokens/typography.css">
<link rel="stylesheet" href="<ds>/tokens/spacing.css">
<link rel="stylesheet" href="<ds>/tokens/base.css">
<link rel="stylesheet" href="<ds>/styles.css">
<script src="<ds>/_ds_bundle.js"></script>
```

Components come off the bundle global `window.DesignSystem_61a5ce`. In a real build, import from the package instead; the component names and props are identical.

## Components in use

| Need | Component | Notes |
|---|---|---|
| Card shells | `Card` | `tint` for the Future-Blue tint variant, `padding` for inner space |
| Actions | `Button` | `variant`: `primary` \| `ghost` \| `secondary` \| `accent`; `size`: `sm`–`xl` |
| Inline links | `TextLink` | `as="button"` for in-app actions; `variant`: `accent` \| `muted` |
| Filter / capability chips | `FilterChip` | `active` |
| Catalogue search | `SearchInput` | |
| Read-only label/value pairs | `Field` | Display device — **not** an input |
| Big numbers | `Stat` | `value` + `label` |
| Data tables | `Table` | `columns: [{key,label,align}]`, `rows: [{id, ...}]` |
| Status pills | `Badge` | `variant`: `prize` \| `topic` \| `status`, `dot` |
| Provider overlines | `TopicTag` | |
| Status messages | `Alert` | `variant`: `info` \| `success` \| `warning` \| `danger`, `onDismiss` |
| Admin section switch | `Tabs` | `tabs: [{key,label,content}]`, controlled via `active`/`onChange` |
| Two-way demo switch | `SegmentedNav` | `items`, `active`, `onChange` |
| Status dropdown | `Select` | `options` accept `{value,label}` |
| Site footer | `Footer` | `brand`, `tagline`, `columns:[{title,links:[{label,href}]}]`, `legal` |

## What the design system does NOT ship

Three things, all built locally from its tokens — everything else must come from the bundle:

1. **An application top bar.** Its sections are marketing bands. `AppNav.jsx` composes one from tokens + `Button`/`TextLink`.
2. **An editable text field.** It ships `SearchInput` and `Field` (read-only). `.pf-input` in `theme.css` is the one text control.
3. **A range slider.** `.pf-slider` in `theme.css`.

## Tokens — reference, never copy

Use the design system's own custom properties. Key ones:

```
--future-blue   --after-dark    --before-white   --blueish-grey
--pastel-indigo --turquoise     --ink-muted      --mist-grey
--background    --bg-deep       --surface        --foreground
--border        --input         --ring           --link
--muted-foreground   --on-dark-body   --on-dark-quiet
--sp-1…--sp-24  --container     --gutter         --section-y
--radius-sm/md/lg (all 0)       --radius-full (9999px)
--font-display  --font-body     --font-mono
```

**Critical rule learned the hard way:** never redefine an unprefixed design-system token in app CSS. Aliasing `--accent`, `--hairline` or `--success` silently re-skins the bundle's own components (e.g. `Button variant="accent"` stops being Pastel Indigo). All app-level names are prefixed `--pf-`.

## Colour roles in this product

- **Accent is Future Blue** (`--future-blue`), which is already the design system's `--primary`, `--accent`, `--ring` and `--link`. It carries primary buttons, selected chips, the active nav tab, links, focus rings and the slider fill.
- **Near-black (`--foreground`) is text only.**
- **The recommendation banner** is a solid `--future-blue` surface for the positive state (trust register) and the negative status tone for over-budget. Green is deliberately *not* used there — it would spend the scarcity that makes the validation ticks readable. On-band text uses `--before-white` / `--on-dark-body` / `--on-dark-quiet`.
- **Status colours.** The design system defines no standalone status tokens; the only semantic hues in the system are the functional tones inside `Alert.jsx`. `--pf-positive` and `--pf-negative` reuse those exact values so a validation tick and a success Alert match.

## Shape

The design system is **square-cornered**: `--radius-sm/md/lg` are all `0`; only chips, avatars and status dots are `--radius-full`. One card style everywhere, owned by `Card` — do not add corner radii or shadows.

## Buttons — three tiers

| Tier | Component call | Rule |
|---|---|---|
| **Primary** | `<Button variant="primary">` | **Max one per screen** — the committing action |
| **Secondary** | `<Button variant="ghost">` | Hairline on the page canvas (use `secondary` only *inside* a coloured band) |
| **Tertiary** | `<TextLink as="button" arrow={false}>` | Low-stakes / reversible |

`<Button variant="accent">` marks a **selected** state (e.g. a model already in the comparison set) — a state, not a tier.

Per-screen primary: Log in · Compare (n) · Calculate cost and recommend · Save portfolio · Add provider.

## Type

The design system's `h1` is a marketing display size. Inside the app shell it is stepped down to an interface scale (`clamp(1.75rem, 1.4rem + 1.2vw, 2.125rem)`), still on the design system's type tokens. Supporting text is `--muted-foreground` at 14/400 (`.pf-subtle`) so it is always visibly lighter than content.

## Tables

`Table` handles the hairline styling. Wrap in a native `overflow-x: auto` container where columns exceed the width — **no custom scrollbar controls**.

## Navigation

64px light bar. Active tab: `--future-blue` text with a 2px underline. Collapses to a burger sheet below **1080px** (measured: the expanded nav needs ~988px).

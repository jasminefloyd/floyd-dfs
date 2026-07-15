# YSNT Framework — Design Phase

## What You're Designing

ACT 1: Build & lock a design system page (/design-system)
ACT 2: Apply locked system to entire UI

No new design decisions after Act 1 completes.

---

## ACT 1: Build & Review Design System (2.5 hrs)

### Part 1 — Design System Foundation (~1 hr)

**Prompt to Claude Code:**
```
TASK: Define design tokens and CSS variables

1. Create src/lib/theme.js:
   - Define colors: primary (blue-600), secondary (gray-700), success (green-600), error (red-600)
   - Define typography: H1-H4, body, caption, code sizes and weights
   - Define spacing: 4px grid (4, 8, 12, 16, 24, 32, 48, 64)
   - Define shadows: subtle, medium, strong
   - Define border radius: small (4px), medium (8px), large (16px)
   - Define transitions: 200ms ease-out

2. Create src/styles/tokens.css with CSS variables:
   --color-primary: #2563eb;
   --color-primary-dark: #1d4ed8;
   --color-text: #1f2937;
   --color-text-muted: #6b7280;
   --spacing-xs: 4px;
   --spacing-sm: 8px;
   --spacing-md: 16px;
   --spacing-lg: 24px;
   --spacing-xl: 32px;
   --radius-sm: 4px;
   --radius-md: 8px;
   --radius-lg: 16px;
   [etc...]

3. Update src/index.css to import tokens.css

Output: Design tokens defined in theme.js and CSS variables
```

### Part 2 — Build Design System Page (~1.5 hrs)

**Prompt to Claude Code:**
```
TASK: Create /design-system page showing all design elements

1. Create src/pages/DesignSystem.jsx:
   - Route: /design-system
   - Display all design tokens and components
   - Scrollable, organized sections

2. Sections to include:
   - Colors: swatches for primary, secondary, success, error, gray palette
   - Typography: H1, H2, H3, H4, body, caption, code samples
   - Spacing: visual grid of all spacing units
   - Buttons: all variants (primary, secondary, ghost) and states (default, hover, disabled)
   - Inputs: text, textarea, select in all states
   - Cards: default card, variants with headers
   - Badges: success, warning, error, info
   - Alerts: success, warning, error, info
   - Modals: example modal
   - Toasts: example toast notifications
   - Skeleton loaders: for loading states

3. Update src/App.jsx:
   - Add route: <Route path="/design-system" element={<DesignSystem />} />
   - Add navigation link in Navigation.jsx

Output: /design-system route displays all design elements
```

### Part 3 — Design System Review (~30 min)

**Prompt to Claude Code:**
```
TASK: Review and iterate on design system page

1. Run app: npm run dev
2. Navigate to http://localhost:5173/design-system
3. Review:
   - Colors: Do they look cohesive?
   - Typography: Is hierarchy clear?
   - Components: Do all variants display correctly?
4. Adjust colors, fonts, spacing as needed:
   - If primary color too bright, darken it
   - If spacing inconsistent, adjust units
   - If typography hard to read, increase line-height
5. Once locked, never change these tokens again (for this phase)

Output: Design system page approved and locked
```

---

## ACT 2: Apply Design System (3.5 hrs)

### Part 4 — Core UI Polish (~2 hrs)

**Prompt to Claude Code:**
```
TASK: Apply design system tokens to entire UI

1. Update all components to use CSS variables:
   - Replace hardcoded colors with var(--color-primary)
   - Replace hardcoded spacing with var(--spacing-md)
   - Replace hardcoded radius with var(--radius-md)

2. ScanPage.jsx:
   - Use design system colors, spacing, typography
   - Buttons: use primary button style from design system
   - Inputs: use design system input styles
   - Labels: use design system typography

3. MiosScanner.jsx:
   - Radio buttons: styled with design system
   - Date picker: design system input styling
   - Text area: design system styling

4. LineupDisplay.jsx:
   - Cards: use design system card component
   - Badges: use design system badge styles
   - Buttons: save/copy use design system buttons

5. All text:
   - Use design system typography classes
   - H2 for "Recommended Lineups"
   - Body for player names
   - Caption for metadata

Output: UI uses design system tokens exclusively, no hardcoded colors/spacing
```

### Part 5 — Responsive Design (~1 hr)

**Prompt to Claude Code:**
```
TASK: Responsive design for mobile, tablet, desktop

1. Mobile (< 640px):
   - Stack layout: ScanPage side-by-side becomes stacked
   - Left: scan settings
   - Right: results (below on mobile)
   - Full width buttons/inputs

2. Tablet (640-1024px):
   - Left: scan settings (25% width)
   - Right: results (75% width)

3. Desktop (> 1024px):
   - Current layout (1/3 - 2/3 split)

4. Test at breakpoints:
   - Open DevTools → Toggle device toolbar
   - Test iPhone (375px), iPad (768px), Desktop (1024px+)
   - Verify layout works at each breakpoint

Output: UI responsive at all breakpoints
```

### Part 6 — Microinteractions (~1.5 hrs)

**Prompt to Claude Code:**
```
TASK: Add transitions, skeletons, and feedback

1. Transitions:
   - Route changes: fade in/out 200ms
   - Buttons: hover state 100ms
   - Modals: slide up 200ms
   - Use var(--transition) for all

2. Loading skeletons:
   - Player list skeleton while loading
   - Lineup skeleton while generating
   - Use design system skeleton component

3. Toasts:
   - Success: "Lineup saved!" (green)
   - Error: "Failed to scan" (red)
   - Info: "Using cached data" (blue)
   - Auto-dismiss after 3s

4. Focus states:
   - Buttons: visible focus ring (outline-offset 2px)
   - Inputs: focus ring on blue
   - Links: underline on hover

Output: Polished interactions, smooth transitions, feedback on actions
```

---

## Design Deliverables Checklist

- [ ] Design tokens defined (colors, typography, spacing, shadows, radius)
- [ ] CSS variables created in tokens.css
- [ ] /design-system page displays all components
- [ ] Colors: palette swatches, text samples
- [ ] Typography: all heading levels, body, caption, code
- [ ] Spacing: visual grid of units
- [ ] Components: buttons, inputs, cards, badges, alerts, modals, toasts, skeletons
- [ ] All colors verified for readability/accessibility
- [ ] All components use design system tokens (no hardcoded colors)
- [ ] Responsive: tested on mobile, tablet, desktop
- [ ] Transitions: smooth 200ms ease on all interactive elements
- [ ] Skeletons: appear during loading
- [ ] Toasts: feedback on all actions
- [ ] Focus states: visible on all interactive elements
- [ ] Design system page locked (no changes after Act 1)
- [ ] Code committed to GitHub

---

*Next up → App Hardening: security, performance, design system migration*

# UI/UX audit evidence

Captured September 30, 2026 for [the mobile-first polish plan](../mobile-first-ui-ux-audit-and-polish-plan.md).

## Method

- Rendered the current local app through Vite in headless Chromium.
- Intercepted every `/api/` request with synthetic responses, including generation and entered-state mutations. No production request was sent.
- Blocked other remote requests, including imagery and telemetry. Broken image placeholders therefore represent the missing-image failure path.
- Used fictional names/teams and illustrative projections. The fixture is designed to test presentation and state handling, not forecasting or sports-rule validity.
- Selected WNBA/Showdown in the actual builder, generated from mocked responses, then injected a failed entered mutation.
- Captured mobile builder/results, 320px results, desktop results, saved run and Learning. The narrow/desktop screenshots follow the failed mutation and show its resulting success/error contradiction.
- Reset document scroll before full-page captures. Sticky elements in full-page screenshots still require viewport and physical-device checks during implementation.

`measurements.json` records document sizes, first roster-name position where available, small-text element counts and the failed-save observation. Nested elements can contribute separately to the small-text count; it is not an accessibility score. Heights reflect one synthetic slate and may differ with other data.

## Reproduce

Start the app from the project directory:

```sh
npm run dev -- --host 127.0.0.1 --port 5199
```

Then run the evidence script using an already installed Playwright package and Chromium browser:

```sh
node docs/ui-ux-audit-evidence/capture-audit.mjs
```

If Playwright is installed outside this project's module resolution, set `PLAYWRIGHT_MODULE` to that installation's absolute `index.mjs` path. `AUDIT_BASE_URL` can override the local URL. The script overwrites the six PNGs and measurements in this directory. It does not install dependencies or modify application code. Browser launch may require the environment's normal sandbox approval.

The captured run used an existing local Playwright installation. Vite started successfully but warned that the machine's Node 20.13.1 was below its supported version range; use a supported Node version when reproducing. These captures are a visual/interaction audit, not a build or production compatibility certification.

## Files

| File | State |
| --- | --- |
| `01-mobile-builder.png` | 390×844 viewport; selected synthetic WNBA contest |
| `02-mobile-results.png` | 390×844; generated single lineup before failed-save probe |
| `03-small-mobile-results.png` | 320×740; results after failed save |
| `04-desktop-results.png` | 1440×1000; results after failed save |
| `05-mobile-saved-run.png` | 390×844; saved-run presentation |
| `06-mobile-learning.png` | 390×844; Learning page |
| `measurements.json` | Geometry and mutation outcome |
| `capture-audit.mjs` | Reproduction harness using mocked requests |

No physical-device, screen-reader or user-study result is claimed by these artifacts. Those checks are specified in the implementation plan.

# Task List: Hybrid Preview and Final Render Pipeline

## Plan Reference

Implements: `specs/hybrid-render-pipeline/plan.md`

## Tasks

### Open Preview Client and Providers

- [x] **TASK-001** [S] Write Open Video Worker client tests
  - Tests: AC-1, AC-2, AC-E4
  - Creates: `tests/open-video-worker.test.ts`
  - Depends on: none

- [x] **TASK-002** [M] Implement Open Video Worker client
  - Contract: `contracts/open-video-worker.md`
  - Creates: `services/open-video-worker.service.ts`
  - Depends on: TASK-001
  - Satisfies: AC-1, AC-2, AC-E4

- [x] **TASK-003** [S] Write explicit preview-provider routing tests
  - Tests: AC-1, AC-2, AC-11
  - Modifies: `tests/v3-2-plugin-chain-router.test.ts`
  - Creates: `tests/open-video-providers.test.ts`
  - Depends on: TASK-002

- [x] **TASK-004** [M] Register Wan2.2 and HunyuanVideo providers
  - Contract: `contracts/preview-preflight.md`
  - Modifies: `lib/video-providers/types.ts`, `lib/video-providers/builtins.ts`,
    `lib/plugin-chain-router.ts`
  - Depends on: TASK-003
  - Satisfies: AC-1, AC-2, AC-11

### Portable GPU Worker

- [x] **TASK-005** [S] Write worker workflow compiler and API tests
  - Tests: AC-1, AC-2, AC-13, AC-15
  - Creates: `workers/open-video/tests/test_worker.py`
  - Depends on: none

- [x] **TASK-006** [M] Implement authenticated ComfyUI worker
  - Contract: `contracts/open-video-worker.md`
  - Creates: `workers/open-video/server.py`, `workers/open-video/workflow.py`
  - Depends on: TASK-005
  - Satisfies: AC-1, AC-2, AC-13, AC-15

- [x] **TASK-007** [S] Add worker deployment package
  - Contract: `contracts/open-video-worker.md`
  - Creates: `workers/open-video/requirements.txt`,
    `workers/open-video/docker-compose.yml`, `workers/open-video/.env.example`
  - Depends on: TASK-006

- [x] **TASK-008** [S] Add model preflight/provision documentation
  - Tests: AC-2, AC-15
  - Creates: `workers/open-video/README.md`,
    `workers/open-video/scripts/preflight.sh`
  - Depends on: TASK-007

### Preview Entry

- [x] **TASK-009** [S] Write create preflight tests
  - Tests: AC-1, AC-2
  - Creates: `tests/open-video-create-preflight.test.ts`
  - Depends on: TASK-002

- [x] **TASK-010** [M] Enforce open-worker readiness before queueing
  - Contract: `contracts/preview-preflight.md`
  - Modifies: `app/api/create-stream/route.ts`
  - Depends on: TASK-009
  - Satisfies: AC-2

- [x] **TASK-011** [S] Add open-profile choices to create surfaces
  - Tests: AC-1
  - Modifies: `app/dashboard/create/page.tsx`, `app/create/page.tsx`
  - Depends on: TASK-010
  - Satisfies: AC-1

### Whole-Film Job Core

- [x] **TASK-012** [M] Write snapshot, estimate, idempotency, conflict and retry tests
  - Tests: AC-5 through AC-13, AC-E1 through AC-E5
  - Creates: `tests/film-rerender.test.ts`
  - Depends on: none

- [x] **TASK-013** [L] Implement film snapshot and runner
  - Contract: `contracts/film-rerender-api.md`
  - Creates: `lib/film-rerender.ts`
  - Depends on: TASK-012
  - Satisfies: AC-5 through AC-13, AC-E1 through AC-E5
  - Justification: one cohesive domain module; no other files touched

- [x] **TASK-014** [S] Write partial pipeline-state tests
  - Tests: AC-7, AC-10
  - Modifies: `tests/pipeline-job-repo.test.ts`
  - Depends on: TASK-013

- [x] **TASK-015** [M] Add film-rerender worker dispatch and partial state
  - Contract: `contracts/film-rerender-api.md`
  - Modifies: `lib/repos/pipeline-job-repo.ts`, `lib/pipeline-worker.ts`,
    `app/api/pipeline-jobs/[id]/retry/route.ts`
  - Depends on: TASK-014
  - Satisfies: AC-7, AC-10

### Native 4K Composition

- [x] **TASK-016** [S] Write native-resolution canvas tests
  - Tests: AC-3, AC-4, AC-9
  - Modifies: `tests/v12-49-canvas-aspect.test.ts`
  - Depends on: none

- [x] **TASK-017** [M] Add native-resolution composition option
  - Contract: `contracts/film-rerender-api.md`
  - Modifies: `lib/video-reframe.ts`, `services/video-composer.ts`
  - Depends on: TASK-016
  - Satisfies: AC-3, AC-4, AC-9

- [x] **TASK-018** [M] Write project recomposition tests
  - Tests: AC-3, AC-4, AC-9, AC-10, AC-E5
  - Creates: `tests/project-recompose.test.ts`
  - Depends on: TASK-017

- [x] **TASK-019** [M] Implement reusable project recomposition
  - Contract: `contracts/film-rerender-api.md`
  - Creates: `lib/project-recompose.ts`
  - Depends on: TASK-018
  - Satisfies: AC-3, AC-4, AC-9, AC-10, AC-E5

### API and UI

- [x] **TASK-020** [M] Write whole-film API contract tests
  - Tests: AC-6, AC-7, AC-10, AC-12, AC-E1, AC-E2
  - Creates: `tests/film-rerender-route.test.ts`
  - Depends on: TASK-013

- [x] **TASK-021** [M] Implement whole-film estimate/status/submit API
  - Contract: `contracts/film-rerender-api.md`
  - Creates: `app/api/projects/[id]/film-rerender/route.ts`
  - Depends on: TASK-020
  - Satisfies: AC-6, AC-7, AC-10, AC-12, AC-E1, AC-E2

- [x] **TASK-022** [M] Write whole-film panel behaviour tests
  - Tests: AC-6, AC-7, AC-10, AC-14
  - Creates: `tests/film-rerender-panel.test.tsx`
  - Depends on: TASK-021

- [x] **TASK-023** [M] Implement whole-film rerender panel
  - Contract: `contracts/film-rerender-api.md`
  - Creates: `components/project/film-rerender-panel.tsx`
  - Modifies: `components/project/shot-workshop-tab.tsx`
  - Depends on: TASK-022
  - Satisfies: AC-6, AC-7, AC-10, AC-14

### Integration and Delivery

- [x] **TASK-024** [L] Integration test: open preview selection to final 4K job
  - Tests: AC-1 through AC-15 and AC-E1 through AC-E5
  - Creates: `tests/hybrid-render-pipeline.test.ts`
  - Depends on: TASK-004, TASK-010, TASK-015, TASK-019, TASK-021, TASK-023
  - Justification: cross-component acceptance test only

- [x] **TASK-025** [S] Update environment and deployment documentation
  - Modifies: `.env.example`, `README.md`
  - Depends on: TASK-024

- [x] **TASK-026** [M] Run worker tests, targeted Vitest, full Vitest, typecheck and build
  - Depends on: TASK-025
  - Evidence: 7 Python worker tests, 426 Vitest files / 3527 tests,
    `tsc --noEmit`, and `next build` all passed on 2026-07-28

- [ ] **TASK-027** [M] Deploy and live-preflight the authorized HAI worker
  - Depends on: TASK-026
  - Blocker policy: requires an authenticated owner browser session; no alternative
    instance may be created
  - Current blocker: the retained Tencent Cloud login page is unauthenticated and
    the authorized instance ports 6888/6889/6890 are unreachable; owner login is
    required before start/deploy/live preview generation

## Legend

- `[S]` Small — under 1 hour
- `[M]` Medium — 1–3 hours
- `[L]` Large — 3–6 hours with explicit single-file or integration justification
- `[P]` Parallelizable — omitted because this run is intentionally single-agent

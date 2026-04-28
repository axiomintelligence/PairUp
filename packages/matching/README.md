# `@pairup/matching`

Shared scoring + visibility logic for PairUp. Pure TypeScript, no Fastify or Postgres dependencies. Behaviour ported from the Phase 0 client (`apps/web-static/app.js`); behavioural parity is covered by the Vitest suite.

## Surface

```ts
import {
  // Scoring (HLD §7.2 stage 2)
  rankScore,           // (user, candidate, opts?) → { score: 0..100, breakdown }
  scoreMatch,          // alias of rankScore
  compareForCursor,    // stable order helper for cursor pagination

  // Visibility gates (HLD §7.2 stage 1 + per-card warnings)
  candidateVisibleToSearcher,
  userVisibleToCandidate,
  candidateSatisfiesSearcherGates,

  // Day arithmetic
  dayComplementarity,
  sharedDirectorates,
  directorateOverlapAny,

  // Constants & types
  GRADES, DAYS_OF_WEEK, DEFAULT_SEARCH_PREFS, DEFAULT_VISIBILITY, DEFAULT_WEIGHTS,
  type Profile, type SearchPrefs, type MatchWeights, type Days, type Grade,
  type ScoreResult, type ScoreBreakdownEntry,
} from '@pairup/matching';
```

## Scripts

```bash
npm --workspace @pairup/matching run typecheck
npm --workspace @pairup/matching run build       # tsc → dist/
npm --workspace @pairup/matching run test        # Vitest run
npm --workspace @pairup/matching run test:watch  # Vitest watch
```

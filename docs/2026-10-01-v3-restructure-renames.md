# v3 restructure: renamed symbols

Every exported symbol renamed during the restructure. File moves are in the
design doc's layout section.

| Old | New | File |
| --- | --- | --- |
| `seededUnit` (process/turn-taking/pacing) | `seededUnit` (platform/seeded-random) | `src/mind/platform/seeded-random.ts` |
| `relativeDate` (process/hot-path/assemble) | `relativeDate` (platform/relative-date) | `src/mind/platform/relative-date.ts` |
| `rankCandidates` | `rankMemories` | `src/mind/memory/shared/ranking.ts` |
| `decide` | `reconcileAgainstNeighbours` | `src/mind/memory/user/reconcile.ts` |
| `applyExtraction` | `encodeExtraction` | `src/mind/memory/user/encode.ts` |
| `ApplyInput` | `EncodeInput` | `src/mind/memory/user/encode.ts` |
| `ApplyOutcome` | `EncodeOutcome` | `src/mind/memory/user/encode.ts` |
| `RetrievedFact`, `DueThread`, `RetrievalResult`, `emptyRetrieval` (process/hot-path/assemble) | same names (memory/shared/types) | `src/mind/memory/shared/types.ts` |
| (inline input type) | `RetrieveInput` | `src/mind/memory/user/retrieve.ts` |
| (inline return type) | `AgeCheck` | `src/mind/platform/age-gate.ts` |
| `Param` | `HomeostaticParam` (the spec's name) | `src/mind/state/user/relationship/types.ts` |
| `RelState`, `RelConfig`, `RelEvent`, `RelCause`, `RelStatus` | `RelationshipState`, `RelationshipConfig`, `RelationshipEvent`, `RelationshipCause`, `RelationshipStatus` | `src/mind/state/user/relationship/types.ts` |
| `effect` | `deviationOf` | `src/mind/state/user/relationship/params.ts` |
| `dim` | `diminishingReturns` | `src/mind/state/user/relationship/params.ts` |
| `applyExchange` (relationship) | `relationshipAfterExchange` | `src/mind/state/user/relationship/transitions.ts` |
| `applyTick` | `relationshipAfterDailyTick` | `src/mind/state/user/relationship/transitions.ts` |
| `applyRelationship` | `updateRelationship` | `src/mind/state/user/relationship/update.ts` |
| `relationshipTick` | `relationshipDailyTick` | `src/mind/state/user/relationship/daily-tick.ts` |
| `toRelState` | `toRelationshipState` | `src/db/repos/relationship.ts` |

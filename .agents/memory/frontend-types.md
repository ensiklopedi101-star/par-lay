---
name: Frontend Hook Types
description: Shared response types for the main app hooks.
---

Hook file `src/api/parlay-hooks.ts` now exports typed response interfaces:

- `SyncStatus`, `Health`, `LeagueAvailable`, `FixtureEvent`, `EventDetail`, `Config`, `Standing`, `Parlay`, `ParlayLeg`, `Market`, `Catalog`.
- Semua hook `useQuery` sudah dibekali generic `<T>` sehingga tidak perlu `as ...` di halaman.
- Utility `formatLeagueName(slug)` ada di `src/utils/format-league.ts` untuk mengubah slug menjadi Title Case.

**Why:** Menghilangkan typecheck error di banyak halaman sekaligus (dashboard, fixtures, parlays, standings, teams, settings) dan membuat slug liga tampil rapi di UI.

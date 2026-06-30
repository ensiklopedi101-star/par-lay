---
name: Standings Per-League & Season Default
description: How standings are grouped and which season is shown by default.
---

Halaman **Standings** di frontend dikelompokkan per liga (mirip Team Stats). Backend `/api/supabase/standings` mengelompokkan dan mengurutkan data per `league_slug`, lalu men-assign `position` per liga (bukan global).

- Sorting per liga: **Pts descending**, tie-breaker **GD descending**.
- Default season di frontend dihitung dari tanggal: Juni ke atas → musim depan (`year-(year+1)`), Jan–Mei → musim berjalan (`(year-1)-year`).
- Saat data musim default kosong, UI menampilkan pesan empty state; user dapat mengganti season manual.

**Why:** Klasemen harus relevan per kompetisi dan tidak mencampur posisi antar-liga. Default musim depan memastikan UI menunjukkan context yang akan datang, meskipun data historis tersedia untuk musim sebelumnya.

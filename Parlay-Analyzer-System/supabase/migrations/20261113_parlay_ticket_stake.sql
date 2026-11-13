-- P5: stake tingkat tiket + metrik korelasi pada parlay.
--
-- Sebelumnya `parlays` hanya menyimpan win_probability hasil perkalian
-- independen dan tidak punya stake sama sekali. Kolom ini menyimpan angka
-- yang benar-benar dipakai keputusan: probabilitas setelah koreksi
-- korelasi, EV pesimis, dan stake tiket (1/4 Kelly, cap 2%).
-- Semua nullable: baris lama dan penulis lama tetap sah.

ALTER TABLE public.parlays
  ADD COLUMN IF NOT EXISTS stake_pct double precision,
  ADD COLUMN IF NOT EXISTS ev_pessimistic double precision,
  ADD COLUMN IF NOT EXISTS p_correlated double precision;

COMMENT ON COLUMN public.parlays.stake_pct IS
  'Stake tiket sebagai % bankroll (ticketStakePlan: 1/4 Kelly dari pDecision, cap 2%). 0 = jangan pasang.';
COMMENT ON COLUMN public.parlays.ev_pessimistic IS
  'EV tiket bila setiap leg overestimasi 1 sigma. <= 0 berarti stake_pct dipaksa 0.';
COMMENT ON COLUMN public.parlays.p_correlated IS
  'Probabilitas gabungan setelah koreksi korelasi (Monte Carlo), pasangan pDecision.';

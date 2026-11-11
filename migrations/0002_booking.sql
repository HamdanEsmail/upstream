-- What a deep search that was started as a free one really cost. The account's wallet is read
-- just before the run starts and again after the trail is done; a fall of a run's price means
-- the run was charged after all. A run paid from the reserve has no wallet_before: it is booked
-- at its price when it starts.
ALTER TABLE traces ADD COLUMN wallet_before REAL;
ALTER TABLE traces ADD COLUMN wallet_after REAL;
-- Set once, when the run is booked. A run is never booked twice.
ALTER TABLE traces ADD COLUMN booked_at TEXT;

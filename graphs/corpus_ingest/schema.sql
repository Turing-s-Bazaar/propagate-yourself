CREATE TABLE IF NOT EXISTS papers (
    id BIGSERIAL PRIMARY KEY,
    doi TEXT UNIQUE,
    title TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    taste_score DOUBLE PRECISION NOT NULL DEFAULT 1.0
        CHECK (taste_score >= 0.0 AND taste_score <= 1.0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- === Base tables ===

CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    profile_image_path TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE passwords (
    id BIGSERIAL PRIMARY KEY,
    password TEXT NOT NULL,  -- store hash, not plaintext
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TYPE video_visibility_state AS ENUM ('public', 'shareable', 'users', 'friends', 'private');
CREATE TABLE videos (
    id          BIGSERIAL PRIMARY KEY,
    public_id   TEXT, -- youtube like
    title       TEXT,
    description TEXT,
    likes       BIGINT NOT NULL DEFAULT 0 CHECK (likes >= 0),
    dislikes    BIGINT NOT NULL DEFAULT 0 CHECK (dislikes >= 0),
    views       BIGINT NOT NULL DEFAULT 0 CHECK (views >= 0),
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE SET NULL, -- nullable to allow SET NULL
    visibility_state video_visibility_state NOT NULL DEFAULT 'private',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transcode_jobs (
    id          BIGSERIAL PRIMARY KEY,
    video_id    BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    input_path  TEXT NOT NULL,
    output_path TEXT NOT NULL,
    output_id   TEXT NOT NULL,
    transcode_result JSONB,
    state       transcode_state_type NOT NULL DEFAULT 'created',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transcode_info (
    id            BIGSERIAL PRIMARY KEY,
    video_id      BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    path          TEXT NOT NULL,
    -- video info
    duration      int,                         -- or switch to INT seconds if you prefer
    size_bytes    BIGINT CHECK (size_bytes >= 0),
    bitrate_kbps   BIGINT CHECK (bitrate_kbps >= 0),
    video_codec   TEXT,                    -- e.g. 'h264', 'hevc'
    audio_codec   TEXT,                    -- e.g. 'mp3', 'aac'
    pixel_format  TEXT,                    -- e.g. 'yuv420p10le'
    width         INT CHECK (width  >= 0),
    height        INT CHECK (height >= 0),
    fps           NUMERIC(6,3) CHECK (fps > 0),
    metadata      JSONB NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

--CREATE TYPE upload_state_type AS ENUM ('created', 'partially_uploaded', 'completed');

CREATE TABLE if not exists uploads (
    id          BIGSERIAL PRIMARY KEY,
    video_id    BIGINT REFERENCES videos(id) ON DELETE CASCADE,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tus_id      TEXT NOT NULL,
    tus_info    JSONB NOT NULL,
    state       upload_state_type NOT NULL DEFAULT 'created',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CREATE TYPE transcode_state_type AS ENUM ('created', 'transcoding', 'completed');



CREATE TABLE video_tags (
    id BIGSERIAL PRIMARY KEY,
    tag TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Join table (prevents duplicates via composite primary key)
CREATE TABLE video_tag_map (
    video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    tag_id   BIGINT NOT NULL REFERENCES video_tags(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (video_id, tag_id)
);

-- === Indexes & constraints implemented via CREATE INDEX (no ALTER) ===

-- FK helper indexes
CREATE INDEX passwords_user_id_idx ON passwords(user_id);
CREATE INDEX videos_user_id_idx    ON videos(user_id);

-- Common video query patterns
CREATE INDEX videos_created_at_idx           ON videos(created_at);
CREATE INDEX videos_public_id_idx            ON videos(public_id);
CREATE INDEX videos_views_idx                ON videos(views);

-- Full-text search on title + description (expression GIN index)
CREATE INDEX videos_fts_idx ON videos
USING gin (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,'')));

-- Reverse lookup on join table (fetch all videos for a tag)
CREATE INDEX video_tag_map_tag_id_idx ON video_tag_map(tag_id);

-- Case-insensitive uniqueness for tags (functional unique index)
CREATE UNIQUE INDEX video_tags_tag_lower_uidx ON video_tags (lower(tag));

-- Helpful indexes
CREATE INDEX video_info_wh_idx       ON transcode_info (width, height);
CREATE INDEX video_info_fps_idx      ON transcode_info (fps);
CREATE INDEX video_info_meta_gin_idx ON transcode_info USING GIN (metadata jsonb_path_ops);

-- Upload lookups for videos
CREATE INDEX idx_uploads_video_id ON uploads(video_id);

-- test data
insert into users (name) values ('jakob');
insert into passwords (user_id, password) values (1, '$argon2i$v=19$m=65535,t=2,p=1$cWVObnlISGJqblNmeDQwaQ$JVQUIzGKjMkM1rWIgvPwmNoiuQLFizQn+VQ04u1uLtI');

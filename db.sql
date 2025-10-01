-- === Base tables ===
CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    display_name TEXT NOT NULL,
    profile_image_path TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE passwords (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    password TEXT NOT NULL,  -- store hash, not plaintext
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now()
);

--CREATE TYPE video_visibility_state AS ENUM ('public', 'shareable', 'users', 'friends', 'private');
CREATE TABLE videos (
    id           BIGSERIAL PRIMARY KEY,
    public_id    TEXT NOT NULL, -- youtube like
    title        TEXT,
    description  TEXT,
    poster_image TEXT,
    ext_ref      TEXT,
    gps          point,
    ready        BOOLEAN NOT NULL DEFAULT false,
    likes        BIGINT NOT NULL DEFAULT 0 CHECK (likes >= 0),
    dislikes     BIGINT NOT NULL DEFAULT 0 CHECK (dislikes >= 0),
    views        BIGINT NOT NULL DEFAULT 0 CHECK (views >= 0),
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE SET NULL, -- nullable to allow SET NULL
    visibility_state video_visibility_state NOT NULL DEFAULT 'private',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

--CREATE TYPE upload_state_type AS ENUM ('created', 'partially_uploaded', 'completed');
--CREATE TYPE transcode_state_type AS ENUM ('created', 'transcoding', 'failed', 'completed');

CREATE TABLE uploads (
    id          BIGSERIAL PRIMARY KEY,
    video_id    BIGINT NOT NULL REFERENCES videos(id) ON delete CASCADE,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tus_id      TEXT NOT NULL,
    tus_info    JSONB NOT NULL,
    state       upload_state_type NOT NULL DEFAULT 'created',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transcode_jobs (
    id          BIGSERIAL PRIMARY KEY,
    upload_id    BIGINT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
    input_path  TEXT NOT NULL,
    output_path TEXT NOT NULL,
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
    fps           float CHECK (fps >= 0),
    metadata      JSONB NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION public.norm_ci(t text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
BEGIN
  RETURN lower(public.unaccent('public.unaccent'::regdictionary, coalesce(t,'')));
END;
$$;

-- all index are for fast searching inside text
create index video_tags_tag_lower_gin_trgm_idx on video_tags using gin (lower(tag) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_videos_title_trgm_ci ON videos USING gin (public.norm_ci(title) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_videos_desc_trgm_ci ON videos USING gin (public.norm_ci(description) gin_trgm_ops);

create index if not exists users_display_name_lower_gin_trgm_idx on users using gin (lower(display_name) gin_trgm_ops);

create unique index if not exists uploads_tus_id_uq on uploads (tus_id);
create index if not exists uploads_video_id_idx on uploads (video_id);
create index if not exists uploads_user_id_created_at_idx on uploads (user_id, created_at desc);

create index if not exists transcode_jobs_upload_id_idx on transcode_jobs (upload_id);
create index if not exists transcode_jobs_state_created_at_idx on transcode_jobs (state);

create index if not exists transcode_info_video_id_idx on transcode_info (video_id);

-- useful?
create index if not exists video_tag_map_tag_id_video_id_idx on video_tag_map (tag_id, video_id);

-- === test data ===
insert into users (display_name, profile_image_path) values ('JJ', 'jakob.png');
insert into users (display_name, profile_image_path) values ('Nora', 'nora.png');
insert into users (display_name, profile_image_path) values ('Ber', 'ber.png');
insert into users (display_name, profile_image_path) values ('Tom', 'tom.png');
insert into passwords (user_id, name, password) values (1, 'jakob', '$argon2i$v=19$m=65535,t=2,p=1$cWVObnlISGJqblNmeDQwaQ$JVQUIzGKjMkM1rWIgvPwmNoiuQLFizQn+VQ04u1uLtI');
insert into passwords (user_id, name, password) values (2, 'nora', '$argon2i$v=19$m=65535,t=2,p=1$aE1uU0IxSFdGaFNHcTFmNQ$H2FB1Odd/jk0nUyzLkK1p+X2QIPAQHiBLTJNvHvALHc');
insert into passwords (user_id, name, password) values (3, 'ber', '$argon2i$v=19$m=65535,t=2,p=1$TUJjZlRScWFCOFJpN1U5bw$WZgzxDbCAyn9A9aTytrVNmHQr9UNc7FpUEvUa5be+Lg');
insert into passwords (user_id, name, password) values (4, 'tom', '$argon2i$v=19$m=65535,t=2,p=1$alZMODZZREVyU0FWWDNXUw$7GS3FDTcgF6TQa9/rnIChkEt53f7iP/zWf7AvVCdZdA');
insert into video_tags (tag) values ('bongo'), ('bubbel'), ('hullu'), ('möp'), ('Gorge aux Châts'), ('Fontainbleau')


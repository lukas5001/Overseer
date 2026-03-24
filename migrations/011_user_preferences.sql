CREATE TABLE IF NOT EXISTS user_preferences (
    user_id UUID PRIMARY KEY,
    default_filter_id UUID,
    show_inactive BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

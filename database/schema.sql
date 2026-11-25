
-- EVERREACH TECHNOLOGIES
-- Initial user database schema

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,

    username TEXT NOT NULL UNIQUE,
    phone TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Prevent usernames that differ only by capitalization
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_idx
ON public.profiles (LOWER(username));

-- Enable database security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can view their own profiles
CREATE POLICY "Users can view own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- Users can update their own profiles
CREATE POLICY "Users can update own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Automatically create a profile after registration
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.profiles (
        id,
        first_name,
        last_name,
        username,
        phone
    )
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
        COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
        COALESCE(
            NEW.raw_user_meta_data->>'username',
            'user_' || REPLACE(NEW.id::TEXT, '-', '')
        ),
        NEW.raw_user_meta_data->>'phone'
    );

    RETURN NEW;
END;
$$;

-- Remove old trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Register the automatic profile creation trigger
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

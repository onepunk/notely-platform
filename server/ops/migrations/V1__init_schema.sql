--
-- Notely Platform v3 — Initial schema
--
-- Flattened single-migration schema representing the full DB state.
-- Run against an empty database to bootstrap the platform.
--
-- Apply with Flyway (as V1__init_schema.sql) or directly via psql:
--   psql -U <admin-user> -d notely_v3 -f V1__init_schema.sql
--

--
-- PostgreSQL database dump
--


-- Dumped from database version 15.17
-- Dumped by pg_dump version 15.17

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: actions; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA actions;


--
-- Name: admin_settings; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA admin_settings;


--
-- Name: calendar; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA calendar;


--
-- Name: client_sync; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA client_sync;


--
-- Name: email; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA email;


--
-- Name: global_auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA global_auth;


--
-- Name: licensing; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA licensing;


--
-- Name: meetings; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA meetings;


--
-- Name: notes; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA notes;


--
-- Name: releases; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA releases;


--
-- Name: summaries; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA summaries;


--
-- Name: support; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA support;


--
-- Name: transcripts; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA transcripts;


--
-- Name: user_portal_settings; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA user_portal_settings;


--
-- Name: user_profiles; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA user_profiles;


--
-- Name: citext; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: license_grant_type; Type: TYPE; Schema: licensing; Owner: -
--

CREATE TYPE licensing.license_grant_type AS ENUM (
    'purchase',
    'beta',
    'trial',
    'promotional',
    'admin_grant'
);


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: calendar; Owner: -
--

CREATE FUNCTION calendar.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: get_oldest_cursor(uuid); Type: FUNCTION; Schema: client_sync; Owner: -
--

CREATE FUNCTION client_sync.get_oldest_cursor(p_user_id uuid) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE
    oldest_seq BIGINT;
BEGIN
    SELECT MIN(seq) INTO oldest_seq
    FROM client_sync.sync_changes
    WHERE user_id = p_user_id;

    -- If no changes exist, return 0 (snapshot will be required)
    RETURN COALESCE(oldest_seq, 0);
END;
$$;


--
-- Name: is_cursor_expired(uuid, bigint); Type: FUNCTION; Schema: client_sync; Owner: -
--

CREATE FUNCTION client_sync.is_cursor_expired(p_user_id uuid, p_cursor bigint) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
    oldest_seq BIGINT;
BEGIN
    -- Cursor 0 is always valid (means snapshot/first sync)
    IF p_cursor = 0 THEN
        RETURN FALSE;
    END IF;

    oldest_seq := client_sync.get_oldest_cursor(p_user_id);

    -- If oldest_seq is 0, no changes exist - cursor is effectively expired
    IF oldest_seq = 0 THEN
        RETURN TRUE;
    END IF;

    -- Cursor is expired if it's older than the oldest available change
    RETURN p_cursor < oldest_seq;
END;
$$;


--
-- Name: prune_sync_changes(integer); Type: FUNCTION; Schema: client_sync; Owner: -
--

CREATE FUNCTION client_sync.prune_sync_changes(retention_days integer DEFAULT 30) RETURNS TABLE(deleted_count bigint)
    LANGUAGE plpgsql
    AS $$
DECLARE
    cutoff_time TIMESTAMPTZ;
    rows_deleted BIGINT;
BEGIN
    cutoff_time := NOW() - (retention_days || ' days')::INTERVAL;

    DELETE FROM client_sync.sync_changes
    WHERE created_at < cutoff_time;

    GET DIAGNOSTICS rows_deleted = ROW_COUNT;

    RETURN QUERY SELECT rows_deleted;
END;
$$;


--
-- Name: prune_sync_data(integer); Type: FUNCTION; Schema: client_sync; Owner: -
--

CREATE FUNCTION client_sync.prune_sync_data(retention_days integer DEFAULT 30) RETURNS TABLE(sync_changes_deleted bigint, sync_mutations_deleted bigint)
    LANGUAGE plpgsql
    AS $$
DECLARE
    changes_deleted BIGINT;
    mutations_deleted BIGINT;
BEGIN
    -- Prune sync_changes
    SELECT deleted_count INTO changes_deleted
    FROM client_sync.prune_sync_changes(retention_days);

    -- Prune sync_mutations
    SELECT deleted_count INTO mutations_deleted
    FROM client_sync.prune_sync_mutations(retention_days);

    RETURN QUERY SELECT changes_deleted, mutations_deleted;
END;
$$;


--
-- Name: prune_sync_mutations(integer); Type: FUNCTION; Schema: client_sync; Owner: -
--

CREATE FUNCTION client_sync.prune_sync_mutations(retention_days integer DEFAULT 30) RETURNS TABLE(deleted_count bigint)
    LANGUAGE plpgsql
    AS $$
DECLARE
    cutoff_time TIMESTAMPTZ;
    rows_deleted BIGINT;
BEGIN
    cutoff_time := NOW() - (retention_days || ' days')::INTERVAL;

    DELETE FROM client_sync.sync_mutations
    WHERE created_at < cutoff_time;

    GET DIAGNOSTICS rows_deleted = ROW_COUNT;

    RETURN QUERY SELECT rows_deleted;
END;
$$;


--
-- Name: record_sync_change(uuid, text, uuid, text, integer, bigint); Type: FUNCTION; Schema: client_sync; Owner: -
--

CREATE FUNCTION client_sync.record_sync_change(p_user_id uuid, p_entity_type text, p_entity_id uuid, p_op text, p_version integer, p_server_updated_at bigint) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE
    new_seq BIGINT;
BEGIN
    INSERT INTO client_sync.sync_changes (
        user_id, entity_type, entity_id, op, version, server_updated_at
    ) VALUES (
        p_user_id, p_entity_type, p_entity_id, p_op, p_version, p_server_updated_at
    )
    RETURNING seq INTO new_seq;

    RETURN new_seq;
END;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: client_sync; Owner: -
--

CREATE FUNCTION client_sync.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: email; Owner: -
--

CREATE FUNCTION email.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: global_auth; Owner: -
--

CREATE FUNCTION global_auth.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: check_recording_upload_allowed(uuid, bigint); Type: FUNCTION; Schema: licensing; Owner: -
--

CREATE FUNCTION licensing.check_recording_upload_allowed(p_user_id uuid, p_file_size bigint) RETURNS TABLE(allowed boolean, reason text, tier_key character varying, max_file_size_bytes bigint, retention_days integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_tier_id UUID;
    v_tier_key VARCHAR;
    v_recordings_enabled BOOLEAN;
    v_max_file_size BIGINT;
    v_retention_days INTEGER;
BEGIN
    -- Get user's active license tier
    SELECT l.tier_id, t.tier_key,
           COALESCE((t.metadata->>'recordings_enabled')::boolean, FALSE),
           COALESCE((t.metadata->>'max_recording_file_size_bytes')::bigint, 0),
           COALESCE((t.metadata->>'recording_retention_days')::integer, 0)
    INTO v_tier_id, v_tier_key, v_recordings_enabled, v_max_file_size, v_retention_days
    FROM licensing.licenses l
    JOIN licensing.tiers t ON l.tier_id = t.id
    WHERE l.user_id = p_user_id
      AND l.license_type = 'desktop'
      AND l.revoked_at IS NULL
      AND (l.expires_at IS NULL OR l.expires_at > NOW())
    ORDER BY t.tier_level DESC
    LIMIT 1;

    -- If no license found, check for portal license
    IF v_tier_id IS NULL THEN
        SELECT l.tier_id, t.tier_key,
               COALESCE((t.metadata->>'recordings_enabled')::boolean, FALSE),
               COALESCE((t.metadata->>'max_recording_file_size_bytes')::bigint, 0),
               COALESCE((t.metadata->>'recording_retention_days')::integer, 0)
        INTO v_tier_id, v_tier_key, v_recordings_enabled, v_max_file_size, v_retention_days
        FROM licensing.licenses l
        JOIN licensing.tiers t ON l.tier_id = t.id
        WHERE l.user_id = p_user_id
          AND l.license_type = 'portal'
          AND l.revoked_at IS NULL
          AND (l.expires_at IS NULL OR l.expires_at > NOW())
        ORDER BY t.tier_level DESC
        LIMIT 1;
    END IF;

    -- No active license found
    IF v_tier_id IS NULL THEN
        RETURN QUERY SELECT
            FALSE::BOOLEAN,
            'No active license found'::TEXT,
            NULL::VARCHAR,
            0::BIGINT,
            0::INTEGER;
        RETURN;
    END IF;

    -- Check if recordings are enabled for this tier
    IF NOT v_recordings_enabled THEN
        RETURN QUERY SELECT
            FALSE::BOOLEAN,
            'Recording uploads are not available for your plan. Please upgrade to Professional or Enterprise.'::TEXT,
            v_tier_key,
            v_max_file_size,
            v_retention_days;
        RETURN;
    END IF;

    -- Check file size limit
    IF p_file_size > v_max_file_size THEN
        RETURN QUERY SELECT
            FALSE::BOOLEAN,
            format('File size exceeds the %s limit for your plan. Maximum allowed: %s MB',
                   v_tier_key,
                   (v_max_file_size / 1048576)::TEXT)::TEXT,
            v_tier_key,
            v_max_file_size,
            v_retention_days;
        RETURN;
    END IF;

    -- Upload allowed
    RETURN QUERY SELECT
        TRUE::BOOLEAN,
        'Upload allowed'::TEXT,
        v_tier_key,
        v_max_file_size,
        v_retention_days;
END;
$$;


--
-- Name: cleanup_stale_sessions(); Type: FUNCTION; Schema: licensing; Owner: -
--

CREATE FUNCTION licensing.cleanup_stale_sessions() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    affected_rows INTEGER;
BEGIN
    UPDATE licensing.active_sessions
    SET is_active = false
    WHERE is_active = true
      AND last_heartbeat < NOW() - INTERVAL '10 minutes';

    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    RETURN affected_rows;
END;
$$;


--
-- Name: get_features_for_tier_level(integer); Type: FUNCTION; Schema: licensing; Owner: -
--

CREATE FUNCTION licensing.get_features_for_tier_level(p_tier_level integer) RETURNS TABLE(feature_id uuid, feature_key character varying, display_name character varying, description text, feature_category character varying, is_implemented boolean, minimum_tier_key character varying, minimum_tier_level integer)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        f.id AS feature_id,
        f.feature_key,
        f.display_name,
        f.description,
        f.feature_category,
        f.is_implemented,
        t.tier_key AS minimum_tier_key,
        t.tier_level AS minimum_tier_level
    FROM licensing.feature_definitions f
    JOIN licensing.tier_features tf ON tf.feature_id = f.id
    JOIN licensing.tiers t ON t.id = tf.tier_id
    WHERE t.tier_level <= p_tier_level
      AND f.is_active = TRUE
      AND t.is_active = TRUE
    ORDER BY t.tier_level ASC, f.feature_key ASC;
END;
$$;


--
-- Name: tier_has_feature(character varying, character varying); Type: FUNCTION; Schema: licensing; Owner: -
--

CREATE FUNCTION licensing.tier_has_feature(p_tier_key character varying, p_feature_key character varying) RETURNS boolean
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
    v_tier_level INTEGER;
    v_feature_tier_level INTEGER;
BEGIN
    -- Get the user's tier level
    SELECT tier_level INTO v_tier_level
    FROM licensing.tiers
    WHERE tier_key = p_tier_key AND is_active = TRUE;

    IF v_tier_level IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Get the minimum tier level required for this feature
    SELECT t.tier_level INTO v_feature_tier_level
    FROM licensing.feature_definitions f
    JOIN licensing.tier_features tf ON tf.feature_id = f.id
    JOIN licensing.tiers t ON t.id = tf.tier_id
    WHERE f.feature_key = p_feature_key
      AND f.is_active = TRUE
      AND t.is_active = TRUE;

    IF v_feature_tier_level IS NULL THEN
        RETURN FALSE;
    END IF;

    -- User has feature if their tier level >= feature's minimum tier level
    RETURN v_tier_level >= v_feature_tier_level;
END;
$$;


--
-- Name: update_activation_timestamp(); Type: FUNCTION; Schema: licensing; Owner: -
--

CREATE FUNCTION licensing.update_activation_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: licensing; Owner: -
--

CREATE FUNCTION licensing.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: ensure_single_latest_release(); Type: FUNCTION; Schema: releases; Owner: -
--

CREATE FUNCTION releases.ensure_single_latest_release() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- If setting this release as latest, unset all others for same product+platform+architecture
    IF NEW.is_latest = true AND (OLD IS NULL OR OLD.is_latest = false) THEN
        UPDATE releases.desktop_releases
        SET is_latest = false, updated_at = NOW()
        WHERE product = NEW.product
          AND platform = NEW.platform
          AND architecture = NEW.architecture
          AND id != NEW.id
          AND is_latest = true;
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: update_desktop_releases_updated_at(); Type: FUNCTION; Schema: releases; Owner: -
--

CREATE FUNCTION releases.update_desktop_releases_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: support; Owner: -
--

CREATE FUNCTION support.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: get_expired_recordings(integer); Type: FUNCTION; Schema: user_portal_settings; Owner: -
--

CREATE FUNCTION user_portal_settings.get_expired_recordings(p_batch_size integer DEFAULT 100) RETURNS TABLE(recording_id uuid, user_id uuid, storage_path text, file_name text, expires_at timestamp with time zone, transcript_id uuid)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        r.id AS recording_id,
        r.user_id,
        r.storage_path,
        r.file_name,
        r.expires_at,
        r.transcript_id
    FROM user_portal_settings.user_recordings r
    WHERE r.expires_at IS NOT NULL
      AND r.expires_at <= NOW()
      AND r.file_deleted = FALSE
    ORDER BY r.expires_at ASC
    LIMIT p_batch_size;
END;
$$;


--
-- Name: mark_recording_file_deleted(uuid); Type: FUNCTION; Schema: user_portal_settings; Owner: -
--

CREATE FUNCTION user_portal_settings.mark_recording_file_deleted(p_recording_id uuid) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
BEGIN
    UPDATE user_portal_settings.user_recordings
    SET
        file_deleted = TRUE,
        file_deleted_at = NOW(),
        storage_path = 'DELETED:' || storage_path,
        updated_at = NOW()
    WHERE id = p_recording_id
      AND file_deleted = FALSE;

    RETURN FOUND;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: user_portal_settings; Owner: -
--

CREATE FUNCTION user_portal_settings.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: backup_history; Type: TABLE; Schema: admin_settings; Owner: -
--

CREATE TABLE admin_settings.backup_history (
    id integer NOT NULL,
    backup_id character varying(255) NOT NULL,
    backup_type character varying(50) NOT NULL,
    status character varying(50) NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    duration_seconds integer,
    options jsonb DEFAULT '{}'::jsonb NOT NULL,
    file_path character varying(500),
    file_size bigint,
    checksum character varying(64),
    compressed boolean DEFAULT true,
    total_records bigint,
    total_tables integer,
    error_message text,
    error_stack text,
    created_by character varying(255),
    created_by_email character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT backup_history_backup_type_check CHECK (((backup_type)::text = ANY (ARRAY[('manual'::character varying)::text, ('scheduled'::character varying)::text]))),
    CONSTRAINT backup_history_status_check CHECK (((status)::text = ANY (ARRAY[('running'::character varying)::text, ('completed'::character varying)::text, ('failed'::character varying)::text])))
);


--
-- Name: backup_history_id_seq; Type: SEQUENCE; Schema: admin_settings; Owner: -
--

CREATE SEQUENCE admin_settings.backup_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: backup_history_id_seq; Type: SEQUENCE OWNED BY; Schema: admin_settings; Owner: -
--

ALTER SEQUENCE admin_settings.backup_history_id_seq OWNED BY admin_settings.backup_history.id;


--
-- Name: navigation_items; Type: TABLE; Schema: admin_settings; Owner: -
--

CREATE TABLE admin_settings.navigation_items (
    id integer NOT NULL,
    nav_id character varying(100) NOT NULL,
    title character varying(255) NOT NULL,
    href character varying(500),
    icon character varying(100),
    parent_id integer,
    order_index integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: navigation_items_id_seq; Type: SEQUENCE; Schema: admin_settings; Owner: -
--

CREATE SEQUENCE admin_settings.navigation_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: navigation_items_id_seq; Type: SEQUENCE OWNED BY; Schema: admin_settings; Owner: -
--

ALTER SEQUENCE admin_settings.navigation_items_id_seq OWNED BY admin_settings.navigation_items.id;


--
-- Name: prompt_templates; Type: TABLE; Schema: admin_settings; Owner: -
--

CREATE TABLE admin_settings.prompt_templates (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    name text NOT NULL,
    system_prompt text NOT NULL,
    output_structure text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: route_permissions; Type: TABLE; Schema: admin_settings; Owner: -
--

CREATE TABLE admin_settings.route_permissions (
    id integer NOT NULL,
    route_key character varying(255) NOT NULL,
    http_method character varying(10) DEFAULT 'GET'::character varying,
    path_pattern character varying(500) NOT NULL,
    description text,
    service_name character varying(50) DEFAULT 'portal'::character varying,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    permission_resource character varying(64),
    permission_action character varying(32),
    route_category character varying(20) DEFAULT 'admin'::character varying
);


--
-- Name: route_role_access; Type: TABLE; Schema: admin_settings; Owner: -
--

CREATE TABLE admin_settings.route_role_access (
    id integer NOT NULL,
    route_id integer NOT NULL,
    role character varying(50) NOT NULL
);


--
-- Name: role_permission_map; Type: VIEW; Schema: admin_settings; Owner: -
--

CREATE VIEW admin_settings.role_permission_map AS
 SELECT DISTINCT rra.role,
    rp.permission_resource,
    rp.permission_action,
    (((rp.permission_resource)::text || ':'::text) || (rp.permission_action)::text) AS permission_code,
    rp.route_category
   FROM (admin_settings.route_role_access rra
     JOIN admin_settings.route_permissions rp ON ((rp.id = rra.route_id)))
  WHERE ((rp.is_active = true) AND (rp.permission_resource IS NOT NULL) AND (rp.permission_action IS NOT NULL));


--
-- Name: route_access_audit; Type: TABLE; Schema: admin_settings; Owner: -
--

CREATE TABLE admin_settings.route_access_audit (
    id integer NOT NULL,
    route_key character varying(255) NOT NULL,
    action character varying(50) NOT NULL,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now(),
    previous_value jsonb,
    new_value jsonb
);


--
-- Name: route_access_audit_id_seq; Type: SEQUENCE; Schema: admin_settings; Owner: -
--

CREATE SEQUENCE admin_settings.route_access_audit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: route_access_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: admin_settings; Owner: -
--

ALTER SEQUENCE admin_settings.route_access_audit_id_seq OWNED BY admin_settings.route_access_audit.id;


--
-- Name: route_permissions_id_seq; Type: SEQUENCE; Schema: admin_settings; Owner: -
--

CREATE SEQUENCE admin_settings.route_permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: route_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: admin_settings; Owner: -
--

ALTER SEQUENCE admin_settings.route_permissions_id_seq OWNED BY admin_settings.route_permissions.id;


--
-- Name: route_role_access_id_seq; Type: SEQUENCE; Schema: admin_settings; Owner: -
--

CREATE SEQUENCE admin_settings.route_role_access_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: route_role_access_id_seq; Type: SEQUENCE OWNED BY; Schema: admin_settings; Owner: -
--

ALTER SEQUENCE admin_settings.route_role_access_id_seq OWNED BY admin_settings.route_role_access.id;


--
-- Name: system_settings; Type: TABLE; Schema: admin_settings; Owner: -
--

CREATE TABLE admin_settings.system_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key character varying(100) NOT NULL,
    value jsonb NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: cached_events; Type: TABLE; Schema: calendar; Owner: -
--

CREATE TABLE calendar.cached_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    microsoft_event_id text NOT NULL,
    calendar_id text,
    subject text NOT NULL,
    body_preview text,
    location text,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone NOT NULL,
    is_all_day boolean DEFAULT false NOT NULL,
    timezone text,
    is_cancelled boolean DEFAULT false NOT NULL,
    is_online_meeting boolean DEFAULT false,
    online_meeting_url text,
    organizer_email text,
    organizer_name text,
    raw_payload jsonb,
    last_modified_at timestamp with time zone,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: outlook_connections; Type: TABLE; Schema: calendar; Owner: -
--

CREATE TABLE calendar.outlook_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    access_token text NOT NULL,
    refresh_token text,
    token_expires_at timestamp with time zone NOT NULL,
    microsoft_user_id text,
    microsoft_email text,
    is_connected boolean DEFAULT true NOT NULL,
    last_sync_at timestamp with time zone,
    sync_status text DEFAULT 'pending'::text,
    sync_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: binder_content; Type: TABLE; Schema: client_sync; Owner: -
--

CREATE TABLE client_sync.binder_content (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    entity_id uuid NOT NULL,
    name text NOT NULL,
    sort_index integer DEFAULT 0 NOT NULL,
    color text,
    icon text,
    is_team_shared boolean DEFAULT false NOT NULL,
    binder_type text DEFAULT 'USER'::text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted boolean DEFAULT false NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    server_updated_at bigint NOT NULL,
    is_conflicts boolean DEFAULT false NOT NULL,
    CONSTRAINT binder_content_binder_type_check CHECK ((binder_type = ANY (ARRAY['USER'::text, 'SYSTEM'::text])))
);


--
-- Name: device_cursors; Type: TABLE; Schema: client_sync; Owner: -
--

CREATE TABLE client_sync.device_cursors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    device_id uuid NOT NULL,
    device_name text NOT NULL,
    last_sync_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_cursor bigint DEFAULT 0 NOT NULL,
    device_time_skew_ms bigint,
    clock_suspect boolean DEFAULT false NOT NULL,
    last_client_time_ms bigint
);


--
-- Name: note_content; Type: TABLE; Schema: client_sync; Owner: -
--

CREATE TABLE client_sync.note_content (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    entity_id uuid NOT NULL,
    binder_id uuid NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    notes text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted boolean DEFAULT false NOT NULL,
    pinned boolean DEFAULT false NOT NULL,
    starred boolean DEFAULT false NOT NULL,
    archived boolean DEFAULT false NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    server_updated_at bigint NOT NULL,
    is_conflict boolean DEFAULT false NOT NULL,
    conflict_of_id uuid,
    conflict_created_at bigint
);


--
-- Name: note_tag_content; Type: TABLE; Schema: client_sync; Owner: -
--

CREATE TABLE client_sync.note_tag_content (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    entity_id uuid NOT NULL,
    note_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted boolean DEFAULT false NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    server_updated_at bigint NOT NULL
);


--
-- Name: summary_content; Type: TABLE; Schema: client_sync; Owner: -
--

CREATE TABLE client_sync.summary_content (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    entity_id uuid NOT NULL,
    note_id uuid NOT NULL,
    summary_text text NOT NULL,
    model_version text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted boolean DEFAULT false NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    server_updated_at bigint NOT NULL,
    transcription_id uuid
);


--
-- Name: sync_changes; Type: TABLE; Schema: client_sync; Owner: -
--

CREATE TABLE client_sync.sync_changes (
    seq bigint NOT NULL,
    user_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    op text NOT NULL,
    version integer NOT NULL,
    server_updated_at bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sync_changes_entity_type_check CHECK ((entity_type = ANY (ARRAY['binders'::text, 'notes'::text, 'transcriptions'::text, 'summaries'::text, 'tags'::text, 'note_tags'::text]))),
    CONSTRAINT sync_changes_op_check CHECK ((op = ANY (ARRAY['upsert'::text, 'delete'::text])))
);


--
-- Name: sync_changes_seq_seq; Type: SEQUENCE; Schema: client_sync; Owner: -
--

CREATE SEQUENCE client_sync.sync_changes_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sync_changes_seq_seq; Type: SEQUENCE OWNED BY; Schema: client_sync; Owner: -
--

ALTER SEQUENCE client_sync.sync_changes_seq_seq OWNED BY client_sync.sync_changes.seq;


--
-- Name: sync_mutations; Type: TABLE; Schema: client_sync; Owner: -
--

CREATE TABLE client_sync.sync_mutations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    device_id uuid NOT NULL,
    mutation_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    op text NOT NULL,
    base_version integer,
    applied_seq bigint,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reason text,
    server_version integer,
    result_server_updated_at bigint,
    result_version integer,
    canonical_entity_id uuid,
    server_entity jsonb,
    CONSTRAINT sync_mutations_entity_type_check CHECK ((entity_type = ANY (ARRAY['binders'::text, 'notes'::text, 'transcriptions'::text, 'summaries'::text, 'tags'::text, 'note_tags'::text]))),
    CONSTRAINT sync_mutations_op_check CHECK ((op = ANY (ARRAY['upsert'::text, 'delete'::text]))),
    CONSTRAINT sync_mutations_status_check CHECK ((status = ANY (ARRAY['applied'::text, 'conflict'::text, 'rejected'::text, 'ignored'::text])))
);


--
-- Name: sync_operations; Type: TABLE; Schema: client_sync; Owner: -
--

CREATE TABLE client_sync.sync_operations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    device_id uuid NOT NULL,
    operation_type text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    duration_ms integer,
    success boolean DEFAULT false NOT NULL,
    error_message text,
    entities_changed integer DEFAULT 0 NOT NULL,
    conflicts_resolved integer DEFAULT 0 NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sync_operations_operation_type_check CHECK ((operation_type = ANY (ARRAY['state'::text, 'diff'::text, 'merge'::text, 'sync'::text, 'snapshot'::text, 'push'::text, 'pull'::text])))
);


--
-- Name: tag_content; Type: TABLE; Schema: client_sync; Owner: -
--

CREATE TABLE client_sync.tag_content (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    entity_id uuid NOT NULL,
    name text NOT NULL,
    color text,
    sort_index integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted boolean DEFAULT false NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    server_updated_at bigint NOT NULL
);


--
-- Name: transcription_content; Type: TABLE; Schema: client_sync; Owner: -
--

CREATE TABLE client_sync.transcription_content (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    entity_id uuid NOT NULL,
    note_id uuid NOT NULL,
    text text NOT NULL,
    speaker_name text,
    start_time timestamp with time zone,
    end_time timestamp with time zone,
    confidence real,
    language text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted boolean DEFAULT false NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    server_updated_at bigint NOT NULL,
    original_text text,
    user_edited boolean DEFAULT false NOT NULL,
    binder_id uuid
);


--
-- Name: email_logs; Type: TABLE; Schema: email; Owner: -
--

CREATE TABLE email.email_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    correlation_id uuid,
    recipient character varying(255) NOT NULL,
    subject character varying(500) NOT NULL,
    template_name character varying(100),
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    error_message text,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    metadata jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT valid_status CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('sent'::character varying)::text, ('failed'::character varying)::text])))
);


--
-- Name: email_templates; Type: TABLE; Schema: email; Owner: -
--

CREATE TABLE email.email_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    subject character varying(500),
    html_content text NOT NULL,
    variables jsonb DEFAULT '[]'::jsonb,
    description character varying(500),
    is_base boolean DEFAULT false,
    updated_at timestamp with time zone DEFAULT now(),
    updated_by uuid,
    flow character varying(100),
    flow_order integer DEFAULT 0
);


--
-- Name: api_keys; Type: TABLE; Schema: global_auth; Owner: -
--

CREATE TABLE global_auth.api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    service_name text,
    key_hash text NOT NULL,
    salt text NOT NULL,
    scopes text[] DEFAULT ARRAY[]::text[],
    is_service boolean DEFAULT false,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_used_at timestamp with time zone
);


--
-- Name: email_verification_codes; Type: TABLE; Schema: global_auth; Owner: -
--

CREATE TABLE global_auth.email_verification_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email public.citext NOT NULL,
    code character varying(8) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone
);


--
-- Name: oauth_tokens; Type: TABLE; Schema: global_auth; Owner: -
--

CREATE TABLE global_auth.oauth_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider character varying(50) NOT NULL,
    access_token text NOT NULL,
    refresh_token text,
    expires_at timestamp with time zone,
    scope text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    token_type character varying(50) DEFAULT 'Bearer'::character varying
);


--
-- Name: sessions; Type: TABLE; Schema: global_auth; Owner: -
--

CREATE TABLE global_auth.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT chk_session_future_expiry CHECK ((expires_at > created_at))
);


--
-- Name: user_credentials; Type: TABLE; Schema: global_auth; Owner: -
--

CREATE TABLE global_auth.user_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email public.citext NOT NULL,
    password_hash text NOT NULL,
    role character varying(50) DEFAULT 'user'::character varying NOT NULL,
    first_name character varying(120),
    last_name character varying(120),
    is_active boolean DEFAULT true,
    email_verified boolean DEFAULT false,
    password_updated_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_protected boolean DEFAULT false,
    must_change_password boolean DEFAULT false
);


--
-- Name: active_sessions; Type: TABLE; Schema: licensing; Owner: -
--

CREATE TABLE licensing.active_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    client_id text NOT NULL,
    session_token text NOT NULL,
    license_id uuid,
    organization_id uuid,
    last_heartbeat timestamp with time zone NOT NULL,
    first_seen timestamp with time zone DEFAULT now() NOT NULL,
    client_version character varying(20),
    platform character varying(50),
    ip_address inet,
    is_active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: feature_definitions; Type: TABLE; Schema: licensing; Owner: -
--

CREATE TABLE licensing.feature_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    feature_key character varying(100) NOT NULL,
    display_name character varying(200) NOT NULL,
    description text,
    feature_category character varying(50) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_implemented boolean DEFAULT false NOT NULL,
    CONSTRAINT feature_definitions_feature_category_check CHECK (((feature_category)::text = ANY (ARRAY[('desktop'::character varying)::text, ('portal'::character varying)::text, ('both'::character varying)::text])))
);


--
-- Name: tier_features; Type: TABLE; Schema: licensing; Owner: -
--

CREATE TABLE licensing.tier_features (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tier_id uuid NOT NULL,
    feature_id uuid NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    granted_by uuid,
    notes text
);


--
-- Name: tiers; Type: TABLE; Schema: licensing; Owner: -
--

CREATE TABLE licensing.tiers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tier_key character varying(50) NOT NULL,
    display_name character varying(100) NOT NULL,
    description text,
    tier_level integer NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: effective_tier_features; Type: VIEW; Schema: licensing; Owner: -
--

CREATE VIEW licensing.effective_tier_features AS
 SELECT user_tier.tier_key AS user_tier,
    user_tier.tier_level AS user_tier_level,
    user_tier.display_name AS user_tier_name,
    f.feature_key,
    f.display_name AS feature_name,
    f.feature_category,
    f.is_implemented,
    feature_tier.tier_key AS minimum_tier,
    feature_tier.tier_level AS minimum_tier_level,
        CASE
            WHEN (feature_tier.tier_level < user_tier.tier_level) THEN 'inherited'::text
            ELSE 'native'::text
        END AS access_type
   FROM (((licensing.tiers user_tier
     CROSS JOIN licensing.feature_definitions f)
     JOIN licensing.tier_features tf ON ((tf.feature_id = f.id)))
     JOIN licensing.tiers feature_tier ON ((feature_tier.id = tf.tier_id)))
  WHERE ((f.is_active = true) AND (user_tier.is_active = true) AND (feature_tier.is_active = true) AND (feature_tier.tier_level <= user_tier.tier_level))
  ORDER BY user_tier.tier_level, feature_tier.tier_level, f.feature_key;


--
-- Name: license_activations; Type: TABLE; Schema: licensing; Owner: -
--

CREATE TABLE licensing.license_activations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    license_id uuid NOT NULL,
    user_email character varying(255) NOT NULL,
    user_email_hash character varying(64) NOT NULL,
    activated_at timestamp with time zone DEFAULT now() NOT NULL,
    deactivated_at timestamp with time zone,
    platform character varying(50),
    app_version character varying(50),
    activation_ip character varying(45),
    last_online_validation timestamp with time zone,
    offline_grace_deadline timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: license_validations; Type: TABLE; Schema: licensing; Owner: -
--

CREATE TABLE licensing.license_validations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    license_id uuid,
    license_key_hash text NOT NULL,
    is_valid boolean NOT NULL,
    validation_type character varying(20) NOT NULL,
    failure_reason text,
    validated_by_service character varying(50) NOT NULL,
    client_version character varying(20),
    ip_address inet,
    user_agent text,
    request_metadata jsonb DEFAULT '{}'::jsonb,
    validated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT license_validations_validation_type_check CHECK (((validation_type)::text = ANY (ARRAY[('online'::character varying)::text, ('offline'::character varying)::text])))
);


--
-- Name: licenses; Type: TABLE; Schema: licensing; Owner: -
--

CREATE TABLE licensing.licenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    license_key text NOT NULL,
    license_type character varying(20) NOT NULL,
    organization_id text,
    user_id uuid,
    features jsonb DEFAULT '[]'::jsonb NOT NULL,
    limits jsonb DEFAULT '{}'::jsonb NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    revocation_reason text,
    hardware_id text,
    issued_by uuid NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tier_key character varying(50) DEFAULT 'free'::character varying,
    tier_id uuid NOT NULL,
    grant_type licensing.license_grant_type DEFAULT 'purchase'::licensing.license_grant_type NOT NULL,
    activation_limit integer DEFAULT 1,
    activation_count integer DEFAULT 0,
    offline_grace_days integer DEFAULT 30,
    revalidation_interval_hours integer DEFAULT 168,
    CONSTRAINT licenses_license_type_check CHECK (((license_type)::text = ANY (ARRAY[('portal'::character varying)::text, ('desktop'::character varying)::text, ('notely-ai'::character varying)::text]))),
    CONSTRAINT valid_ownership CHECK (((((license_type)::text = 'portal'::text) AND (organization_id IS NOT NULL) AND (user_id IS NULL)) OR (((license_type)::text = 'desktop'::text) AND (organization_id IS NULL)) OR (((license_type)::text = 'notely-ai'::text) AND (organization_id IS NULL))))
);


--
-- Name: tier_feature_summary; Type: VIEW; Schema: licensing; Owner: -
--

CREATE VIEW licensing.tier_feature_summary AS
 SELECT t.tier_key,
    t.display_name AS tier_name,
    t.tier_level,
    f.feature_key,
    f.display_name AS feature_name,
    f.feature_category,
    f.is_implemented,
    f.description AS feature_description
   FROM ((licensing.tiers t
     JOIN licensing.tier_features tf ON ((tf.tier_id = t.id)))
     JOIN licensing.feature_definitions f ON ((f.id = tf.feature_id)))
  WHERE ((t.is_active = true) AND (f.is_active = true))
  ORDER BY t.tier_level, f.feature_key;


--
-- Name: v_licenses; Type: VIEW; Schema: licensing; Owner: -
--

CREATE VIEW licensing.v_licenses AS
 SELECT l.id AS license_id,
    l.license_key,
    l.license_type,
    l.organization_id,
    l.user_id,
    l.features,
    l.limits,
    l.issued_at,
    l.expires_at,
    l.revoked_at,
    l.revocation_reason,
    l.hardware_id,
    l.issued_by,
    l.notes,
    l.created_at,
    l.updated_at,
    l.tier_id,
    t.tier_key,
    t.display_name AS tier_name,
    t.tier_level,
    COALESCE(( SELECT array_agg(fd.feature_key ORDER BY fd.feature_key) AS array_agg
           FROM ((licensing.tier_features tf
             JOIN licensing.feature_definitions fd ON ((fd.id = tf.feature_id)))
             JOIN licensing.tiers t2 ON ((t2.id = tf.tier_id)))
          WHERE ((t2.tier_level <= t.tier_level) AND (fd.is_active = true))), ARRAY[]::character varying[]) AS tier_features
   FROM (licensing.licenses l
     LEFT JOIN licensing.tiers t ON ((t.id = l.tier_id)));


--
-- Name: v_tier_features; Type: VIEW; Schema: licensing; Owner: -
--

CREATE VIEW licensing.v_tier_features AS
 SELECT t.id AS tier_id,
    t.tier_key,
    t.display_name AS tier_name,
    t.tier_level,
    array_agg(f.feature_key ORDER BY f.feature_key) AS feature_keys,
    array_agg(f.display_name ORDER BY f.feature_key) AS feature_names
   FROM ((licensing.tiers t
     LEFT JOIN licensing.tier_features tf ON ((t.id = tf.tier_id)))
     LEFT JOIN licensing.feature_definitions f ON (((tf.feature_id = f.id) AND (f.is_active = true))))
  WHERE (t.is_active = true)
  GROUP BY t.id, t.tier_key, t.display_name, t.tier_level;


--
-- Name: v_tier_recording_quotas; Type: VIEW; Schema: licensing; Owner: -
--

CREATE VIEW licensing.v_tier_recording_quotas AS
 SELECT t.id AS tier_id,
    t.tier_key,
    t.display_name AS tier_name,
    t.tier_level,
    COALESCE(((t.metadata ->> 'recordings_enabled'::text))::boolean, false) AS recordings_enabled,
    COALESCE(((t.metadata ->> 'max_recording_file_size_bytes'::text))::bigint, (0)::bigint) AS max_file_size_bytes,
    COALESCE(((t.metadata ->> 'recording_retention_days'::text))::integer, 0) AS retention_days,
        CASE
            WHEN (((t.metadata ->> 'max_recording_file_size_bytes'::text))::bigint >= 1073741824) THEN (round((((t.metadata ->> 'max_recording_file_size_bytes'::text))::numeric / (1073741824)::numeric), 2) || ' GB'::text)
            WHEN (((t.metadata ->> 'max_recording_file_size_bytes'::text))::bigint >= 1048576) THEN (round((((t.metadata ->> 'max_recording_file_size_bytes'::text))::numeric / (1048576)::numeric), 2) || ' MB'::text)
            WHEN (((t.metadata ->> 'max_recording_file_size_bytes'::text))::bigint > 0) THEN (round((((t.metadata ->> 'max_recording_file_size_bytes'::text))::numeric / (1024)::numeric), 2) || ' KB'::text)
            ELSE 'Not allowed'::text
        END AS max_file_size_display
   FROM licensing.tiers t
  WHERE (t.is_active = true)
  ORDER BY t.tier_level;


--
-- Name: desktop_releases; Type: TABLE; Schema: releases; Owner: -
--

CREATE TABLE releases.desktop_releases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version character varying(50) NOT NULL,
    platform character varying(20) NOT NULL,
    file_name text NOT NULL,
    file_size bigint NOT NULL,
    file_path text NOT NULL,
    checksum character varying(64),
    release_notes text,
    min_version character varying(50),
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    is_latest boolean DEFAULT false NOT NULL,
    download_count integer DEFAULT 0 NOT NULL,
    created_by uuid,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    architecture character varying(20) DEFAULT 'x64'::character varying NOT NULL,
    product character varying(20) DEFAULT 'cloud'::character varying NOT NULL,
    CONSTRAINT desktop_releases_architecture_check CHECK (((architecture)::text = ANY (ARRAY[('x64'::character varying)::text, ('arm64'::character varying)::text, ('universal'::character varying)::text]))),
    CONSTRAINT desktop_releases_platform_check CHECK (((platform)::text = ANY (ARRAY[('windows'::character varying)::text, ('mac'::character varying)::text, ('linux'::character varying)::text]))),
    CONSTRAINT desktop_releases_product_check CHECK (((product)::text = ANY (ARRAY[('cloud'::character varying)::text, ('ai'::character varying)::text]))),
    CONSTRAINT desktop_releases_status_check CHECK (((status)::text = ANY (ARRAY[('draft'::character varying)::text, ('published'::character varying)::text, ('archived'::character varying)::text])))
);


--
-- Name: download_stats; Type: TABLE; Schema: releases; Owner: -
--

CREATE TABLE releases.download_stats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    platform character varying(20) NOT NULL,
    variant character varying(20) NOT NULL,
    file_name text,
    downloaded_at timestamp with time zone DEFAULT now() NOT NULL,
    user_agent text,
    ip_hash character varying(64),
    release_id uuid,
    product character varying(20) DEFAULT 'cloud'::character varying NOT NULL,
    CONSTRAINT download_stats_platform_check CHECK (((platform)::text = ANY (ARRAY[('windows'::character varying)::text, ('mac'::character varying)::text, ('linux'::character varying)::text]))),
    CONSTRAINT download_stats_product_check CHECK (((product)::text = ANY (ARRAY[('cloud'::character varying)::text, ('ai'::character varying)::text]))),
    CONSTRAINT download_stats_variant_check CHECK (((variant)::text = ANY (ARRAY[('x64'::character varying)::text, ('arm64'::character varying)::text, ('appimage'::character varying)::text, ('deb'::character varying)::text])))
);


--
-- Name: attachments; Type: TABLE; Schema: support; Owner: -
--

CREATE TABLE support.attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    message_id uuid,
    filename character varying(255) NOT NULL,
    content_type character varying(100),
    storage_path character varying(500) NOT NULL,
    size_bytes bigint,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: beta_signups; Type: TABLE; Schema: support; Owner: -
--

CREATE TABLE support.beta_signups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    first_name character varying(100) NOT NULL,
    last_name character varying(100) NOT NULL,
    email character varying(255) NOT NULL,
    terms_accepted_at timestamp with time zone DEFAULT now() NOT NULL,
    ip_address character varying(45),
    user_agent text,
    referrer text,
    created_at timestamp with time zone DEFAULT now(),
    confirmation_sent_at timestamp with time zone,
    admin_notified_at timestamp with time zone,
    notes text,
    status character varying(20) DEFAULT 'pending'::character varying,
    access_token_hash character varying(64),
    access_token_created_at timestamp with time zone,
    access_token_expires_at timestamp with time zone,
    access_token_used_at timestamp with time zone,
    access_token_used_by uuid,
    invitation_sent_at timestamp with time zone,
    invitation_sent_by uuid,
    product character varying(20) DEFAULT 'cloud'::character varying NOT NULL,
    user_id uuid,
    verification_code character varying(8),
    verification_code_expires_at timestamp with time zone,
    email_verified_at timestamp with time zone,
    verification_token_hash character varying(64),
    CONSTRAINT chk_beta_signups_product CHECK (((product)::text = ANY (ARRAY[('cloud'::character varying)::text, ('ai'::character varying)::text]))),
    CONSTRAINT valid_status CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('confirmed'::character varying)::text, ('invite_sent'::character varying)::text, ('converted'::character varying)::text, ('unsubscribed'::character varying)::text])))
);


--
-- Name: contact_submissions; Type: TABLE; Schema: support; Owner: -
--

CREATE TABLE support.contact_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    first_name character varying(100) NOT NULL,
    last_name character varying(100) NOT NULL,
    email character varying(255) NOT NULL,
    product character varying(20) NOT NULL,
    message text NOT NULL,
    ip_address character varying(45),
    user_agent text,
    referrer text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    support_notified_at timestamp with time zone,
    confirmation_sent_at timestamp with time zone,
    status character varying(20) DEFAULT 'new'::character varying NOT NULL
);


--
-- Name: diagnostics_bundles; Type: TABLE; Schema: support; Owner: -
--

CREATE TABLE support.diagnostics_bundles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    user_email character varying(255) NOT NULL,
    filename character varying(255) NOT NULL,
    storage_path character varying(500) NOT NULL,
    size_bytes bigint NOT NULL,
    app_version character varying(50),
    platform character varying(20),
    status character varying(20) DEFAULT 'pending_review'::character varying,
    scan_result character varying(20) DEFAULT 'pending'::character varying,
    scan_details text,
    admin_notes text,
    created_at timestamp with time zone DEFAULT now(),
    reviewed_at timestamp with time zone,
    reviewed_by uuid,
    os_version character varying(50),
    arch character varying(20),
    cpu_model character varying(200),
    cpu_cores smallint,
    total_memory_gb smallint,
    gpu_name character varying(200),
    analysis_status character varying(20) DEFAULT NULL::character varying,
    analysis_result text,
    analysis_error text,
    analysis_started_at timestamp with time zone,
    analysis_completed_at timestamp with time zone,
    analysis_requested_by uuid
);


--
-- Name: email_processing_log; Type: TABLE; Schema: support; Owner: -
--

CREATE TABLE support.email_processing_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email_message_id character varying(255) NOT NULL,
    ticket_id uuid,
    processed_at timestamp with time zone DEFAULT now(),
    status character varying(20) DEFAULT 'processed'::character varying
);


--
-- Name: messages; Type: TABLE; Schema: support; Owner: -
--

CREATE TABLE support.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    user_id uuid,
    sender_email character varying(255) NOT NULL,
    sender_name character varying(255),
    message text NOT NULL,
    is_internal boolean DEFAULT false,
    source character varying(20) DEFAULT 'portal'::character varying,
    email_message_id character varying(255),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: tickets; Type: TABLE; Schema: support; Owner: -
--

CREATE TABLE support.tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_number integer NOT NULL,
    user_id uuid NOT NULL,
    user_email character varying(255) NOT NULL,
    subject character varying(255) NOT NULL,
    description text NOT NULL,
    category character varying(50) DEFAULT 'general'::character varying,
    priority character varying(20) DEFAULT 'normal'::character varying,
    status character varying(20) DEFAULT 'open'::character varying,
    source character varying(20) DEFAULT 'portal'::character varying,
    assigned_to uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    resolved_at timestamp with time zone,
    closed_at timestamp with time zone,
    CONSTRAINT valid_priority CHECK (((priority)::text = ANY (ARRAY[('low'::character varying)::text, ('normal'::character varying)::text, ('high'::character varying)::text, ('urgent'::character varying)::text]))),
    CONSTRAINT valid_status CHECK (((status)::text = ANY (ARRAY[('open'::character varying)::text, ('in_progress'::character varying)::text, ('waiting'::character varying)::text, ('resolved'::character varying)::text, ('closed'::character varying)::text])))
);


--
-- Name: tickets_ticket_number_seq; Type: SEQUENCE; Schema: support; Owner: -
--

CREATE SEQUENCE support.tickets_ticket_number_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tickets_ticket_number_seq; Type: SEQUENCE OWNED BY; Schema: support; Owner: -
--

ALTER SEQUENCE support.tickets_ticket_number_seq OWNED BY support.tickets.ticket_number;


--
-- Name: user_preferences; Type: TABLE; Schema: user_portal_settings; Owner: -
--

CREATE TABLE user_portal_settings.user_preferences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    theme character varying(20) DEFAULT 'light'::character varying,
    sidebar_collapsed boolean DEFAULT false,
    notifications_enabled boolean DEFAULT true,
    timezone character varying(100) DEFAULT 'UTC'::character varying,
    language character varying(10) DEFAULT 'en'::character varying,
    preferences jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_recordings; Type: TABLE; Schema: user_portal_settings; Owner: -
--

CREATE TABLE user_portal_settings.user_recordings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    organization_id uuid,
    file_name text NOT NULL,
    file_size bigint NOT NULL,
    mime_type text NOT NULL,
    media_type text NOT NULL,
    storage_path text NOT NULL,
    status text DEFAULT 'uploaded'::text NOT NULL,
    duration_seconds integer,
    transcript_id uuid,
    checksum text,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    file_deleted boolean DEFAULT false NOT NULL,
    file_deleted_at timestamp with time zone,
    CONSTRAINT user_recordings_file_size_check CHECK ((file_size > 0)),
    CONSTRAINT user_recordings_media_type_check CHECK ((media_type = ANY (ARRAY['audio'::text, 'video'::text])))
);


--
-- Name: login_activity; Type: TABLE; Schema: user_profiles; Owner: -
--

CREATE TABLE user_profiles.login_activity (
    auth_user_id uuid NOT NULL,
    last_login_at timestamp with time zone NOT NULL,
    last_login_ip inet,
    last_login_user_agent text,
    login_count bigint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: user_profiles; Owner: -
--

CREATE TABLE user_profiles.profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    auth_user_id uuid NOT NULL,
    email public.citext,
    first_name character varying(120),
    last_name character varying(120),
    display_name character varying(255),
    avatar_url text,
    locale character varying(20) DEFAULT 'en-US'::character varying,
    time_zone character varying(64) DEFAULT 'UTC'::character varying,
    preferences jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: backup_history id; Type: DEFAULT; Schema: admin_settings; Owner: -
--

ALTER TABLE ONLY admin_settings.backup_history ALTER COLUMN id SET DEFAULT nextval('admin_settings.backup_history_id_seq'::regclass);


--
-- Name: navigation_items id; Type: DEFAULT; Schema: admin_settings; Owner: -
--

ALTER TABLE ONLY admin_settings.navigation_items ALTER COLUMN id SET DEFAULT nextval('admin_settings.navigation_items_id_seq'::regclass);


--
-- Name: route_access_audit id; Type: DEFAULT; Schema: admin_settings; Owner: -
--

ALTER TABLE ONLY admin_settings.route_access_audit ALTER COLUMN id SET DEFAULT nextval('admin_settings.route_access_audit_id_seq'::regclass);


--
-- Name: route_permissions id; Type: DEFAULT; Schema: admin_settings; Owner: -
--

ALTER TABLE ONLY admin_settings.route_permissions ALTER COLUMN id SET DEFAULT nextval('admin_settings.route_permissions_id_seq'::regclass);


--
-- Name: route_role_access id; Type: DEFAULT; Schema: admin_settings; Owner: -
--

ALTER TABLE ONLY admin_settings.route_role_access ALTER COLUMN id SET DEFAULT nextval('admin_settings.route_role_access_id_seq'::regclass);


--
-- Name: sync_changes seq; Type: DEFAULT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.sync_changes ALTER COLUMN seq SET DEFAULT nextval('client_sync.sync_changes_seq_seq'::regclass);


--
-- Name: tickets ticket_number; Type: DEFAULT; Schema: support; Owner: -
--

ALTER TABLE ONLY support.tickets ALTER COLUMN ticket_number SET DEFAULT nextval('support.tickets_ticket_number_seq'::regclass);


--
-- Name: backup_history backup_history_backup_id_key; Type: CONSTRAINT; Schema: admin_settings; Owner: -
--

ALTER TABLE ONLY admin_settings.backup_history
    ADD CONSTRAINT backup_history_backup_id_key UNIQUE (backup_id);


--
-- Name: backup_history backup_history_pkey; Type: CONSTRAINT; Schema: admin_settings; Owner: -
--

ALTER TABLE ONLY admin_settings.backup_history
    ADD CONSTRAINT backup_history_pkey PRIMARY KEY (id);


--
-- Name: navigation_items navigation_items_nav_id_key; Type: CONSTRAINT; Schema: admin_settings; Owner: -
--

ALTER TABLE ONLY admin_settings.navigation_items
    ADD CONSTRAINT navigation_items_nav_id_key UNIQUE (nav_id);


--
-- Name: navigation_items navigation_items_pkey; Type: CONSTRAINT; Schema: admin_settings; Owner: -
--

ALTER TABLE ONLY admin_settings.navigation_items
    ADD CONSTRAINT navigation_items_pkey PRIMARY KEY (id);


--
-- Name: prompt_templates prompt_templates_pkey; Type: CONSTRAINT; Schema: admin_settings; Owner: -
--

ALTER TABLE ONLY admin_settings.prompt_templates
    ADD CONSTRAINT prompt_templates_pkey PRIMARY KEY (id);


--
-- Name: route_access_audit route_access_audit_pkey; Type: CONSTRAINT; Schema: admin_settings; Owner: -
--

ALTER TABLE ONLY admin_settings.route_access_audit
    ADD CONSTRAINT route_access_audit_pkey PRIMARY KEY (id);


--
-- Name: route_permissions route_permissions_pkey; Type: CONSTRAINT; Schema: admin_settings; Owner: -
--

ALTER TABLE ONLY admin_settings.route_permissions
    ADD CONSTRAINT route_permissions_pkey PRIMARY KEY (id);


--
-- Name: route_permissions route_permissions_route_key_key; Type: CONSTRAINT; Schema: admin_settings; Owner: -
--

ALTER TABLE ONLY admin_settings.route_permissions
    ADD CONSTRAINT route_permissions_route_key_key UNIQUE (route_key);


--
-- Name: route_role_access route_role_access_pkey; Type: CONSTRAINT; Schema: admin_settings; Owner: -
--

ALTER TABLE ONLY admin_settings.route_role_access
    ADD CONSTRAINT route_role_access_pkey PRIMARY KEY (id);


--
-- Name: system_settings system_settings_key_key; Type: CONSTRAINT; Schema: admin_settings; Owner: -
--

ALTER TABLE ONLY admin_settings.system_settings
    ADD CONSTRAINT system_settings_key_key UNIQUE (key);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: admin_settings; Owner: -
--

ALTER TABLE ONLY admin_settings.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (id);


--
-- Name: route_role_access unique_route_role; Type: CONSTRAINT; Schema: admin_settings; Owner: -
--

ALTER TABLE ONLY admin_settings.route_role_access
    ADD CONSTRAINT unique_route_role UNIQUE (route_id, role);


--
-- Name: cached_events cached_events_pkey; Type: CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.cached_events
    ADD CONSTRAINT cached_events_pkey PRIMARY KEY (id);


--
-- Name: outlook_connections outlook_connections_pkey; Type: CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.outlook_connections
    ADD CONSTRAINT outlook_connections_pkey PRIMARY KEY (id);


--
-- Name: cached_events unique_user_event; Type: CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.cached_events
    ADD CONSTRAINT unique_user_event UNIQUE (user_id, microsoft_event_id);


--
-- Name: outlook_connections unique_user_outlook_connection; Type: CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.outlook_connections
    ADD CONSTRAINT unique_user_outlook_connection UNIQUE (user_id);


--
-- Name: binder_content binder_content_pkey; Type: CONSTRAINT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.binder_content
    ADD CONSTRAINT binder_content_pkey PRIMARY KEY (id);


--
-- Name: binder_content binder_content_user_entity_unique; Type: CONSTRAINT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.binder_content
    ADD CONSTRAINT binder_content_user_entity_unique UNIQUE (user_id, entity_id);


--
-- Name: device_cursors device_cursors_pkey; Type: CONSTRAINT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.device_cursors
    ADD CONSTRAINT device_cursors_pkey PRIMARY KEY (id);


--
-- Name: note_content note_content_pkey; Type: CONSTRAINT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.note_content
    ADD CONSTRAINT note_content_pkey PRIMARY KEY (id);


--
-- Name: note_content note_content_user_entity_unique; Type: CONSTRAINT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.note_content
    ADD CONSTRAINT note_content_user_entity_unique UNIQUE (user_id, entity_id);


--
-- Name: note_tag_content note_tag_content_note_tag_unique; Type: CONSTRAINT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.note_tag_content
    ADD CONSTRAINT note_tag_content_note_tag_unique UNIQUE (user_id, note_id, tag_id);


--
-- Name: note_tag_content note_tag_content_pkey; Type: CONSTRAINT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.note_tag_content
    ADD CONSTRAINT note_tag_content_pkey PRIMARY KEY (id);


--
-- Name: note_tag_content note_tag_content_user_entity_unique; Type: CONSTRAINT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.note_tag_content
    ADD CONSTRAINT note_tag_content_user_entity_unique UNIQUE (user_id, entity_id);


--
-- Name: summary_content summary_content_pkey; Type: CONSTRAINT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.summary_content
    ADD CONSTRAINT summary_content_pkey PRIMARY KEY (id);


--
-- Name: summary_content summary_content_user_entity_unique; Type: CONSTRAINT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.summary_content
    ADD CONSTRAINT summary_content_user_entity_unique UNIQUE (user_id, entity_id);


--
-- Name: sync_changes sync_changes_pkey; Type: CONSTRAINT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.sync_changes
    ADD CONSTRAINT sync_changes_pkey PRIMARY KEY (seq);


--
-- Name: sync_mutations sync_mutations_pkey; Type: CONSTRAINT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.sync_mutations
    ADD CONSTRAINT sync_mutations_pkey PRIMARY KEY (id);


--
-- Name: sync_mutations sync_mutations_unique; Type: CONSTRAINT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.sync_mutations
    ADD CONSTRAINT sync_mutations_unique UNIQUE (user_id, device_id, mutation_id);


--
-- Name: sync_operations sync_operations_pkey; Type: CONSTRAINT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.sync_operations
    ADD CONSTRAINT sync_operations_pkey PRIMARY KEY (id);


--
-- Name: tag_content tag_content_pkey; Type: CONSTRAINT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.tag_content
    ADD CONSTRAINT tag_content_pkey PRIMARY KEY (id);


--
-- Name: tag_content tag_content_user_entity_unique; Type: CONSTRAINT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.tag_content
    ADD CONSTRAINT tag_content_user_entity_unique UNIQUE (user_id, entity_id);


--
-- Name: transcription_content transcription_content_pkey; Type: CONSTRAINT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.transcription_content
    ADD CONSTRAINT transcription_content_pkey PRIMARY KEY (id);


--
-- Name: transcription_content transcription_content_user_entity_unique; Type: CONSTRAINT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.transcription_content
    ADD CONSTRAINT transcription_content_user_entity_unique UNIQUE (user_id, entity_id);


--
-- Name: email_logs email_logs_pkey; Type: CONSTRAINT; Schema: email; Owner: -
--

ALTER TABLE ONLY email.email_logs
    ADD CONSTRAINT email_logs_pkey PRIMARY KEY (id);


--
-- Name: email_templates email_templates_name_key; Type: CONSTRAINT; Schema: email; Owner: -
--

ALTER TABLE ONLY email.email_templates
    ADD CONSTRAINT email_templates_name_key UNIQUE (name);


--
-- Name: email_templates email_templates_pkey; Type: CONSTRAINT; Schema: email; Owner: -
--

ALTER TABLE ONLY email.email_templates
    ADD CONSTRAINT email_templates_pkey PRIMARY KEY (id);


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: global_auth; Owner: -
--

ALTER TABLE ONLY global_auth.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);


--
-- Name: email_verification_codes email_verification_codes_pkey; Type: CONSTRAINT; Schema: global_auth; Owner: -
--

ALTER TABLE ONLY global_auth.email_verification_codes
    ADD CONSTRAINT email_verification_codes_pkey PRIMARY KEY (id);


--
-- Name: oauth_tokens oauth_tokens_pkey; Type: CONSTRAINT; Schema: global_auth; Owner: -
--

ALTER TABLE ONLY global_auth.oauth_tokens
    ADD CONSTRAINT oauth_tokens_pkey PRIMARY KEY (id);


--
-- Name: oauth_tokens oauth_tokens_user_id_provider_key; Type: CONSTRAINT; Schema: global_auth; Owner: -
--

ALTER TABLE ONLY global_auth.oauth_tokens
    ADD CONSTRAINT oauth_tokens_user_id_provider_key UNIQUE (user_id, provider);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: global_auth; Owner: -
--

ALTER TABLE ONLY global_auth.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_token_key; Type: CONSTRAINT; Schema: global_auth; Owner: -
--

ALTER TABLE ONLY global_auth.sessions
    ADD CONSTRAINT sessions_token_key UNIQUE (token);


--
-- Name: user_credentials user_credentials_email_key; Type: CONSTRAINT; Schema: global_auth; Owner: -
--

ALTER TABLE ONLY global_auth.user_credentials
    ADD CONSTRAINT user_credentials_email_key UNIQUE (email);


--
-- Name: user_credentials user_credentials_pkey; Type: CONSTRAINT; Schema: global_auth; Owner: -
--

ALTER TABLE ONLY global_auth.user_credentials
    ADD CONSTRAINT user_credentials_pkey PRIMARY KEY (id);


--
-- Name: active_sessions active_sessions_pkey; Type: CONSTRAINT; Schema: licensing; Owner: -
--

ALTER TABLE ONLY licensing.active_sessions
    ADD CONSTRAINT active_sessions_pkey PRIMARY KEY (id);


--
-- Name: active_sessions active_sessions_session_token_key; Type: CONSTRAINT; Schema: licensing; Owner: -
--

ALTER TABLE ONLY licensing.active_sessions
    ADD CONSTRAINT active_sessions_session_token_key UNIQUE (session_token);


--
-- Name: feature_definitions feature_definitions_feature_key_key; Type: CONSTRAINT; Schema: licensing; Owner: -
--

ALTER TABLE ONLY licensing.feature_definitions
    ADD CONSTRAINT feature_definitions_feature_key_key UNIQUE (feature_key);


--
-- Name: feature_definitions feature_definitions_pkey; Type: CONSTRAINT; Schema: licensing; Owner: -
--

ALTER TABLE ONLY licensing.feature_definitions
    ADD CONSTRAINT feature_definitions_pkey PRIMARY KEY (id);


--
-- Name: license_activations license_activations_pkey; Type: CONSTRAINT; Schema: licensing; Owner: -
--

ALTER TABLE ONLY licensing.license_activations
    ADD CONSTRAINT license_activations_pkey PRIMARY KEY (id);


--
-- Name: license_validations license_validations_pkey; Type: CONSTRAINT; Schema: licensing; Owner: -
--

ALTER TABLE ONLY licensing.license_validations
    ADD CONSTRAINT license_validations_pkey PRIMARY KEY (id);


--
-- Name: licenses licenses_license_key_key; Type: CONSTRAINT; Schema: licensing; Owner: -
--

ALTER TABLE ONLY licensing.licenses
    ADD CONSTRAINT licenses_license_key_key UNIQUE (license_key);


--
-- Name: licenses licenses_pkey; Type: CONSTRAINT; Schema: licensing; Owner: -
--

ALTER TABLE ONLY licensing.licenses
    ADD CONSTRAINT licenses_pkey PRIMARY KEY (id);


--
-- Name: tier_features tier_features_pkey; Type: CONSTRAINT; Schema: licensing; Owner: -
--

ALTER TABLE ONLY licensing.tier_features
    ADD CONSTRAINT tier_features_pkey PRIMARY KEY (id);


--
-- Name: tier_features tier_features_unique; Type: CONSTRAINT; Schema: licensing; Owner: -
--

ALTER TABLE ONLY licensing.tier_features
    ADD CONSTRAINT tier_features_unique UNIQUE (tier_id, feature_id);


--
-- Name: tiers tiers_pkey; Type: CONSTRAINT; Schema: licensing; Owner: -
--

ALTER TABLE ONLY licensing.tiers
    ADD CONSTRAINT tiers_pkey PRIMARY KEY (id);


--
-- Name: tiers tiers_tier_key_key; Type: CONSTRAINT; Schema: licensing; Owner: -
--

ALTER TABLE ONLY licensing.tiers
    ADD CONSTRAINT tiers_tier_key_key UNIQUE (tier_key);


--
-- Name: tiers tiers_tier_level_key; Type: CONSTRAINT; Schema: licensing; Owner: -
--

ALTER TABLE ONLY licensing.tiers
    ADD CONSTRAINT tiers_tier_level_key UNIQUE (tier_level);


--
-- Name: license_activations uq_license_email; Type: CONSTRAINT; Schema: licensing; Owner: -
--

ALTER TABLE ONLY licensing.license_activations
    ADD CONSTRAINT uq_license_email UNIQUE (license_id, user_email_hash);


--
-- Name: desktop_releases desktop_releases_pkey; Type: CONSTRAINT; Schema: releases; Owner: -
--

ALTER TABLE ONLY releases.desktop_releases
    ADD CONSTRAINT desktop_releases_pkey PRIMARY KEY (id);


--
-- Name: download_stats download_stats_pkey; Type: CONSTRAINT; Schema: releases; Owner: -
--

ALTER TABLE ONLY releases.download_stats
    ADD CONSTRAINT download_stats_pkey PRIMARY KEY (id);


--
-- Name: desktop_releases unique_version_platform_architecture_product; Type: CONSTRAINT; Schema: releases; Owner: -
--

ALTER TABLE ONLY releases.desktop_releases
    ADD CONSTRAINT unique_version_platform_architecture_product UNIQUE (version, platform, architecture, product);


--
-- Name: attachments attachments_pkey; Type: CONSTRAINT; Schema: support; Owner: -
--

ALTER TABLE ONLY support.attachments
    ADD CONSTRAINT attachments_pkey PRIMARY KEY (id);


--
-- Name: beta_signups beta_signups_pkey; Type: CONSTRAINT; Schema: support; Owner: -
--

ALTER TABLE ONLY support.beta_signups
    ADD CONSTRAINT beta_signups_pkey PRIMARY KEY (id);


--
-- Name: contact_submissions contact_submissions_pkey; Type: CONSTRAINT; Schema: support; Owner: -
--

ALTER TABLE ONLY support.contact_submissions
    ADD CONSTRAINT contact_submissions_pkey PRIMARY KEY (id);


--
-- Name: diagnostics_bundles diagnostics_bundles_pkey; Type: CONSTRAINT; Schema: support; Owner: -
--

ALTER TABLE ONLY support.diagnostics_bundles
    ADD CONSTRAINT diagnostics_bundles_pkey PRIMARY KEY (id);


--
-- Name: email_processing_log email_processing_log_email_message_id_key; Type: CONSTRAINT; Schema: support; Owner: -
--

ALTER TABLE ONLY support.email_processing_log
    ADD CONSTRAINT email_processing_log_email_message_id_key UNIQUE (email_message_id);


--
-- Name: email_processing_log email_processing_log_pkey; Type: CONSTRAINT; Schema: support; Owner: -
--

ALTER TABLE ONLY support.email_processing_log
    ADD CONSTRAINT email_processing_log_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: support; Owner: -
--

ALTER TABLE ONLY support.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: tickets tickets_pkey; Type: CONSTRAINT; Schema: support; Owner: -
--

ALTER TABLE ONLY support.tickets
    ADD CONSTRAINT tickets_pkey PRIMARY KEY (id);


--
-- Name: user_preferences unique_user_preferences; Type: CONSTRAINT; Schema: user_portal_settings; Owner: -
--

ALTER TABLE ONLY user_portal_settings.user_preferences
    ADD CONSTRAINT unique_user_preferences UNIQUE (user_id);


--
-- Name: user_preferences user_preferences_pkey; Type: CONSTRAINT; Schema: user_portal_settings; Owner: -
--

ALTER TABLE ONLY user_portal_settings.user_preferences
    ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (id);


--
-- Name: user_recordings user_recordings_pkey; Type: CONSTRAINT; Schema: user_portal_settings; Owner: -
--

ALTER TABLE ONLY user_portal_settings.user_recordings
    ADD CONSTRAINT user_recordings_pkey PRIMARY KEY (id);


--
-- Name: login_activity login_activity_pkey; Type: CONSTRAINT; Schema: user_profiles; Owner: -
--

ALTER TABLE ONLY user_profiles.login_activity
    ADD CONSTRAINT login_activity_pkey PRIMARY KEY (auth_user_id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: user_profiles; Owner: -
--

ALTER TABLE ONLY user_profiles.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: idx_backup_history_backup_id; Type: INDEX; Schema: admin_settings; Owner: -
--

CREATE INDEX idx_backup_history_backup_id ON admin_settings.backup_history USING btree (backup_id);


--
-- Name: idx_backup_history_backup_type; Type: INDEX; Schema: admin_settings; Owner: -
--

CREATE INDEX idx_backup_history_backup_type ON admin_settings.backup_history USING btree (backup_type);


--
-- Name: idx_backup_history_started_at; Type: INDEX; Schema: admin_settings; Owner: -
--

CREATE INDEX idx_backup_history_started_at ON admin_settings.backup_history USING btree (started_at DESC);


--
-- Name: idx_backup_history_status; Type: INDEX; Schema: admin_settings; Owner: -
--

CREATE INDEX idx_backup_history_status ON admin_settings.backup_history USING btree (status);


--
-- Name: idx_navigation_items_active; Type: INDEX; Schema: admin_settings; Owner: -
--

CREATE INDEX idx_navigation_items_active ON admin_settings.navigation_items USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_navigation_items_order; Type: INDEX; Schema: admin_settings; Owner: -
--

CREATE INDEX idx_navigation_items_order ON admin_settings.navigation_items USING btree (order_index);


--
-- Name: idx_navigation_items_parent_id; Type: INDEX; Schema: admin_settings; Owner: -
--

CREATE INDEX idx_navigation_items_parent_id ON admin_settings.navigation_items USING btree (parent_id);


--
-- Name: idx_route_access_audit_changed_at_portal; Type: INDEX; Schema: admin_settings; Owner: -
--

CREATE INDEX idx_route_access_audit_changed_at_portal ON admin_settings.route_access_audit USING btree (changed_at);


--
-- Name: idx_route_access_audit_key_portal; Type: INDEX; Schema: admin_settings; Owner: -
--

CREATE INDEX idx_route_access_audit_key_portal ON admin_settings.route_access_audit USING btree (route_key);


--
-- Name: idx_route_permissions_active_portal; Type: INDEX; Schema: admin_settings; Owner: -
--

CREATE INDEX idx_route_permissions_active_portal ON admin_settings.route_permissions USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_route_permissions_service_portal; Type: INDEX; Schema: admin_settings; Owner: -
--

CREATE INDEX idx_route_permissions_service_portal ON admin_settings.route_permissions USING btree (service_name);


--
-- Name: idx_route_role_access_role_portal; Type: INDEX; Schema: admin_settings; Owner: -
--

CREATE INDEX idx_route_role_access_role_portal ON admin_settings.route_role_access USING btree (role);


--
-- Name: idx_route_role_access_route_portal; Type: INDEX; Schema: admin_settings; Owner: -
--

CREATE INDEX idx_route_role_access_route_portal ON admin_settings.route_role_access USING btree (route_id);


--
-- Name: idx_system_settings_key; Type: INDEX; Schema: admin_settings; Owner: -
--

CREATE INDEX idx_system_settings_key ON admin_settings.system_settings USING btree (key);


--
-- Name: idx_cached_events_connection; Type: INDEX; Schema: calendar; Owner: -
--

CREATE INDEX idx_cached_events_connection ON calendar.cached_events USING btree (connection_id);


--
-- Name: idx_cached_events_synced; Type: INDEX; Schema: calendar; Owner: -
--

CREATE INDEX idx_cached_events_synced ON calendar.cached_events USING btree (synced_at);


--
-- Name: idx_cached_events_user_time; Type: INDEX; Schema: calendar; Owner: -
--

CREATE INDEX idx_cached_events_user_time ON calendar.cached_events USING btree (user_id, start_time, end_time);


--
-- Name: idx_outlook_connections_token_expires; Type: INDEX; Schema: calendar; Owner: -
--

CREATE INDEX idx_outlook_connections_token_expires ON calendar.outlook_connections USING btree (token_expires_at) WHERE (is_connected = true);


--
-- Name: idx_outlook_connections_user_id; Type: INDEX; Schema: calendar; Owner: -
--

CREATE INDEX idx_outlook_connections_user_id ON calendar.outlook_connections USING btree (user_id);


--
-- Name: idx_binder_content_conflicts_unique; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE UNIQUE INDEX idx_binder_content_conflicts_unique ON client_sync.binder_content USING btree (user_id) WHERE (is_conflicts = true);


--
-- Name: idx_binder_content_deleted; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_binder_content_deleted ON client_sync.binder_content USING btree (user_id, deleted) WHERE (deleted = false);


--
-- Name: idx_binder_content_entity_id; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_binder_content_entity_id ON client_sync.binder_content USING btree (entity_id);


--
-- Name: idx_binder_content_server_updated; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_binder_content_server_updated ON client_sync.binder_content USING btree (user_id, server_updated_at);


--
-- Name: idx_binder_content_updated_at; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_binder_content_updated_at ON client_sync.binder_content USING btree (updated_at DESC);


--
-- Name: idx_binder_content_user_id; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_binder_content_user_id ON client_sync.binder_content USING btree (user_id);


--
-- Name: idx_binder_content_version; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_binder_content_version ON client_sync.binder_content USING btree (user_id, entity_id, version);


--
-- Name: idx_device_cursors_last_sync; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_device_cursors_last_sync ON client_sync.device_cursors USING btree (user_id, last_sync_at DESC);


--
-- Name: idx_device_cursors_unique_device; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE UNIQUE INDEX idx_device_cursors_unique_device ON client_sync.device_cursors USING btree (user_id, device_id);


--
-- Name: idx_note_content_binder_id; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_note_content_binder_id ON client_sync.note_content USING btree (binder_id);


--
-- Name: idx_note_content_conflict_of; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_note_content_conflict_of ON client_sync.note_content USING btree (conflict_of_id) WHERE (conflict_of_id IS NOT NULL);


--
-- Name: idx_note_content_deleted; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_note_content_deleted ON client_sync.note_content USING btree (user_id, deleted) WHERE (deleted = false);


--
-- Name: idx_note_content_entity_id; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_note_content_entity_id ON client_sync.note_content USING btree (entity_id);


--
-- Name: idx_note_content_is_conflict; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_note_content_is_conflict ON client_sync.note_content USING btree (user_id, is_conflict) WHERE (is_conflict = true);


--
-- Name: idx_note_content_pinned; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_note_content_pinned ON client_sync.note_content USING btree (user_id, pinned) WHERE ((pinned = true) AND (deleted = false));


--
-- Name: idx_note_content_server_updated; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_note_content_server_updated ON client_sync.note_content USING btree (user_id, server_updated_at);


--
-- Name: idx_note_content_starred; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_note_content_starred ON client_sync.note_content USING btree (user_id, starred) WHERE ((starred = true) AND (deleted = false));


--
-- Name: idx_note_content_updated_at; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_note_content_updated_at ON client_sync.note_content USING btree (updated_at DESC);


--
-- Name: idx_note_content_user_id; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_note_content_user_id ON client_sync.note_content USING btree (user_id);


--
-- Name: idx_note_content_version; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_note_content_version ON client_sync.note_content USING btree (user_id, entity_id, version);


--
-- Name: idx_note_tag_content_deleted; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_note_tag_content_deleted ON client_sync.note_tag_content USING btree (user_id, deleted) WHERE (deleted = false);


--
-- Name: idx_note_tag_content_entity_id; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_note_tag_content_entity_id ON client_sync.note_tag_content USING btree (entity_id);


--
-- Name: idx_note_tag_content_note_deleted; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_note_tag_content_note_deleted ON client_sync.note_tag_content USING btree (note_id, deleted) WHERE (deleted = false);


--
-- Name: idx_note_tag_content_note_id; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_note_tag_content_note_id ON client_sync.note_tag_content USING btree (note_id);


--
-- Name: idx_note_tag_content_server_updated; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_note_tag_content_server_updated ON client_sync.note_tag_content USING btree (user_id, server_updated_at);


--
-- Name: idx_note_tag_content_tag_deleted; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_note_tag_content_tag_deleted ON client_sync.note_tag_content USING btree (tag_id, deleted) WHERE (deleted = false);


--
-- Name: idx_note_tag_content_tag_id; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_note_tag_content_tag_id ON client_sync.note_tag_content USING btree (tag_id);


--
-- Name: idx_note_tag_content_updated_at; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_note_tag_content_updated_at ON client_sync.note_tag_content USING btree (updated_at DESC);


--
-- Name: idx_note_tag_content_user_id; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_note_tag_content_user_id ON client_sync.note_tag_content USING btree (user_id);


--
-- Name: idx_note_tag_content_version; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_note_tag_content_version ON client_sync.note_tag_content USING btree (user_id, entity_id, version);


--
-- Name: idx_summary_content_deleted; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_summary_content_deleted ON client_sync.summary_content USING btree (user_id, deleted) WHERE (deleted = false);


--
-- Name: idx_summary_content_entity_id; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_summary_content_entity_id ON client_sync.summary_content USING btree (entity_id);


--
-- Name: idx_summary_content_note_id; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_summary_content_note_id ON client_sync.summary_content USING btree (note_id);


--
-- Name: idx_summary_content_server_updated; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_summary_content_server_updated ON client_sync.summary_content USING btree (user_id, server_updated_at);


--
-- Name: idx_summary_content_transcription_id; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_summary_content_transcription_id ON client_sync.summary_content USING btree (transcription_id);


--
-- Name: idx_summary_content_updated_at; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_summary_content_updated_at ON client_sync.summary_content USING btree (updated_at DESC);


--
-- Name: idx_summary_content_user_id; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_summary_content_user_id ON client_sync.summary_content USING btree (user_id);


--
-- Name: idx_summary_content_version; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_summary_content_version ON client_sync.summary_content USING btree (user_id, entity_id, version);


--
-- Name: idx_sync_changes_created_at; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_sync_changes_created_at ON client_sync.sync_changes USING btree (created_at);


--
-- Name: idx_sync_changes_entity; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_sync_changes_entity ON client_sync.sync_changes USING btree (user_id, entity_type, entity_id, seq DESC);


--
-- Name: idx_sync_changes_user_seq; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_sync_changes_user_seq ON client_sync.sync_changes USING btree (user_id, seq);


--
-- Name: idx_sync_mutations_created_at; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_sync_mutations_created_at ON client_sync.sync_mutations USING btree (created_at);


--
-- Name: idx_sync_mutations_lookup; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_sync_mutations_lookup ON client_sync.sync_mutations USING btree (user_id, device_id, mutation_id);


--
-- Name: idx_sync_operations_device; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_sync_operations_device ON client_sync.sync_operations USING btree (device_id, started_at DESC);


--
-- Name: idx_sync_operations_failed; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_sync_operations_failed ON client_sync.sync_operations USING btree (user_id, success, started_at DESC) WHERE (success = false);


--
-- Name: idx_sync_operations_type; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_sync_operations_type ON client_sync.sync_operations USING btree (operation_type, started_at DESC);


--
-- Name: idx_sync_operations_user_started; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_sync_operations_user_started ON client_sync.sync_operations USING btree (user_id, started_at DESC);


--
-- Name: idx_tag_content_deleted; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_tag_content_deleted ON client_sync.tag_content USING btree (user_id, deleted) WHERE (deleted = false);


--
-- Name: idx_tag_content_entity_id; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_tag_content_entity_id ON client_sync.tag_content USING btree (entity_id);


--
-- Name: idx_tag_content_name; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_tag_content_name ON client_sync.tag_content USING btree (user_id, name) WHERE (deleted = false);


--
-- Name: idx_tag_content_server_updated; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_tag_content_server_updated ON client_sync.tag_content USING btree (user_id, server_updated_at);


--
-- Name: idx_tag_content_sort; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_tag_content_sort ON client_sync.tag_content USING btree (user_id, sort_index) WHERE (deleted = false);


--
-- Name: idx_tag_content_updated_at; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_tag_content_updated_at ON client_sync.tag_content USING btree (updated_at DESC);


--
-- Name: idx_tag_content_user_id; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_tag_content_user_id ON client_sync.tag_content USING btree (user_id);


--
-- Name: idx_tag_content_version; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_tag_content_version ON client_sync.tag_content USING btree (user_id, entity_id, version);


--
-- Name: idx_transcription_content_binder_id; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_transcription_content_binder_id ON client_sync.transcription_content USING btree (binder_id);


--
-- Name: idx_transcription_content_deleted; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_transcription_content_deleted ON client_sync.transcription_content USING btree (user_id, deleted) WHERE (deleted = false);


--
-- Name: idx_transcription_content_entity_id; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_transcription_content_entity_id ON client_sync.transcription_content USING btree (entity_id);


--
-- Name: idx_transcription_content_note_id; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_transcription_content_note_id ON client_sync.transcription_content USING btree (note_id);


--
-- Name: idx_transcription_content_server_updated; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_transcription_content_server_updated ON client_sync.transcription_content USING btree (user_id, server_updated_at);


--
-- Name: idx_transcription_content_updated_at; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_transcription_content_updated_at ON client_sync.transcription_content USING btree (updated_at DESC);


--
-- Name: idx_transcription_content_user_id; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_transcription_content_user_id ON client_sync.transcription_content USING btree (user_id);


--
-- Name: idx_transcription_content_version; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE INDEX idx_transcription_content_version ON client_sync.transcription_content USING btree (user_id, entity_id, version);


--
-- Name: tag_content_user_name_ci_unique; Type: INDEX; Schema: client_sync; Owner: -
--

CREATE UNIQUE INDEX tag_content_user_name_ci_unique ON client_sync.tag_content USING btree (user_id, lower(name)) WHERE (deleted = false);


--
-- Name: idx_email_logs_correlation_id; Type: INDEX; Schema: email; Owner: -
--

CREATE INDEX idx_email_logs_correlation_id ON email.email_logs USING btree (correlation_id);


--
-- Name: idx_email_logs_created_at; Type: INDEX; Schema: email; Owner: -
--

CREATE INDEX idx_email_logs_created_at ON email.email_logs USING btree (created_at);


--
-- Name: idx_email_logs_recipient; Type: INDEX; Schema: email; Owner: -
--

CREATE INDEX idx_email_logs_recipient ON email.email_logs USING btree (recipient);


--
-- Name: idx_email_logs_status; Type: INDEX; Schema: email; Owner: -
--

CREATE INDEX idx_email_logs_status ON email.email_logs USING btree (status);


--
-- Name: idx_email_logs_template; Type: INDEX; Schema: email; Owner: -
--

CREATE INDEX idx_email_logs_template ON email.email_logs USING btree (template_name);


--
-- Name: idx_email_templates_name; Type: INDEX; Schema: email; Owner: -
--

CREATE INDEX idx_email_templates_name ON email.email_templates USING btree (name);


--
-- Name: idx_api_keys_is_active; Type: INDEX; Schema: global_auth; Owner: -
--

CREATE INDEX idx_api_keys_is_active ON global_auth.api_keys USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_api_keys_name; Type: INDEX; Schema: global_auth; Owner: -
--

CREATE UNIQUE INDEX idx_api_keys_name ON global_auth.api_keys USING btree (name);


--
-- Name: idx_api_keys_service_name; Type: INDEX; Schema: global_auth; Owner: -
--

CREATE UNIQUE INDEX idx_api_keys_service_name ON global_auth.api_keys USING btree (service_name) WHERE ((service_name IS NOT NULL) AND (is_service = true));


--
-- Name: idx_email_verification_email; Type: INDEX; Schema: global_auth; Owner: -
--

CREATE INDEX idx_email_verification_email ON global_auth.email_verification_codes USING btree (email);


--
-- Name: idx_oauth_tokens_user_provider; Type: INDEX; Schema: global_auth; Owner: -
--

CREATE INDEX idx_oauth_tokens_user_provider ON global_auth.oauth_tokens USING btree (user_id, provider);


--
-- Name: idx_sessions_expires_at; Type: INDEX; Schema: global_auth; Owner: -
--

CREATE INDEX idx_sessions_expires_at ON global_auth.sessions USING btree (expires_at);


--
-- Name: idx_sessions_token; Type: INDEX; Schema: global_auth; Owner: -
--

CREATE INDEX idx_sessions_token ON global_auth.sessions USING btree (token);


--
-- Name: idx_sessions_user_id; Type: INDEX; Schema: global_auth; Owner: -
--

CREATE INDEX idx_sessions_user_id ON global_auth.sessions USING btree (user_id);


--
-- Name: idx_user_credentials_email; Type: INDEX; Schema: global_auth; Owner: -
--

CREATE INDEX idx_user_credentials_email ON global_auth.user_credentials USING btree (email);


--
-- Name: idx_user_credentials_is_protected; Type: INDEX; Schema: global_auth; Owner: -
--

CREATE INDEX idx_user_credentials_is_protected ON global_auth.user_credentials USING btree (is_protected) WHERE (is_protected = true);


--
-- Name: idx_activations_activated_at; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_activations_activated_at ON licensing.license_activations USING btree (activated_at);


--
-- Name: idx_activations_deactivated_at; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_activations_deactivated_at ON licensing.license_activations USING btree (deactivated_at) WHERE (deactivated_at IS NULL);


--
-- Name: idx_activations_email_hash; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_activations_email_hash ON licensing.license_activations USING btree (user_email_hash);


--
-- Name: idx_activations_license_id; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_activations_license_id ON licensing.license_activations USING btree (license_id);


--
-- Name: idx_features_active; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_features_active ON licensing.feature_definitions USING btree (is_active);


--
-- Name: idx_features_category; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_features_category ON licensing.feature_definitions USING btree (feature_category);


--
-- Name: idx_licenses_active; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_licenses_active ON licensing.licenses USING btree (id) WHERE (revoked_at IS NULL);


--
-- Name: idx_licenses_expiry; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_licenses_expiry ON licensing.licenses USING btree (expires_at) WHERE (revoked_at IS NULL);


--
-- Name: idx_licenses_grant_type; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_licenses_grant_type ON licensing.licenses USING btree (grant_type);


--
-- Name: idx_licenses_hwid; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_licenses_hwid ON licensing.licenses USING btree (hardware_id) WHERE (hardware_id IS NOT NULL);


--
-- Name: idx_licenses_org; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_licenses_org ON licensing.licenses USING btree (organization_id) WHERE (organization_id IS NOT NULL);


--
-- Name: idx_licenses_tier_id; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_licenses_tier_id ON licensing.licenses USING btree (tier_id);


--
-- Name: idx_licenses_type; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_licenses_type ON licensing.licenses USING btree (license_type);


--
-- Name: idx_licenses_user; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_licenses_user ON licensing.licenses USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: idx_sessions_active; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_sessions_active ON licensing.active_sessions USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_sessions_client_user; Type: INDEX; Schema: licensing; Owner: -
--

CREATE UNIQUE INDEX idx_sessions_client_user ON licensing.active_sessions USING btree (user_id, client_id) WHERE (is_active = true);


--
-- Name: idx_sessions_heartbeat; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_sessions_heartbeat ON licensing.active_sessions USING btree (last_heartbeat);


--
-- Name: idx_sessions_license; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_sessions_license ON licensing.active_sessions USING btree (license_id);


--
-- Name: idx_sessions_org; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_sessions_org ON licensing.active_sessions USING btree (organization_id);


--
-- Name: idx_sessions_user; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_sessions_user ON licensing.active_sessions USING btree (user_id);


--
-- Name: idx_tier_features_feature; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_tier_features_feature ON licensing.tier_features USING btree (feature_id);


--
-- Name: idx_tier_features_tier; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_tier_features_tier ON licensing.tier_features USING btree (tier_id);


--
-- Name: idx_tiers_active; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_tiers_active ON licensing.tiers USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_tiers_level; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_tiers_level ON licensing.tiers USING btree (tier_level);


--
-- Name: idx_validations_failed; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_validations_failed ON licensing.license_validations USING btree (validated_at) WHERE (is_valid = false);


--
-- Name: idx_validations_key_hash; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_validations_key_hash ON licensing.license_validations USING btree (license_key_hash);


--
-- Name: idx_validations_license; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_validations_license ON licensing.license_validations USING btree (license_id);


--
-- Name: idx_validations_service; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_validations_service ON licensing.license_validations USING btree (validated_by_service);


--
-- Name: idx_validations_timestamp; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_validations_timestamp ON licensing.license_validations USING btree (validated_at);


--
-- Name: idx_validations_valid; Type: INDEX; Schema: licensing; Owner: -
--

CREATE INDEX idx_validations_valid ON licensing.license_validations USING btree (validated_at) WHERE (is_valid = true);


--
-- Name: idx_desktop_releases_architecture; Type: INDEX; Schema: releases; Owner: -
--

CREATE INDEX idx_desktop_releases_architecture ON releases.desktop_releases USING btree (architecture);


--
-- Name: idx_desktop_releases_created_at; Type: INDEX; Schema: releases; Owner: -
--

CREATE INDEX idx_desktop_releases_created_at ON releases.desktop_releases USING btree (created_at DESC);


--
-- Name: idx_desktop_releases_is_latest; Type: INDEX; Schema: releases; Owner: -
--

CREATE INDEX idx_desktop_releases_is_latest ON releases.desktop_releases USING btree (is_latest) WHERE (is_latest = true);


--
-- Name: idx_desktop_releases_platform; Type: INDEX; Schema: releases; Owner: -
--

CREATE INDEX idx_desktop_releases_platform ON releases.desktop_releases USING btree (platform);


--
-- Name: idx_desktop_releases_platform_arch_latest; Type: INDEX; Schema: releases; Owner: -
--

CREATE INDEX idx_desktop_releases_platform_arch_latest ON releases.desktop_releases USING btree (platform, architecture, is_latest) WHERE (is_latest = true);


--
-- Name: idx_desktop_releases_product; Type: INDEX; Schema: releases; Owner: -
--

CREATE INDEX idx_desktop_releases_product ON releases.desktop_releases USING btree (product);


--
-- Name: idx_desktop_releases_product_platform_arch_latest; Type: INDEX; Schema: releases; Owner: -
--

CREATE INDEX idx_desktop_releases_product_platform_arch_latest ON releases.desktop_releases USING btree (product, platform, architecture, is_latest) WHERE (is_latest = true);


--
-- Name: idx_desktop_releases_status; Type: INDEX; Schema: releases; Owner: -
--

CREATE INDEX idx_desktop_releases_status ON releases.desktop_releases USING btree (status);


--
-- Name: idx_download_stats_downloaded_at; Type: INDEX; Schema: releases; Owner: -
--

CREATE INDEX idx_download_stats_downloaded_at ON releases.download_stats USING btree (downloaded_at DESC);


--
-- Name: idx_download_stats_platform_downloaded_at; Type: INDEX; Schema: releases; Owner: -
--

CREATE INDEX idx_download_stats_platform_downloaded_at ON releases.download_stats USING btree (platform, downloaded_at DESC);


--
-- Name: idx_download_stats_platform_variant; Type: INDEX; Schema: releases; Owner: -
--

CREATE INDEX idx_download_stats_platform_variant ON releases.download_stats USING btree (platform, variant);


--
-- Name: idx_download_stats_product; Type: INDEX; Schema: releases; Owner: -
--

CREATE INDEX idx_download_stats_product ON releases.download_stats USING btree (product);


--
-- Name: idx_download_stats_product_platform; Type: INDEX; Schema: releases; Owner: -
--

CREATE INDEX idx_download_stats_product_platform ON releases.download_stats USING btree (product, platform, variant);


--
-- Name: idx_download_stats_release_id; Type: INDEX; Schema: releases; Owner: -
--

CREATE INDEX idx_download_stats_release_id ON releases.download_stats USING btree (release_id) WHERE (release_id IS NOT NULL);


--
-- Name: idx_attachments_ticket_id; Type: INDEX; Schema: support; Owner: -
--

CREATE INDEX idx_attachments_ticket_id ON support.attachments USING btree (ticket_id);


--
-- Name: idx_beta_signups_access_token; Type: INDEX; Schema: support; Owner: -
--

CREATE INDEX idx_beta_signups_access_token ON support.beta_signups USING btree (access_token_hash) WHERE (access_token_hash IS NOT NULL);


--
-- Name: idx_beta_signups_created; Type: INDEX; Schema: support; Owner: -
--

CREATE INDEX idx_beta_signups_created ON support.beta_signups USING btree (created_at DESC);


--
-- Name: idx_beta_signups_email_product; Type: INDEX; Schema: support; Owner: -
--

CREATE UNIQUE INDEX idx_beta_signups_email_product ON support.beta_signups USING btree (lower((email)::text), product);


--
-- Name: idx_beta_signups_pending_tokens; Type: INDEX; Schema: support; Owner: -
--

CREATE INDEX idx_beta_signups_pending_tokens ON support.beta_signups USING btree (access_token_expires_at) WHERE ((access_token_used_at IS NULL) AND (access_token_hash IS NOT NULL));


--
-- Name: idx_beta_signups_product; Type: INDEX; Schema: support; Owner: -
--

CREATE INDEX idx_beta_signups_product ON support.beta_signups USING btree (product);


--
-- Name: idx_beta_signups_status; Type: INDEX; Schema: support; Owner: -
--

CREATE INDEX idx_beta_signups_status ON support.beta_signups USING btree (status);


--
-- Name: idx_beta_signups_user_id; Type: INDEX; Schema: support; Owner: -
--

CREATE INDEX idx_beta_signups_user_id ON support.beta_signups USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: idx_beta_signups_verification; Type: INDEX; Schema: support; Owner: -
--

CREATE INDEX idx_beta_signups_verification ON support.beta_signups USING btree (lower((email)::text), product) WHERE ((verification_code IS NOT NULL) AND (email_verified_at IS NULL));


--
-- Name: idx_beta_signups_verify_token; Type: INDEX; Schema: support; Owner: -
--

CREATE INDEX idx_beta_signups_verify_token ON support.beta_signups USING btree (verification_token_hash) WHERE (verification_token_hash IS NOT NULL);


--
-- Name: idx_contact_submissions_created_at; Type: INDEX; Schema: support; Owner: -
--

CREATE INDEX idx_contact_submissions_created_at ON support.contact_submissions USING btree (created_at DESC);


--
-- Name: idx_contact_submissions_status; Type: INDEX; Schema: support; Owner: -
--

CREATE INDEX idx_contact_submissions_status ON support.contact_submissions USING btree (status);


--
-- Name: idx_diag_bundles_analysis_status; Type: INDEX; Schema: support; Owner: -
--

CREATE INDEX idx_diag_bundles_analysis_status ON support.diagnostics_bundles USING btree (analysis_status) WHERE (analysis_status IS NOT NULL);


--
-- Name: idx_diag_bundles_status; Type: INDEX; Schema: support; Owner: -
--

CREATE INDEX idx_diag_bundles_status ON support.diagnostics_bundles USING btree (status);


--
-- Name: idx_diag_bundles_user; Type: INDEX; Schema: support; Owner: -
--

CREATE INDEX idx_diag_bundles_user ON support.diagnostics_bundles USING btree (user_id);


--
-- Name: idx_email_log_message_id; Type: INDEX; Schema: support; Owner: -
--

CREATE INDEX idx_email_log_message_id ON support.email_processing_log USING btree (email_message_id);


--
-- Name: idx_messages_ticket_id; Type: INDEX; Schema: support; Owner: -
--

CREATE INDEX idx_messages_ticket_id ON support.messages USING btree (ticket_id);


--
-- Name: idx_tickets_assigned_to; Type: INDEX; Schema: support; Owner: -
--

CREATE INDEX idx_tickets_assigned_to ON support.tickets USING btree (assigned_to);


--
-- Name: idx_tickets_status; Type: INDEX; Schema: support; Owner: -
--

CREATE INDEX idx_tickets_status ON support.tickets USING btree (status);


--
-- Name: idx_tickets_status_created; Type: INDEX; Schema: support; Owner: -
--

CREATE INDEX idx_tickets_status_created ON support.tickets USING btree (status, created_at DESC);


--
-- Name: idx_tickets_user_created; Type: INDEX; Schema: support; Owner: -
--

CREATE INDEX idx_tickets_user_created ON support.tickets USING btree (user_id, created_at DESC);


--
-- Name: idx_tickets_user_id; Type: INDEX; Schema: support; Owner: -
--

CREATE INDEX idx_tickets_user_id ON support.tickets USING btree (user_id);


--
-- Name: idx_user_preferences_user_id; Type: INDEX; Schema: user_portal_settings; Owner: -
--

CREATE INDEX idx_user_preferences_user_id ON user_portal_settings.user_preferences USING btree (user_id);


--
-- Name: idx_user_recordings_active; Type: INDEX; Schema: user_portal_settings; Owner: -
--

CREATE INDEX idx_user_recordings_active ON user_portal_settings.user_recordings USING btree (user_id, file_deleted) WHERE (file_deleted = false);


--
-- Name: idx_user_recordings_expires_at; Type: INDEX; Schema: user_portal_settings; Owner: -
--

CREATE INDEX idx_user_recordings_expires_at ON user_portal_settings.user_recordings USING btree (expires_at) WHERE ((expires_at IS NOT NULL) AND (file_deleted = false));


--
-- Name: idx_user_recordings_org_id; Type: INDEX; Schema: user_portal_settings; Owner: -
--

CREATE INDEX idx_user_recordings_org_id ON user_portal_settings.user_recordings USING btree (organization_id);


--
-- Name: idx_user_recordings_uploaded_at; Type: INDEX; Schema: user_portal_settings; Owner: -
--

CREATE INDEX idx_user_recordings_uploaded_at ON user_portal_settings.user_recordings USING btree (uploaded_at DESC);


--
-- Name: idx_user_recordings_user_id; Type: INDEX; Schema: user_portal_settings; Owner: -
--

CREATE INDEX idx_user_recordings_user_id ON user_portal_settings.user_recordings USING btree (user_id);


--
-- Name: idx_users_login_activity_last_login_at; Type: INDEX; Schema: user_profiles; Owner: -
--

CREATE INDEX idx_users_login_activity_last_login_at ON user_profiles.login_activity USING btree (last_login_at DESC);


--
-- Name: idx_users_profiles_auth_user_id; Type: INDEX; Schema: user_profiles; Owner: -
--

CREATE UNIQUE INDEX idx_users_profiles_auth_user_id ON user_profiles.profiles USING btree (auth_user_id);


--
-- Name: idx_users_profiles_email; Type: INDEX; Schema: user_profiles; Owner: -
--

CREATE UNIQUE INDEX idx_users_profiles_email ON user_profiles.profiles USING btree (email) WHERE (email IS NOT NULL);


--
-- Name: navigation_items update_navigation_items_updated_at; Type: TRIGGER; Schema: admin_settings; Owner: -
--

CREATE TRIGGER update_navigation_items_updated_at BEFORE UPDATE ON admin_settings.navigation_items FOR EACH ROW EXECUTE FUNCTION global_auth.update_updated_at_column();


--
-- Name: route_permissions update_route_permissions_updated_at; Type: TRIGGER; Schema: admin_settings; Owner: -
--

CREATE TRIGGER update_route_permissions_updated_at BEFORE UPDATE ON admin_settings.route_permissions FOR EACH ROW EXECUTE FUNCTION user_portal_settings.update_updated_at_column();


--
-- Name: cached_events set_cached_events_updated_at; Type: TRIGGER; Schema: calendar; Owner: -
--

CREATE TRIGGER set_cached_events_updated_at BEFORE UPDATE ON calendar.cached_events FOR EACH ROW EXECUTE FUNCTION calendar.set_updated_at();


--
-- Name: outlook_connections set_outlook_connections_updated_at; Type: TRIGGER; Schema: calendar; Owner: -
--

CREATE TRIGGER set_outlook_connections_updated_at BEFORE UPDATE ON calendar.outlook_connections FOR EACH ROW EXECUTE FUNCTION calendar.set_updated_at();


--
-- Name: device_cursors set_device_cursors_updated_at; Type: TRIGGER; Schema: client_sync; Owner: -
--

CREATE TRIGGER set_device_cursors_updated_at BEFORE UPDATE ON client_sync.device_cursors FOR EACH ROW EXECUTE FUNCTION client_sync.set_updated_at();


--
-- Name: email_logs trigger_email_logs_updated_at; Type: TRIGGER; Schema: email; Owner: -
--

CREATE TRIGGER trigger_email_logs_updated_at BEFORE UPDATE ON email.email_logs FOR EACH ROW EXECUTE FUNCTION email.update_updated_at_column();


--
-- Name: api_keys update_api_keys_updated_at; Type: TRIGGER; Schema: global_auth; Owner: -
--

CREATE TRIGGER update_api_keys_updated_at BEFORE UPDATE ON global_auth.api_keys FOR EACH ROW EXECUTE FUNCTION global_auth.update_updated_at_column();


--
-- Name: oauth_tokens update_oauth_tokens_updated_at; Type: TRIGGER; Schema: global_auth; Owner: -
--

CREATE TRIGGER update_oauth_tokens_updated_at BEFORE UPDATE ON global_auth.oauth_tokens FOR EACH ROW EXECUTE FUNCTION global_auth.update_updated_at_column();


--
-- Name: user_credentials update_user_credentials_updated_at; Type: TRIGGER; Schema: global_auth; Owner: -
--

CREATE TRIGGER update_user_credentials_updated_at BEFORE UPDATE ON global_auth.user_credentials FOR EACH ROW EXECUTE FUNCTION global_auth.update_updated_at_column();


--
-- Name: license_activations trigger_update_activation_timestamp; Type: TRIGGER; Schema: licensing; Owner: -
--

CREATE TRIGGER trigger_update_activation_timestamp BEFORE UPDATE ON licensing.license_activations FOR EACH ROW EXECUTE FUNCTION licensing.update_activation_timestamp();


--
-- Name: feature_definitions update_features_updated_at; Type: TRIGGER; Schema: licensing; Owner: -
--

CREATE TRIGGER update_features_updated_at BEFORE UPDATE ON licensing.feature_definitions FOR EACH ROW EXECUTE FUNCTION licensing.update_updated_at_column();


--
-- Name: licenses update_licenses_updated_at; Type: TRIGGER; Schema: licensing; Owner: -
--

CREATE TRIGGER update_licenses_updated_at BEFORE UPDATE ON licensing.licenses FOR EACH ROW EXECUTE FUNCTION licensing.update_updated_at_column();


--
-- Name: tiers update_tiers_updated_at; Type: TRIGGER; Schema: licensing; Owner: -
--

CREATE TRIGGER update_tiers_updated_at BEFORE UPDATE ON licensing.tiers FOR EACH ROW EXECUTE FUNCTION licensing.update_updated_at_column();


--
-- Name: desktop_releases trigger_desktop_releases_updated_at; Type: TRIGGER; Schema: releases; Owner: -
--

CREATE TRIGGER trigger_desktop_releases_updated_at BEFORE UPDATE ON releases.desktop_releases FOR EACH ROW EXECUTE FUNCTION releases.update_desktop_releases_updated_at();


--
-- Name: desktop_releases trigger_ensure_single_latest_release; Type: TRIGGER; Schema: releases; Owner: -
--

CREATE TRIGGER trigger_ensure_single_latest_release BEFORE INSERT OR UPDATE ON releases.desktop_releases FOR EACH ROW EXECUTE FUNCTION releases.ensure_single_latest_release();


--
-- Name: tickets trigger_tickets_updated_at; Type: TRIGGER; Schema: support; Owner: -
--

CREATE TRIGGER trigger_tickets_updated_at BEFORE UPDATE ON support.tickets FOR EACH ROW EXECUTE FUNCTION support.update_updated_at_column();


--
-- Name: user_preferences update_user_preferences_updated_at; Type: TRIGGER; Schema: user_portal_settings; Owner: -
--

CREATE TRIGGER update_user_preferences_updated_at BEFORE UPDATE ON user_portal_settings.user_preferences FOR EACH ROW EXECUTE FUNCTION global_auth.update_updated_at_column();


--
-- Name: login_activity trg_users_login_activity_updated_at; Type: TRIGGER; Schema: user_profiles; Owner: -
--

CREATE TRIGGER trg_users_login_activity_updated_at BEFORE UPDATE ON user_profiles.login_activity FOR EACH ROW EXECUTE FUNCTION global_auth.update_updated_at_column();


--
-- Name: profiles trg_users_profiles_updated_at; Type: TRIGGER; Schema: user_profiles; Owner: -
--

CREATE TRIGGER trg_users_profiles_updated_at BEFORE UPDATE ON user_profiles.profiles FOR EACH ROW EXECUTE FUNCTION global_auth.update_updated_at_column();


--
-- Name: navigation_items navigation_items_parent_id_fkey; Type: FK CONSTRAINT; Schema: admin_settings; Owner: -
--

ALTER TABLE ONLY admin_settings.navigation_items
    ADD CONSTRAINT navigation_items_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES admin_settings.navigation_items(id);


--
-- Name: route_access_audit route_access_audit_changed_by_fkey; Type: FK CONSTRAINT; Schema: admin_settings; Owner: -
--

ALTER TABLE ONLY admin_settings.route_access_audit
    ADD CONSTRAINT route_access_audit_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES global_auth.user_credentials(id) ON DELETE SET NULL;


--
-- Name: route_role_access route_role_access_route_id_fkey; Type: FK CONSTRAINT; Schema: admin_settings; Owner: -
--

ALTER TABLE ONLY admin_settings.route_role_access
    ADD CONSTRAINT route_role_access_route_id_fkey FOREIGN KEY (route_id) REFERENCES admin_settings.route_permissions(id) ON DELETE CASCADE;


--
-- Name: cached_events cached_events_connection_id_fkey; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.cached_events
    ADD CONSTRAINT cached_events_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES calendar.outlook_connections(id) ON DELETE CASCADE;


--
-- Name: cached_events cached_events_user_id_fkey; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.cached_events
    ADD CONSTRAINT cached_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES global_auth.user_credentials(id) ON DELETE CASCADE;


--
-- Name: outlook_connections outlook_connections_user_id_fkey; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.outlook_connections
    ADD CONSTRAINT outlook_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES global_auth.user_credentials(id) ON DELETE CASCADE;


--
-- Name: binder_content binder_content_user_id_fkey; Type: FK CONSTRAINT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.binder_content
    ADD CONSTRAINT binder_content_user_id_fkey FOREIGN KEY (user_id) REFERENCES global_auth.user_credentials(id) ON DELETE CASCADE;


--
-- Name: device_cursors device_cursors_user_id_fkey; Type: FK CONSTRAINT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.device_cursors
    ADD CONSTRAINT device_cursors_user_id_fkey FOREIGN KEY (user_id) REFERENCES global_auth.user_credentials(id) ON DELETE CASCADE;


--
-- Name: note_content note_content_user_id_fkey; Type: FK CONSTRAINT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.note_content
    ADD CONSTRAINT note_content_user_id_fkey FOREIGN KEY (user_id) REFERENCES global_auth.user_credentials(id) ON DELETE CASCADE;


--
-- Name: note_tag_content note_tag_content_user_id_fkey; Type: FK CONSTRAINT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.note_tag_content
    ADD CONSTRAINT note_tag_content_user_id_fkey FOREIGN KEY (user_id) REFERENCES global_auth.user_credentials(id) ON DELETE CASCADE;


--
-- Name: summary_content summary_content_user_id_fkey; Type: FK CONSTRAINT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.summary_content
    ADD CONSTRAINT summary_content_user_id_fkey FOREIGN KEY (user_id) REFERENCES global_auth.user_credentials(id) ON DELETE CASCADE;


--
-- Name: sync_changes sync_changes_user_id_fkey; Type: FK CONSTRAINT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.sync_changes
    ADD CONSTRAINT sync_changes_user_id_fkey FOREIGN KEY (user_id) REFERENCES global_auth.user_credentials(id) ON DELETE CASCADE;


--
-- Name: sync_mutations sync_mutations_user_id_fkey; Type: FK CONSTRAINT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.sync_mutations
    ADD CONSTRAINT sync_mutations_user_id_fkey FOREIGN KEY (user_id) REFERENCES global_auth.user_credentials(id) ON DELETE CASCADE;


--
-- Name: sync_operations sync_operations_user_id_fkey; Type: FK CONSTRAINT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.sync_operations
    ADD CONSTRAINT sync_operations_user_id_fkey FOREIGN KEY (user_id) REFERENCES global_auth.user_credentials(id) ON DELETE CASCADE;


--
-- Name: tag_content tag_content_user_id_fkey; Type: FK CONSTRAINT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.tag_content
    ADD CONSTRAINT tag_content_user_id_fkey FOREIGN KEY (user_id) REFERENCES global_auth.user_credentials(id) ON DELETE CASCADE;


--
-- Name: transcription_content transcription_content_user_id_fkey; Type: FK CONSTRAINT; Schema: client_sync; Owner: -
--

ALTER TABLE ONLY client_sync.transcription_content
    ADD CONSTRAINT transcription_content_user_id_fkey FOREIGN KEY (user_id) REFERENCES global_auth.user_credentials(id) ON DELETE CASCADE;


--
-- Name: email_templates email_templates_updated_by_fkey; Type: FK CONSTRAINT; Schema: email; Owner: -
--

ALTER TABLE ONLY email.email_templates
    ADD CONSTRAINT email_templates_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES global_auth.user_credentials(id) ON DELETE SET NULL;


--
-- Name: oauth_tokens oauth_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: global_auth; Owner: -
--

ALTER TABLE ONLY global_auth.oauth_tokens
    ADD CONSTRAINT oauth_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES global_auth.user_credentials(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: global_auth; Owner: -
--

ALTER TABLE ONLY global_auth.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES global_auth.user_credentials(id) ON DELETE CASCADE;


--
-- Name: active_sessions active_sessions_license_id_fkey; Type: FK CONSTRAINT; Schema: licensing; Owner: -
--

ALTER TABLE ONLY licensing.active_sessions
    ADD CONSTRAINT active_sessions_license_id_fkey FOREIGN KEY (license_id) REFERENCES licensing.licenses(id);


--
-- Name: active_sessions fk_active_sessions_user; Type: FK CONSTRAINT; Schema: licensing; Owner: -
--

ALTER TABLE ONLY licensing.active_sessions
    ADD CONSTRAINT fk_active_sessions_user FOREIGN KEY (user_id) REFERENCES global_auth.user_credentials(id) ON DELETE CASCADE;


--
-- Name: licenses fk_licenses_user; Type: FK CONSTRAINT; Schema: licensing; Owner: -
--

ALTER TABLE ONLY licensing.licenses
    ADD CONSTRAINT fk_licenses_user FOREIGN KEY (user_id) REFERENCES global_auth.user_credentials(id) ON DELETE SET NULL;


--
-- Name: license_activations license_activations_license_id_fkey; Type: FK CONSTRAINT; Schema: licensing; Owner: -
--

ALTER TABLE ONLY licensing.license_activations
    ADD CONSTRAINT license_activations_license_id_fkey FOREIGN KEY (license_id) REFERENCES licensing.licenses(id) ON DELETE CASCADE;


--
-- Name: license_validations license_validations_license_id_fkey; Type: FK CONSTRAINT; Schema: licensing; Owner: -
--

ALTER TABLE ONLY licensing.license_validations
    ADD CONSTRAINT license_validations_license_id_fkey FOREIGN KEY (license_id) REFERENCES licensing.licenses(id);


--
-- Name: licenses licenses_tier_id_fkey; Type: FK CONSTRAINT; Schema: licensing; Owner: -
--

ALTER TABLE ONLY licensing.licenses
    ADD CONSTRAINT licenses_tier_id_fkey FOREIGN KEY (tier_id) REFERENCES licensing.tiers(id) ON DELETE RESTRICT;


--
-- Name: tier_features tier_features_feature_id_fkey; Type: FK CONSTRAINT; Schema: licensing; Owner: -
--

ALTER TABLE ONLY licensing.tier_features
    ADD CONSTRAINT tier_features_feature_id_fkey FOREIGN KEY (feature_id) REFERENCES licensing.feature_definitions(id) ON DELETE CASCADE;


--
-- Name: tier_features tier_features_tier_id_fkey; Type: FK CONSTRAINT; Schema: licensing; Owner: -
--

ALTER TABLE ONLY licensing.tier_features
    ADD CONSTRAINT tier_features_tier_id_fkey FOREIGN KEY (tier_id) REFERENCES licensing.tiers(id) ON DELETE CASCADE;


--
-- Name: desktop_releases desktop_releases_created_by_fkey; Type: FK CONSTRAINT; Schema: releases; Owner: -
--

ALTER TABLE ONLY releases.desktop_releases
    ADD CONSTRAINT desktop_releases_created_by_fkey FOREIGN KEY (created_by) REFERENCES global_auth.user_credentials(id) ON DELETE SET NULL;


--
-- Name: download_stats download_stats_release_id_fkey; Type: FK CONSTRAINT; Schema: releases; Owner: -
--

ALTER TABLE ONLY releases.download_stats
    ADD CONSTRAINT download_stats_release_id_fkey FOREIGN KEY (release_id) REFERENCES releases.desktop_releases(id) ON DELETE SET NULL;


--
-- Name: attachments attachments_message_id_fkey; Type: FK CONSTRAINT; Schema: support; Owner: -
--

ALTER TABLE ONLY support.attachments
    ADD CONSTRAINT attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES support.messages(id) ON DELETE CASCADE;


--
-- Name: attachments attachments_ticket_id_fkey; Type: FK CONSTRAINT; Schema: support; Owner: -
--

ALTER TABLE ONLY support.attachments
    ADD CONSTRAINT attachments_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES support.tickets(id) ON DELETE CASCADE;


--
-- Name: diagnostics_bundles diagnostics_bundles_analysis_requested_by_fkey; Type: FK CONSTRAINT; Schema: support; Owner: -
--

ALTER TABLE ONLY support.diagnostics_bundles
    ADD CONSTRAINT diagnostics_bundles_analysis_requested_by_fkey FOREIGN KEY (analysis_requested_by) REFERENCES global_auth.user_credentials(id);


--
-- Name: diagnostics_bundles diagnostics_bundles_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: support; Owner: -
--

ALTER TABLE ONLY support.diagnostics_bundles
    ADD CONSTRAINT diagnostics_bundles_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES global_auth.user_credentials(id) ON DELETE SET NULL;


--
-- Name: diagnostics_bundles diagnostics_bundles_user_id_fkey; Type: FK CONSTRAINT; Schema: support; Owner: -
--

ALTER TABLE ONLY support.diagnostics_bundles
    ADD CONSTRAINT diagnostics_bundles_user_id_fkey FOREIGN KEY (user_id) REFERENCES global_auth.user_credentials(id) ON DELETE CASCADE;


--
-- Name: email_processing_log email_processing_log_ticket_id_fkey; Type: FK CONSTRAINT; Schema: support; Owner: -
--

ALTER TABLE ONLY support.email_processing_log
    ADD CONSTRAINT email_processing_log_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES support.tickets(id) ON DELETE SET NULL;


--
-- Name: beta_signups fk_beta_signups_user_id; Type: FK CONSTRAINT; Schema: support; Owner: -
--

ALTER TABLE ONLY support.beta_signups
    ADD CONSTRAINT fk_beta_signups_user_id FOREIGN KEY (user_id) REFERENCES global_auth.user_credentials(id) ON DELETE SET NULL;


--
-- Name: messages messages_ticket_id_fkey; Type: FK CONSTRAINT; Schema: support; Owner: -
--

ALTER TABLE ONLY support.messages
    ADD CONSTRAINT messages_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES support.tickets(id) ON DELETE CASCADE;


--
-- Name: messages messages_user_id_fkey; Type: FK CONSTRAINT; Schema: support; Owner: -
--

ALTER TABLE ONLY support.messages
    ADD CONSTRAINT messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES global_auth.user_credentials(id) ON DELETE SET NULL;


--
-- Name: tickets tickets_assigned_to_fkey; Type: FK CONSTRAINT; Schema: support; Owner: -
--

ALTER TABLE ONLY support.tickets
    ADD CONSTRAINT tickets_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES global_auth.user_credentials(id) ON DELETE SET NULL;


--
-- Name: tickets tickets_user_id_fkey; Type: FK CONSTRAINT; Schema: support; Owner: -
--

ALTER TABLE ONLY support.tickets
    ADD CONSTRAINT tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES global_auth.user_credentials(id) ON DELETE CASCADE;


--
-- Name: user_recordings fk_user_recordings_user; Type: FK CONSTRAINT; Schema: user_portal_settings; Owner: -
--

ALTER TABLE ONLY user_portal_settings.user_recordings
    ADD CONSTRAINT fk_user_recordings_user FOREIGN KEY (user_id) REFERENCES global_auth.user_credentials(id) ON DELETE CASCADE;


--
-- Name: user_preferences user_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: user_portal_settings; Owner: -
--

ALTER TABLE ONLY user_portal_settings.user_preferences
    ADD CONSTRAINT user_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES global_auth.user_credentials(id) ON DELETE CASCADE;


--
-- Name: login_activity login_activity_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: user_profiles; Owner: -
--

ALTER TABLE ONLY user_profiles.login_activity
    ADD CONSTRAINT login_activity_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES global_auth.user_credentials(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: user_profiles; Owner: -
--

ALTER TABLE ONLY user_profiles.profiles
    ADD CONSTRAINT profiles_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES global_auth.user_credentials(id) ON DELETE CASCADE;


--
-- Name: note_content; Type: ROW SECURITY; Schema: client_sync; Owner: -
--

ALTER TABLE client_sync.note_content ENABLE ROW LEVEL SECURITY;

--
-- Name: note_content rls_note_content_user_isolation; Type: POLICY; Schema: client_sync; Owner: -
--

CREATE POLICY rls_note_content_user_isolation ON client_sync.note_content USING ((user_id = (current_setting('app.current_user_id'::text, true))::uuid));


--
-- Name: summary_content rls_summary_content_user_isolation; Type: POLICY; Schema: client_sync; Owner: -
--

CREATE POLICY rls_summary_content_user_isolation ON client_sync.summary_content USING ((user_id = (current_setting('app.current_user_id'::text, true))::uuid));


--
-- Name: transcription_content rls_transcription_content_user_isolation; Type: POLICY; Schema: client_sync; Owner: -
--

CREATE POLICY rls_transcription_content_user_isolation ON client_sync.transcription_content USING ((user_id = (current_setting('app.current_user_id'::text, true))::uuid));


--
-- Name: summary_content; Type: ROW SECURITY; Schema: client_sync; Owner: -
--

ALTER TABLE client_sync.summary_content ENABLE ROW LEVEL SECURITY;

--
-- Name: transcription_content; Type: ROW SECURITY; Schema: client_sync; Owner: -
--

ALTER TABLE client_sync.transcription_content ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--



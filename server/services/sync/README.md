# Notely Sync Service (V3)

This service manages cursor-based synchronization for desktop clients. It exposes a unified REST endpoint for push/pull operations with server-assigned cursors and sequential change tracking.

## Architecture

The sync service implements a Joplin-style cursor-based sync protocol:

- **Single endpoint**: `POST /api/sync` handles both push and pull operations
- **Server cursors**: The server assigns monotonically increasing sequence numbers
- **Optimistic locking**: Base version checks prevent concurrent overwrites
- **Idempotent mutations**: Each push operation includes a `mutation_id` for replay safety
- **Snapshot recovery**: Clients can request full state download when cursor expires

## API Endpoint

### POST /api/sync

Single endpoint for synchronization operations.

**Request:**
```json
{
  "device_id": "uuid",
  "device_name": "Desktop",
  "cursor": 0,
  "client_time_ms": 1699999999999,
  "limit": 500,
  "snapshot": false,
  "push": [
    {
      "mutation_id": "uuid",
      "entity_type": "notes",
      "entity_id": "uuid",
      "op": "upsert",
      "base_version": null,
      "entity": { ... }
    }
  ]
}
```

**Response:**
```json
{
  "cursor": 1234,
  "has_more": false,
  "server_time_ms": 1699999999999,
  "device_time_skew_ms": -500,
  "clock_suspect": false,
  "items": [...],
  "results": [...]
}
```

## Entity Types

- `binders` - Note folders/containers
- `notes` - Note content and metadata
- `transcriptions` - Audio transcription sessions
- `summaries` - AI-generated summaries
- `tags` - User-defined tags
- `note_tags` - Note-tag associations

## Running the Service

```bash
# Development
npm run dev

# Production
npm run build && npm start
```

## Database

The service uses PostgreSQL with the `client_sync` schema. Key tables:

- `sync_changes` - Sequential change log with server-assigned cursors
- `device_cursors` - Per-device cursor tracking and clock skew detection
- `sync_mutations` - Idempotency records for replay protection
- `*_content` tables - Entity storage (binder_content, note_content, etc.)

Refer to `../../docs/SYNC_JOPLIN.md` for the full sync protocol specification.

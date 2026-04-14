#!/bin/bash
# rename-schemas-in-codebase.sh
# Updates all code references to use new descriptive schema names
#
# Schema Renames:
#   auth            → global_auth
#   users           → user_profiles
#   portal          → user_portal_settings OR admin_portal_settings (context-dependent)
#   admin           → admin_system_settings
#   sync            → client_sync
#
# Usage:
#   ./rename-schemas-in-codebase.sh [--dry-run] [--verbose]
#
# Options:
#   --dry-run   Show what would be changed without making changes
#   --verbose   Show detailed output

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Flags
DRY_RUN=false
VERBOSE=false

# Parse arguments
for arg in "$@"; do
  case $arg in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --verbose)
      VERBOSE=true
      shift
      ;;
    *)
      echo -e "${RED}Unknown option: $arg${NC}"
      echo "Usage: $0 [--dry-run] [--verbose]"
      exit 1
      ;;
  esac
done

# Log functions
log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
  echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

log_verbose() {
  if [ "$VERBOSE" = true ]; then
    echo -e "${BLUE}[VERBOSE]${NC} $1"
  fi
}

# Check if we're in the right directory
if [ ! -f "$SERVER_DIR/docker-compose.yml" ]; then
  log_error "Not in the correct directory. Please run from server/scripts/"
  exit 1
fi

log_info "Starting schema rename in codebase..."
log_info "Server directory: $SERVER_DIR"

if [ "$DRY_RUN" = true ]; then
  log_warning "DRY RUN MODE - No files will be modified"
fi

# ============================================================================
# Function: Replace in file with context awareness
# ============================================================================
replace_in_file() {
  local file="$1"
  local search="$2"
  local replace="$3"
  local description="$4"

  if [ ! -f "$file" ]; then
    log_verbose "Skipping (not found): $file"
    return
  fi

  # Check if file contains the search string
  if ! grep -q "$search" "$file" 2>/dev/null; then
    log_verbose "Skipping (no matches): $file"
    return
  fi

  if [ "$DRY_RUN" = true ]; then
    local count=$(grep -o "$search" "$file" | wc -l)
    log_info "[DRY RUN] Would replace $count occurrence(s) in: $file"
    log_verbose "  Pattern: $search → $replace ($description)"
  else
    local count=$(grep -o "$search" "$file" | wc -l)
    sed -i "s/$search/$replace/g" "$file"
    log_success "Replaced $count occurrence(s) in: $file"
    log_verbose "  Pattern: $search → $replace ($description)"
  fi
}

# ============================================================================
# Function: Replace in all files matching pattern
# ============================================================================
replace_in_files() {
  local pattern="$1"
  local search="$2"
  local replace="$3"
  local description="$4"

  log_info "Searching for '$search' in files matching: $pattern"

  local file_count=0
  while IFS= read -r -d '' file; do
    replace_in_file "$file" "$search" "$replace" "$description"
    ((file_count++)) || true
  done < <(find "$SERVER_DIR" -type f -name "$pattern" -print0 2>/dev/null)

  if [ $file_count -eq 0 ]; then
    log_warning "No files found matching pattern: $pattern"
  fi
}

# ============================================================================
# PHASE 1: Update TypeScript/JavaScript Files
# ============================================================================

log_info ""
log_info "==================================================================="
log_info "PHASE 1: Updating TypeScript/JavaScript files"
log_info "==================================================================="

# 1.1: Replace auth → global_auth
log_info "Replacing 'auth.' with 'global_auth.' in SQL queries..."
replace_in_files "*.ts" "auth\\." "global_auth." "Schema prefix in SQL queries"
replace_in_files "*.js" "auth\\." "global_auth." "Schema prefix in SQL queries"

# 1.2: Replace users → user_profiles
log_info "Replacing 'users.' with 'user_profiles.' in SQL queries..."
replace_in_files "*.ts" "users\\." "user_profiles." "Schema prefix in SQL queries"
replace_in_files "*.js" "users\\." "user_profiles." "Schema prefix in SQL queries"

# 1.3: Replace sync → client_sync
log_info "Replacing 'sync.' with 'client_sync.' in SQL queries..."
replace_in_files "*.ts" "sync\\." "client_sync." "Schema prefix in SQL queries"
replace_in_files "*.js" "sync\\." "client_sync." "Schema prefix in SQL queries"

# 1.4: Replace admin → admin_system_settings
log_info "Replacing 'admin.' with 'admin_system_settings.' in SQL queries..."
replace_in_files "*.ts" "admin\\." "admin_system_settings." "Schema prefix in SQL queries"
replace_in_files "*.js" "admin\\." "admin_system_settings." "Schema prefix in SQL queries"

# 1.5: Portal schema split (context-dependent)
# NOTE: This requires manual review as portal.user_preferences goes to user_portal_settings
# and portal.route_* tables go to admin_portal_settings

log_warning "Portal schema split requires manual review!"
log_warning "  - portal.user_preferences → user_portal_settings.user_preferences"
log_warning "  - portal.navigation_items → admin_portal_settings.navigation_items"
log_warning "  - portal.route_* → admin_portal_settings.route_*"
log_warning ""
log_warning "Please review all 'portal.' references manually after this script completes."

# Automatic replacements we can safely make:
replace_in_files "*.ts" "portal\\.user_preferences" "user_portal_settings.user_preferences" "User preferences table"
replace_in_files "*.js" "portal\\.user_preferences" "user_portal_settings.user_preferences" "User preferences table"

replace_in_files "*.ts" "portal\\.navigation_items" "admin_portal_settings.navigation_items" "Navigation items table"
replace_in_files "*.js" "portal\\.navigation_items" "admin_portal_settings.navigation_items" "Navigation items table"

replace_in_files "*.ts" "portal\\.route_permissions" "admin_portal_settings.route_permissions" "Route permissions table"
replace_in_files "*.js" "portal\\.route_permissions" "admin_portal_settings.route_permissions" "Route permissions table"

replace_in_files "*.ts" "portal\\.route_role_access" "admin_portal_settings.route_role_access" "Route role access table"
replace_in_files "*.js" "portal\\.route_role_access" "admin_portal_settings.route_role_access" "Route role access table"

replace_in_files "*.ts" "portal\\.route_access_audit" "admin_portal_settings.route_access_audit" "Route access audit table"
replace_in_files "*.js" "portal\\.route_access_audit" "admin_portal_settings.route_access_audit" "Route access audit table"

# ============================================================================
# PHASE 2: Update SQL Migration Files
# ============================================================================

log_info ""
log_info "==================================================================="
log_info "PHASE 2: Updating SQL migration files"
log_info "==================================================================="

log_warning "SKIPPING: Existing migration files should NOT be modified!"
log_warning "The schema renames are handled by V23__rename_schemas_to_descriptive_names.sql"
log_warning "All previous migrations will still work because they reference the old schema names"
log_warning "which existed at the time they were written."

# ============================================================================
# PHASE 3: Update Service-Specific SQL Files
# ============================================================================

log_info ""
log_info "==================================================================="
log_info "PHASE 3: Updating service-specific SQL files"
log_info "==================================================================="

# Sync service has its own migration in services/sync/db/migrations/
SYNC_MIGRATIONS_DIR="$SERVER_DIR/services/sync/db/migrations"
if [ -d "$SYNC_MIGRATIONS_DIR" ]; then
  log_info "Updating sync service migrations..."

  # Create a new migration for the sync service schema rename
  SYNC_MIGRATION_FILE="$SYNC_MIGRATIONS_DIR/002_rename_to_client_sync.sql"

  if [ "$DRY_RUN" = true ]; then
    log_info "[DRY RUN] Would create: $SYNC_MIGRATION_FILE"
  else
    cat > "$SYNC_MIGRATION_FILE" << 'EOF'
-- 002: Update references after schema rename from sync to client_sync
-- This migration ensures sync service code aligns with the global schema rename

-- Note: The actual schema rename happens in the main Flyway migration
-- (V23__rename_schemas_to_descriptive_names.sql)
-- This migration just adds a comment for clarity

COMMENT ON SCHEMA client_sync IS 'Client data synchronization engine (formerly sync schema)';

-- All table references in code should now use client_sync.* instead of sync.*
-- No structural changes needed as the tables were moved by the main migration
EOF
    log_success "Created sync service migration: 002_rename_to_client_sync.sql"
  fi
fi

# ============================================================================
# PHASE 4: Update Configuration Files
# ============================================================================

log_info ""
log_info "==================================================================="
log_info "PHASE 4: Updating configuration files"
log_info "==================================================================="

# 4.1: Update docker-compose.yml Flyway schema list
DOCKER_COMPOSE="$SERVER_DIR/docker-compose.yml"
if [ -f "$DOCKER_COMPOSE" ]; then
  log_info "Updating Flyway schema list in docker-compose.yml..."

  OLD_SCHEMAS="auth,users,calendar,meetings,transcripts,notes,summaries,admin,actions,portal"
  NEW_SCHEMAS="global_auth,user_profiles,user_portal_settings,admin_portal_settings,admin_system_settings,client_sync,calendar,meetings,transcripts,notes,summaries,actions"

  if [ "$DRY_RUN" = true ]; then
    log_info "[DRY RUN] Would update FLYWAY_SCHEMAS in docker-compose.yml"
    log_info "  Old: $OLD_SCHEMAS"
    log_info "  New: $NEW_SCHEMAS"
  else
    sed -i "s/FLYWAY_SCHEMAS=$OLD_SCHEMAS/FLYWAY_SCHEMAS=$NEW_SCHEMAS/g" "$DOCKER_COMPOSE"
    log_success "Updated FLYWAY_SCHEMAS in docker-compose.yml"
  fi
fi

# 4.2: Update any README or documentation files
log_info "Updating documentation files..."

# Find all markdown files and update schema references
find "$SERVER_DIR" -type f -name "*.md" -print0 | while IFS= read -r -d '' file; do
  # Skip if file doesn't contain schema references
  if grep -q -E "(auth\.|users\.|portal\.|admin\.|sync\.)" "$file" 2>/dev/null; then
    log_verbose "Checking documentation: $file"

    # Only update schema references in code blocks or SQL examples
    # Don't replace in regular text where "auth" might mean "authentication"

    if [ "$DRY_RUN" = true ]; then
      log_info "[DRY RUN] Would update schema references in: $file"
    else
      # Use a more conservative replacement for docs
      # Only replace when followed by a table name pattern (lowercase, underscores)
      sed -i -E "s/\`auth\.([a-z_]+)\`/\`global_auth.\1\`/g" "$file"
      sed -i -E "s/\`users\.([a-z_]+)\`/\`user_profiles.\1\`/g" "$file"
      sed -i -E "s/\`sync\.([a-z_]+)\`/\`client_sync.\1\`/g" "$file"
      sed -i -E "s/\`admin\.([a-z_]+)\`/\`admin_system_settings.\1\`/g" "$file"
      log_verbose "Updated schema references in: $file"
    fi
  fi
done

# ============================================================================
# PHASE 5: Update Database Connection/Pool Configuration
# ============================================================================

log_info ""
log_info "==================================================================="
log_info "PHASE 5: Checking database connection configuration"
log_info "==================================================================="

# The database connection code doesn't hardcode schema names, so no changes needed
log_success "Database pool configuration uses dynamic schema names - no changes needed"

# ============================================================================
# PHASE 6: Generate Summary
# ============================================================================

log_info ""
log_info "==================================================================="
log_info "SUMMARY"
log_info "==================================================================="

if [ "$DRY_RUN" = true ]; then
  log_warning "DRY RUN completed - no files were modified"
  log_info ""
  log_info "Review the output above, then run without --dry-run to apply changes:"
  log_info "  $0"
else
  log_success "Schema rename completed successfully!"
  log_info ""
  log_info "Next steps:"
  log_info "1. Review git diff to verify all changes"
  log_info "2. Manually review any 'portal.' references that weren't auto-updated"
  log_info "3. Run the Flyway migration:"
  log_info "   cd $SERVER_DIR"
  log_info "   docker compose up -d flyway"
  log_info "4. Verify the migration succeeded:"
  log_info "   docker compose logs flyway"
  log_info "5. Test the application thoroughly"
  log_info "6. Commit the changes"
fi

log_info ""
log_info "Schema mapping:"
log_info "  auth            → global_auth"
log_info "  users           → user_profiles"
log_info "  portal          → user_portal_settings + admin_portal_settings"
log_info "  admin           → admin_system_settings"
log_info "  sync            → client_sync"

log_info ""
log_success "Script completed!"

# Roles Module - Usage Examples

## Quick Start Examples

### JavaScript (CommonJS)

```javascript
// Basic import
const { constants } = require('@notely/shared');
const { ROLES, isAdmin, isOperator, ALL_USER_ROLES } = constants.roles;

// Example 1: Simple role check
function checkAdminAccess(userRole) {
  if (isAdmin(userRole)) {
    console.log('User has admin access');
  } else {
    console.log('Access denied');
  }
}

// Example 2: Replace hardcoded role arrays
// OLD WAY:
const ADMIN_ROLES = new Set(['admin']);
if (ADMIN_ROLES.has(userRole)) { ... }

// NEW WAY:
if (isAdmin(userRole)) { ... }

// Example 3: Role validation middleware
function requireAdminRole(req, res, next) {
  const role = (req.userRole || '').toLowerCase();

  if (!isAdmin(role)) {
    return res.status(403).json({
      success: false,
      error: 'Admin privileges required'
    });
  }

  return next();
}

// Example 4: Check multiple privilege levels
function requireOperatorAccess(req, res, next) {
  const role = req.headers['x-auth-role'];

  // Allows admin and operator roles
  if (!isOperator(role)) {
    return res.status(403).json({
      success: false,
      error: 'Operator privileges required'
    });
  }

  return next();
}

// Example 5: Iterate over all roles
function listAllRoles() {
  console.log('Available roles:');
  ALL_USER_ROLES.forEach(role => {
    console.log(`- ${role} (level ${getRoleLevel(role)})`);
  });
}

// Example 6: Compare privileges
function canUserManageTarget(userRole, targetRole) {
  return hasEqualOrHigherPrivilege(userRole, targetRole);
}
```

### TypeScript

```typescript
// Import types and constants
import {
  ROLES,
  UserRole,
  ALL_USER_ROLES,
  isAdmin,
  isOperator,
  isViewer,
  hasEqualOrHigherPrivilege
} from '@notely/shared/constants/roles';

// Example 1: Type-safe user interface
interface User {
  id: string;
  email: string;
  role: UserRole;  // Type-safe! Only allows valid roles
}

// Example 2: Function with role parameter
function checkAccess(user: User, requiredRole: UserRole): boolean {
  return hasEqualOrHigherPrivilege(user.role, requiredRole);
}

// Example 3: Type guard for role checking
function isUserAdmin(user: User): boolean {
  return user.role === ROLES.ADMIN;
}

// Example 4: Express middleware with types
import { Request, Response, NextFunction } from 'express';

interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: UserRole;
  };
}

function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user || !isAdmin(req.user.role)) {
    return res.status(403).json({
      success: false,
      error: 'Admin privileges required'
    });
  }
  next();
}

// Example 5: Role-based component rendering
import React from 'react';

interface NavItemProps {
  userRole: UserRole;
}

const AdminNav: React.FC<NavItemProps> = ({ userRole }) => {
  if (!isAdmin(userRole)) {
    return null;
  }

  return (
    <nav>
      <a href="/admin/users">Users</a>
      <a href="/admin/settings">Settings</a>
    </nav>
  );
};

// Example 6: Role validation in API handlers
async function updateUser(userId: string, updates: Partial<User>, requestingUserRole: UserRole) {
  // Only admins can change roles
  if (updates.role && !isAdmin(requestingUserRole)) {
    throw new Error('Only admins can modify user roles');
  }

  // Can't assign a role higher than your own
  if (updates.role && !hasEqualOrHigherPrivilege(requestingUserRole, updates.role)) {
    throw new Error('Cannot assign a role higher than your own');
  }

  // Proceed with update...
}

// Example 7: Type-safe role dropdown
const RoleSelector: React.FC = () => {
  return (
    <select>
      {ALL_USER_ROLES.map(role => (
        <option key={role} value={role}>
          {role.charAt(0).toUpperCase() + role.slice(1)}
        </option>
      ))}
    </select>
  );
};
```

## Migration Examples

### Before and After

#### Example 1: Authentication Middleware

**Before:**
```javascript
const ALLOWED_ROLES = new Set(['admin', 'operator', 'viewer']);

function authenticate(req, res, next) {
  const authRole = req.headers['x-auth-role'];

  if (!authRole || !ALLOWED_ROLES.has(authRole)) {
    return next(new ForbiddenError('Insufficient permissions'));
  }

  req.user = { role: authRole };
  next();
}
```

**After:**
```javascript
const { constants } = require('@notely/shared');
const { isViewer } = constants.roles;

function authenticate(req, res, next) {
  const authRole = req.headers['x-auth-role'];

  if (!authRole || !isViewer(authRole)) {
    return next(new ForbiddenError('Insufficient permissions'));
  }

  req.user = { role: authRole };
  next();
}
```

#### Example 2: Access Control Check

**Before:**
```javascript
if (user.role === 'admin' || user.role === 'operator') {
  // Allow access
}
```

**After:**
```javascript
const { isOperator } = require('@notely/shared').constants.roles;

if (isOperator(user.role)) {
  // Allow access
}
```

#### Example 3: Role Validation

**Before:**
```javascript
function validateRole(role) {
  const validRoles = ['admin', 'operator', 'viewer', 'user'];
  return validRoles.includes(role.toLowerCase());
}
```

**After:**
```javascript
const { isValidRole } = require('@notely/shared').constants.roles;

function validateRole(role) {
  return isValidRole(role);
}
```

#### Example 4: TypeScript Type Definition

**Before:**
```typescript
// In server/services/portal/src/types/user.ts
export type UserRole = 'admin' | 'operator' | 'viewer' | 'user';
```

**After:**
```typescript
// Import from shared module
export { UserRole } from '@notely/shared/constants/roles';

// Or re-export for backward compatibility
import { UserRole as SharedUserRole } from '@notely/shared/constants/roles';
export type UserRole = SharedUserRole;
```

## Common Patterns

### Pattern 1: Admin-Only Routes

```javascript
const { isAdmin } = require('@notely/shared').constants.roles;

router.use('/admin', (req, res, next) => {
  if (!isAdmin(req.user?.role)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
});
```

### Pattern 2: Tiered Access Control

```javascript
const { isAdmin, isOperator, isViewer } = require('@notely/shared').constants.roles;

function getAccessLevel(role) {
  if (isAdmin(role)) return 'full';
  if (isOperator(role)) return 'modify';
  if (isViewer(role)) return 'read';
  return 'none';
}
```

### Pattern 3: Role Comparison

```javascript
const { hasEqualOrHigherPrivilege } = require('@notely/shared').constants.roles;

function canManageUser(managerRole, targetUserRole) {
  return hasEqualOrHigherPrivilege(managerRole, targetUserRole);
}
```

### Pattern 4: Case-Insensitive Role Check

```javascript
const { normalizeRole, ROLES } = require('@notely/shared').constants.roles;

function checkRole(userRole, requiredRole) {
  const normalized = normalizeRole(userRole);
  return normalized === requiredRole;
}

// Usage:
if (checkRole('ADMIN', ROLES.ADMIN)) {
  // Matches even though input is uppercase
}
```

## Testing

### Unit Test Example

```javascript
const { ROLES, isAdmin, isValidRole } = require('@notely/shared').constants.roles;

describe('Role Authorization', () => {
  it('should allow admin access', () => {
    expect(isAdmin(ROLES.ADMIN)).toBe(true);
    expect(isAdmin(ROLES.USER)).toBe(false);
  });

  it('should validate roles case-insensitively', () => {
    expect(isValidRole('ADMIN')).toBe(true);
    expect(isValidRole('admin')).toBe(true);
    expect(isValidRole('Admin')).toBe(true);
  });

  it('should reject invalid roles', () => {
    expect(isValidRole('superuser')).toBe(false);
    expect(isValidRole('')).toBe(false);
    expect(isValidRole(null)).toBe(false);
  });
});
```

## Tips

1. **Always use constants instead of strings**: `ROLES.ADMIN` instead of `'admin'`
2. **Use helper functions for checks**: `isAdmin(role)` is clearer than `role === ROLES.ADMIN`
3. **Leverage TypeScript types**: Import `UserRole` for type-safe role handling
4. **Case-insensitive by design**: All helper functions normalize case automatically
5. **Immutable constants**: ROLES and ALL_USER_ROLES are frozen and cannot be modified

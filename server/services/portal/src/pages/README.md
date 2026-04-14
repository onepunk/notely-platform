# Portal Pages Implementation Guide

**Last Updated:** November 3, 2025

## Overview

This guide provides the essential patterns and requirements for implementing pages in the Notely Portal. It covers:

- **API Client Usage** - Secure API communication using `@/utils/api` with automatic authentication, CSRF protection, and typed error handling
- **Role-Based Access Control (RBAC)** - Server-side and client-side authorization using `@notely/shared/constants/roles` with canonical roles (admin, operator, viewer, user)
- **Complete Page Template** - Production-ready example with proper error handling, authentication checks, and type safety
- **Service Layer Pattern** - Organizing complex API logic into reusable service classes
- **Testing & Code Review** - Checklists for ensuring security and quality standards

All pages must follow these patterns to ensure consistent security, error handling, and maintainability across the platform.

## Related Documentation

- [Portal Security Guide](/docs/PORTAL_SECURITY_GUIDE.md) - Architectural security reference covering defense-in-depth, BFF pattern, and security vulnerabilities

---

## API Client Usage

### Required Pattern

```typescript
import { apiRequest, AuthenticationError, AuthorizationError } from '@/utils/api';

const data = await apiRequest<ResponseType>('/api/endpoint');
```

### DO NOT Use

```typescript
// ❌ Manual token handling
const token = sessionStorage.getItem('notely_token');
const response = await fetch('/api/endpoint', {
  headers: { Authorization: `Bearer ${token}` }
});
```

**Why:** Manual token handling lacks CSRF protection, timeouts, consistent error handling, and logging.

### HTTP Methods

```typescript
import { get, post, put, patch, del } from '@/utils/api';

const users = await get<User[]>('/api/admin/users');
await post('/api/admin/users', { email, role });
await put(`/api/admin/users/${id}`, { role });
await patch(`/api/admin/users/${id}`, { isActive: false });
await del(`/api/admin/users/${id}`);
```

### Error Handling

```typescript
import { apiRequest, AuthenticationError, AuthorizationError } from '@/utils/api';
import { useRouter } from 'next/router';
import toast from 'react-hot-toast';
import clientLogger from '@/lib/clientLogger';

try {
  const data = await apiRequest('/api/endpoint');
} catch (error) {
  if (error instanceof AuthenticationError) {
    toast.error('Session expired');
    router.push('/login');
  } else if (error instanceof AuthorizationError) {
    toast.error('Permission denied');
  } else {
    toast.error('Request failed');
    clientLogger.error('API error', { error });
  }
}
```

> **Security Note:** Scrub or redact any user-supplied values before logging. Never send tokens, personally identifiable information (PII), or secrets to `clientLogger` or any browser-visible log sink.

### Runtime Validation

TypeScript generics only help at compile time. Always validate API responses at runtime before using the data.

```typescript
import { apiRequest } from '@/utils/api';
import { myResponseSchema } from '@/lib/validation/mySchemas';

const raw = await apiRequest('/api/endpoint');
const data = myResponseSchema.parse(raw); // zod schema catches tampered responses
```

Recommended libraries: `zod`, `io-ts`, or an equivalent lightweight validator that runs in production builds.

---

## Role-Based Access Control (RBAC)

### Canonical Roles

| Role | Access Level |
|------|-------------|
| `admin` | Administrative access |
| `operator` | Operational tasks |
| `viewer` | Read-only access |
| `user` | Standard user features |

### Shared ROLES Module

```typescript
import { ROLES, UserRole, isAdmin, isOperator } from '@notely/shared/constants/roles';

// Type-safe role checks
const role: UserRole = 'admin';

// Check functions
if (isAdmin(user.role)) { }
if (isOperator(user.role)) { }  // admin or operator

// Constants
const allowedRoles = [ROLES.ADMIN, ROLES.OPERATOR];
```

**Helper Functions:**
- `isValidRole(role)` - Validates role string
- `normalizeRole(role)` - Lowercase + validate
- `isAdmin(role)` - Admin check
- `isOperator(role)` - Admin or operator
- `isViewer(role)` - Admin, operator, or viewer
- `getRoleLevel(role)` - Numeric privilege level (0-3)
- `hasEqualOrHigherPrivilege(roleA, roleB)` - Compare privileges

### Server-Side Protection

```typescript
import { withAuth } from '@/lib/auth/serverAuth';
import { ROLES } from '@notely/shared/constants/roles';

// Single role
export const getServerSideProps = withAuth([ROLES.ADMIN]);

// Multiple roles
export const getServerSideProps = withAuth([ROLES.ADMIN, ROLES.OPERATOR]);
```

**Behavior:**
- Validates JWT from `access_token` cookie
- Checks user role against allowed roles
- Redirects to `/login` on failure
- Set `Cache-Control: private, no-store` (or stricter) on authenticated responses so page data is never cached for other users

### Client-Side Checks

```typescript
import { useAuth } from '@/contexts/AuthContext';
import { isAdmin, ROLES } from '@notely/shared/constants/roles';

function MyComponent() {
  const { user } = useAuth();

  if (!user) return <div>Not authenticated</div>;

  if (isAdmin(user.role)) {
    return <AdminPanel />;
  }

  return <UserPanel />;
}
```

### Role Check Patterns

**Single Role:**
```typescript
export const getServerSideProps = withAuth([ROLES.ADMIN]);
```

**Multiple Roles:**
```typescript
export const getServerSideProps = withAuth([ROLES.ADMIN, ROLES.OPERATOR]);
```

**Privilege-Based:**
```typescript
import { hasEqualOrHigherPrivilege, ROLES } from '@notely/shared/constants/roles';

if (hasEqualOrHigherPrivilege(user.role, ROLES.OPERATOR)) {
  // User is operator or admin
}
```

**Feature Flags:**
```typescript
const features = {
  canDelete: isAdmin(user.role),
  canEdit: isOperator(user.role),
  canView: true
};
```

### Common Pitfalls

**❌ String Literals:**
```typescript
if (user.role === 'admin') { }  // ❌ Typo-prone
```

**✅ Use Constants:**
```typescript
if (user.role === ROLES.ADMIN) { }  // ✅ Type-safe
```

**❌ Legacy Roles:**
```typescript
if (user.role === 'platform_user') { }  // ❌ Removed
```

**✅ Canonical Roles:**
```typescript
if (user.role === ROLES.USER) { }  // ✅ Correct
```

**❌ Assuming Hierarchy:**
```typescript
// ❌ No automatic hierarchy
if (user.role === 'admin') {
  // Has operator privileges
}
```

**✅ Explicit Checks:**
```typescript
if (isOperator(user.role)) {  // ✅ Checks admin OR operator
  // Has operator privileges
}
```

**❌ Relying on Client Checks Alone:**
```typescript
if (!isAdmin(user.role)) {
  return <div>No access</div>; // ❌ API must still enforce RBAC
}
```

**✅ Enforce RBAC Server-Side:**
- Ensure the backing API route or server action validates the user's role before performing privileged logic (reuse the same guards used in `getServerSideProps`).

---

## Complete Page Template

```typescript
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { apiRequest, AuthenticationError, AuthorizationError } from '@/utils/api';
import { ROLES, isAdmin } from '@notely/shared/constants/roles';
import toast from 'react-hot-toast';
import clientLogger from '@/lib/clientLogger';
import MainLayout from '@/components/layout/MainLayout';
import PageContainer from '@/components/layout/PageContainer';
import { withAuth } from '@/lib/auth/serverAuth';
import { useAuth } from '@/contexts/AuthContext';

interface MyData {
  id: string;
  name: string;
}

function MyAdminPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [data, setData] = useState<MyData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const response = await apiRequest<{ success: boolean; data: MyData[] }>(
        '/api/admin/my-endpoint'
      );
      if (response.success) setData(response.data);
    } catch (err) {
      if (err instanceof AuthenticationError) {
        toast.error('Session expired');
        router.push('/login');
      } else if (err instanceof AuthorizationError) {
        toast.error('Permission denied');
      } else {
        toast.error('Failed to load data');
        clientLogger.error('Failed to fetch data', { error: err });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!user || !isAdmin(user.role)) {
      toast.error('Admin access required');
      return;
    }

    try {
      await apiRequest(`/api/admin/my-endpoint/${id}`, { method: 'DELETE' });
      toast.success('Deleted successfully');
      fetchData();
    } catch (err) {
      toast.error('Delete failed');
      clientLogger.error('Delete failed', { id, error: err });
    }
  };

  return (
    <>
      <Head>
        <title>Admin Page - Notely</title>
      </Head>
      <MainLayout>
        <PageContainer title="Admin Page" subtitle="Description">
          {loading ? (
            <div>Loading...</div>
          ) : (
            data.map(item => (
              <div key={item.id}>
                {item.name}
                <button onClick={() => handleDelete(item.id)}>Delete</button>
              </div>
            ))
          )}
        </PageContainer>
      </MainLayout>
    </>
  );
}

export const getServerSideProps = withAuth([ROLES.ADMIN]);
export default MyAdminPage;
```

---

## Service Layer Pattern

For complex features, use a service layer:

```typescript
// src/services/myFeatureService.ts
import { apiRequest } from '@/utils/api';
import clientLogger from '@/lib/clientLogger';

interface MyData {
  id: string;
  name: string;
}

class MyFeatureService {
  async fetchAll(): Promise<MyData[]> {
    try {
      const response = await apiRequest<{ success: boolean; data: MyData[] }>(
        '/api/admin/my-feature'
      );
      if (response.success) return response.data;
      throw new Error('Failed to fetch data');
    } catch (error) {
      clientLogger.error('MyFeatureService.fetchAll failed', { error });
      throw error;
    }
  }

  async create(data: Partial<MyData>): Promise<MyData> {
    return apiRequest<MyData>('/api/admin/my-feature', {
      method: 'POST',
      body: data
    });
  }

  async update(id: string, data: Partial<MyData>): Promise<MyData> {
    return apiRequest<MyData>(`/api/admin/my-feature/${id}`, {
      method: 'PUT',
      body: data
    });
  }

  async delete(id: string): Promise<void> {
    await apiRequest(`/api/admin/my-feature/${id}`, { method: 'DELETE' });
  }
}

export default new MyFeatureService();
```

**Usage:**
```typescript
import myFeatureService from '@/services/myFeatureService';

const data = await myFeatureService.fetchAll();
```

---

## Testing

**Type Check:**
```bash
npm run type-check
```

**Linting:**
```bash
npm run lint
```

**Manual Checklist:**
- [ ] Page loads correctly
- [ ] Data fetches successfully
- [ ] Token expiration redirects to login
- [ ] Permission errors show appropriate message
- [ ] Network errors handled gracefully
- [ ] Browser console has no errors

---

## Code Review Checklist

- [ ] Uses `apiRequest()` for all API calls
- [ ] No raw `fetch()` with manual token handling
- [ ] Proper error handling with typed error classes
- [ ] `AuthenticationError` redirects to login
- [ ] User-friendly error messages with `toast`
- [ ] Debug logging with `clientLogger.error()`
- [ ] Type-safe with TypeScript generics
- [ ] Server-side protection with `withAuth()`
- [ ] Uses ROLES constants instead of string literals
- [ ] TypeScript check passes
- [ ] Linting passes
- [ ] Tested manually in browser

---

## Additional Resources

**Core Utilities:**
- `/src/utils/api.ts` - API client source code
- `/src/utils/API_CLIENT_README.md` - Complete API client docs
- `@notely/shared/constants/roles` - Shared role constants (`server/packages/constants/`)

**Package Documentation:**
- `server/packages/constants/USAGE.md` - Role constants usage guide
- `server/packages/constants/EXAMPLES.md` - Role patterns and migration examples

**Example Pages:**
- `/src/pages/admin/access.tsx` - Simple API integration
- `/src/pages/admin/users.tsx` - Full CRUD operations
- `/src/pages/admin/database.tsx` - Complex component

**Service Examples:**
- `/src/services/authService.ts`
- `/src/services/databaseService.ts`
- `/src/services/dockerService.ts`

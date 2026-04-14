# Secure API Client Documentation

## Overview

The `api.ts` module provides a **production-ready, security-hardened API client** for the Notely Portal. Every page should use this client instead of raw `fetch()` calls to ensure consistent security, error handling, and logging.

## Why Use This Client?

### Built-In Security Features

1. **Automatic JWT Authentication**
   - Retrieves token from storage (sessionStorage → localStorage fallback)
   - Automatically injects `Authorization: Bearer <token>` header
   - No need to manually handle tokens in every component

2. **CSRF Protection**
   - Adds `X-Requested-With: XMLHttpRequest` header
   - Cannot be set by simple HTML forms, preventing CSRF attacks
   - Token-based auth provides additional protection

3. **Cookie Support**
   - Includes `credentials: 'include'` by default
   - Supports cookie-based sessions alongside JWT
   - Ensures compatibility with different auth strategies

4. **Request Timeout**
   - Default 30-second timeout prevents hanging requests
   - Configurable per-request
   - Uses AbortController for proper cleanup

5. **Structured Error Handling**
   - Type-safe error classes (`AuthenticationError`, `AuthorizationError`, etc.)
   - Automatic status code mapping (401, 403, 404, 500, etc.)
   - Request ID tracking for debugging

6. **Request/Response Logging**
   - All requests logged via `clientLogger`
   - Debug-level for successful requests
   - Error-level for failures
   - Includes method, URL, status, requestId

7. **Type Safety**
   - Full TypeScript support
   - Generic response types
   - IntelliSense for all options

---

## Basic Usage

### Simple GET Request

```typescript
import { apiRequest } from '@/utils/api';

// Fetch data with type safety
const { data } = await apiRequest<{ users: User[] }>('/api/admin/users');
console.log(data.users); // TypeScript knows this is User[]
```

### POST Request with Body

```typescript
import { apiRequest } from '@/utils/api';

await apiRequest('/api/admin/users', {
  method: 'POST',
  body: {
    email: 'user@example.com',
    role: 'admin',
    firstName: 'John',
    lastName: 'Doe'
  }
});
```

### Using Convenience Methods

```typescript
import { get, post, put, patch, del } from '@/utils/api';

// GET
const users = await get<{ users: User[] }>('/api/admin/users');

// POST
const newUser = await post('/api/admin/users', { email: '...', role: 'admin' });

// PUT
const updated = await put(`/api/admin/users/${id}`, { role: 'operator' });

// PATCH
const patched = await patch(`/api/admin/users/${id}`, { isActive: false });

// DELETE
await del(`/api/admin/users/${id}`);
```

---

## Error Handling

### Structured Error Classes

The API client throws typed errors that you can catch and handle specifically:

```typescript
import {
  apiRequest,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
  ServerError
} from '@/utils/api';

try {
  const { data } = await apiRequest('/api/admin/users');
  setUsers(data.users);
} catch (error) {
  if (error instanceof AuthenticationError) {
    // Token expired or invalid (401)
    toast.error('Please log in again');
    router.push('/login');
  } else if (error instanceof AuthorizationError) {
    // Insufficient permissions (403)
    toast.error('You do not have permission to access this resource');
  } else if (error instanceof NotFoundError) {
    // Resource not found (404)
    toast.error('Resource not found');
  } else if (error instanceof ValidationError) {
    // Bad request (400)
    toast.error(`Validation error: ${error.message}`);
    console.log(error.details); // Access validation details
  } else if (error instanceof ServerError) {
    // Server error (500+)
    toast.error('A server error occurred. Please try again later.');
  } else {
    // Unknown error
    toast.error('An unexpected error occurred');
  }
}
```

### Error Properties

All error classes extend `ApiError` and include:

```typescript
interface ApiError {
  message: string;    // Human-readable error message
  status: number;     // HTTP status code (401, 403, 404, etc.)
  code?: string;      // Error code (AUTHENTICATION_REQUIRED, etc.)
  details?: any;      // Additional error details (e.g., validation errors)
  requestId?: string; // Request ID for tracking/debugging
}
```

### Non-Throwing Error Mode

If you prefer not to use try/catch, you can disable throwing:

```typescript
const result = await apiRequest('/api/admin/users', {
  throwOnError: false
});

if (result.success === false) {
  console.error(result.error); // ApiError object
} else {
  console.log(result.data);
}
```

---

## Advanced Features

### Custom Timeout

```typescript
await apiRequest('/api/admin/long-running-task', {
  timeout: 60000 // 60 seconds instead of default 30
});
```

### Custom Error Handler

```typescript
await apiRequest('/api/admin/users', {
  onError: (error) => {
    // Custom handling before error is thrown
    console.error('Custom error handler:', error);

    // Log to external service
    externalLogger.logError(error);
  }
});
```

### Disable Credentials

```typescript
// Don't send cookies (default: true)
await apiRequest('/api/public/data', {
  includeCredentials: false
});
```

### Custom Headers

```typescript
await apiRequest('/api/admin/users', {
  headers: {
    'X-Custom-Header': 'value',
    'X-Idempotency-Key': uuid()
  }
});
```

---

## Token Management

### Get Current Token

```typescript
import { getAuthToken } from '@/utils/api';

const token = getAuthToken();
if (!token) {
  router.push('/login');
}
```

### Set Token (After Login)

```typescript
import { setAuthToken } from '@/utils/api';

// After successful login
const { token } = await loginResponse;
setAuthToken(token);

// Now all API requests will include this token
```

### Clear Token (Logout)

```typescript
import { clearAuthToken } from '@/utils/api';

// On logout
clearAuthToken();
router.push('/login');
```

---

## Complete Component Example

```typescript
import { useState, useEffect } from 'react';
import { apiRequest, AuthenticationError, AuthorizationError } from '@/utils/api';
import { useRouter } from 'next/router';
import toast from 'react-hot-toast';
import clientLogger from '@/lib/clientLogger';

interface User {
  id: string;
  email: string;
  role: string;
}

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);

      // Type-safe API request with automatic auth
      const response = await apiRequest<{ success: boolean; data: User[] }>(
        '/api/admin/users'
      );

      if (response.success) {
        setUsers(response.data);
      }
    } catch (err) {
      if (err instanceof AuthenticationError) {
        // Token expired or invalid
        toast.error('Session expired. Please log in again.');
        router.push('/login');
      } else if (err instanceof AuthorizationError) {
        // User doesn't have permission
        toast.error('You do not have permission to view users.');
        setError('Access denied');
      } else {
        // Other errors
        const errorMessage = err instanceof Error ? err.message : 'Failed to load users';
        toast.error(errorMessage);
        setError(errorMessage);
        clientLogger.error('Failed to fetch users', { error: err });
      }
    } finally {
      setLoading(false);
    }
  };

  const deleteUser = async (userId: string) => {
    if (!confirm('Are you sure?')) return;

    try {
      await apiRequest(`/api/admin/users/${userId}`, {
        method: 'DELETE'
      });

      toast.success('User deleted');

      // Refresh list
      setUsers(users.filter(u => u.id !== userId));
    } catch (err) {
      toast.error('Failed to delete user');
      clientLogger.error('Failed to delete user', { userId, error: err });
    }
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <div>
      {users.map(user => (
        <div key={user.id}>
          {user.email} - {user.role}
          <button onClick={() => deleteUser(user.id)}>Delete</button>
        </div>
      ))}
    </div>
  );
}
```

---

## Security Best Practices

### DO ✅

1. **Always use `apiRequest` for API calls**
   ```typescript
   const data = await apiRequest('/api/admin/users');
   ```

2. **Handle authentication errors by redirecting to login**
   ```typescript
   if (error instanceof AuthenticationError) {
     router.push('/login');
   }
   ```

3. **Use type parameters for type safety**
   ```typescript
   const { data } = await apiRequest<{ users: User[] }>('/api/admin/users');
   ```

4. **Log errors for debugging**
   ```typescript
   clientLogger.error('Failed to fetch data', { error });
   ```

5. **Show user-friendly error messages**
   ```typescript
   toast.error(error.message || 'An error occurred');
   ```

### DON'T ❌

1. **Don't use raw `fetch()` for API calls**
   ```typescript
   // ❌ WRONG
   const response = await fetch('/api/admin/users');

   // ✅ CORRECT
   const data = await apiRequest('/api/admin/users');
   ```

2. **Don't manually handle tokens**
   ```typescript
   // ❌ WRONG
   const token = sessionStorage.getItem('notely_token');
   fetch('/api/admin/users', {
     headers: { Authorization: `Bearer ${token}` }
   });

   // ✅ CORRECT (automatic)
   apiRequest('/api/admin/users');
   ```

3. **Don't ignore error types**
   ```typescript
   // ❌ WRONG
   catch (error) {
     toast.error('Error');
   }

   // ✅ CORRECT
   catch (error) {
     if (error instanceof AuthenticationError) {
       router.push('/login');
     } else {
       toast.error(error.message);
     }
   }
   ```

4. **Don't expose sensitive error details to users**
   ```typescript
   // ❌ WRONG
   toast.error(JSON.stringify(error));

   // ✅ CORRECT
   toast.error('An error occurred');
   clientLogger.error('Error details', { error });
   ```

---

## Migration Guide

### From Raw Fetch

**Before:**
```typescript
const token = sessionStorage.getItem('notely_token');
const response = await fetch(resolveApiUrl('/api/admin/users'), {
  headers: { Authorization: `Bearer ${token}` }
});

if (!response.ok) {
  throw new Error('Failed to fetch');
}

const data = await response.json();
if (!data.success) {
  throw new Error(data.error);
}

return data.data;
```

**After:**
```typescript
const { data } = await apiRequest<{ data: User[] }>('/api/admin/users');
return data;
```

### From Custom API Function

**Before:**
```typescript
async function fetchUsers() {
  try {
    const token = sessionStorage.getItem('notely_token');
    const response = await fetch(resolveApiUrl('/api/admin/users'), {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include'
    });
    const data = await response.json();
    return data;
  } catch (error) {
    logger.error('Failed', error);
    throw error;
  }
}
```

**After:**
```typescript
import { apiRequest } from '@/utils/api';

async function fetchUsers() {
  return apiRequest<{ data: User[] }>('/api/admin/users');
}
```

---

## Troubleshooting

### Token Not Being Sent

**Problem**: API returns 401 even though user is logged in

**Solution**: Check that token is in storage
```typescript
import { getAuthToken } from '@/utils/api';

const token = getAuthToken();
console.log('Token:', token ? 'Present' : 'Missing');
```

### CORS Errors

**Problem**: `Cross-Origin Request Blocked`

**Solution**: Ensure backend has correct CORS headers
```javascript
// Backend
app.use(cors({
  origin: process.env.PORTAL_URL,
  credentials: true
}));
```

### Request Timeout

**Problem**: `Request timeout after 30000ms`

**Solution**: Increase timeout for slow endpoints
```typescript
await apiRequest('/api/admin/slow-operation', {
  timeout: 60000 // 60 seconds
});
```

### Type Errors

**Problem**: TypeScript complains about response type

**Solution**: Define proper interface
```typescript
interface UsersResponse {
  success: boolean;
  data: User[];
}

const response = await apiRequest<UsersResponse>('/api/admin/users');
```

---

## Summary

The `apiRequest` utility provides:

- ✅ **Automatic authentication** - No manual token handling
- ✅ **CSRF protection** - Built-in security headers
- ✅ **Type safety** - Full TypeScript support
- ✅ **Error handling** - Structured error classes
- ✅ **Request logging** - Automatic debug logs
- ✅ **Timeout handling** - Prevents hanging requests
- ✅ **Cookie support** - Works with multiple auth strategies
- ✅ **Consistent API** - Same patterns across all pages

**Use this client for every API call in the portal to ensure security and consistency!**

# License Management Components

This directory contains all React components for license management in the Notely Portal.

## Directory Structure

```
license/
├── shared/               # Reusable components used across user and admin interfaces
│   ├── LicenseStatusBadge.tsx
│   ├── FeatureList.tsx
│   ├── LicenseKeyInput.tsx
│   └── ExpiryWarning.tsx
├── user/                # User-facing license components
│   ├── CurrentLicenseCard.tsx
│   └── LicenseActivationForm.tsx
└── admin/               # Admin-only license management components
    ├── PortalLicenseCard.tsx
    ├── UpdateLicenseModal.tsx
    ├── LicenseListTable.tsx
    ├── GenerateLicenseModal.tsx
    └── ValidationHistoryPanel.tsx
```

## Component Overview

### Shared Components

#### LicenseStatusBadge
Displays color-coded status indicator for licenses.

**Props:**
- `license: License` - License object
- `size?: 'small' | 'medium'` - Badge size (default: 'medium')

**Status Colors:**
- Active: Green (CheckCircle icon)
- Expired: Red (Schedule icon)
- Revoked: Red (Cancel icon)
- Pending: Yellow (HourglassEmpty icon)

**Logic:**
- Checks if license is revoked
- Calculates expiration based on `expires_at` timestamp
- Automatically determines status from license data

**Example:**
```tsx
import { LicenseStatusBadge } from '@/components/license/shared/LicenseStatusBadge';

<LicenseStatusBadge license={license} size="small" />
```

---

#### FeatureList
Displays list of enabled features with descriptions.

**Props:**
- `features: string[]` - Array of feature keys
- `featureDefinitions: FeatureDefinition[]` - Feature metadata
- `variant?: 'detailed' | 'compact'` - Display style (default: 'detailed')

**Variants:**
- **Detailed**: Full list with descriptions, check icons, and formatted layout
- **Compact**: Small chips with feature names for space-constrained displays

**Example:**
```tsx
import { FeatureList } from '@/components/license/shared/FeatureList';

// Detailed view for main license display
<FeatureList
  features={license.features}
  featureDefinitions={featureDefinitions}
  variant="detailed"
/>

// Compact view for table cells
<FeatureList
  features={license.features}
  featureDefinitions={featureDefinitions}
  variant="compact"
/>
```

---

#### LicenseKeyInput
Formatted textarea for license key input/display with copy functionality.

**Props:**
- `value: string` - License key value
- `onChange: (value: string) => void` - Change handler
- `label?: string` - Input label (default: 'License Key')
- `readOnly?: boolean` - Read-only mode (default: false)
- `error?: string` - Error message
- `helperText?: string` - Helper text

**Features:**
- Monospace font for better key readability
- Copy to clipboard button with success feedback
- 6-row multiline input
- Toast notification on copy success/failure

**Example:**
```tsx
import { LicenseKeyInput } from '@/components/license/shared/LicenseKeyInput';

// Input mode
<LicenseKeyInput
  value={licenseKey}
  onChange={setLicenseKey}
  label="License Key"
  helperText="Paste your license key here"
/>

// Display mode
<LicenseKeyInput
  value={license.license_key}
  onChange={() => {}}
  label="Generated License Key"
  readOnly
/>
```

---

#### ExpiryWarning
Warning banner for expiring licenses with countdown.

**Props:**
- `license: License` - License object
- `warningThresholdDays?: number` - Days before expiry to show warning (default: 30)

**Warning Levels:**
- 30+ days: No warning shown
- 8-30 days: Yellow warning alert
- 0-7 days: Red error alert
- Expired: Red error alert with expired message

**Logic:**
- Returns null if no expiration date or license is revoked
- Calculates days until expiry
- Adjusts severity based on proximity to expiration
- Shows formatted date in alert message

**Example:**
```tsx
import { ExpiryWarning } from '@/components/license/shared/ExpiryWarning';

<ExpiryWarning license={license} warningThresholdDays={30} />
```

---

### User Components

#### CurrentLicenseCard
Card displaying current license details, features, and limits.

**Props:**
- `license: License` - License object
- `features: FeatureDefinition[]` - Feature definitions

**Displays:**
- License status badge
- License type (portal/desktop)
- Issued date (formatted)
- Expiration date (formatted)
- Organization ID (if present)
- Enabled features (detailed view)
- License limits (grid layout)

**Example:**
```tsx
import { CurrentLicenseCard } from '@/components/license/user/CurrentLicenseCard';

<CurrentLicenseCard license={license} features={features} />
```

---

#### LicenseActivationForm
Form for activating a new license key.

**Props:**
- `onActivate: (licenseKey: string) => Promise<void>` - Activation callback

**Features:**
- License key input with validation
- Info alert with activation instructions
- Loading state during activation
- Error display
- Clears input on success
- Toast notifications via callback

**Example:**
```tsx
import { LicenseActivationForm } from '@/components/license/user/LicenseActivationForm';
import { useLicense } from '@/hooks/useLicense';

function MyComponent() {
  const { activateLicense } = useLicense();

  return <LicenseActivationForm onActivate={activateLicense} />;
}
```

---

### Admin Components

#### PortalLicenseCard
Card showing the portal's own license status with management actions.

**Props:**
- `license: License` - Portal license object
- `features: FeatureDefinition[]` - Feature definitions
- `onUpdate: () => void` - Update license callback

**Features:**
- Download public key certificate
- Update license button
- Revocation alert (if revoked)
- License ID display (monospace)
- Full license details
- Enabled features list

**Example:**
```tsx
import { PortalLicenseCard } from '@/components/license/admin/PortalLicenseCard';

<PortalLicenseCard
  license={license}
  features={features}
  onUpdate={() => setUpdateModalOpen(true)}
/>
```

---

#### UpdateLicenseModal
Modal for updating the portal's license key.

**Props:**
- `open: boolean` - Modal open state
- `onClose: () => void` - Close callback
- `onSuccess: () => void` - Success callback

**Features:**
- License key input
- Validation before applying
- Type checking (must be 'portal' license)
- Error handling
- Success toast notification
- Clears state on close

**Example:**
```tsx
import { UpdateLicenseModal } from '@/components/license/admin/UpdateLicenseModal';

<UpdateLicenseModal
  open={updateModalOpen}
  onClose={() => setUpdateModalOpen(false)}
  onSuccess={refreshLicense}
/>
```

---

#### LicenseListTable
Table displaying all licenses with filtering, pagination, and actions.

**Props:**
- `licenses: License[]` - License array
- `features: FeatureDefinition[]` - Feature definitions
- `total: number` - Total count (for pagination)
- `page: number` - Current page
- `rowsPerPage: number` - Items per page
- `onPageChange: (page: number) => void` - Page change handler
- `onRowsPerPageChange: (rowsPerPage: number) => void` - Rows per page handler
- `onViewDetails: (license: License) => void` - View details callback
- `onRevoke: (license: License) => void` - Revoke callback
- `filters: { license_type?: string; status?: string }` - Active filters
- `onFiltersChange: (filters: any) => void` - Filter change handler

**Features:**
- License type filter (portal/desktop/all)
- Status filter (active/expired/revoked/all)
- Status badges in table
- Compact feature list display
- Truncated organization IDs
- Formatted dates
- Context menu per license (View Details, Revoke)
- Pagination controls

**Example:**
```tsx
import { LicenseListTable } from '@/components/license/admin/LicenseListTable';
import { useLicenseList } from '@/hooks/useLicenseList';

function AdminPage() {
  const {
    licenses, features, total, pagination,
    setFilters, setPagination, revokeLicense
  } = useLicenseList();

  return (
    <LicenseListTable
      licenses={licenses}
      features={features}
      total={total}
      page={Math.floor(pagination.offset / pagination.limit)}
      rowsPerPage={pagination.limit}
      onPageChange={(page) => setPagination({ ...pagination, offset: page * pagination.limit })}
      onRowsPerPageChange={(rowsPerPage) => setPagination({ limit: rowsPerPage, offset: 0 })}
      onViewDetails={handleViewDetails}
      onRevoke={handleRevokeClick}
      filters={filters}
      onFiltersChange={setFilters}
    />
  );
}
```

---

#### GenerateLicenseModal
Modal for generating new licenses with tier selection.

**Props:**
- `open: boolean` - Modal open state
- `onClose: () => void` - Close callback
- `onSuccess: () => void` - Success callback (for refreshing list)
- `features: FeatureDefinition[]` - Available features

**Features:**
- License type selection (portal/desktop)
- Tier selection (free/starter/professional/enterprise)
- Organization ID input (optional)
- User ID input (optional)
- Expiration date picker (optional)
- Notes field (optional)
- Automatic feature mapping by tier
- Shows preview of included features
- Displays generated key after creation
- Copy functionality for generated key

**Tier Feature Mapping:**
- **Free**: basic_meetings, basic_transcription
- **Starter**: free + calendar_sync, basic_ai
- **Professional**: starter + advanced_ai, teams_integration
- **Enterprise**: professional + sso, audit_logs

**Example:**
```tsx
import { GenerateLicenseModal } from '@/components/license/admin/GenerateLicenseModal';

<GenerateLicenseModal
  open={generateModalOpen}
  onClose={() => setGenerateModalOpen(false)}
  onSuccess={refreshLicenses}
  features={features}
/>
```

---

#### ValidationHistoryPanel
Panel showing recent license validation attempts.

**Props:** None (fetches data internally)

**Features:**
- Loads 10 most recent validations
- Shows validation status (Valid/Invalid with icons)
- Displays validation type (online/offline)
- Shows service name
- Displays IP address (if available)
- Formatted timestamps
- Loading state
- Error handling

**Example:**
```tsx
import { ValidationHistoryPanel } from '@/components/license/admin/ValidationHistoryPanel';

<ValidationHistoryPanel />
```

---

## API Integration

All components integrate with the License Service API through:

### API Client
- `licenseClient` - Singleton instance in `/src/lib/licenseClient.ts`
- Extends base `apiClient` with license-specific methods
- Handles authentication token forwarding
- Includes retry logic and error handling

### React Hooks
- `useLicense` - User license state management (`/src/hooks/useLicense.ts`)
- `useLicenseList` - Admin license list management (`/src/hooks/useLicenseList.ts`)
- `useFeatures` - Feature flags checking (`/src/hooks/useFeatures.ts`)

### Type Definitions
- `License` - Main license type
- `LicenseValidationResponse` - Validation result
- `FeatureDefinition` - Feature metadata
- `LicenseValidation` - Validation history record
- `GenerateLicenseRequest` - License generation payload
- All types in `/src/types/license.ts`

---

## Usage Examples

### Basic License Display

```tsx
import { CurrentLicenseCard } from '@/components/license/user/CurrentLicenseCard';
import { useLicense } from '@/hooks/useLicense';
import { useLicenseList } from '@/hooks/useLicenseList';

function MyComponent() {
  const { license, isLoading, error } = useLicense();
  const { features } = useLicenseList();

  if (isLoading) return <CircularProgress />;
  if (error) return <Alert severity="error">{error}</Alert>;

  return license ? (
    <CurrentLicenseCard license={license} features={features} />
  ) : null;
}
```

### License Activation with Warning

```tsx
import { LicenseActivationForm } from '@/components/license/user/LicenseActivationForm';
import { ExpiryWarning } from '@/components/license/shared/ExpiryWarning';
import { useLicense } from '@/hooks/useLicense';

function MyComponent() {
  const { license, activateLicense } = useLicense();

  return (
    <>
      {license && <ExpiryWarning license={license} />}
      <LicenseActivationForm onActivate={activateLicense} />
    </>
  );
}
```

### Admin License Management

```tsx
import { useState } from 'react';
import { LicenseListTable } from '@/components/license/admin/LicenseListTable';
import { GenerateLicenseModal } from '@/components/license/admin/GenerateLicenseModal';
import { useLicenseList } from '@/hooks/useLicenseList';

function AdminPage() {
  const {
    licenses, features, total, pagination,
    setFilters, setPagination, refreshLicenses, revokeLicense
  } = useLicenseList();

  const [generateModalOpen, setGenerateModalOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setGenerateModalOpen(true)}>
        Generate License
      </Button>

      <LicenseListTable
        licenses={licenses}
        features={features}
        total={total}
        page={Math.floor(pagination.offset / pagination.limit)}
        rowsPerPage={pagination.limit}
        onPageChange={(page) => setPagination({ ...pagination, offset: page * pagination.limit })}
        onRowsPerPageChange={(rowsPerPage) => setPagination({ limit: rowsPerPage, offset: 0 })}
        onViewDetails={(license) => console.log(license)}
        onRevoke={(license) => revokeLicense(license.id, 'Manual revocation')}
        filters={{}}
        onFiltersChange={setFilters}
      />

      <GenerateLicenseModal
        open={generateModalOpen}
        onClose={() => setGenerateModalOpen(false)}
        onSuccess={refreshLicenses}
        features={features}
      />
    </>
  );
}
```

### Feature Checking

```tsx
import { useFeatures } from '@/hooks/useFeatures';

function MyComponent() {
  const { hasFeature, enabledFeatures, isLoading } = useFeatures();

  if (isLoading) return <CircularProgress />;

  return (
    <>
      {hasFeature('advanced_ai') && (
        <AdvancedAIFeature />
      )}

      {hasFeature('teams_integration') && (
        <TeamsIntegration />
      )}

      <p>Enabled features: {enabledFeatures.join(', ')}</p>
    </>
  );
}
```

---

## Testing

Components are designed to be testable with React Testing Library.

### Running Tests
```bash
cd ./server/services/portal
npm test
```

### Component Test Examples

```tsx
// Example: Testing LicenseStatusBadge
import { render, screen } from '@testing-library/react';
import { LicenseStatusBadge } from './LicenseStatusBadge';

test('shows active status for valid license', () => {
  const license = {
    id: '1',
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    revoked_at: null,
    // ... other required fields
  };

  render(<LicenseStatusBadge license={license} />);
  expect(screen.getByText('Active')).toBeInTheDocument();
});

test('shows expired status for expired license', () => {
  const license = {
    id: '1',
    expires_at: new Date(Date.now() - 86400000).toISOString(),
    revoked_at: null,
    // ... other required fields
  };

  render(<LicenseStatusBadge license={license} />);
  expect(screen.getByText('Expired')).toBeInTheDocument();
});
```

---

## Styling

Components use Material-UI (MUI) theming and follow the portal's design system.

### Customization Options

1. **Theme Configuration**: Modify `/src/theme/` to adjust colors, typography, and spacing globally
2. **Component-level `sx` props**: All MUI components accept `sx` prop for inline styling
3. **Global style overrides**: Override MUI component defaults in theme configuration

### Common Style Patterns

```tsx
// Monospace font for IDs and keys
<Typography sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
  {license.id}
</Typography>

// Truncated text
<Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
  {longText}
</Box>

// Responsive grid
<Grid container spacing={2}>
  <Grid item xs={12} md={6}>
    {content}
  </Grid>
</Grid>
```

---

## Error Handling

All components implement comprehensive error handling:

1. **API Errors**: Caught and displayed with user-friendly messages
2. **Validation Errors**: Shown inline in forms
3. **Network Failures**: Gracefully handled with retry options
4. **Loading States**: Shown during async operations
5. **Toast Notifications**: Used for success/error feedback

### Error Message Examples

```tsx
// API error handling
try {
  await licenseClient.generateLicense(data);
  toast.success('License generated successfully');
} catch (err: any) {
  const errorMsg = err?.response?.data?.error || err.message || 'Failed to generate license';
  toast.error(errorMsg);
}

// Validation error display
{error && <Alert severity="error">{error}</Alert>}

// Loading state
{isLoading && <CircularProgress />}
```

---

## Accessibility

Components follow accessibility best practices:

- Semantic HTML elements
- ARIA labels where needed
- Keyboard navigation support
- Color contrast compliance
- Screen reader friendly
- Focus management in modals

---

## Performance Considerations

1. **Memoization**: Use `useMemo` for expensive computations in hooks
2. **Pagination**: Large license lists are paginated (default: 20 per page)
3. **Lazy Loading**: Components load data on mount, not during render
4. **Debouncing**: Filter inputs should be debounced (implement if needed)
5. **API Caching**: Consider implementing cache in `licenseClient` if needed

---

## Troubleshooting

### Common Issues

**Issue**: License data not loading
- **Check**: License service running on port 3210
- **Check**: Auth token present and valid
- **Check**: Network tab for API errors

**Issue**: Features not displaying
- **Check**: Feature definitions loaded from API
- **Check**: Feature keys match between license and definitions
- **Check**: Console for type mismatches

**Issue**: Copy to clipboard not working
- **Check**: HTTPS or localhost (required for clipboard API)
- **Check**: Browser permissions
- **Check**: Console for errors

**Issue**: Dates showing as "Invalid Date"
- **Check**: Date format from API (should be ISO 8601)
- **Check**: Timezone handling
- **Check**: date-fns version compatibility

---

## Related Documentation

- License Service API: `./server/services/license/README.md`
- Portal README: `./server/services/portal/README.md`
- Implementation Plan: `./tmp/PHASE_05_IMPLEMENTATION_PLAN.md`
- Type Definitions: `/src/types/license.ts`
- API Client: `/src/lib/licenseClient.ts`
- Hooks: `/src/hooks/useLicense.ts`, `/src/hooks/useLicenseList.ts`, `/src/hooks/useFeatures.ts`

---

## Maintenance Notes

### Adding New Components

1. Follow the established directory structure (shared/user/admin)
2. Use TypeScript with strict typing
3. Implement error handling and loading states
4. Add prop documentation in comments
5. Update this README with component documentation

### Modifying Existing Components

1. Maintain backward compatibility when possible
2. Update type definitions if changing props
3. Test changes with different data scenarios
4. Update documentation if behavior changes

### API Changes

If the License Service API changes:
1. Update type definitions in `/src/types/license.ts`
2. Update methods in `/src/lib/licenseClient.ts`
3. Update hooks if state shape changes
4. Update components affected by API changes
5. Update this documentation

---

**Last Updated**: November 13, 2025
**Version**: Phase 8 Complete
**Maintainer**: Notely Platform Team

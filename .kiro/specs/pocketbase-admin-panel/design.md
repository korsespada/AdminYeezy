# Design Document: PocketBase Admin Panel

## Overview

This design document specifies the architecture and implementation details for a Product Admin Panel built with Next.js 14/15 using the App Router. The application provides authenticated administrators with a responsive interface to manage products stored in an external PocketBase database. The system emphasizes security through HTTP-only cookies, server-side rendering for optimal performance, and a mobile-first responsive design that adapts between table and card layouts.

The application follows Next.js best practices by leveraging Server Components for data fetching, Server Actions for mutations, and middleware for route protection. The UI is built with Tailwind CSS and shadcn/ui components, ensuring a consistent and accessible user experience across devices.

## Architecture

### Technology Stack

- **Frontend Framework**: Next.js 14/15 (App Router)
- **Backend**: PocketBase (external instance)
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui
- **Deployment**: Vercel
- **Language**: TypeScript

### Application Structure

```
app/
├── login/
│   └── page.tsx                 # Login page (Client Component)
├── admin/
│   ├── page.tsx                 # Dashboard (Server Component)
│   └── layout.tsx               # Admin layout wrapper
├── actions/
│   ├── auth.ts                  # Authentication Server Actions
│   └── products.ts              # Product CRUD Server Actions
├── lib/
│   ├── pocketbase.ts            # PocketBase client helper
│   └── types.ts                 # TypeScript type definitions
├── components/
│   ├── ProductList.tsx          # Client Component for product display
│   ├── ProductForm.tsx          # Client Component for create/edit
│   └── ui/                      # shadcn/ui components
└── middleware.ts                # Route protection middleware
```


### Data Flow

1. **Authentication Flow**:
   - User submits credentials via login form (Client Component)
   - Form calls Server Action `loginAction()`
   - Server Action authenticates with PocketBase
   - On success, sets HTTP-only cookie with auth token
   - Redirects to `/admin`

2. **Protected Route Access**:
   - User navigates to `/admin/*`
   - Middleware checks for auth cookie
   - If missing/invalid, redirects to `/login`
   - If valid, allows access

3. **Product Data Flow**:
   - Server Component fetches products from PocketBase
   - Data passed as props to Client Component
   - Client Component handles UI interactions
   - Mutations trigger Server Actions
   - Server Actions update PocketBase
   - Page revalidates to show updated data

### Security Model

- **Authentication**: PocketBase admin authentication with email/password
- **Token Storage**: HTTP-only cookies (not accessible via JavaScript)
- **Route Protection**: Middleware-based authentication check
- **CSRF Protection**: Next.js built-in CSRF protection for Server Actions
- **Environment Variables**: Sensitive configuration stored in environment variables

## Components and Interfaces

### 1. PocketBase Client (`lib/pocketbase.ts`)

**Purpose**: Provide a typed PocketBase client that automatically handles authentication on the server.

**Interface**:
```typescript
function createClient(): PocketBase
```

**Behavior**:
- Initializes PocketBase with `NEXT_PUBLIC_POCKETBASE_URL`
- On server: reads auth token from cookies and sets `pb.authStore.save(token)`
- On client: returns unauthenticated client
- Returns configured PocketBase instance


### 2. Authentication Actions (`actions/auth.ts`)

**Server Actions**:

```typescript
async function loginAction(formData: FormData): Promise<{ success: boolean; error?: string }>
```
- Extracts email and password from FormData
- Calls `pb.admins.authWithPassword(email, password)`
- On success: sets HTTP-only cookie with token, redirects to `/admin`
- On failure: returns error message

```typescript
async function logoutAction(): Promise<void>
```
- Clears auth cookie
- Redirects to `/login`

### 3. Product Actions (`actions/products.ts`)

**Server Actions**:

```typescript
async function createProductAction(formData: FormData): Promise<{ success: boolean; error?: string }>
```
- Extracts product fields from FormData
- Handles file upload for image
- Calls `pb.collection('products').create(data)`
- Revalidates `/admin` path
- Returns success/error status

```typescript
async function updateProductAction(id: string, formData: FormData): Promise<{ success: boolean; error?: string }>
```
- Extracts product fields from FormData
- Handles optional file upload for image
- Calls `pb.collection('products').update(id, data)`
- Revalidates `/admin` path
- Returns success/error status

```typescript
async function deleteProductAction(id: string): Promise<{ success: boolean; error?: string }>
```
- Calls `pb.collection('products').delete(id)`
- Revalidates `/admin` path
- Returns success/error status


### 4. Middleware (`middleware.ts`)

**Purpose**: Protect admin routes from unauthenticated access.

**Behavior**:
```typescript
export function middleware(request: NextRequest)
```
- Checks if request path starts with `/admin`
- Reads auth cookie from request
- If cookie missing: redirects to `/login`
- If cookie present: allows request to proceed
- Special case: if authenticated user visits `/login`, redirect to `/admin`

**Matcher Configuration**:
```typescript
export const config = {
  matcher: ['/admin/:path*', '/login']
}
```

### 5. Login Page (`app/login/page.tsx`)

**Component Type**: Client Component (`'use client'`)

**UI Elements**:
- Email input field (required)
- Password input field (required, type="password")
- Submit button with loading state
- Error message display area
- "Forgot password?" link (optional)

**Behavior**:
- Form submission calls `loginAction()` Server Action
- Displays loading state during authentication
- Shows error messages on failure
- Redirects handled by Server Action on success

**Styling**: Centered card layout, responsive, matches existing design from `e-com-admin-dashboard/components/Login.tsx`


### 6. Admin Dashboard (`app/admin/page.tsx`)

**Component Type**: Server Component (default)

**Data Fetching**:
```typescript
const pb = createClient()
const products = await pb.collection('products').getFullList<Product>({
  sort: '-created'
})
```

**Behavior**:
- Fetches all products on server
- Passes data to `<ProductList>` Client Component
- Handles loading and error states
- Includes logout button in header

**Layout**:
- Header with title and logout button
- Search and filter controls
- View mode toggle (table/grid)
- Add Product button
- Product list/grid display

### 7. Product List (`components/ProductList.tsx`)

**Component Type**: Client Component (`'use client'`)

**Props**:
```typescript
interface ProductListProps {
  initialData: Product[]
}
```

**State Management**:
- `products`: Product[] - current product list
- `searchTerm`: string - search filter
- `viewMode`: 'table' | 'grid' - display mode
- `isModalOpen`: boolean - form modal state
- `editingProduct`: Product | null - product being edited

**UI Modes**:

1. **Desktop Table View** (hidden on mobile):
   - Columns: Image, Name, Price, Active Status, Actions
   - Inline editing for name and price
   - Hover actions for edit/delete
   - Responsive column widths

2. **Mobile Card View** (visible on mobile, optional on desktop):
   - Grid layout (1 column on mobile, 2-4 on larger screens)
   - Card shows: image, name, price, active badge
   - Tap card to edit
   - Delete button on card

**Interactions**:
- Search filters products by name
- View toggle switches between table/grid
- Click row/card opens edit modal
- Delete button shows confirmation dialog
- Add button opens create modal


### 8. Product Form (`components/ProductForm.tsx`)

**Component Type**: Client Component (`'use client'`)

**Props**:
```typescript
interface ProductFormProps {
  product?: Product | null
  isOpen: boolean
  onClose: () => void
}
```

**Form Fields**:
- Name (text input, required)
- Price (number input, required, min=0, step=0.01)
- Active (checkbox)
- Image (file input, accept="image/*")

**Image Handling**:
- For existing products: display current image using `pb.files.getURL()`
- For new images: show file input with preview
- Image URL construction: `${pbUrl}/api/files/${collectionId}/${recordId}/${filename}`
- File upload: send File object in FormData

**Behavior**:
- Create mode: empty form, calls `createProductAction()`
- Edit mode: pre-filled form, calls `updateProductAction()`
- Image preview updates on file selection
- Form validation before submission
- Loading state during submission
- Success: closes modal, refreshes list
- Error: displays error message, keeps modal open

**Styling**: Slide-over drawer from right, matches existing design from `e-com-admin-dashboard/components/ProductForm.tsx`

## Data Models

### Product Type

```typescript
interface Product {
  id: string
  name: string
  price: number
  active: boolean
  image: string  // filename only
  created: string
  updated: string
  collectionId: string
  collectionName: string
}
```

### PocketBase Collections Schema

**Collection**: `products`

| Field | Type | Required | Options |
|-------|------|----------|---------|
| name | text | Yes | - |
| price | number | Yes | min: 0 |
| active | bool | Yes | default: true |
| image | file | No | maxSelect: 1, maxSize: 5MB |


## Correctness Properties

A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.

### Property 1: Successful Authentication Flow
*For any* valid admin credentials, when authentication succeeds, the system should store the auth token in an HTTP-only cookie AND redirect to /admin.
**Validates: Requirements 1.2, 1.3, 1.4**

### Property 2: Authentication Failure Handling
*For any* invalid credentials, authentication should fail and display an error message while maintaining the form state.
**Validates: Requirements 1.5**

### Property 3: Empty Credential Validation
*For any* string composed entirely of whitespace or empty strings, the login form should prevent submission and display validation errors.
**Validates: Requirements 1.6**

### Property 4: Unauthenticated Route Protection
*For any* route under /admin, when accessed without a valid auth cookie, the system should redirect to /login.
**Validates: Requirements 2.1, 9.3**

### Property 5: Authenticated Route Access
*For any* route under /admin, when accessed with a valid auth cookie, the system should allow access and render the requested page.
**Validates: Requirements 2.2**

### Property 6: Invalid Token Handling
*For any* missing or malformed auth token, the system should treat the user as unauthenticated.
**Validates: Requirements 2.3**

### Property 7: Authenticated Login Redirect
*For any* authenticated user accessing /login, the system should redirect to /admin.
**Validates: Requirements 2.4**

### Property 8: Server-Side Client Authentication
*For any* call to createClient() on the server, the PocketBase instance should automatically load the auth token from cookies.
**Validates: Requirements 3.2**

### Property 9: Client-Side Client Initialization
*For any* call to createClient() on the client, the PocketBase instance should initialize without automatic authentication.
**Validates: Requirements 3.3**


### Property 10: Product Fetch on Page Access
*For any* access to /admin page, the system should fetch all products from the products collection.
**Validates: Requirements 4.1**

### Property 11: Product Image URL Construction
*For any* product with an image, the displayed image URL should be constructed using the PocketBase file URL format: `${pbUrl}/api/files/${collectionId}/${recordId}/${filename}`.
**Validates: Requirements 4.4, 6.2**

### Property 12: Product Creation with Valid Data
*For any* valid product data (non-empty name, positive price, boolean active, optional image), submitting the create form should create a new product record in PocketBase.
**Validates: Requirements 5.3**

### Property 13: Image Upload in FormData
*For any* image file upload, the system should send the file to PocketBase as part of the FormData with the correct field name.
**Validates: Requirements 5.4**

### Property 14: Mutation Success Flow
*For any* successful product creation or update, the system should redirect to the product list and display a success message.
**Validates: Requirements 5.5, 6.6**

### Property 15: Invalid Data Validation
*For any* invalid product data (empty name, negative price, invalid file type), the form should display validation errors for each invalid field without submitting.
**Validates: Requirements 5.7**

### Property 16: Edit Form Pre-fill
*For any* product being edited, the edit form should be pre-filled with all current values including name, price, active status, and image.
**Validates: Requirements 6.1**

### Property 17: Image Replacement
*For any* product update with a new image file, the system should replace the existing image with the new file in PocketBase.
**Validates: Requirements 6.3**

### Property 18: Image Preservation on Update
*For any* product update without a new image file, the system should preserve the existing image unchanged.
**Validates: Requirements 6.4**

### Property 19: Product Update with Valid Changes
*For any* valid product changes, submitting the edit form should update the product record in PocketBase with the new values.
**Validates: Requirements 6.5**

### Property 20: Delete Confirmation Dialog
*For any* product delete action, the system should display a confirmation dialog before proceeding with deletion.
**Validates: Requirements 7.1**

### Property 21: Confirmed Deletion Flow
*For any* confirmed product deletion, the system should delete the product from PocketBase AND remove it from the displayed list.
**Validates: Requirements 7.2, 7.3**

### Property 22: Cancelled Deletion
*For any* cancelled deletion, the system should close the confirmation dialog without deleting the product or modifying the list.
**Validates: Requirements 7.5**

### Property 23: Logout Flow
*For any* logout action, the system should clear the auth token cookie AND redirect to /login.
**Validates: Requirements 9.1, 9.2**


## Error Handling

### Authentication Errors

**Invalid Credentials**:
- Catch PocketBase authentication errors
- Display user-friendly error message: "Invalid email or password"
- Maintain form state (don't clear password field for security)
- Log error details server-side for debugging

**Network Errors**:
- Catch connection failures to PocketBase
- Display: "Unable to connect to server. Please try again."
- Implement retry mechanism with exponential backoff
- Provide manual retry button

**Token Expiration**:
- Middleware detects expired tokens
- Clear invalid cookie
- Redirect to /login with message: "Session expired. Please log in again."

### Product Operation Errors

**Fetch Failures**:
- Catch errors in Server Component
- Display error boundary with retry button
- Log error details for monitoring
- Fallback to empty state with clear messaging

**Create/Update Failures**:
- Catch PocketBase errors in Server Actions
- Return structured error response: `{ success: false, error: string }`
- Display error in form without closing modal
- Preserve form state for user correction
- Handle specific errors:
  - Validation errors: Show field-specific messages
  - File upload errors: "Image upload failed. Please try a smaller file."
  - Network errors: "Unable to save. Please check your connection."

**Delete Failures**:
- Catch deletion errors
- Display error toast: "Failed to delete product. Please try again."
- Maintain product in list
- Log error for debugging

### File Upload Errors

**Size Validation**:
- Check file size before upload (max 5MB)
- Display: "Image must be smaller than 5MB"
- Prevent form submission

**Type Validation**:
- Validate file type is image/* before upload
- Display: "Please upload a valid image file (JPG, PNG, GIF)"
- Prevent form submission

**Upload Failures**:
- Catch PocketBase file upload errors
- Display: "Image upload failed. Please try again."
- Allow user to retry or proceed without image

### Environment Configuration Errors

**Missing Environment Variables**:
- Check for `NEXT_PUBLIC_POCKETBASE_URL` at build time
- Display clear error page if missing
- Provide setup instructions
- Prevent application from starting in broken state


## Testing Strategy

### Overview

The testing strategy employs a dual approach combining unit tests for specific examples and edge cases with property-based tests for universal correctness properties. This comprehensive approach ensures both concrete functionality and general correctness across all inputs.

### Property-Based Testing

**Framework**: We will use **fast-check** for TypeScript property-based testing.

**Configuration**:
- Minimum 100 iterations per property test
- Each test tagged with format: `Feature: pocketbase-admin-panel, Property {number}: {property_text}`
- Tests organized by component/feature area

**Property Test Coverage**:

1. **Authentication Properties** (Properties 1-3, 6-7):
   - Generate random valid/invalid credentials
   - Test authentication flow with various token states
   - Verify cookie handling across scenarios

2. **Route Protection Properties** (Properties 4-5):
   - Generate random /admin routes
   - Test with various authentication states
   - Verify redirect behavior

3. **PocketBase Client Properties** (Properties 8-9):
   - Test client initialization in server/client contexts
   - Verify auth token loading behavior

4. **Product CRUD Properties** (Properties 10, 12-13, 17-19, 21-22):
   - Generate random product data
   - Test create/update/delete operations
   - Verify data integrity and persistence

5. **Image Handling Properties** (Properties 11, 13, 17-18):
   - Generate various image files
   - Test URL construction
   - Verify upload and preservation logic

6. **Form Validation Properties** (Properties 3, 15):
   - Generate invalid inputs (empty, whitespace, negative numbers)
   - Verify validation errors displayed correctly

### Unit Testing

**Framework**: Vitest with React Testing Library

**Unit Test Focus**:
- Specific UI examples (login form renders, product card displays)
- Edge cases (empty product list, missing images)
- Error conditions (network failures, validation errors)
- Integration points (Server Actions, middleware)

**Test Organization**:
```
__tests__/
├── unit/
│   ├── components/
│   │   ├── ProductList.test.tsx
│   │   ├── ProductForm.test.tsx
│   │   └── LoginPage.test.tsx
│   ├── actions/
│   │   ├── auth.test.ts
│   │   └── products.test.ts
│   └── lib/
│       └── pocketbase.test.ts
└── properties/
    ├── auth.properties.test.ts
    ├── products.properties.test.ts
    └── routing.properties.test.ts
```

### Integration Testing

**Approach**: Test complete user flows with mocked PocketBase

**Key Flows**:
1. Login → View Products → Create Product → Logout
2. Login → Edit Product → Update Image → Save
3. Login → Delete Product → Confirm → Verify Removal
4. Unauthenticated Access → Redirect → Login → Access Granted

**Tools**:
- Playwright for E2E testing
- MSW (Mock Service Worker) for API mocking
- Test PocketBase instance for integration tests

### Test Data Generation

**For Property Tests**:
```typescript
// Example generators using fast-check
const productArbitrary = fc.record({
  name: fc.string({ minLength: 1, maxLength: 100 }),
  price: fc.float({ min: 0.01, max: 10000, noNaN: true }),
  active: fc.boolean(),
  image: fc.option(fc.constant('test-image.jpg'))
})

const credentialsArbitrary = fc.record({
  email: fc.emailAddress(),
  password: fc.string({ minLength: 8, maxLength: 50 })
})
```

### Mocking Strategy

**PocketBase Mocking**:
- Mock PocketBase client for unit tests
- Use test instance for integration tests
- Mock file uploads with test images
- Simulate network errors and edge cases

**Cookie Mocking**:
- Mock Next.js cookies() function
- Test cookie setting/clearing
- Verify HTTP-only and secure flags

### Continuous Integration

**CI Pipeline**:
1. Run unit tests on every commit
2. Run property tests (100 iterations) on every PR
3. Run integration tests before merge
4. Generate coverage reports (target: 80%+)

**Performance Benchmarks**:
- Property tests should complete in < 30 seconds
- Unit tests should complete in < 10 seconds
- Integration tests should complete in < 2 minutes

### Test Coverage Goals

- **Unit Test Coverage**: 80%+ for components and actions
- **Property Test Coverage**: All 23 correctness properties implemented
- **Integration Test Coverage**: All critical user flows
- **Edge Case Coverage**: All error handling paths tested

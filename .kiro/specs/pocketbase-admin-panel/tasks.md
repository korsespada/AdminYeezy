# Implementation Plan: PocketBase Admin Panel

## Overview

This implementation plan breaks down the PocketBase Admin Panel into discrete, incremental coding tasks. Each task builds on previous work, starting with core infrastructure (PocketBase client, authentication), then adding product management features, and finally implementing the responsive UI. The plan emphasizes early validation through testing and includes checkpoints to ensure stability before proceeding.

## Tasks

- [x] 1. Set up Next.js project structure and dependencies
  - Initialize Next.js 14/15 project with App Router
  - Install dependencies: pocketbase, tailwind CSS, shadcn/ui, fast-check, vitest
  - Configure TypeScript with strict mode
  - Set up environment variables structure (.env.local with NEXT_PUBLIC_POCKETBASE_URL)
  - _Requirements: 10.1_

- [ ] 2. Create PocketBase client helper
  - [x] 2.1 Implement createClient() function in lib/pocketbase.ts
    - Initialize PocketBase with environment variable
    - Detect server vs client context
    - Load auth token from cookies on server
    - Return configured PocketBase instance
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 2.2 Write property test for server-side client authentication
    - **Property 8: Server-Side Client Authentication**
    - **Validates: Requirements 3.2**

  - [x] 2.3 Write property test for client-side client initialization
    - **Property 9: Client-Side Client Initialization**
    - **Validates: Requirements 3.3**

  - [x] 2.4 Write unit test for environment variable usage
    - Test createClient uses NEXT_PUBLIC_POCKETBASE_URL
    - Test error handling when env var is missing
    - _Requirements: 3.4, 10.1, 10.2_

- [x] 3. Implement TypeScript types
  - Create lib/types.ts with Product interface
  - Define PocketBase collection types
  - Export type definitions for use across application
  - _Requirements: 3.5_


- [ ] 4. Implement authentication Server Actions
  - [x] 4.1 Create actions/auth.ts with loginAction()
    - Extract email and password from FormData
    - Call pb.admins.authWithPassword()
    - Set HTTP-only cookie with auth token on success
    - Return error message on failure
    - Redirect to /admin on success
    - _Requirements: 1.2, 1.3, 1.4, 1.5_

  - [x] 4.2 Implement logoutAction() in actions/auth.ts
    - Clear auth token cookie
    - Redirect to /login
    - _Requirements: 9.1, 9.2_

  - [x] 4.3 Write property test for successful authentication flow
    - **Property 1: Successful Authentication Flow**
    - **Validates: Requirements 1.2, 1.3, 1.4**

  - [x] 4.4 Write property test for authentication failure handling
    - **Property 2: Authentication Failure Handling**
    - **Validates: Requirements 1.5**

  - [x] 4.5 Write property test for empty credential validation
    - **Property 3: Empty Credential Validation**
    - **Validates: Requirements 1.6**

  - [x] 4.6 Write property test for logout flow
    - **Property 23: Logout Flow**
    - **Validates: Requirements 9.1, 9.2**

- [ ] 5. Create middleware for route protection
  - [x] 5.1 Implement middleware.ts
    - Check if request path starts with /admin
    - Read auth cookie from request
    - Redirect to /login if cookie missing
    - Allow request if cookie present
    - Redirect authenticated users from /login to /admin
    - Configure matcher for /admin/:path* and /login
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 5.2 Write property test for unauthenticated route protection
    - **Property 4: Unauthenticated Route Protection**
    - **Validates: Requirements 2.1, 9.3**

  - [x] 5.3 Write property test for authenticated route access
    - **Property 5: Authenticated Route Access**
    - **Validates: Requirements 2.2**

  - [x] 5.4 Write property test for invalid token handling
    - **Property 6: Invalid Token Handling**
    - **Validates: Requirements 2.3**

  - [x] 5.5 Write property test for authenticated login redirect
    - **Property 7: Authenticated Login Redirect**
    - **Validates: Requirements 2.4**

- [x] 6. Checkpoint - Authentication and routing infrastructure
  - Ensure all tests pass, ask the user if questions arise.


- [ ] 7. Build login page
  - [x] 7.1 Create app/login/page.tsx as Client Component
    - Add 'use client' directive
    - Create form with email and password inputs
    - Add submit button with loading state
    - Display error messages from Server Action
    - Call loginAction() on form submission
    - Style with Tailwind CSS matching existing design
    - _Requirements: 1.1, 1.6_

  - [x] 7.2 Write unit test for login form rendering
    - Test form displays email and password fields
    - Test submit button is present
    - _Requirements: 1.1_

  - [x] 7.3 Write unit test for form validation
    - Test empty field validation
    - Test error message display
    - _Requirements: 1.6_

- [ ] 8. Implement product Server Actions
  - [x] 8.1 Create actions/products.ts with createProductAction()
    - Extract product fields from FormData
    - Handle file upload for image
    - Call pb.collection('products').create()
    - Revalidate /admin path
    - Return success/error status
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 8.2 Implement updateProductAction() in actions/products.ts
    - Extract product fields and ID from FormData
    - Handle optional file upload for image
    - Call pb.collection('products').update()
    - Revalidate /admin path
    - Return success/error status
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 8.3 Implement deleteProductAction() in actions/products.ts
    - Accept product ID parameter
    - Call pb.collection('products').delete()
    - Revalidate /admin path
    - Return success/error status
    - _Requirements: 7.2, 7.3, 7.4_

  - [x] 8.4 Write property test for product creation with valid data
    - **Property 12: Product Creation with Valid Data**
    - **Validates: Requirements 5.3**

  - [x] 8.5 Write property test for image upload in FormData
    - **Property 13: Image Upload in FormData**
    - **Validates: Requirements 5.4**

  - [x] 8.6 Write property test for mutation success flow
    - **Property 14: Mutation Success Flow**
    - **Validates: Requirements 5.5, 6.6**

  - [x] 8.7 Write property test for invalid data validation
    - **Property 15: Invalid Data Validation**
    - **Validates: Requirements 5.7**

  - [x] 8.8 Write property test for image replacement
    - **Property 17: Image Replacement**
    - **Validates: Requirements 6.3**

  - [x] 8.9 Write property test for image preservation on update
    - **Property 18: Image Preservation on Update**
    - **Validates: Requirements 6.4**

  - [x] 8.10 Write property test for product update with valid changes
    - **Property 19: Product Update with Valid Changes**
    - **Validates: Requirements 6.5**


- [ ] 9. Create admin dashboard page
  - [x] 9.1 Implement app/admin/page.tsx as Server Component
    - Create PocketBase client with createClient()
    - Fetch all products using pb.collection('products').getFullList()
    - Handle loading and error states
    - Pass products data to ProductList Client Component
    - Add logout button in header
    - _Requirements: 4.1, 4.6_

  - [x] 9.2 Write property test for product fetch on page access
    - **Property 10: Product Fetch on Page Access**
    - **Validates: Requirements 4.1**

  - [x] 9.3 Write unit test for error handling
    - Test error boundary displays on fetch failure
    - Test empty state displays when no products
    - _Requirements: 4.5, 4.6_

- [ ] 10. Build ProductList component
  - [x] 10.1 Create components/ProductList.tsx as Client Component
    - Add 'use client' directive
    - Accept initialData prop with Product[]
    - Implement state for products, searchTerm, viewMode
    - Add search input with filter logic
    - Add view mode toggle (table/grid)
    - Add "Add Product" button
    - Implement desktop table view (hidden on mobile)
    - Implement mobile card grid view
    - Add click handlers for edit and delete
    - _Requirements: 4.2, 4.3, 4.4, 8.1, 8.2_

  - [x] 10.2 Write property test for product image URL construction
    - **Property 11: Product Image URL Construction**
    - **Validates: Requirements 4.4, 6.2**

  - [x] 10.3 Write unit tests for responsive views
    - Test desktop table view renders correctly
    - Test mobile card grid renders correctly
    - _Requirements: 4.2, 4.3, 8.1, 8.2_

- [x] 11. Checkpoint - Product listing and basic UI
  - Ensure all tests pass, ask the user if questions arise.


- [ ] 12. Implement ProductForm component
  - [x] 12.1 Create components/ProductForm.tsx as Client Component
    - Add 'use client' directive
    - Accept props: product (optional), isOpen, onClose
    - Implement form state for name, price, active, image
    - Add form fields with validation
    - Implement image upload with preview
    - Handle create mode (empty form)
    - Handle edit mode (pre-filled form)
    - Call createProductAction or updateProductAction on submit
    - Display loading state during submission
    - Display error messages
    - Close modal on success
    - Style as slide-over drawer matching existing design
    - _Requirements: 5.1, 5.2, 5.7, 6.1, 6.2_

  - [x] 12.2 Write property test for edit form pre-fill
    - **Property 16: Edit Form Pre-fill**
    - **Validates: Requirements 6.1**

  - [x] 12.3 Write unit tests for form modes
    - Test create mode displays empty form
    - Test edit mode displays pre-filled form
    - Test image preview updates on file selection
    - _Requirements: 5.1, 5.2, 6.1_

  - [x] 12.4 Write unit tests for form validation
    - Test validation errors display for invalid inputs
    - Test form prevents submission with invalid data
    - _Requirements: 5.7_

- [ ] 13. Add delete confirmation dialog
  - [x] 13.1 Implement delete confirmation in ProductList
    - Add confirmation dialog component
    - Show dialog when delete button clicked
    - Call deleteProductAction on confirmation
    - Close dialog on cancellation without deleting
    - Display success message after deletion
    - Handle deletion errors
    - _Requirements: 7.1, 7.5_

  - [x] 13.2 Write property test for delete confirmation dialog
    - **Property 20: Delete Confirmation Dialog**
    - **Validates: Requirements 7.1**

  - [x] 13.3 Write property test for confirmed deletion flow
    - **Property 21: Confirmed Deletion Flow**
    - **Validates: Requirements 7.2, 7.3**

  - [x] 13.4 Write property test for cancelled deletion
    - **Property 22: Cancelled Deletion**
    - **Validates: Requirements 7.5**

  - [x] 13.5 Write unit test for delete error handling
    - Test error message displays on deletion failure
    - _Requirements: 7.4_


- [x] 14. Implement shadcn/ui components
  - Install and configure shadcn/ui
  - Add Button component from shadcn/ui
  - Add Dialog component for confirmations
  - Add Input components for forms
  - Add Toast/Alert components for notifications
  - Ensure all components use Tailwind CSS
  - _Requirements: 8.3, 8.4_

- [ ] 15. Add responsive design refinements
  - [x] 15.1 Implement responsive breakpoints
    - Configure Tailwind breakpoints (mobile: <768px, desktop: >=768px)
    - Add responsive classes to ProductList table (hidden md:block)
    - Add responsive classes to ProductList grid (block md:hidden or conditional)
    - Ensure ProductForm is mobile-friendly
    - Test on various viewport sizes
    - _Requirements: 8.1, 8.2, 8.5, 8.6_

  - [x] 15.2 Write unit tests for responsive behavior
    - Test table view hidden on mobile
    - Test grid view visible on mobile
    - _Requirements: 8.1, 8.2_

- [x] 16. Implement error handling and edge cases
  - Add error boundaries for Server Components
  - Implement retry mechanisms for network errors
  - Add file size validation (max 5MB)
  - Add file type validation (image/* only)
  - Display user-friendly error messages
  - Handle token expiration gracefully
  - Add loading states for all async operations
  - _Requirements: 1.5, 4.6, 5.6, 6.7, 7.4, 10.2_

- [x] 17. Add integration wiring
  - Wire ProductList to ProductForm for create/edit
  - Wire ProductList to delete confirmation dialog
  - Wire login page to authentication actions
  - Wire admin page to logout action
  - Ensure all Server Actions properly revalidate paths
  - Test complete user flows end-to-end
  - _Requirements: All_

- [x] 18. Final checkpoint - Complete application
  - Run all unit tests and ensure they pass
  - Run all property tests (100 iterations each) and ensure they pass
  - Test complete user flows manually
  - Verify responsive design on mobile and desktop
  - Check error handling for all edge cases
  - Ensure environment variables are properly configured
  - Ask the user if questions arise before deployment


## Notes

- All tasks are required for comprehensive implementation
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at key milestones
- Property tests validate universal correctness properties across all inputs
- Unit tests validate specific examples, edge cases, and error conditions
- The implementation follows Next.js App Router best practices with Server Components and Server Actions
- All authentication uses HTTP-only cookies for security
- The UI adapts responsively between desktop table and mobile card layouts

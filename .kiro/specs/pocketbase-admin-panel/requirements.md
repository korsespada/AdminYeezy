# Requirements Document

## Introduction

This document specifies the requirements for a Product Admin Panel built with Next.js 14/15 (App Router) and deployed on Vercel. The system provides authenticated administrators with the ability to manage products stored in an external PocketBase database instance. The admin panel includes secure authentication, full CRUD operations for products, and a responsive UI that adapts between desktop and mobile devices.

## Glossary

- **Admin_Panel**: The Next.js web application that provides the administrative interface
- **PocketBase**: The external backend database and authentication service
- **Admin_User**: A PocketBase superuser with administrative privileges
- **Product**: A database record in the products collection containing name, price, active status, and image
- **Auth_Token**: The authentication token issued by PocketBase upon successful login
- **Server_Action**: Next.js server-side function that handles form submissions and data mutations
- **Server_Component**: Next.js component that renders on the server and can directly access backend resources

## Requirements

### Requirement 1: Admin Authentication

**User Story:** As an administrator, I want to log in using my PocketBase admin credentials, so that I can securely access the admin panel.

#### Acceptance Criteria

1. WHEN an Admin_User navigates to the login page, THE Admin_Panel SHALL display a form with email and password fields
2. WHEN an Admin_User submits valid credentials, THE Admin_Panel SHALL authenticate with PocketBase using the admin authentication endpoint
3. WHEN authentication succeeds, THE Admin_Panel SHALL store the Auth_Token in a secure HTTP-only cookie
4. WHEN authentication succeeds, THE Admin_Panel SHALL redirect the Admin_User to the /admin dashboard
5. WHEN authentication fails, THE Admin_Panel SHALL display an error message and maintain the login form state
6. WHEN an Admin_User submits empty credentials, THE Admin_Panel SHALL prevent submission and display validation errors

### Requirement 2: Route Protection

**User Story:** As a system administrator, I want all admin routes to be protected, so that unauthorized users cannot access administrative functions.

#### Acceptance Criteria

1. WHEN an unauthenticated user attempts to access any route under /admin, THE Admin_Panel SHALL redirect them to the /login page
2. WHEN an authenticated Admin_User accesses routes under /admin, THE Admin_Panel SHALL allow access and render the requested page
3. WHEN the Auth_Token cookie is missing or invalid, THE Admin_Panel SHALL treat the user as unauthenticated
4. WHEN an authenticated Admin_User accesses the /login page, THE Admin_Panel SHALL redirect them to /admin

### Requirement 3: PocketBase Client Integration

**User Story:** As a developer, I want a typed PocketBase client helper, so that I can interact with PocketBase consistently and safely throughout the application.

#### Acceptance Criteria

1. THE Admin_Panel SHALL provide a createClient function that initializes a PocketBase instance
2. WHEN the createClient function runs on the server, THE Admin_Panel SHALL automatically load the Auth_Token from cookies
3. WHEN the createClient function runs on the client, THE Admin_Panel SHALL initialize PocketBase without automatic authentication
4. THE Admin_Panel SHALL use the NEXT_PUBLIC_POCKETBASE_URL environment variable for the PocketBase instance URL
5. THE Admin_Panel SHALL provide TypeScript type definitions for all PocketBase collections

### Requirement 4: Product Listing

**User Story:** As an administrator, I want to view all products in the database, so that I can see what products exist and their current status.

#### Acceptance Criteria

1. WHEN an Admin_User accesses the /admin page, THE Admin_Panel SHALL fetch all products from the products collection
2. WHEN displaying products on desktop, THE Admin_Panel SHALL render them in a table format with columns for name, price, active status, and image
3. WHEN displaying products on mobile devices, THE Admin_Panel SHALL render them in a grid of cards
4. WHEN a Product has an image, THE Admin_Panel SHALL display the image using the PocketBase file URL
5. WHEN the products list is empty, THE Admin_Panel SHALL display a message indicating no products exist
6. WHEN fetching products fails, THE Admin_Panel SHALL display an error message

### Requirement 5: Product Creation

**User Story:** As an administrator, I want to create new products, so that I can add items to the catalog.

#### Acceptance Criteria

1. WHEN an Admin_User clicks the create product button, THE Admin_Panel SHALL display a product creation form
2. THE Admin_Panel SHALL provide input fields for name (text), price (number), active (boolean), and image (file upload)
3. WHEN an Admin_User submits the form with valid data, THE Admin_Panel SHALL create a new Product record in PocketBase
4. WHEN an Admin_User uploads an image file, THE Admin_Panel SHALL send the file to PocketBase as part of the FormData
5. WHEN product creation succeeds, THE Admin_Panel SHALL redirect to the product list and display a success message
6. WHEN product creation fails, THE Admin_Panel SHALL display an error message and maintain the form state
7. WHEN an Admin_User submits invalid data, THE Admin_Panel SHALL display validation errors for each invalid field

### Requirement 6: Product Editing

**User Story:** As an administrator, I want to edit existing products, so that I can update product information and images.

#### Acceptance Criteria

1. WHEN an Admin_User clicks edit on a Product, THE Admin_Panel SHALL display a product edit form pre-filled with current values
2. WHEN displaying an existing image, THE Admin_Panel SHALL show the current image using the PocketBase file URL
3. WHEN an Admin_User uploads a new image, THE Admin_Panel SHALL replace the existing image with the new file
4. WHEN an Admin_User updates product fields without changing the image, THE Admin_Panel SHALL preserve the existing image
5. WHEN an Admin_User submits the form with valid changes, THE Admin_Panel SHALL update the Product record in PocketBase
6. WHEN product update succeeds, THE Admin_Panel SHALL redirect to the product list and display a success message
7. WHEN product update fails, THE Admin_Panel SHALL display an error message and maintain the form state

### Requirement 7: Product Deletion

**User Story:** As an administrator, I want to delete products, so that I can remove items from the catalog.

#### Acceptance Criteria

1. WHEN an Admin_User clicks delete on a Product, THE Admin_Panel SHALL display a confirmation dialog
2. WHEN an Admin_User confirms deletion, THE Admin_Panel SHALL delete the Product record from PocketBase
3. WHEN deletion succeeds, THE Admin_Panel SHALL remove the product from the list and display a success message
4. WHEN deletion fails, THE Admin_Panel SHALL display an error message and maintain the current state
5. WHEN an Admin_User cancels the deletion, THE Admin_Panel SHALL close the dialog without deleting the product

### Requirement 8: Responsive UI Design

**User Story:** As an administrator, I want the admin panel to work well on both desktop and mobile devices, so that I can manage products from any device.

#### Acceptance Criteria

1. WHEN the viewport width is desktop size, THE Admin_Panel SHALL display products in a table layout
2. WHEN the viewport width is mobile size, THE Admin_Panel SHALL display products in a card grid layout
3. THE Admin_Panel SHALL use Tailwind CSS for styling
4. THE Admin_Panel SHALL use shadcn/ui components for consistent UI elements
5. WHEN forms are displayed on mobile, THE Admin_Panel SHALL ensure all inputs are easily accessible and usable
6. WHEN images are displayed, THE Admin_Panel SHALL ensure they are appropriately sized for the viewport

### Requirement 9: Session Management

**User Story:** As an administrator, I want to log out of the admin panel, so that I can end my session securely.

#### Acceptance Criteria

1. WHEN an Admin_User clicks the logout button, THE Admin_Panel SHALL clear the Auth_Token cookie
2. WHEN logout completes, THE Admin_Panel SHALL redirect the Admin_User to the /login page
3. WHEN an Admin_User attempts to access /admin after logout, THE Admin_Panel SHALL redirect them to /login

### Requirement 10: Environment Configuration

**User Story:** As a developer, I want to configure the PocketBase URL via environment variables, so that I can deploy to different environments without code changes.

#### Acceptance Criteria

1. THE Admin_Panel SHALL read the PocketBase URL from the NEXT_PUBLIC_POCKETBASE_URL environment variable
2. WHEN the environment variable is missing, THE Admin_Panel SHALL display a clear error message
3. THE Admin_Panel SHALL support deployment to Vercel with environment variables configured in the Vercel dashboard

# PocketBase Admin Panel

Product management admin panel built with Next.js 14/15 and PocketBase.

## ✨ Features

- 🔐 Secure authentication with HTTP-only cookies
- 📦 Full CRUD operations for products
- 🖼️ Image upload and management (up to 5MB)
- 📱 Responsive UI (table on desktop, cards on mobile)
- ⚡ Server Components and Server Actions
- 🎨 Tailwind CSS styling
- ✅ Property-based testing with fast-check
- 🌙 Dark mode support

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ 
- PocketBase instance running (download from [pocketbase.io](https://pocketbase.io))

### Installation

1. **Install dependencies:**
```bash
npm install
```

2. **Configure environment variables:**

Create `.env.local` file in the root directory:
```env
NEXT_PUBLIC_POCKETBASE_URL=http://127.0.0.1:8090
```

3. **Set up PocketBase:**

Download and run PocketBase:
```bash
# Download PocketBase from https://pocketbase.io/docs/
# Extract and run:
./pocketbase serve
```

Create a `products` collection in PocketBase Admin UI (http://127.0.0.1:8090/_/):

| Field  | Type   | Required | Options              |
|--------|--------|----------|----------------------|
| name   | text   | Yes      | -                    |
| price  | number | Yes      | min: 0               |
| active | bool   | Yes      | default: true        |
| image  | file   | No       | maxSelect: 1, 5MB    |

Create an admin user in PocketBase Admin UI.

4. **Run the development server:**
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in with your PocketBase admin credentials.

### Testing

Run all tests:
```bash
npm test
```

Run tests with UI:
```bash
npm run test:ui
```

Run tests in watch mode:
```bash
npm test -- --watch
```

### Building for Production

```bash
npm run build
npm start
```

## 🚀 Deploy to Vercel

### Environment Variables

Add these environment variables in Vercel dashboard (Settings → Environment Variables):

| Variable Name | Description | Example |
|--------------|-------------|---------|
| `NEXT_PUBLIC_POCKETBASE_URL` | Your PocketBase instance URL | `http://144.31.116.66:8090` |

### Deploy Steps

1. **Push to GitHub:**
```bash
git remote add origin https://github.com/korsespada/AdminYeezy.git
git branch -M main
git add .
git commit -m "Initial commit"
git push -u origin main
```

2. **Import to Vercel:**
   - Go to [vercel.com](https://vercel.com)
   - Click "Add New Project"
   - Import your GitHub repository
   - Add environment variable: `NEXT_PUBLIC_POCKETBASE_URL`
   - Click "Deploy"

3. **Configure PocketBase:**
   - Make sure your PocketBase instance is accessible from the internet
   - Update CORS settings in PocketBase if needed

### Important Notes

- PocketBase must be publicly accessible for Vercel deployment to work
- Use HTTPS for production PocketBase instances
- Consider using a reverse proxy (nginx) for PocketBase in production

## 📁 Project Structure

```
├── app/                    # Next.js App Router
│   ├── login/             # Login page
│   ├── admin/             # Admin dashboard
│   └── layout.tsx         # Root layout
├── actions/               # Server Actions
│   ├── auth.ts           # Authentication actions
│   └── products.ts       # Product CRUD actions
├── components/            # React components
│   ├── ProductList.tsx   # Product list/grid
│   └── ProductForm.tsx   # Create/edit form
├── lib/                   # Utilities
│   ├── pocketbase.ts     # PocketBase client
│   └── types.ts          # TypeScript types
├── __tests__/            # Tests
│   ├── unit/             # Unit tests
│   └── properties/       # Property-based tests
└── middleware.ts         # Route protection
```

## 🧪 Testing

The project includes comprehensive testing:

- **35 tests** passing
- **Property-based tests** (100 iterations each) for:
  - Authentication flow
  - Route protection
  - Product validation
  - Image handling
- **Unit tests** for:
  - Components
  - Server Actions
  - PocketBase client

## 🎨 UI Features

### Desktop View
- Table layout with sortable columns
- Inline editing capabilities
- Hover actions for quick access
- Search and filter functionality

### Mobile View
- Card grid layout
- Touch-friendly interactions
- Optimized for small screens
- Swipe gestures support

### Dark Mode
- Automatic dark mode support
- Consistent styling across themes
- Accessible color contrast

## 🔒 Security

- HTTP-only cookies for auth tokens
- Server-side authentication
- Middleware-based route protection
- CSRF protection via Next.js
- Input validation and sanitization
- File upload restrictions (type, size)

## 📝 License

MIT

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📧 Support

For issues and questions, please open an issue on GitHub.

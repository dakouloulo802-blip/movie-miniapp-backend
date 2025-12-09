# Movie MiniApp

A Telegram MiniApp for movie downloads with Firebase/Firestore backend and Blogger API integration.

## Setup Instructions

The Repl reads FIREBASE credential from `SERVICE_ACCOUNT_JSON` secret.

### Required Secrets

Add the following secrets to Replit Secrets (Tools > Secrets or Ctrl+K and search for Secrets):

- `SERVICE_ACCOUNT_JSON` - Paste the entire Firebase service account JSON (one long value)
- `ADMIN_SECRET` - Secret token for admin API endpoints
- `BLOGGER_CLIENT_ID` - Google OAuth client ID for Blogger
- `BLOGGER_CLIENT_SECRET` - Google OAuth client secret
- `BLOGGER_REFRESH_TOKEN` - OAuth refresh token for Blogger access
- `BLOGGER_ADMIN_BLOG_ID` - Admin blog ID for syncing
- `BLOGGER_PUBLIC_BLOG_ID` - Public blog ID for publishing (optional)
- `FREE_DAILY_LIMIT` - Free unlocks per day (default: 2)
- `UNLOCK_TTL_SECONDS` - Token validity duration (default: 300)

### Testing

1. Restart the Repl and test `/health` and `/movies` endpoints:
   ```bash
   curl -i https://YOUR_REPL_URL/health
   curl -i https://YOUR_REPL_URL/movies
   ```

2. To populate movies, create a draft post in Blogger with JSON metadata in an HTML comment, then call:
   ```bash
   curl -X GET -H "x-admin-token: YOUR_ADMIN_SECRET" https://YOUR_REPL_URL/sync
   ```

## API Endpoints

- `GET /health` - Health check
- `GET /movies` - List published movies
- `GET /movie/:tmdb_id` - Get movie details
- `POST /unlock/:tmdb_id` - Request unlock token
- `POST /validate-unlock/:tmdb_id` - Validate token and get download links
- `GET /sync` - Sync movies from Blogger (admin only, requires x-admin-token header)
- `POST /admin/publish/:tmdb_id` - Publish a movie (admin only)

## Project Structure

```
/
├── server.js              # Main Express server
├── webapp/
│   └── index.html         # Frontend single-page app
├── package.json           # Node.js dependencies
└── replit.md              # This file
```

## Vercel Frontend (Optional)

If hosting frontend on Vercel separately, update webapp/index.html and replace the API_BASE line with:
```js
const API_BASE = 'https://your-repl-url';
```

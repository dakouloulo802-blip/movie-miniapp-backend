# Movie MiniApp

A Telegram MiniApp for movie downloads with Firebase/Firestore backend and Blogger API integration.

## Overview

This is a Node.js Express server that:
- Serves a static HTML frontend (webapp/index.html)
- Provides API endpoints for movie listing and unlocking
- Integrates with Firebase Firestore for data storage
- Uses Google Blogger API for content synchronization
- Implements quota-based unlock system with ad monetization support

## Project Structure

```
/
├── server.js              # Main Express server
├── webapp/
│   └── index.html         # Frontend single-page app
├── serviceAccountKey.json # Firebase service account credentials
├── oauth-get-refresh-token.js  # OAuth helper script
├── package.json           # Node.js dependencies
└── replit.md              # This file
```

## Environment Variables

Required secrets (set via Replit Secrets):
- `BLOGGER_CLIENT_ID` - Google OAuth client ID for Blogger
- `BLOGGER_CLIENT_SECRET` - Google OAuth client secret
- `BLOGGER_REFRESH_TOKEN` - OAuth refresh token
- `BLOGGER_ADMIN_BLOG_ID` - Admin blog ID for syncing
- `BLOGGER_PUBLIC_BLOG_ID` - Public blog ID for publishing
- `ADMIN_SECRET` - Secret token for admin API endpoints

Environment variables:
- `PORT` - Server port (default: 5000)
- `GOOGLE_APPLICATION_CREDENTIALS` - Path to Firebase service account JSON
- `FREE_DAILY_LIMIT` - Free unlocks per day (default: 2)
- `UNLOCK_TTL_SECONDS` - Token validity duration (default: 300)

## API Endpoints

- `GET /health` - Health check
- `GET /movies` - List published movies
- `GET /movie/:tmdb_id` - Get movie details
- `POST /unlock/:tmdb_id` - Request unlock token
- `POST /validate-unlock/:tmdb_id` - Validate token and get download links
- `GET /sync` - Sync movies from Blogger (admin only)
- `POST /admin/publish/:tmdb_id` - Publish a movie (admin only)

## Running the App

The server runs on port 5000 and serves both the API and static frontend.

```bash
npm start
```

## Firebase Setup

The app requires a valid Firebase service account key. If you see authentication errors, you'll need to:
1. Go to Firebase Console > Project Settings > Service Accounts
2. Generate a new private key
3. Replace the content in `serviceAccountKey.json`

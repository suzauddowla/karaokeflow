# KaraokeFlow Internet Deployment Guide

This guide explains how to host **KaraokeFlow** 24/7 on the internet so anyone worldwide can use the web app or Android APK even when your laptop is completely turned off.

---

## Architecture Note: Your Existing Website (`alsuza.com`)
Your domain `alsuza.com` currently runs an active **WordPress site on LiteSpeed Web Server** protected by **Cloudflare**.

To keep your WordPress website safe and untouched, the recommended setup is to use a **dedicated subdomain**:
> **`https://karaoke.alsuza.com`** (or `sing.alsuza.com`)

---

## Method 1: Free Cloud Host (Recommended — 5 Minutes)
Services like **Render** or **Railway** provide free cloud containers with zero maintenance and 24/7 uptime.

### Step 1: Push Code to GitHub
1. Create a repository on GitHub (e.g., `karaokeflow`).
2. Push the contents of `karaoke-app/` to GitHub.

### Step 2: Deploy on Render.com (100% Free)
1. Sign up at [Render.com](https://render.com).
2. Click **New +** → **Web Service**.
3. Connect your GitHub repository.
4. Render will automatically detect the included `Dockerfile`:
   - **Name**: `karaokeflow`
   - **Region**: Closest to your users (e.g., Singapore / Frankfurt / Oregon)
   - **Instance Type**: **Free**
5. Click **Create Web Service**. Within ~2 minutes, your app will be live at `https://karaokeflow-xxxx.onrender.com`!

### Step 3: Connect to `karaoke.alsuza.com` via Cloudflare
1. In your Render dashboard, go to **Settings** → **Custom Domains** → add `karaoke.alsuza.com`.
2. Open your **Cloudflare Dashboard** for `alsuza.com` → **DNS** → **Records**.
3. Add a new record:
   - **Type**: `CNAME`
   - **Name**: `karaoke`
   - **Target**: `[your-app-name].onrender.com`
   - **Proxy status**: Proxied (Orange cloud)
4. Click **Save**. Within seconds, `https://karaoke.alsuza.com` is live worldwide with free SSL!

---

## Method 2: Host on Existing cPanel / LiteSpeed (If Supported)
If your web hosting plan includes **"Setup Python App"** (CloudLinux / Phusion Passenger):
1. In cPanel, create a subdomain: `karaoke.alsuza.com`.
2. Go to **Setup Python App** in cPanel:
   - Python Version: `3.10` or `3.11`
   - App Directory: `karaoke`
   - App URI: `/`
3. Upload `backend/` and `frontend/` into that directory.
4. Run `pip install -r backend/requirements.txt` via cPanel terminal.
5. In your WSGI file, import `app` from `backend.server`.

---

## Step 4: Link Your Android APK to the Cloud Server
Once your server is live at `https://karaoke.alsuza.com`:
1. In the mobile app, tap **⚙️ Server** in the header.
2. Enter: `https://karaoke.alsuza.com` and tap **Save & Reconnect**.
3. Or update `frontend/js/app.js`:
   ```javascript
   let API_BASE = localStorage.getItem('karaokeflow_server_url') || 'https://karaoke.alsuza.com';
   ```
4. Rebuild the APK. Now, any phone in the world with your APK will stream and sing 24/7 without needing your laptop!

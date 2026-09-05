# Folio — Literary Character Chat & Director's Desk

An interactive literary chat and book studio application powered by the Gemini API, featuring dynamic character dialogue, canon fidelity, Tone Modulation, anti-repetition rules, and an advanced Director's Desk.

---

## 🚀 One-Click Deploy to Web

### Option 1: Render (Recommended — Free Tier)
1. Push this repository to GitHub (see below).
2. Go to [Render Dashboard](https://dashboard.render.com/) -> **New** -> **Blueprint**.
3. Connect your GitHub repository.
4. Render will automatically read `render.yaml`, build the application (`npm install && npm run build`), and launch it.
5. In the Render service settings, add your **`GEMINI_API_KEY`** environment variable.

### Option 2: Railway or Fly.io (Docker)
1. This repository includes a production multi-stage [Dockerfile](Dockerfile).
2. Connect your GitHub repository on [Railway](https://railway.app/) or run `fly launch`.
3. Set your `GEMINI_API_KEY` in the environment settings.

---

## 💻 Run Locally

**Prerequisites:** Node.js 18+

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure `.env.local`:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   PORT=3000
   ```
3. Start development server:
   ```bash
   npm run dev
   ```
4. Build for production:
   ```bash
   npm run build
   npm start
   ```

---

## 📦 Push to GitHub

```bash
git remote add origin https://github.com/<YOUR_USERNAME>/<YOUR_REPO_NAME>.git
git branch -M main
git push -u origin main
```


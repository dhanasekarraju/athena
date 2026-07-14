# ATHENA — AI Crypto Options Signal Intelligence

ATHENA is a mobile app that generates explainable **BUY CALL / BUY PUT / HOLD**
recommendations for BTC, ETH, and SOL, using technical analysis, weighted
confidence scoring, and news/sentiment signals.

> ⚠️ **ATHENA never executes trades automatically.** It only generates
> recommendations. All order execution is manual and happens on the
> exchange of the user's choice. This constraint is enforced in the UI
> (disclaimer banners on every signal screen) and there is intentionally
> no order-placement code anywhere in this repository.

---

## 1. Architecture

```
athena/
├── mobile/       Flutter app (Material 3, dark theme, Riverpod)
├── backend/      Node.js + Fastify + TypeScript API + WebSocket relay + Postgres (Prisma)
├── ai-engine/    Python FastAPI service: indicators, weighted signal scoring, sentiment
├── docker-compose.yml
├── .github/workflows/   CI: mobile APK build, backend tests, AI engine tests
└── docs/
```

Data flow: **Binance public REST API → AI engine (pandas/ta indicators →
weighted signal scoring) → Node backend (persists to Postgres, exposes
REST + WebSocket) → Flutter app (Riverpod providers → UI)**.

### What's production-complete vs. scaffolded

- **Complete and testable now:** AI engine indicators + signal scoring
  (`ai-engine/`, covered by `pytest` unit tests), backend REST API,
  auth (JWT + refresh tokens), trade journal/portfolio persistence
  (`backend/`), Flutter core (theming, routing, state management, API
  client with token refresh, Dashboard, Signal Details, Journal,
  Portfolio, Watchlist, News, Settings screens).
- **Scaffolded, ready to extend:** the Charts screen uses a simplified
  price-path line chart; wire it to a candlestick library (e.g.
  `k_chart` or `syncfusion_flutter_charts`) with historical OHLCV from
  `/api/market/prices` for full candlestick charts. News ingestion has
  the DB model, API route, and sentiment scorer, but no scheduled
  scraper/aggregator job is included — plug in a cron job or queue
  worker that fetches headlines and calls `ai-engine`'s
  `/sentiment/news` endpoint, then writes to the `NewsItem` table.
  Whale-alert integration is stubbed pending an API key.
- **Requires `flutter create .`:** this repo ships hand-written Dart
  source, `pubspec.yaml`, and the Android manifest/Gradle files that
  need customization, but not the full native scaffolding (iOS folder,
  Gradle wrapper jar, `MainActivity.kt`, default app icons/launch
  screens) that Flutter's tooling generates. Run `flutter create .`
  inside `mobile/` once, choosing to keep existing files when prompted,
  to fill those in — see step 4 below.

---

## 2. Prerequisites

- Docker & Docker Compose
- Flutter SDK 3.24+ (for building the APK)
- Node.js 20+ (only needed for local dev outside Docker)
- Python 3.11+ (only needed for local dev outside Docker)

---

## 3. Run the backend stack

```bash
cp .env.example .env
# edit .env: set POSTGRES_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET to strong values

docker compose up -d postgres redis ai-engine backend

# Run database migrations once the containers are healthy
docker compose exec backend npx prisma migrate deploy
```

Services:
- Backend API: `http://localhost:4000` (health check: `GET /health`)
- AI engine: `http://localhost:8000` (health check: `GET /health`)
- Postgres: `localhost:5432`
- Redis: `localhost:6379`

Verify:
```bash
curl http://localhost:4000/api/signals/latest?symbol=BTC&timeframe=15m
```

---

## 4. Set up the Flutter app

```bash
cd mobile
flutter create . --project-name athena --org app.athena --platforms android,ios
# When prompted about overwriting existing files, choose to KEEP the
# files already in this repo (pubspec.yaml, lib/, AndroidManifest.xml,
# app/build.gradle) — only accept the newly generated native scaffolding
# (Gradle wrapper, MainActivity, default assets, ios/).

flutter pub get
```

If you plan to use push notifications, add your Firebase config files:
- `mobile/android/app/google-services.json`
- `mobile/ios/Runner/GoogleService-Info.plist`

Run against your local backend (Android emulator uses `10.0.2.2` to reach
the host machine's `localhost`):

```bash
flutter run \
  --dart-define=API_BASE_URL=http://10.0.2.2:4000 \
  --dart-define=WS_BASE_URL=ws://10.0.2.2:4000
```

---

## 5. Build a release APK

### Option A — locally with the Flutter SDK

```bash
cd mobile
flutter build apk --release \
  --dart-define=API_BASE_URL=https://your-production-api.example.com \
  --dart-define=WS_BASE_URL=wss://your-production-api.example.com
```

The APK is generated at:
```
mobile/build/app/outputs/flutter-apk/app-release.apk
```

For a signed production build, create `mobile/android/key.properties`
(gitignored) pointing at your keystore, or export these environment
variables before building so `android/app/build.gradle` picks them up:
`ATHENA_KEYSTORE_PATH`, `ATHENA_KEYSTORE_PASSWORD`, `ATHENA_KEY_ALIAS`,
`ATHENA_KEY_PASSWORD`. Without these, Gradle falls back to debug signing
so the APK is still installable for testing.

### Option B — with Docker (no local Flutter SDK needed)

```bash
docker compose --profile build run --rm flutter-builder
```

### Option C — automatically via GitHub Actions (recommended)

The workflow at `.github/workflows/mobile-ci.yml`:
1. Triggers on every push to `main` that touches `mobile/**`, or manually
   via **Actions → Mobile - Build & Test → Run workflow**.
2. Runs `flutter analyze` and `flutter test`.
3. Builds a release APK (using repo secrets for signing if configured:
   `ATHENA_KEYSTORE_BASE64`, `ATHENA_KEYSTORE_PASSWORD`,
   `ATHENA_KEY_ALIAS`, `ATHENA_KEY_PASSWORD`; falls back to debug
   signing otherwise).
4. Uploads the APK as a workflow artifact named **`athena-release-apk`**.

**To download the APK:**
1. Go to the repository on GitHub → **Actions** tab.
2. Click the latest successful **"Mobile - Build & Test"** run.
3. Scroll to **Artifacts** and download **`athena-release-apk`**
   (a zip containing `app-release.apk`).

**To install on an Android device:**
1. Transfer `app-release.apk` to the device (USB, cloud drive, email, etc.).
2. On the device, enable **Settings → Security → Install unknown apps**
   for the app you used to open the file (Files, Chrome, etc.).
3. Tap the APK file and confirm **Install**.
4. Launch ATHENA and log in / register.

---

## 6. API endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/market/prices` | No | Live BTC/ETH/SOL prices |
| GET | `/api/signals/latest?symbol=&timeframe=` | No | Latest AI signal |
| GET | `/api/signals/history?symbol=&timeframe=&limit=` | No | Past signals |
| GET | `/api/news?limit=` | No | Aggregated news with sentiment |
| GET | `/api/fear-greed` | No | Fear & Greed Index |
| POST | `/api/auth/register` | No | Create account |
| POST | `/api/auth/login` | No | Get access + refresh tokens |
| POST | `/api/auth/refresh` | No | Rotate access token |
| POST | `/api/auth/logout` | Yes | Revoke refresh token |
| GET | `/api/portfolio` | Yes | Win rate, P&L, trade counts |
| POST | `/api/trades` | Yes | Log a manually-executed trade |
| POST | `/api/trades/close` | Yes | Close a logged trade with exit price |
| GET | `/api/trades/history` | Yes | Full trade history |
| WS | `/ws/live` | No | Live signal stream (relayed from AI engine) |

---

## 7. Running tests

```bash
# AI engine
cd ai-engine && pip install -r requirements.txt pytest && pytest -q

# Backend
cd backend && npm install && npm test

# Mobile
cd mobile && flutter test
```

---

## 8. Signal logic reference

Confidence is a weighted sum of seven factors (see
`ai-engine/strategies/signal_engine.py`):

| Factor | Weight |
|---|---|
| RSI | 20% |
| MACD | 20% |
| EMA trend | 20% |
| Volume | 15% |
| Bollinger Bands | 10% |
| Support/Resistance | 10% |
| News sentiment | 5% |

**BUY CALL** requires RSI < 35, MACD bullish crossover, EMA 9 > EMA 21,
price above VWAP, and volume above average. **BUY PUT** requires the
mirrored bearish conditions. Every signal returns a `reasons` array of
human-readable explanations (e.g. "RSI oversold (28.4)", "MACD bullish
crossover", "EMA 9 > EMA 21 (bullish stack)").

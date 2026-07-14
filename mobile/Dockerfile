FROM ghcr.io/cirruslabs/flutter:3.24.0

WORKDIR /app
COPY . .

RUN flutter pub get

# Build a release APK. Override --dart-define values at build time for
# production API endpoints, e.g.:
#   docker build --build-arg API_BASE_URL=https://api.athena.app -t athena-mobile .
ARG API_BASE_URL=http://10.0.2.2:4000
ARG WS_BASE_URL=ws://10.0.2.2:4000

RUN flutter build apk --release \
    --dart-define=API_BASE_URL=${API_BASE_URL} \
    --dart-define=WS_BASE_URL=${WS_BASE_URL}

# Resulting APK is at /app/build/app/outputs/flutter-apk/app-release.apk
CMD ["cp", "/app/build/app/outputs/flutter-apk/app-release.apk", "/app/"]

# AgentDeck for iOS

Native remote control for the agents on your machine. Pair by scanning the
QR code on your desktop's `/pairing` page, then watch conversations, send
prompts, answer approvals and questions, and start/stop tasks from anywhere.

- SwiftUI, iOS 17+, zero third-party dependencies
- Keychain-stored device token, Bearer-authenticated mobile API
- Authenticated WebSocket with replay cursor, backoff, and outbox
- QR pairing via camera (paste fallback on the simulator)

## Build

Open `AgentDeck.xcodeproj` in Xcode 15+ and run. Or from the command line:

```sh
xcodebuild test -project ios/AgentDeck.xcodeproj -scheme AgentDeck \
  -destination 'platform=iOS Simulator,name=iPhone 16'
```

## Ship an update

```sh
git tag ios-v1.0.1 && git push origin ios-v1.0.1
```

That tag runs the release workflow: signed IPA (with `APPLE_*` secrets
configured), GitHub Release, OTA install page on `gh-pages`, and optional
TestFlight upload. See [docs/IOS_APP.md](../docs/IOS_APP.md) for the full
pairing/signing/update guide.

## Regenerating the project

The `.xcodeproj` is generated. After adding or removing Swift files:

```sh
python3 tools/generate_project.py
```

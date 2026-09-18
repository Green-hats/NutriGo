# Contributing to NutriGo

[简体中文](CONTRIBUTING.zh-CN.md) · [Architecture](docs/ARCHITECTURE.md) · [Mobile development](docs/MOBILE.md)

NutriGo ships a Tauri 2 mobile app and Go / Python cloud services. Use Go 1.26.5+, Python 3.13 (CI version), Node.js 24 (22.12+ supported), and uv. Native builds also require Rust and the Android or Apple toolchain described in the mobile guide.

## Development setup

```bash
git clone https://github.com/Green-hats/NutriGo.git
cd NutriGo
cp agent/.env.example agent/.env
# Configure your chat provider; set FOOD_VISION_API_KEY for DeepSeek photo analysis.
(cd agent && uv sync --group dev)
(cd frontend && npm ci)
./start.sh
```

`start.sh` starts local services and a browser preview. Use `npm run android:dev` or `npm run ios:dev` from `frontend` for native development; stop an existing Vite process first. Production uses [deploy/cloud](deploy/cloud/README.md). Keep credentials, keystores, real user data, runtime databases and backups out of commits; only public API configuration belongs in `VITE_*` variables.

## Checks without running application services

Run the relevant checks from the repository root. These tests do not require live AI providers; dependency installation may need network access.

```bash
(cd backend && go test ./internal/... && go vet ./...)
(cd frontend && npm run lint && npm test && npm run build)
(cd agent && uv run ruff check app/ recognition/ tests/ ../.github/scripts/)
(cd agent && uv run mypy app/ recognition/ && uv run pytest)
(cd agent && uv run ruff check --config ../deploy/cloud/backup/ruff.toml ../deploy/cloud/backup/)
python3 -m unittest discover -s deploy/cloud/backup -p 'test_*.py'
python3 -m unittest discover -s .github/scripts -p 'test_*.py'
git diff --check
```

Use gofmt for Go edits, strict TypeScript with the frontend build, and ruff / mypy for Python. Add regression coverage for changed behavior and failure paths; documentation-only changes should validate links, examples and diagrams. If an API, lifecycle or deployment contract changes, update the corresponding documentation.

`make test` also runs live integration scripts; it is **not** the isolated unit-test command and does not include every CI check. Some frontend Make targets assume NVM is installed; the direct npm commands above do not. `make lint` runs Agent ruff / mypy and frontend oxlint, but Go vet, backup lint and release-script checks are separate.

## Integration and release checks

- Go HTTP integration: `backend/tests/test_api.py` requires a dedicated running Go service and a clean test database. CI builds and starts its own service and adjusts authentication rate limits for the test workload.
- Agent integration: scripts under `agent/tests/integration/` may require Go, model files and a live LLM. Some use fixed development identities and secrets; inspect their setup before use. Never target production user data. See the [manual acceptance checklist](docs/agent-test-prompts.md).
- Gateway: `python3 deploy/cloud/tests/verify_gateway.py` requires a local Caddy executable. CI also validates Compose configuration.
- Native app: `npm run build:app` requires a valid HTTPS API origin; CI's example origin is only for compilation. Rust, iOS target checks and Android APK builds run in CI; device permissions, keyboard and camera behavior still need real-device validation.

[CI](.github/workflows/ci.yml) has six jobs: Lint, Test, Build, Tauri native check, Android compact APK and Cloud gateway. [Android Release](.github/workflows/android-release.yml) reuses CI when manually triggered from main or by a matching `android-v<version>` tag, then signs and publishes a prerelease. A main push runs CI but does not automatically publish a Release or deploy cloud services. Signing and version rules are documented in [MOBILE.md](docs/MOBILE.md).

## Pull requests

1. Fork the repository and create a branch for a focused change.
2. Explain the user-visible problem and intended behavior; update relevant tests and docs.
3. Run applicable checks and report results and any unverified behavior.
4. Open a PR and wait for CI and maintainer review.

Use Conventional Commits, for example `fix: preserve photo deletion tasks after filesystem errors` or `docs: align data lifecycle and deployment guides`. Do not describe a configuration hook as an enabled production service. Current known gaps and priorities live in the [roadmap](docs/ROADMAP.md), with retention and recovery rules in [data management](docs/DATA_MANAGEMENT.md).

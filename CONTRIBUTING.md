# Contributing Guide

Thank you for your interest in NutriGo! Here's how to get started contributing.

## Table of Contents

- [Development Environment](#development-environment)
- [Code Style](#code-style)
- [Submission Flow](#submission-flow)
- [Commit Convention](#commit-convention)

## Development Environment

```bash
# 1. Clone and install dependencies
git clone <repo-url> && cd NutriGo
cp agent/.env.example agent/.env   # Fill in LLM_API_KEY

# 2. Start the dev environment
./start.sh                          # or make dev

# 3. Verify everything is ready
make env                            # check .env
```

Requirements: Go 1.26+, Python 3.13+, Node.js 22+, uv 0.11+

## Code Style

| Language | Tools | Command |
|----------|-------|---------|
| Python | ruff + mypy + pytest | `cd agent && uv run ruff check app/ recognition/ tests/ && uv run mypy app/ recognition/ && uv run pytest` |
| Go | gofmt + go vet | `cd backend && gofmt -l . && go vet ./...` |
| TypeScript | oxlint + tsc strict | `cd frontend && npx oxlint src && npx tsc -b` |

**Must pass before submitting**: `make lint && make test` (Go / Agent pytest / vitest unit tests run without starting any services)

## Submission Flow

1. **Fork** this repository and create a feature branch: `git checkout -b feat/your-feature`
2. Write code and **add/update tests**
3. Verify locally: `make lint && make test`
4. Commit and push, then open a Pull Request
5. Wait for CI to pass + maintainer review

## Commit Convention

Follow [Conventional Commits](https://www.conventionalcommits.org):

```
feat: new feature
fix: bug fix
docs: documentation changes
refactor: refactoring (neither a fix nor a feature)
test: adding tests
chore: build/tooling/dependency changes
style: formatting changes
```

Example: `feat: add intake goal achievement analysis tool`

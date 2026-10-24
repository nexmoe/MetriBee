# Contributing

Thanks for wanting to help. This project is kept small and focused, so changes follow one simple flow.

## The rule: issue first, then one PR

1. **Open an issue first.** Describe the bug or the feature before you write code. Use the bug or feature template.
2. **Wait for approval.** A maintainer adds the `approved` label when the change fits the project. Do not start work before that.
3. **One PR per issue.** Each pull request does one thing: one feature, one fix, or one edit. No bulk PRs that mix several changes, refactors, or formatting sweeps.
4. **Link the issue.** Put `Closes #<number>` in the PR description.

Pull requests without an approved issue, or that bundle unrelated changes, are closed without review. Small typo fixes in docs are the only exception.

## Before you open the PR

- `pnpm install`, then `pnpm test` passes.
- Check the change in the app. `pnpm demo` runs it with generated data, no Google account needed.
- UI changes follow [DESIGN.md](DESIGN.md) (colors, type, radii, spacing tokens). Add before and after screenshots taken in demo mode.
- Maps use India's officially approved boundary (Natural Earth 10m India POV). Never default Natural Earth, world-atlas or globe.gl country data.
- No credentials in code or commits. Keys live only in `.env`.
- Keep the diff small. No new dependency when a few lines of code do the job.

## Security issues

Do not open a public issue for a security problem. Use GitHub's private vulnerability reporting on this repository instead.

## Code of conduct

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

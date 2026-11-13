# Contributing

Thanks for helping improve Paper Shooter.

## Requirements

- Node.js 22 or newer and npm for the repository checks.
- Python 3 for the lightweight local web server.
- Docker Compose only when working on the container deployment or TURN service.

## Local setup

    git clone https://github.com/meyer-pidiache/papershooter.git
    cd papershooter
    git config core.hooksPath .githooks
    npm run check
    python3 serve.py 8910

Open http://127.0.0.1:8910. Online play uses the public PeerJS signalling service. The Docker
deployment can also request temporary Cloudflare TURN credentials when a network blocks direct
WebRTC connections. See the README for its environment variables.

Never commit .env files, API tokens, TURN credentials, or local deployment data. The repository
ignores .env files except for the safe .env.example template.

## Trunk-based workflow

The main branch is the trunk and should stay ready to deploy. Make a short-lived branch for one
focused change, open a pull request early, and keep branches small enough to review and merge within
a day or two.

Start from the current trunk:

    git switch main
    git pull --ff-only origin main
    git switch -c feat/short-description

Before opening or updating a pull request, rebase the branch on the latest trunk:

    git fetch origin
    git rebase origin/main

Resolve conflicts on the feature branch and rerun npm run check. If the branch was already pushed,
update that branch with:

    git push --force-with-lease

Open a pull request against main. Keep the commit history linear and use GitHub's
“Rebase and merge” option. Do not force-push main or merge unrelated work directly into it.

To compare with the source project, add its repository as a read-only reference and inspect changes
before porting them:

    git remote add upstream https://github.com/iifor/doodleshooter.git
    git fetch upstream
    git log --oneline main..upstream/main

Upstream commits can contain source changes and translations with separate authorship. Port only
the needed changes, preserve attribution, and review the diff before rebasing or merging.

## Git hooks and checks

Enable the checked-in hooks once per clone:

    git config core.hooksPath .githooks

The hooks enforce Conventional Commit messages and run npm run check before commits and pushes.
The CI workflow checks JavaScript module syntax and Docker Compose configuration on pull requests
and pushes to main. The project does not yet have an automated gameplay test suite, so visual
changes also need browser review.

## Commits

Use Conventional Commits and keep each commit focused:

    feat(map): add a destructible plaza
    fix(net): recover from a signalling interruption
    docs: explain local Docker setup

Use feat, fix, docs, chore, ci, refactor, style, test, build, perf, revert, or a scoped variant.
Write the summary in the imperative mood and explain the reason in the body when it is not obvious.

## Pull requests

Describe what changed, why it changed, and how to review it. Include screenshots or a recording for
visual work. Update the README when controls, deployment, game modes, or environment variables
change. The pull request template provides a checklist.

## License and attribution

This fork is based on iifor/doodleshooter. Review NOTICE.md and LICENSE.md before reusing or
redistributing code; the license file is scoped to original contributions in this fork and does
not grant rights to inherited upstream code or vendored dependencies.

# Security policy

## Supported versions

Security fixes go into the next App Store release, built from `main`. Older versions don't get separate patches; update to the latest version.

| Version | Supported |
|---|---|
| Latest App Store release | Yes |
| `main` | Yes |
| Anything older | No |

## Reporting a vulnerability

Please report security problems privately, not in a public issue or pull request.

- Preferred: use **Report a vulnerability** on the repository's [Security tab](https://github.com/thisiskurubaran/tide/security/advisories/new).
- Or email thisiskurubaran@gmail.com with "Security" in the subject.

Include what's affected (the app, the Remote mode server or both), the version, steps to reproduce and the impact you see. A proof of concept helps but isn't required.

You'll get a reply within 7 days. Once a fix is ready, it ships in an App Store update, and with your agreement you're credited in the release notes and the advisory.

## Scope

In scope:

- The Tide app for iOS, iPadOS and Android: for example, code running outside its project, files written outside the project, AI keys or git and hosting tokens leaving the Keychain or reaching the wrong host, and the `tide://` links
- The Remote mode server in [`server/`](server/): authentication, container isolation and the sync protocol
- The bundled git, SSH and database clients, where Tide's own code is at fault

Out of scope:

- Code you choose to run in Tide doing what it was written to do: Tide runs your programs with access to their project
- Problems in a third-party dependency with no Tide-specific impact; report those upstream
- A Remote mode server run with a short or leaked `TIDE_TOKEN`, or reachable from the internet over plain HTTP instead of HTTPS (see the [README](README.md#remote-server))
- Attacks that need an already unlocked, compromised or jailbroken device

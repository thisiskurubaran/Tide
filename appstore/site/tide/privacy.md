---
title: Tide Privacy Policy
permalink: /tide/privacy/
---

# Tide Privacy Policy

Effective: 29 October 2026

Tide is a code editor with a terminal for iPhone and iPad, made by
Kurubaran Anandhan ("I", "me"). This policy explains what happens to your
information when you use Tide. If you have questions, email
[thisiskurubaran@gmail.com](mailto:thisiskurubaran@gmail.com).

## Summary

- Tide has no accounts, no ads, no analytics and no tracking. I don't sell
  or share your data.
- Your projects, settings and credentials stay on your device.
- Tide only sends data off your device when you use a feature that needs
  it, and only to the place that feature talks to (for example your Git
  host or a package registry).
- The only data that can reach me is a crash report, if you turn crash
  reports on, and an email, if you choose to write to me.

## Data stored on your device

Tide keeps the following on your device, in its own storage:

- **Projects and files** you create, import, clone or open, and
  **snapshots** (automatic copies of a project you can restore).
- **Settings**: theme, editor options, key bar layout, recent projects and
  similar preferences.
- **Credentials**: your Git name, email and access token, and the Remote
  server address and token, are kept in the iOS Keychain.
- **Purchase status**: which Tide Pro plan or extensions your Apple Account
  owns, so they keep working offline.

Tide's storage is included in your device backups (iCloud Backup or a
computer) like any app's data. Deleting Tide deletes it from the device.
I never receive any of it.

## Data sent off your device, and where

These features connect to other services only when you use them. Those
services see the request and your IP address, as any website would, and
handle it under their own privacy policies.

| Feature | What is sent | To |
|---|---|---|
| Git (clone, pull, push) | Your repository's contents and history, your Git name and email (in commits), and your access token | The Git host you use, e.g. GitHub |
| npm and pip installs | Names and versions of the packages you install | The npm registry (registry.npmjs.org) and PyPI (pypi.org) |
| Packages screen | Your search terms, and the names of installed packages to check for updates | The npm registry and PyPI |
| Remote mode | Your project's files, your terminal input, and the server token | The Tide server whose address you enter. That server is run by you or your organisation, not by me. |
| Linked folders | Files copied to and from the folder | The folder you choose, e.g. in iCloud Drive or another app |
| Previews | Whatever the page you preview requests | The page's own server and anything it loads |
| Sharing and "Open in Tide" | The files you choose | The app or service you pick in the share sheet, or from the app that sent them |
{: .sent }

Code you run in Tide's terminal or previews can make its own network
requests; that is up to the code you run.

## Purchases

Tide Pro and extensions are sold through the App Store. Payments are
handled entirely by Apple. I don't receive your name, Apple Account or
payment details; the App Store only tells Tide which products your account
owns. Subscriptions are managed and cancelled in your Apple Account
settings. If Tide asks you to rate it, the rating prompt is shown by
Apple, and I only see ratings and reviews as published on the App Store.

## Crash reports (optional, off by default)

If you turn on **Settings > Privacy > Send crash reports**, Tide sends a
report when it crashes to Sentry (Functional Software, Inc.), which
processes it for me. A report contains:

- what went wrong and where in Tide's code (the error and stack trace)
- the app version, device model and iOS version
- a random identifier the Sentry SDK creates for this installation, not
  linked to you or your Apple Account

Before a report leaves the device, Tide removes breadcrumbs, request data,
user data, screenshots and the view hierarchy, and replaces any file path
inside your projects with a placeholder, so reports don't contain your
code, file contents, project names or terminal output. You can turn crash
reports off at any time. Reports are kept by Sentry for a limited period
and used only to find and fix bugs.

## Contacting me

**Settings > Help & feedback** can open an email to me. A problem report
includes the app version, iOS version, device name or model, terminal
mode, and a text file of the app's recent warnings and errors from that
session. Those messages can include parts of file paths (shortened to
`~`) and error messages, which may quote code. You see the whole email
and attachment before sending, and nothing is sent unless you send it. I
use emails only to reply and to fix problems, and delete them when they
are no longer needed.

## Children

Tide is not directed at children under 13 and does not knowingly collect
personal information from them.

## Your choices and rights

Because Tide keeps your data on your device, you can view, change or
delete it in the app, or by deleting the app. Crash reports are optional.
If you want a crash report or email you sent deleted, or have any request
about your data under the laws where you live (such as the GDPR or the
CCPA), email me and I will help.

Crash reports and emails may be processed in countries other than yours,
by Sentry and by my email provider.

## Changes to this policy

If Tide starts handling data differently, I will update this page and the
effective date above before the change ships.

## Contact

Kurubaran Anandhan
[thisiskurubaran@gmail.com](mailto:thisiskurubaran@gmail.com)

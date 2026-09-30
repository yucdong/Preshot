# First-launch working directory acceptance

Date: 2026-09-30

[Documentation index](../README.md) | [Settings](../features/settings.md)

## Result

First launch now asks only for the project working directory. The application
and library path readouts remain in regular settings. Existing default data or
an older locator produces a keep/switch choice. Switching requires confirmation
showing the two paths and explaining that previous materials, settings and
registered projects will not carry over; original files remain intact.

Confirmed locators bypass setup on subsequent launches. Missing drives and
invalid library metadata still use recovery instead of creating replacement data.
No project or material schema changes were made. The locator gains an optional
confirmation flag with compatibility for older locators.

## Regression and validation

Before implementation, three UI regressions failed: extra path readouts, missing
keep-existing action, and missing switch confirmation. Two native regressions
failed: missing legacy-data detection and older locators bypassing review.

| Validation | Result |
| --- | --- |
| Storage provider and application Vitest suites | 19 passed |
| Native `storage::` tests using temporary directories | 24 passed |
| Edge storage integration scenarios | 5 distinct cases passed |
| TypeScript check, focused ESLint and i18n catalog checks | Passed |
| Documentation validation | Passed |

Coverage includes fresh/default/custom roots, adopting existing data, preserving
source database bytes and settings, explicit native confirmation, invalid or
nested destinations, missing drives, pending move recovery, repeat submissions,
cancelled folder picking, failed setup with retained input, lost response after
commit, Escape, focus restoration, and confirmation keyboard focus containment.

The browser scenarios cover the simplified page, keep and switch flows, confirmed
startup bypass, regular settings in both languages, unavailable-drive recovery,
and English confirmation at 640 x 540. The initial English scenario exposed a
fixture-language reset; the fixture was corrected and that scenario passed again.

## Visual evidence

- [Fresh setup](media/first-launch-setup/first-launch.png)
- [Existing working directory](media/first-launch-setup/existing-working-directory.png)
- [Chinese switch confirmation](media/first-launch-setup/confirm-switch-zh.png)
- [English switch confirmation](media/first-launch-setup/confirm-switch-en.png)

Screenshots show only one directory input on fresh setup and readable paths,
warnings and actions on confirmation. The Chinese confirmation was checked at
720 x 620 and the English confirmation at 640 x 540.

Raw browser output is under `.preshot-build-cache/first-launch-setup-20260930`
and `.preshot-build-cache/first-launch-setup-en-20260930`. Every Playwright run
used an explicit output directory, preserving the user-maintained bug reports.

## Scope

These checks used isolated browser repositories and native temporary roots.
The developer's actual profile and library were not changed. No MSI rebuild,
installation, uninstallation or packaged WebView2 acceptance was performed for
this change. Installer behavior is unchanged.

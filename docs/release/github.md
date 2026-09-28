# GitHub release

[Documentation index](../README.md)

One release connects a Git tag, its source commit, and an MSI built from that
commit. Do not attach a binary from uncommitted changes to an unrelated tag.

1. Finish docs, demo media, and code; run the release matrix.
2. Increment with `pnpm release:set-version -- <x.y.z>` and review all version
   files, including the workspace entry in Cargo.lock.
3. Commit the intended files, excluding caches, local profiles, build tools,
   raw recordings, and secrets.
4. Configure Authenticode as described in the [installer guide](windows-installer.md).
   Public release mode requires valid signatures on both EXE and MSI. Local
   unsigned builds are labeled non-publishable.
5. Run `pnpm production:build -- -Publish` and
   `pnpm production:verify -- -Publish`. Complete disposable-VM acceptance.
6. Push the commit and annotated `v<x.y.z>` tag to `yucdong/Preshot` using an
   account with repository write access.
7. Create a draft with `gh release create --verify-tag`, upload the assets,
   check links, and publish.

Release assets are the versioned MSI, `.msi.sha256`,
`Preshot-<version>-release.json`, and demonstration MP4. Notes describe Windows
x64 requirements, installation, signing, changes, actual verification, known
limitations, source tag, and photo credits. GitHub's tag archives provide
corresponding source; retain license files and dependency notices.

The README links to <https://github.com/yucdong/Preshot/releases>. Do not claim
an installer has been uploaded until the release actually contains it.

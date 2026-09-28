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

## Using the GitHub website

After pushing the intended source commit and its version tag:

1. Open <https://github.com/yucdong/Preshot/releases/new>.
2. In **Choose a tag**, select the existing tag for the built version, such as
   `v0.0.3`. An existing tag determines the source commit; choosing `main` does
   not move that tag. Do not use the older `v0.0.2` tag for the new artwork.
3. Enter a title such as **Preshot 0.0.3** and release notes covering changes,
   installation requirements, signing, and actual validation.
4. Attach `Preshot_0.0.3_x64_en-US.msi`, its `.msi.sha256` file, and
   `Preshot-0.0.3-release.json` from
   `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi`.
   The walkthrough MP4 is optional; source ZIP/TAR archives are supplied by GitHub.
5. Use **Save draft** while signing or release acceptance is incomplete. After
   signing, regenerate the package and metadata using the production tooling
   and replace all affected draft assets together.
6. Once the release requirements above are satisfied, click **Publish release**.
   Open the public release and verify that the MSI downloads from **Assets**.

Pushing source and tags does not upload the MSI or create a Release. GitHub does
not sign uploaded packages, and marking a Release as a prerelease does not
provide an Authenticode signature.

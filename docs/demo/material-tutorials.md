# Material library tutorials

[Documentation index](../README.md) · [Main walkthrough](README.md) · [Library guide](../features/material-library.md)

Short, separate tutorials recorded from MSI-installed Preshot 0.0.20, with
0.0.21 used to verify and re-record the native insertion fix. Each video
uses Chinese and English captions and the Nanjing bridge portrait example.
Model A is fictional; the model and prop pictures are original illustrations.
See [image credits](photos/credits.json) for the bridge photographs.

## Create each kind of material

| Tutorial | Video |
| --- | --- |
| Single image: name, description, tags and a picture | [C01](../media/material-tutorials/C01.mp4) |
| Image group: import multiple pictures | [C02](../media/material-tutorials/C02.mp4) |
| Location: shooting notes and a reference picture | [C03](../media/material-tutorials/C03.mp4) |
| Model: profile fields and a sample picture | [C04](../media/material-tutorials/C04.mp4) |
| Props and wardrobe: umbrella notes and picture | [C05](../media/material-tutorials/C05.mp4) |
| Create from the launcher without an open project | [C15](../media/material-tutorials/C15.mp4) |
| Build a new group with pictures from existing materials | [C14](../media/material-tutorials/C14.mp4) |

## Save document content as materials

| Tutorial | Video |
| --- | --- |
| Save a location card through its menu | [C06](../media/material-tutorials/C06.mp4) |
| Save a model card through its menu | [C07](../media/material-tutorials/C07.mp4) |
| Save a prop card through its menu | [C08](../media/material-tutorials/C08.mp4) |
| Save an entire gallery through its toolbar | [C09](../media/material-tutorials/C09.mp4) |
| Save a selected gallery picture | [C10](../media/material-tutorials/C10.mp4) |
| Save a selected independent Image block | [C11](../media/material-tutorials/C11.mp4) |
| Upload a local file into an Image block | [C12](../media/material-tutorials/C12.mp4) |
| Use a picture tile's save shortcut | [C16](../media/material-tutorials/C16.mp4) |
| Duplicate-name confirmation and discarding a new draft | [C17](../media/material-tutorials/C17.mp4) |

## Insert into a project

| Tutorial | Video |
| --- | --- |
| Place the cursor, insert from the header library and customize a project copy | [I01](../media/material-tutorials/I01.mp4) |
| Insert through the slash menu and paragraph-side plus button | [I02](../media/material-tutorials/I02.mp4) |
| Insert whole or selected galleries as groups or independent images | [I03](../media/material-tutorials/I03.mp4) |
| Append selected gallery pictures and single images to an existing group | [I04](../media/material-tutorials/I04.mp4) |

## Find and manage materials

| Tutorial | Video |
| --- | --- |
| Search names, descriptions and tags; filter and sort | [M01](../media/material-tutorials/M01.mp4) |
| Favorite and unfavorite materials | [M02](../media/material-tutorials/M02.mp4) |
| Edit, save repeatedly, continue editing and discard unsaved changes | [M03](../media/material-tutorials/M03.mp4) |
| Open and close the on-demand full preview | [M04](../media/material-tutorials/M04.mp4) |
| Open original files from details, preview and editing | [M05](../media/material-tutorials/M05.mp4) |
| Delete, cancel deletion and restore from the recycle bin | [M06](../media/material-tutorials/M06.mp4) |
| Permanently delete a recycled snapshot while retaining the project copy | [M07](../media/material-tutorials/M07.mp4) |
| Resize, undo/redo, switch image fit and crop | [M08](../media/material-tutorials/M08.mp4) |
| Reorder pictures, delete and restore with undo/redo | [M09](../media/material-tutorials/M09.mp4) |

## Clipboard workflow in an isolated test UI

[C18: copy, create an image material by pasting, and paste from preview into a document](../media/material-tutorials/C18.mp4).
This clip uses the production React UI with the existing browser test fixture's
in-memory clipboard and persistence boundary. It uses a real bridge photograph,
but does **not** demonstrate Windows clipboard integration or an MSI session.
No browser clipboard permission is granted and the system clipboard is untouched.

The native screen-capture tutorial is pending: the current remote desktop returns
`CopyFromScreen: The handle is invalid`. The Windows desktop must be restored and
kept visible for that recording. Automated capture cancellation/retry/review tests
use an injected boundary and are recorded separately in the acceptance report.

## Recording and acceptance

The recordings use an isolated working directory. Real user projects, library
and clipboard are untouched. Windows UI Automation drives visible controls and
native file pickers; `PrintWindow` records the installed app and its owned
originals folder. No application IPC or database writes are used to enact the
recorded material operations. Each take keeps raw frames, timestamps, errors and
post-action checks outside Git. Failed takes are excluded from published media.

The original [main MP4](../media/preshot-demo.mp4) and
[GIF](../media/preshot-demo.gif) remain the concise document-authoring and PDF
export walkthrough. These focused videos complement it.

See the [acceptance report](../test_reports/material-tutorials-acceptance.md) for
the installed-app evidence, browser regression coverage and platform limitations.

To reproduce a specific take after preparing its prerequisites in an isolated
profile:

```powershell
powershell -NoProfile -File scripts/record-material-tutorial.ps1 -Case C01
python scripts/render-material-tutorials.py --ffmpeg <ffmpeg.exe> --cases C01
```

The default work directory is `.preshot-build-cache/material-tutorials-0.0.20`.
Archive a previous take before retrying it. The renderer rejects errors and empty
timelines, speeds file selection, and creates an MP4 and poster for each case.

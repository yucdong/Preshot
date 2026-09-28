# Export

[Documentation index](../README.md)

Open **Export** in the toolbar. The menu order is **PDF**, **DOCX**, then
**Long image**. Assets must be available and decoded; missing images are
reported rather than silently omitted.

| Format | Use |
| --- | --- |
| PDF | Paginated A4 shooting plans for viewing and printing |
| DOCX | Editable Word documents for collaboration |
| Long image | A continuous image for chat and sharing |

Desktop export asks where to save. Successful saves reveal the project
directory. Fixed field labels follow the interface language; original
document text, crop/fit settings, frame sizes, and image order are preserved.

Long images default to 900px width, with 890px compatibility available.
WeChat JPEG targets 6,000px / 1 MiB, high-quality JPEG 8,000px / 3 MiB,
and lossless PNG 4,000px / 8 MiB per part. These are practical compatibility
targets, not official platform limits.

**Automatic splitting** starts unchecked. Enable it to split at block or
image-row boundaries. Single images can reach 20,000px high within the
18-million-pixel / 72-million-byte decoded-memory budget. If a plan exceeds
the limits, enable splitting, shorten it, or use PDF/DOCX. Up to 32 parts
are allowed. The three formats use independent rendering pipelines.

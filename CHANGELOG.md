# Changelog

## 0.0.5

- Fix installed material previews by permitting local blob images in the image CSP.
- Rebuild outdated 0.0.3 thumbnails without changing original images or material
  content; serialize captures and reject rendered images that failed to load.
- Embed validated image data directly in thumbnail captures so the production
  fetch policy cannot drop image pixels. Version 0.0.4 was an internal test build.
- Close newly created materials after a confirmed save and draft cleanup;
  preserve retry/recovery and continued editing of existing materials.
- Add sample images to the walkthrough's model, location, and prop materials.
- Record PDF export followed by opening, paging, and zooming the actual PDF;
  refresh the README video/GIF and include the exported PDF example.
- Keep PDF card descriptions within their text column and keep short cards
  together at page boundaries, while allowing taller cards to paginate.

## 0.0.3

- Use the supplied photographer artwork for the application logo, browser
  favicon, bilingual READMEs, Windows executable, and installer shortcuts.
- Preserve the original artwork and generate native icons from one transparent
  PNG so all branding stays consistent.
- Document creating a Release through the GitHub website.

## 0.0.2

- Chinese and English interface switching, light/dark themes, and focus mode.
- Cached open-project sessions, parallel image loading, and save-on-close prompts.
- Language initialization and changes no longer repeat project startup.
- Single-dialog project creation with an explicit parent directory.
- Screenshot controls beside upload/embed, with cancellation and retry.
- Image materials and flexible image-group selection/insertion.
- Combined props/wardrobe category and library insertion into existing groups.
- On-demand full material previews and improved English category layout.
- PDF, editable DOCX, and long-image export up to the bounded 20,000px height.
- Charcoal photographer logo throughout the application and Windows EXE/MSI.
- Concise bilingual READMEs, feature-indexed documentation, and a bridge
  portrait walkthrough with attributed photographs.

## 0.0.1

Initial desktop planning workspace, local projects, BlockNote editor,
reference galleries, material library, and document export.

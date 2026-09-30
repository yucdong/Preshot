r"""Read-only persistence audit of an isolated, closed native demo profile.

Example (paths are relative to the repository, not the current directory):
  python scripts/verify-demo-profile.py --work .preshot-build-cache/review-demo \
    --output .preshot-build-cache/review-demo/integrity.json
  Add --source-project "Original" --copy-project "Original - Copy"
    --copy-only-text "Unique copy paragraph" to audit the W01 copy story.

The profile must be <work>/profile/.preshot. SQLite is opened immutable/read-only;
nonempty WAL/journal files are refused rather than checkpointed or ignored.
Close the isolated app before running. No application/user data is repaired,
created, deleted or migrated. Only the explicitly named JSON report is written.
No third-party Python packages are required (Python 3.10+).
"""

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import sqlite3
import stat
import sys


ROOT = Path(__file__).absolute().parents[1]
CACHE = ROOT / ".preshot-build-cache"
HASH = re.compile(r"[0-9a-f]{64}\Z")
UUID = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\Z")
LOCAL_ID = re.compile(r"[0-9A-Za-z_-]{1,128}\Z")
EXTENSIONS = {"image/jpeg": "jpg", "image/png": "png"}


class AuditError(Exception):
    """A safe, context-specific failure that contains no absolute paths."""


def require(condition, message):
    if not condition:
        raise AuditError(message)


def inside(path, parent):
    return path == parent or parent in path.parents


def relative(path):
    return path.relative_to(ROOT).as_posix()


def guarded(path, must_exist=True):
    """Reject lexical escapes and every symlink/junction/reparse component."""
    require(path.is_absolute() and inside(path, ROOT), "Path must stay in this repository")
    require(not any(p in (".", "..") or ":" in p for p in path.relative_to(ROOT).parts),
            "Traversal or alternate-stream path rejected")
    cursor = ROOT
    for part in (None, *path.relative_to(ROOT).parts):
        if part is not None:
            cursor /= part
        try:
            info = cursor.lstat()
        except FileNotFoundError:
            require(not must_exist, "Required path is missing: " + relative(cursor))
            continue
        require(not stat.S_ISLNK(info.st_mode)
                and not getattr(info, "st_file_attributes", 0) & 0x400,
                "Linked/reparse path rejected: " + relative(cursor))
    return path


def repository_path(value):
    path = Path(value)
    return path if path.is_absolute() else ROOT / path


def local_file(root, value, cover=False):
    require(isinstance(value, str) and bool(value), "Missing local asset path")
    parts = value.split("/")
    require(not any(p in ("", ".", "..") or p.startswith(".preshot")
                    or any(c in p for c in '\\:<>"|?*')
                    or any(ord(c) < 32 for c in p) for p in parts),
            "Unsafe local asset path")
    require((len(parts) == 2 and parts[0] in ("media", "references"))
            or cover and len(parts) == 1, "Local asset outside media/references")
    return guarded(root.joinpath(*parts))


def walk(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)


def axes(value):
    counts = Counter({"raw": 0, "exif": 0})
    for node in walk(value):
        if "presentationAxes" in node:
            axis = node["presentationAxes"]
            require(axis in ("raw", "exif"), "Invalid persisted presentationAxes")
            counts[axis] += 1
    return dict(counts)


def signature(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns)


class Audit:
    def __init__(self):
        self.errors = []
        self.files = {}
        self.signatures = {}

    def error(self, context, problem):
        # Native exception strings can contain user paths. Keep only our safe
        # messages and exception types, never str(OSError/SQLiteError).
        message = str(problem) if isinstance(problem, AuditError) else type(problem).__name__
        self.errors.append({"context": context, "message": message})

    def file(self, path):
        guarded(path)
        info = path.stat()
        require(stat.S_ISREG(info.st_mode), "Expected a regular file: " + relative(path))
        if path in self.files:
            require(signature(info) == self.signatures[path], "File changed during audit")
            return self.files[path]
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            require(signature(os.fstat(stream.fileno())) == signature(info), "File changed before read")
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
            require(signature(os.fstat(stream.fileno())) == signature(info), "File changed during read")
        require(signature(path.stat()) == signature(info), "File changed after read")
        result = {"path": relative(path), "bytes": info.st_size, "sha256": digest.hexdigest()}
        self.files[path] = result
        self.signatures[path] = signature(info)
        return result

    def verify(self, path, blob, length):
        require(isinstance(blob, str) and HASH.fullmatch(blob), "Invalid recorded SHA-256")
        require(isinstance(length, int) and length > 0, "Invalid recorded original length")
        value = self.file(path)
        require(value["bytes"] == length, "Original byte length differs from its record")
        require(value["sha256"] == blob, "Original SHA-256 differs from its record")
        return value

    def stable(self):
        for path, before in self.signatures.items():
            try:
                guarded(path)
                require(signature(path.stat()) == before, "File changed during audit; close the app and rerun")
            except (AuditError, OSError) as error:
                self.error(relative(path), error)


def require_quiescent(db):
    for suffix in ("-wal", "-journal"):
        sidecar = guarded(db.with_name(db.name + suffix), must_exist=False)
        require(not sidecar.exists() or sidecar.stat().st_size == 0,
                "Nonempty SQLite " + suffix + "; close the isolated app and rerun (no checkpoint performed)")


def audit_library(audit, profile):
    library = profile / "library"
    db_path = guarded(library / "library.db")
    require_quiescent(db_path)
    database = audit.file(db_path)
    result = {"database": database, "openMode": "mode=ro&immutable=1", "originals": [], "materials": []}
    # immutable=1 prevents SQLite creating/writing sidecars. It is safe here
    # only because a nonempty WAL/hot rollback journal is explicitly refused.
    with sqlite3.connect(db_path.as_uri() + "?mode=ro&immutable=1", uri=True) as db:
        db.row_factory = sqlite3.Row
        result["databaseVersion"] = db.execute("PRAGMA user_version").fetchone()[0]
        require(result["databaseVersion"] == 10, "Expected material database v10; audit does not migrate")
        integrity = [row[0] for row in db.execute("PRAGMA integrity_check")]
        result["integrity"] = integrity
        require(integrity == ["ok"], "SQLite integrity check failed")
        result["foreignKeyViolations"] = [list(row) for row in db.execute("PRAGMA foreign_key_check")]
        require(not result["foreignKeyViolations"], "SQLite foreign-key check failed")
        locations = {r["storage_id"]: dict(r) for r in db.execute("SELECT * FROM group_instance_locations")}
        legacy = {(r["material_id"], r["local_image_id"], r["blob_hash"]): dict(r)
                  for r in db.execute("SELECT * FROM group_legacy_files")}
        instances = {r["storage_id"]: dict(r) for r in db.execute("SELECT * FROM image_instances")}
        blobs = {r["hash"]: dict(r) for r in db.execute("SELECT * FROM blobs")}
        owners = {(r[0], r[1]) for r in db.execute("SELECT material_id,storage_id FROM material_instance_owners")}
        result["purgeReceipts"] = db.execute("SELECT count(*) FROM purge_receipts").fetchone()[0]
        result["locationRows"] = len(locations)
        result["pendingLocationRows"] = sum(r["relocating"] != 0 for r in locations.values())
        seen_storage = set()
        seen_physical = {}
        kind_counts = Counter()
        for row in db.execute("SELECT id,kind,detail_json FROM materials ORDER BY id"):
            context = "material:" + row["id"]
            try:
                material = json.loads(row["detail_json"])
                mid, kind = material["id"], material["kind"]
                require(UUID.fullmatch(mid) and mid == row["id"] and kind == row["kind"], "Material identity differs")
                images = material["images"]
                require(material["imageCount"] == len(images), "Material image count differs")
                payload = material["payload"]
                presentation = axes(payload)
                require(not presentation["exif"] or payload["version"] == 2, "EXIF material requires payload v2")
                payload_ids = [n["localImageId"] for n in walk(payload) if "localImageId" in n]
                require(Counter(payload_ids) == Counter(i["localImageId"] for i in images),
                        "Payload and original-image identities differ")
                mappings = [dict(r) for r in db.execute(
                    "SELECT * FROM material_images WHERE material_id=? ORDER BY position", (mid,))]
                require(len(mappings) == len(images), "Material image mapping count differs")
                kind_counts[kind] += 1
                result["materials"].append({"id": mid, "kind": kind, "revision": material["revision"],
                    "metadataVersion": material["metadataVersion"], "deleted": material.get("deletedAt") is not None,
                    "favorite": material["favorite"], "imageCount": len(images), "payloadVersion": payload["version"],
                    "presentationAxes": presentation})
                for index, image in enumerate(images):
                    image_context = context + "/image:" + str(index)
                    try:
                        local, blob = image["localImageId"], image["blobId"]
                        storage, mime = image.get("storageId"), image["mimeType"]
                        require(LOCAL_ID.fullmatch(local) and HASH.fullmatch(blob), "Invalid image identity/hash")
                        require(mime in EXTENSIONS, "Unsupported original MIME type")
                        extension = EXTENSIONS[mime]
                        mapping = mappings[index]
                        require((mapping["local_image_id"], mapping["blob_hash"], mapping["storage_id"], mapping["position"])
                                == (local, blob, storage, index), "Immutable material image mapping differs")
                        recorded = blobs.get(blob)
                        require(recorded and (recorded["mime_type"], recorded["byte_length"], recorded["width"], recorded["height"])
                                == (mime, image["byteLength"], image["width"], image["height"]), "Blob descriptor differs")
                        if storage is not None:
                            require(UUID.fullmatch(storage), "Invalid storage identity")
                            require(storage not in seen_storage, "Current material images share an original instance")
                            seen_storage.add(storage)
                            instance = instances.get(storage)
                            require(instance and (instance["blob_hash"], instance["local_image_id"]) == (blob, local),
                                    "Immutable image-instance mapping differs")
                            require((mid, storage) in owners, "Material does not own its original instance")
                            location = locations.get(storage)
                            if location:
                                require((location["material_id"], location["mime_type"], location["blob_hash"], location["byte_length"])
                                        == (mid, mime, blob, image["byteLength"]), "Original-location ledger differs")
                                require(location["relocating"] == 0, "Original relocation is still pending")
                                path = library / "groups" / mid / "originals" / (storage + "." + extension)
                            else:
                                path = library / "instances" / storage[:2] / (storage + "." + extension)
                        else:
                            path = library / "objects" / blob[:2] / (blob + "." + extension)
                        checked = audit.verify(path, blob, image["byteLength"])
                        if storage is not None:
                            physical = audit.signatures[path][:2]
                            require(physical not in seen_physical, "Independent image instances share a physical file")
                            seen_physical[physical] = storage
                        result["originals"].append({"materialId": mid, "localImageId": local,
                            "storageId": storage, "resolver": "instance" if storage else "legacy-hash", **checked})
                        old_copy = legacy.get((mid, local, blob)) if storage is None else None
                        if old_copy:
                            require(old_copy["ready"] == 1, "Legacy group-original copy is still pending")
                            require((old_copy["mime_type"], old_copy["byte_length"]) == (mime, image["byteLength"]),
                                    "Legacy group-original descriptor differs")
                            key = hashlib.sha256((local + ":" + blob).encode()).hexdigest()
                            audit.verify(library / "groups" / mid / "originals" / ("legacy-" + key + "." + extension),
                                         blob, image["byteLength"])
                    except (AuditError, OSError, KeyError, TypeError, ValueError) as error:
                        audit.error(image_context, error)
            except (AuditError, OSError, KeyError, TypeError, ValueError) as error:
                audit.error(context, error)
        result["materialCountsByKind"] = dict(sorted(kind_counts.items()))
        result["materialCount"] = len(result["materials"])
        result["materialExifMarkers"] = sum(m["presentationAxes"]["exif"] for m in result["materials"])
        result["materialPayloadCounts"] = dict(sorted(Counter(
            str(m["payloadVersion"]) for m in result["materials"]).items()))
        result["verifiedOriginalCount"] = len(result["originals"])
        result["distinctOriginalInstances"] = len(seen_storage)
    require_quiescent(db_path)
    # Database bytes must still match the snapshot even if timestamps were
    # preserved; reopen immutable never checkpoints the source database.
    hasher = hashlib.sha256()
    with db_path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(chunk)
    require(hasher.hexdigest() == database["sha256"], "Database changed during audit; close the app and rerun")
    return result


def manifests_under(root):
    guarded(root)
    require(root.is_dir(), "Missing isolated projects directory")
    def onerror(_error):
        raise AuditError("Cannot enumerate isolated projects directory")
    for folder, directories, files in os.walk(root, followlinks=False, onerror=onerror):
        for name in directories + files:
            guarded(Path(folder) / name)
        if ".preshotproj" in files:
            yield Path(folder) / ".preshotproj"


def audit_project(audit, manifest):
    checked = audit.file(manifest)
    data = json.loads(manifest.read_text(encoding="utf-8-sig"))
    require(data["schemaVersion"] == 1, "Unsupported project manifest schema")
    require(UUID.fullmatch(data["id"]), "Invalid project identity")
    plan = data.get("plan")
    references = set()
    if data.get("coverImage"):
        references.add(data["coverImage"])
        local_file(manifest.parent, data["coverImage"], cover=True)
    result = {"manifest": checked, "projectId": data["id"], "files": [], "networkMediaCount": 0,
              "schemaVersion": None, "documentVersion": None, "presentationAxes": {"raw": 0, "exif": 0}}
    if plan is not None:
        version = plan["schemaVersion"]
        require(version in range(13, 19), "Unsupported plan schema")
        document = plan["document"]
        require(document["format"] == "preshot-blocks" and document["version"] == min(version - 12, 5),
                "Plan/document schema versions differ")
        presentation = axes(plan)
        require(not presentation["exif"] or version == 18, "EXIF project must use schema v18")
        for node in walk(plan):
            if "file" in node:
                value = node["file"]
                local_file(manifest.parent, value)
                references.add(value)
            if node.get("type") in ("image", "video", "audio", "file") and "props" in node:
                value = node["props"].get("url", "")
                require(isinstance(value, str), "Invalid native-media URL")
                if value.lower().startswith(("http://", "https://")):
                    result["networkMediaCount"] += 1
                elif value:
                    require(value.startswith("media/"), "Native media must have a project-local media path")
                    local_file(manifest.parent, value)
                    references.add(value)
        result.update(schemaVersion=version, documentVersion=document["version"], presentationAxes=presentation)
    for filename in sorted(references):
        file = local_file(manifest.parent, filename, cover=filename == data.get("coverImage"))
        result["files"].append({"file": filename, **audit.file(file)})
    result["referencedFileCount"] = len(result["files"])
    # Project manifests have no per-file hash field. These are observed audit
    # digests, independently compared with the source only when requested.
    result["hashBasis"] = "observed SHA-256; project manifests do not store asset hashes"
    return result, data


def compare_copy(audit, projects, documents, project_root, source_name, copy_name, text):
    def selected(value):
        parts = PurePosixPath(value.replace("\\", "/")).parts
        require(parts and not any(p in (".", "..") or ":" in p for p in parts)
                and not PurePosixPath(value.replace("\\", "/")).is_absolute(),
                "Copy-story project selectors must be relative folders under profile/projects")
        key = relative(guarded(project_root.joinpath(*parts) / ".preshotproj"))
        require(key in documents, "Copy-story project was not successfully audited")
        return key
    source, copied = selected(source_name), selected(copy_name)
    require(source != copied, "Source and copy must be distinct projects")
    original, duplicate = documents[source], documents[copied]
    require(original["id"] != duplicate["id"], "Copy retained the original project ID")
    source_files = {f["file"]: f for f in projects[source]["files"]}
    copy_files = {f["file"]: f for f in projects[copied]["files"]}
    require(source_files.keys() == copy_files.keys(), "Source/copy local asset reference sets differ")
    for filename, before in source_files.items():
        after = copy_files[filename]
        require((before["bytes"], before["sha256"]) == (after["bytes"], after["sha256"]),
                "Copied original bytes differ: " + filename)
        require(audit.signatures[ROOT / before["path"]][:2] != audit.signatures[ROOT / after["path"]][:2],
                "Source/copy share a physical asset: " + filename)
    result = {"source": source, "copy": copied, "independentOriginals": len(source_files),
              "identicalOriginalHashes": True, "distinctProjectIds": True}
    if text is not None:
        require(bool(text), "Copy-only text must not be empty")
        occurrences = {}
        for key, value in documents.items():
            count = sum(n["text"].count(text) for n in walk(value.get("plan"))
                        if isinstance(n.get("text"), str))
            if count:
                occurrences[key] = count
        require(occurrences == {copied: 1}, "Unique appended text must occur exactly once, only in the copy")
        result["copyOnlyText"] = {"sha256": hashlib.sha256(text.encode()).hexdigest(),
                                  "occurrences": 1, "onlyInCopy": True}
    return result


def run(args):
    work = guarded(repository_path(args.work))
    require(inside(work, CACHE) and work != CACHE, "Work must be an isolated child of .preshot-build-cache")
    profile = guarded(work / "profile" / ".preshot")
    require(profile.is_dir(), "Missing isolated profile/.preshot directory")
    output = guarded(repository_path(args.output), must_exist=False)
    require((inside(output, CACHE) or inside(output, ROOT / "docs" / "test_reports"))
            and output.suffix.lower() == ".json" and not inside(output, work / "profile")
            and "profile" not in (p.casefold() for p in output.relative_to(ROOT).parts),
            "Report must be a JSON file in build-cache or docs/test_reports, outside profile directories")
    require(not output.exists() or output.is_file(), "Report path must be a file")
    require(not output.exists() or output.stat().st_nlink == 1, "Report must not overwrite a hardlinked file")
    audit = Audit()
    report = {"format": "preshot-demo-profile-audit", "version": 1,
              "createdAt": datetime.now(timezone.utc).isoformat(), "profile": relative(profile),
              "readOnly": True, "library": None, "projects": [], "errors": audit.errors}
    try:
        report["library"] = audit_library(audit, profile)
    except (AuditError, OSError, sqlite3.Error, KeyError, TypeError, ValueError) as error:
        audit.error("library", error)
    documents, projects = {}, {}
    project_root = profile / "projects"
    try:
        for manifest in sorted(manifests_under(project_root)):
            try:
                result, data = audit_project(audit, manifest)
                key = relative(manifest)
                projects[key], documents[key] = result, data
                report["projects"].append(result)
            except (AuditError, OSError, KeyError, TypeError, ValueError) as error:
                audit.error(relative(manifest), error)
    except (AuditError, OSError) as error:
        audit.error("projects", error)
    if args.source_project:
        try:
            report["copyStory"] = compare_copy(audit, projects, documents, project_root,
                args.source_project, args.copy_project, args.copy_only_text)
        except (AuditError, OSError, KeyError, TypeError, ValueError) as error:
            audit.error("copyStory", error)
    audit.stable()
    report["projectCount"] = len(projects)
    report["projectSchemaCounts"] = dict(sorted(Counter(str(p["schemaVersion"]) for p in projects.values()).items()))
    report["projectExifMarkers"] = sum(p["presentationAxes"]["exif"] for p in projects.values())
    report["hashedFileCount"] = len(audit.files)
    report["hashedBytes"] = sum(f["bytes"] for f in audit.files.values())
    report["passed"] = not audit.errors
    output.parent.mkdir(parents=True, exist_ok=True)
    guarded(output.parent)
    guarded(output, must_exist=False)
    output.write_text(json.dumps(report, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "report": relative(output), "projects": len(projects),
                      "hashedFiles": len(audit.files), "errors": audit.errors}, ensure_ascii=True))
    return 0 if report["passed"] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--work", required=True, help="Isolated recording folder under .preshot-build-cache")
    parser.add_argument("--output", required=True, help="Repository-relative report JSON, outside profile directories")
    parser.add_argument("--source-project", help="Source project folder relative to profile/.preshot/projects")
    parser.add_argument("--copy-project", help="Copy project folder relative to profile/.preshot/projects")
    parser.add_argument("--copy-only-text", help="Unique document text appended only to the copied project")
    args = parser.parse_args()
    if bool(args.source_project) != bool(args.copy_project) or args.copy_only_text is not None and not args.copy_project:
        parser.error("--source-project and --copy-project are required together; copy text requires both")
    try:
        return run(args)
    except (AuditError, OSError) as error:
        message = str(error) if isinstance(error, AuditError) else type(error).__name__
        print(json.dumps({"passed": False, "error": message}, ensure_ascii=True), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())

# ADR-022 — Preserve Raw Uploads, Sanitize Media Payloads

**Status:** Accepted  
**Date:** 2026-08-09

## Decision

Images explicitly submitted as workout logs are preserved byte-for-byte in the user-configured Personal Data Directory, including metadata already present in the file. For captionless automatic inspection in an ACTIVE Program, the raw upload is preserved only after structured extraction returns a schema-valid deterministic-target candidate or a confirmation request. Ordinary images, missing target blocks, and provider failures are not retained as Stella data. The Plugin does not extract unrelated EXIF/GPS/device metadata into Observation Records or Processing Records.

Before an image is submitted to the OpenClaw media runtime, the Plugin creates a temporary sanitized media copy that:

- applies the image orientation to pixels so the visible content remains correct;
- removes EXIF, GPS, device, software, thumbnail, and other non-image metadata;
- contains only the pixels and encoding required for the extraction task.

Only the sanitized copy is submitted to OpenClaw. It lives in the Runtime Directory for the minimum processing window and is cleaned after success, failure, timeout, or cancellation. No extraction call receives EXIF/GPS.

## Consequences

- raw-artifact fidelity and auditability are preserved without widening model payloads;
- hashes and provenance refer separately to the raw artifact and, where necessary for processing audit, the sanitized payload hash;
- tests must verify pixel orientation, metadata removal, payload selection, and cleanup on every exit path;
- the Plugin privacy notice must distinguish raw local retention from sanitized media submitted to OpenClaw runtime.

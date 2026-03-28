"""One-time migration: upload existing local clips, renders and assets to S3/Minio.

Also generates probe.json files for clips that don't have one yet.

Usage:
    cd backend && uv run python ../scripts/migrate_to_s3.py
"""

import json
import os
import subprocess
import sys

import boto3
from botocore.config import Config

CLIPS_BASE = os.path.join(os.path.dirname(__file__), "..", "backend", "clips")
CLIPS_BASE = os.path.abspath(CLIPS_BASE)

S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://localhost:9000")
S3_BUCKET = os.getenv("S3_BUCKET", "cuttie")
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "cuttie")
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "cuttieminio")
S3_REGION = os.getenv("S3_REGION", "us-east-1")

client = boto3.client(
    "s3",
    endpoint_url=S3_ENDPOINT,
    aws_access_key_id=S3_ACCESS_KEY,
    aws_secret_access_key=S3_SECRET_KEY,
    region_name=S3_REGION,
    config=Config(signature_version="s3v4"),
)


def s3_key_exists(key: str) -> bool:
    try:
        client.head_object(Bucket=S3_BUCKET, Key=key)
        return True
    except client.exceptions.ClientError:
        return False


def upload(local_path: str, s3_key: str, content_type: str = "video/mp4"):
    if s3_key_exists(s3_key):
        print(f"  SKIP (already in S3): {s3_key}")
        return
    size_mb = os.path.getsize(local_path) / 1024 / 1024
    print(f"  UPLOAD {s3_key} ({size_mb:.1f} MB)...")
    client.upload_file(local_path, S3_BUCKET, s3_key, ExtraArgs={"ContentType": content_type})


def write_probe(clip_dir: str, filename: str, filepath: str):
    """Generate probe.json if it doesn't exist."""
    base = os.path.splitext(filename)[0]
    probe_path = os.path.join(clip_dir, f"{base}_probe.json")
    if os.path.exists(probe_path):
        return

    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", "-select_streams", "v:0", filepath],
            capture_output=True, text=True, timeout=15,
        )
        stream = json.loads(result.stdout).get("streams", [{}])[0]

        dur_result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", filepath],
            capture_output=True, text=True, timeout=15,
        )
        fmt = json.loads(dur_result.stdout).get("format", {})

        probe_data = {
            "width": stream.get("width", 1920),
            "height": stream.get("height", 1080),
            "duration": float(fmt.get("duration", stream.get("duration", 0))),
        }
        with open(probe_path, "w") as f:
            json.dump(probe_data, f)
        print(f"  PROBE {probe_path}")
    except Exception as e:
        print(f"  WARN: probe failed for {filename}: {e}")


def migrate_job(job_id: str, job_dir: str):
    print(f"\n[{job_id}]")
    for filename in sorted(os.listdir(job_dir)):
        filepath = os.path.join(job_dir, filename)
        if not os.path.isfile(filepath) or not filename.endswith(".mp4"):
            continue

        if filename.startswith("render_"):
            s3_key = f"renders/{job_id}/{filename}"
        else:
            s3_key = f"clips/{job_id}/{filename}"

        # Generate probe for clip files (not renders)
        if filename.startswith("clip_"):
            write_probe(job_dir, filename, filepath)

        upload(filepath, s3_key)


def migrate_assets():
    assets_dir = os.path.join(CLIPS_BASE, "_assets")
    if not os.path.isdir(assets_dir):
        print("\nNo assets to migrate.")
        return

    print("\n[_assets]")
    for filename in sorted(os.listdir(assets_dir)):
        filepath = os.path.join(assets_dir, filename)
        if not os.path.isfile(filepath) or filename.startswith("."):
            continue

        ext = os.path.splitext(filename)[1].lower()
        ct_map = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml"}
        content_type = ct_map.get(ext, "application/octet-stream")

        upload(filepath, f"assets/{filename}", content_type)


def main():
    print(f"Migrating files from {CLIPS_BASE} to S3 ({S3_ENDPOINT}/{S3_BUCKET})")

    if not os.path.isdir(CLIPS_BASE):
        print(f"ERROR: {CLIPS_BASE} not found")
        sys.exit(1)

    # Migrate job directories
    for entry in sorted(os.listdir(CLIPS_BASE)):
        if entry.startswith(".") or entry == "_assets":
            continue
        job_dir = os.path.join(CLIPS_BASE, entry)
        if os.path.isdir(job_dir):
            migrate_job(entry, job_dir)

    # Migrate assets
    migrate_assets()

    print("\nMigration complete!")


if __name__ == "__main__":
    main()

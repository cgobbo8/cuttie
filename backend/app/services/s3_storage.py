"""
S3/Minio storage helper.
Uploads media files (clips, verticals) to S3 after local processing.
Metadata JSON files stay on local disk.
"""

import logging
import os

import boto3
from botocore.config import Config

logger = logging.getLogger(__name__)

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = boto3.client(
            "s3",
            endpoint_url=os.getenv("S3_ENDPOINT", "http://localhost:9000"),
            # No default credentials: S3_ACCESS_KEY and S3_SECRET_KEY must be
            # set explicitly in the environment (or via backend/.env).
            aws_access_key_id=os.getenv("S3_ACCESS_KEY", ""),
            aws_secret_access_key=os.getenv("S3_SECRET_KEY", ""),
            region_name=os.getenv("S3_REGION", "us-east-1"),
            config=Config(signature_version="s3v4"),
        )
    return _client


def _bucket():
    return os.getenv("S3_BUCKET", "cuttie")


def upload_file(local_path: str, s3_key: str, content_type: str = "video/mp4"):
    """Upload a local file to S3 and log the result."""
    client = _get_client()
    client.upload_file(
        local_path,
        _bucket(),
        s3_key,
        ExtraArgs={"ContentType": content_type},
    )
    size_mb = os.path.getsize(local_path) / 1024 / 1024
    logger.info(f"Uploaded to S3: {s3_key} ({size_mb:.1f} MB)")


def upload_and_cleanup(local_path: str, s3_key: str, content_type: str = "video/mp4"):
    """Upload to S3, then delete the local file."""
    upload_file(local_path, s3_key, content_type)
    try:
        os.remove(local_path)
        logger.debug(f"Deleted local file: {local_path}")
    except OSError as e:
        logger.debug("Failed to delete local file %s: %s", local_path, e)

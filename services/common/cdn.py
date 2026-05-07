"""
CDN configuration for static assets
"""

import os
from dataclasses import dataclass
from typing import Optional


@dataclass
class CDNConfig:
    """Configuration for CDN asset delivery"""

    enabled: bool = False
    base_url: str = ""
    assets_path: str = "/assets"

    def __post_init__(self):
        self.enabled = os.getenv("CDN_ENABLED", "false").lower() == "true"
        self.base_url = os.getenv("CDN_BASE_URL", "https://cdn.openblock.example.com")
        self.assets_path = os.getenv("CDN_ASSETS_PATH", "/assets")

    def get_asset_url(self, path: str) -> str:
        """Get CDN URL for an asset"""
        if not self.enabled:
            return path

        if path.startswith("http"):
            return path

        clean_path = path.lstrip("/")
        return f"{self.base_url}/{clean_path}"

    def get_versioned_url(self, path: str, version: str) -> str:
        """Get versioned CDN URL"""
        if not self.enabled:
            return path

        clean_path = path.lstrip("/")
        return f"{self.base_url}/v{version}/{clean_path}"


class AssetManifest:
    """Asset manifest for versioned deployments"""

    def __init__(self, manifest: dict = None):
        self.manifest = manifest or {}

    def get_url(self, asset: str) -> Optional[str]:
        """Get asset URL from manifest"""
        return self.manifest.get(asset)

    def load_from_file(self, path: str):
        """Load manifest from JSON file"""
        try:
            import json

            with open(path, "r") as f:
                self.manifest = json.load(f)
        except Exception:
            pass


cdn_config = CDNConfig()


def get_cdn_url(path: str) -> str:
    """Get CDN URL for path"""
    return cdn_config.get_asset_url(path)


def get_versioned_cdn_url(path: str, version: str = None) -> str:
    """Get versioned CDN URL"""
    if version is None:
        version = os.getenv("ASSET_VERSION", "1")
    return cdn_config.get_versioned_url(path, version)

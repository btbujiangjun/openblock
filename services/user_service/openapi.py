"""
openapi.py — OpenAPI 3.0 spec for the user service.

Why apispec + marshmallow:
  - apispec generates OpenAPI 3.0 from declarative schemas, no manual
    YAML maintenance.
  - marshmallow schemas are then reusable for request validation in
    the route layer (we add that in v1.16; v1.15 only ships docs).
  - Swagger UI is served at /docs from a CDN-hosted bundle so we don't
    bloat the container with static assets.

Spec is exposed at:
  - GET /openapi.json   — raw OpenAPI 3.0 document
  - GET /docs           — Swagger UI

Both endpoints are read-only and safe to expose publicly; future
hardening can put them behind an auth_request guard at the gateway.
"""

from __future__ import annotations

import json
from typing import Any

from flask import Flask, Response, render_template_string

try:
    from apispec import APISpec
    from apispec.ext.marshmallow import MarshmallowPlugin
    from apispec_webframeworks.flask import FlaskPlugin
    from marshmallow import Schema, fields

    _APISPEC_AVAILABLE = True
except Exception:  # pragma: no cover
    APISpec = None  # type: ignore[assignment]
    MarshmallowPlugin = FlaskPlugin = None  # type: ignore[assignment]
    Schema = object  # type: ignore[misc,assignment]
    fields = None  # type: ignore[assignment]
    _APISPEC_AVAILABLE = False


# ---------------------------------------------------------------------------
# Schemas (also reusable for marshmallow validation in v1.16)
# ---------------------------------------------------------------------------
if _APISPEC_AVAILABLE:

    class _UserCreateSchema(Schema):
        username = fields.String(required=True, metadata={"example": "alice"})
        email = fields.Email(required=True, metadata={"example": "alice@example.com"})
        password = fields.String(
            required=True,
            metadata={"format": "password", "example": "CorrectHorseBatteryStaple"},
        )

    class _UserResponseSchema(Schema):
        id = fields.String()
        username = fields.String()
        email = fields.Email()
        is_active = fields.Boolean()
        is_premium = fields.Boolean()
        created_at = fields.String()

    class _LoginSchema(Schema):
        username = fields.String(required=True)
        password = fields.String(required=True, metadata={"format": "password"})

    class _TokenPairSchema(Schema):
        access_token = fields.String()
        refresh_token = fields.String()
        access_expires_at = fields.Integer()
        refresh_expires_at = fields.Integer()
        token_type = fields.String(metadata={"example": "Bearer"})

    class _RefreshSchema(Schema):
        refresh_token = fields.String(required=True)

    class _ErrorSchema(Schema):
        error = fields.String()
        code = fields.String()


SWAGGER_UI_HTML = """<!DOCTYPE html>
<html>
  <head>
    <title>OpenBlock User Service — API Docs</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
    <style>body { margin: 0; }</style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.onload = () => {
        SwaggerUIBundle({
          url: '/openapi.json',
          dom_id: '#swagger-ui',
          presets: [SwaggerUIBundle.presets.apis],
          deepLinking: true,
        });
      };
    </script>
  </body>
</html>
"""


def _build_spec(app: Flask) -> "APISpec | None":
    """Construct the APISpec by walking Flask routes inside an app context."""
    if not _APISPEC_AVAILABLE:
        return None

    spec = APISpec(
        title="OpenBlock User Service",
        version="1.15.0",
        openapi_version="3.0.3",
        info={
            "description": (
                "Authentication, user CRUD, token refresh and revocation. "
                "All write endpoints expect JSON; all responses are JSON. "
                "Auth uses JWT (HS256) with refresh-rotation."
            ),
            "license": {"name": "MIT"},
        },
        plugins=[FlaskPlugin(), MarshmallowPlugin()],
    )

    # Tag the components/schemas section.
    for cls in (
        _UserCreateSchema,
        _UserResponseSchema,
        _LoginSchema,
        _TokenPairSchema,
        _RefreshSchema,
        _ErrorSchema,
    ):
        spec.components.schema(cls.__name__.strip("_"), schema=cls)

    spec.components.security_scheme(
        "bearerAuth", {"type": "http", "scheme": "bearer", "bearerFormat": "JWT"}
    )

    # Walk each Flask view function whose docstring uses YAML.
    with app.test_request_context():
        for rule in app.url_map.iter_rules():
            view = app.view_functions.get(rule.endpoint)
            if view and view.__doc__ and "---" in (view.__doc__ or ""):
                spec.path(view=view)

    return spec


def register_openapi(app: Flask) -> None:
    """Add /openapi.json and /docs to `app`. No-op if apispec missing."""

    if not _APISPEC_AVAILABLE:
        return

    @app.route("/openapi.json", methods=["GET"])
    def openapi_json() -> Any:
        spec = _build_spec(app)
        if spec is None:
            return Response("apispec unavailable", status=501, mimetype="text/plain")
        return Response(
            json.dumps(spec.to_dict(), ensure_ascii=False),
            mimetype="application/json",
        )

    @app.route("/docs", methods=["GET"])
    def swagger_ui() -> Any:
        return render_template_string(SWAGGER_UI_HTML)

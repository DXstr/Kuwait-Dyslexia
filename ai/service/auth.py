"""Supabase access-token verification and role checks.

The scorer accepts only tokens signed by the Supabase project (asymmetric keys from its JWKS endpoint, or the
legacy shared HS256 secret if configured) whose custom claim `app_role` is allowed for the endpoint. The web app's
Supabase custom access token hook puts `app_role` into the token (contracts/data-model.md).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import jwt


class AuthError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


class KeyResolver(Protocol):
    def __call__(self, token: str) -> tuple[object, list[str]]:
        """Return (verification key, allowed algorithms) for a token."""


@dataclass
class JWKSResolver:
    url: str

    def __post_init__(self) -> None:
        self._client = jwt.PyJWKClient(self.url, cache_keys=True, lifespan=600)

    def __call__(self, token: str) -> tuple[object, list[str]]:
        try:
            key = self._client.get_signing_key_from_jwt(token)
        except jwt.PyJWKClientError as e:
            raise AuthError(401, "unauthorized", f"signing key not found: {e}") from e
        return key.key, [key.algorithm_name] if getattr(key, "algorithm_name", None) else ["ES256", "RS256"]


@dataclass
class SecretResolver:
    secret: str

    def __call__(self, token: str) -> tuple[object, list[str]]:
        return self.secret, ["HS256"]


@dataclass
class Verifier:
    resolver: KeyResolver
    audience: str = "authenticated"

    def claims(self, authorization: str | None) -> dict:
        if not authorization or not authorization.lower().startswith("bearer "):
            raise AuthError(401, "unauthorized", "missing bearer token")
        token = authorization.split(" ", 1)[1].strip()
        key, algorithms = self.resolver(token)
        try:
            return jwt.decode(token, key, algorithms=algorithms, audience=self.audience, options={"require": ["exp"]})
        except jwt.ExpiredSignatureError as e:
            raise AuthError(401, "unauthorized", "token expired") from e
        except jwt.InvalidTokenError as e:
            raise AuthError(401, "unauthorized", f"invalid token: {type(e).__name__}") from e

    def require(self, authorization: str | None, roles: set[str]) -> dict:
        claims = self.claims(authorization)
        role = claims.get("app_role")
        if role not in roles:
            raise AuthError(403, "forbidden", f"role {role!r} may not call this endpoint")
        return claims

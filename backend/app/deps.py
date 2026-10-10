import hmac

from fastapi import HTTPException, Request

from .config import get_settings


def require_token(request: Request) -> None:
    token = get_settings().app_access_token
    if not token:
        return
    given = request.headers.get("x-access-token") or request.query_params.get("token") or ""
    if not hmac.compare_digest(given, token):
        raise HTTPException(status_code=401, detail="access token required")

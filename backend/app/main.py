import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .config import get_settings
from .db import init_db
from .deps import require_token
from .engine import pause_all_active, registry
from .routers import games, puzzles, settings
from .seed import seed_builtin

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    seed_builtin()
    pause_all_active()
    yield
    await registry.shutdown()


def create_app() -> FastAPI:
    cfg = get_settings()
    app = FastAPI(title="Turtle Soup", version=__version__, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in cfg.cors_origins.split(",") if o.strip()],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    api_deps = [Depends(require_token)]
    for r in (puzzles.router, games.router, settings.router):
        app.include_router(r, prefix="/api", dependencies=api_deps)

    @app.get("/api/health")
    def health():
        return {"ok": True, "version": __version__}

    dist = cfg.frontend_dist
    if dist.is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            if path == "api" or path.startswith("api/"):
                raise HTTPException(404, "not found")
            f = (dist / path).resolve()
            if path and f.is_file() and dist.resolve() in f.parents:
                return FileResponse(f)
            return FileResponse(dist / "index.html")

    return app


app = create_app()

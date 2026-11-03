"""Production entry point: `python -m app` serves on 0.0.0.0:$PORT with one worker."""

import os

import uvicorn


def main() -> None:
    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8080")),
        workers=1,
        reload=False,
    )


if __name__ == "__main__":
    main()

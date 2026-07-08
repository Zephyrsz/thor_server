from __future__ import annotations

import runpy
from pathlib import Path


BACKEND_DEPLOY = Path(__file__).with_name("pj_sts_demo") / "backend" / "deploy_pj_sts_demo.py"


if __name__ == "__main__":
    runpy.run_path(str(BACKEND_DEPLOY), run_name="__main__")


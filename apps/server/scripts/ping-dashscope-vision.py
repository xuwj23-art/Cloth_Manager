"""One-shot DashScope qwen3-vl-plus connectivity check. Reads key from apps/server/.env. Do not print secrets."""

from __future__ import annotations

import json
import ssl
import urllib.error
import urllib.request
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parents[1] / ".env"


def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def main() -> int:
    env = load_env(ENV_PATH)
    key = env.get("DASHSCOPE_API_KEY", "")
    model = env.get("GARMENT_VISION_MODEL", "qwen3-vl-plus")
    print("key_loaded", bool(key), "prefix", (key[:6] + "...") if key else "EMPTY", "len", len(key))
    print("model", model)
    if not key:
        print("FAIL missing DASHSCOPE_API_KEY")
        return 1

    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20241022/emyrja/dog_and_girl.jpeg"
                        },
                    },
                    {"type": "text", "text": "这张图里有什么？请用不超过20个汉字回答。"},
                ],
            }
        ],
        "max_tokens": 128,
    }
    req = urllib.request.Request(
        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=40, context=ssl.create_default_context()) as res:
            raw = res.read().decode("utf-8", errors="replace")
            print("http", res.status)
            data = json.loads(raw)
            print("model_echo", data.get("model"))
            choice = (data.get("choices") or [{}])[0]
            content = (choice.get("message") or {}).get("content")
            print("content", (content or "")[:200])
            print("usage", json.dumps(data.get("usage") or {}, ensure_ascii=False))
            print("OK")
            return 0
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        print("http_error", e.code)
        print("body", err[:800])
        return 2
    except Exception as e:
        print("error_type", type(e).__name__)
        print("error", str(e)[:400])
        return 3


if __name__ == "__main__":
    raise SystemExit(main())

import io
from typing import Any

from fastapi.testclient import TestClient
from PIL import Image

from server import GlmOcrSdkServer, convert_glmocr_result_to_liteparse


class MockPipelineResult:
    def to_dict(self) -> dict[str, Any]:
        return {
            "json_result": [
                [
                    {
                        "index": 0,
                        "label": "text",
                        "content": "Hello GLM-OCR",
                        "bbox_2d": [0, 0, 1000, 1000],
                    }
                ]
            ],
            "markdown_result": "Hello GLM-OCR",
            "model": "glm-ocr",
        }


class MockParser:
    def parse(self, *_args: Any, **_kwargs: Any) -> MockPipelineResult:
        return MockPipelineResult()


def test_conversion_uses_official_bbox_2d() -> None:
    converted = convert_glmocr_result_to_liteparse(
        {
            "json_result": [
                [
                    {
                        "content": "Boxed",
                        "bbox_2d": [100, 200, 900, 400],
                        "confidence": 0.75,
                    }
                ]
            ]
        },
        1000,
        2000,
    )

    assert converted["results"] == [
        {"text": "Boxed", "bbox": [100, 400, 900, 800], "confidence": 0.75}
    ]
    assert converted["warnings"] == []


def test_conversion_does_not_create_fallback_line_boxes() -> None:
    converted = convert_glmocr_result_to_liteparse(
        {"json_result": [[{"content": "No box"}]]},
        1000,
        2000,
    )

    assert converted["results"] == []
    assert "region_bbox_missing" in converted["warnings"]
    assert "degraded_no_layout_bbox" in converted["warnings"]


def test_server_health_endpoint() -> None:
    server = GlmOcrSdkServer()
    app = server._create_ocr_server()
    client = TestClient(app)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "healthy",
        "model": "glm-ocr-g32-mixed_4_8-mlx",
        "layout_model_dir": "PaddlePaddle/PP-DocLayoutV3_safetensors",
    }


def test_server_ocr_endpoint() -> None:
    image = Image.new("RGB", (1, 1), color=(255, 255, 255))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    buffer.seek(0)

    server = GlmOcrSdkServer()
    server.parser = MockParser()
    app = server._create_ocr_server()
    client = TestClient(app)

    response = client.post(
        "/ocr",
        files={"file": ("test.png", buffer, "image/png")},
        data={"language": "en"},
    )

    assert response.status_code == 200
    assert response.json()["results"] == [
        {"text": "Hello GLM-OCR", "bbox": [0, 0, 1, 1], "confidence": 1.0}
    ]
    assert response.json()["engine"] == "glmocr-pipeline"

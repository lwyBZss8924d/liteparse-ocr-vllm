import io
import logging
import os
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.datastructures import UploadFile
from fastapi.param_functions import File, Form
from PIL import Image
from pydantic import BaseModel


DEFAULT_MODEL = "glm-ocr-g32-mixed_4_8-mlx"
DEFAULT_OCR_API_URL = "http://localhost:1234/v1/chat/completions"
DEFAULT_LAYOUT_MODEL_DIR = "PaddlePaddle/PP-DocLayoutV3_safetensors"


class OcrResponse(BaseModel):
    results: list[Any]
    engine: str = "glmocr-pipeline"
    model: str = DEFAULT_MODEL
    warnings: list[str] = []


class StatusResponse(BaseModel):
    status: str
    model: str
    layout_model_dir: str


class GlmOcrSdkServer:
    def __init__(self) -> None:
        self.parser: Any | None = None
        self.model = os.getenv("LITEPARSE_GLMOCR_MODEL", DEFAULT_MODEL)

    def _create_ocr_server(self) -> FastAPI:
        app = FastAPI()

        @app.post("/ocr")
        async def ocr_endpoint(
            file: UploadFile = File(...), language: str = Form(default="en")
        ) -> OcrResponse:
            _ = language
            image_data = await file.read()
            try:
                image = Image.open(io.BytesIO(image_data))
                width, height = image.size
            except Exception as exc:
                raise HTTPException(status_code=400, detail=f"Invalid image: {exc}") from exc

            try:
                parser = self._get_parser()
                parsed = parser.parse(image_data)
                if isinstance(parsed, list):
                    parsed = parsed[0] if parsed else None
                if parsed is None:
                    return OcrResponse(results=[], model=self.model, warnings=["empty_glmocr_result"])
                result_dict = parsed.to_dict() if hasattr(parsed, "to_dict") else parsed
                converted = convert_glmocr_result_to_liteparse(result_dict, width, height)
                return OcrResponse(
                    results=converted["results"],
                    model=str(result_dict.get("model", self.model))
                    if isinstance(result_dict, dict)
                    else self.model,
                    warnings=converted["warnings"],
                )
            except HTTPException:
                raise
            except Exception as exc:
                raise HTTPException(status_code=500, detail=str(exc)) from exc

        @app.get("/health")
        def health() -> StatusResponse:
            return StatusResponse(
                status="healthy",
                model=self.model,
                layout_model_dir=os.getenv(
                    "LITEPARSE_GLMOCR_LAYOUT_MODEL_DIR", DEFAULT_LAYOUT_MODEL_DIR
                ),
            )

        return app

    def _get_parser(self) -> Any:
        if self.parser is not None:
            return self.parser

        from glmocr import GlmOcr

        ocr_api_url = os.getenv("LITEPARSE_GLMOCR_OCR_API_URL", DEFAULT_OCR_API_URL)
        ocr_api_mode = os.getenv("LITEPARSE_GLMOCR_OCR_API_MODE", "openai")
        layout_device = os.getenv("LITEPARSE_GLMOCR_LAYOUT_DEVICE", "cpu")
        layout_model_dir = os.getenv("LITEPARSE_GLMOCR_LAYOUT_MODEL_DIR", DEFAULT_LAYOUT_MODEL_DIR)
        layout_batch_size = int(os.getenv("LITEPARSE_GLMOCR_LAYOUT_BATCH_SIZE", "1"))
        max_workers = int(os.getenv("LITEPARSE_GLMOCR_MAX_WORKERS", "1"))
        timeout = int(os.getenv("LITEPARSE_GLMOCR_TIMEOUT", "300"))

        self.parser = GlmOcr(
            mode="selfhosted",
            model=self.model,
            timeout=timeout,
            layout_device=layout_device,
            _dotted={
                "pipeline.maas.enabled": False,
                "pipeline.ocr_api.api_url": ocr_api_url,
                "pipeline.ocr_api.api_mode": ocr_api_mode,
                "pipeline.ocr_api.model": self.model,
                "pipeline.layout.model_dir": layout_model_dir,
                "pipeline.layout.batch_size": layout_batch_size,
                "pipeline.max_workers": max_workers,
            },
        )
        return self.parser

    def serve(self) -> None:
        app = self._create_ocr_server()
        host = os.getenv("LITEPARSE_GLMOCR_HOST", "0.0.0.0")
        port = int(os.getenv("LITEPARSE_GLMOCR_PORT", "8831"))
        uvicorn.run(app, host=host, port=port)


def convert_glmocr_result_to_liteparse(
    result: Any, image_width: int, image_height: int
) -> dict[str, Any]:
    if not isinstance(result, dict):
        return {"results": [], "warnings": ["invalid_glmocr_result"]}

    regions = collect_regions(result.get("json_result") or result.get("layout_details") or [])
    warnings: list[str] = []
    output: list[dict[str, Any]] = []

    if not regions:
        warnings.append("glmocr_layout_missing")

    for region in regions:
        text = str(region.get("content") or region.get("text") or "").strip()
        if not text:
            continue
        bbox = region_to_pixel_bbox(region, image_width, image_height)
        if bbox is None:
            warnings.append("region_bbox_missing")
            continue
        confidence = region.get("confidence", region.get("score", 1.0))
        output.append(
            {
                "text": text,
                "bbox": bbox,
                "confidence": normalize_confidence(confidence),
            }
        )

    if regions and not output:
        warnings.append("empty_ocr_content")
    if "region_bbox_missing" in warnings:
        warnings.append("degraded_no_layout_bbox")

    return {"results": output, "warnings": sorted(set(warnings))}


def collect_regions(value: Any) -> list[dict[str, Any]]:
    regions: list[dict[str, Any]] = []

    def visit(item: Any) -> None:
        if isinstance(item, list):
            for child in item:
                visit(child)
            return
        if not isinstance(item, dict):
            return
        if {"content", "text", "bbox_2d", "box_2d", "bbox"} & set(item.keys()):
            regions.append(item)
            return
        for key in ("json_result", "layout_details", "layout_blocks", "blocks"):
            visit(item.get(key))

    visit(value)
    return regions


def region_to_pixel_bbox(
    region: dict[str, Any], image_width: int, image_height: int
) -> list[int] | None:
    normalized = number_list(region.get("bbox_2d") or region.get("box_2d"))
    if normalized and len(normalized) >= 4:
        return clamp_bbox(
            [
                normalized[0] * image_width / 1000,
                normalized[1] * image_height / 1000,
                normalized[2] * image_width / 1000,
                normalized[3] * image_height / 1000,
            ],
            image_width,
            image_height,
        )

    pixel = number_list(region.get("bbox"))
    if pixel and len(pixel) >= 4:
        return clamp_bbox(pixel[:4], image_width, image_height)

    return None


def clamp_bbox(raw: list[float], image_width: int, image_height: int) -> list[int] | None:
    x1, y1, x2, y2 = [round(value) for value in raw]
    x1 = max(0, min(image_width, x1))
    x2 = max(0, min(image_width, x2))
    y1 = max(0, min(image_height, y1))
    y2 = max(0, min(image_height, y2))
    if x2 <= x1 or y2 <= y1:
        return None
    return [x1, y1, x2, y2]


def number_list(value: Any) -> list[float] | None:
    if not isinstance(value, list):
        return None
    try:
        return [float(item) for item in value]
    except Exception:
        return None


def normalize_confidence(value: Any) -> float:
    try:
        number = float(value)
    except Exception:
        return 1.0
    if number > 1:
        number = number / 100
    return max(0.0, min(1.0, number))


if __name__ == "__main__":
    logging.basicConfig(level=logging.DEBUG)
    logging.info("Starting GLM-OCR SDK server on port %s", os.getenv("LITEPARSE_GLMOCR_PORT", "8831"))
    GlmOcrSdkServer().serve()

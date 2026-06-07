use std::{io::Cursor, pin::Pin, time::Duration};

use image::ImageFormat;
use reqwest::{
    Client,
    multipart::{Form, Part},
};
use serde::{Deserialize, Serialize};

use crate::ocr::{OcrEngine, OcrOptions, OcrResult};

#[derive(Debug, Serialize, Deserialize)]
pub struct HttpOcrResponseItem {
    text: String,
    bbox: [f32; 4],
    confidence: f32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HttpOcrResponse {
    pub results: Vec<HttpOcrResponseItem>,
}

/// HTTP-based OCR engine that conforms to LiteParse OCR API specification.
/// The server must implement the API defined in OCR_API_SPEC.md:
///     - POST /ocr endpoint
///     - Accepts multipart/form-data with 'file' and 'language' fields
///     - Returns JSON: { results: [{ text, bbox: [x1,y1,x2,y2], confidence }] }
/// See ocr/easyocr/ and ocr/paddleocr/ for example server implementations.
pub struct HttpOcrEngine {
    pub name: String,
    server_url: String,
    timeout_ms: u64,
}

impl HttpOcrEngine {
    pub fn new(server_url: String, timeout_ms: u64) -> Self {
        Self {
            name: "http-ocr".to_string(),
            server_url,
            timeout_ms,
        }
    }
}

impl OcrEngine for HttpOcrEngine {
    fn name(&self) -> &str {
        &self.name
    }

    fn recognize<'a, 'b: 'a, 'c: 'a>(
        &'a self,
        image_data: &'c [u8],
        width: u32,
        height: u32,
        options: &'b OcrOptions,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<Vec<OcrResult>, Box<dyn std::error::Error + Send + Sync>>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            // Encode raw RGB bytes as PNG for the server
            let img: image::RgbImage =
                image::ImageBuffer::from_raw(width, height, image_data.to_vec())
                    .ok_or("failed to create image buffer from raw RGB data")?;
            let mut png_bytes = Vec::new();
            img.write_to(&mut Cursor::new(&mut png_bytes), ImageFormat::Png)?;

            let client = Client::new();
            let form = Form::new()
                .part(
                    "file",
                    Part::bytes(png_bytes)
                        .file_name("image.png")
                        .mime_str("image/png")?,
                )
                .text("language", options.language.clone());
            let response: HttpOcrResponse = client
                .post(&self.server_url)
                .multipart(form)
                .timeout(Duration::from_millis(self.timeout_ms))
                .send()
                .await?
                .json()
                .await?;

            let results: Vec<OcrResult> = response
                .results
                .iter()
                .map(|i| OcrResult {
                    text: i.text.clone(),
                    bbox: i.bbox,
                    confidence: i.confidence,
                })
                .collect();

            Ok(results)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_sets_name_and_url() {
        let e = HttpOcrEngine::new("http://example.com/ocr".into(), 123_000);
        assert_eq!(e.name(), "http-ocr");
        assert_eq!(e.server_url, "http://example.com/ocr");
        assert_eq!(e.timeout_ms, 123_000);
    }

    #[test]
    fn test_response_deserializes() {
        let raw = r#"{"results":[{"text":"hi","bbox":[1.0,2.0,3.0,4.0],"confidence":0.85}]}"#;
        let parsed: HttpOcrResponse = serde_json::from_str(raw).unwrap();
        assert_eq!(parsed.results.len(), 1);
        assert_eq!(parsed.results[0].text, "hi");
        assert_eq!(parsed.results[0].bbox, [1.0, 2.0, 3.0, 4.0]);
        assert!((parsed.results[0].confidence - 0.85).abs() < 1e-6);
    }

    #[test]
    fn test_response_deserializes_empty() {
        let raw = r#"{"results":[]}"#;
        let parsed: HttpOcrResponse = serde_json::from_str(raw).unwrap();
        assert!(parsed.results.is_empty());
    }

    #[tokio::test]
    async fn test_recognize_network_error() {
        let e = HttpOcrEngine::new("http://127.0.0.1:1/ocr".into(), 60_000);
        let opts = OcrOptions {
            language: "eng".into(),
        };
        let r = e.recognize(&[0u8; 4], 1, 1, &opts).await;
        assert!(r.is_err());
    }
}

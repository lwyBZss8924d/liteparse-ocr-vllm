import os

from anthropic import Anthropic

from .base import LLMProvider, QA_PROMPT, JUDGE_PROMPT


class AnthropicProvider(LLMProvider):
    """
    LLM provider using Anthropic for QA.
    """

    def __init__(
        self,
        api_key: str = None,
        model: str = "claude-sonnet-4-5-20250929",
        base_url: str = None,
    ):
        """
        Initialize Anthropic QA provider.

        Args:
            api_key: Anthropic API key (or use ANTHROPIC_API_KEY env var)
            model: Claude model to use
            base_url: Anthropic-compatible API base URL
        """

        resolved_api_key = api_key or os.getenv("ANTHROPIC_API_KEY") or os.getenv("PIPELLM_API_KEY")
        resolved_base_url = base_url or os.getenv("ANTHROPIC_BASE_URL")
        self.client = Anthropic(
            api_key=resolved_api_key,
            base_url=resolved_base_url,
            max_retries=100,
            timeout=10000,
        )
        self.model = model

    def answer_question(self, ocr_text: str, question: str) -> str:
        """Answer a question about an image using Claude."""

        # Call Claude
        response = self.client.messages.create(
            model=self.model,
            max_tokens=1024,
            messages=[
                {
                    "role": "user",
                    "content": QA_PROMPT.format(ocr_text=ocr_text, question=question),
                }
            ],
            timeout=10000,
        )
        if not response.content or len(response.content) == 0:
            raise ValueError("No content returned from Anthropic response")
        
        return response.content[0].text

    def evaluate_answer(self, question: str, expected_answer: str, predicted_answer: str) -> bool:
        """
        Evaluate whether the predicted answer is correct compared to the expected answer using an LLM judge.
        """

        # Call the LLM judge
        judge_prompt = JUDGE_PROMPT.format(
            question=question,
            expected_answer=expected_answer,
            predicted_answer=predicted_answer,
        )

        response = self.client.messages.create(
            model=self.model,
            max_tokens=256,
            messages=[
                {
                    "role": "user",
                    "content": judge_prompt,
                }
            ],
            timeout=10000,
        )
        if not response.content or len(response.content) == 0:
            # If the judge fails to respond, we can choose to be lenient and pass the answer
            return True  

        # Check if the response is "<pass>" or "<fail>"
        resp_text = response.content[0].text.strip()

        resp_text_lower = resp_text.lower()
        return "<pass" in resp_text_lower and "<fail" not in resp_text_lower

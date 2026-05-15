"""Small helpers for the publish controls."""


def build_default_caption(metadata: dict, max_text_chars: int = 500) -> str:
    """Build a conservative default caption from persisted task metadata."""
    input_params = metadata.get("input", {}) if metadata else {}
    title = (input_params.get("title") or "").strip()
    text = (input_params.get("text") or "").strip()

    if len(text) > max_text_chars:
        text = text[:max_text_chars].rstrip() + "..."

    if title and text:
        return f"{title}\n\n{text}"
    return title or text

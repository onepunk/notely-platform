#!/usr/bin/env python3
"""Modern chunking pipeline for long-form meeting analysis.

This module provides a maintainable, well-documented implementation of the
classic chunk-map-reduce-refine pattern we use to analyse long transcripts.
It focuses on:
    * predictable token usage (to fit within the LLM context window)
    * clear separation of responsibilities between the pipeline stages
    * graceful degradation when the LLM returns unexpected output
    * optional Redis-backed caching for expensive runs

The public entry point is :func:`create_pipeline`.  The returned pipeline
object exposes a single :func:`process` method that mirrors the behaviour of
our legacy implementation, making adoption easy while giving us a cleaner
foundation for future enhancements.
"""

from __future__ import annotations

import json
import logging
import math
import os
import re
import time
from dataclasses import dataclass, field
from datetime import datetime
from hashlib import sha256
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests
from difflib import SequenceMatcher

try:
    import redis  # type: ignore
except ImportError:  # pragma: no cover - redis is optional
    redis = None

try:
    import nltk
    from nltk.tokenize import sent_tokenize
except ImportError as exc:  # pragma: no cover - nltk should be available, but we guard anyway
    raise RuntimeError(
        "The chunking pipeline requires nltk. Ensure it is installed in the image."
    ) from exc

try:  # Ensure required data is present (quiet to avoid noisy logs)
    nltk.download("punkt", quiet=True)
except Exception:  # noqa: BLE001 - we do not want to fail if download fails in air-gapped envs
    pass

LOGGER = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PipelineConfig:
    """Runtime configuration for the chunking pipeline."""

    context_limit: int = int(os.getenv("LLM_CONTEXT_LIMIT", os.getenv("VLLM_CONTEXT_LIMIT", "4096")))
    completion_tokens: int = int(os.getenv("PIPELINE_COMPLETION_TOKENS", "900"))
    chunk_token_target: int = int(
        os.getenv(
            "PIPELINE_CHUNK_TOKENS",
            str(max(512, context_limit - int(os.getenv("PIPELINE_COMPLETION_TOKENS", "900")) - 600)),
        )
    )
    chunk_token_overlap: int = int(os.getenv("PIPELINE_CHUNK_OVERLAP", "500"))
    min_chunk_tokens: int = int(os.getenv("PIPELINE_MIN_CHUNK_TOKENS", "800"))
    max_chunks: int = int(os.getenv("PIPELINE_MAX_CHUNKS", "100"))
    chars_per_token: float = float(os.getenv("AVG_CHARS_PER_TOKEN", "4.0"))
    request_timeout: int = int(os.getenv("PIPELINE_REQUEST_TIMEOUT", "120"))
    temperature_extract: float = float(os.getenv("PIPELINE_TEMPERATURE_EXTRACT", "0.3"))
    temperature_refine: float = float(os.getenv("PIPELINE_TEMPERATURE_REFINE", "0.5"))
    top_p: float = float(os.getenv("PIPELINE_TOP_P", "0.9"))
    redis_ttl_seconds: int = int(os.getenv("PIPELINE_REDIS_TTL", "900"))  # 15 min
    log_response_dir: Path = Path(os.getenv("PIPELINE_DEBUG_DIR", "/app/cache"))

    def tokens_to_chars(self, token_count: int) -> int:
        return max(1, int(math.ceil(token_count * self.chars_per_token)))

    def estimate_tokens(self, text: str) -> int:
        if self.chars_per_token <= 0:
            return len(text) or 1
        return max(1, int(math.ceil(len(text) / self.chars_per_token)))


CONFIG = PipelineConfig()

SIMILARITY_THRESHOLD = float(os.getenv("PIPELINE_SIMILARITY_THRESHOLD", "0.75"))


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------


def _ensure_directory(path: Path) -> None:
    try:
        path.mkdir(parents=True, exist_ok=True)
    except Exception as exc:  # pragma: no cover - defensive, should not happen
        LOGGER.warning("Failed to ensure directory exists", {"path": str(path), "error": str(exc)})


class TokenEstimator:
    """Utility for token-related calculations."""

    def __init__(self, config: PipelineConfig) -> None:
        self.config = config

    def estimate(self, text: str) -> int:
        return self.config.estimate_tokens(text)

    def remaining_completion_tokens(self, prompt: str) -> int:
        prompt_tokens = self.estimate(prompt)
        available = self.config.context_limit - prompt_tokens
        return max(0, available)

    def safe_max_completion(self, prompt: str, desired: int) -> int:
        remaining = self.remaining_completion_tokens(prompt)
        return max(1, min(desired, remaining - 16)) if remaining > 16 else 1


TOKEN_ESTIMATOR = TokenEstimator(CONFIG)


class PromptTemplates:
    """Container for prompt templates supplied per-request from the DB.

    The pipeline no longer loads prompts from disk — all templates
    arrive in the request context from the summaries service.
    """

    def __init__(self, chunk_extraction: str, refinement: str) -> None:
        self.templates = {
            "chunk_extraction": chunk_extraction,
            "refinement": refinement,
        }

    def get(self, name: str) -> str:
        try:
            return self.templates[name]
        except KeyError as exc:
            raise KeyError(f"Prompt '{name}' is not defined") from exc


# ---------------------------------------------------------------------------
# LLM client
# ---------------------------------------------------------------------------


class LLMClient:
    """Minimal client for interacting with the LLM inference worker (llama.cpp / vLLM)."""

    def __init__(self, base_url: str) -> None:
        if not base_url:
            raise ValueError("LLM backend base URL must be provided")
        self.base_url = base_url.rstrip("/")

    def generate(
        self,
        prompt: str,
        *,
        max_tokens: int,
        temperature: float,
        top_p: float,
        stop: Optional[List[str]] = None,
        timeout: Optional[int] = None,
    ) -> str:
        if not prompt:
            return ""

        available = TOKEN_ESTIMATOR.remaining_completion_tokens(prompt)
        if available <= 16:
            LOGGER.error("Prompt exceeds LLM context window", {"estimated_prompt_tokens": TOKEN_ESTIMATOR.estimate(prompt)})
            return ""

        adjusted_max_tokens = min(max_tokens, available - 16)
        payload = {
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": adjusted_max_tokens,
            "temperature": temperature,
            "top_p": top_p,
        }
        if stop:
            payload["stop"] = stop

        try:
            response = requests.post(
                f"{self.base_url}/v1/chat/completions",
                json=payload,
                timeout=timeout or CONFIG.request_timeout,
                headers={"Content-Type": "application/json"},
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            LOGGER.error("LLM request failed", {"error": str(exc)})
            return ""

        data = response.json()
        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):  # pragma: no cover - depends on remote service
            LOGGER.error("LLM backend returned unexpected payload", {"payload": data})
            return ""

        return content or ""


# ---------------------------------------------------------------------------
# Chunking stage
# ---------------------------------------------------------------------------


@dataclass
class Chunk:
    text: str
    metadata: Dict[str, Any]


class TranscriptChunker:
    """Split transcripts into manageable overlapping chunks."""

    def __init__(self, config: PipelineConfig) -> None:
        self.config = config

    def chunk(self, text: str) -> List[Chunk]:
        token_length = TOKEN_ESTIMATOR.estimate(text)
        if token_length <= self.config.chunk_token_target:
            return [self._make_chunk(text, 0, len(text), token_length)]

        splits = self._candidate_split_positions(text)
        chunks: List[Chunk] = []
        start = 0
        chunk_id = 0

        while start < len(text) and chunk_id < self.config.max_chunks:
            target_end = start + self.config.tokens_to_chars(self.config.chunk_token_target)
            best_split = self._select_split(splits, start, target_end)
            best_split = min(best_split, len(text))

            overlap_chars = self.config.tokens_to_chars(self.config.chunk_token_overlap) if chunk_id else 0
            chunk_start = max(0, start - overlap_chars)
            chunk_text = text[chunk_start:best_split]
            chunk_tokens = TOKEN_ESTIMATOR.estimate(chunk_text)

            chunks.append(self._make_chunk(chunk_text, chunk_start, best_split, chunk_tokens, chunk_id))
            start = best_split
            chunk_id += 1

        LOGGER.info("Created transcript chunks", {"chunk_count": len(chunks), "total_tokens": token_length})
        return chunks

    def _candidate_split_positions(self, text: str) -> List[Tuple[int, int]]:
        positions: List[Tuple[int, int]] = []

        # Speaker changes get highest priority
        for match in re.finditer(r"\n\s*[A-Z][a-zA-Z\s]+:\s*", text):
            positions.append((match.start(), 100))

        # Paragraph boundaries
        current = 0
        for paragraph in text.split("\n\n")[:-1]:
            current += len(paragraph) + 2
            positions.append((current, 50))

        # Sentence boundaries via NLTK
        try:
            sentences = sent_tokenize(text)
        except Exception:  # pragma: no cover - NLTK fallback
            sentences = text.split(". ")

        offset = 0
        for sentence in sentences[:-1]:
            offset = text.find(sentence, offset)
            if offset == -1:
                continue
            positions.append((offset + len(sentence), 10))
            offset += len(sentence)

        positions.sort(key=lambda item: item[0])
        return positions

    def _select_split(self, positions: List[Tuple[int, int]], start: int, target_end: int) -> int:
        best_pos = target_end
        best_score = -1.0

        min_chars = self.config.tokens_to_chars(self.config.min_chunk_tokens)
        max_offset = self.config.tokens_to_chars(self.config.chunk_token_overlap)

        for pos, score in positions:
            if not (start + min_chars <= pos <= target_end + max_offset):
                continue
            distance = abs(pos - target_end)
            distance_penalty = distance / max(1, target_end - start)
            weighted = score * (1 - distance_penalty * 0.5)
            if weighted > best_score:
                best_score = weighted
                best_pos = pos

        return best_pos

    @staticmethod
    def _make_chunk(text: str, start: int, end: int, tokens: int, chunk_id: int = 0) -> Chunk:
        metadata = {
            "chunk_id": chunk_id,
            "start_char": start,
            "end_char": end,
            "token_estimate": tokens,
            "speaker_transition_count": len(re.findall(r"\n\s*[A-Z][a-zA-Z\s]+:\s*", text)),
            "timestamp_count": len(re.findall(r"\d{1,2}:\d{2}", text)),
        }
        return Chunk(text=text, metadata=metadata)


# ---------------------------------------------------------------------------
# Map stage (per chunk processing)
# ---------------------------------------------------------------------------


@dataclass
class ChunkAnalysis:
    chunk_id: int
    action_items: List[Dict[str, Any]]
    decisions: List[Dict[str, Any]]
    key_points: List[Dict[str, Any]]
    participants: List[str]
    topics: List[str]
    raw_text: str
    processing_time: float


class ChunkAnalyser:
    """Extract structured information from each chunk."""

    def __init__(self, client: LLMClient, prompts: PromptTemplates, base_prompt: str) -> None:
        self.client = client
        self.prompt_template = prompts.get("chunk_extraction")
        self.base_prompt = base_prompt.strip()

    def analyse(self, chunk: Chunk) -> ChunkAnalysis:
        start = time.monotonic()
        prompt = self.prompt_template.format(base_prompt=self.base_prompt, text=chunk.text)
        response = self.client.generate(
            prompt,
            max_tokens=CONFIG.completion_tokens,
            temperature=CONFIG.temperature_extract,
            top_p=CONFIG.top_p,
            stop=["</s>"],
            timeout=CONFIG.request_timeout,
        )

        structured = self._parse_response(response, chunk)
        duration = time.monotonic() - start
        return ChunkAnalysis(
            chunk_id=chunk.metadata["chunk_id"],
            action_items=structured.get("action_items", []),
            decisions=structured.get("decisions", []),
            key_points=structured.get("key_points", []),
            participants=structured.get("participants", []),
            topics=structured.get("topics", []),
            raw_text=response,
            processing_time=duration,
        )

    def _parse_response(self, response: str, chunk: Chunk) -> Dict[str, Any]:
        if not response:
            return {}

        cleaned = response.strip()
        fenced = re.match(r"```(?:json)?\s*(.*)```", cleaned, re.DOTALL | re.IGNORECASE)
        if fenced:
            cleaned = fenced.group(1).strip()

        json_match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        payload = json_match.group(0) if json_match else cleaned
        payload = re.sub(r",\s*([}\]])", r"\\1", payload)

        try:
            return json.loads(payload)
        except json.JSONDecodeError as exc:
            LOGGER.warning(
                "Chunk response JSON parse failure",
                {"chunk_id": chunk.metadata["chunk_id"], "error": str(exc)},
            )
            self._persist_raw_response(chunk, cleaned)
            return {}

    def _persist_raw_response(self, chunk: Chunk, response: str) -> None:
        try:
            _ensure_directory(CONFIG.log_response_dir)
            timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%S%f")
            path = CONFIG.log_response_dir / f"chunk_parse_error_{chunk.metadata['chunk_id']}_{timestamp}.txt"
            with path.open("w", encoding="utf-8") as handle:
                handle.write(response)
            LOGGER.info("Persisted raw chunk response for debugging", {"path": str(path)})
        except Exception as exc:  # pragma: no cover - debug helper
            LOGGER.warning("Failed to persist raw chunk response", {"error": str(exc)})


# ---------------------------------------------------------------------------
# Reduce stage
# ---------------------------------------------------------------------------


class Deduplicator:
    """Deduplicate structured items based on fuzzy similarity."""

    def __init__(self, threshold: float) -> None:
        self.threshold = threshold

    def deduplicate_items(self, items: Iterable[Dict[str, Any]], key: str) -> List[Dict[str, Any]]:
        unique: List[Dict[str, Any]] = []
        for item in items:
            text = item.get(key, "").strip().lower()
            if not text:
                continue

            if any(self._similar(text, existing.get(key, "")) for existing in unique):
                continue
            unique.append(item)
        return unique

    def deduplicate_strings(self, items: Iterable[str]) -> List[str]:
        unique: List[str] = []
        for item in items:
            value = item.strip()
            if not value:
                continue
            if any(self._similar(value, existing) for existing in unique):
                continue
            unique.append(value)
        return unique

    def _similar(self, left: str, right: str) -> bool:
        if not left or not right:
            return False
        return SequenceMatcher(None, left.lower(), right.lower()).ratio() >= self.threshold


@dataclass
class AggregatedResults:
    action_items: List[Dict[str, Any]]
    decisions: List[Dict[str, Any]]
    key_points: List[Dict[str, Any]]
    participants: List[str]
    topics: List[str]
    processing_stats: Dict[str, Any]


class ResultAggregator:
    """Merge chunk-level analyses into a consolidated structure."""

    def __init__(self, deduplicator: Deduplicator) -> None:
        self.deduplicator = deduplicator

    def aggregate(self, analyses: List[ChunkAnalysis]) -> AggregatedResults:
        all_action_items = [item for analysis in analyses for item in analysis.action_items]
        all_decisions = [item for analysis in analyses for item in analysis.decisions]
        all_key_points = [item for analysis in analyses for item in analysis.key_points]
        all_participants = [person for analysis in analyses for person in analysis.participants]
        all_topics = [topic for analysis in analyses for topic in analysis.topics]

        unique_action_items = self.deduplicator.deduplicate_items(all_action_items, "text")
        unique_decisions = self.deduplicator.deduplicate_items(all_decisions, "text")
        unique_key_points = self.deduplicator.deduplicate_items(all_key_points, "summary")
        unique_participants = self.deduplicator.deduplicate_strings(all_participants)
        unique_topics = self.deduplicator.deduplicate_strings(all_topics)

        stats = {
            "chunks_processed": len(analyses),
            "processing_time_seconds": sum(a.processing_time for a in analyses),
            "action_items_before_dedup": len(all_action_items),
            "action_items_after_dedup": len(unique_action_items),
        }

        return AggregatedResults(
            action_items=unique_action_items,
            decisions=unique_decisions,
            key_points=unique_key_points,
            participants=unique_participants,
            topics=unique_topics,
            processing_stats=stats,
        )


# ---------------------------------------------------------------------------
# Refine stage
# ---------------------------------------------------------------------------


class Refiner:
    """Optional final pass to produce a polished narrative."""

    def __init__(self, client: LLMClient, prompts: PromptTemplates, base_prompt: str) -> None:
        self.client = client
        self.prompt_template = prompts.get("refinement")
        self.base_prompt = base_prompt.strip()

    def refine(self, aggregated: AggregatedResults) -> str:
        structured_json = json.dumps(
            {
                "action_items": aggregated.action_items,
                "decisions": aggregated.decisions,
                "key_points": aggregated.key_points,
                "participants": aggregated.participants,
                "topics": aggregated.topics,
            },
            indent=2,
        )
        prompt = self.prompt_template.format(base_prompt=self.base_prompt, text=structured_json)
        response = self.client.generate(
            prompt,
            max_tokens=min(CONFIG.completion_tokens, 600),
            temperature=CONFIG.temperature_refine,
            top_p=CONFIG.top_p,
            stop=["</s>"],
            timeout=CONFIG.request_timeout,
        )
        return response.strip()


# ---------------------------------------------------------------------------
# Caching layer
# ---------------------------------------------------------------------------


class PipelineCache:
    """Optional Redis-backed cache for pipeline results."""

    def __init__(self, redis_client: Optional[redis.Redis], ttl_seconds: int) -> None:
        self.redis_client = redis_client
        self.ttl_seconds = ttl_seconds

    def _key(self, text: str, analysis_type: str) -> str:
        digest = sha256(text.encode("utf-8")).hexdigest()
        return f"chunking:{analysis_type}:{digest}"

    def get(self, text: str, analysis_type: str) -> Optional[Dict[str, Any]]:
        if not self.redis_client:
            return None
        try:
            payload = self.redis_client.get(self._key(text, analysis_type))
            if payload:
                LOGGER.info("Returning cached pipeline result")
                return json.loads(payload)
        except Exception as exc:  # pragma: no cover - defensive
            LOGGER.warning("Pipeline cache read failed", {"error": str(exc)})
        return None

    def set(self, text: str, analysis_type: str, result: Dict[str, Any]) -> None:
        if not self.redis_client:
            return
        try:
            self.redis_client.setex(self._key(text, analysis_type), self.ttl_seconds, json.dumps(result))
        except Exception as exc:  # pragma: no cover - defensive
            LOGGER.warning("Pipeline cache write failed", {"error": str(exc)})


# ---------------------------------------------------------------------------
# Pipeline facade
# ---------------------------------------------------------------------------


class ChunkingPipeline:
    """High-level orchestrator for the chunk-map-reduce-refine pipeline."""

    def __init__(
        self,
        *,
        chunker: TranscriptChunker,
        analyser: ChunkAnalyser,
        aggregator: ResultAggregator,
        refiner: Optional[Refiner],
        cache: PipelineCache,
    ) -> None:
        self.chunker = chunker
        self.analyser = analyser
        self.aggregator = aggregator
        self.refiner = refiner
        self.cache = cache

    def process(self, text: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        ctx = context or {}
        analysis_type = ctx.get("analysis_type", "full")

        # Prompts are required from context (DB-backed, supplied by summaries service)
        system_prompt = ctx.get("system_prompt", "")
        output_structure_raw = ctx.get("output_structure")

        if not system_prompt:
            raise ValueError("system_prompt is required in pipeline context")

        # Parse output_structure JSON
        extraction_template = ""
        refinement_template = ""
        if output_structure_raw:
            try:
                structure = (
                    json.loads(output_structure_raw)
                    if isinstance(output_structure_raw, str)
                    else output_structure_raw
                )
                extraction_template = structure.get("chunk_extraction", "")
                refinement_template = structure.get("refinement", "")
            except (json.JSONDecodeError, TypeError) as exc:
                raise ValueError(f"Failed to parse output_structure: {exc}") from exc

        if not extraction_template:
            raise ValueError("output_structure must contain a chunk_extraction template")

        # Build analyser and refiner from DB-supplied prompts
        analyser = _OverrideAnalyser(self.analyser.client, extraction_template, system_prompt)
        refiner = _OverrideRefiner(self.refiner.client, refinement_template, system_prompt) if self.refiner and refinement_template else None

        chunks = self.chunker.chunk(text)
        analyses = [analyser.analyse(chunk) for chunk in chunks]
        aggregated = self.aggregator.aggregate(analyses)

        narrative = refiner.refine(aggregated) if refiner else ""

        result = {
            "result": {
                "summary": narrative,
                "action_items": aggregated.action_items,
                "decisions": aggregated.decisions,
                "key_points": aggregated.key_points,
                "participants": aggregated.participants,
                "topics_discussed": aggregated.topics,
                "processing_stats": aggregated.processing_stats,
            },
            "result_is_text": False,
            "analysis_type": analysis_type,
            "backend": "llamacpp",
            "timestamp": time.time(),
        }

        return result


# ---------------------------------------------------------------------------
# Shared parsing helper
# ---------------------------------------------------------------------------


def _parse_chunk_response(response: str, chunk: Chunk) -> Dict[str, Any]:
    """Parse a chunk analysis response into structured data."""
    if not response:
        return {}
    cleaned = response.strip()
    fenced = re.match(r"```(?:json)?\s*(.*)```", cleaned, re.DOTALL | re.IGNORECASE)
    if fenced:
        cleaned = fenced.group(1).strip()
    json_match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    payload = json_match.group(0) if json_match else cleaned
    payload = re.sub(r",\s*([}\]])", r"\\1", payload)
    try:
        return json.loads(payload)
    except json.JSONDecodeError as exc:
        LOGGER.warning("Chunk response JSON parse failure", {"chunk_id": chunk.metadata["chunk_id"], "error": str(exc)})
        return {}


# ---------------------------------------------------------------------------
# Lightweight override helpers for custom prompt pass-through
# ---------------------------------------------------------------------------


class _OverrideAnalyser:
    """Drop-in replacement for ChunkAnalyser that uses caller-supplied templates."""

    def __init__(self, client: LLMClient, prompt_template: str, base_prompt: str) -> None:
        self.client = client
        self.prompt_template = prompt_template
        self.base_prompt = base_prompt.strip()

    def analyse(self, chunk: Chunk) -> ChunkAnalysis:
        start = time.monotonic()
        prompt = self.prompt_template.format(base_prompt=self.base_prompt, text=chunk.text)
        response = self.client.generate(
            prompt,
            max_tokens=CONFIG.completion_tokens,
            temperature=CONFIG.temperature_extract,
            top_p=CONFIG.top_p,
            stop=["</s>"],
            timeout=CONFIG.request_timeout,
        )

        structured = _parse_chunk_response(response, chunk)
        duration = time.monotonic() - start
        return ChunkAnalysis(
            chunk_id=chunk.metadata["chunk_id"],
            action_items=structured.get("action_items", []),
            decisions=structured.get("decisions", []),
            key_points=structured.get("key_points", []),
            participants=structured.get("participants", []),
            topics=structured.get("topics", []),
            raw_text=response,
            processing_time=duration,
        )


class _OverrideRefiner:
    """Drop-in replacement for Refiner that uses caller-supplied templates."""

    def __init__(self, client: LLMClient, prompt_template: str, base_prompt: str) -> None:
        self.client = client
        self.prompt_template = prompt_template
        self.base_prompt = base_prompt.strip()

    def refine(self, aggregated: AggregatedResults) -> str:
        structured_json = json.dumps(
            {
                "action_items": aggregated.action_items,
                "decisions": aggregated.decisions,
                "key_points": aggregated.key_points,
                "participants": aggregated.participants,
                "topics": aggregated.topics,
            },
            indent=2,
        )
        prompt = self.prompt_template.format(base_prompt=self.base_prompt, text=structured_json)
        response = self.client.generate(
            prompt,
            max_tokens=min(CONFIG.completion_tokens, 600),
            temperature=CONFIG.temperature_refine,
            top_p=CONFIG.top_p,
            stop=["</s>"],
            timeout=CONFIG.request_timeout,
        )
        return response.strip()


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def create_pipeline(
    model_instance: Any,
    model_backend: str,
    redis_client: Optional[redis.Redis] = None,
    vllm_url: Optional[str] = None,
) -> ChunkingPipeline:
    """Create a configured chunking pipeline.

    Parameters
    ----------
    model_instance:
        Unused placeholder to keep signature compatibility with legacy code.
    model_backend:
        Must be ``'vllm'`` or ``'llamacpp'``.
    redis_client:
        Optional redis client for caching.
    vllm_url:
        Base URL of the vLLM worker. Required when ``model_backend`` is ``'vllm'``.
    """

    if model_backend not in ("vllm", "llamacpp"):
        raise ValueError("The chunking pipeline only supports the vllm and llamacpp backends")
    if not vllm_url:
        raise ValueError("LLM backend URL must be provided for the chunking pipeline")

    # Prompt templates and base_prompt are now supplied per-request via
    # context dict, not at pipeline creation time.  We pass placeholder
    # objects here; the pipeline.process() method replaces them with the
    # real DB-backed prompts before running.
    client = LLMClient(vllm_url)
    chunker = TranscriptChunker(CONFIG)
    # Dummy prompts — overridden in process() from context
    placeholder_prompts = PromptTemplates(chunk_extraction="", refinement="")
    analyser = ChunkAnalyser(client, placeholder_prompts, "")
    deduplicator = Deduplicator(SIMILARITY_THRESHOLD)
    aggregator = ResultAggregator(deduplicator)
    refiner = Refiner(client, placeholder_prompts, "")
    cache = PipelineCache(redis_client if redis_client and redis else None, CONFIG.redis_ttl_seconds)

    return ChunkingPipeline(
        chunker=chunker,
        analyser=analyser,
        aggregator=aggregator,
        refiner=refiner,
        cache=cache,
    )

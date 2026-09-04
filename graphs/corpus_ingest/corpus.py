from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path

URL_RE = re.compile(r"https?://[^\s<>()\[\]]+", re.IGNORECASE)
DOI_RE = re.compile(r"10\.\d{4,9}/[-._;()/:A-Z0-9]+", re.IGNORECASE)
ARXIV_RE = re.compile(
    r"arxiv\.org/(?:abs|pdf|html)/(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?",
    re.IGNORECASE,
)
PMID_RE = re.compile(r"pubmed\.ncbi\.nlm\.nih\.gov/(\d+)", re.IGNORECASE)
PMCID_RE = re.compile(r"pmc\.ncbi\.nlm\.nih\.gov/articles/(PMC\d+)", re.IGNORECASE)
NATURE_RE = re.compile(r"nature\.com/articles/(s[\w.-]+)", re.IGNORECASE)

PAPER_HOSTS = {
    "annualreviews.org",
    "arxiv.org",
    "biorxiv.org",
    "cell.com",
    "doi.org",
    "frontiersin.org",
    "mdpi.com",
    "nature.com",
    "pmc.ncbi.nlm.nih.gov",
    "pubmed.ncbi.nlm.nih.gov",
    "pubs.aip.org",
    "science.org",
    "sciencedirect.com",
}


@dataclass(frozen=True)
class PaperSeed:
    source_lines: list[int]
    url: str
    title_hint: str | None
    doi: str | None
    arxiv_id: str | None
    pmid: str | None
    pmcid: str | None
    taste_score: float = 1.0


@dataclass(frozen=True)
class ParsedCorpus:
    papers: list[PaperSeed]
    expansion_sources: list[dict]


def _clean_url(value: str) -> str:
    return value.rstrip(".,;:!?'\"]}")


def _urls(text: str) -> list[str]:
    values = []
    for match in URL_RE.findall(text):
        url = _clean_url(match)
        if url not in values:
            values.append(url)
    return values


def _host(url: str) -> str:
    return (urllib.parse.urlparse(url).hostname or "").lower().removeprefix("www.")


def _clean_doi(value: str) -> str:
    cleaned = value.rstrip(".,;:!?'\"]}").rstrip(")").lower()
    if cleaned.startswith("10.1101/"):
        cleaned = re.sub(r"v\d+(?:\.full)?(?:\.pdf)?$", "", cleaned)
    return re.sub(r"/(?:full|abstract|pdf)$", "", cleaned)


def _identifiers(text: str, urls: list[str]) -> dict[str, str]:
    values: dict[str, str] = {}
    if match := DOI_RE.search(text):
        values["doi"] = _clean_doi(match.group(0))
    joined = " ".join(urls)
    if match := ARXIV_RE.search(joined):
        values["arxiv_id"] = match.group(1)
    if match := PMID_RE.search(joined):
        values["pmid"] = match.group(1)
    if match := PMCID_RE.search(joined):
        values["pmcid"] = match.group(1).upper()
    if match := NATURE_RE.search(joined):
        values.setdefault("doi", f"10.1038/{match.group(1).lower()}")
    return values


def _label(text: str, urls: list[str]) -> str | None:
    value = re.sub(r"^\s*[-*+]\s*", "", text.strip())
    value = re.sub(r"^\d+\.\s*", "", value)
    value = re.sub(r"\[([^]]+)]\([^)]+\)", r"\1", value)
    for url in urls:
        value = value.replace(url, " ")
    value = " ".join(value.split()).strip(" -:")
    return value or None


def _is_paper_url(url: str) -> bool:
    host = _host(url)
    return host in PAPER_HOSTS or any(host.endswith(f".{item}") for item in PAPER_HOSTS)


def _looks_like_title(value: str | None) -> bool:
    if not value:
        return False
    lowered = value.lower()
    if lowered.endswith((" lab", " papers")):
        return False
    return ":" in value or len(value.split()) >= 5


def _url_title(url: str) -> str | None:
    slug = (
        urllib.parse.unquote(urllib.parse.urlparse(url).path)
        .rstrip("/")
        .rsplit("/", 1)[-1]
    )
    words = slug.replace("_", "-").split("-")
    if len(words) < 4 or not all(re.fullmatch(r"[A-Za-z]+", word) for word in words):
        return None
    return " ".join(words)


def parse_markdown(path: str | Path) -> ParsedCorpus:
    raw_entries = []
    for line_number, raw in enumerate(Path(path).read_text().splitlines(), 1):
        text = re.sub(r"^\s*[-*+]\s*", "", raw.strip()).strip()
        if not text:
            continue
        urls = _urls(text)
        ids = _identifiers(text, urls)
        label = _label(text, urls)
        paper_urls = [url for url in urls if _is_paper_url(url)]
        raw_entries.append(
            {
                "line": line_number,
                "label": label,
                "urls": urls,
                "paper_urls": paper_urls,
                "identifiers": ids,
                "is_title": not urls and _looks_like_title(label),
            }
        )

    adjacent_titles = {}
    consumed_titles = set()
    for previous, current in pairwise(raw_entries):
        if (
            previous["paper_urls"]
            and not previous["label"]
            and current["is_title"]
            and current["line"] == previous["line"] + 1
        ):
            adjacent_titles[previous["line"]] = current
            consumed_titles.add(current["line"])

    papers = []
    expansion_sources = []
    for entry in raw_entries:
        if entry["line"] in consumed_titles:
            continue
        if entry["paper_urls"] or entry["identifiers"] or entry["is_title"]:
            title_entry = adjacent_titles.get(entry["line"])
            url = entry["paper_urls"][0] if entry["paper_urls"] else ""
            title = (
                title_entry["label"]
                if title_entry
                else entry["label"] or _url_title(url)
            )
            source_lines = [entry["line"]]
            if title_entry:
                source_lines.append(title_entry["line"])
            papers.append(
                PaperSeed(
                    source_lines=source_lines,
                    url=url,
                    title_hint=title,
                    doi=entry["identifiers"].get("doi"),
                    arxiv_id=entry["identifiers"].get("arxiv_id"),
                    pmid=entry["identifiers"].get("pmid"),
                    pmcid=entry["identifiers"].get("pmcid"),
                    taste_score=1.0 if url or entry["identifiers"] else 0.9,
                )
            )
        else:
            expansion_sources.append(
                {
                    "source_line": entry["line"],
                    "label": entry["label"],
                    "urls": entry["urls"],
                    "candidate_limit": 20,
                }
            )
    return ParsedCorpus(papers=papers, expansion_sources=expansion_sources)


class PaperResolver:
    def __init__(self, timeout: float = 15.0):
        self.timeout = timeout

    def _json(self, url: str) -> dict:
        for attempt in range(3):
            request = urllib.request.Request(
                url,
                headers={"User-Agent": "propagate-yourself corpus-ingest/0.1"},
            )
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    return json.load(response)
            except urllib.error.HTTPError as error:
                if error.code != 429 or attempt == 2:
                    raise
                time.sleep(float(error.headers.get("Retry-After") or attempt + 1))
        raise RuntimeError("unreachable retry state")

    def _openalex(self, *, field: str | None = None, value: str) -> dict | None:
        query = {"filter": f"{field}:{value}"} if field else {"search": value}
        query["per-page"] = 1
        params = urllib.parse.urlencode(query)
        results = (
            self._json(f"https://api.openalex.org/works?{params}").get("results") or []
        )
        return results[0] if results else None

    def _arxiv_title(self, arxiv_id: str) -> str | None:
        params = urllib.parse.urlencode({"id_list": arxiv_id})
        request = urllib.request.Request(
            f"https://export.arxiv.org/api/query?{params}",
            headers={"User-Agent": "propagate-yourself corpus-ingest/0.1"},
        )
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            root = ET.fromstring(response.read())
        namespace = "{http://www.w3.org/2005/Atom}"
        title = root.findtext(f"{namespace}entry/{namespace}title")
        return " ".join(title.split()) if title else None

    def _europe_pmc_doi(self, pmcid: str) -> str | None:
        params = urllib.parse.urlencode({"query": pmcid, "format": "json"})
        response = self._json(
            f"https://www.ebi.ac.uk/europepmc/webservices/rest/search?{params}"
        )
        results = (response.get("resultList") or {}).get("result") or []
        return results[0].get("doi") if results else None

    def _landing_metadata(self, url: str) -> tuple[str | None, str | None]:
        request = urllib.request.Request(
            url,
            headers={"User-Agent": "propagate-yourself corpus-ingest/0.1"},
        )
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            content = response.read(2_000_000).decode("utf-8", errors="replace")

        def meta(name: str) -> str | None:
            patterns = (
                rf'<meta[^>]+name=["\']{name}["\'][^>]+content=["\']([^"\']+)',
                rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']{name}["\']',
            )
            for pattern in patterns:
                if match := re.search(pattern, content, re.IGNORECASE):
                    return match.group(1).strip()
            return None

        return meta("citation_doi"), meta("citation_title")

    def resolve(self, seed: PaperSeed) -> tuple[dict | None, str | None]:
        try:
            work = None
            title = seed.title_hint
            if seed.doi:
                work = self._openalex(field="doi", value=f"https://doi.org/{seed.doi}")
            elif seed.pmid:
                work = self._openalex(field="pmid", value=seed.pmid)
            elif seed.pmcid:
                doi = self._europe_pmc_doi(seed.pmcid)
                work = (
                    self._openalex(field="doi", value=f"https://doi.org/{doi}")
                    if doi
                    else None
                )
            elif seed.arxiv_id:
                title = self._arxiv_title(seed.arxiv_id) or title
                work = self._openalex(value=title) if title else None
            if not work and seed.url:
                try:
                    landing_doi, landing_title = self._landing_metadata(seed.url)
                except OSError:
                    landing_doi, landing_title = None, None
                if landing_doi:
                    work = self._openalex(
                        field="doi", value=f"https://doi.org/{_clean_doi(landing_doi)}"
                    )
                title = landing_title or title
            if not work and title:
                work = self._openalex(value=title)
            if work:
                doi = work.get("doi")
                if isinstance(doi, str):
                    doi = doi.lower().removeprefix("https://doi.org/")
                resolved_title = work.get("display_name") or work.get("title")
                if not resolved_title:
                    return None, "resolved work has no title"
                url = f"https://doi.org/{doi}" if doi else seed.url
                if not url and seed.arxiv_id:
                    url = f"https://arxiv.org/abs/{seed.arxiv_id}"
                return {
                    "doi": doi,
                    "title": resolved_title,
                    "url": url,
                    "taste_score": seed.taste_score,
                }, None
            if title and seed.url:
                return {
                    "doi": seed.doi,
                    "title": title,
                    "url": seed.url,
                    "taste_score": seed.taste_score,
                }, None
            return None, "could not resolve a title and canonical URL"
        except (OSError, ValueError, ET.ParseError) as error:
            return None, f"{type(error).__name__}: {error}"


def ingest_corpus(
    source_path: str | Path,
    *,
    resolver: PaperResolver | None = None,
    max_workers: int = 4,
    timeout: float = 15.0,
) -> dict:
    parsed = parse_markdown(source_path)
    active_resolver = resolver or PaperResolver(timeout=timeout)

    def resolve(seed: PaperSeed) -> tuple[PaperSeed, dict | None, str | None]:
        paper, error = active_resolver.resolve(seed)
        return seed, paper, error

    with ThreadPoolExecutor(max_workers=max(1, max_workers)) as executor:
        resolved = list(executor.map(resolve, parsed.papers))

    papers_by_key = {}
    skipped = []
    for seed, paper, error in resolved:
        if not paper:
            skipped.append({"source_lines": seed.source_lines, "error": error})
            continue
        key = paper.get("doi") or paper["url"]
        current = papers_by_key.get(key)
        if current:
            current["taste_score"] = max(current["taste_score"], paper["taste_score"])
        else:
            papers_by_key[key] = paper
    papers = sorted(
        papers_by_key.values(), key=lambda item: item.get("doi") or item["url"]
    )
    return {
        "papers": papers,
        "skipped": skipped,
        "source_paper_count": len(parsed.papers),
        "expansion_source_count": len(parsed.expansion_sources),
    }

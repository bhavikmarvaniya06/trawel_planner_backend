import json
import sys
from pathlib import Path

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


DATA_PATH = Path(__file__).with_name("destinations.json")


def normalize_terms(values):
    return [str(value).strip().lower() for value in values if isinstance(value, str) and value.strip()]


def recommend(payload):
    destinations = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    interests = normalize_terms(payload.get("interests", []))
    saved_places = normalize_terms(payload.get("savedPlaces", []))
    history = payload.get("travelHistory", [])
    history_names = []
    history_interests = []
    for trip in history if isinstance(history, list) else []:
        if not isinstance(trip, dict):
            continue
        if isinstance(trip.get("destination"), str):
            history_names.append(trip["destination"].strip().lower())
        history_interests.extend(normalize_terms(trip.get("interests", [])))
    preferred_terms = interests + history_interests
    known_terms = saved_places + history_names
    days = payload.get("days", 3)
    try:
        days = max(1, min(30, int(days)))
    except (TypeError, ValueError):
        days = 3
    try:
        budget = float(payload.get("budget")) if payload.get("budget") is not None else None
        if budget is not None and budget <= 0:
            budget = None
    except (TypeError, ValueError):
        budget = None

    documents = [
        " ".join([
            destination["name"],
            destination["country"],
            destination["description"],
            " ".join(destination["interests"]),
            " ".join(destination["activities"]),
        ])
        for destination in destinations
    ]
    vectorizer = TfidfVectorizer(stop_words="english", ngram_range=(1, 2))
    destination_matrix = vectorizer.fit_transform(documents)
    profile = " ".join(preferred_terms + known_terms)
    similarity = (
        cosine_similarity(vectorizer.transform([profile]), destination_matrix)[0]
        if profile
        else [0.0] * len(destinations)
    )

    ranked = []
    for index, destination in enumerate(destinations):
        estimated_total = destination["dailyBudget"] * days
        budget_fit = 1.0
        if budget is not None:
            budget_fit = min(1.0, budget / max(estimated_total, 1))
            if estimated_total <= budget:
                budget_fit = 1.0
        relevance = float(similarity[index])
        popularity = destination["popularity"] / 10
        score = (0.72 * relevance + 0.2 * budget_fit + 0.08 * popularity) if profile else (0.65 * budget_fit + 0.35 * popularity)
        name = destination["name"].lower()
        if name in known_terms or any(name == term for term in saved_places):
            score -= 0.25
        reasons = []
        matched = [
            interest for interest in preferred_terms
            if interest in destination["interests"]
        ]
        if matched:
            reasons.append("Matches your interest in " + ", ".join(dict.fromkeys(matched[:3])))
        if budget is not None and estimated_total <= budget:
            reasons.append("Estimated daily costs fit your trip budget")
        if not reasons:
            reasons.append("A popular pick from our local destination guide")
        ranked.append({
            **destination,
            "estimatedTripBudget": estimated_total,
            "score": round(max(0.0, score), 4),
            "reason": ". ".join(reasons),
        })

    ranked.sort(key=lambda item: (item["score"], item["popularity"]), reverse=True)
    return {
        "recommendations": ranked[:8],
        "source": "content-based" if profile else "new-traveler-fallback",
        "profile": {
            "interests": list(dict.fromkeys(preferred_terms)),
            "savedPlaces": saved_places,
            "travelHistoryCount": len(history_names),
            "budget": budget,
            "days": days,
        },
    }


if __name__ == "__main__":
    try:
        incoming = json.load(sys.stdin)
        print(json.dumps(recommend(incoming), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        sys.exit(1)

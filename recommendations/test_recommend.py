import unittest

from recommend import recommend


class RecommendationTests(unittest.TestCase):
    def test_new_user_gets_fallback_recommendations(self):
        result = recommend({})
        self.assertEqual(result["source"], "new-traveler-fallback")
        self.assertGreaterEqual(len(result["recommendations"]), 5)
        self.assertIn("reason", result["recommendations"][0])

    def test_interest_budget_and_history_influence_results(self):
        result = recommend({
            "interests": ["beaches", "food"],
            "savedPlaces": ["Goa"],
            "travelHistory": [{"destination": "Mumbai", "interests": ["food", "culture"]}],
            "budget": 9000,
            "days": 3,
        })
        self.assertEqual(result["source"], "content-based")
        names = [item["name"] for item in result["recommendations"]]
        self.assertIn("Varkala", names)
        self.assertNotEqual(names[0], "Goa")
        self.assertLessEqual(len(result["recommendations"]), 8)
        self.assertTrue(all(item["estimatedTripBudget"] > 0 for item in result["recommendations"]))


if __name__ == "__main__":
    unittest.main()

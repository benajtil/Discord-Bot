// Replace roleId values with actual Discord role IDs. Keep staff roles on mode: 'approval'.
const DEFAULT_TASKS = [
  {
    id: "daily_chat",
    name: "Daily Community Chat",
    description: "Participate in normal conversation without spamming.",
    type: "message_count",
    period: "daily",
    target: 5,
    points: 5,
    verification: "auto",
    enabled: true,
  },
  {
    id: "weekly_chat",
    name: "Weekly Community Participation",
    description: "Reach the weekly message activity target.",
    type: "message_count",
    period: "weekly",
    target: 25,
    points: 20,
    verification: "auto",
    enabled: true,
  },
  {
    id: "event_helper",
    name: "Help With a Community Event",
    description:
      "Help staff run an event and submit a short description or proof link.",
    type: "contribution",
    period: "weekly",
    points: 30,
    verification: "staff",
    enabled: true,
  },
  {
    id: "community_helper",
    name: "Help a Community Member",
    description:
      "Provide useful help to another member; staff confirms the contribution.",
    type: "contribution",
    period: "weekly",
    points: 15,
    verification: "staff",
    enabled: true,
  },
  {
    id: "special_challenge",
    name: "Special Community Challenge",
    description: "Complete the currently announced special challenge.",
    type: "challenge",
    period: "lifetime",
    points: 50,
    verification: "staff",
    enabled: true,
  },
];

const DEFAULT_ROLE_TIERS = [
  { name: "Verified Member", points: 10, roleId: "", mode: "auto" },
  { name: "Trusted Member", points: 75, roleId: "", mode: "auto" },
  { name: "Event Helper", points: 150, roleId: "", mode: "auto" },
  { name: "Staff Candidate", points: 250, roleId: "", mode: "approval" },
];

module.exports = { DEFAULT_TASKS, DEFAULT_ROLE_TIERS };

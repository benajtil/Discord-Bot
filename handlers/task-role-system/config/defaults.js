// Replace roleId values with actual Discord role IDs.
// Keep staff-related roles on mode: "approval".

const DEFAULT_TASKS = [
  {
    id: "daily_chat",
    name: "Daily Community Chat",
    description:
      "Send 20 meaningful messages in the community throughout the day. Avoid spam and repetitive messages.",
    type: "message_count",
    period: "daily",
    target: 20,
    points: 10,
    verification: "auto",
    enabled: true,
  },
  {
    id: "weekly_chat",
    name: "Weekly Community Participation",
    description:
      "Reach 100 meaningful messages across the community within the week.",
    type: "message_count",
    period: "weekly",
    target: 100,
    points: 40,
    verification: "auto",
    enabled: true,
  },
  {
    id: "event_helper",
    name: "Community Event Helper",
    description:
      "Help organize or run a community event. Submit a short description or proof link for staff review.",
    type: "contribution",
    period: "weekly",
    points: 50,
    verification: "staff",
    enabled: true,
  },
  {
    id: "community_helper",
    name: "Helpful Community Member",
    description:
      "Help another member with a question, problem, or community activity. Staff must verify your contribution.",
    type: "contribution",
    period: "weekly",
    points: 25,
    verification: "staff",
    enabled: true,
  },
  {
    id: "special_challenge",
    name: "Special Community Challenge",
    description:
      "Complete a special challenge announced by the staff team. Submit proof for verification.",
    type: "challenge",
    period: "lifetime",
    points: 75,
    verification: "staff",
    enabled: true,
  },
];

const DEFAULT_ROLE_TIERS = [
  {
    name: "Community Member",
    points: 50,
    roleId: "1557984852563988514",
    mode: "auto",
  },
  {
    name: "Core Member",
    points: 200,
    roleId: "1561341954309095545",
    mode: "auto",
  },
  {
    name: "Event Helper",
    points: 400,
    roleId: "1561297404266020867",
    mode: "auto",
  },
  {
    name: "Staff Candidate",
    points: 700,
    roleId: "1565196993125687406",
    mode: "approval",
  },
];

module.exports = { DEFAULT_TASKS, DEFAULT_ROLE_TIERS };

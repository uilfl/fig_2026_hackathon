/**
 * Demo cases ("scenarios"). Every case has the same plan shape — budget split → (agent conflict) → place →
 * dates → non-refundable deposit + refundable booking + irreversible send — so the engine, map, commit card
 * and receipts work unchanged. A case only supplies content: nouns, options, agents, amounts.
 */
import type { ActionKey } from "./engine";

/** A step's place in the plan shape (the decision map's node keys). */
export type Role = "split" | "conflict" | "venue" | "dates" | "deposit" | "catering" | "invites";
export const ROLES: Role[] = ["split", "conflict", "venue", "dates", "deposit", "catering", "invites"];
export const isRole = (v: unknown): v is Role => typeof v === "string" && (ROLES as string[]).includes(v);

/** Which agent owns which part of the plan; display names come from the case. */
export type AgentRole = "budget" | "venue" | "invites";

/** A place the venue agent can pick. `meets` = satisfies the case's requirement (e.g. parking). */
export type PlaceOption = { name: string; cap: number; price: number; meets: boolean };

/** What a connected resource answers: the date, the case's requirement, or who the invites go to. */
export type ResourceKind = "calendar" | "requirements" | "guests";
export const RESOURCE_KINDS: ResourceKind[] = ["calendar", "requirements", "guests"];
/**
 * A source the user can connect (team calendar, brief, guest list). Ids carry the case id ("offsite.calendar"),
 * so one case's resources never answer another's. `value` = the calendar's open date; `evidence` = what it says.
 */
export type Resource = { id: string; kind: ResourceKind; name: string; evidence: string; value?: string };

export type Scenario = {
  id: string;
  title: string;
  blurb: string;
  /** Words in a free-text goal that suggest this case. */
  keywords: string[];
  /** Contract sentence: "{lead} {goal} for {headcount} {unit}." */
  sentence: { lead: string; unit: string };
  defaults: { goal: string; headcount: number; budget_cap: number };
  agents: Record<AgentRole, string>;
  /** One-line job description per agent (agent panel and cards). */
  jobs: Record<AgentRole, string>;
  /** Node titles on the map and receipts. */
  titles: Record<Role, string>;
  /** Timeline bar labels. */
  bars: Record<Role, string>;
  /** The thing the venue agent picks, as a lower-case noun ("venue"). */
  place: string;
  shares: string[];
  /** The Budget agent's usual split (an unchosen default). */
  sharePick: string;
  requirement: {
    /** Criterion key (rules are keyed by it). */
    key: string;
    label: string;
    /** Receipt row name. */
    short: string;
    /** Lower-case tag for option summaries ("parking" / "no parking"). */
    tag: string;
    /** Filter reason when an option lacks it. */
    missing: string;
  };
  fits: (cap: number) => string;
  capReason: (cap: number, need: number) => string;
  options: PlaceOption[];
  /** The Venue agent's favourite, which the Budget agent rejects when it's over the share (the conflict). */
  preference: string;
  preferenceShort: string;
  /** Short place name for compact map labels ("Lakeside Lodge" → "Lakeside"). */
  short: (name: string) => string;
  dates: { noun: string; options: string[]; label: string };
  deposit: { action: (place: string) => string; memo: (date: string) => string };
  booking: {
    action: string;
    options: [string, string];
    rejected: string;
    payee: string;
    amount: (headcount: number) => number;
    memo: (headcount: number) => string;
    cancelBy: string;
  };
  send: { action: string; label: (headcount: number) => string; option: (headcount: number) => string; subject: (place: string, date: string) => string };
  actionLabels: Record<ActionKey, string>;
  /** planPreview phrases: [does it on its own, stops before it]. */
  phrases: (p: { deposit: number; people: number }) => Record<ActionKey, [string, string]>;
  /** Resources the user can connect for this case, one per kind. */
  resources: Resource[];
  /** Who the Invites agent emails when no guest list is connected (its guess). */
  guessedRecipients: string;
};

const money = (n: number) => `$${n.toLocaleString()}`;

const offsite: Scenario = {
  id: "offsite",
  title: "Team offsite",
  blurb: "Two days away for the team: venue, catering, invites.",
  keywords: ["offsite", "retreat", "team trip", "off-site"],
  sentence: { lead: "Plan", unit: "people" },
  defaults: { goal: "Plan a two-day team offsite for 12 people", headcount: 12, budget_cap: 6000 },
  agents: { budget: "Budget agent", venue: "Venue agent", invites: "Invites agent" },
  jobs: { budget: "Splits the budget, pays the venue deposit and books catering.", venue: "Finds a venue that fits everyone and picks the dates.", invites: "Sends the calendar invites once everything is booked." },
  titles: { split: "Budget split", conflict: "Agents disagree", venue: "Venue", dates: "Dates", deposit: "Deposit", catering: "Catering", invites: "Invites" },
  bars: { split: "budget split", conflict: "disagreement", venue: "venue search", dates: "dates", deposit: "deposit", catering: "catering", invites: "invites" },
  place: "venue",
  shares: ["50%", "60%", "70%"],
  sharePick: "60%",
  requirement: { key: "require_parking", label: "Venues must have on-site parking", short: "Parking", tag: "parking", missing: "No on-site parking" },
  fits: (cap) => `fits ${cap}`,
  capReason: (cap, need) => `Fits ${cap}, need ${need}`,
  options: [
    { name: "Lakeside Lodge", cap: 20, price: 3200, meets: true },
    { name: "The Foundry Loft", cap: 16, price: 2600, meets: false },
    { name: "Cedar Hall", cap: 10, price: 1900, meets: true },
    { name: "Harbor House", cap: 14, price: 2400, meets: false },
    { name: "Ridgeview Inn", cap: 24, price: 5200, meets: true },
  ],
  preference: "Ridgeview Inn",
  preferenceShort: "Ridgeview",
  short: (name) => name.replace(/ (Lodge|Inn|Hall|House|Loft)$/, ""),
  dates: { noun: "dates", options: ["Mar 14–15", "Mar 21–22", "Apr 4–5"], label: "Book the earliest open weekend" },
  deposit: { action: (place) => `Pay venue deposit to ${place}`, memo: (date) => `50% deposit for ${date}, non-refundable` },
  booking: {
    action: "Reserve catering with Green Fork",
    options: ["Green Fork ($85/person)", "Basil & Co ($110/person)"],
    rejected: "Pricier for the same menu",
    payee: "Green Fork Catering",
    amount: (n) => n * 85,
    memo: (n) => `${n} × $85 lunch`,
    cancelBy: "Mar 7",
  },
  send: {
    action: "Send calendar invites",
    label: (n) => `Invite all ${n} people in your headcount`,
    option: (n) => `All ${n} people`,
    subject: (place, date) => `Team offsite at ${place}, ${date}`,
  },
  actionLabels: { plan: "Pick budget split, venue, dates", catering: "Reserve catering", deposit: "Pay venue deposit", invites: "Send invites" },
  phrases: ({ deposit, people }) => ({
    plan: ["pick the budget split, venue and dates", "before picking the venue and dates"],
    catering: ["book the caterer", "before booking the caterer"],
    deposit: [`pay the ${money(deposit)} deposit`, `for the ${money(deposit)} deposit`],
    invites: [`email ${people} people`, `before emailing ${people} people`],
  }),
  resources: [
    { id: "offsite.calendar", kind: "calendar", name: "Team calendar", value: "Mar 21–22", evidence: "3 of 12 people are away Mar 14–15" },
    { id: "offsite.requirements", kind: "requirements", name: "Offsite brief", evidence: "4 people drive in — on-site parking needed" },
    { id: "offsite.guests", kind: "guests", name: "Team roster", evidence: "12 named people with work emails" },
  ],
  guessedRecipients: "the team mailing list",
};

const dinner: Scenario = {
  id: "dinner",
  title: "Client dinner",
  blurb: "Dinner for a client team: a private room, wine, the invitation.",
  keywords: ["dinner", "client", "restaurant"],
  sentence: { lead: "Plan", unit: "guests" },
  defaults: { goal: "Host a client dinner for 8 guests", headcount: 8, budget_cap: 2500 },
  agents: { budget: "Budget agent", venue: "Restaurant agent", invites: "Invites agent" },
  jobs: { budget: "Splits the budget, pays the room deposit and orders the wine.", venue: "Finds a restaurant with room for everyone and picks the evening.", invites: "Sends the dinner invitation once everything is booked." },
  titles: { split: "Budget split", conflict: "Agents disagree", venue: "Restaurant", dates: "Date", deposit: "Deposit", catering: "Wine", invites: "Invitation" },
  bars: { split: "budget split", conflict: "disagreement", venue: "restaurant search", dates: "date", deposit: "deposit", catering: "wine", invites: "invitation" },
  place: "restaurant",
  shares: ["50%", "60%", "70%"],
  sharePick: "60%",
  requirement: { key: "require_private_room", label: "Restaurants must have a private room", short: "Private room", tag: "private room", missing: "No private room" },
  fits: (cap) => `seats ${cap}`,
  capReason: (cap, need) => `Seats ${cap}, need ${need}`,
  options: [
    { name: "Kaiseki Hana", cap: 6, price: 1100, meets: true },
    { name: "The Common Table", cap: 20, price: 700, meets: false },
    { name: "Osteria Nove", cap: 10, price: 900, meets: true },
    { name: "Harbor Grill", cap: 12, price: 1000, meets: false },
    { name: "Chef's Table at Lumen", cap: 10, price: 1800, meets: true },
  ],
  preference: "Chef's Table at Lumen",
  preferenceShort: "Lumen",
  short: (name) => name.replace(/^(The |Chef's Table at )/, ""),
  dates: { noun: "date", options: ["Thu Mar 12", "Fri Mar 13", "Tue Mar 17"], label: "Book the earliest open evening" },
  deposit: { action: (place) => `Pay room deposit to ${place}`, memo: (date) => `50% deposit for ${date}, non-refundable` },
  booking: {
    action: "Order wine pairing from Vino Select",
    options: ["Vino Select ($45/guest)", "Cellar Door ($70/guest)"],
    rejected: "Pricier for a similar pairing",
    payee: "Vino Select",
    amount: (n) => n * 45,
    memo: (n) => `${n} × $45 wine pairing`,
    cancelBy: "Mar 10",
  },
  send: {
    action: "Send the dinner invitation",
    label: (n) => `Invite all ${n} guests in your headcount`,
    option: (n) => `All ${n} guests`,
    subject: (place, date) => `Client dinner at ${place}, ${date}`,
  },
  actionLabels: { plan: "Pick budget split, restaurant, date", catering: "Order wine", deposit: "Pay room deposit", invites: "Send invitation" },
  phrases: ({ deposit, people }) => ({
    plan: ["pick the budget split, restaurant and date", "before picking the restaurant and date"],
    catering: ["order the wine", "before ordering the wine"],
    deposit: [`pay the ${money(deposit)} room deposit`, `for the ${money(deposit)} room deposit`],
    invites: [`email ${people} guests`, `before emailing ${people} guests`],
  }),
  resources: [
    { id: "dinner.calendar", kind: "calendar", name: "Client's calendar", value: "Fri Mar 13", evidence: "Thu Mar 12: client board meeting" },
    { id: "dinner.requirements", kind: "requirements", name: "Client brief", evidence: "They asked for a private room" },
    { id: "dinner.guests", kind: "guests", name: "Guest list", evidence: "8 confirmed guests from both teams" },
  ],
  guessedRecipients: "your recent client contacts",
};

export const SCENARIOS: Record<string, Scenario> = { offsite, dinner };
export const SCENARIO_LIST: Scenario[] = [offsite, dinner];
export const DEFAULT_SCENARIO = "offsite";

/** The case for an id; unknown or missing ids fall back to the offsite. */
export function scenarioOf(id: string | null | undefined): Scenario {
  return (id && SCENARIOS[id]) || offsite;
}

/** The case a run was planned under (stored on its rows). */
export const scenarioOfRows = (rows: { scenario?: string | null | undefined }[]) => scenarioOf(rows.find((r) => r.scenario)?.scenario);

/** Which agent role a display name belongs to in a case ("Cosign" and "You" are not agents). */
export function agentRole(s: Scenario, name: string): AgentRole | null {
  return (Object.keys(s.agents) as AgentRole[]).find((k) => s.agents[k] === name) ?? null;
}

/** A case's resource of a kind. */
export const resourceOf = (s: Scenario, kind: ResourceKind): Resource => s.resources.find((r) => r.kind === kind)!;

/** What a resource kind answers, in the case's words: "the dates", "the parking requirement", "who gets the invites". */
export function answersLabel(s: Scenario, kind: ResourceKind): string {
  if (kind === "calendar") return `the ${s.titles.dates.toLowerCase()}`;
  if (kind === "requirements") return `the ${s.requirement.short.toLowerCase()} requirement`;
  return `who gets the ${s.titles.invites.toLowerCase()}`;
}

/** "Venue agent" → "Venue". */
export const agentShort = (name: string) => name.replace(/ agent$/, "");

/** A speaker in the chat/Orchestra: "You", "Cosign", or an agent role — so renamed agents keep their colour and seat. */
export const slotOf = (s: Scenario, name: string): string => agentRole(s, name) ?? name;
/** Display name for a slot in a case. */
export const slotName = (s: Scenario, slot: string): string => (slot in s.agents ? s.agents[slot as AgentRole] : slot);
/** Avatar initials: "Budget agent" → "BUD", "Cosign" → "CS". */
export const initialsOf = (name: string) => (name === "Cosign" ? "CS" : name.slice(0, 3).toUpperCase());

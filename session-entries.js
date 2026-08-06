"use strict";
// Compaction-aware message reconstruction (plan F§5.3 / Phase 5.2).
//
// pi persists a session as a linked list of ENTRIES ({id, parentId, type, …}),
// not a flat message list. After compaction, flat `get_messages` returns only
// the post-compaction messages — earlier turns vanish and the transcript looks
// truncated. `get_entries` returns the FULL chain (including the compaction
// entry that summarizes the dropped context). activeSessionMessages() walks the
// parent-chain from the leaf (newest) to the root, reverses to chronological
// order, and maps each entry to its message(s):
//
//   message        → its {role, content} (identical shape to get_messages)
//   compaction     → a synthetic {role:"custom", customType:"compaction",
//                    content: summary} marker so the compacted span is visible
//   custom_message → its custom message (filtered to display:true only)
//   *              → everything else (model_change, thinking_level_change, …) is
//                    metadata, not conversation — dropped
//
// Then visible messages are filtered (user/assistant/toolResult always; custom
// only if display:true + a customType). Result is a drop-in replacement for
// get_messages' array that never looks truncated. Ported from pi-livecraft's
// server/session-snapshot.ts (activeSessionMessages / messageFromEntry).
//
// Pure CommonJS, no deps. Self-test:
//   node -e "const m=require('./session-entries.js').activeSessionMessages; console.log(m([{id:'a',type:'message',message:{role:'user',content:[]}}],'a').length)"

const VISIBLE_ROLE = new Set(["user", "assistant", "toolResult"]);

// Map one entry to zero or more messages. Public (tested) so the per-type shape
// contract is explicit.
function messageFromEntry(entry) {
	if (!entry || typeof entry !== "object") return [];
	if (entry.type === "message") {
		if (entry.message && typeof entry.message === "object") return [entry.message];
		return [];
	}
	if (entry.type === "compaction") {
		// summary is a markdown string (the compacted context). Rendered as a
		// custom/compaction marker by the client.
		if (typeof entry.summary === "string")
			return [
				{
					role: "custom",
					customType: "compaction",
					content: entry.summary,
					display: true,
					tokensBefore: typeof entry.tokensBefore === "number" ? entry.tokensBefore : null,
				},
			];
		return [];
	}
	if (entry.type === "custom_message") {
		if (typeof entry.customType !== "string") return [];
		return [
			{
				role: "custom",
				customType: entry.customType,
				content: entry.content,
				display: entry.display,
				details: entry.details,
			},
		];
	}
	return [];
}

// Walk the entry parent-chain from leafId → root, reverse to chronological, map
// to messages, filter to visible. leafId must be a string (get_entries returns
// it; absent/unknown → []). Cycle-safe (visited set — a malformed chain can't
// loop forever).
function activeSessionMessages(entries, leafId) {
	if (!Array.isArray(entries) || typeof leafId !== "string") return [];
	const byId = new Map();
	for (const e of entries) if (e && typeof e.id === "string") byId.set(e.id, e);
	const chain = [];
	const visited = new Set();
	let id = leafId;
	while (id && !visited.has(id)) {
		visited.add(id);
		const e = byId.get(id);
		if (!e) break; // parentId points at an entry not in the set (truncated fetch)
		chain.push(e);
		id = typeof e.parentId === "string" ? e.parentId : null;
	}
	// chronological (root → leaf), then flat-map entries to messages
	const msgs = [];
	for (let i = chain.length - 1; i >= 0; i--)
		for (const m of messageFromEntry(chain[i])) msgs.push(m);
	// keep only conversation-visible messages
	return msgs.filter(
		(m) =>
			VISIBLE_ROLE.has(m.role) ||
			(m.role === "custom" && m.display === true && typeof m.customType === "string"),
	);
}

module.exports = { activeSessionMessages, messageFromEntry, VISIBLE_ROLE };

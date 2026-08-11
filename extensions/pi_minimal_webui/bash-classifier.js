/**
 * bash-classifier.js — conservative compound-command classification.
 *
 * SDD run `permission-policy` C4 (FR-8..11). Pure zero-dep CommonJS. A bash
 * selector is split into subcommands on &&, ||, ;, |, &, and newlines; the
 * command's verdict is "readonly" only when EVERY subcommand is a recognized
 * read-only command AND there is no command substitution ($(…) / backticks),
 * no redirect (<, >, 2>, &>), no backgrounding, and no unquoted grouping
 * parens. Anything else is "mutate" — never auto-allowable. Rules then gate
 * per subcommand (FR-9): a readonly compound may be auto-allowed only when
 * every part matches an allow rule and no part matches a deny rule.
 */


/** Recon verbs — read-only by inspection, never mutate. */
const READONLY = new Set([
	"ls", "cat", "head", "tail", "less", "more", "grep", "egrep", "fgrep",
	"find", "wc", "sort", "uniq", "cut", "tr", "sed", "awk", "diff", "cmp",
	"file", "stat", "du", "df", "which", "whereis", "type", "pwd", "env",
	"printenv", "date", "whoami", "id", "hostname", "uname", "uptime", "echo",
]);

/** Version/help probes — read-only in effect (kept from the v1 allowlist). */
const PROBES = new Set([
	"node", "npm", "pnpm", "yarn", "python", "python3", "pip", "go", "rustc",
	"cargo", "git",
]);

/** git verbs that only inspect (FR-10 allowlist parity). */
const GIT_READONLY = new Set([
	"status", "log", "diff", "show", "blame", "ls-files",
]);

/**
 * Quote-aware scanner: splits the command into subcommand parts and flags
 * dangerous constructs. Single quotes are fully literal; inside double quotes
 * only $() / backticks still substitute; backslash escapes the next char.
 */
function scan(command) {
	const parts = [];
	const flags = { substitution: false, redirect: false, background: false, paren: false };
	const n = command.length;
	let cur = "";
	let i = 0;
	const push = () => {
		const t = cur.trim();
		if (t) parts.push(t);
		cur = "";
	};
	while (i < n) {
		const ch = command[i];
		if (ch === "'") {
			const end = command.indexOf("'", i + 1);
			cur += command.slice(i, (end < 0 ? n : end) + 1);
			i = end < 0 ? n : end + 1;
			continue;
		}
		if (ch === '"') {
			let j = i + 1;
			cur += '"';
			while (j < n && command[j] !== '"') {
				if (command[j] === "\\" && j + 1 < n) {
					cur += command.slice(j, j + 2);
					j += 2;
					continue;
				}
				if (command[j] === "$" && command[j + 1] === "(") flags.substitution = true;
				if (command[j] === "`") flags.substitution = true;
				cur += command[j];
				j++;
			}
			cur += '"';
			i = j < n ? j + 1 : n;
			continue;
		}
		if (ch === "`") {
			flags.substitution = true;
			const end = command.indexOf("`", i + 1);
			cur += command.slice(i, (end < 0 ? n : end) + 1);
			i = end < 0 ? n : end + 1;
			continue;
		}
		if (ch === "\\" && i + 1 < n) {
			cur += command.slice(i, i + 2);
			i += 2;
			continue;
		}
		if (ch === "$" && command[i + 1] === "(") {
			flags.substitution = true;
			cur += ch;
			i++;
			continue;
		}
		if (ch === ">" || ch === "<") {
			flags.redirect = true;
			cur += ch;
			i++;
			continue;
		}
		if (ch === "&" && command[i + 1] === "&") {
			push();
			i += 2;
			continue;
		}
		if (ch === "&") {
			flags.background = true;
			push();
			i++;
			continue;
		}
		if (ch === "|") {
			if (command[i + 1] === "|") {
				push();
				i += 2;
				continue;
			}
			push();
			i++;
			continue;
		}
		if (ch === ";" || ch === "\n") {
			push();
			i++;
			continue;
		}
		if (ch === "(" || ch === ")") flags.paren = true;
		cur += ch;
		i++;
	}
	push();
	return { parts, flags };
}

/** Strip leading `KEY=value ` env-assignment prefixes (they don't mutate). */
function stripEnv(part) {
	let p = part.trim();
	const re = /^[A-Za-z_][A-Za-z0-9_]*=[^\s]*\s+/;
	while (re.test(p)) p = p.replace(re, "");
	if (/^[A-Za-z_][A-Za-z0-9_]*=[^\s]*$/.test(p)) return ""; // bare assignment
	return p;
}

/** Is a single (already-split) subcommand read-only? */
function classifyPart(part) {
	const p = stripEnv(part);
	if (!p) return true; // bare env assignment — no side effects
	const toks = p.split(/\s+/);
	const cmd = toks[0] || "";
	if (cmd === "git") {
		const verb = toks[1] || "";
		if (verb === "--version" || verb === "-v" || verb === "--help") return true; // probe
		if (verb === "branch") return !toks[2] || toks[2] === "--show-current";
		if (verb === "remote") return !toks[2] || toks[2] === "-v";
		return GIT_READONLY.has(verb);
	}
	if (PROBES.has(cmd)) {
		return toks[1] === "--version" || toks[1] === "-v" || toks[1] === "--help";
	}
	return READONLY.has(cmd);
}

/**
 * FR-8 classification. Returns { verdict, parts:[{cmd, readonly}], flags }.
 * verdict "readonly" ⇔ every part read-only AND no substitution/redirect/
 * background/paren construct.
 */
function classify(command) {
	const { parts, flags } = scan(String(command ?? ""));
	const classified = parts.map((cmd) => ({ cmd, readonly: classifyPart(cmd) }));
	const verdict =
		parts.length > 0 &&
		classified.every((c) => c.readonly) &&
		!flags.substitution &&
		!flags.redirect &&
		!flags.background &&
		!flags.paren
			? "readonly"
			: "mutate";
	return { verdict, parts: classified, flags };
}

/** Human reason for a non-readonly verdict (feeds the ask banner). */
function reasonFor(c) {
	if (c.flags.substitution) return "command substitution";
	if (c.flags.redirect) return "redirect to/from a file";
	if (c.flags.background) return "backgrounded";
	if (c.flags.paren) return "command grouping";
	return c.parts.some((p) => !p.readonly)
		? `mutating command: ${c.parts.find((p) => !p.readonly).cmd}`
		: "not recognized as read-only";
}

/**
 * FR-9 gating: a readonly compound may be auto-allowed ONLY when every
 * subcommand resolves allow (injected engine resolve — rules match each part)
 * and no part resolves deny. Non-readonly commands are never auto-allowed
 * here (the caller falls back to the rule verdict on the whole command).
 * `isOutside(part)` (optional) marks subcommands whose path arguments escape
 * the workspace root — a command touching ANY outside path is never
 * auto-allowed (outside:true), so mode-induced bypasses (auto-approve /
 * read-only) can be blocked by the caller while yolo keeps its override.
 */
function gateBash(command, resolvePart, isOutside) {
	const c = classify(command);
	let outside = false;
	if (typeof isOutside === "function")
		for (const p of c.parts)
			if (isOutside(p.cmd)) {
				outside = true;
				break;
			}
	if (c.verdict !== "readonly") {
		return { allow: false, denied: false, outside, classify: c, reason: reasonFor(c) };
	}
	for (const p of c.parts) {
		const v = resolvePart(p.cmd);
		if (v && v.action === "deny") {
			return { allow: false, denied: true, outside, classify: c, reason: `deny rule on '${p.cmd}'` };
		}
		if (!v || v.action !== "allow") {
			return { allow: false, denied: false, outside, classify: c, reason: `no allow rule for '${p.cmd}'` };
		}
	}
	// FR-6 containment: outside-root paths force ask even for a fully
	// allow-ruled readonly compound (deny above still wins)
	if (outside) {
		return { allow: false, denied: false, outside: true, classify: c, reason: "path outside the workspace root" };
	}
	return { allow: true, denied: false, outside, classify: c, reason: "" };
}

/**
 * Path-like tokens in a part (after env-prefix stripping): the args that
 * claim a filesystem path — leading `.` `~` `/` `\`, a drive letter, or
 * `$HOME`/`$PWD`-prefixed. Pure: real-fs resolution (homedir expansion,
 * realpath, cwd join) is the caller's job — gateBash's injected isOutside.
 * ponytail: no shell parser — `$(…)`-built and `$VAR`-prefixed paths are
 * invisible by design (named ceiling; add a real parser if that matters).
 */
function partPathTokens(part) {
	const p = stripEnv(part);
	const toks = p.split(/\s+/).slice(1); // skip the verb
	const out = [];
	for (const t of toks) {
		const s = t.replace(/^['"]|['"]$/g, "").replace(/,$/, "");
		if (!s || s.startsWith("-")) continue;
		if (
			/^[./~\\]/.test(s) ||
			s.includes("/") ||
			s.includes("\\") ||
			/^[a-z]:/i.test(s) ||
			s.startsWith("$HOME") ||
			s.startsWith("$PWD")
		)
			out.push(s);
	}
	return out;
}

module.exports = { classify, gateBash, classifyPart, reasonFor, partPathTokens };

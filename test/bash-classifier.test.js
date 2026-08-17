// test/bash-classifier.test.js — compound-command classifier (SDD
// permission-policy C4: FR-8/FR-9/FR-11). FR-10's DEFAULT_CONFIG audits live
// in safeguard-contract.test.js (C5) where the config is actually changed.
// Zero-dep, `node test/bash-classifier.test.js`.
const assert = require("node:assert/strict");
const {
	classify,
	gateBash,
	classifyPart,
} = require("../extensions/pi_minimal_webui/bash-classifier.js");

let passed = 0;
const ok = (name) => {
	passed++;
	console.log("  ✓ " + name);
};

// ---- FR-8 — splitting + verdicts -------------------------------------------------

{
	const c = classify("git status && ls -la");
	assert.equal(c.parts.length, 2);
	assert.deepEqual(
		c.parts.map((p) => p.cmd),
		["git status", "ls -la"],
	);
	assert.equal(c.verdict, "readonly");
	const c2 = classify("git status; echo hi");
	assert.equal(c2.parts.length, 2);
	const c3 = classify("cat x | grep y");
	assert.equal(c3.verdict, "readonly");
	const c4 = classify("a || b");
	assert.equal(c4.parts.length, 2);
	ok("splits on && ; | || with per-part classification (# FR-8)");
}
{
	assert.equal(classify("git status").verdict, "readonly");
	assert.equal(classify("ls -la").verdict, "readonly");
	assert.equal(classify("cat src/a.ts").verdict, "readonly");
	assert.equal(classify("npm test").verdict, "mutate", "unknown verb → mutate");
	assert.equal(classify("node --version").verdict, "readonly", "probe");
	assert.equal(classify("git --version").verdict, "readonly", "git probe");
	ok("readonly verbs + probes readonly; unknown/exec verbs mutate (# FR-8)");
}
{
	assert.equal(
		classify("cat x > out.txt").verdict,
		"mutate",
		"output redirect",
	);
	assert.equal(classify("cat x >> out.txt").verdict, "mutate");
	assert.equal(
		classify("grep x < in.txt").verdict,
		"mutate",
		"input redirect (conservative)",
	);
	assert.equal(
		classify('echo "a && b"').verdict,
		"readonly",
		"quoted && is literal",
	);
	assert.equal(
		classify("echo 'x > y'").verdict,
		"readonly",
		"single-quoted redirect literal",
	);
	assert.equal(classify("cmd & wait").verdict, "mutate", "backgrounding");
	assert.equal(
		classify("git status\nls").verdict,
		"readonly",
		"newline splits",
	);
	assert.equal(classify("FOO=1 ls").verdict, "readonly", "env prefix ignored");
	assert.equal(classify("FOO=1").verdict, "readonly", "bare env assignment");
	ok(
		"substitution/redirect/background/grouping force mutate; quotes stay literal (# FR-8)",
	);
}
{
	assert.equal(
		classify("echo $(cat ~/.ssh/id_rsa)").verdict,
		"mutate",
		"$() substitution",
	);
	assert.equal(
		classify("echo `date`").verdict,
		"mutate",
		"backtick substitution",
	);
	assert.equal(
		classify('echo "$(whoami)"').verdict,
		"mutate",
		"double-quoted $() still substitutes",
	);
	assert.equal(classify("(cd /x && ls)").verdict, "mutate", "grouping parens");
	ok(
		"command substitution (incl. inside double quotes) and grouping → mutate (# FR-8)",
	);
}

// ---- FR-11 — regression locks (the three verified bypasses) ----------------------

{
	for (const cmd of [
		"git status && rm -rf ./src",
		"echo $(cat ~/.ssh/id_rsa)",
		"git remote remove origin",
	]) {
		const c = classify(cmd);
		assert.equal(c.verdict, "mutate", `must not be readonly: ${cmd}`);
	}
	ok(
		"the 3 roadmap bypasses are NOT readonly → never auto-allowable (# FR-11)",
	);
}
{
	// git verb details
	assert.equal(classify("git branch -D x").verdict, "mutate");
	assert.equal(classify("git branch --show-current").verdict, "readonly");
	assert.equal(classify("git remote -v").verdict, "readonly");
	assert.equal(classify("git remote add origin u").verdict, "mutate");
	assert.equal(classify("git add .").verdict, "mutate");
	assert.equal(classify("git commit -m x").verdict, "mutate");
	ok("git mutation verbs never classify readonly (# FR-11, FR-10 spirit)");
}

// ---- SEC-02a — argument-sensitive verbs drop out of the name-only set -----------

{
	for (const cmd of [
		"env rm -rf .",
		"find . -delete",
		"sed -i s/a/b/ f",
		"sort -o out f",
	]) {
		assert.equal(
			classify(cmd).verdict,
			"mutate",
			`argument-sensitive verb must not be name-only readonly: ${cmd}`,
		);
	}
	assert.equal(
		classify("awk 'BEGIN { system(\"touch pwn\") }'").verdict,
		"mutate",
		"awk with system() is mutate",
	);
	assert.equal(classify("ls -la").verdict, "readonly", "safe verbs unchanged");
	assert.equal(classify("cat src/a.ts").verdict, "readonly");
	ok(
		"env/find/sed/awk/sort classify mutate (SEC-02a review evidence) (# SEC-02a)",
	);
}
{
	assert.equal(classifyPart("git remote -v"), true, "plain -v still readonly");
	assert.equal(classifyPart("git remote remove origin"), false);
	assert.equal(
		classifyPart("git remote -v remove origin"),
		false,
		"flag before the mutating verb must not hide it",
	);
	assert.equal(classifyPart("git remote add origin u"), false);
	assert.equal(classifyPart("git status"), true, "unchanged");
	assert.equal(classify("git remote -v").verdict, "readonly");
	assert.equal(classify("git remote -v remove origin").verdict, "mutate");
	ok("git remote flag-skip: subcommand after flags decides (# SEC-02a)");
}

// ---- SEC-02a refinement — argument-aware read-only forms -----------------------
// The name-only demotion made every benign sed/find/sort/awk/env use prompt.
// Argument-level validation: the benign forms classify readonly again; every
// mutating form stays mutate (so no allow rule can carry it past the gate).

{
	// sed: benign print/stream forms
	for (const cmd of [
		"sed -n 1,5p server.js",
		"sed s/foo/bar/ file.txt",
		"sed -e 's/a/b/' -e 's/c/d/' f",
		"sed 1q f",
	])
		assert.equal(classify(cmd).verdict, "readonly", `benign sed: ${cmd}`);
	// sed: mutating forms stay mutate
	for (const cmd of [
		"sed -i s/a/b/ f",
		"sed -i.bak s/a/b/ f",
		"sed --in-place s/a/b/ f",
		"sed -ni s/a/b/ f",
		"sed -f script.sed f",
		"sed --file=script.sed f",
		"sed 'w /tmp/x' f",
		"sed '/^root/w /tmp/x' /etc/passwd",
		"sed '2w out.txt' f",
	])
		assert.equal(classify(cmd).verdict, "mutate", `mutating sed: ${cmd}`);
	ok(
		"sed: argument-aware (in-place/script-file/write-command mutate) (# SEC-02a)",
	);
}
{
	// find: search forms readonly; destructive primaries mutate
	for (const cmd of [
		"find . -name '*.md'",
		"find src -type f -newer ref.txt",
		"find / -maxdepth 2 -name x",
	])
		assert.equal(classify(cmd).verdict, "readonly", `benign find: ${cmd}`);
	for (const cmd of [
		"find . -delete",
		"find . -exec rm {} +",
		"find . -execdir rm {} \\;",
		"find . -ok rm {} \\;",
		"find . -fprint /tmp/list",
		"find . -fprintf /tmp/x %p",
		"find . -fls /tmp/x",
	])
		assert.equal(classify(cmd).verdict, "mutate", `mutating find: ${cmd}`);
	ok(
		"find: argument-aware (-delete/-exec*/-ok*/-fprint*/-fls mutate) (# SEC-02a)",
	);
}
{
	// sort: reading/sorting readonly; -o/--output mutate
	assert.equal(classify("sort package.json").verdict, "readonly");
	assert.equal(classify("sort -u f").verdict, "readonly");
	assert.equal(classify("sort -o out f").verdict, "mutate");
	assert.equal(classify("sort --output=out f").verdict, "mutate");
	ok("sort: argument-aware (-o/--output mutate) (# SEC-02a)");
}
{
	// awk: pure-print programs readonly; write/exec primitives mutate
	assert.equal(classify("awk '{print $1}' x.txt").verdict, "readonly");
	assert.equal(
		classify("awk -F: '{print $1}' /etc/passwd").verdict,
		"readonly",
	);
	assert.equal(
		classify("awk 'BEGIN { system(\"touch pwn\") }'").verdict,
		"mutate",
	);
	assert.equal(classify("awk '{print > \"o\"}' f").verdict, "mutate");
	assert.equal(classify("awk '{print | \"cmd\"}' f").verdict, "mutate");
	assert.equal(
		classify("awk 'BEGIN{while((\"ls\"|getline l)>0)print}'").verdict,
		"mutate",
	);
	// conservative: numeric comparison `>` in the program prompts, never allows
	assert.equal(classify("awk '$1 > 5' f").verdict, "mutate");
	ok(
		"awk: argument-aware (redirection/system/getline mutate; > comparison conservative) (# SEC-02a)",
	);
}
{
	// env: alone/assignments readonly; with a command, classify the command
	assert.equal(classify("env").verdict, "readonly");
	assert.equal(classify("env | grep FOO").verdict, "readonly");
	assert.equal(classify("env FOO=1 ls -la").verdict, "readonly");
	assert.equal(classify("env -i ls").verdict, "readonly");
	assert.equal(classify("env rm -rf .").verdict, "mutate");
	assert.equal(classify("env FOO=1 rm -rf .").verdict, "mutate");
	ok("env: alone/assignments readonly; env CMD classifies as CMD (# SEC-02a)");
}
{
	// review evidence stays locked (mutation can't ride the new rules)
	assert.equal(classify("env rm -rf .").verdict, "mutate");
	assert.equal(classify("find . -delete").verdict, "mutate");
	assert.equal(classify("sed -i s/a/b/ f").verdict, "mutate");
	assert.equal(classify("sort -o out f").verdict, "mutate");
	assert.equal(
		classify("awk 'BEGIN { system(\"touch pwn\") }'").verdict,
		"mutate",
	);
	ok("SEC-02a review evidence all still mutate (# SEC-02a)");
}

// ---- FR-9 — per-subcommand allow gating -------------------------------------------

{
	// both subcommands allow-ruled + readonly → allow
	const allowAll = () => ({ action: "allow" });
	const r1 = gateBash("git status && ls", allowAll);
	assert.equal(r1.allow, true);
	// one part not allow-ruled → ask (not auto-allowed)
	const r2 = gateBash("git status && npm test", (part) => ({
		action: part.startsWith("git") ? "allow" : "ask",
	}));
	assert.equal(r2.allow, false);
	assert.ok(r2.reason.includes("npm test"));
	// any part deny → deny reason (readonly compound reaches the per-part loop)
	const r3 = gateBash("git status && ls", (part) => ({
		action: part.startsWith("ls") ? "deny" : "allow",
	}));
	assert.equal(r3.allow, false);
	assert.ok(r3.reason.includes("deny"), "deny reason surfaced: " + r3.reason);
	// non-readonly compound → never allowed, reason names the mutating part
	const r4 = gateBash("npm test && rm -rf /", allowAll);
	assert.equal(r4.allow, false);
	assert.ok(
		r4.reason.includes("mutating command"),
		"mutating part named: " + r4.reason,
	);
	ok(
		"gateBash: readonly + every part allowed → allow; missing/deny part → blocked (# FR-9)",
	);
}

// ---- classifyPart micro-checks -------------------------------------------------------

{
	assert.equal(classifyPart("ls"), true);
	assert.equal(classifyPart("rm -rf /"), false);
	assert.equal(classifyPart("git remote -v"), true);
	assert.equal(classifyPart("git remote remove origin"), false);
	assert.equal(classifyPart(""), true);
	assert.equal(
		classifyPart("NODE_ENV=prod node server.js"),
		false,
		"node exec is mutate",
	);
	ok("classifyPart edge cases (# FR-8)");
}

// ---- FR-6 containment: path tokens + outside gating -------------------------

const {
	partPathTokens,
} = require("../extensions/pi_minimal_webui/bash-classifier.js");

{
	assert.deepEqual(partPathTokens("cat /etc/passwd"), ["/etc/passwd"]);
	assert.deepEqual(partPathTokens("ls ~/.ssh"), ["~/.ssh"]);
	assert.deepEqual(partPathTokens("git diff src/x.ts"), ["src/x.ts"]);
	assert.deepEqual(partPathTokens("cat ../secrets/x"), ["../secrets/x"]);
	assert.deepEqual(partPathTokens("npm install lodash"), []);
	assert.deepEqual(partPathTokens("git push origin main"), []);
	assert.deepEqual(partPathTokens("cat -n /etc/hosts"), ["/etc/hosts"]);
	assert.deepEqual(partPathTokens('echo "$HOME/x"'), ["$HOME/x"]);
	assert.deepEqual(partPathTokens("cd C:\\work\\repo"), ["C:\\work\\repo"]);
	assert.deepEqual(partPathTokens("NODE_ENV=prod node server.js"), []);
	ok("partPathTokens: path-like args only (flags/verbs/bare names skipped)");
}

{
	// `cd` compounds (seen live: agent habitually runs `cd <cwd> && …`).
	// cd classifies read-only (chdir never touches the disk), so an all-readonly
	// allow-ruled compound auto-allows — and the cd ARGUMENT stays containment-
	// checked by partPathTokens → isOutside.
	const CWD = "D:/work/repo";
	const inside = gateBash(
		`cd ${CWD} && git status`,
		() => ({ action: "allow" }),
		(part) => part.startsWith("cd /outside"),
	);
	assert.equal(inside.allow, true, "cd <cwd> && git status auto-allows");
	assert.equal(inside.outside, false);

	const out = gateBash(
		"cd /outside && ls",
		() => ({ action: "allow" }),
		(part) => part.startsWith("cd /outside"),
	);
	assert.equal(out.allow, false, "cd outside still asks");
	assert.equal(out.outside, true);

	const npm = gateBash(
		`cd ${CWD} && npm test`,
		() => ({ action: "allow" }),
		() => false,
	);
	assert.equal(npm.allow, false, "cd <cwd> && npm still asks (npm not readonly)");
	assert.ok(npm.classify.parts[1].readonly === false);

	assert.equal(classifyPart(`cd ${CWD}`), true, "bare cd classifies readonly");
	ok("cd compounds: allow inside, outside-flagged, non-readonly sibling asks");
}

{
	// fully allow-ruled readonly compound inside → auto-allowable
	const inside = gateBash(
		"cat src/x.txt",
		() => ({ action: "allow" }),
		() => false,
	);
	assert.equal(inside.allow, true);
	assert.equal(inside.outside, false);

	// any part outside → never auto-allowed, flagged outside
	const out = gateBash(
		"cat /etc/passwd",
		() => ({ action: "allow" }),
		() => true,
	);
	assert.equal(out.allow, false);
	assert.equal(out.outside, true);
	assert.ok(out.reason.includes("outside"));

	// deny still beats outside (both reported)
	const d = gateBash(
		"cat /etc/passwd",
		() => ({ action: "deny" }),
		() => true,
	);
	assert.equal(d.denied, true);
	assert.equal(d.outside, true);

	// mutate compounds carry the outside flag too (mode-bypass guard needs it)
	const m = gateBash(
		"rm -rf /tmp/x",
		() => ({ action: "ask" }),
		() => true,
	);
	assert.equal(m.allow, false);
	assert.equal(m.outside, true);

	// no isOutside callback → outside stays false (back-compat)
	const legacy = gateBash("cat /etc/passwd", () => ({ action: "allow" }));
	assert.equal(legacy.allow, true);
	assert.equal(legacy.outside, false);
	ok("gateBash: outside paths force ask; deny precedence; back-compat");
}

console.log(`\nbash-classifier.test.js — C4: ${passed} passed`);

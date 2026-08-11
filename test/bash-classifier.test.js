// test/bash-classifier.test.js — compound-command classifier (SDD
// permission-policy C4: FR-8/FR-9/FR-11). FR-10's DEFAULT_CONFIG audits live
// in safeguard-contract.test.js (C5) where the config is actually changed.
// Zero-dep, `node test/bash-classifier.test.js`.
const assert = require("node:assert/strict");
const { classify, gateBash, classifyPart } = require(
	"../extensions/pi_minimal_webui/bash-classifier.js",
);

let passed = 0;
const ok = (name) => {
	passed++;
	console.log("  ✓ " + name);
};

// ---- FR-8 — splitting + verdicts -------------------------------------------------

{
	const c = classify("git status && ls -la");
	assert.equal(c.parts.length, 2);
	assert.deepEqual(c.parts.map((p) => p.cmd), ["git status", "ls -la"]);
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
	assert.equal(classify("cat x > out.txt").verdict, "mutate", "output redirect");
	assert.equal(classify("cat x >> out.txt").verdict, "mutate");
	assert.equal(classify("grep x < in.txt").verdict, "mutate", "input redirect (conservative)");
	assert.equal(classify("echo \"a && b\"").verdict, "readonly", "quoted && is literal");
	assert.equal(classify("echo 'x > y'").verdict, "readonly", "single-quoted redirect literal");
	assert.equal(classify("cmd & wait").verdict, "mutate", "backgrounding");
	assert.equal(classify("git status\nls").verdict, "readonly", "newline splits");
	assert.equal(classify("FOO=1 ls").verdict, "readonly", "env prefix ignored");
	assert.equal(classify("FOO=1").verdict, "readonly", "bare env assignment");
	ok("substitution/redirect/background/grouping force mutate; quotes stay literal (# FR-8)");
}
{
	assert.equal(classify("echo $(cat ~/.ssh/id_rsa)").verdict, "mutate", "$() substitution");
	assert.equal(classify("echo `date`").verdict, "mutate", "backtick substitution");
	assert.equal(classify("echo \"$(whoami)\"").verdict, "mutate", "double-quoted $() still substitutes");
	assert.equal(classify("(cd /x && ls)").verdict, "mutate", "grouping parens");
	ok("command substitution (incl. inside double quotes) and grouping → mutate (# FR-8)");
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
	ok("the 3 roadmap bypasses are NOT readonly → never auto-allowable (# FR-11)");
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
	assert.ok(r4.reason.includes("mutating command"), "mutating part named: " + r4.reason);
	ok("gateBash: readonly + every part allowed → allow; missing/deny part → blocked (# FR-9)");
}

// ---- classifyPart micro-checks -------------------------------------------------------

{
	assert.equal(classifyPart("ls"), true);
	assert.equal(classifyPart("rm -rf /"), false);
	assert.equal(classifyPart("git remote -v"), true);
	assert.equal(classifyPart("git remote remove origin"), false);
	assert.equal(classifyPart(""), true);
	assert.equal(classifyPart("NODE_ENV=prod node server.js"), false, "node exec is mutate");
	ok("classifyPart edge cases (# FR-8)");
}

// ---- FR-6 containment: path tokens + outside gating -------------------------

const { partPathTokens } = require(
	"../extensions/pi_minimal_webui/bash-classifier.js",
);

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

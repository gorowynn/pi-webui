// Trust-boundary static contracts (SDD trust-boundary, U7):
// SEC-03 — the pi child never trusts project-local files (--approve is gone
//          from the built-in args; the bundled extension loads explicitly).
// SEC-07 — the webui IDE path renders the gate's offered options and degrades
//          gracefully when the broker rejects a decision. (Broker behavior is
//          unit-tested in broker.test.js; these lock the client wiring.)
// Source-audit style (same rationale as package.test.js): the spawn args and
// the IDE fallback are structural, cheap to assert, and drift-detecting.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const server = read("server.js");
const app = read("public/app.js");
const isolated = read("isolated-prompt.js");

let checks = 0;
const ok = (cond, msg) => {
	assert.ok(cond, msg);
	checks++;
	console.log(`  ✓ ${msg}`);
};

// ---- SEC-03: no project-local trust in the pi spawn ----
{
	// the bundled extension path is derived from the package root (__dirname),
	// never from PI_CWD / process.cwd() — a workspace switch can't redirect it
	ok(
		/BUNDLED_EXT\s*=\s*path\.join\(\s*__dirname/.test(server) &&
			!/(PI_CWD|process\.cwd\(\))[^;\n]*BUNDLED_EXT|BUNDLED_EXT[^;\n]*(PI_CWD|process\.cwd\(\))/.test(
				server,
			),
		"BUNDLED_EXT derives from __dirname (package root), not PI_CWD # SEC-03",
	);
	// the exists-branch spawns --no-approve plus the explicit -e load; the
	// missing-extension fallback stays --no-approve WITHOUT -e (fail toward
	// no-project-trust, never silently back to --approve)
	const extIf = server.match(
		/if \(fs\.existsSync\(BUNDLED_EXT\)\) \{([\s\S]*?)\} else \{([\s\S]*?)\}/,
	);
	assert.ok(extIf, "BUNDLED_EXT existsSync branch found in server.js");
	ok(
		extIf[1].includes('"--no-approve"') && extIf[1].includes('"-e"'),
		'exists-branch spawns --no-approve with an explicit "-e" bundled-extension load # SEC-03',
	);
	ok(
		extIf[2].includes('"--no-approve"') && !extIf[2].includes('"-e"'),
		"missing-extension fallback stays --no-approve without -e # SEC-03",
	);
	// no unconditional --approve token (only a documented PI_ARGS override may
	// reintroduce trust); PI_ARGS stays the LAST spread so the override wins
	ok(
		!server.includes('"--approve"') && !server.includes("'--approve'"),
		'no unconditional "--approve" in server.js args # SEC-03',
	);
	ok(
		server.indexOf("...PI_ARGS") > server.indexOf('"--no-approve"'),
		"PI_ARGS is appended after the built-in trust flags (explicit --approve override still wins) # SEC-03",
	);
	// the degraded-mode warning exists (missing bundled extension is loud)
	ok(
		/existsSync\(BUNDLED_EXT\)/.test(server) && /console\.error/.test(server),
		"missing bundled extension logs a loud warning # SEC-03",
	);
	// isolated runner keeps full extension discovery off (regression lock)
	ok(
		isolated.includes('"--no-extensions"'),
		"isolated-prompt keeps --no-extensions # SEC-03",
	);
}

// ---- SEC-07: IDE path renders the gate's options + degrades gracefully ----
{
	const diffFn = app.match(/async function diffInIde\(req\) \{[\s\S]*?\n\}/);
	assert.ok(diffFn, "diffInIde found in app.js");
	const body = diffFn[0];
	// the payload carries the offered option labels so the IDE renders only those
	const payloadFn = app.match(
		/async function buildDiffPayload\(\) \{[\s\S]*?\n\}/,
	);
	assert.ok(payloadFn, "buildDiffPayload found in app.js");
	ok(
		/pendingApproval/.test(payloadFn[0]) &&
			/options\s*:/.test(payloadFn[0]) &&
			/typeof o === "string" \? o : o && o\.label/.test(payloadFn[0]),
		"buildDiffPayload sends the offered option labels (options) # SEC-07",
	);
	// the response is awaited and inspected inside the try
	ok(
		/await api\(body\)/.test(body) && /j\.ok === false/.test(body),
		"diffInIde awaits the broker response and inspects ok/error # SEC-07",
	);
	// invalid-option → reopen the webui select modal (record still pending)
	const invalidBranch = body.match(
		/invalid-option"?[\s\S]{0,200}?openSelectModal\(req\)/,
	);
	ok(!!invalidBranch, "invalid-option reopens openSelectModal(req) # SEC-07");
	// answered-elsewhere (unknown/resolved) → toast only, NO second modal
	const answeredElsewhere = body.match(
		/else \{[\s\S]{0,200}?toast\([\s\S]{0,200}?\}/,
	);
	ok(
		!!answeredElsewhere && !/openSelectModal/.test(answeredElsewhere[0]),
		"answered-elsewhere branches toast without reopening the modal # SEC-07",
	);
	// the send itself is inside the try (rejection still hits the modal fallback)
	const sendAt = body.indexOf("await api(body)");
	ok(
		sendAt > body.indexOf("try {") && sendAt < body.indexOf("} catch"),
		"awaited send sits inside the existing try (rejection → modal fallback) # SEC-07",
	);
}

console.log(`trust-boundary.test.js — ${checks} checks passed`);

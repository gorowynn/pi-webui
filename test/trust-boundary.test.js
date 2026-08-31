// Trust-boundary static contracts (SDD trust-boundary, U7):
// SEC-03 — the SDK runtime never trusts project-local extensions/settings; the
//          package-owned bridge extension is loaded explicitly.
// SEC-07 — the webui IDE path renders the gate's offered options and degrades
//          gracefully when the broker rejects a decision. (Broker behavior is
//          unit-tested in broker.test.js; these lock the client wiring.)
// Source-audit style (same rationale as package.test.js): these resource-loader
// options and the IDE fallback are structural, cheap to assert, and drift-safe.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const server = read("server.js");
const sdkRuntime = read("pi-sdk-runtime.js");
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
		/bundledExtension\s*=\s*path\.join\(\s*__dirname/.test(server) &&
			!/(PI_CWD|process\.cwd\(\))[^;\n]*BUNDLED_EXT|BUNDLED_EXT[^;\n]*(PI_CWD|process\.cwd\(\))/.test(
				server,
			),
		"bundled extension derives from __dirname (package root), not PI_CWD # SEC-03",
	);
	// Settings are explicitly untrusted and only the package-owned extension is
	// passed as an additional extension path.
	ok(
		/const additionalExtensionPaths = existingExtensionPaths\(bundledExtension\)/.test(sdkRuntime) &&
		/noExtensions:\s*true/.test(sdkRuntime),
		"SDK loader receives only the bundled extension path # SEC-03",
	);
	ok(
		/SettingsManager\.create\([\s\S]*?projectTrusted:\s*false/.test(sdkRuntime),
		"SDK settings keep project trust disabled # SEC-03",
	);
	ok(
		!server.includes("PI_BIN") && !server.includes("PI_ARGS"),
		"server no longer depends on CLI binary/argument overrides # SEC-03",
	);
	ok(
		/existsSync\(bundledExtension\)/.test(server) && /console\.error/.test(server),
		"missing bundled extension logs a loud warning # SEC-03",
	);
	ok(
		isolated.includes("noExtensions: true") && isolated.includes("noTools: \"all\""),
		"isolated-prompt keeps SDK extension/tool isolation # SEC-03",
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

// tool-presentation.js HTML sanitizer tests (plan 2.4 / R§2.4)
// stripScripts is defense-in-depth (the primary defense is sandbox=""). Still
// verify it strips the obvious vectors. node test/html-sanitizer.test.js
const assert = require("assert/strict");
const { stripScripts } = require("../public/tool-presentation.js");

let pass = 0;
function ok(name, cond) {
	if (!cond) throw new Error("FAIL: " + name);
	pass++;
	console.log("  ✓ " + name);
}
function stripped(name, input) {
	const out = stripScripts(input);
	ok(name + " — no <script", !/<script/i.test(out));
	ok(name + " — no </script", !/<\/script/i.test(out));
}

// 1. inline <script>...</script>
stripped("inline script", '<p>hi</p><script>alert(1)</script>');

// 2. script with attributes
stripped("script attrs", '<script type="text/javascript" src="x.js">bad()</script>');

// 3. self-closing <script/>
stripped("self-closing script", '<img src="a"><script/>more');

// 4. script with content before close tag across lines
stripped("multiline script", '<script>\nvar x = "</script>";\nalert(x)\n</script>');

// 5. orphan </script>
ok("orphan close removed", !/<\/script/i.test(stripScripts("<div>x</div></script>")));

// 6. on* event handlers
{
	const out = stripScripts('<img src="a" onload="alert(1)" onclick="x()">');
	ok("onload removed", !/onload/i.test(out));
	ok("onclick removed", !/onclick/i.test(out));
	ok("img kept", /<img/i.test(out));
}

// 7. javascript: URLs in href/src
{
	const out = stripScripts(
		'<a href="javascript:alert(1)">x</a><img src="javascript:alert(2)">',
	);
	ok("js href removed", !/javascript:/i.test(out));
}

// 8. single-quoted javascript: URL
{
	const out = stripScripts("<a href='javascript:alert(1)'>x</a>");
	ok("single-quote js href removed", !/javascript:/i.test(out));
}

// 9. legitimate HTML preserved
{
	const out = stripScripts('<h1>Title</h1><p>Hello <b>world</b></p>');
	ok("legit kept", out.includes("<h1>Title</h1>") && out.includes("<b>world</b>"));
}

// 10. on* with namespaced-ish names (onfoo:bar)
{
	const out = stripScripts('<div onfoo:bar="x()">y</div>');
	ok("namespaced on removed", !/onfoo/i.test(out));
}

// 11. formaction / poster vectors
{
	const out = stripScripts(
		'<form><button formaction="javascript:alert(1)">go</button></form>',
	);
	ok("formaction js removed", !/javascript:/i.test(out));
}

console.log("\n" + pass + " passed");

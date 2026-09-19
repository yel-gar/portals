/* Dev-time build: compiles shared/app.js (JSX) into shared/app.compiled.js (plain JS).

   Why: mock theme pages are opened straight from the filesystem (file://). Babel's
   standalone loader fetches `<script type="text/babel" src="...">` over XHR, and
   browsers block XHR on file:// URLs (CORS: request not http) — so the themes
   rendered blank when opened by double-click. A precompiled plain-JS renderer is
   loaded with a normal <script src> tag, which works fine from file://.

   Usage (once, from frontend/mockups/):
     npm i --no-save @babel/standalone
     node build.js
*/

const fs = require("fs");
const path = require("path");
const Babel = require("@babel/standalone");

const root = __dirname;
const src = fs.readFileSync(path.join(root, "shared", "app.js"), "utf8");

const result = Babel.transform(src, {
  presets: ["react"],
  sourceMaps: false,
  comments: true,
  compact: false
});

const banner = [
  "/* " + "=".repeat(70) + " */",
  "/* GENERATED FILE — do not edit directly.                               */",
  "/* Source: shared/app.js (JSX). Rebuild with `node build.js` in this dir. */",
  "/* " + "=".repeat(70) + " */",
  ""
].join("\n");

fs.writeFileSync(path.join(root, "shared", "app.compiled.js"), banner + result.code);
console.log("compiled OK:", result.code.length, "chars ->", path.join("shared", "app.compiled.js"));

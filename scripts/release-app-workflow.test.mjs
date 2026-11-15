// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Guards the security properties of the npm publish in release-app.yml
// (npm-package.md §4.10) so an edit can't quietly drop one.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

const path = new URL("../.github/workflows/release-app.yml", import.meta.url);
const text = readFileSync(path, "utf8");
const workflow = parse(text);
const { build, publish } = workflow.jobs;
const runs = (job) => job.steps.map((step) => step.run ?? "");
const indexOfRun = (job, pattern) => runs(job).findIndex((run) => pattern.test(run));
const usesStep = (job, prefix) => job.steps.find((s) => s.uses?.startsWith(prefix));

test("two jobs: build then publish", () => {
  assert.deepEqual(Object.keys(workflow.jobs), ["build", "publish"]);
  assert.equal(publish.needs, "build");
});

test("build is read-only and keeps no credentials", () => {
  assert.deepEqual(build.permissions, { contents: "read" });
  assert.equal(usesStep(build, "actions/checkout@").with["persist-credentials"], false);
  assert.equal(build.environment, undefined);
});

test("build keeps the audit gate, then packs, checksums, smokes and dry-runs", () => {
  assert.ok(indexOfRun(build, /npm audit --omit=dev --audit-level=high/) >= 0);
  const pack = indexOfRun(build, /npm pack --workspace=packages\/cli/);
  const sum = indexOfRun(build, /sha256sum/);
  const smoke = indexOfRun(build, /smoke:npm-package -- --tarball/);
  const dry = indexOfRun(build, /npm publish --dry-run/);
  assert.ok(pack >= 0 && sum > pack && smoke > pack && dry > pack);
});

test("publish runs in the release environment with OIDC and a scoped write", () => {
  assert.equal(publish.environment, "release");
  assert.deepEqual(publish.permissions, { contents: "write", "id-token": "write" });
});

test("no npm token or secret anywhere", () => {
  assert.doesNotMatch(text, /NODE_AUTH_TOKEN|NPM_TOKEN|secrets\./);
});

test("npm is pinned exactly at 11.5.1 or later", () => {
  const install = runs(publish).find((run) => /npm install -g npm@/.test(run));
  assert.ok(install, "publish installs npm");
  const [, version] = /npm install -g npm@(\S+)/.exec(install);
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  assert.ok(match, `exact version, got ${version}`);
  const [major, minor, patch] = match.slice(1).map(Number);
  assert.ok(major > 11 || (major === 11 && (minor > 5 || (minor === 5 && patch >= 1))));
});

test("the dry run and the publish use the same npm", () => {
  const pin = (job) => runs(job).map((r) => /npm install -g npm@(\S+)/.exec(r)?.[1]).find(Boolean);
  assert.equal(pin(build), pin(publish));
});

test("publish uses Node 22 and the npm registry", () => {
  const node = usesStep(publish, "actions/setup-node@");
  assert.equal(node.with["node-version"], 22);
  assert.equal(node.with["registry-url"], "https://registry.npmjs.org");
});

test("the checksum and the maintainer list are checked before the publish", () => {
  const sha = indexOfRun(publish, /verify-sha256\.mjs/);
  const maintainers = indexOfRun(publish, /check-npm-maintainers\.mjs/);
  const npmPublish = indexOfRun(publish, /npm publish "\$TARBALL"/);
  assert.ok(sha >= 0 && maintainers >= 0 && npmPublish >= 0);
  assert.ok(sha < npmPublish && maintainers < npmPublish);
});

test("npm publish takes the downloaded tarball, publicly", () => {
  const download = usesStep(publish, "actions/download-artifact@");
  assert.ok(download);
  const step = publish.steps.find((s) => /npm publish "\$TARBALL"/.test(s.run ?? ""));
  assert.match(step.run, /--access public/);
  assert.match(publish.env.TARBALL, /^\.\/.*needs\.build\.outputs\.tarball/); // `./`: a bare path reads as a GitHub shorthand
});

test("the release attaches the tarball and verifies the tag", () => {
  const run = runs(publish)[indexOfRun(publish, /gh release create/)];
  assert.match(run, /"\$TARBALL"/);
  assert.match(run, /--verify-tag/);
});

test("a manual dispatch is a dry run: build only, publish never", () => {
  assert.ok("workflow_dispatch" in workflow.on);
  assert.deepEqual(workflow.on.push.tags, ["app-v*"]);
  assert.match(publish.if, /event_name == 'push'/);
  assert.match(publish.if, /startsWith\(github\.ref, 'refs\/tags\/app-v'\)/);
  assert.equal(build.if, undefined);
});

test("the version check still runs on a dispatch, with the tag taken from package.json", () => {
  const check = build.steps.find((s) => s.id === "check");
  assert.match(check.run, /workflow_dispatch/);
  assert.match(check.run, /release-check\.mts "\$TAG" app-v package\.json --also packages\/cli\/package\.json/);
});

test("third-party actions are pinned to a commit SHA", () => {
  for (const job of [build, publish]) {
    for (const step of job.steps) {
      if (step.uses) assert.match(step.uses, /@[0-9a-f]{40}$/, step.uses);
    }
  }
});

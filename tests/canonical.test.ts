import assert from "node:assert/strict";
import test from "node:test";
import { ASTER_CANONICALIZATION, ASTER_INTEGRITY_ENCODING, canonicalJson, sha256Hex } from "../packages/core/src/canonical.ts";

test("AT-AST-027 publishes stable ASTER Canonical JSON v1 vectors", () => {
  assert.equal(ASTER_CANONICALIZATION, "aster-canonical-json/1");
  assert.equal(ASTER_INTEGRITY_ENCODING, "utf-8");
  assert.equal(
    canonicalJson({ z: true, a: [false, { y: "snow", x: "雪" }], omitted: undefined }),
    '{"a":[false,{"x":"雪","y":"snow"}],"z":true}'
  );
  assert.equal(
    sha256Hex(canonicalJson({ z: true, a: [false, { y: "snow", x: "雪" }], omitted: undefined })),
    "907dfec09191c6a5d61cb48086165b2680253b46749d813f89f23a192233458a"
  );
});

import { syncAfterInstallCases } from "@wirecat/cli-core/testing"
import { describe, it } from "vitest"
import { seededCrm } from "./testing/fake-crm.js"
import { b24 } from "./testing/harness.js"

describe("sync runs right after install, whatever the shared WireCat config holds", () => {
  for (const one of syncAfterInstallCases({
    sync: ["work", "sync"],
    run: (argv, env) => b24(argv, { portal: seededCrm(), env }),
  }))
    it(one.name, () => one.run())
})

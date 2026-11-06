import { failureContext } from "@wirecat/cli-core/cli"
import { expect, it } from "vitest"
import { DETAILS, REASONS } from "./reasons.js"

it("b24's reasons load beside cli-core's without a duplicate", () => {
  expect(() => failureContext({ reasons: REASONS, details: DETAILS })).not.toThrow()
  expect(REASONS.map((one) => one.reason)).toContain("deal.ambiguous")
})

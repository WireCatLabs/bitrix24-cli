### Fixed

- **Recordings your telephony provider keeps.** A portal that works with an outside telephony provider, such as a
  Beeline cloud PBX, links each recording to the provider's server. b24 refused such a link, so `meetings transcribe`
  turned none of these calls into text. It now follows the link over https to an address on the public internet,
  never to this computer or a local network, and sends nothing of your Bitrix24 sign-in with it. See
  [Calls](../docs/calls.md#recordings).
- **`meetings transcribe --max-meetings` counts calls with a recording.** A call with no recording on the portal is
  still listed under `failed`, but it no longer uses up the limit. Before, when the newest calls had no recording,
  `--max-meetings 1` turned nothing into text.

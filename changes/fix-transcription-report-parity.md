### Changed — may break callers

- **`meetings transcribe` answers the same report as beeline.** The audio time is `audio_ms`, in milliseconds (was
  `audio_seconds`). Each failed call has its `ref`. A call with no recording on the portal is listed under `failed`
  with the reason `recording.missing`, and `without_recording` is gone. Before, the two CLIs answered two shapes for
  the same `call_transcription_report`, and the family audit stopped beeline's pull requests.

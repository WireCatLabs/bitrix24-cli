### Fixed

- **A recording sent with no audio type.** A telephony provider's server, such as a Beeline cloud PBX, sends a
  recording as `application/octet-stream` and names the file, `call.mp3`, in its `Content-Disposition`. b24 refused
  it as not audio (`recording.not-audio`), so `meetings transcribe` turned none of these calls into text. It now takes
  the format from the file name when the type names none.
